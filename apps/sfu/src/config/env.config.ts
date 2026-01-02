/**
 * Environment Configuration Schema
 *
 * WHY Zod for env validation?
 * - Fail fast on startup if config is invalid
 * - Self-documenting configuration
 * - Type-safe access throughout the application
 */

import { z } from 'zod';

/**
 * Environment configuration schema with validation
 */
export const envSchema = z.object({
  // Server configuration
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
    .default('3001'),
  HOST: z.string().default('0.0.0.0'),

  // WebSocket configuration
  WS_PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
    .default('3002'),

  // mediasoup configuration
  MEDIASOUP_LISTEN_IP: z.string().default('0.0.0.0'),
  MEDIASOUP_ANNOUNCED_IP: z.string().optional(),
  MEDIASOUP_MIN_PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
    .default('40000'),
  MEDIASOUP_MAX_PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
    .default('49999'),
  MEDIASOUP_WORKERS: z
    .string()
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().positive())
    .optional(),

  // TURN server (optional)
  TURN_URLS: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),

  // Recording configuration
  RECORDING_ENABLED: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  RECORDING_PATH: z.string().default('./recordings'),

  // Logging
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate environment variables
 * Called at application startup
 */
export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}
