/**
 * Media Stream Hook
 *
 * Manages local media streams for webcam, screen share, and audio.
 * Integrates with Zustand store for state management.
 */

import { useCallback } from 'react';
import {
  getWebcamStream,
  getScreenShareStream,
  getAudioStream,
  stopAllTracks,
} from '@proctoring/webrtc-utils';
import { useWebRTCStore } from '@/store/webrtc.store';

interface UseMediaReturn {
  // State
  webcamEnabled: boolean;
  screenEnabled: boolean;
  audioEnabled: boolean;
  localWebcam: MediaStream | null;
  localScreen: MediaStream | null;
  localAudio: MediaStream | null;

  // Actions
  startWebcam: (deviceId?: string) => Promise<{ success: boolean; error?: string }>;
  stopWebcam: () => void;
  startScreenShare: () => Promise<{ success: boolean; error?: string }>;
  stopScreenShare: () => void;
  startAudio: (deviceId?: string) => Promise<{ success: boolean; error?: string }>;
  stopAudio: () => void;
  stopAllMedia: () => void;
}

export function useMedia(): UseMediaReturn {
  const {
    media,
    mediaEnabled,
    setLocalWebcam,
    setLocalScreen,
    setLocalAudio,
    setError,
  } = useWebRTCStore();

  /**
   * Start webcam
   */
  const startWebcam = useCallback(
    async (deviceId?: string) => {
      const result = await getWebcamStream(deviceId);

      if ('error' in result) {
        setError(result.error);
        return { success: false, error: result.error };
      }

      setLocalWebcam(result.stream);
      return { success: true };
    },
    [setLocalWebcam, setError]
  );

  /**
   * Stop webcam
   */
  const stopWebcam = useCallback(() => {
    if (media.localWebcam) {
      stopAllTracks(media.localWebcam);
      setLocalWebcam(null);
    }
  }, [media.localWebcam, setLocalWebcam]);

  /**
   * Start screen share
   */
  const startScreenShare = useCallback(async () => {
    const result = await getScreenShareStream();

    if ('error' in result) {
      setError(result.error);
      return { success: false, error: result.error };
    }

    // Handle user stopping share via browser UI
    result.stream.getVideoTracks()[0].onended = () => {
      setLocalScreen(null);
    };

    setLocalScreen(result.stream);
    return { success: true };
  }, [setLocalScreen, setError]);

  /**
   * Stop screen share
   */
  const stopScreenShare = useCallback(() => {
    if (media.localScreen) {
      stopAllTracks(media.localScreen);
      setLocalScreen(null);
    }
  }, [media.localScreen, setLocalScreen]);

  /**
   * Start audio
   */
  const startAudio = useCallback(
    async (deviceId?: string) => {
      const result = await getAudioStream(deviceId);

      if ('error' in result) {
        setError(result.error);
        return { success: false, error: result.error };
      }

      setLocalAudio(result.stream);
      return { success: true };
    },
    [setLocalAudio, setError]
  );

  /**
   * Stop audio
   */
  const stopAudio = useCallback(() => {
    if (media.localAudio) {
      stopAllTracks(media.localAudio);
      setLocalAudio(null);
    }
  }, [media.localAudio, setLocalAudio]);

  /**
   * Stop all media streams
   */
  const stopAllMedia = useCallback(() => {
    stopWebcam();
    stopScreenShare();
    stopAudio();
  }, [stopWebcam, stopScreenShare, stopAudio]);

  return {
    webcamEnabled: mediaEnabled.webcam,
    screenEnabled: mediaEnabled.screen,
    audioEnabled: mediaEnabled.audio,
    localWebcam: media.localWebcam,
    localScreen: media.localScreen,
    localAudio: media.localAudio,
    startWebcam,
    stopWebcam,
    startScreenShare,
    stopScreenShare,
    startAudio,
    stopAudio,
    stopAllMedia,
  };
}
