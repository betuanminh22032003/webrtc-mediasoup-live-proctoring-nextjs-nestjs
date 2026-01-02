# ADR-004: Frontend State Management with Zustand

## Status
Accepted

## Date
2025-12-17

## Context

The proctoring frontend needs to manage complex, interconnected state:

1. **WebRTC State**
   - Local media streams (webcam, screen, audio)
   - Peer connections and their states
   - ICE connection states
   - Media track states (enabled/disabled)

2. **Signaling State**
   - WebSocket connection status
   - Pending messages and correlation tracking
   - Authentication state

3. **Room State**
   - Current room information
   - Participant list
   - Room configuration

4. **UI State**
   - Selected participant (proctor view)
   - Layout preferences
   - Notification queue

### Requirements

1. **Reactive updates**: UI must reflect state changes immediately
2. **External access**: WebSocket handlers need to update state
3. **Debugging**: Easy to inspect and trace state changes
4. **Performance**: Minimal re-renders
5. **TypeScript support**: Full type safety

## Decision

We will use **Zustand** for global state management.

### Store Structure

```typescript
// webrtc.store.ts
interface WebRTCState {
  // Connection state
  signalingState: ConnectionState;
  peerConnectionState: RTCPeerConnectionState | null;
  iceConnectionState: RTCIceConnectionState | null;
  
  // Media state
  localStream: MediaStream | null;
  screenStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  
  // Room state
  roomId: string | null;
  participants: Participant[];
  
  // Actions
  setSignalingState: (state: ConnectionState) => void;
  addRemoteStream: (peerId: string, stream: MediaStream) => void;
  removeRemoteStream: (peerId: string) => void;
  updateParticipant: (participant: Participant) => void;
}
```

### Why Zustand?

1. **Minimal API**: Simple `create()` function, no boilerplate
2. **No providers**: Access state anywhere without Context
3. **External updates**: Easy to update from WebSocket handlers
4. **TypeScript-first**: Excellent type inference
5. **Devtools**: Redux DevTools integration
6. **Small bundle**: ~1KB gzipped

## Consequences

### Positive

1. **Simple mental model**: Just a hook that returns state and actions
2. **No provider wrapping**: Cleaner component tree
3. **Async-friendly**: Actions can be async, no middleware needed
4. **Selective subscriptions**: Components only re-render on subscribed state
5. **SSR compatible**: Works with Next.js App Router
6. **External access**: `store.getState()` and `store.setState()` work outside React

### Negative

1. **Global store**: Single store can become unwieldy if not structured well
2. **No built-in persistence**: Need manual implementation or middleware
3. **Less opinionated**: Requires discipline to structure well

### Risks

1. **State bloat**: Store could grow large
   - *Mitigation*: Split into multiple stores (signaling, media, room)
2. **Memory leaks**: MediaStream objects need cleanup
   - *Mitigation*: Implement cleanup actions, use effect cleanup

## Usage Examples

### Creating the Store

```typescript
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

export const useWebRTCStore = create<WebRTCState>()(
  devtools(
    (set, get) => ({
      signalingState: ConnectionState.DISCONNECTED,
      localStream: null,
      remoteStreams: new Map(),
      
      setSignalingState: (state) => 
        set({ signalingState: state }, false, 'setSignalingState'),
      
      addRemoteStream: (peerId, stream) =>
        set(
          (state) => ({
            remoteStreams: new Map(state.remoteStreams).set(peerId, stream),
          }),
          false,
          'addRemoteStream'
        ),
    }),
    { name: 'webrtc-store' }
  )
);
```

### Component Usage

```typescript
function ConnectionIndicator() {
  // Only re-renders when signalingState changes
  const signalingState = useWebRTCStore((s) => s.signalingState);
  
  return <Badge status={signalingState} />;
}
```

### External Usage (WebSocket Handler)

```typescript
// In signaling hook or service
const handleMessage = (message: SignalingMessage) => {
  const { addRemoteStream } = useWebRTCStore.getState();
  
  if (message.type === 'REMOTE_STREAM') {
    addRemoteStream(message.peerId, message.stream);
  }
};
```

## Store Organization

```
store/
├── index.ts           # Export all stores
├── webrtc.store.ts    # WebRTC connection state
├── media.store.ts     # Media devices and streams
├── room.store.ts      # Room and participants
└── ui.store.ts        # UI preferences
```

## Alternatives Considered

### 1. Redux Toolkit
- **Pros**: Battle-tested, large ecosystem, great devtools
- **Cons**: More boilerplate, requires providers, middleware for async
- **Rejected**: Overkill for this project size, Zustand is simpler

### 2. React Context + useReducer
- **Pros**: Built into React, no dependencies
- **Cons**: Re-renders all consumers, awkward async, no devtools
- **Rejected**: Performance concerns with frequent WebRTC updates

### 3. Jotai
- **Pros**: Atomic model, similar to Recoil
- **Cons**: Different mental model, more atoms to manage
- **Rejected**: Zustand's single-store model fits our use case better

### 4. Recoil
- **Pros**: From Meta, atomic state, great for derived state
- **Cons**: Larger bundle, still experimental, complex API
- **Rejected**: More complexity than needed, Zustand is simpler

### 5. MobX
- **Pros**: Observables, computed values, minimal boilerplate
- **Cons**: Different paradigm (OOP), decorators, learning curve
- **Rejected**: Team more familiar with hooks-based patterns

### 6. Component State + Props
- **Pros**: Simple, no external dependency
- **Cons**: Prop drilling, state scattered across components
- **Rejected**: WebRTC state needs to be shared globally

## Implementation Notes

1. Initialize store with sensible defaults
2. Use `immer` middleware for complex nested updates if needed
3. Implement `persist` middleware for settings that should survive refresh
4. Use selectors for derived state
5. Clean up MediaStreams on store cleanup

## References

- [Zustand Documentation](https://github.com/pmndrs/zustand)
- [Zustand + TypeScript Best Practices](https://docs.pmnd.rs/zustand/guides/typescript)
- [Managing State with Zustand](https://tkdodo.eu/blog/working-with-zustand)
