/**
 * mediasoup Worker Manager Service
 *
 * Manages the lifecycle of mediasoup Workers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS A WORKER?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A Worker is an OS-level process that runs the mediasoup C++ code.
 * - Each Worker is a separate process (not a thread!)
 * - Workers handle the actual RTP/RTCP media processing
 * - Node.js communicates with Workers via channel/payloadChannel
 *
 * WHY MULTIPLE WORKERS?
 * - Node.js is single-threaded
 * - Media processing is CPU-intensive
 * - Multiple Workers = utilize multiple CPU cores
 * - Worker crash isolation (one crash doesn't kill all)
 *
 * BEST PRACTICE: 1 Worker per CPU core
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WORKER LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Application Startup
 *    └─> createWorkers() creates N workers (N = CPU cores)
 *
 * 2. Room Created
 *    └─> getNextWorker() returns least-loaded worker
 *    └─> Worker creates Router for that room
 *
 * 3. Worker Dies (crash)
 *    └─> 'died' event fires
 *    └─> Remove from pool
 *    └─> Create replacement worker
 *    └─> Affected rooms need to reconnect (handled by signaling)
 *
 * 4. Application Shutdown
 *    └─> closeAllWorkers() gracefully terminates all workers
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import type { Worker } from 'mediasoup/types';
import type { WorkerInfo, WorkerManagerConfig } from './types';
import { getWorkerSettings, getNumWorkers } from './mediasoup.config';
import { logger } from '../common/logger';
import { validateEnv } from '../config/env.config';

@Injectable()
export class WorkerManagerService implements OnModuleInit, OnModuleDestroy {
  /**
   * Array of worker info objects
   * WHY array? Easier round-robin selection than Map
   */
  private workers: WorkerInfo[] = [];

  /**
   * Index for round-robin worker selection
   * WHY round-robin? Simple load distribution, workers have similar capacity
   */
  private nextWorkerIndex = 0;

  /**
   * Configuration from environment
   */
  private config: WorkerManagerConfig;

  constructor() {
    const env = validateEnv();
    this.config = {
      numWorkers: getNumWorkers(env.MEDIASOUP_WORKERS),
      rtcMinPort: env.MEDIASOUP_MIN_PORT,
      rtcMaxPort: env.MEDIASOUP_MAX_PORT,
      logLevel: 'warn',
    };
  }

  /**
   * Initialize workers on module startup
   *
   * WHY OnModuleInit?
   * - NestJS lifecycle hook
   * - Workers ready before any requests
   * - Fail fast if worker creation fails
   */
  async onModuleInit(): Promise<void> {
    logger.info(
      { numWorkers: this.config.numWorkers },
      '🚀 Initializing mediasoup workers...',
    );

    await this.createWorkers();

    logger.info(
      { numWorkers: this.workers.length },
      '✅ mediasoup workers initialized',
    );
  }

  /**
   * Cleanup workers on module shutdown
   *
   * WHY OnModuleDestroy?
   * - Graceful shutdown
   * - Close all worker processes
   * - Free system resources
   */
  async onModuleDestroy(): Promise<void> {
    logger.info('🛑 Shutting down mediasoup workers...');
    await this.closeAllWorkers();
    logger.info('✅ mediasoup workers shut down');
  }

  // ===========================================================================
  // Worker Creation
  // ===========================================================================

  /**
   * Create all workers
   */
  private async createWorkers(): Promise<void> {
    const numWorkers = this.config.numWorkers ?? 1;

    for (let i = 0; i < numWorkers; i++) {
      await this.createWorker();
    }
  }

  /**
   * Create a single worker
   *
   * FLOW:
   * 1. Create worker with settings
   * 2. Set up event handlers
   * 3. Add to workers array
   * 4. Log success
   */
  private async createWorker(): Promise<WorkerInfo> {
    const workerSettings = getWorkerSettings(
      this.config.rtcMinPort,
      this.config.rtcMaxPort,
    );

    logger.debug({ settings: workerSettings }, 'Creating mediasoup worker...');

    const worker = await mediasoup.createWorker(workerSettings);

    // Handle worker death
    worker.on('died', (error) => {
      this.handleWorkerDeath(worker, error);
    });

    // Optional: Log worker resource usage
    // worker.observer.on('newrouter', (router) => {
    //   logger.debug({ routerId: router.id }, 'New router created');
    // });

    const workerInfo: WorkerInfo = {
      worker,
      routerCount: 0,
      createdAt: Date.now(),
      pid: worker.pid,
    };

    this.workers.push(workerInfo);

    logger.info(
      {
        pid: worker.pid,
        totalWorkers: this.workers.length,
      },
      'Created mediasoup worker',
    );

    return workerInfo;
  }

  /**
   * Handle worker death
   *
   * IMPORTANT: Worker death is a serious event!
   * - All routers on that worker are lost
   * - All transports/producers/consumers on those routers are closed
   * - Clients connected to those routers must reconnect
   *
   * RECOVERY STRATEGY:
   * 1. Log the error (critical!)
   * 2. Remove dead worker from pool
   * 3. Create replacement worker
   * 4. Signaling layer should handle client reconnection
   */
  private async handleWorkerDeath(
    worker: Worker,
    error: Error,
  ): Promise<void> {
    logger.error(
      {
        pid: worker.pid,
        error: error.message,
      },
      '💀 mediasoup worker died!',
    );

    // Remove dead worker from array
    const index = this.workers.findIndex((w) => w.worker.pid === worker.pid);
    if (index !== -1) {
      this.workers.splice(index, 1);

      // Adjust next index if needed
      if (this.nextWorkerIndex >= this.workers.length) {
        this.nextWorkerIndex = 0;
      }
    }

    // Create replacement worker
    try {
      logger.info('Creating replacement worker...');
      await this.createWorker();
      logger.info('Replacement worker created');
    } catch (createError) {
      logger.error(
        { error: (createError as Error).message },
        'Failed to create replacement worker!',
      );
    }
  }

  // ===========================================================================
  // Worker Selection
  // ===========================================================================

  /**
   * Get the next worker using round-robin selection
   *
   * WHY ROUND-ROBIN?
   * - Simple and effective
   * - All workers have same capacity
   * - Even distribution over time
   *
   * ALTERNATIVE: Least-loaded selection
   * - Track routerCount on each worker
   * - Return worker with lowest count
   * - More complex, marginal benefit for typical loads
   */
  public getNextWorker(): Worker {
    if (this.workers.length === 0) {
      throw new Error('No mediasoup workers available');
    }

    const workerInfo = this.workers[this.nextWorkerIndex];

    // Advance index for next call
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;

    logger.debug(
      {
        pid: workerInfo.pid,
        routerCount: workerInfo.routerCount,
      },
      'Selected worker',
    );

    return workerInfo.worker;
  }

  /**
   * Get worker with least routers (alternative selection strategy)
   *
   * USE CASE: When rooms have very different loads
   */
  public getLeastLoadedWorker(): Worker {
    if (this.workers.length === 0) {
      throw new Error('No mediasoup workers available');
    }

    const leastLoaded = this.workers.reduce((min, current) =>
      current.routerCount < min.routerCount ? current : min,
    );

    return leastLoaded.worker;
  }

  /**
   * Increment router count for a worker
   * Called when a router is created on a worker
   */
  public incrementRouterCount(worker: Worker): void {
    const workerInfo = this.workers.find((w) => w.worker.pid === worker.pid);
    if (workerInfo) {
      workerInfo.routerCount++;
    }
  }

  /**
   * Decrement router count for a worker
   * Called when a router is closed
   */
  public decrementRouterCount(worker: Worker): void {
    const workerInfo = this.workers.find((w) => w.worker.pid === worker.pid);
    if (workerInfo && workerInfo.routerCount > 0) {
      workerInfo.routerCount--;
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Close all workers gracefully
   */
  private async closeAllWorkers(): Promise<void> {
    for (const workerInfo of this.workers) {
      workerInfo.worker.close();
    }
    this.workers = [];
    this.nextWorkerIndex = 0;
  }

  // ===========================================================================
  // Stats & Monitoring
  // ===========================================================================

  /**
   * Get worker statistics
   * Useful for monitoring/health checks
   */
  public getWorkerStats(): Array<{
    pid: number;
    routerCount: number;
    createdAt: number;
    uptime: number;
  }> {
    const now = Date.now();
    return this.workers.map((w) => ({
      pid: w.pid,
      routerCount: w.routerCount,
      createdAt: w.createdAt,
      uptime: now - w.createdAt,
    }));
  }

  /**
   * Get total number of workers
   */
  public getWorkerCount(): number {
    return this.workers.length;
  }

  /**
   * Check if workers are healthy
   */
  public isHealthy(): boolean {
    return this.workers.length > 0;
  }
}
