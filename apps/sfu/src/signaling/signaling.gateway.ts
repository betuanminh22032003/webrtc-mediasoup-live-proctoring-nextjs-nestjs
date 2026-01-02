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
 * PHASE 1: Pure WebRTC signaling (SDP + ICE)
 * - No mediasoup yet
 * - 1-1 peer connections only
 * - Server acts as signaling relay
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
import { signalingLogger } from '../common/logger';
import { RoomService } from './room.service';

/**
 * Extended WebSocket with user metadata
 */
interface AuthenticatedSocket extends WebSocket {
  id: string;
  userId?: string;
  roomId?: string;
  role?: UserRole;
  isAlive: boolean;
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
    private readonly roomService: RoomService
  ) {}

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
