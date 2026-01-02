/**
 * Signaling Gateway Module
 *
 * This module handles WebSocket signaling for WebRTC connections.
 * Phase 1: Pure WebRTC (1-1 peer connections, no SFU)
 * Phase 2+: mediasoup SFU signaling
 */

import { Module } from '@nestjs/common';
import { SignalingGateway } from './signaling.gateway';
import { SignalingService } from './signaling.service';
import { RoomService } from './room.service';

@Module({
  providers: [SignalingGateway, SignalingService, RoomService],
  exports: [SignalingService, RoomService],
})
export class SignalingModule {}
