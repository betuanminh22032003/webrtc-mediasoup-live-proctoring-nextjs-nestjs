/**
 * WebRTC Statistics Utilities
 *
 * WHY this module?
 * - RTCStatsReport is complex and verbose
 * - Need to extract meaningful metrics for proctoring
 * - Quality monitoring is critical for evidence integrity
 */

import { QUALITY_THRESHOLDS } from '@proctoring/shared';

/**
 * Simplified connection stats for UI display
 */
export interface ConnectionStats {
  /** Round-trip time in milliseconds */
  rtt: number;
  /** Packet loss percentage (0-100) */
  packetLoss: number;
  /** Available outgoing bandwidth (kbps) */
  availableBandwidth: number;
  /** Local candidate type (host, srflx, relay) */
  localCandidateType: string;
  /** Remote candidate type */
  remoteCandidateType: string;
  /** Connection protocol (udp/tcp) */
  protocol: string;
  /** Timestamp of stats collection */
  timestamp: number;
}

/**
 * Video track statistics
 */
export interface VideoStats {
  /** Frames per second */
  fps: number;
  /** Video width */
  width: number;
  /** Video height */
  height: number;
  /** Current bitrate in kbps */
  bitrate: number;
  /** Total bytes sent/received */
  totalBytes: number;
  /** Frames dropped */
  framesDropped: number;
  /** Is sending or receiving */
  direction: 'inbound' | 'outbound';
}

/**
 * Audio track statistics
 */
export interface AudioStats {
  /** Current bitrate in kbps */
  bitrate: number;
  /** Audio level (0-1) */
  audioLevel: number;
  /** Total bytes sent/received */
  totalBytes: number;
  /** Direction */
  direction: 'inbound' | 'outbound';
}

/**
 * Quality assessment based on stats
 */
export interface QualityAssessment {
  overall: 'excellent' | 'good' | 'fair' | 'poor';
  issues: string[];
  recommendations: string[];
}

/**
 * Previous stats for bitrate calculation
 */
interface PreviousStats {
  timestamp: number;
  bytesSent: number;
  bytesReceived: number;
}

const previousStatsMap = new Map<string, PreviousStats>();

/**
 * Extract connection statistics from RTCStatsReport
 */
export async function getConnectionStats(
  peerConnection: RTCPeerConnection
): Promise<ConnectionStats | null> {
  try {
    const stats = await peerConnection.getStats();

    let rtt = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let localCandidateType = 'unknown';
    let remoteCandidateType = 'unknown';
    let protocol = 'unknown';
    let availableBandwidth = 0;

    stats.forEach((report) => {
      // Get RTT from candidate pair
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        rtt = report.currentRoundTripTime
          ? report.currentRoundTripTime * 1000
          : 0;
        availableBandwidth = report.availableOutgoingBitrate
          ? report.availableOutgoingBitrate / 1000
          : 0;
      }

      // Get packet loss from inbound RTP
      if (report.type === 'inbound-rtp') {
        packetsLost += report.packetsLost || 0;
        packetsReceived += report.packetsReceived || 0;
      }

      // Get local candidate info
      if (report.type === 'local-candidate') {
        localCandidateType = report.candidateType || 'unknown';
        protocol = report.protocol || 'unknown';
      }

      // Get remote candidate info
      if (report.type === 'remote-candidate') {
        remoteCandidateType = report.candidateType || 'unknown';
      }
    });

    const totalPackets = packetsLost + packetsReceived;
    const packetLoss = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

    return {
      rtt,
      packetLoss,
      availableBandwidth,
      localCandidateType,
      remoteCandidateType,
      protocol,
      timestamp: Date.now(),
    };
  } catch (error) {
    console.error('Failed to get connection stats:', error);
    return null;
  }
}

/**
 * Extract video track statistics
 */
export async function getVideoStats(
  peerConnection: RTCPeerConnection,
  trackId?: string
): Promise<VideoStats[]> {
  const stats = await peerConnection.getStats();
  const videoStats: VideoStats[] = [];

  stats.forEach((report) => {
    if (report.type === 'outbound-rtp' && report.kind === 'video') {
      if (trackId && report.trackIdentifier !== trackId) return;

      const prev = previousStatsMap.get(`video-out-${report.ssrc}`);
      const now = Date.now();
      let bitrate = 0;

      if (prev) {
        const timeDiff = (now - prev.timestamp) / 1000;
        const bytesDiff = report.bytesSent - prev.bytesSent;
        bitrate = (bytesDiff * 8) / timeDiff / 1000; // kbps
      }

      previousStatsMap.set(`video-out-${report.ssrc}`, {
        timestamp: now,
        bytesSent: report.bytesSent || 0,
        bytesReceived: 0,
      });

      videoStats.push({
        fps: report.framesPerSecond || 0,
        width: report.frameWidth || 0,
        height: report.frameHeight || 0,
        bitrate,
        totalBytes: report.bytesSent || 0,
        framesDropped: report.framesDropped || 0,
        direction: 'outbound',
      });
    }

    if (report.type === 'inbound-rtp' && report.kind === 'video') {
      if (trackId && report.trackIdentifier !== trackId) return;

      const prev = previousStatsMap.get(`video-in-${report.ssrc}`);
      const now = Date.now();
      let bitrate = 0;

      if (prev) {
        const timeDiff = (now - prev.timestamp) / 1000;
        const bytesDiff = report.bytesReceived - prev.bytesReceived;
        bitrate = (bytesDiff * 8) / timeDiff / 1000;
      }

      previousStatsMap.set(`video-in-${report.ssrc}`, {
        timestamp: now,
        bytesSent: 0,
        bytesReceived: report.bytesReceived || 0,
      });

      videoStats.push({
        fps: report.framesPerSecond || 0,
        width: report.frameWidth || 0,
        height: report.frameHeight || 0,
        bitrate,
        totalBytes: report.bytesReceived || 0,
        framesDropped: report.framesDropped || 0,
        direction: 'inbound',
      });
    }
  });

  return videoStats;
}

/**
 * Extract audio track statistics
 */
export async function getAudioStats(
  peerConnection: RTCPeerConnection
): Promise<AudioStats[]> {
  const stats = await peerConnection.getStats();
  const audioStats: AudioStats[] = [];

  stats.forEach((report) => {
    if (report.type === 'outbound-rtp' && report.kind === 'audio') {
      const prev = previousStatsMap.get(`audio-out-${report.ssrc}`);
      const now = Date.now();
      let bitrate = 0;

      if (prev) {
        const timeDiff = (now - prev.timestamp) / 1000;
        const bytesDiff = report.bytesSent - prev.bytesSent;
        bitrate = (bytesDiff * 8) / timeDiff / 1000;
      }

      previousStatsMap.set(`audio-out-${report.ssrc}`, {
        timestamp: now,
        bytesSent: report.bytesSent || 0,
        bytesReceived: 0,
      });

      audioStats.push({
        bitrate,
        audioLevel: 0, // Need to get from media-source report
        totalBytes: report.bytesSent || 0,
        direction: 'outbound',
      });
    }

    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
      const prev = previousStatsMap.get(`audio-in-${report.ssrc}`);
      const now = Date.now();
      let bitrate = 0;

      if (prev) {
        const timeDiff = (now - prev.timestamp) / 1000;
        const bytesDiff = report.bytesReceived - prev.bytesReceived;
        bitrate = (bytesDiff * 8) / timeDiff / 1000;
      }

      previousStatsMap.set(`audio-in-${report.ssrc}`, {
        timestamp: now,
        bytesSent: 0,
        bytesReceived: report.bytesReceived || 0,
      });

      audioStats.push({
        bitrate,
        audioLevel: report.audioLevel || 0,
        totalBytes: report.bytesReceived || 0,
        direction: 'inbound',
      });
    }
  });

  return audioStats;
}

/**
 * Assess connection quality based on stats
 */
export function assessQuality(stats: ConnectionStats): QualityAssessment {
  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check RTT
  if (stats.rtt > QUALITY_THRESHOLDS.RTT_CRITICAL_MS) {
    issues.push('Very high latency detected');
    recommendations.push('Check network connection');
  } else if (stats.rtt > QUALITY_THRESHOLDS.RTT_WARNING_MS) {
    issues.push('High latency detected');
  }

  // Check packet loss
  if (stats.packetLoss > QUALITY_THRESHOLDS.PACKET_LOSS_CRITICAL) {
    issues.push('Severe packet loss');
    recommendations.push('Move closer to router or use wired connection');
  } else if (stats.packetLoss > QUALITY_THRESHOLDS.PACKET_LOSS_WARNING) {
    issues.push('Moderate packet loss');
  }

  // Check if using TURN relay
  if (stats.localCandidateType === 'relay') {
    issues.push('Using relay server (TURN)');
    recommendations.push('Relay connections have higher latency');
  }

  // Determine overall quality
  let overall: QualityAssessment['overall'];
  if (
    stats.rtt < 100 &&
    stats.packetLoss < 1 &&
    stats.localCandidateType !== 'relay'
  ) {
    overall = 'excellent';
  } else if (
    stats.rtt < QUALITY_THRESHOLDS.RTT_WARNING_MS &&
    stats.packetLoss < QUALITY_THRESHOLDS.PACKET_LOSS_WARNING
  ) {
    overall = 'good';
  } else if (
    stats.rtt < QUALITY_THRESHOLDS.RTT_CRITICAL_MS &&
    stats.packetLoss < QUALITY_THRESHOLDS.PACKET_LOSS_CRITICAL
  ) {
    overall = 'fair';
  } else {
    overall = 'poor';
  }

  return { overall, issues, recommendations };
}

/**
 * Clear cached previous stats
 */
export function clearStatsCache(): void {
  previousStatsMap.clear();
}
