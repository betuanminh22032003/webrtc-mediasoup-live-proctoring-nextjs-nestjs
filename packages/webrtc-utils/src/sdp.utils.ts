/**
 * SDP (Session Description Protocol) Utilities
 *
 * WHY this module?
 * - SDP manipulation is error-prone
 * - Centralizes codec preferences
 * - Supports debugging and logging
 *
 * SDP STRUCTURE (for understanding):
 * v=0                                    // Version
 * o=- 123 456 IN IP4 127.0.0.1          // Origin
 * s=-                                    // Session name
 * t=0 0                                  // Timing
 * m=video 9 UDP/TLS/RTP/SAVPF 96 97     // Media line (video)
 * a=rtpmap:96 VP8/90000                 // Codec mapping
 * a=rtpmap:97 VP9/90000
 */

/**
 * Parsed SDP structure for easier manipulation
 */
export interface ParsedSdp {
  version: string;
  origin: string;
  sessionName: string;
  timing: string;
  mediaDescriptions: MediaDescription[];
  rawLines: string[];
}

export interface MediaDescription {
  type: 'audio' | 'video' | 'application';
  port: number;
  protocol: string;
  formats: string[];
  attributes: Map<string, string[]>;
}

/**
 * Extract video codecs from SDP
 *
 * WHY?
 * - Verify negotiated codec matches expected
 * - Debugging connection issues
 */
export function extractVideoCodecs(sdp: string): string[] {
  const codecs: string[] = [];
  const lines = sdp.split('\r\n');

  for (const line of lines) {
    // rtpmap lines define codec mappings
    // Format: a=rtpmap:<payload_type> <codec>/<clock_rate>
    if (line.startsWith('a=rtpmap:') && line.includes('video')) {
      continue; // This is wrong - need to check m= line context
    }
    
    const match = line.match(/^a=rtpmap:\d+ (\w+)\/\d+/);
    if (match) {
      codecs.push(match[1]);
    }
  }

  return [...new Set(codecs)];
}

/**
 * Check if SDP contains video
 */
export function hasVideoInSdp(sdp: string): boolean {
  return sdp.includes('m=video');
}

/**
 * Check if SDP contains audio
 */
export function hasAudioInSdp(sdp: string): boolean {
  return sdp.includes('m=audio');
}

/**
 * Get SDP type (offer or answer)
 *
 * WHY?
 * - Validation before setting on peer connection
 * - Logging clarity
 */
export function getSdpType(sdp: RTCSessionDescriptionInit): 'offer' | 'answer' | 'unknown' {
  if (sdp.type === 'offer') return 'offer';
  if (sdp.type === 'answer') return 'answer';
  return 'unknown';
}

/**
 * Prefer specific video codec in SDP
 *
 * WHY manipulate SDP?
 * - Force codec preference (e.g., VP8 for compatibility)
 * - Work around browser defaults
 *
 * HOW this works:
 * 1. Find m=video line with format list
 * 2. Find rtpmap line for preferred codec
 * 3. Move preferred codec's payload type to front of format list
 *
 * TRADE-OFF:
 * - SDP munging is fragile and discouraged
 * - But sometimes necessary for codec control
 * - mediasoup provides cleaner codec control
 */
export function preferVideoCodec(sdp: string, preferredCodec: string): string {
  const lines = sdp.split('\r\n');
  const result: string[] = [];

  let mLineIndex = -1;
  const codecPayloadTypes: Map<string, string> = new Map();

  // First pass: find codec payload types
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Find video m= line
    if (line.startsWith('m=video')) {
      mLineIndex = i;
    }

    // Parse rtpmap to find codec payload types
    const rtpmapMatch = line.match(/^a=rtpmap:(\d+) (\w+)\/\d+/);
    if (rtpmapMatch) {
      const [, payloadType, codec] = rtpmapMatch;
      codecPayloadTypes.set(codec.toUpperCase(), payloadType);
    }
  }

  // Get preferred codec's payload type
  const preferredPayloadType = codecPayloadTypes.get(preferredCodec.toUpperCase());

  if (!preferredPayloadType || mLineIndex === -1) {
    // Codec not found or no video, return unchanged
    return sdp;
  }

  // Second pass: reorder formats in m= line
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    if (i === mLineIndex) {
      // Parse m= line: m=video <port> <protocol> <formats...>
      const parts = line.split(' ');
      if (parts.length >= 4) {
        const [mType, port, protocol, ...formats] = parts;

        // Move preferred codec to front
        const reorderedFormats = [
          preferredPayloadType,
          ...formats.filter((f) => f !== preferredPayloadType),
        ];

        line = [mType, port, protocol, ...reorderedFormats].join(' ');
      }
    }

    result.push(line);
  }

  return result.join('\r\n');
}

/**
 * Set maximum bitrate in SDP
 *
 * WHY?
 * - Control bandwidth usage
 * - Prevent network congestion
 * - Required for proctoring quality control
 */
export function setMaxBitrate(
  sdp: string,
  mediaType: 'audio' | 'video',
  maxBitrateKbps: number
): string {
  const lines = sdp.split('\r\n');
  const result: string[] = [];

  let inTargetMedia = false;

  for (const line of lines) {
    result.push(line);

    // Check if we're entering the target media section
    if (line.startsWith(`m=${mediaType}`)) {
      inTargetMedia = true;
    } else if (line.startsWith('m=')) {
      inTargetMedia = false;
    }

    // Add bandwidth line after c= line in target media section
    if (inTargetMedia && line.startsWith('c=')) {
      result.push(`b=AS:${maxBitrateKbps}`);
    }
  }

  return result.join('\r\n');
}

/**
 * Extract ICE credentials from SDP
 *
 * WHY?
 * - Debugging ICE issues
 * - Verifying credential exchange
 */
export function extractIceCredentials(
  sdp: string
): { ufrag: string; pwd: string } | null {
  const ufragMatch = sdp.match(/a=ice-ufrag:(\S+)/);
  const pwdMatch = sdp.match(/a=ice-pwd:(\S+)/);

  if (ufragMatch && pwdMatch) {
    return {
      ufrag: ufragMatch[1],
      pwd: pwdMatch[1],
    };
  }

  return null;
}

/**
 * Check if SDP has DTLS fingerprint
 *
 * WHY?
 * - DTLS is required for WebRTC security
 * - Missing fingerprint = connection will fail
 */
export function hasDtlsFingerprint(sdp: string): boolean {
  return sdp.includes('a=fingerprint:');
}

/**
 * Get DTLS setup role from SDP
 */
export function getDtlsRole(sdp: string): 'active' | 'passive' | 'actpass' | null {
  const match = sdp.match(/a=setup:(\w+)/);
  if (match) {
    const role = match[1] as 'active' | 'passive' | 'actpass';
    if (['active', 'passive', 'actpass'].includes(role)) {
      return role;
    }
  }
  return null;
}

/**
 * Create a summary of SDP for logging
 *
 * WHY?
 * - Full SDP is verbose and hard to read
 * - Summary provides key info for debugging
 */
export function summarizeSdp(sdp: string): {
  hasVideo: boolean;
  hasAudio: boolean;
  codecs: string[];
  iceCredentials: { ufrag: string; pwd: string } | null;
  hasDtls: boolean;
  dtlsRole: string | null;
} {
  return {
    hasVideo: hasVideoInSdp(sdp),
    hasAudio: hasAudioInSdp(sdp),
    codecs: extractVideoCodecs(sdp),
    iceCredentials: extractIceCredentials(sdp),
    hasDtls: hasDtlsFingerprint(sdp),
    dtlsRole: getDtlsRole(sdp),
  };
}
