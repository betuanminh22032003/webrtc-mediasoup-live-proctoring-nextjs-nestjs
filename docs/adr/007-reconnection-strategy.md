# ADR-007: WebRTC Reconnection Strategy

## Status
Accepted

## Date
2025-12-20

## Context

WebRTC connections in a proctoring system must be highly reliable. Connection interruptions can occur due to:
- Network changes (WiFi to mobile, network congestion)
- NAT/firewall issues
- Server restarts
- Browser background/foreground transitions
- Temporary ICE failures

For proctoring, connection loss is critical:
- Candidate disconnection could indicate cheating attempt
- Proctor must be able to distinguish intentional vs accidental disconnects
- System must recover automatically when possible

## Decision

We will implement a **multi-layer reconnection strategy** with exponential backoff.

### Reconnection Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    Reconnection Layers                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Layer 1: ICE Restart (fastest, preserves session)          │
│  └─► Triggered by ICE connection state 'disconnected'       │
│  └─► Renegotiate ICE without full reconnection              │
│                                                             │
│  Layer 2: PeerConnection Restart (medium, same signaling)   │
│  └─► Triggered by ICE connection state 'failed'             │
│  └─► Create new PeerConnection, reuse WebSocket             │
│                                                             │
│  Layer 3: Full Reconnection (slowest, complete reset)       │
│  └─► Triggered by WebSocket close/error                     │
│  └─► Reconnect WebSocket, then PeerConnection               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Exponential Backoff Configuration

```typescript
interface ReconnectionConfig {
  maxAttempts: number;          // 5
  baseDelayMs: number;          // 1000 (1 second)
  maxDelayMs: number;           // 30000 (30 seconds)
  jitterFactor: number;         // 0.3 (30% randomization)
}

// Delay calculation
const getDelay = (attempt: number): number => {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = cappedDelay * jitterFactor * Math.random();
  return cappedDelay + jitter;
};
```

## Consequences

### Positive

1. **Graceful degradation**: Try fastest method first, escalate as needed
2. **Minimal disruption**: ICE restart often fixes issues without user noticing
3. **Predictable behavior**: Clear state machine for connection states
4. **Auditability**: All reconnection attempts logged for review
5. **User feedback**: UI shows reconnection status

### Negative

1. **Complexity**: Multiple reconnection paths to maintain
2. **State management**: Must track reconnection state carefully
3. **Race conditions**: Possible issues with concurrent reconnection attempts

### Risks

1. **Reconnection storms**: Many clients reconnecting simultaneously
   - *Mitigation*: Jitter prevents synchronized retry attempts
2. **State inconsistency**: Reconnection during state change
   - *Mitigation*: Use state machine, reject operations during reconnecting
3. **Zombie connections**: Old connections not cleaned up
   - *Mitigation*: Explicit cleanup before new connection

## State Machine

```
                                    ┌────────────────┐
                                    │                │
                                    │  DISCONNECTED  │◄──────────────────┐
                                    │                │                    │
                                    └───────┬────────┘                    │
                                            │                             │
                                            │ connect()                   │
                                            ▼                             │
                                    ┌────────────────┐                    │
                                    │                │                    │
                                    │  CONNECTING    │                    │
                                    │                │                    │
                                    └───────┬────────┘                    │
                                            │                             │
                                            │ onOpen                      │
                                            ▼                             │
                                    ┌────────────────┐                    │
                          ┌────────►│                │                    │
                          │         │   CONNECTED    │                    │
                          │         │                │                    │
                          │         └───────┬────────┘                    │
                          │                 │                             │
                          │                 │ ICE disconnected / WS error │
                          │                 ▼                             │
                          │         ┌────────────────┐                    │
                          │         │                │                    │
                          │ success │  RECONNECTING  │────────────────────┤
                          │         │                │  max attempts      │
                          │         └───────┬────────┘  exceeded          │
                          │                 │                             │
                          │                 │                             │
                          └─────────────────┘                             │
                                                                          │
                                    ┌────────────────┐                    │
                                    │                │                    │
                                    │    FAILED      │────────────────────┘
                                    │                │  user retry
                                    └────────────────┘
```

## Implementation

### ReconnectionManager Class

```typescript
export class ReconnectionManager {
  private state: ReconnectionState = 'idle';
  private attemptCount = 0;
  private timeoutId: NodeJS.Timeout | null = null;

  constructor(
    private config: ReconnectionConfig,
    private callbacks: ReconnectionCallbacks,
  ) {}

  startReconnection(): void {
    if (this.state === 'reconnecting') return;
    
    this.state = 'reconnecting';
    this.attemptCount = 0;
    this.scheduleAttempt();
  }

  private scheduleAttempt(): void {
    if (this.attemptCount >= this.config.maxAttempts) {
      this.state = 'failed';
      this.callbacks.onFailed();
      return;
    }

    const delay = this.getDelay(this.attemptCount);
    
    this.timeoutId = setTimeout(() => {
      this.attemptCount++;
      this.callbacks.onAttempt(this.attemptCount);
    }, delay);
  }

  onSuccess(): void {
    this.reset();
    this.callbacks.onSuccess();
  }

  reset(): void {
    this.state = 'idle';
    this.attemptCount = 0;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  private getDelay(attempt: number): number {
    const exponential = this.config.baseDelayMs * Math.pow(2, attempt);
    const capped = Math.min(exponential, this.config.maxDelayMs);
    const jitter = capped * this.config.jitterFactor * Math.random();
    return Math.floor(capped + jitter);
  }
}
```

### ICE Restart Handling

```typescript
// In peer connection hook
useEffect(() => {
  if (!peerConnection) return;

  const handleIceConnectionStateChange = () => {
    const state = peerConnection.iceConnectionState;
    
    if (state === 'disconnected') {
      // Try ICE restart first (fastest recovery)
      initiateIceRestart();
    } else if (state === 'failed') {
      // ICE restart didn't work, escalate
      reconnectionManager.startReconnection();
    } else if (state === 'connected') {
      reconnectionManager.onSuccess();
    }
  };

  peerConnection.addEventListener(
    'iceconnectionstatechange',
    handleIceConnectionStateChange,
  );

  return () => {
    peerConnection.removeEventListener(
      'iceconnectionstatechange',
      handleIceConnectionStateChange,
    );
  };
}, [peerConnection]);

const initiateIceRestart = async () => {
  const offer = await peerConnection.createOffer({ iceRestart: true });
  await peerConnection.setLocalDescription(offer);
  sendSignalingMessage('sdp:offer', { sdp: offer.sdp, iceRestart: true });
};
```

### WebSocket Reconnection

```typescript
// In signaling hook
const connect = useCallback(() => {
  const ws = new WebSocket(url);
  
  ws.onclose = (event) => {
    if (!event.wasClean && !isIntentionalDisconnect) {
      wsReconnectionManager.startReconnection();
    }
  };
  
  ws.onerror = () => {
    wsReconnectionManager.startReconnection();
  };
  
  ws.onopen = () => {
    wsReconnectionManager.onSuccess();
    // Re-authenticate and rejoin room
    sendAuthRequest();
  };
  
  wsRef.current = ws;
}, [url]);
```

## UI Feedback

```typescript
function ConnectionStatus() {
  const connectionState = useWebRTCStore((s) => s.connectionState);
  const reconnectAttempt = useWebRTCStore((s) => s.reconnectAttempt);
  
  if (connectionState === 'reconnecting') {
    return (
      <Banner type="warning">
        Connection interrupted. Reconnecting... (Attempt {reconnectAttempt}/5)
      </Banner>
    );
  }
  
  if (connectionState === 'failed') {
    return (
      <Banner type="error">
        Connection failed. <Button onClick={retry}>Retry</Button>
      </Banner>
    );
  }
  
  return null;
}
```

## Alternatives Considered

### 1. Simple Retry (No Backoff)
- **Pros**: Simple implementation
- **Cons**: Can overwhelm server, reconnection storms
- **Rejected**: Not production-ready

### 2. Linear Backoff
- **Pros**: Predictable delays
- **Cons**: Too slow for fast recovery, too fast for long outages
- **Rejected**: Exponential better adapts to various outage durations

### 3. Fixed Retry Intervals
- **Pros**: Very simple
- **Cons**: Synchronized retries can cause thundering herd
- **Rejected**: Need jitter for distributed systems

### 4. Socket.IO Auto-Reconnection
- **Pros**: Built-in, battle-tested
- **Cons**: Doesn't handle WebRTC reconnection, couples to Socket.IO
- **Rejected**: Need unified strategy for both WS and WebRTC

### 5. Circuit Breaker Pattern
- **Pros**: Prevents cascading failures
- **Cons**: More complex, may be overkill
- **Rejected**: Can add as enhancement later if needed

## Proctoring-Specific Considerations

1. **Log all disconnections**: Every disconnect must be recorded for audit
2. **Distinguish types**: Intentional leave vs. network failure vs. browser close
3. **Grace period**: Allow brief disconnection before flagging as suspicious
4. **Proctor notification**: Alert proctor when candidate has connection issues
5. **Resume position**: Remember last known state for seamless recovery

## Implementation Notes

1. Use separate ReconnectionManager instances for WS and PeerConnection
2. Clear all pending timeouts on intentional disconnect
3. Emit events for monitoring/analytics
4. Test with network throttling and disconnect simulation
5. Implement health check endpoint for server-side monitoring

## References

- [WebRTC ICE Restart](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce)
- [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff)
- [AWS Architecture Blog - Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
