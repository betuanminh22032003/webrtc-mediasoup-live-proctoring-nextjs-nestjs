/**
 * WebRTC Connection Store (Zustand)
 *
 * WHY Zustand?
 * - Minimal boilerplate vs Redux
 * - Built-in TypeScript support
 * - No provider needed
 * - Supports middleware (devtools, persistence)
 *
 * This store manages:
 * - WebSocket signaling connection
 * - RTCPeerConnection state
 * - Media stream state
 * - Room and participant state
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Participant, User } from '@proctoring/shared';
import { ConnectionState, MediaTrackType, UserRole } from '@proctoring/shared';

// ============================================================================
// Types
// ============================================================================

interface MediaStreams {
  localWebcam: MediaStream | null;
  localScreen: MediaStream | null;
  localAudio: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
}

interface ConnectionStats {
  rtt: number;
  packetLoss: number;
  bitrate: number;
  timestamp: number;
}

interface WebRTCState {
  // User info
  user: User | null;
  roomId: string | null;

  // Connection state
  signalingState: ConnectionState;
  peerConnectionState: ConnectionState;
  iceConnectionState: RTCIceConnectionState | null;

  // Media
  media: MediaStreams;
  mediaEnabled: {
    webcam: boolean;
    screen: boolean;
    audio: boolean;
  };

  // Room
  participants: Map<string, Participant>;

  // Stats
  connectionStats: ConnectionStats | null;

  // Error
  lastError: string | null;
}

interface WebRTCActions {
  // User actions
  setUser: (user: User) => void;
  setRoomId: (roomId: string) => void;

  // Connection actions
  setSignalingState: (state: ConnectionState) => void;
  setPeerConnectionState: (state: ConnectionState) => void;
  setIceConnectionState: (state: RTCIceConnectionState) => void;

  // Media actions
  setLocalWebcam: (stream: MediaStream | null) => void;
  setLocalScreen: (stream: MediaStream | null) => void;
  setLocalAudio: (stream: MediaStream | null) => void;
  addRemoteStream: (participantId: string, stream: MediaStream) => void;
  removeRemoteStream: (participantId: string) => void;
  setMediaEnabled: (type: 'webcam' | 'screen' | 'audio', enabled: boolean) => void;

  // Room actions
  setParticipants: (participants: Participant[]) => void;
  addParticipant: (participant: Participant) => void;
  removeParticipant: (userId: string) => void;
  updateParticipant: (userId: string, updates: Partial<Participant>) => void;

  // Stats
  setConnectionStats: (stats: ConnectionStats) => void;

  // Error
  setError: (error: string | null) => void;

  // Reset
  reset: () => void;
}

type WebRTCStore = WebRTCState & WebRTCActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: WebRTCState = {
  user: null,
  roomId: null,
  signalingState: ConnectionState.DISCONNECTED,
  peerConnectionState: ConnectionState.DISCONNECTED,
  iceConnectionState: null,
  media: {
    localWebcam: null,
    localScreen: null,
    localAudio: null,
    remoteStreams: new Map(),
  },
  mediaEnabled: {
    webcam: false,
    screen: false,
    audio: false,
  },
  participants: new Map(),
  connectionStats: null,
  lastError: null,
};

// ============================================================================
// Store
// ============================================================================

export const useWebRTCStore = create<WebRTCStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // User actions
      setUser: (user) => set({ user }, false, 'setUser'),
      setRoomId: (roomId) => set({ roomId }, false, 'setRoomId'),

      // Connection actions
      setSignalingState: (state) =>
        set({ signalingState: state }, false, 'setSignalingState'),
      setPeerConnectionState: (state) =>
        set({ peerConnectionState: state }, false, 'setPeerConnectionState'),
      setIceConnectionState: (state) =>
        set({ iceConnectionState: state }, false, 'setIceConnectionState'),

      // Media actions
      setLocalWebcam: (stream) =>
        set(
          (state) => ({
            media: { ...state.media, localWebcam: stream },
            mediaEnabled: { ...state.mediaEnabled, webcam: stream !== null },
          }),
          false,
          'setLocalWebcam'
        ),

      setLocalScreen: (stream) =>
        set(
          (state) => ({
            media: { ...state.media, localScreen: stream },
            mediaEnabled: { ...state.mediaEnabled, screen: stream !== null },
          }),
          false,
          'setLocalScreen'
        ),

      setLocalAudio: (stream) =>
        set(
          (state) => ({
            media: { ...state.media, localAudio: stream },
            mediaEnabled: { ...state.mediaEnabled, audio: stream !== null },
          }),
          false,
          'setLocalAudio'
        ),

      addRemoteStream: (participantId, stream) =>
        set(
          (state) => {
            const newRemoteStreams = new Map(state.media.remoteStreams);
            newRemoteStreams.set(participantId, stream);
            return { media: { ...state.media, remoteStreams: newRemoteStreams } };
          },
          false,
          'addRemoteStream'
        ),

      removeRemoteStream: (participantId) =>
        set(
          (state) => {
            const newRemoteStreams = new Map(state.media.remoteStreams);
            newRemoteStreams.delete(participantId);
            return { media: { ...state.media, remoteStreams: newRemoteStreams } };
          },
          false,
          'removeRemoteStream'
        ),

      setMediaEnabled: (type, enabled) =>
        set(
          (state) => ({
            mediaEnabled: { ...state.mediaEnabled, [type]: enabled },
          }),
          false,
          'setMediaEnabled'
        ),

      // Room actions
      setParticipants: (participants) =>
        set(
          {
            participants: new Map(participants.map((p) => [p.user.id, p])),
          },
          false,
          'setParticipants'
        ),

      addParticipant: (participant) =>
        set(
          (state) => {
            const newParticipants = new Map(state.participants);
            newParticipants.set(participant.user.id, participant);
            return { participants: newParticipants };
          },
          false,
          'addParticipant'
        ),

      removeParticipant: (userId) =>
        set(
          (state) => {
            const newParticipants = new Map(state.participants);
            newParticipants.delete(userId);
            return { participants: newParticipants };
          },
          false,
          'removeParticipant'
        ),

      updateParticipant: (userId, updates) =>
        set(
          (state) => {
            const participant = state.participants.get(userId);
            if (!participant) return state;

            const newParticipants = new Map(state.participants);
            newParticipants.set(userId, { ...participant, ...updates });
            return { participants: newParticipants };
          },
          false,
          'updateParticipant'
        ),

      // Stats
      setConnectionStats: (stats) =>
        set({ connectionStats: stats }, false, 'setConnectionStats'),

      // Error
      setError: (error) => set({ lastError: error }, false, 'setError'),

      // Reset
      reset: () => set(initialState, false, 'reset'),
    }),
    { name: 'webrtc-store' }
  )
);

// ============================================================================
// Selectors (for optimized renders)
// ============================================================================

export const selectUser = (state: WebRTCStore) => state.user;
export const selectRoomId = (state: WebRTCStore) => state.roomId;
export const selectSignalingState = (state: WebRTCStore) => state.signalingState;
export const selectPeerConnectionState = (state: WebRTCStore) => state.peerConnectionState;
export const selectMedia = (state: WebRTCStore) => state.media;
export const selectParticipants = (state: WebRTCStore) => state.participants;
export const selectIsConnected = (state: WebRTCStore) =>
  state.signalingState === ConnectionState.CONNECTED &&
  state.peerConnectionState === ConnectionState.CONNECTED;
