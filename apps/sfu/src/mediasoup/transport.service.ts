/**
 * mediasoup Transport Service
 *
 * Manages WebRTC Transports for media transmission.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS A TRANSPORT?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A Transport is the network connection between client and mediasoup.
 * Think of it as a "tunnel" for media packets.
 *
 * TYPES OF TRANSPORTS:
 *
 * 1. WebRtcTransport (main type)
 *    - For browser clients
 *    - Uses ICE + DTLS for secure P2P-like connection
 *    - Supports UDP (preferred) and TCP fallback
 *
 * 2. PlainTransport
 *    - For non-WebRTC clients
 *    - Raw RTP/RTCP (FFmpeg, GStreamer)
 *    - Used for recording in Phase 3
 *
 * 3. PipeTransport
 *    - For connecting Routers together
 *    - Used for horizontal scaling
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SEND vs RECEIVE TRANSPORTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each peer typically needs TWO transports:
 *
 * SEND TRANSPORT (Produce):
 * - Client → Server
 * - For sending webcam, screen, audio
 * - Creates Producers
 *
 * RECEIVE TRANSPORT (Consume):
 * - Server → Client
 * - For receiving other participants' media
 * - Creates Consumers
 *
 *        ┌─────────────────────────────────────────┐
 *        │               CLIENT                    │
 *        │  ┌─────────────┐   ┌─────────────┐     │
 *        │  │ Send        │   │ Receive     │     │
 *        │  │ Transport   │   │ Transport   │     │
 *        │  └──────┬──────┘   └──────┬──────┘     │
 *        └─────────┼─────────────────┼────────────┘
 *                  │                 │
 *                  │ (upload)        │ (download)
 *                  ▼                 ▼
 *        ┌─────────────────────────────────────────┐
 *        │            mediasoup SERVER             │
 *        │                                         │
 *        │  Producers ◄───┘         └───► Consumers │
 *        └─────────────────────────────────────────┘
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TRANSPORT LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Client requests transport
 *    └─> createWebRtcTransport(direction: 'send' | 'recv')
 *    └─> Returns transport params (id, ice, dtls)
 *
 * 2. Client creates local transport with params
 *    └─> device.createSendTransport(params) or createRecvTransport(params)
 *
 * 3. Client connects transport (on first produce/consume)
 *    └─> transport.connect({ dtlsParameters })
 *    └─> DTLS handshake happens
 *
 * 4. Transport is ready for media
 *    └─> Can now produce or consume
 *
 * 5. Client disconnects
 *    └─> closeTransport(transportId)
 *    └─> All producers/consumers on transport are closed
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ICE AND DTLS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ICE (Interactive Connectivity Establishment):
 * - Finds the best network path
 * - Handles NAT traversal
 * - mediasoup acts as "ICE Lite" (simplified server-side ICE)
 *
 * DTLS (Datagram Transport Layer Security):
 * - Encryption layer
 * - Key exchange for SRTP
 * - Client and server exchange dtlsParameters
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type {
  WebRtcTransport,
  DtlsParameters,
} from 'mediasoup/types';
import { RouterService } from './router.service';
import {
  getTransportListenIps,
  WEBRTC_TRANSPORT_OPTIONS,
} from './mediasoup.config';
import type {
  TransportInfo,
  TransportDirectionType,
  TransportOptions,
} from './types';
import { validateEnv } from '../config/env.config';
import { logger } from '../common/logger';

@Injectable()
export class TransportService {
  /**
   * Map of transportId → TransportInfo
   */
  private transports: Map<string, TransportInfo> = new Map();

  /**
   * Listen IPs for transports
   */
  private listenIps: { ip: string; announcedIp?: string }[];

  constructor(private readonly routerService: RouterService) {
    const env = validateEnv();
    this.listenIps = getTransportListenIps(
      env.MEDIASOUP_LISTEN_IP,
      env.MEDIASOUP_ANNOUNCED_IP,
    );
  }

  // ===========================================================================
  // Transport Creation
  // ===========================================================================

  /**
   * Create a WebRTC Transport for a peer
   *
   * @param roomId - Room the transport belongs to
   * @param peerId - User ID
   * @param direction - 'send' for producing, 'recv' for consuming
   * @returns Transport options to send to client
   *
   * WHAT THE CLIENT DOES WITH THESE OPTIONS:
   * ```javascript
   * // Client-side
   * const sendTransport = device.createSendTransport({
   *   id: options.id,
   *   iceParameters: options.iceParameters,
   *   iceCandidates: options.iceCandidates,
   *   dtlsParameters: options.dtlsParameters,
   * });
   * ```
   */
  public async createWebRtcTransport(
    roomId: string,
    peerId: string,
    direction: TransportDirectionType,
  ): Promise<TransportOptions> {
    // Get Router for room
    const router = await this.routerService.getOrCreateRouter(roomId);

    logger.info(
      { roomId, peerId, direction },
      'Creating WebRTC transport',
    );

    // Create transport on Router
    const transport = await router.createWebRtcTransport({
      listenIps: this.listenIps,
      ...WEBRTC_TRANSPORT_OPTIONS,
      // App data for tracking
      appData: {
        peerId,
        roomId,
        direction,
      },
    });

    // Handle transport close
    transport.on('routerclose', () => {
      logger.info(
        { transportId: transport.id },
        'Transport closed due to router close',
      );
      this.transports.delete(transport.id);
    });

    // Handle DTLS state changes (connection lifecycle)
    transport.on('dtlsstatechange', (dtlsState) => {
      logger.debug(
        { transportId: transport.id, dtlsState },
        'DTLS state changed',
      );

      if (dtlsState === 'failed' || dtlsState === 'closed') {
        logger.warn(
          { transportId: transport.id, dtlsState },
          'Transport DTLS failed/closed',
        );
        // In production, notify signaling to handle reconnection
      }
    });

    // Handle ICE state changes
    transport.on('icestatechange', (iceState) => {
      logger.debug(
        { transportId: transport.id, iceState },
        'ICE state changed',
      );

      if (iceState === 'disconnected') {
        logger.warn(
          { transportId: transport.id },
          'Transport ICE disconnected',
        );
      }
    });

    // Store transport info
    const transportInfo: TransportInfo = {
      transport,
      peerId,
      roomId,
      direction,
      connected: false,
      createdAt: Date.now(),
    };
    this.transports.set(transport.id, transportInfo);

    logger.info(
      {
        roomId,
        peerId,
        direction,
        transportId: transport.id,
      },
      'WebRTC transport created',
    );

    // Return options for client
    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
      sctpParameters: transport.sctpParameters ?? undefined,
    };
  }

  // ===========================================================================
  // Transport Connection
  // ===========================================================================

  /**
   * Connect a transport (complete DTLS handshake)
   *
   * WHEN IS THIS CALLED?
   * - Client's transport fires 'connect' event (on first produce/consume)
   * - Client sends dtlsParameters to server
   * - Server calls this method
   * - Server responds, client's callback resolves
   *
   * @param transportId - Transport to connect
   * @param dtlsParameters - Client's DTLS parameters
   */
  public async connectTransport(
    transportId: string,
    dtlsParameters: DtlsParameters,
  ): Promise<void> {
    const transportInfo = this.transports.get(transportId);

    if (!transportInfo) {
      throw new Error(`Transport not found: ${transportId}`);
    }

    if (transportInfo.connected) {
      logger.warn({ transportId }, 'Transport already connected');
      return;
    }

    logger.debug(
      { transportId, fingerprint: dtlsParameters.fingerprints?.[0] },
      'Connecting transport',
    );

    // Connect the transport (DTLS handshake)
    await transportInfo.transport.connect({ dtlsParameters });

    // Mark as connected
    transportInfo.connected = true;

    logger.info({ transportId }, 'Transport connected');
  }

  // ===========================================================================
  // Transport Access
  // ===========================================================================

  /**
   * Get transport by ID
   */
  public getTransport(transportId: string): WebRtcTransport | undefined {
    return this.transports.get(transportId)?.transport;
  }

  /**
   * Get transport info by ID
   */
  public getTransportInfo(transportId: string): TransportInfo | undefined {
    return this.transports.get(transportId);
  }

  /**
   * Get all transports for a peer
   */
  public getTransportsForPeer(peerId: string): TransportInfo[] {
    return Array.from(this.transports.values()).filter(
      (t) => t.peerId === peerId,
    );
  }

  /**
   * Get send transport for a peer in a room
   */
  public getSendTransport(
    roomId: string,
    peerId: string,
  ): WebRtcTransport | undefined {
    for (const info of this.transports.values()) {
      if (
        info.roomId === roomId &&
        info.peerId === peerId &&
        info.direction === 'send'
      ) {
        return info.transport;
      }
    }
    return undefined;
  }

  /**
   * Get receive transport for a peer in a room
   */
  public getRecvTransport(
    roomId: string,
    peerId: string,
  ): WebRtcTransport | undefined {
    for (const info of this.transports.values()) {
      if (
        info.roomId === roomId &&
        info.peerId === peerId &&
        info.direction === 'recv'
      ) {
        return info.transport;
      }
    }
    return undefined;
  }

  /**
   * Get transport for a peer by direction (cross-room)
   *
   * WHY THIS METHOD?
   * - Sometimes we need to get a peer's transport without knowing the room
   * - Used by consume() when client already has transports created
   *
   * @param peerId - Peer ID
   * @param direction - 'send' or 'recv'
   * @returns Transport if found
   */
  public getTransportForPeer(
    peerId: string,
    direction: TransportDirectionType,
  ): WebRtcTransport | undefined {
    for (const info of this.transports.values()) {
      if (info.peerId === peerId && info.direction === direction) {
        return info.transport;
      }
    }
    return undefined;
  }

  // ===========================================================================
  // Transport Cleanup
  // ===========================================================================

  /**
   * Close a transport
   *
   * WHAT HAPPENS:
   * - Transport is closed
   * - All Producers on transport are closed
   * - All Consumers on transport are closed
   * - Resources freed
   */
  public closeTransport(transportId: string): void {
    const transportInfo = this.transports.get(transportId);

    if (!transportInfo) {
      logger.warn({ transportId }, 'Transport not found for closing');
      return;
    }

    logger.info(
      {
        transportId,
        peerId: transportInfo.peerId,
        direction: transportInfo.direction,
      },
      'Closing transport',
    );

    // Close transport (cascades to producers/consumers)
    transportInfo.transport.close();

    // Remove from map
    this.transports.delete(transportId);
  }

  /**
   * Close all transports for a peer
   *
   * WHEN TO CALL:
   * - Peer disconnects
   * - Peer leaves room
   */
  public closeTransportsForPeer(peerId: string): void {
    const peerTransports = this.getTransportsForPeer(peerId);

    for (const transportInfo of peerTransports) {
      this.closeTransport(transportInfo.transport.id);
    }

    logger.info(
      { peerId, count: peerTransports.length },
      'Closed all transports for peer',
    );
  }

  /**
   * Close all transports in a room
   *
   * WHEN TO CALL:
   * - Room is closed
   */
  public closeTransportsInRoom(roomId: string): void {
    let count = 0;

    for (const [transportId, info] of this.transports) {
      if (info.roomId === roomId) {
        info.transport.close();
        this.transports.delete(transportId);
        count++;
      }
    }

    logger.info({ roomId, count }, 'Closed all transports in room');
  }

  // ===========================================================================
  // Stats & Monitoring
  // ===========================================================================

  /**
   * Get transport stats from mediasoup
   */
  public async getTransportStats(transportId: string): Promise<unknown> {
    const transport = this.getTransport(transportId);
    if (!transport) {
      return null;
    }
    return transport.getStats();
  }

  /**
   * Get all transports info (for monitoring)
   */
  public getAllTransportsInfo(): Array<{
    id: string;
    peerId: string;
    roomId: string;
    direction: TransportDirectionType;
    connected: boolean;
    createdAt: number;
  }> {
    return Array.from(this.transports.values()).map((info) => ({
      id: info.transport.id,
      peerId: info.peerId,
      roomId: info.roomId,
      direction: info.direction,
      connected: info.connected,
      createdAt: info.createdAt,
    }));
  }

  /**
   * Get transport count
   */
  public getTransportCount(): number {
    return this.transports.size;
  }
}
