/**
 * mediasoup Signaling Service
 *
 * Handles mediasoup-specific signaling messages.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SIGNALING FLOW FOR mediasoup
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When a client joins a room and wants to send/receive media:
 *
 * 1. GET RTP CAPABILITIES
 *    Client → Server: "What codecs do you support?"
 *    Server → Client: Router RTP capabilities
 *
 * 2. CREATE TRANSPORTS
 *    Client → Server: "Create a send transport"
 *    Server → Client: Transport parameters (id, ice, dtls)
 *    Client → Server: "Create a receive transport"
 *    Server → Client: Transport parameters
 *
 * 3. PRODUCE (send media)
 *    Client starts producing → 'connect' event → 'produce' event
 *    Client → Server: "Connect transport" (dtlsParameters)
 *    Server → Client: "OK"
 *    Client → Server: "Produce" (rtpParameters)
 *    Server → Client: "OK" (producerId)
 *
 * 4. NOTIFY OTHER CLIENTS
 *    Server → Other clients: "New producer available!"
 *
 * 5. CONSUME (receive media)
 *    Client → Server: "I want to consume producer X"
 *    Server → Client: Consumer parameters (id, rtpParameters)
 *    Client → Server: "Resume consumer"
 *    Server → Client: "OK" - media flowing!
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type { RtpCapabilities, RtpParameters, MediaKind, DtlsParameters } from 'mediasoup/types';
import type {
  RouterService,
  TransportService,
  ProducerService,
  ConsumerService,
} from '../mediasoup';
import type {
  TransportDirectionType,
  TransportOptions,
  ConsumerOptions,
  ProducerAppData,
} from '../mediasoup/types';
import { logger } from '../common/logger';

/**
 * New producer event callback type
 */
type NewProducerCallback = (event: {
  roomId: string;
  peerId: string;
  producerId: string;
  kind: string;
  appData?: Record<string, unknown>;
}) => void;

@Injectable()
export class MediasoupSignalingService {
  private newProducerCallbacks: NewProducerCallback[] = [];

  constructor(
    private readonly routerService: RouterService,
    private readonly transportService: TransportService,
    private readonly producerService: ProducerService,
    private readonly consumerService: ConsumerService,
  ) {
    // Register internal callback to forward new producer events
    this.producerService.onNewProducer((event) => {
      // Get producer info to extract roomId
      const producerInfo = this.producerService.getProducerInfo(event.producerId);
      const roomId = producerInfo?.appData?.roomId || '';

      const formattedEvent = {
        roomId,
        peerId: event.peerId,
        producerId: event.producerId,
        kind: event.kind,
        appData: {
          trackType: event.trackType,
        },
      };
      this.newProducerCallbacks.forEach((cb) => cb(formattedEvent));
    });
  }

  // ===========================================================================
  // RTP Capabilities
  // ===========================================================================

  /**
   * Get Router RTP Capabilities for a room
   *
   * WHEN: Client joins room and needs to create Device
   *
   * @param roomId - Room ID
   * @returns RTP capabilities object
   */
  async getRtpCapabilities(roomId: string): Promise<RtpCapabilities> {
    logger.debug({ roomId }, 'Getting RTP capabilities');

    const rtpCapabilities = await this.routerService.getRtpCapabilities(roomId);

    if (!rtpCapabilities) {
      throw new Error(`No RTP capabilities for room: ${roomId}`);
    }

    return rtpCapabilities;
  }

  // ===========================================================================
  // Transport Management
  // ===========================================================================

  /**
   * Create a WebRTC Transport
   *
   * WHEN: Client needs to send (produce) or receive (consume) media
   *
   * @param roomId - Room ID
   * @param peerId - Peer ID
   * @param direction - 'send' or 'recv'
   * @returns Transport options for client
   */
  async createTransport(
    roomId: string,
    peerId: string,
    direction: TransportDirectionType,
  ): Promise<TransportOptions> {
    logger.info({ roomId, peerId, direction }, 'Creating transport');

    const transportOptions = await this.transportService.createWebRtcTransport(
      roomId,
      peerId,
      direction,
    );

    return transportOptions;
  }

  /**
   * Connect a Transport (DTLS handshake)
   *
   * WHEN: Client's transport fires 'connect' event (first produce/consume)
   *
   * @param roomId - Room ID (for logging)
   * @param peerId - Peer ID (for logging)
   * @param transportId - Transport ID
   * @param dtlsParameters - DTLS parameters from client
   */
  async connectTransport(
    roomId: string,
    peerId: string,
    transportId: string,
    dtlsParameters: unknown,
  ): Promise<void> {
    logger.debug({ roomId, peerId, transportId }, 'Connecting transport');

    await this.transportService.connectTransport(
      transportId,
      dtlsParameters as DtlsParameters,
    );
  }

  // ===========================================================================
  // Producer Management
  // ===========================================================================

  /**
   * Create a Producer (start sending media)
   *
   * WHEN: Client calls transport.produce() with a media track
   *
   * @param roomId - Room ID
   * @param peerId - Peer ID
   * @param transportId - Send transport ID
   * @param kind - 'audio' or 'video'
   * @param rtpParameters - RTP parameters from client
   * @param appData - Application data (trackType, etc.)
   * @returns Producer ID
   */
  async produce(
    roomId: string,
    peerId: string,
    transportId: string,
    kind: 'audio' | 'video',
    rtpParameters: unknown,
    appData?: Record<string, unknown>,
  ): Promise<string> {
    logger.info(
      {
        roomId,
        peerId,
        transportId,
        kind,
        trackType: appData?.trackType,
      },
      'Producing media',
    );

    const producerId = await this.producerService.produce(
      transportId,
      kind as MediaKind,
      rtpParameters as RtpParameters,
      {
        trackType: (appData?.trackType as ProducerAppData['trackType']) || (kind === 'audio' ? 'audio' : 'webcam'),
        peerId,
        roomId,
      },
    );

    return producerId;
  }

  /**
   * Close a Producer
   *
   * WHEN: Client stops sending a track
   *
   * @param roomId - Room ID (for logging)
   * @param peerId - Peer ID (for logging)
   * @param producerId - Producer to close
   */
  closeProducer(roomId: string, peerId: string, producerId: string): void {
    logger.info({ roomId, peerId, producerId }, 'Closing producer');
    this.producerService.closeProducer(producerId);
  }

  /**
   * Pause a Producer
   *
   * WHEN: User mutes mic or disables camera
   */
  async pauseProducer(roomId: string, peerId: string, producerId: string): Promise<void> {
    logger.debug({ roomId, peerId, producerId }, 'Pausing producer');
    await this.producerService.pauseProducer(producerId);
  }

  /**
   * Resume a Producer
   *
   * WHEN: User unmutes mic or enables camera
   */
  async resumeProducer(roomId: string, peerId: string, producerId: string): Promise<void> {
    logger.debug({ roomId, peerId, producerId }, 'Resuming producer');
    await this.producerService.resumeProducer(producerId);
  }

  // ===========================================================================
  // Consumer Management
  // ===========================================================================

  /**
   * Create a Consumer (start receiving media)
   *
   * WHEN: Client wants to view another participant's media
   *
   * @param roomId - Room ID
   * @param consumerPeerId - Peer who wants to consume
   * @param producerId - Producer to consume
   * @param rtpCapabilities - Consumer's RTP capabilities
   * @returns Consumer options for client
   */
  async consume(
    roomId: string,
    consumerPeerId: string,
    producerId: string,
    rtpCapabilities: unknown,
  ): Promise<ConsumerOptions> {
    logger.info(
      {
        roomId,
        consumerPeerId,
        producerId,
      },
      'Creating consumer',
    );

    // Get or create recv transport for this peer
    const recvTransport = this.transportService.getTransportForPeer(
      consumerPeerId,
      'recv',
    );

    if (!recvTransport) {
      throw new Error(`No recv transport found for peer: ${consumerPeerId}`);
    }

    const consumerOptions = await this.consumerService.consume(
      roomId,
      consumerPeerId,
      recvTransport.id,
      producerId,
      rtpCapabilities as RtpCapabilities,
    );

    return consumerOptions;
  }

  /**
   * Resume a Consumer
   *
   * WHEN: Client has set up local consumer and is ready to receive
   *
   * @param roomId - Room ID (for logging)
   * @param peerId - Peer ID (for logging)
   * @param consumerId - Consumer to resume
   */
  async resumeConsumer(roomId: string, peerId: string, consumerId: string): Promise<void> {
    logger.debug({ roomId, peerId, consumerId }, 'Resuming consumer');
    await this.consumerService.resumeConsumer(consumerId);
  }

  /**
   * Pause a Consumer
   *
   * WHEN: Proctor scrolls candidate off screen (bandwidth optimization)
   */
  async pauseConsumer(roomId: string, peerId: string, consumerId: string): Promise<void> {
    logger.debug({ roomId, peerId, consumerId }, 'Pausing consumer');
    await this.consumerService.pauseConsumer(consumerId);
  }

  /**
   * Close a Consumer
   *
   * WHEN: Client no longer wants to receive this media
   */
  closeConsumer(roomId: string, peerId: string, consumerId: string): void {
    logger.debug({ roomId, peerId, consumerId }, 'Closing consumer');
    this.consumerService.closeConsumer(consumerId);
  }

  // ===========================================================================
  // Room/Peer Lifecycle
  // ===========================================================================

  /**
   * Get all producers in a room (excluding a specific peer's producers)
   *
   * WHEN: New participant joins and needs to know what to consume
   *
   * @param roomId - Room ID
   * @param excludePeerId - Peer ID to exclude (self)
   * @returns List of producer info
   */
  getProducersInRoom(
    roomId: string,
    excludePeerId?: string,
  ): Array<{
    producerId: string;
    producerPeerId: string;
    kind: string;
    appData?: Record<string, unknown>;
  }> {
    const producers = this.producerService.getProducersInRoom(roomId);

    return producers
      .filter((info) => info.appData.peerId !== excludePeerId)
      .map((info) => ({
        producerId: info.producer.id,
        producerPeerId: info.appData.peerId,
        kind: info.producer.kind,
        appData: {
          trackType: info.appData.trackType,
        },
      }));
  }

  /**
   * Cleanup when peer disconnects
   *
   * @param roomId - Room ID
   * @param peerId - Disconnecting peer ID
   */
  cleanupPeer(roomId: string, peerId: string): void {
    logger.info({ roomId, peerId }, 'Cleaning up peer');

    // Close all producers (this also closes consumers of these producers)
    this.producerService.closeProducersForPeer(peerId);

    // Close all consumers
    this.consumerService.closeConsumersForPeer(peerId);

    // Close all transports
    this.transportService.closeTransportsForPeer(peerId);
  }

  /**
   * Cleanup when room is closed
   *
   * @param roomId - Room being closed
   */
  cleanupRoom(roomId: string): void {
    logger.info({ roomId }, 'Cleaning up room');

    // Close all transports in room (cascades to producers/consumers)
    this.transportService.closeTransportsInRoom(roomId);

    // Close router
    this.routerService.closeRouter(roomId);
  }

  // ===========================================================================
  // Callbacks for signaling
  // ===========================================================================

  /**
   * Register callback for new producer events
   * Used by signaling gateway to notify other clients
   */
  onNewProducer(callback: NewProducerCallback): void {
    this.newProducerCallbacks.push(callback);
  }
}
