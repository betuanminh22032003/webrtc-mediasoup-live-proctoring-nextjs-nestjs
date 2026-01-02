/**
 * SFU Server Entry Point
 *
 * WHY Fastify?
 * - Faster than Express (critical for signaling server)
 * - Better TypeScript support
 * - Schema-based validation
 * - Lower memory footprint
 *
 * WHY separate HTTP and WebSocket servers?
 * - HTTP for health checks, metrics, REST APIs
 * - WebSocket for real-time signaling
 * - Can scale independently
 */

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.config';
import { logger } from './common/logger';

async function bootstrap(): Promise<void> {
  // Validate environment configuration first
  const config = validateEnv();

  logger.info(
    {
      nodeEnv: config.NODE_ENV,
      port: config.PORT,
      wsPort: config.WS_PORT,
    },
    'Starting SFU server...'
  );

  // Create NestJS application with Fastify
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // We use pino directly
    })
  );

  // Use WebSocket adapter
  app.useWebSocketAdapter(new WsAdapter(app));

  // Enable CORS
  app.enableCors({
    origin: config.CORS_ORIGIN,
    credentials: true,
  });

  // Health check endpoint
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  });

  // Graceful shutdown
  app.enableShutdownHooks();

  // Start server
  await app.listen(config.PORT, config.HOST);

  logger.info(
    {
      http: `http://${config.HOST}:${config.PORT}`,
      ws: `ws://${config.HOST}:${config.PORT}/ws`,
    },
    '🚀 SFU server is running'
  );
}

bootstrap().catch((error) => {
  logger.fatal({ error }, 'Failed to start SFU server');
  process.exit(1);
});
