/**
 * Signaling Service
 *
 * Handles signaling logic separate from WebSocket transport.
 * This separation allows for easier testing and potential
 * support for other transports in the future.
 */

import { Injectable } from '@nestjs/common';
import { signalingLogger } from '../common/logger';
import type { ProctoringEvent, ProctoringEventType, ViolationSeverity } from '@proctoring/shared';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SignalingService {
  /**
   * Create a proctoring event
   *
   * WHY centralized event creation?
   * - Consistent event format
   * - Single point for event logging
   * - Enables event sourcing patterns later
   */
  createProctoringEvent(
    type: ProctoringEventType,
    userId: string,
    roomId: string,
    severity: ViolationSeverity,
    metadata?: Record<string, unknown>
  ): ProctoringEvent {
    const event: ProctoringEvent = {
      id: uuidv4(),
      type,
      userId,
      roomId,
      timestamp: Date.now(),
      severity,
      metadata,
    };

    signalingLogger.info({ event }, 'Proctoring event created');

    return event;
  }

  /**
   * Validate SDP offer
   *
   * WHY validate SDP?
   * - Prevent malformed SDP from crashing connections
   * - Security: Ensure SDP doesn't contain unexpected data
   */
  validateSdp(sdp: string): { valid: boolean; error?: string } {
    // Basic validation - SDP must have version line
    if (!sdp.startsWith('v=0')) {
      return { valid: false, error: 'Invalid SDP: missing version line' };
    }

    // Must have origin line
    if (!sdp.includes('o=')) {
      return { valid: false, error: 'Invalid SDP: missing origin line' };
    }

    // Must have at least one media line for WebRTC
    if (!sdp.includes('m=')) {
      return { valid: false, error: 'Invalid SDP: no media descriptions' };
    }

    return { valid: true };
  }

  /**
   * Parse ICE candidate string
   *
   * WHY parse candidates?
   * - Logging and debugging
   * - Filtering relay candidates if TURN disabled
   */
  parseIceCandidate(candidateString: string): {
    type: 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown';
    protocol: 'udp' | 'tcp' | 'unknown';
    address?: string;
    port?: number;
  } {
    const candidate = candidateString.toLowerCase();

    let type: 'host' | 'srflx' | 'relay' | 'prflx' | 'unknown' = 'unknown';
    if (candidate.includes('typ host')) type = 'host';
    else if (candidate.includes('typ srflx')) type = 'srflx';
    else if (candidate.includes('typ relay')) type = 'relay';
    else if (candidate.includes('typ prflx')) type = 'prflx';

    let protocol: 'udp' | 'tcp' | 'unknown' = 'unknown';
    if (candidate.includes(' udp ')) protocol = 'udp';
    else if (candidate.includes(' tcp ')) protocol = 'tcp';

    return { type, protocol };
  }
}
