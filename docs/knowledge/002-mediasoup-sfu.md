# mediasoup SFU - Kiến Thức Nền Tảng

## Mục Lục

1. [SFU là gì và tại sao cần?](#sfu-là-gì-và-tại-sao-cần)
2. [mediasoup Architecture](#mediasoup-architecture)
3. [Core Concepts](#core-concepts)
4. [Connection Flow](#connection-flow)
5. [Implementation Guide](#implementation-guide)
6. [Best Practices](#best-practices)

---

## SFU là gì và tại sao cần?

### So sánh các kiến trúc WebRTC

#### 1. Mesh (P2P thuần)

```
     ┌───────────────────────────────────────┐
     │           MESH TOPOLOGY               │
     │                                       │
     │   A ◄────────► B                      │
     │   ▲ ╲        ╱ ▲                      │
     │   │  ╲      ╱  │                      │
     │   │   ╲    ╱   │                      │
     │   │    ╲  ╱    │                      │
     │   ▼     ╲╱     ▼                      │
     │   D ◄────────► C                      │
     │                                       │
     │   Connections: N*(N-1)/2 = 6          │
     │   4 người = 6 connections             │
     │   10 người = 45 connections! ❌        │
     └───────────────────────────────────────┘
```

**Vấn đề**: 
- Không scale - mỗi peer upload N-1 streams
- CPU client quá tải với nhiều encoding
- Bandwidth client bị chiếm hết

#### 2. MCU (Multipoint Control Unit)

```
     ┌───────────────────────────────────────┐
     │              MCU TOPOLOGY             │
     │                                       │
     │        A ──────┐                      │
     │                ▼                      │
     │        B ───► MCU ───► Mixed Stream   │
     │                ▲       to all peers   │
     │        C ──────┘                      │
     │                                       │
     │   Server decodes ALL → mixes →        │
     │   re-encodes → sends 1 stream         │
     │                                       │
     │   ✅ Low client bandwidth             │
     │   ❌ HIGH server CPU (transcoding)    │
     │   ❌ Added latency                    │
     │   ❌ Loss of individual control       │
     └───────────────────────────────────────┘
```

**Vấn đề**:
- Server CPU cực cao (decode + mix + encode)
- Tăng latency do processing
- Không thể chọn xem ai - tất cả mixed

#### 3. SFU (Selective Forwarding Unit) ✅

```
     ┌───────────────────────────────────────────────────────────┐
     │                     SFU TOPOLOGY                          │
     │                                                           │
     │   Candidate 1 ──┐                  ┌──► Proctor 1         │
     │                 │                  │                      │
     │   Candidate 2 ──┼───► SFU Server ──┼──► Proctor 2         │
     │                 │    (mediasoup)   │                      │
     │   Candidate 3 ──┘                  └──► Proctor 3         │
     │                                                           │
     │   ✅ Candidate uploads ONCE (saves bandwidth)             │
     │   ✅ Server just FORWARDS (no transcode = low CPU)        │
     │   ✅ Proctor can choose which streams to watch            │
     │   ✅ Server can record all streams                        │
     │   ✅ Low latency (no processing)                          │
     └───────────────────────────────────────────────────────────┘
```

### Tại sao SFU + mediasoup cho Proctoring?

| Requirement          | Mesh | MCU | SFU |
|---------------------|------|-----|-----|
| Many candidates     | ❌   | ✅  | ✅  |
| Low latency         | ✅   | ❌  | ✅  |
| Server recording    | ❌   | ✅  | ✅  |
| Individual streams  | ✅   | ❌  | ✅  |
| Server CPU          | N/A  | ❌  | ✅  |
| Client bandwidth    | ❌   | ✅  | ✅  |

**mediasoup** được chọn vì:
- C++ core với Node.js bindings → **Performance**
- Multi-worker architecture → **Scalability**
- Full control → **Flexibility**
- Self-hosted → **Privacy & Cost control**

---

## mediasoup Architecture

### Hierarchy Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Node.js Application                            │
│                              (NestJS)                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │                      mediasoup Package                            │ │
│  ├───────────────────────────────────────────────────────────────────┤ │
│  │                                                                   │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐               │ │
│  │  │   Worker 1  │  │   Worker 2  │  │   Worker N  │  (1 per CPU)  │ │
│  │  ├─────────────┤  ├─────────────┤  ├─────────────┤               │ │
│  │  │             │  │             │  │             │               │ │
│  │  │  ┌───────┐  │  │  ┌───────┐  │  │  ┌───────┐  │               │ │
│  │  │  │Router1│  │  │  │Router3│  │  │  │Router5│  │  (1+ per     │ │
│  │  │  └───┬───┘  │  │  └───┬───┘  │  │  └───┬───┘  │   Worker)    │ │
│  │  │      │      │  │      │      │  │      │      │               │ │
│  │  │  ┌───┴───┐  │  │  ┌───┴───┐  │  │  ┌───┴───┐  │               │ │
│  │  │  │Router2│  │  │  │Router4│  │  │  │Router6│  │               │ │
│  │  │  └───────┘  │  │  └───────┘  │  │  └───────┘  │               │ │
│  │  │             │  │             │  │             │               │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘               │ │
│  │                                                                   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Chi tiết từng component

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          ROUTER DETAIL                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Router (Room: exam-101)                                                │
│  ├── RTP Capabilities (supported codecs: VP8, VP9, Opus)               │
│  │                                                                      │
│  ├── WebRtcTransport (Candidate 1 - SEND)                              │
│  │   ├── Producer (video/webcam)                                       │
│  │   ├── Producer (video/screen)                                       │
│  │   └── Producer (audio/mic)                                          │
│  │                                                                      │
│  ├── WebRtcTransport (Candidate 2 - SEND)                              │
│  │   ├── Producer (video/webcam)                                       │
│  │   └── Producer (audio/mic)                                          │
│  │                                                                      │
│  ├── WebRtcTransport (Proctor 1 - RECEIVE)                             │
│  │   ├── Consumer (từ Candidate 1 webcam)                              │
│  │   ├── Consumer (từ Candidate 1 screen)                              │
│  │   ├── Consumer (từ Candidate 1 audio)                               │
│  │   ├── Consumer (từ Candidate 2 webcam)                              │
│  │   └── Consumer (từ Candidate 2 audio)                               │
│  │                                                                      │
│  └── (Can pipe to other Routers for horizontal scaling)                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Worker

**Worker** là một OS process chạy C++ mediasoup code.

```typescript
import * as mediasoup from 'mediasoup';

// Tạo worker
const worker = await mediasoup.createWorker({
  logLevel: 'warn',
  logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp'],
  rtcMinPort: 40000,
  rtcMaxPort: 49999,
});

// Một worker có thể handle nhiều routers
// Best practice: 1 worker per CPU core
const numWorkers = require('os').cpus().length;

// Worker events
worker.on('died', (error) => {
  // Worker crash! Cần restart
  console.error('Worker died:', error);
});
```

**Tại sao nhiều workers?**
- Mỗi worker là 1 process → tận dụng multi-core
- Isolate failures - 1 worker crash không ảnh hưởng workers khác
- Load balancing giữa các workers

### 2. Router

**Router** xử lý media routing trong một "room" hoặc session.

```typescript
// Tạo router với supported codecs
const router = await worker.createRouter({
  mediaCodecs: [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
    },
    {
      kind: 'video',
      mimeType: 'video/VP9',
      clockRate: 90000,
      parameters: {
        'profile-id': 2,
      },
    },
  ],
});

// Router capabilities - gửi cho client để device setup
const rtpCapabilities = router.rtpCapabilities;
// Client cần này để tạo device và negotiate codecs
```

**Key Point**: Tất cả Producers/Consumers trong 1 Router có thể "nói chuyện" với nhau.

### 3. Transport

**Transport** là WebRTC connection endpoint. Có 3 loại:

```typescript
// 1. WebRtcTransport - Cho browsers
const transport = await router.createWebRtcTransport({
  listenIps: [
    { ip: '0.0.0.0', announcedIp: '203.0.113.1' }, // Public IP
  ],
  enableUdp: true,
  enableTcp: true, // Fallback for restrictive networks
  preferUdp: true,
  // ICE settings
  initialAvailableOutgoingBitrate: 600000, // 600kbps initial
});

// Transport info - gửi cho client
const transportParams = {
  id: transport.id,
  iceParameters: transport.iceParameters,
  iceCandidates: transport.iceCandidates,
  dtlsParameters: transport.dtlsParameters,
};

// Client connect với DTLS params
await transport.connect({
  dtlsParameters: clientDtlsParameters,
});

// 2. PlainTransport - Cho RTP/RTCP plain (recording, FFmpeg)
const plainTransport = await router.createPlainTransport({
  listenIp: { ip: '127.0.0.1' },
  rtcpMux: true,
  comedia: true, // Auto-detect remote
});

// 3. PipeTransport - Kết nối giữa các Routers
const pipeTransport = await router.createPipeTransport({
  listenIp: { ip: '0.0.0.0', announcedIp: '203.0.113.1' },
});
```

**SEND vs RECEIVE Transport**:
- **Send Transport**: Client produce (gửi media lên server)
- **Receive Transport**: Client consume (nhận media từ server)

Thường mỗi client cần 2 transports.

### 4. Producer

**Producer** đại diện cho một media track được gửi lên server.

```typescript
// Server-side: Tạo producer từ client RTP parameters
const producer = await sendTransport.produce({
  kind: 'video', // 'audio' hoặc 'video'
  rtpParameters: clientRtpParameters, // Từ client mediasoup-client
  appData: {
    // Custom data
    trackType: 'webcam', // 'webcam' | 'screen' | 'audio'
    participantId: 'user-123',
  },
});

producer.on('transportclose', () => {
  // Transport đóng → producer cũng đóng
});

// Pause/Resume
await producer.pause();  // Tạm dừng nhận
await producer.resume(); // Tiếp tục

// Stats
const stats = await producer.getStats();
console.log('Producer stats:', stats);
```

### 5. Consumer

**Consumer** đại diện cho việc nhận một Producer stream.

```typescript
// Kiểm tra xem có thể consume không
if (!router.canConsume({
  producerId: producer.id,
  rtpCapabilities: clientRtpCapabilities,
})) {
  throw new Error('Cannot consume - incompatible codecs');
}

// Tạo consumer
const consumer = await recvTransport.consume({
  producerId: producer.id,
  rtpCapabilities: clientRtpCapabilities,
  paused: true, // Start paused - resume sau khi client ready
  appData: {
    participantId: producer.appData.participantId,
    trackType: producer.appData.trackType,
  },
});

// Consumer info - gửi cho client
const consumerParams = {
  id: consumer.id,
  producerId: producer.id,
  kind: consumer.kind,
  rtpParameters: consumer.rtpParameters,
  appData: consumer.appData,
};

// Client sẽ gọi transport.consume() với params này
// Sau đó client gọi consumer.resume()

consumer.on('producerclose', () => {
  // Producer đã đóng → cleanup consumer
});

consumer.on('producerpause', () => {
  // Producer paused
});

consumer.on('producerresume', () => {
  // Producer resumed
});
```

---

## Connection Flow

### Complete Signaling Flow

```
┌─────────────┐                        ┌─────────────┐                      ┌─────────────┐
│   CLIENT    │                        │   SERVER    │                      │  mediasoup  │
│ (Browser)   │                        │  (NestJS)   │                      │             │
└──────┬──────┘                        └──────┬──────┘                      └──────┬──────┘
       │                                      │                                    │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                          1. INITIALIZATION                               │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                                      │                                    │
       │ 1.1 Connect WebSocket               │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │                                    │
       │ 1.2 Join Room                       │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │ 1.3 getOrCreateRouter()            │
       │                                      │ ───────────────────────────────────►
       │                                      │ ◄───────────────────────────────────
       │                                      │           router                   │
       │ 1.4 Router RTP Capabilities         │                                    │
       │ ◄─────────────────────────────────────                                    │
       │                                      │                                    │
       │ 1.5 Create mediasoup Device         │                                    │
       │ (client-side with rtpCapabilities)  │                                    │
       │                                      │                                    │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                       2. CREATE TRANSPORTS                               │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                                      │                                    │
       │ 2.1 Request Send Transport          │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │ 2.2 createWebRtcTransport()        │
       │                                      │ ───────────────────────────────────►
       │                                      │ ◄───────────────────────────────────
       │ 2.3 Transport Params                │                                    │
       │ ◄─────────────────────────────────────                                    │
       │                                      │                                    │
       │ 2.4 device.createSendTransport()    │                                    │
       │ (client-side)                       │                                    │
       │                                      │                                    │
       │ 2.5 Request Recv Transport          │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │ 2.6 createWebRtcTransport()        │
       │                                      │ ───────────────────────────────────►
       │                                      │ ◄───────────────────────────────────
       │ 2.7 Transport Params                │                                    │
       │ ◄─────────────────────────────────────                                    │
       │                                      │                                    │
       │ 2.8 device.createRecvTransport()    │                                    │
       │ (client-side)                       │                                    │
       │                                      │                                    │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                        3. PRODUCE (SEND MEDIA)                           │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                                      │                                    │
       │ 3.1 transport.produce() triggers    │                                    │
       │     'connect' event first           │                                    │
       │                                      │                                    │
       │ 3.2 Connect Transport               │                                    │
       │ { dtlsParameters }                  │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │ 3.3 transport.connect()            │
       │                                      │ ───────────────────────────────────►
       │                                      │ ◄───────────────────────────────────
       │ 3.4 connect callback()              │                                    │
       │ ◄─────────────────────────────────────                                    │
       │                                      │                                    │
       │ 3.5 transport.produce() triggers    │                                    │
       │     'produce' event                 │                                    │
       │                                      │                                    │
       │ 3.6 Produce Request                 │                                    │
       │ { kind, rtpParameters, appData }    │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │ 3.7 transport.produce()            │
       │                                      │ ───────────────────────────────────►
       │                                      │ ◄───────────────────────────────────
       │                                      │        producer                    │
       │ 3.8 { producerId }                  │                                    │
       │ ◄─────────────────────────────────────                                    │
       │                                      │                                    │
       │ 3.9 produce callback(producerId)    │                                    │
       │ MediaStream now flowing to server!  │                                    │
       │                                      │                                    │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                        4. CONSUME (RECEIVE MEDIA)                        │
       │ ═══════════════════════════════════════════════════════════════════════════
       │                                      │                                    │
       │ 4.1 New Producer Available          │                                    │
       │ ◄─────────────────────────────────────                                    │
       │                                      │                                    │
       │ 4.2 Consume Request                 │                                    │
       │ { producerId, rtpCapabilities }     │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │ 4.3 router.canConsume() check      │
       │                                      │ 4.4 recvTransport.consume()        │
       │                                      │ ───────────────────────────────────►
       │                                      │ ◄───────────────────────────────────
       │                                      │        consumer                    │
       │ 4.5 Consumer Params                 │                                    │
       │ { id, producerId, kind,             │                                    │
       │   rtpParameters }                   │                                    │
       │ ◄─────────────────────────────────────                                    │
       │                                      │                                    │
       │ 4.6 transport.consume() triggers    │                                    │
       │     'connect' event (if first time) │                                    │
       │                                      │                                    │
       │ (Similar connect flow as produce)   │                                    │
       │                                      │                                    │
       │ 4.7 Resume Consumer                 │                                    │
       │ ─────────────────────────────────────►                                    │
       │                                      │ 4.8 consumer.resume()              │
       │                                      │ ───────────────────────────────────►
       │                                      │                                    │
       │ 4.9 MediaStream now flowing         │                                    │
       │     from server to client!          │                                    │
       │                                      │                                    │
       ▼                                      ▼                                    ▼
```

---

## Implementation Guide

### Server-side Structure

```
apps/sfu/src/
├── mediasoup/
│   ├── mediasoup.module.ts       # NestJS module
│   ├── worker-manager.service.ts # Quản lý workers
│   ├── router.service.ts         # Quản lý routers per room
│   ├── transport.service.ts      # Quản lý transports
│   ├── producer.service.ts       # Quản lý producers
│   ├── consumer.service.ts       # Quản lý consumers
│   └── types/
│       └── mediasoup.types.ts    # Type definitions
├── signaling/
│   ├── signaling.gateway.ts      # WebSocket handlers
│   └── signaling.service.ts      # Signaling logic
└── config/
    └── mediasoup.config.ts       # mediasoup configuration
```

### Client-side Structure

```
apps/web/src/
├── lib/
│   └── mediasoup/
│       ├── device.ts             # mediasoup Device wrapper
│       ├── transport.ts          # Transport management
│       └── types.ts              # Type definitions
├── hooks/
│   ├── useMediasoup.ts           # Main hook
│   ├── useProducer.ts            # Producer hook
│   └── useConsumer.ts            # Consumer hook
└── store/
    └── mediasoup.store.ts        # Zustand store
```

### Signaling Protocol Messages

```typescript
enum MediasoupSignalType {
  // Router
  GET_ROUTER_RTP_CAPABILITIES = 'router.rtpCapabilities',
  
  // Transport
  CREATE_WEBRTC_TRANSPORT = 'transport.create',
  CONNECT_WEBRTC_TRANSPORT = 'transport.connect',
  
  // Producer
  PRODUCE = 'produce',
  PRODUCER_CREATED = 'producer.created',
  PRODUCER_CLOSED = 'producer.closed',
  NEW_PRODUCER = 'producer.new', // Broadcast
  
  // Consumer
  CONSUME = 'consume',
  CONSUMER_RESUME = 'consumer.resume',
  CONSUMER_CLOSED = 'consumer.closed',
}
```

---

## Best Practices

### 1. Worker Management

```typescript
// Round-robin worker selection
class WorkerManager {
  private workers: mediasoup.Worker[] = [];
  private nextWorkerIndex = 0;
  
  getNextWorker(): mediasoup.Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }
}
```

### 2. Transport Cleanup

```typescript
// Always cleanup on disconnect
client.on('disconnect', () => {
  // Close all transports
  participant.sendTransport?.close();
  participant.recvTransport?.close();
  
  // Producers/Consumers auto-close with transport
});
```

### 3. Consumer Lazy Loading

```typescript
// Don't create consumers immediately
// Only when proctor requests to view
async viewCandidate(candidateId: string) {
  const producers = await getProducersForCandidate(candidateId);
  
  for (const producer of producers) {
    await createConsumerForProducer(producer);
  }
}
```

### 4. Bandwidth Estimation

```typescript
const transport = await router.createWebRtcTransport({
  // Start conservative
  initialAvailableOutgoingBitrate: 600000, // 600kbps
  // mediasoup will adapt based on network conditions
});
```

### 5. Error Handling

```typescript
producer.on('transportclose', () => {
  // Cleanup producer reference
});

consumer.on('producerclose', () => {
  // Producer went away - cleanup consumer
  // Notify client
});

worker.on('died', () => {
  // Critical! Restart worker and reconnect clients
});
```

---

## Tài liệu tham khảo

- [mediasoup Official Documentation](https://mediasoup.org/documentation/)
- [mediasoup v3 Design Document](https://mediasoup.org/documentation/v3/mediasoup/design/)
- [mediasoup-client](https://mediasoup.org/documentation/v3/mediasoup-client/)
- [mediasoup Demo](https://github.com/versatica/mediasoup-demo)
- [SFU Architecture Explained](https://webrtcforthecurious.com/docs/06-media-communication/#selective-forwarding-unit)
