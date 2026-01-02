/**
 * Peer Connection Hook (Phase 1 - Pure WebRTC)
 *
 * WHY this exists?
 * - Manages RTCPeerConnection lifecycle
 * - Handles SDP offer/answer exchange
 * - Manages ICE candidate trickle
 *
 * Phase 1 Scope:
 * - 1-to-1 peer connections
 * - Direct P2P media exchange
 * - No SFU (added in Phase 2)
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import {
  DEFAULT_STUN_SERVERS,
  SignalMessageType,
  ConnectionState,
} from '@proctoring/shared';
import {
  mapPeerConnectionState,
  mapIceConnectionState,
} from '@proctoring/webrtc-utils';
import { useWebRTCStore } from '@/store/webrtc.store';

// ============================================================================
// Types
// ============================================================================

interface PeerConnectionConfig {
  onTrack?: (event: RTCTrackEvent, peerId: string) => void;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onConnectionStateChange?: (state: ConnectionState) => void;
}

interface UsePeerConnectionReturn {
  // State
  connectionState: ConnectionState;
  iceConnectionState: RTCIceConnectionState | null;
  iceGatheringState: RTCIceGatheringState | null;

  // Actions
  createOffer: () => Promise<RTCSessionDescriptionInit | null>;
  createAnswer: () => Promise<RTCSessionDescriptionInit | null>;
  setRemoteDescription: (sdp: RTCSessionDescriptionInit) => Promise<boolean>;
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<boolean>;
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => RTCRtpSender | null;
  removeTrack: (sender: RTCRtpSender) => void;
  close: () => void;
  restartIce: () => Promise<RTCSessionDescriptionInit | null>;

  // Refs
  peerConnection: RTCPeerConnection | null;
}

// ============================================================================
// Hook
// ============================================================================

export function usePeerConnection(
  config: PeerConnectionConfig = {}
): UsePeerConnectionReturn {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.DISCONNECTED
  );
  const [iceConnectionState, setIceConnectionState] =
    useState<RTCIceConnectionState | null>(null);
  const [iceGatheringState, setIceGatheringState] =
    useState<RTCIceGatheringState | null>(null);

  const {
    setPeerConnectionState,
    setIceConnectionState: setStoreIceState,
  } = useWebRTCStore();

  /**
   * Initialize peer connection
   */
  const initializePeerConnection = useCallback(() => {
    if (pcRef.current) {
      return pcRef.current;
    }

    const pc = new RTCPeerConnection({
      iceServers: DEFAULT_STUN_SERVERS.map((url) => ({ urls: url })),
      // bundlePolicy: 'max-bundle' is default and optimal for SFU
      bundlePolicy: 'max-bundle',
      // rtcpMuxPolicy: 'require' reduces ports needed
      rtcpMuxPolicy: 'require',
    });

    // Connection state change handler
    pc.onconnectionstatechange = () => {
      const state = mapPeerConnectionState(pc.connectionState);
      setConnectionState(state);
      setPeerConnectionState(state);
      config.onConnectionStateChange?.(state);

      console.log('PeerConnection state:', pc.connectionState);
    };

    // ICE connection state change handler
    pc.oniceconnectionstatechange = () => {
      setIceConnectionState(pc.iceConnectionState);
      setStoreIceState(pc.iceConnectionState);

      console.log('ICE connection state:', pc.iceConnectionState);
    };

    // ICE gathering state change handler
    pc.onicegatheringstate = () => {
      setIceGatheringState(pc.iceGatheringState);
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    // ICE candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('New ICE candidate:', event.candidate.candidate.substring(0, 50));
        config.onIceCandidate?.(event.candidate);
      }
    };

    // Track handler (receiving remote media)
    pc.ontrack = (event) => {
      console.log('Track received:', event.track.kind);
      // For 1-1, we use a placeholder peerId
      config.onTrack?.(event, 'remote');
    };

    // Negotiation needed handler
    pc.onnegotiationneeded = () => {
      console.log('Negotiation needed');
    };

    pcRef.current = pc;
    return pc;
  }, [config, setPeerConnectionState, setStoreIceState]);

  /**
   * Create SDP offer
   */
  const createOffer = useCallback(async (): Promise<RTCSessionDescriptionInit | null> => {
    const pc = initializePeerConnection();

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      await pc.setLocalDescription(offer);

      console.log('Created offer, SDP length:', offer.sdp?.length);

      return offer;
    } catch (error) {
      console.error('Failed to create offer:', error);
      return null;
    }
  }, [initializePeerConnection]);

  /**
   * Create SDP answer
   */
  const createAnswer = useCallback(async (): Promise<RTCSessionDescriptionInit | null> => {
    const pc = pcRef.current;

    if (!pc || !pc.remoteDescription) {
      console.error('Cannot create answer: no remote description set');
      return null;
    }

    try {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('Created answer, SDP length:', answer.sdp?.length);

      return answer;
    } catch (error) {
      console.error('Failed to create answer:', error);
      return null;
    }
  }, []);

  /**
   * Set remote SDP description
   */
  const setRemoteDescription = useCallback(
    async (sdp: RTCSessionDescriptionInit): Promise<boolean> => {
      const pc = initializePeerConnection();

      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        console.log('Remote description set:', sdp.type);
        return true;
      } catch (error) {
        console.error('Failed to set remote description:', error);
        return false;
      }
    },
    [initializePeerConnection]
  );

  /**
   * Add ICE candidate from remote peer
   */
  const addIceCandidate = useCallback(
    async (candidate: RTCIceCandidateInit): Promise<boolean> => {
      const pc = pcRef.current;

      if (!pc) {
        console.error('Cannot add ICE candidate: no peer connection');
        return false;
      }

      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        console.log('Added ICE candidate');
        return true;
      } catch (error) {
        console.error('Failed to add ICE candidate:', error);
        return false;
      }
    },
    []
  );

  /**
   * Add local media track to peer connection
   */
  const addTrack = useCallback(
    (track: MediaStreamTrack, stream: MediaStream): RTCRtpSender | null => {
      const pc = initializePeerConnection();

      try {
        const sender = pc.addTrack(track, stream);
        console.log('Added track:', track.kind);
        return sender;
      } catch (error) {
        console.error('Failed to add track:', error);
        return null;
      }
    },
    [initializePeerConnection]
  );

  /**
   * Remove track from peer connection
   */
  const removeTrack = useCallback((sender: RTCRtpSender): void => {
    const pc = pcRef.current;

    if (!pc) {
      return;
    }

    try {
      pc.removeTrack(sender);
      console.log('Removed track');
    } catch (error) {
      console.error('Failed to remove track:', error);
    }
  }, []);

  /**
   * Restart ICE (for recovering from connection issues)
   */
  const restartIce = useCallback(async (): Promise<RTCSessionDescriptionInit | null> => {
    const pc = pcRef.current;

    if (!pc) {
      return null;
    }

    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);

      console.log('ICE restart initiated');

      return offer;
    } catch (error) {
      console.error('Failed to restart ICE:', error);
      return null;
    }
  }, []);

  /**
   * Close peer connection
   */
  const close = useCallback((): void => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    setPeerConnectionState(ConnectionState.DISCONNECTED);
    setIceConnectionState(null);
    setIceGatheringState(null);
  }, [setPeerConnectionState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      close();
    };
  }, [close]);

  return {
    connectionState,
    iceConnectionState,
    iceGatheringState,
    createOffer,
    createAnswer,
    setRemoteDescription,
    addIceCandidate,
    addTrack,
    removeTrack,
    close,
    restartIce,
    peerConnection: pcRef.current,
  };
}
