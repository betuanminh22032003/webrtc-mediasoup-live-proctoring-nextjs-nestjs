/**
 * Proctoring Store (Zustand)
 *
 * WHY separate from webrtc.store?
 * - Separation of concerns: WebRTC handles connection, this handles proctoring logic
 * - Proctoring events need different persistence/sync strategies
 * - Easier to test proctoring logic in isolation
 *
 * This store manages:
 * - Proctoring events (violations, media changes, etc.)
 * - Candidate media states (from proctor's view)
 * - Alert state
 * - Exam session metadata
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ProctoringEvent, User, MediaState } from '@proctoring/shared';
import { ProctoringEventType, ViolationSeverity } from '@proctoring/shared';
import type { UserRole } from '@proctoring/shared';

/**
 * Generate UUID using crypto API
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// Types
// ============================================================================

interface CandidateState {
  user: User;
  mediaState: MediaState;
  lastSeen: number;
  connectionQuality: 'good' | 'fair' | 'poor' | 'disconnected';
  violationCount: number;
  isHighlighted: boolean;
}

interface ExamSession {
  roomId: string;
  examName: string;
  startedAt: number | null;
  endsAt: number | null;
  duration: number; // in minutes
  status: 'waiting' | 'active' | 'paused' | 'ended';
}

interface AlertState {
  isVisible: boolean;
  title: string;
  message: string;
  severity: ViolationSeverity;
  candidateId?: string;
  dismissable: boolean;
}

interface ProctoringState {
  // Role
  role: UserRole | null;

  // Events
  events: ProctoringEvent[];
  maxEvents: number; // Limit stored events for memory

  // Candidate states (for proctor view)
  candidates: Map<string, CandidateState>;

  // Session
  session: ExamSession | null;

  // Alerts
  activeAlerts: AlertState[];
  alertSound: boolean;

  // Violation tracking
  pendingViolations: Map<string, NodeJS.Timeout>;
}

interface ProctoringActions {
  // Role
  setRole: (role: UserRole) => void;

  // Events
  addEvent: (event: Omit<ProctoringEvent, 'id' | 'timestamp'>) => void;
  clearEvents: () => void;
  getEventsByUser: (userId: string) => ProctoringEvent[];
  getEventsByType: (type: ProctoringEventType) => ProctoringEvent[];

  // Candidates
  setCandidates: (candidates: CandidateState[]) => void;
  addCandidate: (candidate: CandidateState) => void;
  removeCandidate: (userId: string) => void;
  updateCandidateMedia: (userId: string, mediaState: Partial<MediaState>) => void;
  updateCandidateConnection: (userId: string, quality: CandidateState['connectionQuality']) => void;
  highlightCandidate: (userId: string, highlight: boolean) => void;
  incrementViolation: (userId: string) => void;

  // Session
  setSession: (session: ExamSession) => void;
  startExam: () => void;
  pauseExam: () => void;
  resumeExam: () => void;
  endExam: () => void;

  // Alerts
  showAlert: (alert: Omit<AlertState, 'isVisible'>) => void;
  dismissAlert: (index: number) => void;
  clearAlerts: () => void;
  setAlertSound: (enabled: boolean) => void;

  // Violation detection helpers
  setPendingViolation: (key: string, timeout: NodeJS.Timeout) => void;
  clearPendingViolation: (key: string) => void;

  // Reset
  reset: () => void;
}

type ProctoringStore = ProctoringState & ProctoringActions;

// ============================================================================
// Initial State
// ============================================================================

const initialState: ProctoringState = {
  role: null,
  events: [],
  maxEvents: 1000, // Keep last 1000 events in memory
  candidates: new Map(),
  session: null,
  activeAlerts: [],
  alertSound: true,
  pendingViolations: new Map(),
};

// ============================================================================
// Store
// ============================================================================

export const useProctoringStore = create<ProctoringStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      // Role
      setRole: (role) => set({ role }, false, 'setRole'),

      // Events
      addEvent: (eventData) => {
        const event: ProctoringEvent = {
          ...eventData,
          id: generateId(),
          timestamp: Date.now(),
        };

        set(
          (state) => {
            const events = [event, ...state.events];
            // Trim if exceeds max
            if (events.length > state.maxEvents) {
              events.length = state.maxEvents;
            }
            return { events };
          },
          false,
          'addEvent'
        );

        // Auto-show alert for critical violations
        if (
          event.severity === ViolationSeverity.CRITICAL ||
          event.severity === ViolationSeverity.FATAL
        ) {
          const { showAlert, alertSound } = get();
          showAlert({
            title: getEventTitle(event.type),
            message: event.description || getEventDescription(event.type),
            severity: event.severity,
            candidateId: event.userId,
            dismissable: event.severity !== ViolationSeverity.FATAL,
          });

          // Play alert sound
          if (alertSound && typeof window !== 'undefined') {
            playAlertSound();
          }
        }
      },

      clearEvents: () => set({ events: [] }, false, 'clearEvents'),

      getEventsByUser: (userId) => {
        return get().events.filter((e) => e.userId === userId);
      },

      getEventsByType: (type) => {
        return get().events.filter((e) => e.type === type);
      },

      // Candidates
      setCandidates: (candidates) =>
        set(
          { candidates: new Map(candidates.map((c) => [c.user.id, c])) },
          false,
          'setCandidates'
        ),

      addCandidate: (candidate) =>
        set(
          (state) => {
            const newCandidates = new Map(state.candidates);
            newCandidates.set(candidate.user.id, candidate);
            return { candidates: newCandidates };
          },
          false,
          'addCandidate'
        ),

      removeCandidate: (userId) =>
        set(
          (state) => {
            const newCandidates = new Map(state.candidates);
            newCandidates.delete(userId);
            return { candidates: newCandidates };
          },
          false,
          'removeCandidate'
        ),

      updateCandidateMedia: (userId, mediaState) =>
        set(
          (state) => {
            const candidate = state.candidates.get(userId);
            if (!candidate) return state;

            const newCandidates = new Map(state.candidates);
            newCandidates.set(userId, {
              ...candidate,
              mediaState: { ...candidate.mediaState, ...mediaState },
              lastSeen: Date.now(),
            });
            return { candidates: newCandidates };
          },
          false,
          'updateCandidateMedia'
        ),

      updateCandidateConnection: (userId, quality) =>
        set(
          (state) => {
            const candidate = state.candidates.get(userId);
            if (!candidate) return state;

            const newCandidates = new Map(state.candidates);
            newCandidates.set(userId, {
              ...candidate,
              connectionQuality: quality,
              lastSeen: quality !== 'disconnected' ? Date.now() : candidate.lastSeen,
            });
            return { candidates: newCandidates };
          },
          false,
          'updateCandidateConnection'
        ),

      highlightCandidate: (userId, highlight) =>
        set(
          (state) => {
            const candidate = state.candidates.get(userId);
            if (!candidate) return state;

            const newCandidates = new Map(state.candidates);
            newCandidates.set(userId, { ...candidate, isHighlighted: highlight });
            return { candidates: newCandidates };
          },
          false,
          'highlightCandidate'
        ),

      incrementViolation: (userId) =>
        set(
          (state) => {
            const candidate = state.candidates.get(userId);
            if (!candidate) return state;

            const newCandidates = new Map(state.candidates);
            newCandidates.set(userId, {
              ...candidate,
              violationCount: candidate.violationCount + 1,
            });
            return { candidates: newCandidates };
          },
          false,
          'incrementViolation'
        ),

      // Session
      setSession: (session) => set({ session }, false, 'setSession'),

      startExam: () =>
        set(
          (state) => ({
            session: state.session
              ? { ...state.session, status: 'active', startedAt: Date.now() }
              : null,
          }),
          false,
          'startExam'
        ),

      pauseExam: () =>
        set(
          (state) => ({
            session: state.session ? { ...state.session, status: 'paused' } : null,
          }),
          false,
          'pauseExam'
        ),

      resumeExam: () =>
        set(
          (state) => ({
            session: state.session ? { ...state.session, status: 'active' } : null,
          }),
          false,
          'resumeExam'
        ),

      endExam: () =>
        set(
          (state) => ({
            session: state.session ? { ...state.session, status: 'ended' } : null,
          }),
          false,
          'endExam'
        ),

      // Alerts
      showAlert: (alert) =>
        set(
          (state) => ({
            activeAlerts: [...state.activeAlerts, { ...alert, isVisible: true }],
          }),
          false,
          'showAlert'
        ),

      dismissAlert: (index) =>
        set(
          (state) => ({
            activeAlerts: state.activeAlerts.filter((_, i) => i !== index),
          }),
          false,
          'dismissAlert'
        ),

      clearAlerts: () => set({ activeAlerts: [] }, false, 'clearAlerts'),

      setAlertSound: (enabled) => set({ alertSound: enabled }, false, 'setAlertSound'),

      // Pending violations
      setPendingViolation: (key, timeout) =>
        set(
          (state) => {
            const newPending = new Map(state.pendingViolations);
            newPending.set(key, timeout);
            return { pendingViolations: newPending };
          },
          false,
          'setPendingViolation'
        ),

      clearPendingViolation: (key) =>
        set(
          (state) => {
            const existing = state.pendingViolations.get(key);
            if (existing) {
              clearTimeout(existing);
            }
            const newPending = new Map(state.pendingViolations);
            newPending.delete(key);
            return { pendingViolations: newPending };
          },
          false,
          'clearPendingViolation'
        ),

      // Reset
      reset: () => {
        // Clear all pending timeouts
        get().pendingViolations.forEach((timeout) => clearTimeout(timeout));
        set(initialState, false, 'reset');
      },
    }),
    { name: 'proctoring-store' }
  )
);

// ============================================================================
// Helpers
// ============================================================================

function getEventTitle(type: ProctoringEventType): string {
  const titles: Record<ProctoringEventType, string> = {
    [ProctoringEventType.SESSION_STARTED]: 'Session Started',
    [ProctoringEventType.SESSION_ENDED]: 'Session Ended',
    [ProctoringEventType.SESSION_PAUSED]: 'Session Paused',
    [ProctoringEventType.SESSION_RESUMED]: 'Session Resumed',
    [ProctoringEventType.CONNECTION_ESTABLISHED]: 'Connected',
    [ProctoringEventType.CONNECTION_LOST]: 'Connection Lost',
    [ProctoringEventType.CONNECTION_RECOVERED]: 'Connection Recovered',
    [ProctoringEventType.ICE_RESTART_TRIGGERED]: 'Reconnecting',
    [ProctoringEventType.ICE_RESTART_COMPLETED]: 'Reconnected',
    [ProctoringEventType.WEBCAM_ENABLED]: 'Webcam On',
    [ProctoringEventType.WEBCAM_DISABLED]: '⚠️ Webcam Off',
    [ProctoringEventType.WEBCAM_BLOCKED]: '🚫 Webcam Blocked',
    [ProctoringEventType.SCREEN_SHARE_STARTED]: 'Screen Share Started',
    [ProctoringEventType.SCREEN_SHARE_STOPPED]: '⚠️ Screen Share Stopped',
    [ProctoringEventType.AUDIO_ENABLED]: 'Audio On',
    [ProctoringEventType.AUDIO_DISABLED]: 'Audio Off',
    [ProctoringEventType.QUALITY_DEGRADED]: 'Quality Issues',
    [ProctoringEventType.QUALITY_RECOVERED]: 'Quality Restored',
    [ProctoringEventType.PACKET_LOSS_HIGH]: 'High Packet Loss',
    [ProctoringEventType.BANDWIDTH_LIMITED]: 'Low Bandwidth',
    [ProctoringEventType.VIOLATION_DETECTED]: '🚨 Violation Detected',
    [ProctoringEventType.VIOLATION_ACKNOWLEDGED]: 'Violation Acknowledged',
    [ProctoringEventType.MULTIPLE_FACES_DETECTED]: '🚨 Multiple Faces',
    [ProctoringEventType.NO_FACE_DETECTED]: '⚠️ No Face Detected',
    [ProctoringEventType.TAB_SWITCH_DETECTED]: '🚨 Tab Switch Detected',
  };
  return titles[type] || type;
}

function getEventDescription(type: ProctoringEventType): string {
  const descriptions: Record<ProctoringEventType, string> = {
    [ProctoringEventType.SESSION_STARTED]: 'The exam session has started',
    [ProctoringEventType.SESSION_ENDED]: 'The exam session has ended',
    [ProctoringEventType.SESSION_PAUSED]: 'The exam has been paused',
    [ProctoringEventType.SESSION_RESUMED]: 'The exam has resumed',
    [ProctoringEventType.CONNECTION_ESTABLISHED]: 'Connection established successfully',
    [ProctoringEventType.CONNECTION_LOST]: 'Connection to server lost',
    [ProctoringEventType.CONNECTION_RECOVERED]: 'Connection has been restored',
    [ProctoringEventType.ICE_RESTART_TRIGGERED]: 'Attempting to restore connection',
    [ProctoringEventType.ICE_RESTART_COMPLETED]: 'Connection successfully restored',
    [ProctoringEventType.WEBCAM_ENABLED]: 'Webcam has been enabled',
    [ProctoringEventType.WEBCAM_DISABLED]: 'Candidate has disabled their webcam',
    [ProctoringEventType.WEBCAM_BLOCKED]: 'Webcam access was blocked or unavailable',
    [ProctoringEventType.SCREEN_SHARE_STARTED]: 'Screen sharing has started',
    [ProctoringEventType.SCREEN_SHARE_STOPPED]: 'Candidate stopped sharing their screen',
    [ProctoringEventType.AUDIO_ENABLED]: 'Microphone has been enabled',
    [ProctoringEventType.AUDIO_DISABLED]: 'Microphone has been disabled',
    [ProctoringEventType.QUALITY_DEGRADED]: 'Video quality has degraded',
    [ProctoringEventType.QUALITY_RECOVERED]: 'Video quality has recovered',
    [ProctoringEventType.PACKET_LOSS_HIGH]: 'Network experiencing high packet loss',
    [ProctoringEventType.BANDWIDTH_LIMITED]: 'Bandwidth is limited',
    [ProctoringEventType.VIOLATION_DETECTED]: 'A proctoring violation has been detected',
    [ProctoringEventType.VIOLATION_ACKNOWLEDGED]: 'Violation has been acknowledged',
    [ProctoringEventType.MULTIPLE_FACES_DETECTED]: 'More than one person detected in frame',
    [ProctoringEventType.NO_FACE_DETECTED]: 'No face visible in webcam feed',
    [ProctoringEventType.TAB_SWITCH_DETECTED]: 'Candidate switched to another tab or window',
  };
  return descriptions[type] || 'Event occurred';
}

function playAlertSound(): void {
  try {
    // Simple beep using Web Audio API
    const audioContext = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    gainNode.gain.value = 0.3;

    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      audioContext.close();
    }, 200);
  } catch {
    // Audio context may not be available
    console.warn('Could not play alert sound');
  }
}

// ============================================================================
// Selectors
// ============================================================================

export const selectEvents = (state: ProctoringStore) => state.events;
export const selectCandidates = (state: ProctoringStore) => state.candidates;
export const selectSession = (state: ProctoringStore) => state.session;
export const selectActiveAlerts = (state: ProctoringStore) => state.activeAlerts;
export const selectRole = (state: ProctoringStore) => state.role;

export const selectCriticalEvents = (state: ProctoringStore) =>
  state.events.filter(
    (e) => e.severity === ViolationSeverity.CRITICAL || e.severity === ViolationSeverity.FATAL
  );

export const selectRecentEvents = (limit: number) => (state: ProctoringStore) =>
  state.events.slice(0, limit);
