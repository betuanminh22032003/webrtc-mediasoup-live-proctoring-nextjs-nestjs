/**
 * Mediasoup Client Hook
 *
 * WHY this hook?
 * - Encapsulates mediasoup-client Device management
 * - Handles transport creation, produce, and consume
 * - Integrates with signaling for server communication
 *
 * This hook manages:
 * - mediasoup Device lifecycle
 * - Send/Receive transport creation
 * - Producer management for sending media
 * - Consumer management for receiving media
 * - Remote stream collection and updates
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as mediasoupTypes from 'mediasoup-client';
import { SignalMessageType } from '@proctoring/shared';
import { useWebRTCStore } from '@/store/webrtc.store';

// Type aliases
type Device = mediasoupTypes.types.Device;
type Transport = mediasoupTypes.types.Transport;
type Producer = mediasoupTypes.types.Producer;
type Consumer = mediasoupTypes.types.Consumer;

// ============================================================================
// Types
// ============================================================================

interface SignalingMessage {
  type: string;
  payload?: unknown;
  timestamp: number;
}

interface ProducerInfo {
  producerId: string;
  producerPeerId: string;
  kind: 'audio' | 'video';
  appData?: Record<string, unknown>;
}

interface RemoteStream {
  peerId: string;
  displayName?: string;
  webcamStream?: MediaStream;
  screenStream?: MediaStream;
  audioStream?: MediaStream;
}

interface UseMediasoupClientOptions {
  url: string;
  roomId: string;
  userId: string;
  displayName?: string;
  role: 'candidate' | 'proctor';
  autoConnect?: boolean;
}

interface UseMediasoupClientReturn {
  isConnected: boolean;
  isDeviceLoaded: boolean;
  remoteStreams: Map<string, RemoteStream>;
  connect: () => void;
  disconnect: () => void;
  /** For candidates: produce webcam stream */
  produceWebcam: (stream: MediaStream) => Promise<string | null>;
  /** For candidates: produce screen stream */
  produceScreen: (stream: MediaStream) => Promise<string | null>;
  /** For proctors: consume a specific producer */
  consumeProducer: (producerId: string, producerPeerId: string) => Promise<void>;
  lastError: string | null;
}

// ============================================================================
// Hook
// ============================================================================

export function useMediasoupClient({
  url,
  roomId,
  userId,
  displayName,
  role,
  autoConnect = false,
}: UseMediasoupClientOptions): UseMediasoupClientReturn {
  // WebSocket ref
  const wsRef = useRef<WebSocket | null>(null);

  // mediasoup refs
  const deviceRef = useRef<Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producersRef = useRef<Map<string, Producer>>(new Map());
  const consumersRef = useRef<Map<string, Consumer>>(new Map());

  // Pending requests for async signaling
  const pendingRequestsRef = useRef<Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }>>(new Map());

  // State
  const [isConnected, setIsConnected] = useState(false);
  const [isDeviceLoaded, setIsDeviceLoaded] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, RemoteStream>>(new Map());
  const [lastError, setLastError] = useState<string | null>(null);

  // Store for RTP capabilities caching
  const rtpCapabilitiesRef = useRef<unknown>(null);

  // Store actions
  const { addRemoteStream, removeRemoteStream } = useWebRTCStore();

  // Note: sendMessage is defined but currently unused - kept for future use
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sendMessage = useCallback((type: string, payload?: unknown): Promise<unknown> => {
    return new Promise((resolve, reject) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const correlationId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Store pending request
      pendingRequestsRef.current.set(correlationId, { resolve, reject });

      // Send message
      wsRef.current.send(JSON.stringify({
        type,
        payload,
        timestamp: Date.now(),
        correlationId,
      }));

      // Timeout after 10 seconds
      setTimeout(() => {
        if (pendingRequestsRef.current.has(correlationId)) {
          pendingRequestsRef.current.delete(correlationId);
          reject(new Error(`Request timeout: ${type}`));
        }
      }, 10000);
    });
  }, []);

  /**
   * Send message without waiting for response (fire and forget)
   */
  const sendMessageNoWait = useCallback((type: string, payload?: unknown): void => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket not connected, cannot send:', type);
      return;
    }

    const message = {
      type,
      payload,
      timestamp: Date.now(),
    };

    console.log('[WebSocket] Sending message:', type, payload);
    wsRef.current.send(JSON.stringify(message));
  }, []);

  /**
   * Load mediasoup Device with router RTP capabilities
   */
  const loadDevice = useCallback(async (rtpCapabilities: unknown) => {
    try {
      // Dynamic import of mediasoup-client (browser only)
      const { Device } = await import('mediasoup-client');

      const device = new Device();
      await device.load({ routerRtpCapabilities: rtpCapabilities as Parameters<Device['load']>[0]['routerRtpCapabilities'] });

      deviceRef.current = device;
      rtpCapabilitiesRef.current = device.rtpCapabilities;
      setIsDeviceLoaded(true);

      console.log('mediasoup Device loaded successfully');
      return device;
    } catch (error) {
      console.error('Failed to load mediasoup Device:', error);
      setLastError('Failed to load media device');
      throw error;
    }
  }, []);

  /**
   * Create WebRTC transport (send or receive)
   */
  const createTransport = useCallback(async (direction: 'send' | 'recv'): Promise<Transport | null> => {
    if (!deviceRef.current) {
      console.error('Device not loaded');
      return null;
    }

    try {
      // Request transport creation from server
      sendMessageNoWait(SignalMessageType.CREATE_TRANSPORT, { direction });

      // Wait for response
      const response = await new Promise<{
        id: string;
        iceParameters: unknown;
        iceCandidates: unknown;
        dtlsParameters: unknown;
      }>((resolve) => {
        const handler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === SignalMessageType.TRANSPORT_CREATED && data.payload?.direction === direction) {
              wsRef.current?.removeEventListener('message', handler);
              resolve(data.payload);
            }
          } catch {
            // Ignore parse errors
          }
        };
        wsRef.current?.addEventListener('message', handler);
      });

      const transportParams = {
        id: response.id,
        iceParameters: response.iceParameters as Parameters<Device['createSendTransport']>[0]['iceParameters'],
        iceCandidates: response.iceCandidates as Parameters<Device['createSendTransport']>[0]['iceCandidates'],
        dtlsParameters: response.dtlsParameters as Parameters<Device['createSendTransport']>[0]['dtlsParameters'],
      };

      // Create transport
      const transport = direction === 'send'
        ? deviceRef.current.createSendTransport(transportParams)
        : deviceRef.current.createRecvTransport(transportParams);

      // Handle transport connect event
      transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
        try {
          sendMessageNoWait(SignalMessageType.CONNECT_TRANSPORT, {
            transportId: transport.id,
            dtlsParameters,
          });

          // Wait for connected response
          await new Promise<void>((resolve) => {
            const handler = (event: MessageEvent) => {
              try {
                const data = JSON.parse(event.data);
                if (data.type === SignalMessageType.TRANSPORT_CONNECTED && data.payload?.transportId === transport.id) {
                  wsRef.current?.removeEventListener('message', handler);
                  resolve();
                }
              } catch {
                // Ignore
              }
            };
            wsRef.current?.addEventListener('message', handler);
          });

          callback();
        } catch (error) {
          errback(error as Error);
        }
      });

      // Handle produce event (only for send transport)
      if (direction === 'send') {
        transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
          try {
            sendMessageNoWait(SignalMessageType.PRODUCE, {
              transportId: transport.id,
              kind,
              rtpParameters,
              appData,
            });

            // Wait for produced response
            const producerId = await new Promise<string>((resolve) => {
              const handler = (event: MessageEvent) => {
                try {
                  const data = JSON.parse(event.data);
                  if (data.type === SignalMessageType.PRODUCED) {
                    wsRef.current?.removeEventListener('message', handler);
                    resolve(data.payload.producerId);
                  }
                } catch {
                  // Ignore
                }
              };
              wsRef.current?.addEventListener('message', handler);
            });

            callback({ id: producerId });
          } catch (error) {
            errback(error as Error);
          }
        });
      }

      if (direction === 'send') {
        sendTransportRef.current = transport;
      } else {
        recvTransportRef.current = transport;
      }

      console.log(`${direction} transport created:`, transport.id);
      return transport;
    } catch (error) {
      console.error(`Failed to create ${direction} transport:`, error);
      setLastError(`Failed to create ${direction} transport`);
      return null;
    }
  }, [sendMessageNoWait]);

  /**
   * Produce webcam stream
   */
  const produceWebcam = useCallback(async (stream: MediaStream): Promise<string | null> => {
    if (!sendTransportRef.current) {
      console.log('Creating send transport for webcam...');
      await createTransport('send');
    }

    if (!sendTransportRef.current) {
      console.error('No send transport available');
      return null;
    }

    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        console.error('No video track in stream');
        return null;
      }

      const producer = await sendTransportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 500000, scaleResolutionDownBy: 2 },
          { maxBitrate: 1000000, scaleResolutionDownBy: 1 },
        ],
        appData: { mediaType: 'webcam', peerId: userId },
      });

      producersRef.current.set(producer.id, producer);
      console.log('Webcam producer created:', producer.id);
      return producer.id;
    } catch (error) {
      console.error('Failed to produce webcam:', error);
      setLastError('Failed to share webcam');
      return null;
    }
  }, [createTransport, userId]);

  /**
   * Produce screen stream
   */
  const produceScreen = useCallback(async (stream: MediaStream): Promise<string | null> => {
    if (!sendTransportRef.current) {
      console.log('Creating send transport for screen...');
      await createTransport('send');
    }

    if (!sendTransportRef.current) {
      console.error('No send transport available');
      return null;
    }

    try {
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        console.error('No video track in screen stream');
        return null;
      }

      const producer = await sendTransportRef.current.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 1500000 }, // Higher bitrate for screen sharing
        ],
        appData: { mediaType: 'screen', peerId: userId },
      });

      producersRef.current.set(producer.id, producer);
      console.log('Screen producer created:', producer.id);
      return producer.id;
    } catch (error) {
      console.error('Failed to produce screen:', error);
      setLastError('Failed to share screen');
      return null;
    }
  }, [createTransport, userId]);

  /**
   * Consume a producer (receive media from another peer)
   */
  const consumeProducer = useCallback(async (producerId: string, producerPeerId: string): Promise<void> => {
    if (!recvTransportRef.current) {
      console.log('Creating recv transport for consuming...');
      await createTransport('recv');
    }

    if (!recvTransportRef.current || !deviceRef.current) {
      console.error('No recv transport or device available');
      return;
    }

    try {
      // Request consume from server
      sendMessageNoWait(SignalMessageType.CONSUME, {
        producerId,
        rtpCapabilities: deviceRef.current.rtpCapabilities,
      });

      // Wait for consumer created response
      const consumerParams = await new Promise<{
        id: string;
        producerId: string;
        kind: 'audio' | 'video';
        rtpParameters: unknown;
        appData?: Record<string, unknown>;
      }>((resolve, reject) => {
        const timeout = setTimeout(() => {
          wsRef.current?.removeEventListener('message', handler);
          reject(new Error('Consume request timeout'));
        }, 10000);

        const handler = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === SignalMessageType.CONSUMER_CREATED && data.payload?.producerId === producerId) {
              clearTimeout(timeout);
              wsRef.current?.removeEventListener('message', handler);
              resolve(data.payload);
            }
          } catch {
            // Ignore
          }
        };
        wsRef.current?.addEventListener('message', handler);
      });

      // Create consumer
      const consumer = await recvTransportRef.current.consume({
        id: consumerParams.id,
        producerId: consumerParams.producerId,
        kind: consumerParams.kind,
        rtpParameters: consumerParams.rtpParameters as Parameters<Transport['consume']>[0]['rtpParameters'],
      });

      consumersRef.current.set(consumer.id, consumer);

      // Get the media type from appData
      const mediaType = consumerParams.appData?.mediaType as string | undefined;

      // Create MediaStream from consumer track
      const stream = new MediaStream([consumer.track]);

      // Update remote streams
      setRemoteStreams((prev) => {
        const newMap = new Map(prev);
        const existing = newMap.get(producerPeerId) || { peerId: producerPeerId };

        if (consumer.kind === 'video') {
          if (mediaType === 'screen') {
            existing.screenStream = stream;
          } else {
            existing.webcamStream = stream;
          }
        } else if (consumer.kind === 'audio') {
          existing.audioStream = stream;
        }

        newMap.set(producerPeerId, existing);
        return newMap;
      });

      // Also update store for global access
      addRemoteStream(producerPeerId, stream);

      // Resume consumer
      sendMessageNoWait(SignalMessageType.CONSUMER_RESUME, {
        consumerId: consumer.id,
      });

      console.log(`Consumer created for producer ${producerId} from peer ${producerPeerId}:`, consumer.id);
    } catch (error) {
      console.error('Failed to consume producer:', error);
      setLastError('Failed to receive remote media');
    }
  }, [createTransport, sendMessageNoWait, addRemoteStream]);

  /**
   * Handle incoming signaling messages
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      if (!event.data || typeof event.data !== 'string') return;

      const message: SignalingMessage = JSON.parse(event.data);
      if (!message || !message.type) return;

      console.log('[WebSocket] Received message:', message.type, message);

      switch (message.type) {
        case SignalMessageType.RTP_CAPABILITIES: {
          console.log('[WebSocket] Received RTP_CAPABILITIES, loading device...', message.payload);
          const { rtpCapabilities } = message.payload as { rtpCapabilities: unknown };
          
          if (!rtpCapabilities) {
            console.error('[WebSocket] RTP capabilities is undefined!');
            return;
          }
          
          loadDevice(rtpCapabilities).then(() => {
            console.log('[WebSocket] Device loaded successfully!');
            // After device loaded, request producers list (for proctors)
            if (role === 'proctor') {
              sendMessageNoWait(SignalMessageType.GET_PRODUCERS, {});
            }
          }).catch((error) => {
            console.error('[WebSocket] Failed to load device:', error);
          });
          break;
        }

        case SignalMessageType.PRODUCERS_LIST: {
          // Handle existing producers in room
          const { producers } = message.payload as { producers: ProducerInfo[] };
          console.log('Got producers list:', producers);

          // Consume each producer
          producers.forEach((producer) => {
            consumeProducer(producer.producerId, producer.producerPeerId);
          });
          break;
        }

        case SignalMessageType.NEW_PRODUCER: {
          // New producer available - consume it
          const { producerId, producerPeerId, kind, appData } = message.payload as ProducerInfo;
          console.log('New producer available:', { producerId, producerPeerId, kind, appData });

          // Auto-consume for proctors
          if (role === 'proctor') {
            consumeProducer(producerId, producerPeerId);
          }
          break;
        }

        case SignalMessageType.PRODUCER_CLOSED: {
          const { producerId, producerPeerId } = message.payload as { producerId: string; producerPeerId: string };
          console.log('Producer closed:', producerId);

          // Remove the consumer and update streams
          // Find and close the consumer for this producer
          consumersRef.current.forEach((consumer, id) => {
            if (consumer.producerId === producerId) {
              consumer.close();
              consumersRef.current.delete(id);
            }
          });

          // Update remote streams
          setRemoteStreams((prev) => {
            const newMap = new Map(prev);
            const existing = newMap.get(producerPeerId);
            if (existing) {
              // We don't know which stream was closed, so check all
              newMap.delete(producerPeerId);
            }
            return newMap;
          });

          removeRemoteStream(producerPeerId);
          break;
        }

        case SignalMessageType.PARTICIPANT_LEFT: {
          const { userId: leftUserId } = message.payload as { userId: string };
          console.log('Participant left:', leftUserId);

          // Clean up their streams
          setRemoteStreams((prev) => {
            const newMap = new Map(prev);
            newMap.delete(leftUserId);
            return newMap;
          });
          removeRemoteStream(leftUserId);
          break;
        }

        case SignalMessageType.ERROR: {
          const { code, message: errorMessage } = message.payload as { code: string; message: string };
          console.error('Server error:', code, errorMessage);
          setLastError(errorMessage);
          break;
        }

        case SignalMessageType.PONG:
          // Heartbeat response - ignore
          break;

        default:
          // Other messages handled by specific listeners
          console.log('[WebSocket] Unhandled message type:', message.type);
          break;
      }
    } catch (error) {
      console.error('Failed to parse message:', error);
    }
  }, [loadDevice, sendMessageNoWait, role, consumeProducer, removeRemoteStream]);

  /**
   * Connect to signaling server
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Already connected');
      return;
    }

    setLastError(null);

    try {
      console.log('[WebSocket] Connecting to:', url);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WebSocket] Connected successfully');
        setIsConnected(true);

        // Wait a bit for server to setup listeners
        setTimeout(() => {
          // Join room
          console.log('[WebSocket] Sending ROOM_JOIN...');
          sendMessageNoWait(SignalMessageType.ROOM_JOIN, {
            roomId,
            user: {
              id: userId,
              role,
              displayName: displayName || `${role}-${userId.slice(0, 8)}`,
            },
          });

          // Request RTP capabilities after room join
          setTimeout(() => {
            console.log('[WebSocket] Requesting RTP capabilities...');
            sendMessageNoWait(SignalMessageType.GET_RTP_CAPABILITIES, {});
            
            // Retry if no response after 3 seconds
            setTimeout(() => {
              if (!deviceRef.current) {
                console.warn('[WebSocket] No device loaded yet, retrying RTP capabilities request...');
                sendMessageNoWait(SignalMessageType.GET_RTP_CAPABILITIES, {});
              }
            }, 3000);
          }, 1000); // Increased delay to 1 second after room join
        }, 100); // Small delay after connection
      };

      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setIsConnected(false);
        setIsDeviceLoaded(false);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setLastError('Connection failed');
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setLastError('Failed to connect');
    }
  }, [url, roomId, userId, displayName, role, sendMessageNoWait, handleMessage]);

  /**
   * Disconnect and cleanup
   */
  const disconnect = useCallback(() => {
    // Close all consumers
    consumersRef.current.forEach((consumer) => consumer.close());
    consumersRef.current.clear();

    // Close all producers
    producersRef.current.forEach((producer) => producer.close());
    producersRef.current.clear();

    // Close transports
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();
    sendTransportRef.current = null;
    recvTransportRef.current = null;

    // Clear device
    deviceRef.current = null;
    setIsDeviceLoaded(false);

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setIsConnected(false);
    setRemoteStreams(new Map());
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isConnected,
    isDeviceLoaded,
    remoteStreams,
    connect,
    disconnect,
    produceWebcam,
    produceScreen,
    consumeProducer,
    lastError,
  };
}
