/**
 * Error Codes for the Proctoring System
 *
 * WHY structured error codes?
 * - Enables client-side error handling logic
 * - Supports i18n error messages
 * - Facilitates debugging and monitoring
 */

// ============================================================================
// Error Code Prefix Convention
// ============================================================================
// AUTH_*    - Authentication/Authorization errors
// ROOM_*    - Room management errors
// MEDIA_*   - Media stream errors
// SIGNAL_*  - Signaling errors
// RTC_*     - WebRTC specific errors
// SFU_*     - mediasoup SFU errors
// RECORD_*  - Recording errors
// SYSTEM_*  - System/infrastructure errors

export const ErrorCodes = {
  // ============================================================================
  // Authentication Errors (1xxx)
  // ============================================================================
  AUTH_INVALID_TOKEN: 'AUTH_1001',
  AUTH_TOKEN_EXPIRED: 'AUTH_1002',
  AUTH_INSUFFICIENT_PERMISSIONS: 'AUTH_1003',
  AUTH_USER_NOT_FOUND: 'AUTH_1004',
  AUTH_SESSION_EXPIRED: 'AUTH_1005',

  // ============================================================================
  // Room Errors (2xxx)
  // ============================================================================
  ROOM_NOT_FOUND: 'ROOM_2001',
  ROOM_FULL: 'ROOM_2002',
  ROOM_CLOSED: 'ROOM_2003',
  ROOM_ALREADY_JOINED: 'ROOM_2004',
  ROOM_NOT_JOINED: 'ROOM_2005',
  ROOM_INVALID_STATE: 'ROOM_2006',
  ROOM_CREATION_FAILED: 'ROOM_2007',

  // ============================================================================
  // Media Errors (3xxx)
  // ============================================================================
  MEDIA_PERMISSION_DENIED: 'MEDIA_3001',
  MEDIA_DEVICE_NOT_FOUND: 'MEDIA_3002',
  MEDIA_DEVICE_IN_USE: 'MEDIA_3003',
  MEDIA_OVERCONSTRAINED: 'MEDIA_3004',
  MEDIA_TRACK_ENDED: 'MEDIA_3005',
  MEDIA_NOT_ALLOWED: 'MEDIA_3006',
  MEDIA_SCREEN_SHARE_CANCELLED: 'MEDIA_3007',
  MEDIA_WEBCAM_REQUIRED: 'MEDIA_3008',
  MEDIA_SCREEN_REQUIRED: 'MEDIA_3009',

  // ============================================================================
  // Signaling Errors (4xxx)
  // ============================================================================
  SIGNAL_CONNECTION_FAILED: 'SIGNAL_4001',
  SIGNAL_MESSAGE_INVALID: 'SIGNAL_4002',
  SIGNAL_TIMEOUT: 'SIGNAL_4003',
  SIGNAL_RATE_LIMITED: 'SIGNAL_4004',
  SIGNAL_DISCONNECTED: 'SIGNAL_4005',

  // ============================================================================
  // WebRTC Errors (5xxx)
  // ============================================================================
  RTC_PEER_CONNECTION_FAILED: 'RTC_5001',
  RTC_ICE_FAILED: 'RTC_5002',
  RTC_ICE_DISCONNECTED: 'RTC_5003',
  RTC_DTLS_FAILED: 'RTC_5004',
  RTC_SDP_ERROR: 'RTC_5005',
  RTC_NEGOTIATION_FAILED: 'RTC_5006',
  RTC_DATA_CHANNEL_ERROR: 'RTC_5007',

  // ============================================================================
  // SFU (mediasoup) Errors (6xxx)
  // ============================================================================
  SFU_WORKER_UNAVAILABLE: 'SFU_6001',
  SFU_ROUTER_UNAVAILABLE: 'SFU_6002',
  SFU_TRANSPORT_FAILED: 'SFU_6003',
  SFU_PRODUCER_FAILED: 'SFU_6004',
  SFU_CONSUMER_FAILED: 'SFU_6005',
  SFU_UNSUPPORTED_CODEC: 'SFU_6006',
  SFU_INVALID_RTP_CAPABILITIES: 'SFU_6007',

  // ============================================================================
  // Recording Errors (7xxx)
  // ============================================================================
  RECORD_START_FAILED: 'RECORD_7001',
  RECORD_STOP_FAILED: 'RECORD_7002',
  RECORD_STORAGE_FULL: 'RECORD_7003',
  RECORD_FFMPEG_ERROR: 'RECORD_7004',
  RECORD_SYNC_ERROR: 'RECORD_7005',
  RECORD_FILE_CORRUPT: 'RECORD_7006',

  // ============================================================================
  // System Errors (9xxx)
  // ============================================================================
  SYSTEM_INTERNAL_ERROR: 'SYSTEM_9001',
  SYSTEM_OVERLOADED: 'SYSTEM_9002',
  SYSTEM_MAINTENANCE: 'SYSTEM_9003',
  SYSTEM_CONFIG_ERROR: 'SYSTEM_9004',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Error messages for each error code
 * Used for logging and debugging (not for end-user display)
 */
export const ErrorMessages: Record<ErrorCode, string> = {
  // Auth
  [ErrorCodes.AUTH_INVALID_TOKEN]: 'Invalid authentication token',
  [ErrorCodes.AUTH_TOKEN_EXPIRED]: 'Authentication token has expired',
  [ErrorCodes.AUTH_INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions for this action',
  [ErrorCodes.AUTH_USER_NOT_FOUND]: 'User not found',
  [ErrorCodes.AUTH_SESSION_EXPIRED]: 'Session has expired',

  // Room
  [ErrorCodes.ROOM_NOT_FOUND]: 'Room not found',
  [ErrorCodes.ROOM_FULL]: 'Room has reached maximum capacity',
  [ErrorCodes.ROOM_CLOSED]: 'Room has been closed',
  [ErrorCodes.ROOM_ALREADY_JOINED]: 'Already joined this room',
  [ErrorCodes.ROOM_NOT_JOINED]: 'Not a member of this room',
  [ErrorCodes.ROOM_INVALID_STATE]: 'Invalid room state for this operation',
  [ErrorCodes.ROOM_CREATION_FAILED]: 'Failed to create room',

  // Media
  [ErrorCodes.MEDIA_PERMISSION_DENIED]: 'Media permission denied by user',
  [ErrorCodes.MEDIA_DEVICE_NOT_FOUND]: 'Requested media device not found',
  [ErrorCodes.MEDIA_DEVICE_IN_USE]: 'Media device is in use by another application',
  [ErrorCodes.MEDIA_OVERCONSTRAINED]: 'Media constraints cannot be satisfied',
  [ErrorCodes.MEDIA_TRACK_ENDED]: 'Media track has ended unexpectedly',
  [ErrorCodes.MEDIA_NOT_ALLOWED]: 'Media access not allowed in this context',
  [ErrorCodes.MEDIA_SCREEN_SHARE_CANCELLED]: 'Screen sharing was cancelled by user',
  [ErrorCodes.MEDIA_WEBCAM_REQUIRED]: 'Webcam is required for this session',
  [ErrorCodes.MEDIA_SCREEN_REQUIRED]: 'Screen sharing is required for this session',

  // Signaling
  [ErrorCodes.SIGNAL_CONNECTION_FAILED]: 'Failed to establish signaling connection',
  [ErrorCodes.SIGNAL_MESSAGE_INVALID]: 'Invalid signaling message format',
  [ErrorCodes.SIGNAL_TIMEOUT]: 'Signaling operation timed out',
  [ErrorCodes.SIGNAL_RATE_LIMITED]: 'Too many signaling messages, rate limited',
  [ErrorCodes.SIGNAL_DISCONNECTED]: 'Signaling connection disconnected',

  // WebRTC
  [ErrorCodes.RTC_PEER_CONNECTION_FAILED]: 'Failed to establish peer connection',
  [ErrorCodes.RTC_ICE_FAILED]: 'ICE connection failed',
  [ErrorCodes.RTC_ICE_DISCONNECTED]: 'ICE connection disconnected',
  [ErrorCodes.RTC_DTLS_FAILED]: 'DTLS handshake failed',
  [ErrorCodes.RTC_SDP_ERROR]: 'SDP offer/answer error',
  [ErrorCodes.RTC_NEGOTIATION_FAILED]: 'WebRTC negotiation failed',
  [ErrorCodes.RTC_DATA_CHANNEL_ERROR]: 'Data channel error',

  // SFU
  [ErrorCodes.SFU_WORKER_UNAVAILABLE]: 'No available mediasoup workers',
  [ErrorCodes.SFU_ROUTER_UNAVAILABLE]: 'Router not available for this room',
  [ErrorCodes.SFU_TRANSPORT_FAILED]: 'Failed to create WebRTC transport',
  [ErrorCodes.SFU_PRODUCER_FAILED]: 'Failed to create media producer',
  [ErrorCodes.SFU_CONSUMER_FAILED]: 'Failed to create media consumer',
  [ErrorCodes.SFU_UNSUPPORTED_CODEC]: 'Codec not supported',
  [ErrorCodes.SFU_INVALID_RTP_CAPABILITIES]: 'Invalid RTP capabilities',

  // Recording
  [ErrorCodes.RECORD_START_FAILED]: 'Failed to start recording',
  [ErrorCodes.RECORD_STOP_FAILED]: 'Failed to stop recording',
  [ErrorCodes.RECORD_STORAGE_FULL]: 'Recording storage is full',
  [ErrorCodes.RECORD_FFMPEG_ERROR]: 'FFmpeg recording error',
  [ErrorCodes.RECORD_SYNC_ERROR]: 'Audio/video sync error in recording',
  [ErrorCodes.RECORD_FILE_CORRUPT]: 'Recording file is corrupt',

  // System
  [ErrorCodes.SYSTEM_INTERNAL_ERROR]: 'Internal server error',
  [ErrorCodes.SYSTEM_OVERLOADED]: 'System is overloaded, try again later',
  [ErrorCodes.SYSTEM_MAINTENANCE]: 'System is under maintenance',
  [ErrorCodes.SYSTEM_CONFIG_ERROR]: 'System configuration error',
};

/**
 * Check if an error is recoverable (client should retry)
 */
export function isRecoverableError(code: ErrorCode): boolean {
  const recoverableErrors: ErrorCode[] = [
    ErrorCodes.SIGNAL_CONNECTION_FAILED,
    ErrorCodes.SIGNAL_TIMEOUT,
    ErrorCodes.SIGNAL_DISCONNECTED,
    ErrorCodes.RTC_ICE_DISCONNECTED,
    ErrorCodes.SFU_WORKER_UNAVAILABLE,
    ErrorCodes.SYSTEM_OVERLOADED,
  ];

  return recoverableErrors.includes(code);
}

/**
 * Check if error requires user action
 */
export function requiresUserAction(code: ErrorCode): boolean {
  const userActionErrors: ErrorCode[] = [
    ErrorCodes.MEDIA_PERMISSION_DENIED,
    ErrorCodes.MEDIA_DEVICE_NOT_FOUND,
    ErrorCodes.MEDIA_SCREEN_SHARE_CANCELLED,
    ErrorCodes.AUTH_INVALID_TOKEN,
    ErrorCodes.AUTH_TOKEN_EXPIRED,
  ];

  return userActionErrors.includes(code);
}
