# ADR-003: WebSocket Signaling Protocol Design

## Status
Accepted

## Date
2025-12-16

## Context

WebRTC requires a signaling mechanism to exchange:
- Session Description Protocol (SDP) offers/answers
- ICE candidates
- Connection state updates
- Application-specific messages (room management, etc.)

We need to design a signaling protocol that is:
1. **Type-safe**: Prevent runtime errors from malformed messages
2. **Extensible**: Easy to add new message types
3. **Debuggable**: Clear message format for logging and tracing
4. **Efficient**: Low overhead for real-time requirements

## Decision

We will use **WebSockets** for signaling with a **custom JSON protocol**.

### Message Format

```typescript
interface SignalingMessage {
  type: SignalMessageType;      // Enum identifying message type
  payload?: unknown;            // Type-specific payload
  timestamp: number;            // Unix timestamp for ordering
  correlationId?: string;       // UUID for request/response matching
}
```

### Message Categories

```typescript
enum SignalMessageType {
  // Authentication
  AUTH_REQUEST = 'auth:request',
  AUTH_RESPONSE = 'auth:response',
  
  // Room Management
  ROOM_JOIN = 'room:join',
  ROOM_LEAVE = 'room:leave',
  ROOM_STATE = 'room:state',
  
  // WebRTC Signaling
  SDP_OFFER = 'sdp:offer',
  SDP_ANSWER = 'sdp:answer',
  ICE_CANDIDATE = 'ice:candidate',
  
  // mediasoup Specific
  TRANSPORT_CREATE = 'transport:create',
  TRANSPORT_CONNECT = 'transport:connect',
  PRODUCE = 'produce',
  CONSUME = 'consume',
  
  // Connection Health
  PING = 'ping',
  PONG = 'pong',
  
  // Errors
  ERROR = 'error',
}
```

### Why WebSocket?

1. **Full-duplex**: Server can push to client without polling
2. **Low latency**: Persistent connection, no HTTP overhead per message
3. **State tracking**: Connection represents user session
4. **Built-in heartbeat**: Ping/pong frames for connection health

## Consequences

### Positive

1. **Type safety**: Zod schemas validate every message at runtime
2. **Correlation IDs**: Easy to match request/response pairs
3. **Timestamps**: Message ordering for debugging
4. **Namespaced types**: Clear categorization (auth:*, room:*, sdp:*)
5. **Extensible**: New message types without protocol changes
6. **Debuggable**: JSON format easily logged and inspected

### Negative

1. **JSON overhead**: Larger than binary protocols
2. **No built-in RPC**: Must implement request/response matching
3. **State management**: Must track connection state manually
4. **Single connection**: All message types share one connection

### Risks

1. **Message ordering**: WebSocket guarantees order, but async handlers may not
   - *Mitigation*: Use correlation IDs, sequence numbers if needed
2. **Connection loss**: Must handle reconnection gracefully
   - *Mitigation*: Implement reconnection with state recovery
3. **Message flooding**: Malicious clients could flood server
   - *Mitigation*: Rate limiting per connection

## Protocol Flow Examples

### Room Join Flow

```
Client                          Server
  │                               │
  │── AUTH_REQUEST ──────────────►│
  │   {token, roomId, role}       │
  │                               │
  │◄── AUTH_RESPONSE ─────────────│
  │   {success, userId}           │
  │                               │
  │── ROOM_JOIN ─────────────────►│
  │   {roomId, displayName}       │
  │                               │
  │◄── ROOM_STATE ────────────────│
  │   {participants, roomConfig}  │
  │                               │
```

### WebRTC Connection Flow

```
Candidate                     SFU                        Proctor
    │                          │                            │
    │── TRANSPORT_CREATE ─────►│                            │
    │   {direction: 'send'}    │                            │
    │                          │                            │
    │◄── TRANSPORT_CREATED ────│                            │
    │   {dtlsParameters, ...}  │                            │
    │                          │                            │
    │── TRANSPORT_CONNECT ────►│                            │
    │   {dtlsParameters}       │                            │
    │                          │                            │
    │── PRODUCE ──────────────►│                            │
    │   {kind: 'video'}        │                            │
    │                          │                            │
    │◄── PRODUCED ─────────────│                            │
    │   {producerId}           │── NEW_PRODUCER ───────────►│
    │                          │   {producerId, peerId}     │
    │                          │                            │
    │                          │◄── CONSUME ────────────────│
    │                          │   {producerId}             │
    │                          │                            │
    │                          │── CONSUMER_CREATED ───────►│
    │                          │   {consumerId, ...}        │
```

## Error Handling

```typescript
interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_FULL = 'ROOM_FULL',
  INVALID_MESSAGE = 'INVALID_MESSAGE',
  TRANSPORT_ERROR = 'TRANSPORT_ERROR',
  PRODUCE_ERROR = 'PRODUCE_ERROR',
  CONSUME_ERROR = 'CONSUME_ERROR',
}
```

## Alternatives Considered

### 1. Socket.IO
- **Pros**: Auto-reconnection, rooms, namespaces, fallback to polling
- **Cons**: Additional abstraction, larger bundle, custom protocol overhead
- **Rejected**: Raw WebSocket sufficient, Socket.IO adds unnecessary complexity

### 2. gRPC-Web with Streaming
- **Pros**: Strong typing, efficient binary protocol, streaming support
- **Cons**: Browser support limitations, additional infrastructure
- **Rejected**: WebSocket simpler for this use case, gRPC better for service-to-service

### 3. HTTP Long-Polling
- **Pros**: Works through all firewalls/proxies
- **Cons**: Higher latency, more server connections
- **Rejected**: WebSocket latency required for real-time signaling

### 4. Server-Sent Events (SSE) + HTTP POST
- **Pros**: Simple, works with HTTP/2
- **Cons**: One-way (server to client), need POST for client messages
- **Rejected**: Full-duplex WebSocket simpler for bidirectional signaling

### 5. WebRTC Data Channel for Signaling
- **Pros**: Peer-to-peer possible, encrypted
- **Cons**: Chicken-egg problem (need signaling to establish data channel)
- **Rejected**: Need initial signaling channel anyway

## Implementation Notes

1. Use NestJS `@WebSocketGateway` with raw `ws` library
2. Validate all incoming messages with Zod schemas
3. Implement correlation ID tracking for request/response
4. Add heartbeat (ping/pong) every 30 seconds
5. Log all messages with correlation IDs for debugging
6. Implement reconnection with session recovery token

## References

- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [NestJS WebSocket Documentation](https://docs.nestjs.com/websockets/gateways)
- [WebRTC Signaling and Video Calling](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling)
