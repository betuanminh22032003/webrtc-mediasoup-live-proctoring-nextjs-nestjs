/**
 * Signaling Gateway Module
 *
 * This module handles WebSocket signaling for WebRTC connections.
 *
 * Phase 1: Pure WebRTC (1-1 peer connections, no SFU)
 * Phase 2: mediasoup SFU signaling (CURRENT)
 *
 * Uses MediasoupModule services for media management.
 */

import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway';
import { SignalingService } from './signaling.service';
import { RoomService } from './room.service';
import { MediasoupSignalingService } from './mediasoup-signaling.service';
import { MediasoupModule } from '../mediasoup/mediasoup.module';

@Module({
  imports: [MediasoupModule],
  providers: [
    SignalingGateway,
    SignalingService,
    RoomService,
    MediasoupSignalingService,
  ],
  exports: [SignalingService, RoomService, MediasoupSignalingService],
})
export class SignalingModule {}
