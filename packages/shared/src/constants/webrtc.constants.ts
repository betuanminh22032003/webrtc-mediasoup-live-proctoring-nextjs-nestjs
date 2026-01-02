/**
 * WebRTC Configuration Constants
 *
 * These values are carefully chosen for PROCTORING use case:
 * - Low latency is prioritized over quality
 * - Reliability is critical (evidence-grade)
 * - Must work on poor networks (3G, packet loss)
 */

// ============================================================================
// STUN/TURN Server Configuration
// ============================================================================

/**
 * Public STUN servers for ICE candidate gathering
 *
 * WHY multiple servers?
 * - Redundancy if one server is down
 * - Google STUN is reliable but no SLA
 * - For production: Use your own STUN or paid service
 *
 * TRADE-OFF:
 * - Public STUN = free but no guarantees
 * - Private STUN = cost but reliable
 */
export const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
  'stun:stun2.l.google.com:19302',
] as const;

/**
 * TURN server configuration (placeholder)
 *
 * WHY TURN is expensive:
 * - All media flows through TURN server
 * - Bandwidth costs = candidates × streams × bitrate × duration
 * - At 100 candidates: ~50 Mbps sustained bandwidth
 *
 * WHEN TURN is needed:
 * - Symmetric NAT (common in corporate networks)
 * - Strict firewalls blocking UDP
 * - ~15-20% of real-world connections need TURN
 */
export const DEFAULT_TURN_CONFIG = {
  /** Set to true to enable TURN fallback */
  enabled: false,
  /** TURN server URLs - configure in environment */
  urls: [] as string[],
  /** Credential type */
  credentialType: 'password' as const,
};

// ============================================================================
// ICE Configuration
// ============================================================================

/**
 * ICE gathering timeout in milliseconds
 *
 * WHY 10 seconds?
 * - Most candidates gathered in first 2-3 seconds
 * - Extended time for TURN relay candidates
 * - Balanced between speed and completeness
 */
export const ICE_GATHERING_TIMEOUT_MS = 10_000;

/**
 * ICE connection timeout in milliseconds
 *
 * WHY 30 seconds?
 * - Accounts for slow networks
 * - Allows multiple candidate pair attempts
 * - User feedback should start at 15s
 */
export const ICE_CONNECTION_TIMEOUT_MS = 30_000;

/**
 * ICE restart debounce in milliseconds
 *
 * WHY debounce?
 * - Prevent restart storms on flaky networks
 * - Allow natural recovery first
 */
export const ICE_RESTART_DEBOUNCE_MS = 5_000;

/**
 * Maximum ICE restart attempts before giving up
 */
export const MAX_ICE_RESTART_ATTEMPTS = 3;

// ============================================================================
// Video Encoding Configuration
// ============================================================================

/**
 * Webcam video constraints for PROCTORING
 *
 * WHY these values?
 * - 720p is sufficient for face recognition
 * - 24 fps balances smoothness and bandwidth
 * - aspectRatio 16:9 is standard webcam ratio
 *
 * TRADE-OFF:
 * - Higher resolution = better evidence but more bandwidth
 * - We prioritize reliability over quality
 */
export const WEBCAM_CONSTRAINTS = {
  width: { ideal: 1280, max: 1920 },
  height: { ideal: 720, max: 1080 },
  frameRate: { ideal: 24, max: 30 },
  aspectRatio: { ideal: 16 / 9 },
  facingMode: 'user',
} as const;

/**
 * Screen share constraints for PROCTORING
 *
 * WHY these values?
 * - 1080p captures most screen content legibly
 * - 15 fps is sufficient for document/code reading
 * - Lower fps significantly reduces bandwidth
 *
 * WHY cursor: 'always'?
 * - Cursor position is important evidence
 * - Shows where candidate is looking/clicking
 */
export const SCREEN_SHARE_CONSTRAINTS = {
  width: { ideal: 1920, max: 2560 },
  height: { ideal: 1080, max: 1440 },
  frameRate: { ideal: 15, max: 30 },
  cursor: 'always',
  displaySurface: 'monitor', // Prefer full screen over window/tab
} as const;

/**
 * Audio constraints for PROCTORING
 *
 * WHY these settings?
 * - Echo cancellation prevents feedback loops
 * - Noise suppression filters background noise
 * - Auto gain ensures consistent volume levels
 */
export const AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48000,
  channelCount: 1, // Mono is sufficient for proctoring
} as const;

// ============================================================================
// Bandwidth and Quality Thresholds
// ============================================================================

/**
 * Target bitrates for video encoding (bits per second)
 *
 * WHY these values?
 * - Based on WebRTC best practices for each resolution
 * - Balanced for proctoring (need clarity, not cinematic quality)
 */
export const VIDEO_BITRATE = {
  /** Webcam video */
  WEBCAM_MIN: 150_000, // 150 kbps - minimum usable
  WEBCAM_TARGET: 500_000, // 500 kbps - good quality
  WEBCAM_MAX: 1_000_000, // 1 Mbps - high quality

  /** Screen share - needs more for text clarity */
  SCREEN_MIN: 300_000, // 300 kbps
  SCREEN_TARGET: 1_000_000, // 1 Mbps
  SCREEN_MAX: 2_500_000, // 2.5 Mbps
} as const;

/**
 * Audio bitrate (bits per second)
 */
export const AUDIO_BITRATE = {
  MIN: 24_000, // 24 kbps
  TARGET: 48_000, // 48 kbps - good for speech
  MAX: 96_000, // 96 kbps
} as const;

/**
 * Quality degradation thresholds
 *
 * WHAT breaks at scale?
 * - Packet loss > 5% = noticeable quality issues
 * - Packet loss > 10% = severe degradation
 * - RTT > 300ms = noticeable delay
 * - RTT > 500ms = conversation difficult
 */
export const QUALITY_THRESHOLDS = {
  /** Packet loss percentage that triggers quality warning */
  PACKET_LOSS_WARNING: 5,
  /** Packet loss percentage that triggers quality critical */
  PACKET_LOSS_CRITICAL: 10,

  /** RTT in ms that triggers warning */
  RTT_WARNING_MS: 300,
  /** RTT in ms that triggers critical */
  RTT_CRITICAL_MS: 500,

  /** Minimum acceptable FPS before warning */
  MIN_FPS_WARNING: 15,
  /** Minimum acceptable FPS before critical */
  MIN_FPS_CRITICAL: 10,
} as const;

// ============================================================================
// Reconnection Strategy
// ============================================================================

/**
 * Reconnection configuration
 *
 * WHY exponential backoff?
 * - Prevents thundering herd on server recovery
 * - Gives network time to stabilize
 * - Respects server capacity
 */
export const RECONNECTION = {
  /** Initial delay before first reconnection attempt */
  INITIAL_DELAY_MS: 1_000,
  /** Maximum delay between attempts */
  MAX_DELAY_MS: 30_000,
  /** Multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,
  /** Maximum reconnection attempts */
  MAX_ATTEMPTS: 10,
  /** Jitter factor (0-1) to randomize delays */
  JITTER_FACTOR: 0.2,
} as const;

// ============================================================================
// WebSocket Configuration
// ============================================================================

export const WEBSOCKET = {
  /** Ping interval in ms */
  PING_INTERVAL_MS: 30_000,
  /** Pong timeout in ms */
  PONG_TIMEOUT_MS: 10_000,
  /** Message queue size limit */
  MAX_QUEUE_SIZE: 100,
} as const;

// ============================================================================
// mediasoup Configuration
// ============================================================================

/**
 * mediasoup Worker settings
 *
 * WHY these values?
 * - logLevel 'warn' reduces noise in production
 * - RTC ports must be open in firewall
 * - Port range sized for expected load
 */
export const MEDIASOUP_WORKER = {
  logLevel: 'warn' as const,
  logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'] as const,
  rtcMinPort: 40000,
  rtcMaxPort: 49999,
} as const;

/**
 * mediasoup Router media codecs
 *
 * WHY VP8 and Opus?
 * - VP8: Universal browser support, good compression
 * - Opus: Best audio codec for real-time, adaptive bitrate
 *
 * WHY NOT VP9/AV1?
 * - VP9: Higher CPU, limited older browser support
 * - AV1: Not yet widely supported for real-time
 */
export const MEDIASOUP_ROUTER_CODECS = [
  {
    kind: 'audio' as const,
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video' as const,
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
  {
    kind: 'video' as const,
    mimeType: 'video/VP9',
    clockRate: 90000,
    parameters: {
      'profile-id': 2,
      'x-google-start-bitrate': 1000,
    },
  },
  {
    kind: 'video' as const,
    mimeType: 'video/H264',
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '4d0032',
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
] as const;

/**
 * WebRTC Transport settings
 */
export const MEDIASOUP_TRANSPORT = {
  /** Maximum incoming bitrate per transport */
  maxIncomingBitrate: 1_500_000,
  /** Initial available outgoing bitrate */
  initialAvailableOutgoingBitrate: 1_000_000,
  /** Enable UDP (preferred for low latency) */
  enableUdp: true,
  /** Enable TCP (fallback for restrictive networks) */
  enableTcp: true,
  /** Prefer UDP over TCP */
  preferUdp: true,
} as const;

// ============================================================================
// Recording Configuration
// ============================================================================

export const RECORDING = {
  /** Recording segment duration in seconds */
  SEGMENT_DURATION_SECONDS: 60,
  /** Maximum recording duration in hours */
  MAX_DURATION_HOURS: 4,
  /** Output format */
  OUTPUT_FORMAT: 'webm' as const,
  /** Video codec for recording */
  VIDEO_CODEC: 'libvpx' as const,
  /** Audio codec for recording */
  AUDIO_CODEC: 'libopus' as const,
} as const;

// ============================================================================
// Proctoring Specific
// ============================================================================

export const PROCTORING = {
  /** Grace period before marking media as missing (ms) */
  MEDIA_MISSING_GRACE_PERIOD_MS: 5_000,
  /** Minimum webcam check interval (ms) */
  WEBCAM_CHECK_INTERVAL_MS: 10_000,
  /** Maximum time without face detected before warning (ms) */
  NO_FACE_WARNING_THRESHOLD_MS: 30_000,
  /** Event retention period (days) */
  EVENT_RETENTION_DAYS: 90,
} as const;
