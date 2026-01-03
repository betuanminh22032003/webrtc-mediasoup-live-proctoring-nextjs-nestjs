/**
 * User Roles in the Proctoring System
 *
 * WHY these roles?
 * - CANDIDATE: The exam taker who must share media streams for monitoring
 * - PROCTOR: The supervisor who watches multiple candidates simultaneously
 * - ADMIN: System administrator for configuration (future extension)
 *
 * TRADE-OFF: Simple role model vs RBAC
 * - We chose simple enum roles for clarity and interview defensibility
 * - RBAC would add complexity without clear benefit for this domain
 */
export enum UserRole {
  CANDIDATE = 'candidate',
  PROCTOR = 'proctor',
  ADMIN = 'admin',
}

/**
 * Room States - Lifecycle of a proctoring session
 *
 * WHY explicit states?
 * - Clear audit trail for exam integrity
 * - Enables state machine transitions with validation
 * - Supports graceful error recovery
 */
export enum RoomState {
  /** Room created but exam not started */
  WAITING = 'waiting',
  /** Exam in progress, candidates being monitored */
  ACTIVE = 'active',
  /** Exam paused (e.g., technical issues) */
  PAUSED = 'paused',
  /** Exam completed normally */
  ENDED = 'ended',
  /** Room invalidated due to violations */
  INVALIDATED = 'invalidated',
}

/**
 * Connection States - WebRTC peer connection lifecycle
 *
 * WHY track these explicitly?
 * - WebRTC connection states are critical for proctoring
 * - Must differentiate between intentional and accidental disconnects
 * - Enables automatic reconnection strategies
 */
export enum ConnectionState {
  /** Initial state, not connected */
  DISCONNECTED = 'disconnected',
  /** Signaling in progress */
  CONNECTING = 'connecting',
  /** WebRTC connected and stable */
  CONNECTED = 'connected',
  /** Connection temporarily interrupted, attempting recovery */
  RECONNECTING = 'reconnecting',
  /** Connection failed after retry attempts */
  FAILED = 'failed',
}

/**
 * Media Track Types
 *
 * WHY separate track types?
 * - Proctoring requires BOTH webcam AND screen
 * - Different quality/priority settings per track type
 * - Enables selective simulcast configuration
 */
export enum MediaTrackType {
  /** Webcam video track - required for candidate identity */
  WEBCAM = 'webcam',
  /** Screen share track - required for exam content monitoring */
  SCREEN = 'screen',
  /** Microphone audio track - for audio proctoring */
  AUDIO = 'audio',
}

/**
 * Proctoring Event Types - Domain events for audit trail
 *
 * WHY explicit event types?
 * - Legal requirement for exam integrity evidence
 * - Enables pattern detection (e.g., repeated camera mutes)
 * - Supports post-exam review and dispute resolution
 */
export enum ProctoringEventType {
  // Session events
  SESSION_STARTED = 'session.started',
  SESSION_ENDED = 'session.ended',
  SESSION_PAUSED = 'session.paused',
  SESSION_RESUMED = 'session.resumed',

  // Connection events
  CONNECTION_ESTABLISHED = 'connection.established',
  CONNECTION_LOST = 'connection.lost',
  CONNECTION_RECOVERED = 'connection.recovered',
  ICE_RESTART_TRIGGERED = 'ice.restart.triggered',
  ICE_RESTART_COMPLETED = 'ice.restart.completed',

  // Media events - CRITICAL for proctoring
  WEBCAM_ENABLED = 'webcam.enabled',
  WEBCAM_DISABLED = 'webcam.disabled',
  WEBCAM_BLOCKED = 'webcam.blocked',
  SCREEN_SHARE_STARTED = 'screen.share.started',
  SCREEN_SHARE_STOPPED = 'screen.share.stopped',
  AUDIO_ENABLED = 'audio.enabled',
  AUDIO_DISABLED = 'audio.disabled',

  // Quality events
  QUALITY_DEGRADED = 'quality.degraded',
  QUALITY_RECOVERED = 'quality.recovered',
  PACKET_LOSS_HIGH = 'packet.loss.high',
  BANDWIDTH_LIMITED = 'bandwidth.limited',

  // Violation events
  VIOLATION_DETECTED = 'violation.detected',
  VIOLATION_ACKNOWLEDGED = 'violation.acknowledged',
  MULTIPLE_FACES_DETECTED = 'multiple.faces.detected',
  NO_FACE_DETECTED = 'no.face.detected',
  TAB_SWITCH_DETECTED = 'tab.switch.detected',
}

/**
 * Violation Severity Levels
 *
 * WHY severity levels?
 * - Not all violations are equal (camera glitch vs suspicious behavior)
 * - Enables automated escalation policies
 * - Supports proctor alert prioritization
 */
export enum ViolationSeverity {
  /** Informational - logged but no action required */
  INFO = 'info',
  /** Warning - proctor notified, exam continues */
  WARNING = 'warning',
  /** Critical - requires immediate proctor attention */
  CRITICAL = 'critical',
  /** Fatal - exam automatically invalidated */
  FATAL = 'fatal',
}

/**
 * Transport Direction for mediasoup
 *
 * WHY explicit direction?
 * - mediasoup requires separate transports for send/receive
 * - Prevents configuration errors
 * - Clear mental model for developers
 *
 * NOTE: Using 'recv' (not 'receive') to match mediasoup convention
 */
export enum TransportDirection {
  SEND = 'send',
  RECV = 'recv',
}

/**
 * Signal Message Types for WebSocket communication
 *
 * WHY typed messages?
 * - Type-safe signaling protocol
 * - Enables Zod validation on both client and server
 * - Self-documenting API contract
 */
export enum SignalMessageType {
  // Authentication
  AUTH_REQUEST = 'auth.request',
  AUTH_SUCCESS = 'auth.success',
  AUTH_FAILURE = 'auth.failure',

  // Room management
  ROOM_JOIN = 'room.join',
  ROOM_LEAVE = 'room.leave',
  ROOM_STATE = 'room.state',
  PARTICIPANT_JOINED = 'participant.joined',
  PARTICIPANT_LEFT = 'participant.left',

  // Pure WebRTC signaling (Phase 1)
  SDP_OFFER = 'sdp.offer',
  SDP_ANSWER = 'sdp.answer',
  ICE_CANDIDATE = 'ice.candidate',

  // mediasoup signaling (Phase 2+)
  /** Request router RTP capabilities */
  GET_RTP_CAPABILITIES = 'router.rtp.capabilities.get',
  /** Response with router RTP capabilities */
  RTP_CAPABILITIES = 'router.rtp.capabilities',
  /** Request to create a transport */
  CREATE_TRANSPORT = 'transport.create',
  /** Response with transport parameters */
  TRANSPORT_CREATED = 'transport.created',
  /** Request to connect a transport */
  CONNECT_TRANSPORT = 'transport.connect',
  /** Response confirming transport connected */
  TRANSPORT_CONNECTED = 'transport.connected',
  /** Request to produce media */
  PRODUCE = 'produce',
  /** Response with producer ID after produce */
  PRODUCED = 'produce.done',
  /** Notification of new producer in room */
  NEW_PRODUCER = 'producer.new',
  /** Notification of producer closed */
  PRODUCER_CLOSED = 'producer.closed',
  /** Request to pause a producer */
  PRODUCER_PAUSE = 'producer.pause',
  /** Notification that producer was paused */
  PRODUCER_PAUSED = 'producer.paused',
  /** Request to resume a producer */
  PRODUCER_RESUME = 'producer.resume',
  /** Notification that producer was resumed */
  PRODUCER_RESUMED = 'producer.resumed',
  /** Request to consume a producer */
  CONSUME = 'consume',
  /** Response with consumer parameters */
  CONSUMER_CREATED = 'consumer.created',
  /** Request to resume a consumer */
  CONSUMER_RESUME = 'consumer.resume',
  /** Response confirming consumer resumed */
  CONSUMER_RESUMED = 'consumer.resumed',
  /** Notification that consumer was paused */
  CONSUMER_PAUSED = 'consumer.paused',
  /** Notification that consumer was closed */
  CONSUMER_CLOSED = 'consumer.closed',
  /** Request list of producers in room */
  GET_PRODUCERS = 'producers.get',
  /** Response with list of producers */
  PRODUCERS_LIST = 'producers.list',

  // Media control
  MEDIA_TOGGLE = 'media.toggle',
  MEDIA_STATE = 'media.state',

  // Proctoring specific
  PROCTORING_EVENT = 'proctoring.event',
  VIOLATION_ALERT = 'violation.alert',

  // Health/Stats
  STATS_REQUEST = 'stats.request',
  STATS_RESPONSE = 'stats.response',
  PING = 'ping',
  PONG = 'pong',

  // Errors
  ERROR = 'error',
}

/**
 * Recording States
 *
 * WHY explicit recording states?
 * - Recording is evidence - state must be tracked meticulously
 * - Enables verification that evidence was captured
 * - Supports crash recovery
 */
export enum RecordingState {
  /** Not recording */
  IDLE = 'idle',
  /** Recording in progress */
  RECORDING = 'recording',
  /** Recording paused (exam paused) */
  PAUSED = 'paused',
  /** Recording stopped, processing */
  PROCESSING = 'processing',
  /** Recording complete and verified */
  COMPLETED = 'completed',
  /** Recording failed - CRITICAL */
  FAILED = 'failed',
}
