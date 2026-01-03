/**
 * WebSocket Signaling Gateway
 *
 * WHY WebSocket for signaling?
 * - Full-duplex communication (server can push to client)
 * - Low latency for real-time signaling
 * - Persistent connection for state tracking
 *
 * WHY NestJS WebSocket Gateway?
 * - Declarative message handling
 * - Built-in lifecycle hooks
 * - Integration with NestJS DI
 *
 * PHASE 1: Pure WebRTC signaling (SDP + ICE) ✓
 * PHASE 2: mediasoup SFU signaling (CURRENT)
 *
 * mediasoup Flow:
 * 1. Client joins room → gets RTP capabilities
 * 2. Client creates transports (send + recv)
 * 3. Client produces media (webcam, screen, audio)
 * 4. Other clients consume the producers
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import {
  SignalMessageType,
  UserRole,
  ConnectionState,
  SdpOfferSchema,
  SdpAnswerSchema,
  IceCandidateSchema,
  RoomJoinSchema,
} from '@proctoring/shared';
import type { TransportDirectionType } from '../mediasoup/types';
import { signalingLogger } from '../common/logger';
import { RoomService } from './room.service';
import { MediasoupSignalingService } from './mediasoup-signaling.service';

/**
 * Extended WebSocket with user metadata
 */
interface AuthenticatedSocket extends WebSocket {
  id: string;
  userId?: string;
  roomId?: string;
  role?: UserRole;
  isAlive: boolean;
  /** Client RTP capabilities (set after device loads) */
  rtpCapabilities?: unknown;
}

@WebSocketGateway({
  path: '/ws',
  // CORS handled at Fastify level
})
export class SignalingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private clients: Map<string, AuthenticatedSocket> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly roomService: RoomService,
    private readonly mediasoupSignaling: MediasoupSignalingService,
  ) {
    // Register callback for new producer events
    this.mediasoupSignaling.onNewProducer((event) => {
      this.handleNewProducerEvent(event);
    });
  }

  /**
   * Gateway initialization
   */
  afterInit(): void {
    signalingLogger.info('Signaling gateway initialized');

    // Setup heartbeat for connection health monitoring
    // WHY heartbeat? WebSocket connections can silently die
    const HEARTBEAT_INTERVAL_MS = 30000;
    this.heartbeatInterval = setInterval(() => {
      this.clients.forEach((client) => {
        if (!client.isAlive) {
          signalingLogger.warn({ clientId: client.id }, 'Client heartbeat timeout, terminating');
          client.terminate();
          return;
        }
        client.isAlive = false;
        client.ping();
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(client: AuthenticatedSocket): void {
    // Assign unique ID to connection
    client.id = uuidv4();
    client.isAlive = true;

    // Handle pong responses for heartbeat
    client.on('pong', () => {
      client.isAlive = true;
    });

    this.clients.set(client.id, client);

    signalingLogger.info(
      { clientId: client.id, totalClients: this.clients.size },
      'Client connected'
    );

    // Send connection acknowledgment
    this.sendToClient(client, {
      type: 'connection.ack',
      payload: { clientId: client.id },
      timestamp: Date.now(),
    });
  }

  /**
   * Handle WebSocket disconnection
   */
  handleDisconnect(client: AuthenticatedSocket): void {
    const { id, userId, roomId } = client;

    signalingLogger.info(
      { clientId: id, userId, roomId },
      'Client disconnected'
    );

    // Remove from room if joined
    if (roomId && userId) {
      // Cleanup mediasoup resources (transports, producers, consumers)
      this.mediasoupSignaling.cleanupPeer(roomId, userId);

      this.roomService.removeParticipant(roomId, userId);

      // Notify other participants
      this.broadcastToRoom(roomId, {
        type: SignalMessageType.PARTICIPANT_LEFT,
        payload: { userId, roomId },
        timestamp: Date.now(),
      }, client.id);
    }

    this.clients.delete(id);
  }

  /**
   * Handle room join request
   *
   * PHASE 1: Simple room join for 1-1 connection demo
   */
  @SubscribeMessage(SignalMessageType.ROOM_JOIN)
  handleRoomJoin(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: AuthenticatedSocket
  ): void {
    const parseResult = RoomJoinSchema.safeParse(data);

    if (!parseResult.success) {
      this.sendError(client, 'INVALID_MESSAGE', 'Invalid room join payload');
      return;
    }

    const { roomId, user } = parseResult.data.payload;

    // Create room if doesn't exist
    if (!this.roomService.roomExists(roomId)) {
      this.roomService.createRoom(roomId, {
        id: roomId,
        name: `Room ${roomId}`,
        maxParticipants: 10,
        requireWebcam: true,
        requireScreenShare: true,
        enableAudio: true,
        enableRecording: false,
      });
    }

    // Add participant to room
    const participant = this.roomService.addParticipant(roomId, {
      user,
      roomId,
      connectionState: ConnectionState.CONNECTING,
      joinedAt: Date.now(),
      activeTracks: [],
      isHighlighted: false,
    });

    if (!participant) {
      this.sendError(client, 'ROOM_FULL', 'Room has reached maximum capacity');
      return;
    }

    // Update client metadata
    client.userId = user.id;
    client.roomId = roomId;
    client.role = user.role;

    signalingLogger.info(
      { userId: user.id, roomId, role: user.role },
      'User joined room'
    );

    // Send room state to joining user
    const roomState = this.roomService.getRoomState(roomId);
    this.sendToClient(client, {
      type: SignalMessageType.ROOM_STATE,
      payload: roomState,
      timestamp: Date.now(),
    });

    // Notify other participants
    this.broadcastToRoom(roomId, {
      type: SignalMessageType.PARTICIPANT_JOINED,
      payload: { participant },
      timestamp: Date.now(),
    }, client.id);
  }

  /**
   * Handle SDP Offer (Phase 1 - Pure WebRTC)
   *
   * WHY relay SDP through server?
   * - No direct communication between peers initially
   * - Server can validate and log signaling
   * - Required for any WebRTC connection setup
   */
  @SubscribeMessage(SignalMessageType.SDP_OFFER)
  handleSdpOffer(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: AuthenticatedSocket
  ): void {
    const parseResult = SdpOfferSchema.safeParse(data);

    if (!parseResult.success) {
      this.sendError(client, 'INVALID_SDP', 'Invalid SDP offer');
      return;
    }

    const { sdp, targetUserId } = parseResult.data.payload;

    signalingLogger.debug(
      { from: client.userId, to: targetUserId, sdpLength: sdp.length },
      'Relaying SDP offer'
    );

    // In Phase 1, relay to specific user or broadcast to room
    if (targetUserId) {
      const targetClient = this.findClientByUserId(targetUserId);
      if (targetClient) {
        this.sendToClient(targetClient, {
          type: SignalMessageType.SDP_OFFER,
          payload: { sdp, fromUserId: client.userId },
          timestamp: Date.now(),
        });
      }
    } else if (client.roomId) {
      // Broadcast to all others in room
      this.broadcastToRoom(client.roomId, {
        type: SignalMessageType.SDP_OFFER,
        payload: { sdp, fromUserId: client.userId },
        timestamp: Date.now(),
      }, client.id);
    }
  }

  /**
   * Handle SDP Answer (Phase 1 - Pure WebRTC)
   */
  @SubscribeMessage(SignalMessageType.SDP_ANSWER)
  handleSdpAnswer(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: AuthenticatedSocket
  ): void {
    const parseResult = SdpAnswerSchema.safeParse(data);

    if (!parseResult.success) {
      this.sendError(client, 'INVALID_SDP', 'Invalid SDP answer');
      return;
    }

    const { sdp, targetUserId } = parseResult.data.payload;

    signalingLogger.debug(
      { from: client.userId, to: targetUserId },
      'Relaying SDP answer'
    );

    if (targetUserId) {
      const targetClient = this.findClientByUserId(targetUserId);
      if (targetClient) {
        this.sendToClient(targetClient, {
          type: SignalMessageType.SDP_ANSWER,
          payload: { sdp, fromUserId: client.userId },
          timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Handle ICE Candidate exchange
   *
   * WHY trickle ICE?
   * - Faster connection establishment
   * - Candidates sent as discovered, not batched
   * - Critical for real-time applications
   */
  @SubscribeMessage(SignalMessageType.ICE_CANDIDATE)
  handleIceCandidate(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: AuthenticatedSocket
  ): void {
    const parseResult = IceCandidateSchema.safeParse(data);

    if (!parseResult.success) {
      this.sendError(client, 'INVALID_ICE', 'Invalid ICE candidate');
      return;
    }

    const { candidate, sdpMid, sdpMLineIndex, targetUserId } = parseResult.data.payload;

    signalingLogger.trace(
      { from: client.userId, to: targetUserId, sdpMid },
      'Relaying ICE candidate'
    );

    if (targetUserId) {
      const targetClient = this.findClientByUserId(targetUserId);
      if (targetClient) {
        this.sendToClient(targetClient, {
          type: SignalMessageType.ICE_CANDIDATE,
          payload: {
            candidate,
            sdpMid,
            sdpMLineIndex,
            fromUserId: client.userId,
          },
          timestamp: Date.now(),
        });
      }
    } else if (client.roomId) {
      // Broadcast to all others in room
      this.broadcastToRoom(client.roomId, {
        type: SignalMessageType.ICE_CANDIDATE,
        payload: {
          candidate,
          sdpMid,
          sdpMLineIndex,
          fromUserId: client.userId,
        },
        timestamp: Date.now(),
      }, client.id);
    }
  }

  /**
   * Handle ping for latency measurement
   */
  @SubscribeMessage(SignalMessageType.PING)
  handlePing(
    @ConnectedSocket() client: AuthenticatedSocket
  ): void {
    this.sendToClient(client, {
      type: SignalMessageType.PONG,
      payload: {},
      timestamp: Date.now(),
    });
  }

  // ============================================================================
  // PHASE 2: mediasoup SFU Handlers
  // ============================================================================

  /**
   * Handle Get RTP Capabilities request
   *
   * WHY RTP Capabilities?
   * - Client needs to know what codecs the router supports
   * - Required before creating Device and transports
   * - Used by mediasoup-client to configure its internal state
   *
   * Flow:
   * 1. Client joins room
   * 2. Client requests RTP capabilities
   * 3. Client uses capabilities to load mediasoup Device
   * 4. Client can now create transports
   */
  @SubscribeMessage(SignalMessageType.GET_RTP_CAPABILITIES)
  async handleGetRtpCapabilities(
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    try {
      const rtpCapabilities = await this.mediasoupSignaling.getRtpCapabilities(roomId);

      this.sendToClient(client, {
        type: SignalMessageType.RTP_CAPABILITIES,
        payload: { rtpCapabilities },
        timestamp: Date.now(),
      });

      signalingLogger.debug({ userId, roomId }, 'Sent RTP capabilities');
    } catch (error) {
      signalingLogger.error({ error, userId, roomId }, 'Failed to get RTP capabilities');
      this.sendError(client, 'RTP_CAPABILITIES_FAILED', 'Failed to get RTP capabilities');
    }
  }

  /**
   * Handle Create Transport request
   *
   * WHY separate send/recv transports?
   * - mediasoup uses separate transports for upload vs download
   * - This allows for better traffic management and optimization
   * - Server can apply different policies per direction
   *
   * Transport types:
   * - "send": Client → SFU (for producing)
   * - "recv": SFU → Client (for consuming)
   */
  @SubscribeMessage(SignalMessageType.CREATE_TRANSPORT)
  async handleCreateTransport(
    @MessageBody() data: { payload: { direction: string } },
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;
    const direction = data?.payload?.direction;

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    if (!direction || !['send', 'recv'].includes(direction)) {
      this.sendError(client, 'INVALID_DIRECTION', 'Direction must be "send" or "recv"');
      return;
    }

    try {
      const transportParams = await this.mediasoupSignaling.createTransport(
        roomId,
        userId,
        direction as TransportDirectionType
      );

      this.sendToClient(client, {
        type: SignalMessageType.TRANSPORT_CREATED,
        payload: {
          direction,
          ...transportParams,
        },
        timestamp: Date.now(),
      });

      signalingLogger.info({ userId, roomId, direction }, 'Transport created');
    } catch (error) {
      signalingLogger.error({ error, userId, roomId, direction }, 'Failed to create transport');
      this.sendError(client, 'TRANSPORT_CREATE_FAILED', 'Failed to create transport');
    }
  }

  /**
   * Handle Connect Transport request
   *
   * WHY DTLS parameters?
   * - DTLS (Datagram TLS) secures the media stream
   * - Client generates DTLS parameters during ICE
   * - Server needs these to complete the secure connection
   *
   * This completes the transport setup before producing/consuming
   */
  @SubscribeMessage(SignalMessageType.CONNECT_TRANSPORT)
  async handleConnectTransport(
    @MessageBody() data: {
      payload: {
        transportId: string;
        dtlsParameters: unknown;
      };
    },
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;
    const { transportId, dtlsParameters } = data?.payload || {};

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    if (!transportId || !dtlsParameters) {
      this.sendError(client, 'INVALID_PARAMS', 'Missing transportId or dtlsParameters');
      return;
    }

    try {
      await this.mediasoupSignaling.connectTransport(
        roomId,
        userId,
        transportId,
        dtlsParameters
      );

      this.sendToClient(client, {
        type: SignalMessageType.TRANSPORT_CONNECTED,
        payload: { transportId },
        timestamp: Date.now(),
      });

      signalingLogger.debug({ userId, roomId, transportId }, 'Transport connected');
    } catch (error) {
      signalingLogger.error({ error, userId, roomId, transportId }, 'Failed to connect transport');
      this.sendError(client, 'TRANSPORT_CONNECT_FAILED', 'Failed to connect transport');
    }
  }

  /**
   * Handle Produce request (Client wants to send media)
   *
   * WHY produce?
   * - Client sends webcam/screen/audio to SFU
   * - SFU creates a Producer to receive the stream
   * - Producer can then be consumed by other clients
   *
   * RTP Parameters:
   * - Codec settings (e.g., VP8, H.264, Opus)
   * - Encoding settings (bitrate, resolution)
   * - SSRC (synchronization source) info
   */
  @SubscribeMessage(SignalMessageType.PRODUCE)
  async handleProduce(
    @MessageBody() data: {
      payload: {
        transportId: string;
        kind: 'audio' | 'video';
        rtpParameters: unknown;
        appData?: Record<string, unknown>;
      };
    },
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;
    const { transportId, kind, rtpParameters, appData } = data?.payload || {};

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    if (!transportId || !kind || !rtpParameters) {
      this.sendError(client, 'INVALID_PARAMS', 'Missing transportId, kind, or rtpParameters');
      return;
    }

    try {
      const producerId = await this.mediasoupSignaling.produce(
        roomId,
        userId,
        transportId,
        kind,
        rtpParameters,
        appData
      );

      this.sendToClient(client, {
        type: SignalMessageType.PRODUCED,
        payload: { producerId },
        timestamp: Date.now(),
      });

      signalingLogger.info(
        { userId, roomId, producerId, kind, appData },
        'Producer created'
      );

      // Note: Other clients are notified via onNewProducer callback
    } catch (error) {
      signalingLogger.error({ error, userId, roomId, kind }, 'Failed to produce');
      this.sendError(client, 'PRODUCE_FAILED', 'Failed to create producer');
    }
  }

  /**
   * Handle Consume request (Client wants to receive media)
   *
   * WHY consume?
   * - Client wants to receive another user's media
   * - SFU creates a Consumer to send the stream
   * - One Consumer per client per Producer
   *
   * RTP Capabilities check:
   * - Server checks if client can decode the codec
   * - If not, consume fails gracefully
   */
  @SubscribeMessage(SignalMessageType.CONSUME)
  async handleConsume(
    @MessageBody() data: {
      payload: {
        producerId: string;
        rtpCapabilities: unknown;
      };
    },
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;
    const { producerId, rtpCapabilities } = data?.payload || {};

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    if (!producerId || !rtpCapabilities) {
      this.sendError(client, 'INVALID_PARAMS', 'Missing producerId or rtpCapabilities');
      return;
    }

    try {
      const consumerParams = await this.mediasoupSignaling.consume(
        roomId,
        userId,
        producerId,
        rtpCapabilities
      );

      this.sendToClient(client, {
        type: SignalMessageType.CONSUMER_CREATED,
        payload: consumerParams,
        timestamp: Date.now(),
      });

      signalingLogger.info(
        { userId, roomId, producerId, consumerId: consumerParams.id },
        'Consumer created'
      );
    } catch (error) {
      signalingLogger.error({ error, userId, roomId, producerId }, 'Failed to consume');
      this.sendError(client, 'CONSUME_FAILED', 'Failed to create consumer');
    }
  }

  /**
   * Handle Consumer Resume request
   *
   * WHY resume?
   * - Consumers are created in paused state
   * - Client must explicitly resume after setting up the track
   * - This prevents media loss during setup
   */
  @SubscribeMessage(SignalMessageType.CONSUMER_RESUME)
  async handleConsumerResume(
    @MessageBody() data: {
      payload: {
        consumerId: string;
      };
    },
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;
    const consumerId = data?.payload?.consumerId;

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    if (!consumerId) {
      this.sendError(client, 'INVALID_PARAMS', 'Missing consumerId');
      return;
    }

    try {
      await this.mediasoupSignaling.resumeConsumer(roomId, userId, consumerId);

      this.sendToClient(client, {
        type: SignalMessageType.CONSUMER_RESUMED,
        payload: { consumerId },
        timestamp: Date.now(),
      });

      signalingLogger.debug({ userId, roomId, consumerId }, 'Consumer resumed');
    } catch (error) {
      signalingLogger.error({ error, userId, roomId, consumerId }, 'Failed to resume consumer');
      this.sendError(client, 'CONSUMER_RESUME_FAILED', 'Failed to resume consumer');
    }
  }

  /**
   * Handle Producer Pause request
   */
  @SubscribeMessage(SignalMessageType.PRODUCER_PAUSE)
  async handleProducerPause(
    @MessageBody() data: {
      payload: {
        producerId: string;
      };
    },
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;
    const producerId = data?.payload?.producerId;

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    if (!producerId) {
      this.sendError(client, 'INVALID_PARAMS', 'Missing producerId');
      return;
    }

    try {
      await this.mediasoupSignaling.pauseProducer(roomId, userId, producerId);

      // Notify other participants that this producer is paused
      this.broadcastToRoom(roomId, {
        type: SignalMessageType.PRODUCER_PAUSED,
        payload: { producerId, userId },
        timestamp: Date.now(),
      }, client.id);

      signalingLogger.debug({ userId, roomId, producerId }, 'Producer paused');
    } catch (error) {
      signalingLogger.error({ error, userId, roomId, producerId }, 'Failed to pause producer');
      this.sendError(client, 'PRODUCER_PAUSE_FAILED', 'Failed to pause producer');
    }
  }

  /**
   * Handle Producer Resume request
   */
  @SubscribeMessage(SignalMessageType.PRODUCER_RESUME)
  async handleProducerResume(
    @MessageBody() data: {
      payload: {
        producerId: string;
      };
    },
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;
    const producerId = data?.payload?.producerId;

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    if (!producerId) {
      this.sendError(client, 'INVALID_PARAMS', 'Missing producerId');
      return;
    }

    try {
      await this.mediasoupSignaling.resumeProducer(roomId, userId, producerId);

      // Notify other participants that this producer is resumed
      this.broadcastToRoom(roomId, {
        type: SignalMessageType.PRODUCER_RESUMED,
        payload: { producerId, userId },
        timestamp: Date.now(),
      }, client.id);

      signalingLogger.debug({ userId, roomId, producerId }, 'Producer resumed');
    } catch (error) {
      signalingLogger.error({ error, userId, roomId, producerId }, 'Failed to resume producer');
      this.sendError(client, 'PRODUCER_RESUME_FAILED', 'Failed to resume producer');
    }
  }

  /**
   * Handle request for existing producers in room
   *
   * WHY list producers?
   * - When a new client joins, they need to know existing producers
   * - This allows late joiners to consume existing streams
   */
  @SubscribeMessage(SignalMessageType.GET_PRODUCERS)
  async handleGetProducers(
    @ConnectedSocket() client: AuthenticatedSocket
  ): Promise<void> {
    const { userId, roomId } = client;

    if (!roomId || !userId) {
      this.sendError(client, 'NOT_IN_ROOM', 'Must join a room first');
      return;
    }

    try {
      const producers = await this.mediasoupSignaling.getProducersInRoom(roomId, userId);

      this.sendToClient(client, {
        type: SignalMessageType.PRODUCERS_LIST,
        payload: { producers },
        timestamp: Date.now(),
      });

      signalingLogger.debug({ userId, roomId, count: producers.length }, 'Sent producers list');
    } catch (error) {
      signalingLogger.error({ error, userId, roomId }, 'Failed to get producers');
      this.sendError(client, 'GET_PRODUCERS_FAILED', 'Failed to get producers list');
    }
  }

  /**
   * Handle new producer event (internal callback)
   * Broadcasts to all clients in room when a new producer is created
   */
  private handleNewProducerEvent(event: {
    roomId: string;
    peerId: string;
    producerId: string;
    kind: string;
    appData?: Record<string, unknown>;
  }): void {
    const { roomId, peerId, producerId, kind, appData } = event;

    // Broadcast to all clients in the room except the producer
    this.clients.forEach((client) => {
      if (client.roomId === roomId && client.userId !== peerId) {
        this.sendToClient(client, {
          type: SignalMessageType.NEW_PRODUCER,
          payload: {
            producerId,
            producerPeerId: peerId,
            kind,
            appData,
          },
          timestamp: Date.now(),
        });
      }
    });

    signalingLogger.debug(
      { roomId, peerId, producerId, kind },
      'Broadcasted new producer to room'
    );
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Send message to a specific client
   */
  private sendToClient(client: WebSocket, message: unknown): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to client
   */
  private sendError(client: WebSocket, code: string, message: string): void {
    this.sendToClient(client, {
      type: SignalMessageType.ERROR,
      payload: { code, message },
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast message to all clients in a room
   */
  private broadcastToRoom(
    roomId: string,
    message: unknown,
    excludeClientId?: string
  ): void {
    this.clients.forEach((client) => {
      if (client.roomId === roomId && client.id !== excludeClientId) {
        this.sendToClient(client, message);
      }
    });
  }

  /**
   * Find client by user ID
   */
  private findClientByUserId(userId: string): AuthenticatedSocket | undefined {
    for (const client of this.clients.values()) {
      if (client.userId === userId) {
        return client;
      }
    }
    return undefined;
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }
}
