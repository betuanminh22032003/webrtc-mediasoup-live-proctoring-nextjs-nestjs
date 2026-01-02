# ADR-006: NestJS WebSocket Gateway

## Status
Accepted

## Date
2025-12-18

## Context

The SFU server needs to handle real-time WebSocket connections for:
- WebRTC signaling (SDP exchange, ICE candidates)
- Room management (join, leave, state sync)
- Connection health monitoring (heartbeat)

We need to choose a WebSocket implementation strategy that:
1. Integrates well with NestJS ecosystem
2. Supports multiple concurrent connections
3. Provides lifecycle hooks for connection management
4. Enables structured message handling

## Decision

We will use **NestJS WebSocket Gateway** with the raw **ws** library (not Socket.IO).

### Implementation Structure

```typescript
@WebSocketGateway({
  path: '/ws',
})
export class SignalingGateway 
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect 
{
  @WebSocketServer()
  server: Server;

  afterInit(): void {
    // Setup heartbeat interval
  }

  handleConnection(client: WebSocket): void {
    // Track new connection
  }

  handleDisconnect(client: WebSocket): void {
    // Cleanup on disconnect
  }

  @SubscribeMessage(SignalMessageType.ROOM_JOIN)
  handleRoomJoin(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: unknown,
  ): void {
    // Handle room join
  }
}
```

### Why NestJS Gateway?

1. **Declarative handlers**: `@SubscribeMessage` decorator for clean routing
2. **Lifecycle hooks**: `OnGatewayInit`, `OnGatewayConnection`, `OnGatewayDisconnect`
3. **Dependency injection**: Access to services via NestJS DI
4. **Guards and pipes**: Reuse NestJS validation patterns
5. **Fastify compatibility**: Works with Fastify adapter

### Why raw ws over Socket.IO?

1. **Lower overhead**: No Socket.IO protocol layer
2. **Smaller bundle**: Socket.IO adds ~40KB to client
3. **Standard WebSocket**: Uses standard WebSocket API
4. **Control**: Full control over message format
5. **mediasoup compatibility**: mediasoup examples use raw ws

## Consequences

### Positive

1. **Clean architecture**: Gateway pattern separates signaling concerns
2. **Type safety**: Decorators work with TypeScript
3. **Testable**: Easy to unit test with mocked connections
4. **Scalable**: Can add multiple gateways for different concerns
5. **Familiar patterns**: Same DI and decorators as REST controllers

### Negative

1. **Manual reconnection**: Must implement reconnection logic (Socket.IO has built-in)
2. **No namespaces/rooms**: Must implement room logic manually
3. **Binary frames**: Must handle manually if needed

### Risks

1. **Connection management**: Must track connections manually
   - *Mitigation*: Use `Map<string, WebSocket>` for client tracking
2. **Memory leaks**: Connections not cleaned up properly
   - *Mitigation*: Implement heartbeat, cleanup on disconnect
3. **Scaling**: Single server limitation
   - *Mitigation*: Redis pub/sub for multi-server (future)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SignalingGateway                         │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              @WebSocketGateway                        │  │
│  │                                                       │  │
│  │  afterInit()        - Setup heartbeat                 │  │
│  │  handleConnection() - Track client, assign ID         │  │
│  │  handleDisconnect() - Cleanup, notify room            │  │
│  │                                                       │  │
│  │  @SubscribeMessage('room:join')                       │  │
│  │  @SubscribeMessage('sdp:offer')                       │  │
│  │  @SubscribeMessage('ice:candidate')                   │  │
│  │  ...                                                  │  │
│  └───────────────────────────────────────────────────────┘  │
│                           │                                  │
│              ┌────────────┴────────────┐                    │
│              ▼                         ▼                    │
│  ┌──────────────────┐     ┌──────────────────┐              │
│  │ SignalingService │     │   RoomService    │              │
│  │                  │     │                  │              │
│  │ - handleOffer()  │     │ - createRoom()   │              │
│  │ - handleAnswer() │     │ - joinRoom()     │              │
│  │ - handleIce()    │     │ - leaveRoom()    │              │
│  └──────────────────┘     └──────────────────┘              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Connection Lifecycle

```
Client                                    Server
   │                                         │
   │════════ WebSocket Connect ═════════════►│
   │                                         │ handleConnection()
   │                                         │ - Assign client ID
   │                                         │ - Start heartbeat
   │                                         │
   │◄════════ Connection ACK ════════════════│
   │  {type: 'connected', clientId: '...'}   │
   │                                         │
   │════════ AUTH_REQUEST ══════════════════►│
   │  {token, roomId}                        │ @SubscribeMessage
   │                                         │
   │◄════════ AUTH_RESPONSE ═════════════════│
   │  {success: true}                        │
   │                                         │
   │════════ PING ══════════════════════════►│
   │                                         │
   │◄════════ PONG ══════════════════════════│
   │                                         │
   │                      ...                │
   │                                         │
   │═══════ WebSocket Close ════════════════►│
   │                                         │ handleDisconnect()
   │                                         │ - Clean up resources
   │                                         │ - Notify room members
```

## Heartbeat Implementation

```typescript
// Server-side heartbeat
afterInit(): void {
  setInterval(() => {
    this.clients.forEach((client) => {
      if (!client.isAlive) {
        client.terminate();
        return;
      }
      client.isAlive = false;
      client.ping();
    });
  }, 30000);
}

handleConnection(client: AuthenticatedSocket): void {
  client.isAlive = true;
  client.on('pong', () => {
    client.isAlive = true;
  });
}
```

## Alternatives Considered

### 1. Socket.IO with @nestjs/platform-socket.io
- **Pros**: Auto-reconnection, rooms/namespaces, binary support, fallback to polling
- **Cons**: Protocol overhead, larger bundle, not standard WebSocket
- **Rejected**: Added complexity without proportional benefit for our use case

### 2. Plain ws without NestJS Integration
- **Pros**: Maximum control, simplest implementation
- **Cons**: No DI, manual setup, doesn't fit NestJS patterns
- **Rejected**: Loses benefits of NestJS architecture

### 3. uWebSockets.js
- **Pros**: Highest performance, very low memory
- **Cons**: Different API, less NestJS integration, compile requirements
- **Rejected**: Performance not critical enough to justify complexity

### 4. Fastify @fastify/websocket
- **Pros**: Native Fastify integration
- **Cons**: Less NestJS-idiomatic, different patterns than controllers
- **Rejected**: NestJS gateway pattern more consistent with codebase

### 5. GraphQL Subscriptions
- **Pros**: Type-safe, integrates with GraphQL
- **Cons**: Overkill for signaling, subscription overhead
- **Rejected**: WebSocket signaling is simpler and more direct

## Implementation Notes

1. Use Fastify adapter with @nestjs/platform-ws
2. Extend WebSocket interface for custom properties
3. Implement correlation ID tracking for request/response
4. Use structured logging for all events
5. Validate all incoming messages with Zod
6. Implement graceful shutdown cleanup

## Message Handler Pattern

```typescript
@SubscribeMessage(SignalMessageType.SDP_OFFER)
handleSdpOffer(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() data: unknown,
): WsResponse<SdpAnswerPayload> | void {
  // 1. Validate message
  const result = SdpOfferSchema.safeParse(data);
  if (!result.success) {
    return this.sendError(client, result.error);
  }
  
  // 2. Check authorization
  if (!client.roomId) {
    return this.sendError(client, 'NOT_IN_ROOM');
  }
  
  // 3. Process
  const response = this.signalingService.handleOffer(
    client,
    result.data,
  );
  
  // 4. Respond
  return { event: SignalMessageType.SDP_ANSWER, data: response };
}
```

## References

- [NestJS WebSockets Documentation](https://docs.nestjs.com/websockets/gateways)
- [ws Library](https://github.com/websockets/ws)
- [NestJS Platform WS](https://docs.nestjs.com/websockets/adapter)
