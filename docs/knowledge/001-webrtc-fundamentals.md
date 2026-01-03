# WebRTC Fundamentals - Kiến Thức Nền Tảng

## Mục Lục

1. [WebRTC là gì?](#webrtc-là-gì)
2. [Các thành phần cốt lõi](#các-thành-phần-cốt-lõi)
3. [Signaling - Quá trình thiết lập kết nối](#signaling---quá-trình-thiết-lập-kết-nối)
4. [ICE, STUN, TURN - Vượt qua NAT](#ice-stun-turn---vượt-qua-nat)
5. [Media Tracks và Streams](#media-tracks-và-streams)
6. [Codecs và Media Negotiation](#codecs-và-media-negotiation)

---

## WebRTC là gì?

**WebRTC (Web Real-Time Communication)** là công nghệ cho phép truyền tải audio, video và data trực tiếp giữa các trình duyệt mà không cần plugin.

```
┌─────────────┐                              ┌─────────────┐
│   Browser   │◄────── Audio/Video/Data ────►│   Browser   │
│   (Peer A)  │         Real-time P2P        │   (Peer B)  │
└─────────────┘                              └─────────────┘
```

### Tại sao WebRTC quan trọng?

1. **Native trong browser** - Không cần cài đặt thêm gì
2. **Bảo mật** - Mã hóa end-to-end (DTLS + SRTP)
3. **Low latency** - Thiết kế cho real-time (< 500ms)
4. **Adaptive** - Tự điều chỉnh quality theo network

### Ứng dụng thực tế

- Video call (Google Meet, Zoom web)
- Live streaming
- Screen sharing
- File transfer P2P
- **Live proctoring** (đúng use case của chúng ta!)

---

## Các thành phần cốt lõi

### 1. RTCPeerConnection

Đây là **trái tim của WebRTC** - quản lý toàn bộ kết nối P2P.

```typescript
// Tạo peer connection
const peerConnection = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:turn.example.com',
      username: 'user',
      credential: 'pass',
    },
  ],
});

// Lifecycle events quan trọng
peerConnection.onicecandidate = (event) => {
  // Gửi ICE candidate cho peer khác qua signaling server
};

peerConnection.ontrack = (event) => {
  // Nhận media track từ peer khác
  videoElement.srcObject = event.streams[0];
};

peerConnection.onconnectionstatechange = () => {
  console.log('Connection state:', peerConnection.connectionState);
  // 'new' → 'connecting' → 'connected' → 'disconnected'/'failed'
};
```

### Connection States

```
                        ┌─────────────────────────────────────┐
                        ▼                                     │
┌─────┐    ┌────────────┐    ┌───────────┐    ┌──────────────┐
│ new │───►│ connecting │───►│ connected │───►│ disconnected │
└─────┘    └────────────┘    └───────────┘    └──────────────┘
                │                   │                 │
                ▼                   ▼                 ▼
           ┌────────┐          ┌────────┐        ┌────────┐
           │ failed │          │ closed │        │ failed │
           └────────┘          └────────┘        └────────┘
```

### 2. MediaStream và MediaStreamTrack

**MediaStream** là container chứa các **MediaStreamTrack** (audio hoặc video).

```typescript
// Lấy media từ camera/mic
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
  },
});

// stream.getTracks() trả về array của MediaStreamTrack
// Mỗi track có thể được add vào peer connection riêng
stream.getTracks().forEach((track) => {
  peerConnection.addTrack(track, stream);
});

// Screen sharing
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: {
    cursor: 'always', // Hiển thị cursor
  },
});
```

### 3. RTCDataChannel

Cho phép gửi data tùy ý (text, binary) P2P.

```typescript
// Tạo data channel
const dataChannel = peerConnection.createDataChannel('chat', {
  ordered: true, // Đảm bảo thứ tự
  maxRetransmits: 3, // Số lần retry
});

dataChannel.onmessage = (event) => {
  console.log('Received:', event.data);
};

dataChannel.send('Hello peer!');
```

---

## Signaling - Quá trình thiết lập kết nối

### Tại sao cần Signaling?

WebRTC là P2P, nhưng **trước khi** 2 peers có thể nói chuyện trực tiếp, chúng cần:

1. **Tìm nhau** - Biết địa chỉ IP/port của peer
2. **Thỏa thuận** - Agree về codecs, encryption
3. **Vượt NAT** - Trao đổi ICE candidates

**Signaling server** là "người mai mối" - không truyền media, chỉ giúp thiết lập kết nối.

```
┌──────────┐                                    ┌──────────┐
│  Peer A  │                                    │  Peer B  │
└────┬─────┘                                    └────┬─────┘
     │                 ┌──────────────┐              │
     │                 │  Signaling   │              │
     │                 │   Server     │              │
     │                 │  (WebSocket) │              │
     │                 └──────┬───────┘              │
     │                        │                      │
     │ 1. Create Offer        │                      │
     │────────────────────────►                      │
     │                        │ 2. Forward Offer     │
     │                        │──────────────────────►
     │                        │                      │
     │                        │ 3. Create Answer     │
     │                        ◄──────────────────────│
     │ 4. Forward Answer      │                      │
     ◄────────────────────────│                      │
     │                        │                      │
     │ 5. ICE Candidates      │                      │
     │◄───────────────────────►──────────────────────►
     │                        │                      │
     │ 6. Direct P2P Connection (after ICE complete) │
     │◄──────────────────────────────────────────────►
```

### SDP (Session Description Protocol)

SDP là format mô tả media session. Có 2 loại:

**Offer** - "Đây là những gì tôi muốn gửi/nhận"
**Answer** - "OK, tôi đồng ý với phần này"

```
v=0
o=- 461664251657location.search 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
m=audio 9 UDP/TLS/RTP/SAVPF 111
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=mid:0
a=sendrecv
a=rtpmap:111 opus/48000/2
m=video 9 UDP/TLS/RTP/SAVPF 96
c=IN IP4 0.0.0.0
a=rtcp:9 IN IP4 0.0.0.0
a=mid:1
a=sendrecv
a=rtpmap:96 VP8/90000
```

### Offer/Answer Flow trong code

```typescript
// PEER A (Offerer)
const offer = await peerConnection.createOffer();
await peerConnection.setLocalDescription(offer);
// Gửi offer qua signaling server

// PEER B (Answerer)
await peerConnection.setRemoteDescription(receivedOffer);
const answer = await peerConnection.createAnswer();
await peerConnection.setLocalDescription(answer);
// Gửi answer qua signaling server

// PEER A nhận answer
await peerConnection.setRemoteDescription(receivedAnswer);
```

---

## ICE, STUN, TURN - Vượt qua NAT

### Vấn đề NAT

Hầu hết devices đều nằm sau NAT (router). Địa chỉ IP private (192.168.x.x) không thể truy cập từ internet.

```
┌─────────────────────────────────────────────┐
│                 INTERNET                    │
│                                             │
│  ┌─────────────┐       ┌─────────────────┐  │
│  │ STUN Server │       │   TURN Server   │  │
│  │ (free)      │       │   (relay)       │  │
│  └──────┬──────┘       └────────┬────────┘  │
└─────────┼───────────────────────┼───────────┘
          │                       │
    ┌─────┴─────┐           ┌─────┴─────┐
    │   NAT A   │           │   NAT B   │
    │ (Router)  │           │ (Router)  │
    └─────┬─────┘           └─────┬─────┘
          │                       │
    ┌─────┴─────┐           ┌─────┴─────┐
    │  Peer A   │           │  Peer B   │
    │ 192.168.1.5│          │ 192.168.0.10│
    └───────────┘           └───────────┘
```

### STUN (Session Traversal Utilities for NAT)

**Mục đích**: Cho peer biết địa chỉ public IP của mình.

```typescript
// Peer hỏi STUN server: "IP public của tôi là gì?"
// STUN trả lời: "203.0.113.5:54321"
// Peer gửi địa chỉ này cho peer khác qua signaling

const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }, // Google free STUN
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};
```

**Giới hạn**: Không hoạt động với symmetric NAT (common trong corporate networks).

### TURN (Traversal Using Relays around NAT)

**Mục đích**: Relay media khi P2P không thể thiết lập.

```
Peer A ───► TURN Server ───► Peer B
        (media relayed)
```

```typescript
const config = {
  iceServers: [
    // STUN first (free, P2P)
    { urls: 'stun:stun.l.google.com:19302' },
    // TURN fallback (costs bandwidth, but always works)
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'secret',
    },
    {
      urls: 'turns:turn.example.com:443', // TURN over TLS
      username: 'user',
      credential: 'secret',
    },
  ],
};
```

### ICE (Interactive Connectivity Establishment)

ICE là framework kết hợp STUN + TURN để tìm đường kết nối tốt nhất.

**ICE Candidates** là các địa chỉ tiềm năng:

```typescript
peerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    // Gửi candidate cho peer khác
    signalingChannel.send({
      type: 'ice-candidate',
      candidate: event.candidate,
    });
  }
};

// Nhận candidate từ peer khác
peerConnection.addIceCandidate(receivedCandidate);
```

**Candidate Types**:

| Type  | Description                   | Priority | Latency |
| ----- | ----------------------------- | -------- | ------- |
| host  | Local IP (same network)       | Highest  | Lowest  |
| srflx | STUN reflexive (public IP)    | Medium   | Low     |
| relay | TURN relay                    | Lowest   | Highest |
| prflx | Peer reflexive (learned P2P)  | Medium   | Low     |

```
Candidate example:
candidate:842163049 1 udp 1677729535 203.0.113.5 54321 typ srflx
         │          │ │   │           │           │     │
         │          │ │   │           │           │     └─ type
         │          │ │   │           │           └─ port
         │          │ │   │           └─ IP address
         │          │ │   └─ priority
         │          │ └─ protocol (udp/tcp)
         │          └─ component (1=RTP, 2=RTCP)
         └─ foundation (unique identifier)
```

### ICE Connection States

```typescript
peerConnection.oniceconnectionstatechange = () => {
  switch (peerConnection.iceConnectionState) {
    case 'checking':
      // Đang kiểm tra candidates
      break;
    case 'connected':
      // Ít nhất 1 pair hoạt động
      break;
    case 'completed':
      // ICE hoàn tất, tìm được best pair
      break;
    case 'failed':
      // Không tìm được kết nối - cần TURN?
      break;
    case 'disconnected':
      // Tạm mất kết nối - đang retry
      break;
  }
};
```

---

## Media Tracks và Streams

### Track Types trong Proctoring

```typescript
enum MediaTrackType {
  WEBCAM = 'webcam',       // Video từ camera
  SCREEN = 'screen',       // Screen share
  AUDIO = 'audio',         // Microphone
}
```

### Constraints chi tiết

```typescript
// Video constraints cho proctoring
const videoConstraints: MediaTrackConstraints = {
  // Resolution
  width: { min: 640, ideal: 1280, max: 1920 },
  height: { min: 480, ideal: 720, max: 1080 },

  // Frame rate (higher = smoother but more bandwidth)
  frameRate: { ideal: 30, max: 30 },

  // Which camera (nếu có nhiều)
  facingMode: 'user', // 'user' = front, 'environment' = back

  // Chọn device cụ thể
  deviceId: { exact: 'abc123' },
};

// Audio constraints cho proctoring
const audioConstraints: MediaTrackConstraints = {
  // Xử lý âm thanh
  echoCancellation: true,   // Khử echo
  noiseSuppression: true,   // Giảm noise
  autoGainControl: true,    // Tự động điều chỉnh volume

  // Chất lượng
  sampleRate: 48000,
  channelCount: 1,          // Mono đủ cho voice
};

// Screen share constraints
const screenConstraints: DisplayMediaStreamOptions = {
  video: {
    cursor: 'always',           // Luôn hiện cursor
    displaySurface: 'monitor',  // Toàn màn hình
    logicalSurface: true,
    // Có thể giới hạn resolution
    width: { max: 1920 },
    height: { max: 1080 },
    frameRate: { max: 15 },     // Lower FPS cho screen OK
  },
  audio: false, // Thường không cần system audio
};
```

### Track Control

```typescript
// Mute/unmute track (vẫn gửi packets, chỉ silent/black)
track.enabled = false; // Muted
track.enabled = true; // Unmuted

// Stop track hoàn toàn (release camera/mic)
track.stop();

// Thay track mà không cần renegotiate
const sender = peerConnection.getSenders().find(
  (s) => s.track?.kind === 'video'
);
await sender?.replaceTrack(newVideoTrack);
```

---

## Codecs và Media Negotiation

### Video Codecs phổ biến

| Codec | Browser Support | CPU Usage | Quality   | Notes                    |
| ----- | --------------- | --------- | --------- | ------------------------ |
| VP8   | Universal       | Medium    | Good      | Default choice           |
| VP9   | Most browsers   | High      | Better    | Good for screenshare     |
| H.264 | Universal       | Low*      | Good      | Hardware acceleration    |
| AV1   | New browsers    | Very High | Best      | Future standard          |

*H.264 thường có hardware encoder

### Audio Codecs

| Codec | Browser Support | Bitrate   | Notes                    |
| ----- | --------------- | --------- | ------------------------ |
| Opus  | Universal       | 6-510kbps | Adaptive, best choice    |
| G.711 | Universal       | 64kbps    | Legacy, uncompressed     |

### Codec Negotiation trong SDP

```typescript
// Ưu tiên codec cụ thể
const offer = await peerConnection.createOffer();
let sdp = offer.sdp;

// Di chuyển VP9 lên đầu danh sách (preferred)
// SDP manipulation - advanced topic

await peerConnection.setLocalDescription(offer);
```

### Simulcast và SVC

**Simulcast**: Gửi nhiều quality layers riêng biệt

```
┌──────────────┐
│   Encoder    │ ───► High (1080p)
│              │ ───► Medium (720p)
│              │ ───► Low (360p)
└──────────────┘
```

**SVC (Scalable Video Coding)**: Một stream với embedded layers

```
┌──────────────────────────────────────┐
│ Base Layer │ + Enhancement 1 │ + E2  │
│   (360p)   │    (720p)       │(1080p)│
└──────────────────────────────────────┘
```

---

## Tổng kết Flow WebRTC P2P

```
┌────────────────────────────────────────────────────────────────┐
│                    WEBRTC CONNECTION FLOW                      │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  1. GET USER MEDIA                                             │
│     getUserMedia() → MediaStream                               │
│                                                                │
│  2. CREATE PEER CONNECTION                                     │
│     new RTCPeerConnection(iceServers)                          │
│                                                                │
│  3. ADD TRACKS                                                 │
│     peerConnection.addTrack(track, stream)                     │
│                                                                │
│  4. CREATE & EXCHANGE OFFER/ANSWER (via Signaling)             │
│     createOffer() → setLocalDescription() → send               │
│     receive → setRemoteDescription() → createAnswer()          │
│                                                                │
│  5. EXCHANGE ICE CANDIDATES (via Signaling)                    │
│     onicecandidate → send                                      │
│     receive → addIceCandidate()                                │
│                                                                │
│  6. CONNECTION ESTABLISHED                                     │
│     ontrack → receive remote media                             │
│     connectionState === 'connected'                            │
│                                                                │
│  7. MEDIA FLOWS P2P                                            │
│     SRTP encrypted audio/video direct between peers           │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Tài liệu tham khảo

- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
- [WebRTC for the Curious](https://webrtcforthecurious.com/)
- [WebRTC.org](https://webrtc.org/)
- [High Performance Browser Networking - WebRTC](https://hpbn.co/webrtc/)
