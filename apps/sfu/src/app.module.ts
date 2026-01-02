/**
 * Main Application Module
 *
 * This is the root module for the NestJS SFU server.
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SignalingModule } from './signaling/signaling.module';

@Module({
  imports: [
    // Configuration module with validation
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // Signaling module for WebSocket handling
    SignalingModule,

    // mediasoup module will be added in Phase 2
    // MediasoupModule,

    // Recording module will be added in Phase 4
    // RecordingModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
