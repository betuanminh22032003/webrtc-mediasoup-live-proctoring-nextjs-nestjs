/**
 * Pino Logger Configuration
 *
 * WHY Pino?
 * - Fastest Node.js logger (critical for real-time applications)
 * - Structured JSON logging for production
 * - Pretty printing for development
 *
 * WHY structured logging?
 * - Machine-parseable for log aggregation (ELK, Datadog)
 * - Consistent format across all services
 * - Enables correlation IDs for request tracing
 */

import pino from 'pino';

export interface LogContext {
  /** Correlation ID for request tracing */
  correlationId?: string;
  /** User ID if authenticated */
  userId?: string;
  /** Room ID if in a room context */
  roomId?: string;
  /** Additional context fields */
  [key: string]: unknown;
}

/**
 * Create a configured Pino logger instance
 */
export function createLogger(name: string) {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const logLevel = process.env.LOG_LEVEL || 'info';

  const baseConfig: pino.LoggerOptions = {
    name,
    level: logLevel,
    // Add timestamp to all logs
    timestamp: pino.stdTimeFunctions.isoTime,
    // Base fields included in every log
    base: {
      service: 'proctoring-sfu',
      version: process.env.npm_package_version || '1.0.0',
    },
    // Format error objects properly
    formatters: {
      level: (label) => ({ level: label }),
      bindings: (bindings) => ({
        pid: bindings.pid,
        host: bindings.hostname,
      }),
    },
    // Redact sensitive fields
    redact: {
      paths: ['password', 'token', 'authorization', 'cookie', '*.password', '*.token'],
      censor: '[REDACTED]',
    },
  };

  // Pretty print in development
  if (isDevelopment) {
    return pino({
      ...baseConfig,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(baseConfig);
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(
  parent: pino.Logger,
  context: LogContext
): pino.Logger {
  return parent.child(context);
}

// Default logger instance
export const logger = createLogger('sfu');

/**
 * Log helper for WebRTC-specific events
 *
 * WHY separate logger?
 * - WebRTC events are high-volume
 * - May want different log level for RTC vs business logic
 */
export const rtcLogger = createLogger('rtc');

/**
 * Log helper for signaling events
 */
export const signalingLogger = createLogger('signaling');

/**
 * Log helper for mediasoup operations
 */
export const mediasoupLogger = createLogger('mediasoup');
