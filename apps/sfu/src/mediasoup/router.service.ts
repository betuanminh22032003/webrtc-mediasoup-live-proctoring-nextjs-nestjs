/**
 * mediasoup Router Service
 *
 * Manages the lifecycle of mediasoup Routers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS A ROUTER?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A Router is a mediasoup entity that handles media routing within a "room".
 *
 * KEY CONCEPTS:
 * - Routes RTP/RTCP packets between Producers and Consumers
 * - Defines which codecs are supported (via mediaCodecs)
 * - All Producers/Consumers in same Router can communicate
 *
 * ROUTER ↔ ROOM MAPPING:
 * - Simple: 1 Router per Room (our approach)
 * - Advanced: Multiple Routers per Room with PipeTransport (for scaling)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ROUTER LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. First user joins room
 *    └─> getOrCreateRouter(roomId)
 *    └─> Creates new Router on least-loaded Worker
 *    └─> Returns Router RTP capabilities to client
 *
 * 2. More users join same room
 *    └─> getOrCreateRouter(roomId) returns existing Router
 *
 * 3. Last user leaves room
 *    └─> closeRouter(roomId) closes Router
 *    └─> Frees resources
 *
 * 4. Worker dies
 *    └─> All Routers on that Worker are lost
 *    └─> Users must reconnect (handled by signaling)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RTP CAPABILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RTP Capabilities define what codecs/features the Router supports.
 * Client needs these to:
 *
 * 1. Create mediasoup Device (client-side)
 * 2. Negotiate codecs
 * 3. Determine if produce/consume is possible
 *
 * FLOW:
 * Client connects → Server sends rtpCapabilities → Client creates Device
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type { Router, RtpCapabilities } from 'mediasoup/types';
import { WorkerManagerService } from './worker-manager.service';
import { ROUTER_MEDIA_CODECS } from './mediasoup.config';
import type { RouterInfo } from './types';
import { logger } from '../common/logger';

@Injectable()
export class RouterService {
  /**
   * Map of roomId → RouterInfo
   *
   * WHY Map?
   * - O(1) lookup by roomId
   * - Easy cleanup when room closes
   */
  private routers: Map<string, RouterInfo> = new Map();

  constructor(private readonly workerManager: WorkerManagerService) {}

  // ===========================================================================
  // Router Creation & Access
  // ===========================================================================

  /**
   * Get or create a Router for a room
   *
   * WHY "getOrCreate" pattern?
   * - First user creates Router
   * - Subsequent users reuse it
   * - Idempotent - safe to call multiple times
   *
   * @param roomId - Unique room identifier
   * @returns Router instance
   */
  public async getOrCreateRouter(roomId: string): Promise<Router> {
    // Check if Router already exists
    const existing = this.routers.get(roomId);
    if (existing) {
      logger.debug({ roomId }, 'Using existing router');
      return existing.router;
    }

    // Create new Router
    return this.createRouter(roomId);
  }

  /**
   * Create a new Router for a room
   *
   * FLOW:
   * 1. Get next worker (round-robin)
   * 2. Create Router with media codecs
   * 3. Set up event handlers
   * 4. Store in routers Map
   * 5. Return Router
   */
  private async createRouter(roomId: string): Promise<Router> {
    const worker = this.workerManager.getNextWorker();

    logger.info(
      { roomId, workerPid: worker.pid },
      'Creating router for room',
    );

    // Create Router with supported codecs
    const router = await worker.createRouter({
      mediaCodecs: ROUTER_MEDIA_CODECS,
    });

    // Handle Router close
    router.on('workerclose', () => {
      logger.warn({ roomId }, 'Router closed due to worker close');
      this.routers.delete(roomId);
    });

    // Store Router info
    const routerInfo: RouterInfo = {
      router,
      roomId,
      workerId: worker.pid,
      createdAt: Date.now(),
    };
    this.routers.set(roomId, routerInfo);

    // Update worker router count
    this.workerManager.incrementRouterCount(worker);

    logger.info(
      {
        roomId,
        routerId: router.id,
        workerPid: worker.pid,
      },
      'Router created',
    );

    return router;
  }

  /**
   * Get Router for a room (without creating)
   *
   * USE CASE: When you need the Router and it should already exist
   */
  public getRouter(roomId: string): Router | undefined {
    return this.routers.get(roomId)?.router;
  }

  /**
   * Get RTP Capabilities for a room
   *
   * Client needs this to:
   * 1. Create mediasoup Device
   * 2. Load Device with capabilities
   * 3. Know what codecs are supported
   *
   * @param roomId - Room to get capabilities for
   * @returns RTP capabilities or undefined if room doesn't exist
   */
  public async getRtpCapabilities(roomId: string): Promise<RtpCapabilities | undefined> {
    const router = await this.getOrCreateRouter(roomId);
    return router.rtpCapabilities;
  }

  // ===========================================================================
  // Router Cleanup
  // ===========================================================================

  /**
   * Close Router for a room
   *
   * WHEN TO CALL:
   * - Last user leaves room
   * - Room is explicitly closed
   *
   * WHAT HAPPENS:
   * - All Transports on Router are closed
   * - All Producers/Consumers are closed
   * - Resources are freed
   */
  public closeRouter(roomId: string): void {
    const routerInfo = this.routers.get(roomId);
    if (!routerInfo) {
      logger.warn({ roomId }, 'Router not found for closing');
      return;
    }

    logger.info({ roomId }, 'Closing router');

    // Close the Router (cascades to all Transports/Producers/Consumers)
    routerInfo.router.close();

    // Remove from Map
    this.routers.delete(roomId);

    // Update worker router count
    // Note: Need to find worker by workerId
    // This is handled by worker 'routerclose' event in production

    logger.info({ roomId }, 'Router closed');
  }

  /**
   * Check if Router exists for a room
   */
  public hasRouter(roomId: string): boolean {
    return this.routers.has(roomId);
  }

  // ===========================================================================
  // Advanced: Router Piping (for horizontal scaling)
  // ===========================================================================

  /**
   * Pipe producers from one Router to another
   *
   * USE CASE: Cross-worker or cross-server routing
   *
   * SCENARIO:
   * - Candidate on Worker 1 (Router A)
   * - Proctor on Worker 2 (Router B)
   * - Need to "pipe" media from Router A to Router B
   *
   * This is an ADVANCED feature for scaling beyond single server.
   * Not implemented in Phase 2 - placeholder for future.
   */
  public async pipeToRouter(
    sourceRoomId: string,
    targetRoomId: string,
    producerId: string,
  ): Promise<void> {
    const sourceRouter = this.getRouter(sourceRoomId);
    const targetRouter = this.getRouter(targetRoomId);

    if (!sourceRouter || !targetRouter) {
      throw new Error('Source or target router not found');
    }

    // TODO: Implement for Phase 5 (multi-server scaling)
    // 1. Create PipeTransport on source Router
    // 2. Create PipeTransport on target Router
    // 3. Connect them
    // 4. Pipe the producer

    logger.info(
      { sourceRoomId, targetRoomId, producerId },
      'Router piping not yet implemented',
    );
  }

  // ===========================================================================
  // Stats & Monitoring
  // ===========================================================================

  /**
   * Get all routers info
   */
  public getRouterStats(): Array<{
    roomId: string;
    routerId: string;
    workerId: number;
    createdAt: number;
    uptime: number;
  }> {
    const now = Date.now();
    return Array.from(this.routers.entries()).map(([roomId, info]) => ({
      roomId,
      routerId: info.router.id,
      workerId: info.workerId,
      createdAt: info.createdAt,
      uptime: now - info.createdAt,
    }));
  }

  /**
   * Get number of active routers
   */
  public getRouterCount(): number {
    return this.routers.size;
  }

  /**
   * Check if there's capacity for more routers
   * (Simple check - could be more sophisticated)
   */
  public hasCapacity(): boolean {
    // Simple: limit to 100 routers per worker
    const workerCount = this.workerManager.getWorkerCount();
    const maxRouters = workerCount * 100;
    return this.routers.size < maxRouters;
  }
}
