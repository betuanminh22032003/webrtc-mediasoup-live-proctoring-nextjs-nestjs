/**
 * Demo Page - Phase 1 Pure WebRTC Testing
 *
 * This page demonstrates:
 * 1. Camera/microphone access
 * 2. Screen sharing
 * 3. Local preview (no peer connection yet)
 *
 * WHY start with local preview?
 * - Verify media APIs work before adding complexity
 * - Debug device issues without network factors
 * - Build UI components for media display
 */

'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  getWebcamStream,
  getScreenShareStream,
  getAudioStream,
  stopAllTracks,
  enumerateDevices,
  type DeviceList,
} from '@proctoring/webrtc-utils';

interface MediaState {
  webcam: MediaStream | null;
  screen: MediaStream | null;
  audio: MediaStream | null;
}

interface DeviceState {
  webcamEnabled: boolean;
  screenEnabled: boolean;
  audioEnabled: boolean;
}

export default function DemoPage(): JSX.Element {
  // Media streams
  const [media, setMedia] = useState<MediaState>({
    webcam: null,
    screen: null,
    audio: null,
  });

  // Device state
  const [devices, setDevices] = useState<DeviceState>({
    webcamEnabled: false,
    screenEnabled: false,
    audioEnabled: false,
  });

  // Available devices
  const [availableDevices, setAvailableDevices] = useState<DeviceList | null>(null);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Video refs
  const webcamRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);

  // Enumerate devices on mount
  useEffect(() => {
    enumerateDevices()
      .then(setAvailableDevices)
      .catch((err) => console.error('Failed to enumerate devices:', err));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (media.webcam) stopAllTracks(media.webcam);
      if (media.screen) stopAllTracks(media.screen);
      if (media.audio) stopAllTracks(media.audio);
    };
  }, [media]);

  /**
   * Toggle webcam on/off
   */
  const toggleWebcam = useCallback(async () => {
    setError(null);

    if (devices.webcamEnabled && media.webcam) {
      // Stop webcam
      stopAllTracks(media.webcam);
      setMedia((prev) => ({ ...prev, webcam: null }));
      setDevices((prev) => ({ ...prev, webcamEnabled: false }));
      if (webcamRef.current) {
        webcamRef.current.srcObject = null;
      }
    } else {
      // Start webcam
      const result = await getWebcamStream();

      if ('error' in result) {
        setError(result.error);
        return;
      }

      setMedia((prev) => ({ ...prev, webcam: result.stream }));
      setDevices((prev) => ({ ...prev, webcamEnabled: true }));

      if (webcamRef.current) {
        webcamRef.current.srcObject = result.stream;
      }
    }
  }, [devices.webcamEnabled, media.webcam]);

  /**
   * Toggle screen share on/off
   */
  const toggleScreenShare = useCallback(async () => {
    setError(null);

    if (devices.screenEnabled && media.screen) {
      // Stop screen share
      stopAllTracks(media.screen);
      setMedia((prev) => ({ ...prev, screen: null }));
      setDevices((prev) => ({ ...prev, screenEnabled: false }));
      if (screenRef.current) {
        screenRef.current.srcObject = null;
      }
    } else {
      // Start screen share
      const result = await getScreenShareStream();

      if ('error' in result) {
        setError(result.error);
        return;
      }

      setMedia((prev) => ({ ...prev, screen: result.stream }));
      setDevices((prev) => ({ ...prev, screenEnabled: true }));

      if (screenRef.current) {
        screenRef.current.srcObject = result.stream;
      }

      // Handle user stopping share via browser UI
      result.stream.getVideoTracks()[0].onended = () => {
        setMedia((prev) => ({ ...prev, screen: null }));
        setDevices((prev) => ({ ...prev, screenEnabled: false }));
        if (screenRef.current) {
          screenRef.current.srcObject = null;
        }
      };
    }
  }, [devices.screenEnabled, media.screen]);

  /**
   * Toggle audio on/off
   */
  const toggleAudio = useCallback(async () => {
    setError(null);

    if (devices.audioEnabled && media.audio) {
      stopAllTracks(media.audio);
      setMedia((prev) => ({ ...prev, audio: null }));
      setDevices((prev) => ({ ...prev, audioEnabled: false }));
    } else {
      const result = await getAudioStream();

      if ('error' in result) {
        setError(result.error);
        return;
      }

      setMedia((prev) => ({ ...prev, audio: result.stream }));
      setDevices((prev) => ({ ...prev, audioEnabled: true }));
    }
  }, [devices.audioEnabled, media.audio]);

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">
            🧪 Phase 1: Media Device Testing
          </h1>
          <p className="text-gray-400">
            Test your camera, microphone, and screen sharing before connecting to
            peers.
          </p>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/50 border border-red-500 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-red-400">⚠️</span>
              <span>{error}</span>
            </div>
          </div>
        )}

        {/* Video Previews */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Webcam Preview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Webcam</h2>
              <StatusIndicator enabled={devices.webcamEnabled} />
            </div>
            <div className="video-container">
              {devices.webcamEnabled ? (
                <video
                  ref={webcamRef}
                  autoPlay
                  playsInline
                  muted
                  className="video-element mirror"
                  style={{ transform: 'scaleX(-1)' }}
                />
              ) : (
                <div className="video-placeholder">
                  <span>Camera Off</span>
                </div>
              )}
            </div>
          </div>

          {/* Screen Preview */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Screen Share</h2>
              <StatusIndicator enabled={devices.screenEnabled} />
            </div>
            <div className="video-container">
              {devices.screenEnabled ? (
                <video
                  ref={screenRef}
                  autoPlay
                  playsInline
                  muted
                  className="video-element"
                />
              ) : (
                <div className="video-placeholder">
                  <span>Not Sharing</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 mb-8">
          <button
            onClick={toggleWebcam}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              devices.webcamEnabled
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {devices.webcamEnabled ? '📷 Stop Camera' : '📷 Start Camera'}
          </button>

          <button
            onClick={toggleScreenShare}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              devices.screenEnabled
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {devices.screenEnabled ? '🖥️ Stop Sharing' : '🖥️ Share Screen'}
          </button>

          <button
            onClick={toggleAudio}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              devices.audioEnabled
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-purple-600 hover:bg-purple-700'
            }`}
          >
            {devices.audioEnabled ? '🎤 Stop Mic' : '🎤 Start Mic'}
          </button>
        </div>

        {/* Device Info */}
        {availableDevices && (
          <div className="p-6 bg-gray-900 rounded-xl">
            <h3 className="text-lg font-semibold mb-4">Available Devices</h3>
            <div className="grid md:grid-cols-3 gap-6">
              <DeviceList
                title="Cameras"
                devices={availableDevices.videoInputs}
              />
              <DeviceList
                title="Microphones"
                devices={availableDevices.audioInputs}
              />
              <DeviceList
                title="Speakers"
                devices={availableDevices.audioOutputs}
              />
            </div>
          </div>
        )}

        {/* What's Next */}
        <div className="mt-8 p-6 bg-gray-900 rounded-xl border border-gray-800">
          <h3 className="text-lg font-semibold mb-4">✅ What We&apos;ve Learned</h3>
          <ul className="space-y-2 text-gray-400">
            <li>
              • <code className="text-blue-400">getUserMedia()</code> - Request camera/mic access
            </li>
            <li>
              • <code className="text-blue-400">getDisplayMedia()</code> - Request screen share
            </li>
            <li>
              • <code className="text-blue-400">enumerateDevices()</code> - List available devices
            </li>
            <li>• Media constraints for quality control</li>
            <li>• Track lifecycle management (start/stop)</li>
          </ul>

          <h3 className="text-lg font-semibold mt-6 mb-4">⏭️ Next Step: Peer Connection</h3>
          <p className="text-gray-400 mb-4">
            Now that we have local media, the next step is to establish a
            peer-to-peer WebRTC connection to send this media to another user.
          </p>
          <a
            href="/candidate"
            className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Continue to Candidate View →
          </a>
        </div>
      </div>
    </main>
  );
}

function StatusIndicator({ enabled }: { enabled: boolean }): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`status-indicator ${
          enabled ? 'status-connected' : 'status-disconnected'
        }`}
      />
      <span className="text-sm text-gray-400">
        {enabled ? 'Active' : 'Inactive'}
      </span>
    </div>
  );
}

function DeviceList({
  title,
  devices,
}: {
  title: string;
  devices: MediaDeviceInfo[];
}): JSX.Element {
  return (
    <div>
      <h4 className="font-medium mb-2">{title}</h4>
      {devices.length > 0 ? (
        <ul className="space-y-1">
          {devices.map((device, index) => (
            <li key={device.deviceId || index} className="text-sm text-gray-400">
              {device.label || `Device ${index + 1}`}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">No devices found</p>
      )}
    </div>
  );
}
