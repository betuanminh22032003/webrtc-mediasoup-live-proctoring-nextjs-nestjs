/**
 * mediasoup Types
 *
 * Type definitions for mediasoup integration.
 *
 * WHY separate types?
 * - Keeps implementation clean
 * - Single source of truth for types
 * - Easier testing and mocking
 */

import type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  DtlsParameters,
  IceParameters,
  IceCandidate,
  RtpParameters,
  MediaKind,
} from 'mediasoup/types';

// Re-export mediasoup types for convenience
export type {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
  RtpCapabilities,
  DtlsParameters,
  IceParameters,
  IceCandidate,
  RtpParameters,
  MediaKind,
};

// ============================================================================
// Worker Types
// ============================================================================

/**
 * Worker with usage tracking
 */
export interface WorkerInfo {
  worker: Worker;
  /** Number of routers on this worker */
  routerCount: number;
  /** Timestamp when worker was created */
  createdAt: number;
  /** Worker process ID */
  pid: number;
}

/**
 * Worker manager configuration
 */
export interface WorkerManagerConfig {
  /** Number of workers to create (default: CPU cores) */
  numWorkers?: number;
  /** Minimum RTC port */
  rtcMinPort: number;
  /** Maximum RTC port */
  rtcMaxPort: number;
  /** Log level for workers */
  logLevel?: 'debug' | 'warn' | 'error' | 'none';
  /** Log tags for debugging */
  logTags?: string[];
}

// ============================================================================
// Router Types
// ============================================================================

/**
 * Router with metadata
 */
export interface RouterInfo {
  router: Router;
  /** Room ID this router belongs to */
  roomId: string;
  /** Worker this router runs on */
  workerId: number;
  /** Timestamp when router was created */
  createdAt: number;
}

// ============================================================================
// Transport Types
// ============================================================================

/**
 * Transport direction
 * Re-exported from shared for convenience
 */
export { TransportDirection } from '@proctoring/shared';
export type TransportDirectionType = 'send' | 'recv';

/**
 * Transport with metadata
 */
export interface TransportInfo {
  transport: WebRtcTransport;
  /** User ID that owns this transport */
  peerId: string;
  /** Room ID */
  roomId: string;
  /** Direction of transport */
  direction: TransportDirectionType;
  /** Whether transport has been connected */
  connected: boolean;
  /** Timestamp when created */
  createdAt: number;
}

/**
 * Transport options sent to client
 */
export interface TransportOptions {
  id: string;
  iceParameters: IceParameters;
  iceCandidates: IceCandidate[];
  dtlsParameters: DtlsParameters;
  sctpParameters?: {
    port: number;
    OS: number;
    MIS: number;
    maxMessageSize: number;
  };
}

// ============================================================================
// Producer Types
// ============================================================================

/**
 * Producer app data
 *
 * NOTE: Extends Record<string, unknown> to be compatible with mediasoup's AppData
 */
export interface ProducerAppData extends Record<string, unknown> {
  /** Type of media track */
  trackType: 'webcam' | 'screen' | 'audio';
  /** User ID that owns this producer */
  peerId: string;
  /** Room ID */
  roomId: string;
}

/**
 * Producer with metadata
 */
export interface ProducerInfo {
  producer: Producer;
  /** App data */
  appData: ProducerAppData;
  /** Timestamp when created */
  createdAt: number;
}

// ============================================================================
// Consumer Types
// ============================================================================

/**
 * Consumer app data
 *
 * NOTE: Extends Record<string, unknown> to be compatible with mediasoup's AppData
 */
export interface ConsumerAppData extends Record<string, unknown> {
  /** Producer ID this consumer is consuming */
  producerId: string;
  /** User ID that owns this consumer */
  peerId: string;
  /** Room ID */
  roomId: string;
  /** Track type from producer */
  trackType: 'webcam' | 'screen' | 'audio';
}

/**
 * Consumer with metadata
 */
export interface ConsumerInfo {
  consumer: Consumer;
  /** App data */
  appData: ConsumerAppData;
  /** Timestamp when created */
  createdAt: number;
}

/**
 * Consumer options sent to client
 */
export interface ConsumerOptions {
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: RtpParameters;
  appData: ConsumerAppData;
}

// ============================================================================
// Peer Types (Per-connection state)
// ============================================================================

/**
 * Peer state - All mediasoup resources for one user
 */
export interface PeerMediaState {
  /** User ID */
  peerId: string;
  /** Room ID */
  roomId: string;
  /** Send transport */
  sendTransport?: WebRtcTransport;
  /** Receive transport */
  recvTransport?: WebRtcTransport;
  /** All producers (keyed by producer ID) */
  producers: Map<string, Producer>;
  /** All consumers (keyed by consumer ID) */
  consumers: Map<string, Consumer>;
  /** Client RTP capabilities */
  rtpCapabilities?: RtpCapabilities;
  /** Joined timestamp */
  joinedAt: number;
}

// ============================================================================
// Room Types
// ============================================================================

/**
 * Room media state - All mediasoup resources for one room
 */
export interface RoomMediaState {
  /** Room ID */
  roomId: string;
  /** Router for this room */
  router: Router;
  /** All peers in this room */
  peers: Map<string, PeerMediaState>;
  /** Created timestamp */
  createdAt: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * New producer event data
 */
export interface NewProducerEvent {
  producerId: string;
  peerId: string;
  kind: MediaKind;
  trackType: 'webcam' | 'screen' | 'audio';
}

/**
 * Producer closed event data
 */
export interface ProducerClosedEvent {
  producerId: string;
  peerId: string;
}

/**
 * Consumer closed event data
 */
export interface ConsumerClosedEvent {
  consumerId: string;
  peerId: string;
}
