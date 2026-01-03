import { z } from 'zod';
import {
  UserRole,
  MediaTrackType,
  ConnectionState,
  RoomState,
  ProctoringEventType,
  ViolationSeverity,
  SignalMessageType,
  TransportDirection,
} from './enums';

// ============================================================================
// Base Schemas
// ============================================================================

/**
 * User identification schema
 * WHY Zod? Runtime validation is critical for WebSocket messages
 */
export const UserSchema = z.object({
  id: z.string().uuid(),
  role: z.nativeEnum(UserRole),
  displayName: z.string().min(1).max(100),
  /** Optional avatar for proctor dashboard */
  avatarUrl: z.string().url().optional(),
});
export type User = z.infer<typeof UserSchema>;

/**
 * Room configuration schema
 */
export const RoomConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  /** Maximum candidates allowed */
  maxParticipants: z.number().int().positive().max(100),
  /** Require webcam for candidates */
  requireWebcam: z.boolean().default(true),
  /** Require screen share for candidates */
  requireScreenShare: z.boolean().default(true),
  /** Enable audio monitoring */
  enableAudio: z.boolean().default(true),
  /** Enable server-side recording */
  enableRecording: z.boolean().default(true),
  /** Auto-end session after duration (ms) */
  maxDurationMs: z.number().int().positive().optional(),
});
export type RoomConfig = z.infer<typeof RoomConfigSchema>;

/**
 * Participant in a room
 */
export const ParticipantSchema = z.object({
  user: UserSchema,
  roomId: z.string().uuid(),
  connectionState: z.nativeEnum(ConnectionState),
  joinedAt: z.number(), // Unix timestamp
  /** Active media tracks */
  activeTracks: z.array(z.nativeEnum(MediaTrackType)),
  /** Is currently being watched by proctor */
  isHighlighted: z.boolean().default(false),
});
export type Participant = z.infer<typeof ParticipantSchema>;

// ============================================================================
// Signaling Message Schemas
// ============================================================================

/**
 * Base message schema - all messages extend this
 */
export const BaseMessageSchema = z.object({
  type: z.nativeEnum(SignalMessageType),
  timestamp: z.number(),
  /** Correlation ID for request/response tracking */
  correlationId: z.string().uuid().optional(),
});
export type BaseMessage = z.infer<typeof BaseMessageSchema>;

/**
 * Authentication request
 */
export const AuthRequestSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.AUTH_REQUEST),
  payload: z.object({
    token: z.string(),
    roomId: z.string().uuid(),
    role: z.nativeEnum(UserRole),
  }),
});
export type AuthRequest = z.infer<typeof AuthRequestSchema>;

/**
 * Room join request
 */
export const RoomJoinSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.ROOM_JOIN),
  payload: z.object({
    roomId: z.string().uuid(),
    user: UserSchema,
  }),
});
export type RoomJoin = z.infer<typeof RoomJoinSchema>;

/**
 * SDP Offer (Pure WebRTC - Phase 1)
 */
export const SdpOfferSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.SDP_OFFER),
  payload: z.object({
    sdp: z.string(),
    targetUserId: z.string().uuid().optional(),
  }),
});
export type SdpOffer = z.infer<typeof SdpOfferSchema>;

/**
 * SDP Answer (Pure WebRTC - Phase 1)
 */
export const SdpAnswerSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.SDP_ANSWER),
  payload: z.object({
    sdp: z.string(),
    targetUserId: z.string().uuid().optional(),
  }),
});
export type SdpAnswer = z.infer<typeof SdpAnswerSchema>;

/**
 * ICE Candidate
 */
export const IceCandidateSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.ICE_CANDIDATE),
  payload: z.object({
    candidate: z.string(),
    sdpMid: z.string().nullable(),
    sdpMLineIndex: z.number().nullable(),
    targetUserId: z.string().uuid().optional(),
  }),
});
export type IceCandidate = z.infer<typeof IceCandidateSchema>;

// ============================================================================
// mediasoup Signaling Schemas (Phase 2)
// ============================================================================

/**
 * Router RTP Capabilities response
 */
export const RouterRtpCapabilitiesSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.RTP_CAPABILITIES),
  payload: z.object({
    /** mediasoup router RTP capabilities - opaque to client */
    rtpCapabilities: z.record(z.unknown()),
  }),
});
export type RouterRtpCapabilities = z.infer<typeof RouterRtpCapabilitiesSchema>;

/**
 * Create Transport request
 */
export const CreateTransportRequestSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.CREATE_TRANSPORT),
  payload: z.object({
    direction: z.nativeEnum(TransportDirection),
    /** Force TCP (for restrictive networks) */
    forceTcp: z.boolean().default(false),
  }),
});
export type CreateTransportRequest = z.infer<typeof CreateTransportRequestSchema>;

/**
 * Create Transport response
 */
export const CreateTransportResponseSchema = z.object({
  id: z.string(),
  iceParameters: z.record(z.unknown()),
  iceCandidates: z.array(z.record(z.unknown())),
  dtlsParameters: z.record(z.unknown()),
  /** SCTP parameters for data channels */
  sctpParameters: z.record(z.unknown()).optional(),
});
export type CreateTransportResponse = z.infer<typeof CreateTransportResponseSchema>;

/**
 * Connect Transport request
 */
export const ConnectTransportSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.CONNECT_TRANSPORT),
  payload: z.object({
    transportId: z.string(),
    dtlsParameters: z.record(z.unknown()),
  }),
});
export type ConnectTransport = z.infer<typeof ConnectTransportSchema>;

/**
 * Produce request (send media)
 */
export const ProduceRequestSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.PRODUCE),
  payload: z.object({
    transportId: z.string(),
    kind: z.enum(['audio', 'video']),
    rtpParameters: z.record(z.unknown()),
    /** Custom app data - track type, etc */
    appData: z.object({
      trackType: z.nativeEnum(MediaTrackType),
    }),
  }),
});
export type ProduceRequest = z.infer<typeof ProduceRequestSchema>;

/**
 * Consume request (receive media)
 */
export const ConsumeRequestSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.CONSUME),
  payload: z.object({
    producerId: z.string(),
    rtpCapabilities: z.record(z.unknown()),
  }),
});
export type ConsumeRequest = z.infer<typeof ConsumeRequestSchema>;

// ============================================================================
// Proctoring Event Schemas
// ============================================================================

/**
 * Proctoring event for audit trail
 */
export const ProctoringEventSchema = z.object({
  id: z.string().uuid(),
  type: z.nativeEnum(ProctoringEventType),
  userId: z.string().uuid(),
  roomId: z.string().uuid(),
  timestamp: z.number(),
  severity: z.nativeEnum(ViolationSeverity),
  /** Event-specific metadata */
  metadata: z.record(z.unknown()).optional(),
  /** Human-readable description */
  description: z.string().optional(),
});
export type ProctoringEvent = z.infer<typeof ProctoringEventSchema>;

/**
 * Media state update
 */
export const MediaStateSchema = z.object({
  webcamEnabled: z.boolean(),
  screenShareEnabled: z.boolean(),
  audioEnabled: z.boolean(),
  /** Quality metrics */
  quality: z
    .object({
      /** Bits per second */
      bitrate: z.number().nonnegative(),
      /** Packet loss percentage (0-100) */
      packetLoss: z.number().min(0).max(100),
      /** Round-trip time in ms */
      rtt: z.number().nonnegative(),
      /** Frames per second */
      fps: z.number().nonnegative().optional(),
      /** Video resolution */
      resolution: z
        .object({
          width: z.number().positive(),
          height: z.number().positive(),
        })
        .optional(),
    })
    .optional(),
});
export type MediaState = z.infer<typeof MediaStateSchema>;

// ============================================================================
// Room State Schema
// ============================================================================

/**
 * Full room state (sent on join, updated incrementally)
 */
export const RoomStateSchema = z.object({
  config: RoomConfigSchema,
  state: z.nativeEnum(RoomState),
  participants: z.array(ParticipantSchema),
  /** When the exam started */
  startedAt: z.number().optional(),
  /** When the exam ended */
  endedAt: z.number().optional(),
});
export type RoomStateType = z.infer<typeof RoomStateSchema>;

// ============================================================================
// Error Schema
// ============================================================================

/**
 * Error response
 */
export const ErrorResponseSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.ERROR),
  payload: z.object({
    code: z.string(),
    message: z.string(),
    /** Original message type that caused error */
    originalType: z.nativeEnum(SignalMessageType).optional(),
    /** Additional error details */
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// ============================================================================
// Union of all message types for type-safe dispatch
// ============================================================================

export const SignalMessageSchema = z.discriminatedUnion('type', [
  AuthRequestSchema,
  RoomJoinSchema,
  SdpOfferSchema,
  SdpAnswerSchema,
  IceCandidateSchema,
  // Add more as needed
]);
export type SignalMessage = z.infer<typeof SignalMessageSchema>;
