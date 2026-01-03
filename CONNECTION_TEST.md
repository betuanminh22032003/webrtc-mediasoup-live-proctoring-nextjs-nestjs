# Connection Test Guide

## Prerequisites

Before testing the candidate-proctor connection, ensure:

1. **Server is running** on port 3001
2. **Web client is running** on port 3000
3. Both are using the same room ID (`proctoring-demo-room`)

## How to Test Connection

### Step 1: Start the Server

```bash
pnpm dev
```

This will start:
- SFU Server on `http://localhost:3001`
- Web Client on `http://localhost:3000`

### Step 2: Open Proctor Dashboard

1. Open browser: `http://localhost:3000/proctor`
2. Check browser console for connection logs:
   ```
   [WebSocket] Connected successfully to: ws://localhost:3001/ws
   [WebSocket] Sending ROOM_JOIN with payload...
   [WebSocket] Received ROOM_STATE...
   ```

### Step 3: Open Candidate Page

1. Open a **new browser window/tab** or **incognito window**
2. Navigate to: `http://localhost:3000/candidate`
3. Click "Start System Check"
4. Allow camera and screen share permissions
5. Click "Start Exam"

### Step 4: Verify Connection

#### In Candidate Page:
- ✅ Webcam preview visible
- ✅ Screen share active
- ✅ Connection status: "Connected"
- ✅ Console shows:
  ```
  [WebSocket] Connected successfully
  [WebSocket] Received ROOM_STATE
  [WebSocket] Device loaded successfully!
  mediasoup Device loaded successfully
  Webcam producer created: <producer-id>
  Screen producer created: <producer-id>
  ```

#### In Proctor Dashboard:
- ✅ Candidate appears in grid
- ✅ Webcam stream visible
- ✅ Screen stream visible
- ✅ Connection quality indicator: "good"
- ✅ Console shows:
  ```
  [WebSocket] New participant joined
  New producer available: { producerId, producerPeerId, kind }
  Got consumer: <consumer-id>
  Updated remote stream for peer: <peer-id>
  ```

## Expected Logs

### Server Logs (apps/sfu)

```
INFO: Client connected { clientId: xxx, totalClients: 1 }
INFO: handleRoomJoin called with data { userId, roomId, role: 'proctor' }
INFO: User joined room { userId, roomId: 'proctoring-demo-room', role: 'proctor' }
INFO: Sending room state to newly joined user { participantCount: 1 }

INFO: Client connected { clientId: yyy, totalClients: 2 }
INFO: handleRoomJoin called with data { userId, roomId, role: 'candidate' }
INFO: User joined room { userId, roomId: 'proctoring-demo-room', role: 'candidate' }
INFO: Notifying other participants of new join { newUserRole: 'candidate', notifyingClients: 1 }

INFO: Received GET_RTP_CAPABILITIES request { userId, roomId }
INFO: Sending RTP capabilities to client { hasCapabilities: true }
INFO: Manual handling CREATE_TRANSPORT
INFO: Manual handling PRODUCE
INFO: Notifying room of new producer { producerId, kind: 'video' }
```

### Client Logs (Browser Console)

**Proctor:**
```
[WebSocket] Connected successfully to: ws://localhost:3001/ws
[WebSocket] User info: { userId, role: 'proctor', roomId: 'proctoring-demo-room' }
[WebSocket] Sending ROOM_JOIN with payload: { roomId, user: { id, role: 'proctor' } }
[WebSocket] Received ROOM_STATE: { participants: [...] }
[WebSocket] Room participants: [{ id, role: 'proctor', name }]
[WebSocket] Received RTP_CAPABILITIES, loading device...
[WebSocket] Device loaded successfully!
[WebSocket] New participant joined: { participant: { user: { role: 'candidate' } } }
New producer available: { producerId, producerPeerId, kind: 'video', appData }
Got consumer: <consumer-id>
Updated remote stream for peer: <peer-id>
```

**Candidate:**
```
[WebSocket] Connected successfully to: ws://localhost:3001/ws
[WebSocket] User info: { userId, role: 'candidate', roomId: 'proctoring-demo-room' }
[WebSocket] Sending ROOM_JOIN with payload: { roomId, user: { id, role: 'candidate' } }
[WebSocket] Received ROOM_STATE: { participants: [{ role: 'proctor' }] }
[WebSocket] Room participants: [{ id, role: 'proctor', name }]
[WebSocket] Received RTP_CAPABILITIES, loading device...
[WebSocket] Device loaded successfully!
Producing webcam stream...
Webcam producer created: <producer-id>
Producing screen stream...
Screen producer created: <producer-id>
```

## Troubleshooting

### Issue: "WebSocket not connected"

**Solution:**
- Check SFU server is running on port 3001
- Verify `NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws` in environment
- Check browser console for WebSocket errors

### Issue: "Device not loaded"

**Solution:**
- Wait for RTP capabilities response from server
- Check server logs for errors in mediasoup worker
- Ensure mediasoup workers are initialized

### Issue: "No streams visible in proctor"

**Solution:**
- Verify candidate has produced streams (check console logs)
- Check proctor is consuming producers (look for "New producer available")
- Verify both users are in the same room (`proctoring-demo-room`)
- Check browser console for consumer creation errors

### Issue: "Transport creation failed"

**Solution:**
- Check mediasoup worker configuration
- Verify RTC ports are not blocked (40000-49999)
- Check server logs for transport errors
- Ensure MEDIASOUP_LISTEN_IP is set correctly

### Issue: "No RTP capabilities received"

**Solution:**
- Check if ROOM_JOIN was successful
- Verify user is in room before requesting capabilities
- Check server logs for errors
- Retry GET_RTP_CAPABILITIES request

## Network Requirements

- **Local Development:** localhost works without TURN
- **Production:** TURN server required for NAT traversal
- **Ports:**
  - 3000: Web client
  - 3001: SFU server HTTP/WebSocket
  - 40000-49999: mediasoup RTC ports (UDP)

## Common Issues Fixed

✅ **Import type errors** - Fixed TypeScript import issues in signaling.gateway.ts
✅ **Connection logging** - Added detailed logging for debugging connections
✅ **Room state tracking** - Enhanced room state notifications
✅ **Same room ID** - Both pages use `proctoring-demo-room` constant

## Testing Checklist

- [ ] Server starts without errors
- [ ] Proctor connects and joins room
- [ ] Candidate connects and joins room
- [ ] Proctor sees candidate in participants list
- [ ] Candidate produces webcam stream
- [ ] Candidate produces screen stream
- [ ] Proctor consumes both streams
- [ ] Streams are visible in proctor grid
- [ ] Connection quality shows "good"
- [ ] No errors in browser console
- [ ] No errors in server logs

## Next Steps

If all tests pass:
1. Test with multiple candidates
2. Test reconnection scenarios
3. Test on different networks
4. Add TURN server for production
5. Implement violation detection
6. Add recording capabilities
