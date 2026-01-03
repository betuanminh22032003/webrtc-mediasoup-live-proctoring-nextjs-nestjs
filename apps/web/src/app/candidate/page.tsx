'use client';

/**
 * Candidate Exam Page
 *
 * Full exam-taking interface with:
 * - Webcam preview (self-view)
 * - Screen sharing controls
 * - Connection status
 * - Exam timer
 * - Violation alerts
 *
 * PHASE 3: Proctoring Logic Implementation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ConnectionState,
  UserRole,
  ViolationSeverity,
} from '@proctoring/shared';
import type { ProctoringEventType } from '@proctoring/shared';
import { useMedia } from '@/hooks/useMedia';
import { useSignaling } from '@/hooks/useSignaling';
import { useViolationDetection } from '@/hooks/useViolationDetection';
import { useWebRTCStore } from '@/store/webrtc.store';
import { useProctoringStore } from '@/store/proctoring.store';

/**
 * Generate UUID using crypto API
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// Constants
// ============================================================================

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';
const EXAM_DURATION_MINUTES = 60; // Default exam duration

// ============================================================================
// Page Component
// ============================================================================

export default function CandidatePage(): JSX.Element {
  const router = useRouter();
  const [examStarted, setExamStarted] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Generate user ID on mount
  const [userId] = useState(() => generateId());
  const [roomId] = useState(() => 'exam-room-' + Date.now().toString(36));

  // Stores
  const { signalingState, setUser, setRoomId } = useWebRTCStore();
  const { session, setSession, startExam, events, activeAlerts, dismissAlert, setRole } =
    useProctoringStore();

  // Hooks
  const {
    webcamEnabled,
    screenEnabled,
    localWebcam,
    localScreen,
    startWebcam,
    startScreenShare,
    stopAllMedia,
  } = useMedia();

  const { isConnected, connect, disconnect, send, lastError } = useSignaling({
    url: WS_URL,
    autoConnect: false,
  });

  // Violation detection
  const { startMonitoring, stopMonitoring, violationCount } = useViolationDetection({
    userId,
    roomId,
    detectTabSwitch: true,
    detectWindowBlur: true,
    monitorWebcam: true,
    monitorScreenShare: true,
    detectCopyPaste: false, // Enable for stricter exams
  });

  /**
   * Initialize user and session
   */
  useEffect(() => {
    setUser({
      id: userId,
      role: UserRole.CANDIDATE,
      displayName: `Candidate ${userId.slice(0, 8)}`,
    });
    setRoomId(roomId);
    setRole(UserRole.CANDIDATE);

    setSession({
      roomId,
      examName: 'Proctored Examination',
      startedAt: null,
      endsAt: null,
      duration: EXAM_DURATION_MINUTES,
      status: 'waiting',
    });

    return () => {
      stopAllMedia();
      disconnect();
      stopMonitoring();
    };
  }, [userId, roomId, setUser, setRoomId, setSession, setRole, stopAllMedia, disconnect, stopMonitoring]);

  /**
   * Run setup: Enable webcam and screen share
   */
  const runSetup = useCallback(async () => {
    setSetupError(null);

    // Start webcam
    const webcamResult = await startWebcam();
    if (!webcamResult.success) {
      setSetupError(`Webcam error: ${webcamResult.error}. Please allow camera access and try again.`);
      return;
    }

    // Start screen share
    const screenResult = await startScreenShare();
    if (!screenResult.success) {
      setSetupError(`Screen share error: ${screenResult.error}. Please share your entire screen.`);
      return;
    }

    // Connect to server
    connect();

    setSetupComplete(true);
  }, [startWebcam, startScreenShare, connect]);

  /**
   * Start the exam
   */
  const handleStartExam = useCallback(() => {
    if (!setupComplete || !webcamEnabled || !screenEnabled) {
      setSetupError('Please complete setup first');
      return;
    }

    setExamStarted(true);
    startExam();
    startMonitoring();

    // Notify server
    send('ROOM_JOIN' as unknown as never, { roomId, role: UserRole.CANDIDATE });
  }, [setupComplete, webcamEnabled, screenEnabled, startExam, startMonitoring, send, roomId]);

  /**
   * End the exam
   */
  const handleEndExam = useCallback(() => {
    if (!confirm('Are you sure you want to end the exam? This cannot be undone.')) {
      return;
    }

    stopMonitoring();
    setExamStarted(false);
    disconnect();
    router.push('/');
  }, [stopMonitoring, disconnect, router]);

  /**
   * Calculate remaining time
   */
  const remainingTime = useMemo(() => {
    if (!session?.startedAt || !session.duration) return null;

    const endTime = session.startedAt + session.duration * 60 * 1000;
    const remaining = Math.max(0, endTime - Date.now());

    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    return { minutes, seconds, total: remaining };
  }, [session]);

  // Update timer every second
  useEffect(() => {
    if (!examStarted) return;

    const interval = setInterval(() => {
      // Force re-render for timer
    }, 1000);

    return () => clearInterval(interval);
  }, [examStarted]);

  return (
    <main className="min-h-screen flex flex-col bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">📝 Candidate Exam</h1>
            <ConnectionStatusBadge state={signalingState} />
          </div>
          <div className="flex items-center gap-4">
            {examStarted && remainingTime && (
              <ExamTimer minutes={remainingTime.minutes} seconds={remainingTime.seconds} />
            )}
            {examStarted && (
              <button
                onClick={handleEndExam}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm"
              >
                End Exam
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 p-6">
        <div className="max-w-7xl mx-auto">
          {!examStarted ? (
            /* Setup Phase */
            <SetupPanel
              webcamEnabled={webcamEnabled}
              screenEnabled={screenEnabled}
              setupComplete={setupComplete}
              setupError={setupError}
              isConnected={isConnected}
              connectionError={lastError}
              onRunSetup={runSetup}
              onStartExam={handleStartExam}
              localWebcam={localWebcam}
            />
          ) : (
            /* Exam Phase */
            <ExamPanel
              localWebcam={localWebcam}
              localScreen={localScreen}
              violationCount={violationCount}
              events={events}
            />
          )}
        </div>
      </div>

      {/* Alert Toast */}
      <AlertContainer alerts={activeAlerts} onDismiss={dismissAlert} />
    </main>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function ConnectionStatusBadge({ state }: { state: ConnectionState }): JSX.Element {
  const config = {
    [ConnectionState.CONNECTED]: { color: 'bg-green-500', label: 'Connected' },
    [ConnectionState.CONNECTING]: { color: 'bg-yellow-500', label: 'Connecting...' },
    [ConnectionState.DISCONNECTED]: { color: 'bg-gray-500', label: 'Disconnected' },
    [ConnectionState.RECONNECTING]: { color: 'bg-yellow-500', label: 'Reconnecting...' },
    [ConnectionState.FAILED]: { color: 'bg-red-500', label: 'Failed' },
  };

  const { color, label } = config[state];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );
}

function ExamTimer({ minutes, seconds }: { minutes: number; seconds: number }): JSX.Element {
  const isLowTime = minutes < 5;

  return (
    <div
      className={`px-4 py-2 rounded-lg font-mono text-lg ${
        isLowTime ? 'bg-red-900 text-red-200' : 'bg-gray-800'
      }`}
    >
      ⏱️ {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
    </div>
  );
}

interface SetupPanelProps {
  webcamEnabled: boolean;
  screenEnabled: boolean;
  setupComplete: boolean;
  setupError: string | null;
  isConnected: boolean;
  connectionError: string | null;
  onRunSetup: () => void;
  onStartExam: () => void;
  localWebcam: MediaStream | null;
}

function SetupPanel({
  webcamEnabled,
  screenEnabled,
  setupComplete,
  setupError,
  isConnected,
  connectionError,
  onRunSetup,
  onStartExam,
  localWebcam,
}: SetupPanelProps): JSX.Element {
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Exam Setup</h2>
        <p className="text-gray-400">
          Complete the following steps before starting your exam
        </p>
      </div>

      {/* Webcam Preview */}
      <div className="bg-gray-900 rounded-xl p-6 mb-6">
        <h3 className="font-semibold mb-4">1. Camera Preview</h3>
        <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden mb-4">
          {localWebcam ? (
            <video
              autoPlay
              playsInline
              muted
              ref={(video) => {
                if (video && video.srcObject !== localWebcam) {
                  video.srcObject = localWebcam;
                }
              }}
              className="w-full h-full object-cover mirror"
              style={{ transform: 'scaleX(-1)' }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-500">
              📷 Camera preview will appear here
            </div>
          )}
        </div>
      </div>

      {/* Setup Checklist */}
      <div className="bg-gray-900 rounded-xl p-6 mb-6">
        <h3 className="font-semibold mb-4">2. Setup Checklist</h3>
        <ul className="space-y-3">
          <SetupItem label="Webcam enabled" checked={webcamEnabled} />
          <SetupItem label="Screen sharing enabled" checked={screenEnabled} />
          <SetupItem label="Connected to server" checked={isConnected} />
        </ul>
      </div>

      {/* Error Display */}
      {(setupError || connectionError) && (
        <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 mb-6">
          <p className="text-red-200">{setupError || connectionError}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-4">
        {!setupComplete ? (
          <button
            onClick={onRunSetup}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold"
          >
            Start Setup
          </button>
        ) : (
          <button
            onClick={onStartExam}
            disabled={!webcamEnabled || !screenEnabled || !isConnected}
            className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:cursor-not-allowed rounded-lg font-semibold"
          >
            Begin Exam
          </button>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-6 p-4 bg-gray-900 rounded-xl">
        <h4 className="font-semibold mb-2">📋 Instructions</h4>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>• Keep your webcam enabled throughout the exam</li>
          <li>• Do not switch tabs or minimize the browser</li>
          <li>• Ensure your face is visible at all times</li>
          <li>• Screen sharing must remain active</li>
          <li>• Any violations will be recorded and reviewed</li>
        </ul>
      </div>
    </div>
  );
}

function SetupItem({ label, checked }: { label: string; checked: boolean }): JSX.Element {
  return (
    <li className="flex items-center gap-3">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center ${
          checked ? 'bg-green-600' : 'bg-gray-700'
        }`}
      >
        {checked ? '✓' : '○'}
      </div>
      <span className={checked ? 'text-white' : 'text-gray-500'}>{label}</span>
    </li>
  );
}

interface ExamPanelProps {
  localWebcam: MediaStream | null;
  localScreen: MediaStream | null;
  violationCount: number;
  events: Array<{ id: string; type: ProctoringEventType; timestamp: number; severity: ViolationSeverity }>;
}

function ExamPanel({
  localWebcam,
  localScreen,
  violationCount,
  events,
}: ExamPanelProps): JSX.Element {
  // Get recent events (last 5)
  const recentEvents = events.slice(0, 5);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Exam Area */}
      <div className="lg:col-span-2 space-y-6">
        {/* Exam Content Placeholder */}
        <div className="bg-gray-900 rounded-xl p-6 min-h-[400px]">
          <h2 className="text-xl font-semibold mb-4">📝 Exam Questions</h2>
          <div className="text-gray-400">
            <p className="mb-4">
              This is where your exam questions would appear. In a real implementation,
              this would be integrated with an exam management system.
            </p>
            <div className="bg-gray-800 rounded-lg p-4">
              <p className="font-medium text-white mb-2">Sample Question 1:</p>
              <p>What is the primary advantage of using an SFU (Selective Forwarding Unit) 
              over a mesh topology in WebRTC applications with many participants?</p>
              <div className="mt-4 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="q1" className="accent-blue-500" />
                  <span>Better video quality</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="q1" className="accent-blue-500" />
                  <span>Reduced bandwidth usage per client</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="q1" className="accent-blue-500" />
                  <span>Lower server costs</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="q1" className="accent-blue-500" />
                  <span>End-to-end encryption</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Self View (Webcam) */}
        <div className="bg-gray-900 rounded-xl p-4">
          <h3 className="font-semibold mb-3 text-sm">📷 Your Camera</h3>
          <div className="aspect-video bg-gray-800 rounded-lg overflow-hidden">
            {localWebcam ? (
              <video
                autoPlay
                playsInline
                muted
                ref={(video) => {
                  if (video && video.srcObject !== localWebcam) {
                    video.srcObject = localWebcam;
                  }
                }}
                className="w-full h-full object-cover"
                style={{ transform: 'scaleX(-1)' }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-red-400">
                ⚠️ Webcam disabled
              </div>
            )}
          </div>
        </div>

        {/* Status Panel */}
        <div className="bg-gray-900 rounded-xl p-4">
          <h3 className="font-semibold mb-3 text-sm">📊 Status</h3>
          <div className="space-y-2">
            <StatusRow
              label="Webcam"
              status={localWebcam ? 'active' : 'inactive'}
              icon="📷"
            />
            <StatusRow
              label="Screen Share"
              status={localScreen ? 'active' : 'inactive'}
              icon="🖥️"
            />
            <StatusRow
              label="Violations"
              status={violationCount > 0 ? 'warning' : 'ok'}
              value={violationCount.toString()}
              icon="⚠️"
            />
          </div>
        </div>

        {/* Recent Events */}
        <div className="bg-gray-900 rounded-xl p-4">
          <h3 className="font-semibold mb-3 text-sm">📋 Recent Events</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {recentEvents.length === 0 ? (
              <p className="text-gray-500 text-sm">No events yet</p>
            ) : (
              recentEvents.map((event) => (
                <EventItem key={event.id} event={event} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  label,
  status,
  value,
  icon,
}: {
  label: string;
  status: 'active' | 'inactive' | 'warning' | 'ok';
  value?: string;
  icon: string;
}): JSX.Element {
  const colors = {
    active: 'text-green-400',
    inactive: 'text-red-400',
    warning: 'text-yellow-400',
    ok: 'text-gray-400',
  };

  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-400">
        {icon} {label}
      </span>
      <span className={colors[status]}>{value || (status === 'active' ? 'On' : 'Off')}</span>
    </div>
  );
}

function EventItem({
  event,
}: {
  event: { type: ProctoringEventType; timestamp: number; severity: ViolationSeverity };
}): JSX.Element {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const severityColors = {
    [ViolationSeverity.INFO]: 'border-gray-600',
    [ViolationSeverity.WARNING]: 'border-yellow-600',
    [ViolationSeverity.CRITICAL]: 'border-red-600',
    [ViolationSeverity.FATAL]: 'border-red-800',
  };

  return (
    <div
      className={`text-xs p-2 bg-gray-800 rounded border-l-2 ${severityColors[event.severity]}`}
    >
      <div className="flex justify-between">
        <span className="text-gray-300">{formatEventType(event.type)}</span>
        <span className="text-gray-500">{time}</span>
      </div>
    </div>
  );
}

function formatEventType(type: ProctoringEventType): string {
  return type.split('.').pop()?.replace(/_/g, ' ') || type;
}

interface AlertContainerProps {
  alerts: Array<{
    title: string;
    message: string;
    severity: ViolationSeverity;
    dismissable: boolean;
  }>;
  onDismiss: (index: number) => void;
}

function AlertContainer({ alerts, onDismiss }: AlertContainerProps): JSX.Element | null {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {alerts.map((alert, index) => (
        <div
          key={index}
          className={`p-4 rounded-lg shadow-lg border ${
            alert.severity === ViolationSeverity.CRITICAL ||
            alert.severity === ViolationSeverity.FATAL
              ? 'bg-red-900 border-red-700'
              : 'bg-yellow-900 border-yellow-700'
          }`}
        >
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-semibold">{alert.title}</h4>
              <p className="text-sm mt-1 opacity-80">{alert.message}</p>
            </div>
            {alert.dismissable && (
              <button
                onClick={() => onDismiss(index)}
                className="ml-4 text-lg opacity-60 hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
