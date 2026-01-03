/**
 * Main Application Module
 *
 * This is the root module for the NestJS SFU server.
 *
 * Phase 2: Added MediasoupModule for SFU functionality
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SignalingModule } from './signaling/signaling.module';
import { MediasoupModule } from './mediasoup/mediasoup.module';

@Module({
  imports: [
    // Configuration module with validation
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // mediasoup module (Phase 2)
    // Provides Worker, Router, Transport, Producer, Consumer services
    MediasoupModule,

    // Signaling module for WebSocket handling
    // Uses mediasoup services for media management
    SignalingModule,

    // Recording module will be added in Phase 4
    // RecordingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
