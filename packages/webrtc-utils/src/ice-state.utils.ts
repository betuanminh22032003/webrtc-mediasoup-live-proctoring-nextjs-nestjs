/**
 * ICE Connection State Utilities
 *
 * WHY this module?
 * - ICE states are complex and often misunderstood
 * - Centralizes state interpretation logic
 * - Provides consistent behavior across the application
 */

import {
  ConnectionState,
  ProctoringEventType,
  ViolationSeverity,
} from '@proctoring/shared';

/**
 * Map RTCIceConnectionState to our ConnectionState
 *
 * WHY custom mapping?
 * - WebRTC states are low-level, our states are semantic
 * - Simplifies UI logic
 * - Consistent with our event system
 */
export function mapIceConnectionState(
  iceState: RTCIceConnectionState
): ConnectionState {
  switch (iceState) {
    case 'new':
    case 'checking':
      return ConnectionState.CONNECTING;
    case 'connected':
    case 'completed':
      return ConnectionState.CONNECTED;
    case 'disconnected':
      return ConnectionState.RECONNECTING;
    case 'failed':
      return ConnectionState.FAILED;
    case 'closed':
      return ConnectionState.DISCONNECTED;
    default:
      return ConnectionState.DISCONNECTED;
  }
}

/**
 * Map RTCPeerConnectionState to ConnectionState
 */
export function mapPeerConnectionState(
  peerState: RTCPeerConnectionState
): ConnectionState {
  switch (peerState) {
    case 'new':
    case 'connecting':
      return ConnectionState.CONNECTING;
    case 'connected':
      return ConnectionState.CONNECTED;
    case 'disconnected':
      return ConnectionState.RECONNECTING;
    case 'failed':
      return ConnectionState.FAILED;
    case 'closed':
      return ConnectionState.DISCONNECTED;
    default:
      return ConnectionState.DISCONNECTED;
  }
}

/**
 * Check if ICE state indicates we should attempt restart
 */
export function shouldAttemptIceRestart(
  iceState: RTCIceConnectionState
): boolean {
  return iceState === 'disconnected' || iceState === 'failed';
}

/**
 * Check if connection is in a terminal state
 */
export function isTerminalState(state: ConnectionState): boolean {
  return state === ConnectionState.FAILED || state === ConnectionState.DISCONNECTED;
}

/**
 * Get proctoring event type for connection state change
 */
export function getConnectionEventType(
  previousState: ConnectionState,
  newState: ConnectionState
): ProctoringEventType | null {
  if (
    previousState !== ConnectionState.CONNECTED &&
    newState === ConnectionState.CONNECTED
  ) {
    return ProctoringEventType.CONNECTION_ESTABLISHED;
  }

  if (
    previousState === ConnectionState.CONNECTED &&
    (newState === ConnectionState.RECONNECTING || newState === ConnectionState.FAILED)
  ) {
    return ProctoringEventType.CONNECTION_LOST;
  }

  if (
    previousState === ConnectionState.RECONNECTING &&
    newState === ConnectionState.CONNECTED
  ) {
    return ProctoringEventType.CONNECTION_RECOVERED;
  }

  return null;
}

/**
 * Get severity for connection event
 */
export function getConnectionEventSeverity(
  eventType: ProctoringEventType
): ViolationSeverity {
  switch (eventType) {
    case ProctoringEventType.CONNECTION_ESTABLISHED:
    case ProctoringEventType.CONNECTION_RECOVERED:
      return ViolationSeverity.INFO;
    case ProctoringEventType.CONNECTION_LOST:
      return ViolationSeverity.WARNING;
    default:
      return ViolationSeverity.INFO;
  }
}
