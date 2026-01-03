/**
 * mediasoup Module
 *
 * NestJS module that provides all mediasoup services.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MODULE OVERVIEW
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This module encapsulates all mediasoup-related functionality:
 *
 * SERVICES:
 * - WorkerManagerService: Manages mediasoup Workers (OS processes)
 * - RouterService: Manages Routers (per-room media routing)
 * - TransportService: Manages WebRTC Transports
 * - ProducerService: Manages Producers (sending media)
 * - ConsumerService: Manages Consumers (receiving media)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SERVICE DEPENDENCIES
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *                    ┌─────────────────────┐
 *                    │  WorkerManagerService │
 *                    └──────────┬──────────┘
 *                               │
 *                               ▼
 *                    ┌─────────────────────┐
 *                    │    RouterService    │
 *                    └──────────┬──────────┘
 *                               │
 *                               ▼
 *                    ┌─────────────────────┐
 *                    │   TransportService  │
 *                    └──────────┬──────────┘
 *                               │
 *              ┌────────────────┼────────────────┐
 *              │                │                │
 *              ▼                ▼                ▼
 *    ┌─────────────────┐ ┌─────────────────┐
 *    │ ProducerService │ │ ConsumerService │
 *    └─────────────────┘ └─────────────────┘
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * INITIALIZATION ORDER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * When application starts:
 *
 * 1. WorkerManagerService.onModuleInit()
 *    └─> Creates mediasoup Workers (1 per CPU core)
 *
 * 2. Other services are ready to use
 *
 * When application shuts down:
 *
 * 1. WorkerManagerService.onModuleDestroy()
 *    └─> Closes all Workers gracefully
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Module } from '@nestjs/common';
import { WorkerManagerService } from './worker-manager.service';
import { RouterService } from './router.service';
import { TransportService } from './transport.service';
import { ProducerService } from './producer.service';
import { ConsumerService } from './consumer.service';

@Module({
  providers: [
    // Order matters for dependency injection
    WorkerManagerService,
    RouterService,
    TransportService,
    ProducerService,
    ConsumerService,
  ],
  exports: [
    // Export all services for use in other modules
    WorkerManagerService,
    RouterService,
    TransportService,
    ProducerService,
    ConsumerService,
  ],
})
export class MediasoupModule {}
