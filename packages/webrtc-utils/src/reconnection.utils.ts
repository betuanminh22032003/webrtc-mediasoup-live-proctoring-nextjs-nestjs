/**
 * Reconnection Manager
 *
 * WHY this module?
 * - Network failures are common, especially on mobile
 * - Automatic recovery is critical for proctoring
 * - Must handle various failure scenarios gracefully
 */

import { RECONNECTION } from '@proctoring/shared';

export interface ReconnectionConfig {
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  maxAttempts: number;
  jitterFactor: number;
}

export type ReconnectionState = 'idle' | 'waiting' | 'attempting' | 'failed' | 'succeeded';

export interface ReconnectionStatus {
  state: ReconnectionState;
  attempt: number;
  nextAttemptIn: number | null;
  lastError: string | null;
}

type ReconnectCallback = () => Promise<boolean>;
type StateChangeCallback = (status: ReconnectionStatus) => void;

/**
 * Manages reconnection with exponential backoff
 *
 * DESIGN DECISIONS:
 * - Exponential backoff prevents thundering herd
 * - Jitter randomizes retry times across clients
 * - Max attempts prevents infinite loops
 * - Callback-based for flexibility
 */
export class ReconnectionManager {
  private config: ReconnectionConfig;
  private state: ReconnectionState = 'idle';
  private attempt = 0;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private lastError: string | null = null;

  private reconnectCallback: ReconnectCallback | null = null;
  private stateChangeCallbacks: Set<StateChangeCallback> = new Set();

  constructor(config?: Partial<ReconnectionConfig>) {
    this.config = {
      initialDelayMs: config?.initialDelayMs ?? RECONNECTION.INITIAL_DELAY_MS,
      maxDelayMs: config?.maxDelayMs ?? RECONNECTION.MAX_DELAY_MS,
      backoffMultiplier: config?.backoffMultiplier ?? RECONNECTION.BACKOFF_MULTIPLIER,
      maxAttempts: config?.maxAttempts ?? RECONNECTION.MAX_ATTEMPTS,
      jitterFactor: config?.jitterFactor ?? RECONNECTION.JITTER_FACTOR,
    };
  }

  /**
   * Set the callback that performs the actual reconnection
   */
  setReconnectCallback(callback: ReconnectCallback): void {
    this.reconnectCallback = callback;
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => this.stateChangeCallbacks.delete(callback);
  }

  /**
   * Start reconnection attempts
   */
  start(error?: string): void {
    if (this.state === 'attempting' || this.state === 'waiting') {
      return; // Already reconnecting
    }

    this.lastError = error ?? null;
    this.attempt = 0;
    this.scheduleReconnect();
  }

  /**
   * Stop reconnection attempts
   */
  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.setState('idle');
    this.attempt = 0;
    this.lastError = null;
  }

  /**
   * Mark reconnection as successful
   */
  success(): void {
    this.stop();
    this.setState('succeeded');
  }

  /**
   * Get current status
   */
  getStatus(): ReconnectionStatus {
    return {
      state: this.state,
      attempt: this.attempt,
      nextAttemptIn: this.getNextAttemptDelay(),
      lastError: this.lastError,
    };
  }

  /**
   * Calculate delay for current attempt with jitter
   */
  private getDelayWithJitter(): number {
    // Exponential backoff: initialDelay * multiplier^attempt
    const baseDelay = Math.min(
      this.config.initialDelayMs *
        Math.pow(this.config.backoffMultiplier, this.attempt),
      this.config.maxDelayMs
    );

    // Add jitter: +/- jitterFactor of base delay
    const jitter = baseDelay * this.config.jitterFactor * (Math.random() * 2 - 1);

    return Math.max(0, baseDelay + jitter);
  }

  /**
   * Get delay until next attempt (for UI display)
   */
  private getNextAttemptDelay(): number | null {
    if (this.state !== 'waiting') return null;
    return this.getDelayWithJitter();
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.attempt >= this.config.maxAttempts) {
      this.setState('failed');
      return;
    }

    const delay = this.getDelayWithJitter();
    this.setState('waiting');

    this.timeoutId = setTimeout(() => {
      this.attemptReconnect();
    }, delay);
  }

  /**
   * Perform a reconnection attempt
   */
  private async attemptReconnect(): Promise<void> {
    if (!this.reconnectCallback) {
      console.error('No reconnect callback set');
      this.setState('failed');
      return;
    }

    this.attempt++;
    this.setState('attempting');

    try {
      const success = await this.reconnectCallback();

      if (success) {
        this.success();
      } else {
        this.scheduleReconnect();
      }
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : 'Unknown error';
      this.scheduleReconnect();
    }
  }

  /**
   * Update state and notify listeners
   */
  private setState(state: ReconnectionState): void {
    this.state = state;
    const status = this.getStatus();
    this.stateChangeCallbacks.forEach((cb) => cb(status));
  }
}

/**
 * Create a simple reconnection delay calculator
 * Use this if you don't need the full manager
 */
export function calculateReconnectDelay(
  attempt: number,
  config?: Partial<ReconnectionConfig>
): number {
  const {
    initialDelayMs = RECONNECTION.INITIAL_DELAY_MS,
    maxDelayMs = RECONNECTION.MAX_DELAY_MS,
    backoffMultiplier = RECONNECTION.BACKOFF_MULTIPLIER,
    jitterFactor = RECONNECTION.JITTER_FACTOR,
  } = config ?? {};

  const baseDelay = Math.min(
    initialDelayMs * Math.pow(backoffMultiplier, attempt),
    maxDelayMs
  );

  const jitter = baseDelay * jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(baseDelay + jitter));
}
