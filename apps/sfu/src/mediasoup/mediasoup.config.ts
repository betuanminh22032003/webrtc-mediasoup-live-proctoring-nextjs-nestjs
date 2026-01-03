/**
 * mediasoup Configuration
 *
 * Centralized configuration for mediasoup.
 *
 * WHY separate config?
 * - Easy to change settings without touching code
 * - Clear documentation of all options
 * - Type-safe configuration
 */

import * as os from 'os';
import type { RtpCodecCapability, TransportListenIp, WorkerSettings } from 'mediasoup/types';

// ============================================================================
// Worker Configuration
// ============================================================================

/**
 * Get worker settings
 *
 * WHY these settings?
 * - logLevel 'warn': Don't spam logs in production, but catch issues
 * - rtcMinPort/MaxPort: Large range for many concurrent connections
 */
export function getWorkerSettings(
  rtcMinPort: number,
  rtcMaxPort: number,
): WorkerSettings {
  return {
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      // 'rtx',     // Uncomment for debugging retransmissions
      // 'bwe',     // Uncomment for bandwidth estimation debugging
      // 'score',   // Uncomment for quality score debugging
    ],
    rtcMinPort,
    rtcMaxPort,
  };
}

/**
 * Get number of workers to create
 *
 * WHY 1 per CPU?
 * - Each worker is a process
 * - Node.js is single-threaded, so multiple workers utilize multiple cores
 * - Media processing is CPU-intensive
 */
export function getNumWorkers(configuredWorkers?: number): number {
  return configuredWorkers ?? os.cpus().length;
}

// ============================================================================
// Router Configuration
// ============================================================================

/**
 * Media codecs supported by the router
 *
 * WHY these codecs?
 *
 * AUDIO:
 * - Opus: Best real-time audio codec
 *   - Adaptive bitrate (6-510 kbps)
 *   - Low latency
 *   - Universal browser support
 *
 * VIDEO:
 * - VP8: Universal support, good balance
 *   - Supported by ALL browsers
 *   - Reasonable CPU usage
 *   - Good quality at typical bitrates
 *
 * - VP9: Better compression for screen share
 *   - 30-50% better compression than VP8
 *   - Higher CPU usage
 *   - profile-id 2: Screen share optimized
 *
 * - H.264: Hardware acceleration
 *   - Often has dedicated encoder/decoder
 *   - Lower CPU usage on supported devices
 *   - packetization-mode 1: Efficient for streaming
 *   - profile-level-id 42e01f: Baseline profile, widely compatible
 */
export const ROUTER_MEDIA_CODECS: RtpCodecCapability[] = [
  // Audio: Opus (MUST be first audio codec for priority)
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    preferredPayloadType: 100,
    clockRate: 48000,
    channels: 2,
    // Opus specific parameters
    parameters: {
      // Mono by default, stereo on demand
      // stereo: 1,
      // useinbandfec: 1,  // Forward error correction
    },
  },

  // Video: VP8 (universal fallback)
  {
    kind: 'video',
    mimeType: 'video/VP8',
    preferredPayloadType: 101,
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000, // Initial bitrate hint (kbps)
    },
  },

  // Video: VP9 (better for screen share)
  {
    kind: 'video',
    mimeType: 'video/VP9',
    preferredPayloadType: 102,
    clockRate: 90000,
    parameters: {
      'profile-id': 2, // Profile 2: Better for screen content
      'x-google-start-bitrate': 1000,
    },
  },

  // Video: H.264 (hardware acceleration)
  {
    kind: 'video',
    mimeType: 'video/H264',
    preferredPayloadType: 103,
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f', // Baseline profile
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },

  // Video: H.264 High Profile (better quality, more CPU)
  {
    kind: 'video',
    mimeType: 'video/H264',
    preferredPayloadType: 104,
    clockRate: 90000,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '640032', // High profile
      'level-asymmetry-allowed': 1,
      'x-google-start-bitrate': 1000,
    },
  },
];

// ============================================================================
// WebRTC Transport Configuration
// ============================================================================

/**
 * Get transport listen IPs
 *
 * WHY both listen and announced IP?
 * - listenIp: What IP the server actually binds to (usually 0.0.0.0)
 * - announcedIp: What IP clients should connect to (public IP)
 *
 * In cloud environments:
 * - listenIp is private IP (10.x.x.x, 172.x.x.x, etc.)
 * - announcedIp is public/elastic IP
 */
export function getTransportListenIps(
  listenIp: string,
  announcedIp?: string,
): TransportListenIp[] {
  return [
    {
      ip: listenIp,
      announcedIp: announcedIp || undefined,
    },
  ];
}

/**
 * WebRTC transport options
 *
 * WHY these settings?
 * - enableUdp: Preferred for low latency
 * - enableTcp: Fallback for restrictive firewalls
 * - preferUdp: Always try UDP first
 * - initialAvailableOutgoingBitrate: Conservative start, will adapt up
 */
export const WEBRTC_TRANSPORT_OPTIONS = {
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,

  // Bandwidth settings
  initialAvailableOutgoingBitrate: 600000, // 600 kbps - conservative start
  minimumAvailableOutgoingBitrate: 100000, // 100 kbps - minimum threshold
  maxSctpMessageSize: 262144, // 256 KB for data channels

  // For debugging
  // enableSctp: true, // Data channels
};

// ============================================================================
// Quality Settings
// ============================================================================

/**
 * Video quality presets for different scenarios
 */
export const VIDEO_QUALITY_PRESETS = {
  // Low quality for mobile or poor connections
  low: {
    maxBitrate: 150000, // 150 kbps
    scaleResolutionDownBy: 4,
    maxFramerate: 15,
  },

  // Medium quality for typical usage
  medium: {
    maxBitrate: 500000, // 500 kbps
    scaleResolutionDownBy: 2,
    maxFramerate: 24,
  },

  // High quality for proctoring
  high: {
    maxBitrate: 1500000, // 1.5 Mbps
    scaleResolutionDownBy: 1,
    maxFramerate: 30,
  },

  // Screen share optimized
  screen: {
    maxBitrate: 2500000, // 2.5 Mbps
    scaleResolutionDownBy: 1,
    maxFramerate: 15, // Lower FPS OK for screen
  },
};

/**
 * Simulcast encodings for adaptive quality
 *
 * WHY simulcast?
 * - Send multiple quality layers
 * - Server can forward appropriate layer based on receiver's bandwidth
 * - Avoids transcoding at server
 */
export const SIMULCAST_ENCODINGS = [
  // Low layer
  {
    rid: 'r0',
    maxBitrate: 100000,
    scaleResolutionDownBy: 4,
  },
  // Medium layer
  {
    rid: 'r1',
    maxBitrate: 300000,
    scaleResolutionDownBy: 2,
  },
  // High layer
  {
    rid: 'r2',
    maxBitrate: 900000,
    scaleResolutionDownBy: 1,
  },
];
