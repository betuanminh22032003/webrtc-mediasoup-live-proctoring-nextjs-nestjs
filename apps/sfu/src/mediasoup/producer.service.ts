/**
 * mediasoup Producer Service
 *
 * Manages Producers (sending media to SFU).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS A PRODUCER?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A Producer represents a media source (track) being sent to the SFU.
 *
 * EXAMPLES:
 * - Webcam video → video Producer
 * - Screen share → video Producer
 * - Microphone audio → audio Producer
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PRODUCER LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Client has a media track (from getUserMedia/getDisplayMedia)
 *
 * 2. Client calls transport.produce({ track, ... })
 *    └─> 'connect' event fires (if not connected yet)
 *    └─> 'produce' event fires with rtpParameters
 *
 * 3. Server receives produce request via signaling
 *    └─> producerService.produce(...)
 *    └─> Creates Producer on server transport
 *    └─> Returns producerId
 *
 * 4. Client's produce() resolves with Producer object
 *    └─> Media now flowing to server!
 *
 * 5. Server notifies other participants about new Producer
 *    └─> "Hey, user X is now sending their webcam!"
 *
 * 6. Client stops producing
 *    └─> producer.close()
 *    └─> Server closes Producer
 *    └─> Consumers of this Producer are closed
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RTP PARAMETERS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When client produces, it sends rtpParameters:
 *
 * ```javascript
 * {
 *   codecs: [{
 *     mimeType: 'video/VP8',
 *     clockRate: 90000,
 *     payloadType: 96,
 *     // ... encoding parameters
 *   }],
 *   encodings: [{
 *     ssrc: 12345678,  // Synchronization Source ID
 *     // Simulcast layers if enabled
 *   }],
 *   rtcp: {
 *     cname: 'uniqueId',  // Canonical name
 *     reducedSize: true,
 *   }
 * }
 * ```
 *
 * These parameters tell mediasoup how to receive and route the RTP packets.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TRACK TYPES IN PROCTORING
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each candidate should produce:
 * - webcam: Video of candidate's face (required)
 * - screen: Screen share of their display (required)
 * - audio: Microphone audio (optional but recommended)
 *
 * Total: Up to 3 Producers per candidate
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type {
  Producer,
  RtpParameters,
  MediaKind,
} from 'mediasoup/types';
import { TransportService } from './transport.service';
import type { ProducerInfo, ProducerAppData, NewProducerEvent } from './types';
import { logger } from '../common/logger';

// Event emitter type for broadcasting new producers
export type NewProducerCallback = (event: NewProducerEvent) => void;

@Injectable()
export class ProducerService {
  /**
   * Map of producerId → ProducerInfo
   */
  private producers: Map<string, ProducerInfo> = new Map();

  /**
   * Callbacks for new producer events
   * Used to notify signaling layer
   */
  private newProducerCallbacks: NewProducerCallback[] = [];

  constructor(private readonly transportService: TransportService) {}

  // ===========================================================================
  // Producer Creation
  // ===========================================================================

  /**
   * Create a Producer on a transport
   *
   * @param transportId - Send transport to produce on
   * @param kind - 'audio' or 'video'
   * @param rtpParameters - RTP parameters from client
   * @param appData - Custom data (track type, etc.)
   * @returns Producer ID
   *
   * WHAT HAPPENS:
   * 1. Get transport
   * 2. Create Producer on transport
   * 3. Set up event handlers
   * 4. Store Producer info
   * 5. Notify listeners (for broadcasting to other participants)
   * 6. Return Producer ID
   */
  public async produce(
    transportId: string,
    kind: MediaKind,
    rtpParameters: RtpParameters,
    appData: ProducerAppData,
  ): Promise<string> {
    const transportInfo = this.transportService.getTransportInfo(transportId);

    if (!transportInfo) {
      throw new Error(`Transport not found: ${transportId}`);
    }

    if (transportInfo.direction !== 'send') {
      throw new Error(`Transport ${transportId} is not a send transport`);
    }

    logger.info(
      {
        transportId,
        kind,
        trackType: appData.trackType,
        peerId: appData.peerId,
      },
      'Creating producer',
    );

    // Create Producer on transport
    const producer = await transportInfo.transport.produce({
      kind,
      rtpParameters,
      appData,
    });

    // Handle Producer events
    producer.on('transportclose', () => {
      logger.info(
        { producerId: producer.id },
        'Producer closed due to transport close',
      );
      this.producers.delete(producer.id);
    });

    producer.on('score', (score) => {
      // Score indicates quality (0-10)
      // Can be used for quality monitoring
      logger.debug(
        { producerId: producer.id, score },
        'Producer score',
      );
    });

    // Store Producer info
    const producerInfo: ProducerInfo = {
      producer,
      appData,
      createdAt: Date.now(),
    };
    this.producers.set(producer.id, producerInfo);

    logger.info(
      {
        producerId: producer.id,
        kind,
        trackType: appData.trackType,
        peerId: appData.peerId,
        roomId: appData.roomId,
      },
      'Producer created',
    );

    // Notify listeners about new producer
    this.notifyNewProducer({
      producerId: producer.id,
      peerId: appData.peerId,
      kind,
      trackType: appData.trackType,
    });

    return producer.id;
  }

  // ===========================================================================
  // Producer Access
  // ===========================================================================

  /**
   * Get Producer by ID
   */
  public getProducer(producerId: string): Producer | undefined {
    return this.producers.get(producerId)?.producer;
  }

  /**
   * Get Producer info by ID
   */
  public getProducerInfo(producerId: string): ProducerInfo | undefined {
    return this.producers.get(producerId);
  }

  /**
   * Get all Producers for a peer
   */
  public getProducersForPeer(peerId: string): ProducerInfo[] {
    return Array.from(this.producers.values()).filter(
      (info) => info.appData.peerId === peerId,
    );
  }

  /**
   * Get all Producers in a room
   */
  public getProducersInRoom(roomId: string): ProducerInfo[] {
    return Array.from(this.producers.values()).filter(
      (info) => info.appData.roomId === roomId,
    );
  }

  /**
   * Get Producers by track type for a peer
   */
  public getProducerByTrackType(
    peerId: string,
    trackType: 'webcam' | 'screen' | 'audio',
  ): Producer | undefined {
    for (const info of this.producers.values()) {
      if (info.appData.peerId === peerId && info.appData.trackType === trackType) {
        return info.producer;
      }
    }
    return undefined;
  }

  // ===========================================================================
  // Producer Control
  // ===========================================================================

  /**
   * Pause a Producer
   *
   * WHY PAUSE?
   * - User mutes their mic
   * - User turns off camera temporarily
   * - Producer still exists, just not sending useful media
   * - Faster to resume than recreating Producer
   */
  public async pauseProducer(producerId: string): Promise<void> {
    const producer = this.getProducer(producerId);

    if (!producer) {
      throw new Error(`Producer not found: ${producerId}`);
    }

    await producer.pause();

    logger.info({ producerId }, 'Producer paused');
  }

  /**
   * Resume a paused Producer
   */
  public async resumeProducer(producerId: string): Promise<void> {
    const producer = this.getProducer(producerId);

    if (!producer) {
      throw new Error(`Producer not found: ${producerId}`);
    }

    await producer.resume();

    logger.info({ producerId }, 'Producer resumed');
  }

  // ===========================================================================
  // Producer Cleanup
  // ===========================================================================

  /**
   * Close a Producer
   *
   * WHAT HAPPENS:
   * - Producer is closed
   * - All Consumers of this Producer are closed
   * - Media stops flowing
   */
  public closeProducer(producerId: string): void {
    const producerInfo = this.producers.get(producerId);

    if (!producerInfo) {
      logger.warn({ producerId }, 'Producer not found for closing');
      return;
    }

    logger.info(
      {
        producerId,
        peerId: producerInfo.appData.peerId,
        trackType: producerInfo.appData.trackType,
      },
      'Closing producer',
    );

    producerInfo.producer.close();
    this.producers.delete(producerId);
  }

  /**
   * Close all Producers for a peer
   *
   * WHEN TO CALL:
   * - Peer disconnects
   * - Peer leaves room
   */
  public closeProducersForPeer(peerId: string): void {
    const peerProducers = this.getProducersForPeer(peerId);

    for (const producerInfo of peerProducers) {
      this.closeProducer(producerInfo.producer.id);
    }

    logger.info(
      { peerId, count: peerProducers.length },
      'Closed all producers for peer',
    );
  }

  // ===========================================================================
  // New Producer Events
  // ===========================================================================

  /**
   * Register callback for new producer events
   *
   * WHY?
   * When a new Producer is created, other participants may want to
   * consume it. The signaling layer needs to know about new Producers
   * to notify other participants.
   */
  public onNewProducer(callback: NewProducerCallback): void {
    this.newProducerCallbacks.push(callback);
  }

  /**
   * Notify all listeners about a new Producer
   */
  private notifyNewProducer(event: NewProducerEvent): void {
    for (const callback of this.newProducerCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logger.error(
          { error: (error as Error).message },
          'Error in new producer callback',
        );
      }
    }
  }

  // ===========================================================================
  // Stats & Monitoring
  // ===========================================================================

  /**
   * Get Producer stats from mediasoup
   */
  public async getProducerStats(producerId: string): Promise<unknown> {
    const producer = this.getProducer(producerId);
    if (!producer) {
      return null;
    }
    return producer.getStats();
  }

  /**
   * Get all Producers info (for monitoring)
   */
  public getAllProducersInfo(): Array<{
    id: string;
    kind: MediaKind;
    peerId: string;
    roomId: string;
    trackType: string;
    paused: boolean;
    createdAt: number;
  }> {
    return Array.from(this.producers.values()).map((info) => ({
      id: info.producer.id,
      kind: info.producer.kind,
      peerId: info.appData.peerId,
      roomId: info.appData.roomId,
      trackType: info.appData.trackType,
      paused: info.producer.paused,
      createdAt: info.createdAt,
    }));
  }

  /**
   * Get Producer count
   */
  public getProducerCount(): number {
    return this.producers.size;
  }
}
