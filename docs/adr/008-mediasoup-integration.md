# ADR 008: mediasoup Integration Strategy

## Status

Accepted

## Context

Phase 2 của dự án cần implement SFU (Selective Forwarding Unit) để hỗ trợ nhiều candidates với ít proctors. Chúng ta cần chọn giữa:

1. **mediasoup** - Node.js SFU library
2. **Janus** - C-based media server
3. **Kurento** - Java-based media server

## Decision

Chọn **mediasoup** vì:

### Ưu điểm

1. **Native Node.js** - Integrate tự nhiên với NestJS backend
2. **Low-level control** - Kiểm soát hoàn toàn transport, producer, consumer
3. **Performance** - Worker processes chạy native C++ code
4. **Type safety** - TypeScript definitions đầy đủ
5. **Active community** - Được dùng bởi nhiều sản phẩm lớn

### Trade-offs chấp nhận

1. **Complexity** - Phức tạp hơn so với high-level solutions
2. **No built-in recording** - Phải tự implement với FFmpeg (Phase 3)
3. **Manual scaling** - Phải tự handle multi-worker và horizontal scaling

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         mediasoup Server (SFU)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                    WorkerManagerService                            │ │
│  │                                                                    │ │
│  │  Worker 1 ─────┬─── Worker 2 ─────┬─── Worker N                   │ │
│  │  (CPU Core 0)  │   (CPU Core 1)   │   (CPU Core N-1)             │ │
│  │       │        │        │         │        │                      │ │
│  └───────┼────────┴────────┼─────────┴────────┼──────────────────────┘ │
│          │                 │                  │                        │
│          ▼                 ▼                  ▼                        │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                      RouterService                                 │ │
│  │                                                                    │ │
│  │  Room A Router      Room B Router      Room C Router              │ │
│  │       │                  │                  │                      │ │
│  └───────┼──────────────────┼──────────────────┼──────────────────────┘ │
│          │                  │                  │                        │
│          ▼                  ▼                  ▼                        │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                     TransportService                               │ │
│  │                                                                    │ │
│  │  Send Transports ←──────────────────────── Recv Transports        │ │
│  │  (Upload media)                             (Download media)       │ │
│  │       │                                          │                 │ │
│  └───────┼──────────────────────────────────────────┼─────────────────┘ │
│          │                                          │                   │
│          ▼                                          ▼                   │
│  ┌────────────────────┐                 ┌────────────────────┐         │
│  │  ProducerService   │ ──────────────▶ │  ConsumerService   │         │
│  │                    │                 │                    │         │
│  │  Webcam Producer   │                 │  Webcam Consumer   │         │
│  │  Screen Producer   │                 │  Screen Consumer   │         │
│  │  Audio Producer    │                 │  Audio Consumer    │         │
│  └────────────────────┘                 └────────────────────┘         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Signaling Flow

```
Candidate                Server                   Proctor
    │                       │                        │
    │──── JOIN_ROOM ───────▶│                        │
    │◀── RTP_CAPABILITIES ──│                        │
    │                       │                        │
    │── CREATE_TRANSPORT ──▶│ (send)                 │
    │◀── TRANSPORT_CREATED ─│                        │
    │                       │                        │
    │── CONNECT_TRANSPORT ─▶│                        │
    │◀── TRANSPORT_CONNECTED│                        │
    │                       │                        │
    │────── PRODUCE ───────▶│ (webcam)               │
    │◀─── PRODUCED ─────────│                        │
    │                       │──── NEW_PRODUCER ─────▶│
    │                       │                        │
    │                       │◀── CREATE_TRANSPORT ──│ (recv)
    │                       │── TRANSPORT_CREATED ──▶│
    │                       │                        │
    │                       │◀── CONSUME ───────────│
    │                       │── CONSUMER_CREATED ──▶│
    │                       │                        │
    │                       │◀── CONSUMER_RESUME ──│
    │                       │── CONSUMER_RESUMED ──▶│
    │                       │                        │
    │       ◀═══════════ MEDIA FLOWING ═══════════▶ │
```

## Implementation

### Service Layer

| Service | Responsibility |
|---------|---------------|
| WorkerManagerService | Manage mediasoup Worker processes |
| RouterService | Create/manage Routers per room |
| TransportService | Create/manage WebRTC Transports |
| ProducerService | Handle media production |
| ConsumerService | Handle media consumption |
| MediasoupSignalingService | Bridge signaling ↔ mediasoup |

### Key Design Decisions

1. **1 Router per Room** - Simple mapping, easy cleanup
2. **Round-robin Worker selection** - Load balancing across CPU cores
3. **Separate send/recv transports** - As recommended by mediasoup
4. **Consumers start paused** - Resume after client setup complete

## Consequences

### Positive

- Full control over media routing
- Efficient bandwidth usage with SFU model
- Can scale to many participants per room
- TypeScript integration excellent

### Negative

- More code to maintain vs hosted solution
- Need to handle worker crashes
- Recording requires Phase 3 implementation

## Related

- [ADR 002: SFU Architecture](./002-sfu-architecture.md)
- [ADR 003: Signaling Protocol](./003-signaling-protocol.md)
- [Knowledge: WebRTC Fundamentals](../knowledge/001-webrtc-fundamentals.md)
- [Knowledge: mediasoup SFU](../knowledge/002-mediasoup-sfu.md)
