/**
 * mediasoup Consumer Service
 *
 * Manages Consumers (receiving media from SFU).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS A CONSUMER?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A Consumer represents a media stream being received FROM the SFU.
 * It's the counterpart to a Producer.
 *
 * RELATIONSHIP:
 * - Producer (Candidate's webcam) → Consumer (Proctor viewing that webcam)
 * - One Producer can have MANY Consumers (multiple proctors watching)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONSUMER LIFECYCLE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Proctor wants to view Candidate's webcam
 *    └─> Check router.canConsume({ producerId, rtpCapabilities })
 *
 * 2. Server creates Consumer
 *    └─> consumerService.consume(...)
 *    └─> Consumer starts PAUSED (important!)
 *
 * 3. Server sends Consumer params to Proctor
 *    └─> { id, producerId, kind, rtpParameters }
 *
 * 4. Proctor's transport.consume() creates local Consumer
 *    └─> Returns MediaStreamTrack
 *    └─> Track can be attached to <video> element
 *
 * 5. Proctor signals ready, server resumes Consumer
 *    └─> consumer.resume()
 *    └─> Media now flowing!
 *
 * 6. Proctor stops viewing or disconnects
 *    └─> consumer.close()
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY START PAUSED?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Consumer is created PAUSED for a reason:
 *
 * 1. Avoid bandwidth waste
 *    - Don't send media until client is ready to receive
 *
 * 2. Synchronization
 *    - Client needs to set up video element first
 *    - Then signal ready
 *
 * 3. Race condition prevention
 *    - Media arriving before client is ready = dropped frames
 *
 * FLOW:
 * Server creates Consumer (paused)
 *   → Client creates local Consumer
 *   → Client attaches to <video>
 *   → Client sends "consumer.resume"
 *   → Server resumes Consumer
 *   → Media flows
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RTP CAPABILITIES CHECK
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Before consuming, we MUST check if client can consume:
 *
 * ```javascript
 * if (!router.canConsume({
 *   producerId: producer.id,
 *   rtpCapabilities: clientRtpCapabilities,
 * })) {
 *   throw new Error('Cannot consume - incompatible codecs');
 * }
 * ```
 *
 * WHY? Client might not support the codec Producer is using.
 * Example: Producer using VP9, Client only supports VP8.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PROCTORING USE CASE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Proctor Dashboard:
 * - Grid of candidate video tiles
 * - Each tile = Consumer of that candidate's webcam Producer
 * - Click to enlarge = Also consume screen share Producer
 *
 * Lazy Loading Strategy:
 * - Don't create ALL Consumers immediately
 * - Create Consumer only when proctor scrolls to that candidate
 * - Close Consumer when candidate goes off-screen
 * - Saves server and client bandwidth!
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type {
  Consumer,
  RtpCapabilities,
  MediaKind,
  ConsumerScore,
  ConsumerLayers,
} from 'mediasoup/types';
import type { TransportService } from './transport.service';
import type { RouterService } from './router.service';
import type { ProducerService } from './producer.service';
import type { ConsumerInfo, ConsumerAppData, ConsumerOptions } from './types';
import { logger } from '../common/logger';

@Injectable()
export class ConsumerService {
  /**
   * Map of consumerId → ConsumerInfo
   */
  private consumers: Map<string, ConsumerInfo> = new Map();

  constructor(
    private readonly transportService: TransportService,
    private readonly routerService: RouterService,
    private readonly producerService: ProducerService,
  ) {}

  // ===========================================================================
  // Consumer Creation
  // ===========================================================================

  /**
   * Create a Consumer to receive media from a Producer
   *
   * @param roomId - Room where Producer exists
   * @param consumerPeerId - User ID of the consumer (receiver)
   * @param transportId - Receive transport to create Consumer on
   * @param producerId - Producer to consume
   * @param rtpCapabilities - Consumer's RTP capabilities (from Device)
   * @returns Consumer options to send to client
   *
   * IMPORTANT: Consumer is created PAUSED!
   * Client must call resume after setting up.
   */
  public async consume(
    roomId: string,
    consumerPeerId: string,
    transportId: string,
    producerId: string,
    rtpCapabilities: RtpCapabilities,
  ): Promise<ConsumerOptions> {
    // Get Router
    const router = this.routerService.getRouter(roomId);
    if (!router) {
      throw new Error(`Router not found for room: ${roomId}`);
    }

    // Get Producer
    const producerInfo = this.producerService.getProducerInfo(producerId);
    if (!producerInfo) {
      throw new Error(`Producer not found: ${producerId}`);
    }

    // Check if can consume
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(
        `Cannot consume producer ${producerId} - incompatible codecs`,
      );
    }

    // Get receive transport
    const transportInfo = this.transportService.getTransportInfo(transportId);
    if (!transportInfo) {
      throw new Error(`Transport not found: ${transportId}`);
    }

    if (transportInfo.direction !== 'recv') {
      throw new Error(`Transport ${transportId} is not a receive transport`);
    }

    logger.info(
      {
        roomId,
        consumerPeerId,
        producerId,
        producerPeerId: producerInfo.appData.peerId,
        trackType: producerInfo.appData.trackType,
      },
      'Creating consumer',
    );

    // Create app data for consumer
    const consumerAppData: ConsumerAppData = {
      producerId,
      peerId: consumerPeerId,
      roomId,
      trackType: producerInfo.appData.trackType,
    };

    // Create Consumer (PAUSED)
    const consumer = await transportInfo.transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused - client will resume
      appData: consumerAppData,
    });

    // Handle Consumer events
    consumer.on('transportclose', () => {
      logger.info(
        { consumerId: consumer.id },
        'Consumer closed due to transport close',
      );
      this.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      logger.info(
        { consumerId: consumer.id, producerId },
        'Consumer closed due to producer close',
      );
      this.consumers.delete(consumer.id);
      // TODO: Notify client that producer is gone
    });

    consumer.on('producerpause', () => {
      logger.debug(
        { consumerId: consumer.id },
        'Consumer paused due to producer pause',
      );
    });

    consumer.on('producerresume', () => {
      logger.debug(
        { consumerId: consumer.id },
        'Consumer resumed due to producer resume',
      );
    });

    consumer.on('score', (score: ConsumerScore) => {
      // Score indicates quality (0-10)
      logger.debug(
        { consumerId: consumer.id, score },
        'Consumer score',
      );
    });

    consumer.on('layerschange', (layers: ConsumerLayers | undefined) => {
      // Simulcast layer changes
      logger.debug(
        { consumerId: consumer.id, layers },
        'Consumer layers changed',
      );
    });

    // Store Consumer info
    const consumerInfo: ConsumerInfo = {
      consumer,
      appData: consumerAppData,
      createdAt: Date.now(),
    };
    this.consumers.set(consumer.id, consumerInfo);

    logger.info(
      {
        consumerId: consumer.id,
        consumerPeerId,
        producerId,
        kind: consumer.kind,
        trackType: producerInfo.appData.trackType,
      },
      'Consumer created (paused)',
    );

    // Return options for client
    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      appData: consumerAppData,
    };
  }

  // ===========================================================================
  // Consumer Control
  // ===========================================================================

  /**
   * Resume a Consumer
   *
   * WHEN TO CALL:
   * After client has:
   * 1. Created local Consumer with transport.consume()
   * 2. Attached resulting track to video element
   * 3. Signals ready
   */
  public async resumeConsumer(consumerId: string): Promise<void> {
    const consumer = this.getConsumer(consumerId);

    if (!consumer) {
      throw new Error(`Consumer not found: ${consumerId}`);
    }

    await consumer.resume();

    logger.info({ consumerId }, 'Consumer resumed');
  }

  /**
   * Pause a Consumer
   *
   * WHY PAUSE?
   * - Proctor scrolls candidate off-screen
   * - Bandwidth optimization
   * - Consumer still exists, just not receiving
   */
  public async pauseConsumer(consumerId: string): Promise<void> {
    const consumer = this.getConsumer(consumerId);

    if (!consumer) {
      throw new Error(`Consumer not found: ${consumerId}`);
    }

    await consumer.pause();

    logger.info({ consumerId }, 'Consumer paused');
  }

  /**
   * Set preferred layers (for simulcast)
   *
   * WHAT IS THIS?
   * When Producer sends simulcast (multiple quality layers),
   * Consumer can choose which layer to receive.
   *
   * EXAMPLE:
   * - spatialLayer: 0 = low res, 1 = medium, 2 = high
   * - temporalLayer: 0 = low fps, 1 = medium, 2 = high
   *
   * USE CASE:
   * - Proctor viewing thumbnail grid → low layer
   * - Proctor enlarges one candidate → high layer
   */
  public async setPreferredLayers(
    consumerId: string,
    spatialLayer: number,
    temporalLayer?: number,
  ): Promise<void> {
    const consumer = this.getConsumer(consumerId);

    if (!consumer) {
      throw new Error(`Consumer not found: ${consumerId}`);
    }

    await consumer.setPreferredLayers({ spatialLayer, temporalLayer });

    logger.info(
      { consumerId, spatialLayer, temporalLayer },
      'Consumer preferred layers set',
    );
  }

  /**
   * Request key frame
   *
   * WHAT IS THIS?
   * Ask Producer to send a keyframe (I-frame).
   *
   * WHEN TO USE:
   * - Video looks corrupted
   * - After network issues
   * - After resuming Consumer
   */
  public async requestKeyFrame(consumerId: string): Promise<void> {
    const consumer = this.getConsumer(consumerId);

    if (!consumer) {
      throw new Error(`Consumer not found: ${consumerId}`);
    }

    await consumer.requestKeyFrame();

    logger.debug({ consumerId }, 'Key frame requested');
  }

  // ===========================================================================
  // Consumer Access
  // ===========================================================================

  /**
   * Get Consumer by ID
   */
  public getConsumer(consumerId: string): Consumer | undefined {
    return this.consumers.get(consumerId)?.consumer;
  }

  /**
   * Get Consumer info by ID
   */
  public getConsumerInfo(consumerId: string): ConsumerInfo | undefined {
    return this.consumers.get(consumerId);
  }

  /**
   * Get all Consumers for a peer
   */
  public getConsumersForPeer(peerId: string): ConsumerInfo[] {
    return Array.from(this.consumers.values()).filter(
      (info) => info.appData.peerId === peerId,
    );
  }

  /**
   * Get all Consumers of a specific Producer
   */
  public getConsumersOfProducer(producerId: string): ConsumerInfo[] {
    return Array.from(this.consumers.values()).filter(
      (info) => info.appData.producerId === producerId,
    );
  }

  /**
   * Check if a peer is already consuming a producer
   */
  public isConsuming(peerId: string, producerId: string): boolean {
    for (const info of this.consumers.values()) {
      if (
        info.appData.peerId === peerId &&
        info.appData.producerId === producerId
      ) {
        return true;
      }
    }
    return false;
  }

  // ===========================================================================
  // Consumer Cleanup
  // ===========================================================================

  /**
   * Close a Consumer
   */
  public closeConsumer(consumerId: string): void {
    const consumerInfo = this.consumers.get(consumerId);

    if (!consumerInfo) {
      logger.warn({ consumerId }, 'Consumer not found for closing');
      return;
    }

    logger.info(
      {
        consumerId,
        peerId: consumerInfo.appData.peerId,
        producerId: consumerInfo.appData.producerId,
      },
      'Closing consumer',
    );

    consumerInfo.consumer.close();
    this.consumers.delete(consumerId);
  }

  /**
   * Close all Consumers for a peer
   *
   * WHEN TO CALL:
   * - Proctor disconnects
   * - Proctor leaves room
   */
  public closeConsumersForPeer(peerId: string): void {
    const peerConsumers = this.getConsumersForPeer(peerId);

    for (const consumerInfo of peerConsumers) {
      this.closeConsumer(consumerInfo.consumer.id);
    }

    logger.info(
      { peerId, count: peerConsumers.length },
      'Closed all consumers for peer',
    );
  }

  /**
   * Close all Consumers of a Producer
   *
   * WHEN TO CALL:
   * - Producer closes (this happens automatically via 'producerclose' event)
   * - Candidate leaves room
   */
  public closeConsumersOfProducer(producerId: string): void {
    const producerConsumers = this.getConsumersOfProducer(producerId);

    for (const consumerInfo of producerConsumers) {
      this.closeConsumer(consumerInfo.consumer.id);
    }

    logger.info(
      { producerId, count: producerConsumers.length },
      'Closed all consumers of producer',
    );
  }

  // ===========================================================================
  // Stats & Monitoring
  // ===========================================================================

  /**
   * Get Consumer stats from mediasoup
   */
  public async getConsumerStats(consumerId: string): Promise<unknown> {
    const consumer = this.getConsumer(consumerId);
    if (!consumer) {
      return null;
    }
    return consumer.getStats();
  }

  /**
   * Get all Consumers info (for monitoring)
   */
  public getAllConsumersInfo(): Array<{
    id: string;
    kind: MediaKind;
    peerId: string;
    producerId: string;
    trackType: string;
    paused: boolean;
    createdAt: number;
  }> {
    return Array.from(this.consumers.values()).map((info) => ({
      id: info.consumer.id,
      kind: info.consumer.kind,
      peerId: info.appData.peerId,
      producerId: info.appData.producerId,
      trackType: info.appData.trackType,
      paused: info.consumer.paused,
      createdAt: info.createdAt,
    }));
  }

  /**
   * Get Consumer count
   */
  public getConsumerCount(): number {
    return this.consumers.size;
  }
}
