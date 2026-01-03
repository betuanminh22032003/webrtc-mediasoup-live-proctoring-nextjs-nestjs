/**
 * Media Device Utilities
 *
 * WHY this module?
 * - Device enumeration has browser quirks
 * - Permission handling is complex
 * - Centralizes error handling for media access
 */

import {
  WEBCAM_CONSTRAINTS,
  SCREEN_SHARE_CONSTRAINTS,
  AUDIO_CONSTRAINTS,
  ErrorCodes,
  MediaTrackType,
} from '@proctoring/shared';

/**
 * Result of media device enumeration
 */
export interface DeviceList {
  videoInputs: MediaDeviceInfo[];
  audioInputs: MediaDeviceInfo[];
  audioOutputs: MediaDeviceInfo[];
}

/**
 * Enumerate all available media devices
 *
 * WHY request permission first?
 * - Before permission, device labels are empty (privacy)
 * - We need labels for device selection UI
 */
export async function enumerateDevices(): Promise<DeviceList> {
  // Check if mediaDevices API is available
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    throw new Error('Media devices API not supported in this browser');
  }

  // Request permission to get device labels
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    // Stop tracks immediately - we just needed permission
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    // Permission denied or no devices - continue with enumeration
  }

  const devices = await navigator.mediaDevices.enumerateDevices();

  return {
    videoInputs: devices.filter((d) => d.kind === 'videoinput'),
    audioInputs: devices.filter((d) => d.kind === 'audioinput'),
    audioOutputs: devices.filter((d) => d.kind === 'audiooutput'),
  };
}

/**
 * Get user media with error translation
 *
 * WHY custom error handling?
 * - Browser errors are inconsistent and unclear
 * - Need to map to our error codes for consistent handling
 */
export async function getUserMedia(
  constraints: MediaStreamConstraints
): Promise<{ stream: MediaStream } | { error: string; code: string }> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      error: 'getUserMedia is not supported in this browser',
      code: ErrorCodes.MEDIA_NOT_SUPPORTED,
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return { stream };
  } catch (error) {
    return translateMediaError(error);
  }
}

/**
 * Get webcam stream with proctoring constraints
 */
export async function getWebcamStream(
  deviceId?: string
): Promise<{ stream: MediaStream } | { error: string; code: string }> {
  const constraints: MediaStreamConstraints = {
    video: {
      ...WEBCAM_CONSTRAINTS,
      ...(deviceId && { deviceId: { exact: deviceId } }),
    },
    audio: false,
  };

  return getUserMedia(constraints);
}

/**
 * Get audio stream with proctoring constraints
 */
export async function getAudioStream(
  deviceId?: string
): Promise<{ stream: MediaStream } | { error: string; code: string }> {
  const constraints: MediaStreamConstraints = {
    video: false,
    audio: {
      ...AUDIO_CONSTRAINTS,
      ...(deviceId && { deviceId: { exact: deviceId } }),
    },
  };

  return getUserMedia(constraints);
}

/**
 * Get screen share stream
 *
 * WHY separate function?
 * - getDisplayMedia has different API than getUserMedia
 * - Different error handling needed
 */
export async function getScreenShareStream(): Promise<
  { stream: MediaStream } | { error: string; code: string }
> {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    return {
      error: 'Screen sharing is not supported in this browser',
      code: ErrorCodes.MEDIA_NOT_SUPPORTED,
    };
  }

  try {
    // TypeScript doesn't know about displaySurface yet
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: SCREEN_SHARE_CONSTRAINTS as MediaTrackConstraints,
      audio: false, // Screen audio not needed for proctoring
    });

    return { stream };
  } catch (error) {
    // Special handling for user cancellation
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      return {
        error: 'Screen sharing was cancelled',
        code: ErrorCodes.MEDIA_SCREEN_SHARE_CANCELLED,
      };
    }
    return translateMediaError(error);
  }
}

/**
 * Translate browser media errors to our error codes
 */
function translateMediaError(error: unknown): { error: string; code: string } {
  if (!(error instanceof DOMException)) {
    return {
      error: 'Unknown media error',
      code: ErrorCodes.SYSTEM_INTERNAL_ERROR,
    };
  }

  switch (error.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        error: 'Media permission denied',
        code: ErrorCodes.MEDIA_PERMISSION_DENIED,
      };

    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        error: 'Media device not found',
        code: ErrorCodes.MEDIA_DEVICE_NOT_FOUND,
      };

    case 'NotReadableError':
    case 'TrackStartError':
      return {
        error: 'Media device is in use',
        code: ErrorCodes.MEDIA_DEVICE_IN_USE,
      };

    case 'OverconstrainedError':
      return {
        error: 'Media constraints cannot be satisfied',
        code: ErrorCodes.MEDIA_OVERCONSTRAINED,
      };

    case 'AbortError':
      return {
        error: 'Media request was aborted',
        code: ErrorCodes.MEDIA_NOT_ALLOWED,
      };

    default:
      return {
        error: error.message || 'Media error',
        code: ErrorCodes.SYSTEM_INTERNAL_ERROR,
      };
  }
}

/**
 * Get track type from MediaStreamTrack
 */
export function getTrackType(track: MediaStreamTrack): MediaTrackType | null {
  if (track.kind === 'audio') {
    return MediaTrackType.AUDIO;
  }

  if (track.kind === 'video') {
    // Check if it's a screen share by looking at track label
    // This is heuristic - better to track this at capture time
    const label = track.label.toLowerCase();
    if (
      label.includes('screen') ||
      label.includes('window') ||
      label.includes('monitor') ||
      label.includes('display')
    ) {
      return MediaTrackType.SCREEN;
    }
    return MediaTrackType.WEBCAM;
  }

  return null;
}

/**
 * Stop all tracks in a stream
 */
export function stopAllTracks(stream: MediaStream): void {
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}

/**
 * Check if camera permission is granted
 */
export async function checkCameraPermission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const result = await navigator.permissions.query({
      name: 'camera' as PermissionName,
    });
    return result.state;
  } catch {
    // Permissions API not supported - try to get media
    return 'prompt';
  }
}

/**
 * Check if microphone permission is granted
 */
export async function checkMicrophonePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  try {
    const result = await navigator.permissions.query({
      name: 'microphone' as PermissionName,
    });
    return result.state;
  } catch {
    return 'prompt';
  }
}
