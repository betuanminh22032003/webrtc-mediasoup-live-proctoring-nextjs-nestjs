/**
 * Violation Detection Hook
 *
 * WHY a dedicated hook?
 * - Centralized violation detection logic
 * - Reusable across candidate and proctor views
 * - Encapsulates browser APIs (visibility, focus)
 * - Integrates with proctoring store
 *
 * Detects:
 * - Tab/window switches (visibility API)
 * - Browser focus loss
 * - Webcam state changes
 * - Screen share state changes
 * - Copy/paste attempts (optional)
 */

import { useEffect, useCallback, useRef } from 'react';
import { ProctoringEventType, ViolationSeverity } from '@proctoring/shared';
import { useProctoringStore } from '@/store/proctoring.store';
import { useWebRTCStore } from '@/store/webrtc.store';
import { PROCTORING } from '@proctoring/shared';

// ============================================================================
// Types
// ============================================================================

interface ViolationDetectionOptions {
  /** User ID for event attribution */
  userId: string;
  /** Room ID for event attribution */
  roomId: string;
  /** Enable tab switch detection */
  detectTabSwitch?: boolean;
  /** Enable window blur detection */
  detectWindowBlur?: boolean;
  /** Enable webcam monitoring */
  monitorWebcam?: boolean;
  /** Enable screen share monitoring */
  monitorScreenShare?: boolean;
  /** Enable copy/paste detection */
  detectCopyPaste?: boolean;
  /** Grace period before reporting webcam off (ms) */
  webcamGracePeriod?: number;
  /** Callback when violation detected */
  onViolation?: (type: ProctoringEventType, severity: ViolationSeverity) => void;
}

interface UseViolationDetectionReturn {
  /** Whether detection is active */
  isActive: boolean;
  /** Start monitoring */
  startMonitoring: () => void;
  /** Stop monitoring */
  stopMonitoring: () => void;
  /** Current violation count */
  violationCount: number;
}

// ============================================================================
// Hook
// ============================================================================

export function useViolationDetection({
  userId,
  roomId,
  detectTabSwitch = true,
  detectWindowBlur = true,
  monitorWebcam = true,
  monitorScreenShare = true,
  detectCopyPaste = false,
  webcamGracePeriod = PROCTORING.MEDIA_MISSING_GRACE_PERIOD_MS,
  onViolation,
}: ViolationDetectionOptions): UseViolationDetectionReturn {
  const isActiveRef = useRef(false);
  const violationCountRef = useRef(0);
  const lastWebcamStateRef = useRef<boolean | null>(null);
  const lastScreenShareStateRef = useRef<boolean | null>(null);

  const {
    addEvent,
    setPendingViolation,
    clearPendingViolation,
  } = useProctoringStore();

  const { mediaEnabled } = useWebRTCStore();

  /**
   * Create and log a violation event
   */
  const reportViolation = useCallback(
    (type: ProctoringEventType, severity: ViolationSeverity, description?: string) => {
      violationCountRef.current += 1;

      addEvent({
        type,
        userId,
        roomId,
        severity,
        description,
        metadata: {
          violationNumber: violationCountRef.current,
          timestamp: Date.now(),
        },
      });

      onViolation?.(type, severity);

      console.warn(`[Proctoring] Violation detected: ${type}`, { severity, description });
    },
    [userId, roomId, addEvent, onViolation]
  );

  /**
   * Handle visibility change (tab switch)
   */
  const handleVisibilityChange = useCallback(() => {
    if (!isActiveRef.current || !detectTabSwitch) return;

    if (document.hidden) {
      reportViolation(
        ProctoringEventType.TAB_SWITCH_DETECTED,
        ViolationSeverity.WARNING,
        'Candidate switched to another tab or minimized the browser'
      );
    }
  }, [detectTabSwitch, reportViolation]);

  /**
   * Handle window blur (focus loss)
   */
  const handleWindowBlur = useCallback(() => {
    if (!isActiveRef.current || !detectWindowBlur) return;

    // Only report if not due to visibility change
    if (!document.hidden) {
      reportViolation(
        ProctoringEventType.TAB_SWITCH_DETECTED,
        ViolationSeverity.INFO,
        'Browser window lost focus'
      );
    }
  }, [detectWindowBlur, reportViolation]);

  /**
   * Handle copy event
   */
  const handleCopy = useCallback(
    (e: ClipboardEvent) => {
      if (!isActiveRef.current || !detectCopyPaste) return;

      // Prevent copy during exam
      e.preventDefault();
      reportViolation(
        ProctoringEventType.VIOLATION_DETECTED,
        ViolationSeverity.WARNING,
        'Copy attempt detected and blocked'
      );
    },
    [detectCopyPaste, reportViolation]
  );

  /**
   * Handle paste event
   */
  const handlePaste = useCallback(
    (e: ClipboardEvent) => {
      if (!isActiveRef.current || !detectCopyPaste) return;

      // Prevent paste during exam
      e.preventDefault();
      reportViolation(
        ProctoringEventType.VIOLATION_DETECTED,
        ViolationSeverity.WARNING,
        'Paste attempt detected and blocked'
      );
    },
    [detectCopyPaste, reportViolation]
  );

  /**
   * Start monitoring
   */
  const startMonitoring = useCallback(() => {
    if (isActiveRef.current) return;
    isActiveRef.current = true;

    // Store initial states
    lastWebcamStateRef.current = mediaEnabled.webcam;
    lastScreenShareStateRef.current = mediaEnabled.screen;

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    
    if (detectCopyPaste) {
      document.addEventListener('copy', handleCopy);
      document.addEventListener('paste', handlePaste);
    }

    console.log('[Proctoring] Violation detection started');
  }, [
    mediaEnabled.webcam,
    mediaEnabled.screen,
    handleVisibilityChange,
    handleWindowBlur,
    handleCopy,
    handlePaste,
    detectCopyPaste,
  ]);

  /**
   * Stop monitoring
   */
  const stopMonitoring = useCallback(() => {
    if (!isActiveRef.current) return;
    isActiveRef.current = false;

    // Remove event listeners
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('blur', handleWindowBlur);
    document.removeEventListener('copy', handleCopy);
    document.removeEventListener('paste', handlePaste);

    // Clear pending violations
    clearPendingViolation(`webcam-${userId}`);
    clearPendingViolation(`screen-${userId}`);

    console.log('[Proctoring] Violation detection stopped');
  }, [userId, handleVisibilityChange, handleWindowBlur, handleCopy, handlePaste, clearPendingViolation]);

  /**
   * Monitor webcam state changes
   */
  useEffect(() => {
    if (!isActiveRef.current || !monitorWebcam) return;

    const wasEnabled = lastWebcamStateRef.current;
    const isEnabled = mediaEnabled.webcam;

    // Only process changes
    if (wasEnabled === isEnabled) return;
    lastWebcamStateRef.current = isEnabled;

    if (!isEnabled && wasEnabled !== null) {
      // Webcam turned off - start grace period
      const timeout = setTimeout(() => {
        if (!mediaEnabled.webcam) {
          reportViolation(
            ProctoringEventType.WEBCAM_DISABLED,
            ViolationSeverity.CRITICAL,
            'Webcam has been disabled during the exam'
          );
        }
      }, webcamGracePeriod);

      setPendingViolation(`webcam-${userId}`, timeout);
    } else if (isEnabled) {
      // Webcam turned on - cancel pending violation
      clearPendingViolation(`webcam-${userId}`);

      // Log webcam enabled event
      addEvent({
        type: ProctoringEventType.WEBCAM_ENABLED,
        userId,
        roomId,
        severity: ViolationSeverity.INFO,
        description: 'Webcam enabled',
      });
    }
  }, [
    mediaEnabled.webcam,
    monitorWebcam,
    userId,
    roomId,
    webcamGracePeriod,
    reportViolation,
    addEvent,
    setPendingViolation,
    clearPendingViolation,
  ]);

  /**
   * Monitor screen share state changes
   */
  useEffect(() => {
    if (!isActiveRef.current || !monitorScreenShare) return;

    const wasEnabled = lastScreenShareStateRef.current;
    const isEnabled = mediaEnabled.screen;

    // Only process changes
    if (wasEnabled === isEnabled) return;
    lastScreenShareStateRef.current = isEnabled;

    if (!isEnabled && wasEnabled !== null) {
      // Screen share stopped
      reportViolation(
        ProctoringEventType.SCREEN_SHARE_STOPPED,
        ViolationSeverity.CRITICAL,
        'Screen sharing has been stopped during the exam'
      );
    } else if (isEnabled) {
      // Screen share started
      addEvent({
        type: ProctoringEventType.SCREEN_SHARE_STARTED,
        userId,
        roomId,
        severity: ViolationSeverity.INFO,
        description: 'Screen sharing started',
      });
    }
  }, [
    mediaEnabled.screen,
    monitorScreenShare,
    userId,
    roomId,
    reportViolation,
    addEvent,
  ]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  return {
    isActive: isActiveRef.current,
    startMonitoring,
    stopMonitoring,
    violationCount: violationCountRef.current,
  };
}
