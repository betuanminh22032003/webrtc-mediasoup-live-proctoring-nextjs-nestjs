# WebRTC MediaSoup Live Proctoring System

[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-red.svg)](https://nestjs.com/)
[![mediasoup](https://img.shields.io/badge/mediasoup-3-orange.svg)](https://mediasoup.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A production-grade, real-time live proctoring system built with WebRTC and mediasoup SFU architecture. Designed for secure remote examination monitoring with low-latency video streaming.

## 🎯 Overview

This system enables proctors to monitor multiple exam candidates simultaneously through real-time video and audio streams. It uses a Selective Forwarding Unit (SFU) architecture for efficient media routing, supporting one-to-many streaming scenarios typical in proctoring environments.

### Key Features

- **Real-time Video Monitoring**: Sub-second latency video streaming from candidates to proctors
- **Screen Sharing**: Capture and monitor candidate screen activity
- **Multi-stream Support**: Webcam, screen share, and audio tracks per candidate
- **Scalable Architecture**: SFU-based design supporting many-to-one viewing
- **Role-based Access**: Separate interfaces for candidates and proctors
- **Connection Resilience**: Automatic reconnection with state recovery
- **Type-safe Communication**: Zod-validated WebSocket messages

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PROCTORING SYSTEM                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────┐     WebSocket      ┌─────────────────────────────┐    │
│  │             │    (Signaling)     │                             │    │
│  │  Candidate  │◄──────────────────►│      NestJS SFU Server      │    │
│  │   (Next.js) │                    │                             │    │
│  │             │    WebRTC/RTP      │  ┌───────────────────────┐  │    │
│  │  - Webcam   │◄──────────────────►│  │     mediasoup         │  │    │
│  │  - Screen   │     (Media)        │  │  - Workers            │  │    │
│  │  - Audio    │                    │  │  - Routers            │  │    │
│  └─────────────┘                    │  │  - Transports         │  │    │
│                                     │  │  - Producers/Consumers│  │    │
│  ┌─────────────┐     WebSocket      │  └───────────────────────┘  │    │
│  │             │    (Signaling)     │                             │    │
│  │   Proctor   │◄──────────────────►│      Room Management        │    │
│  │   (Next.js) │                    │                             │    │
│  │             │    WebRTC/RTP      │      Signaling Service      │    │
│  │  - Watch N  │◄──────────────────►│                             │    │
│  │   candidates│     (Media)        │                             │    │
│  └─────────────┘                    └─────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Monorepo Structure

```
webrtc-mediasoup-live-proctoring-nextjs-nestjs/
├── apps/
│   ├── web/              # Next.js frontend (Candidate & Proctor UI)
│   └── sfu/              # NestJS backend (mediasoup SFU server)
├── packages/
│   ├── shared/           # Shared types, schemas, constants
│   └── webrtc-utils/     # WebRTC utility functions
├── infra/                # Docker configurations
└── docs/                 # Documentation and ADRs
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 20.0.0
- **pnpm** >= 8.0.0
- **Docker** & Docker Compose (optional, for containerized deployment)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/webrtc-mediasoup-live-proctoring.git
cd webrtc-mediasoup-live-proctoring

# Install dependencies
pnpm install

# Build shared packages
pnpm build
```

### Development

```bash
# Start all services in development mode
pnpm dev

# Or start services individually
pnpm dev:web   # Next.js frontend on http://localhost:3000
pnpm dev:sfu   # NestJS SFU on http://localhost:3001
```

### Docker Deployment

```bash
# Start with Docker Compose
pnpm docker:up

# View logs
pnpm docker:logs

# Stop services
pnpm docker:down
```

## 📦 Project Components

### Apps

#### `@proctoring/web` - Frontend Application
- **Framework**: Next.js 14 with App Router
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Features**:
  - Candidate view with media capture
  - Proctor dashboard with multi-candidate grid
  - Real-time connection status indicators
  - Responsive design

#### `@proctoring/sfu` - SFU Server
- **Framework**: NestJS with Fastify
- **WebSocket**: ws library with NestJS gateway
- **Media Server**: mediasoup v3
- **Features**:
  - WebSocket signaling gateway
  - Room management
  - mediasoup worker/router management
  - Health monitoring

### Packages

#### `@proctoring/shared`
- TypeScript types and interfaces
- Zod validation schemas
- WebRTC constants
- Signaling message types

#### `@proctoring/webrtc-utils`
- ICE state management utilities
- Media device enumeration
- SDP manipulation helpers
- Reconnection strategies
- WebRTC statistics collection

## 🔧 Configuration

### Environment Variables

#### SFU Server (`apps/sfu/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode | `development` |
| `PORT` | HTTP server port | `3001` |
| `HOST` | Server bind address | `0.0.0.0` |
| `MEDIASOUP_LISTEN_IP` | mediasoup listen IP | `0.0.0.0` |
| `MEDIASOUP_ANNOUNCED_IP` | Public IP for WebRTC | Auto-detected |
| `MEDIASOUP_MIN_PORT` | RTP port range start | `40000` |
| `MEDIASOUP_MAX_PORT` | RTP port range end | `49999` |
| `MEDIASOUP_WORKERS` | Number of workers | CPU cores |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `CORS_ORIGIN` | Allowed CORS origins | `http://localhost:3000` |

#### Web App (`apps/web/.env.local`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_WS_URL` | WebSocket server URL | `ws://localhost:3001/ws` |
| `NEXT_PUBLIC_API_URL` | API server URL | `http://localhost:3001` |

## 📡 Signaling Protocol

### Message Types

```typescript
enum SignalMessageType {
  // Connection lifecycle
  AUTH_REQUEST = 'auth:request',
  AUTH_RESPONSE = 'auth:response',
  
  // Room management
  ROOM_JOIN = 'room:join',
  ROOM_LEAVE = 'room:leave',
  ROOM_STATE = 'room:state',
  
  // WebRTC signaling
  SDP_OFFER = 'sdp:offer',
  SDP_ANSWER = 'sdp:answer',
  ICE_CANDIDATE = 'ice:candidate',
  
  // mediasoup specific
  TRANSPORT_CREATE = 'transport:create',
  TRANSPORT_CONNECT = 'transport:connect',
  PRODUCE = 'produce',
  CONSUME = 'consume',
  
  // Health
  PING = 'ping',
  PONG = 'pong',
}
```

### Message Flow

```
Candidate                    SFU Server                    Proctor
    │                            │                            │
    │──── AUTH_REQUEST ─────────►│                            │
    │◄─── AUTH_RESPONSE ─────────│                            │
    │                            │                            │
    │──── ROOM_JOIN ────────────►│                            │
    │◄─── ROOM_STATE ────────────│────── ROOM_STATE ─────────►│
    │                            │                            │
    │──── TRANSPORT_CREATE ─────►│                            │
    │◄─── TRANSPORT_CREATED ─────│                            │
    │                            │                            │
    │──── PRODUCE (webcam) ─────►│                            │
    │◄─── PRODUCED ──────────────│                            │
    │                            │                            │
    │                            │◄──── CONSUME ──────────────│
    │                            │───── CONSUMER_CREATED ────►│
    │                            │                            │
```

## 🧪 Testing

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:cov

# Run e2e tests
pnpm test:e2e
```

## 🔒 Security Considerations

- **HTTPS/WSS**: Always use secure connections in production
- **Authentication**: JWT-based authentication for WebSocket connections
- **Authorization**: Role-based access control for room operations
- **Input Validation**: All messages validated with Zod schemas
- **Rate Limiting**: Configurable rate limits on signaling messages
- **CORS**: Strict origin validation

## 📈 Performance

### Scalability

- **Horizontal Scaling**: Multiple SFU instances with Redis for state sharing
- **mediasoup Workers**: One worker per CPU core
- **Connection Pooling**: Efficient WebSocket management
- **Lazy Consumers**: Create consumers only when proctor views candidate

### Optimization Tips

1. Use hardware acceleration for video encoding/decoding
2. Configure appropriate video quality settings
3. Implement bandwidth estimation and adaptive bitrate
4. Use regional deployments for lower latency

## 🗺️ Roadmap

- [x] Phase 1: WebRTC signaling foundation
- [x] Phase 2: mediasoup integration
- [x] Phase 3: Proctoring logic (violation detection, event timeline)
- [ ] Phase 4: Recording with FFmpeg
- [ ] Phase 5: Multi-region deployment

## 📚 Documentation

- [Architecture Decision Records (ADRs)](./docs/adr/)
- [API Documentation](./docs/api/)
- [Deployment Guide](./docs/deployment/)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [mediasoup](https://mediasoup.org/) - The amazing WebRTC SFU
- [NestJS](https://nestjs.com/) - Progressive Node.js framework
- [Next.js](https://nextjs.org/) - React framework for production
