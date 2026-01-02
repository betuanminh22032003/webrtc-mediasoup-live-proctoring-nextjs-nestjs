# ADR-002: SFU Architecture with mediasoup

## Status
Accepted

## Date
2025-12-15

## Context

A live proctoring system requires streaming video and audio from multiple candidates to one or more proctors. We need to choose a WebRTC architecture that supports:

1. **One-to-many streaming**: Each candidate's media should be viewable by multiple proctors
2. **Scalability**: Support for 50+ concurrent candidates
3. **Low latency**: Sub-second latency for real-time monitoring
4. **Recording**: Optional server-side recording capability
5. **Quality monitoring**: Ability to monitor stream quality and connection health

### WebRTC Architectures

1. **Mesh (P2P)**: Every peer connects directly to every other peer
2. **SFU (Selective Forwarding Unit)**: Server receives and forwards streams without transcoding
3. **MCU (Multipoint Control Unit)**: Server mixes all streams into one

## Decision

We will use an **SFU (Selective Forwarding Unit) architecture** powered by **mediasoup**.

### Why SFU?

```
┌──────────────┐         ┌─────────────┐         ┌──────────────┐
│  Candidate 1 │────────►│             │────────►│   Proctor 1  │
└──────────────┘         │             │         └──────────────┘
┌──────────────┐         │    SFU      │         ┌──────────────┐
│  Candidate 2 │────────►│  (mediasoup)│────────►│   Proctor 2  │
└──────────────┘         │             │         └──────────────┘
┌──────────────┐         │             │
│  Candidate 3 │────────►│             │
└──────────────┘         └─────────────┘
```

- Candidates upload only once (saves bandwidth)
- Server controls who receives what
- Enables server-side recording
- Lower latency than MCU (no transcoding)

### Why mediasoup?

1. **Performance**: Written in C++ with Node.js bindings, highly optimized
2. **Flexibility**: Full control over media routing logic
3. **Scalability**: Multi-worker architecture for multi-core utilization
4. **Feature-rich**: Simulcast, SVC, bandwidth estimation
5. **Active community**: Well-maintained, frequent updates
6. **No lock-in**: Self-hosted, no cloud dependency

## Consequences

### Positive

1. **Bandwidth efficiency**: Candidates upload once regardless of viewer count
2. **Server control**: Can implement custom routing, quality switching
3. **Recording capability**: Server has access to all streams for recording
4. **Latency**: Lower than MCU since no transcoding required
5. **Scalability**: Can distribute load across multiple workers/servers
6. **Monitoring**: Server can track all connection statistics

### Negative

1. **Server infrastructure**: Requires robust server with public IP
2. **Complexity**: More complex than simple P2P
3. **Cost**: Server resources scale with number of streams
4. **Network requirements**: Requires proper port forwarding for RTP/UDP

### Risks

1. **Single point of failure**: SFU server downtime affects all users
   - *Mitigation*: Multi-server deployment with load balancing
2. **UDP port management**: Firewall configuration complexity
   - *Mitigation*: Use TURN fallback, document port requirements
3. **Learning curve**: mediasoup has complex API
   - *Mitigation*: Incremental implementation, starting with basic routing

## mediasoup Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     NestJS Application                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   mediasoup Workers                  │   │
│  │  (One per CPU core for parallel processing)          │   │
│  ├──────────────┬──────────────┬──────────────────────┤   │
│  │   Worker 1   │   Worker 2   │      Worker N        │   │
│  │   ┌───────┐  │   ┌───────┐  │      ┌───────┐       │   │
│  │   │Router │  │   │Router │  │      │Router │       │   │
│  │   └───┬───┘  │   └───┬───┘  │      └───┬───┘       │   │
│  │       │      │       │      │          │           │   │
│  │  Transports  │  Transports  │     Transports       │   │
│  │  Producers   │  Producers   │     Producers        │   │
│  │  Consumers   │  Consumers   │     Consumers        │   │
│  └──────────────┴──────────────┴──────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Concepts

- **Worker**: OS process for media handling (one per CPU core)
- **Router**: Handles media routing within a room
- **Transport**: WebRTC connection endpoint (send or receive)
- **Producer**: Client sending media track
- **Consumer**: Client receiving media track

## Alternatives Considered

### 1. Mesh (Peer-to-Peer)
```
Every peer connects to every other peer
```
- **Pros**: No server infrastructure, truly decentralized
- **Cons**: N*(N-1)/2 connections, doesn't scale past ~5 peers
- **Rejected**: Proctoring requires many candidates, mesh won't scale

### 2. MCU (Multipoint Control Unit)
```
Server mixes all streams into composite
```
- **Pros**: Single stream to each client, very low client bandwidth
- **Cons**: High server CPU for transcoding, added latency, loss of individual control
- **Rejected**: Need individual candidate streams, transcoding latency unacceptable

### 3. Janus WebRTC Server
- **Pros**: Mature, feature-rich, large community
- **Cons**: C codebase harder to customize, heavier memory footprint
- **Rejected**: mediasoup provides better Node.js integration and performance

### 4. Jitsi Videobridge
- **Pros**: Battle-tested, complete solution
- **Cons**: Designed for conferencing, harder to customize for proctoring
- **Rejected**: Too opinionated for our specific use case

### 5. Cloud Services (Twilio, Agora, Vonage)
- **Pros**: No infrastructure management, global scale
- **Cons**: Recurring costs, vendor lock-in, data sovereignty concerns
- **Rejected**: Cost at scale, need full control over media for proctoring

## Implementation Notes

1. Create mediasoup workers on server startup (one per CPU)
2. Create router per room (or shared router with audio/video capabilities)
3. Use WebRTC transport for both send and receive
4. Implement producer/consumer lifecycle tied to signaling
5. Consider simulcast for adaptive quality

## References

- [mediasoup Documentation](https://mediasoup.org/documentation/)
- [WebRTC Architecture Comparison](https://webrtc.ventures/2020/12/webrtc-architecture/)
- [mediasoup v3 Design](https://mediasoup.org/documentation/v3/mediasoup/design/)
