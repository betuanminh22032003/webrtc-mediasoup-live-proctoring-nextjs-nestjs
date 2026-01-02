/**
 * WebSocket Signaling Hook
 *
 * WHY a custom hook?
 * - Encapsulates WebSocket lifecycle
 * - Integrates with Zustand store
 * - Provides type-safe message handling
 *
 * This hook manages:
 * - WebSocket connection lifecycle
 * - Message serialization/deserialization
 * - Reconnection logic
 * - Heartbeat (ping/pong)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SignalMessageType, ConnectionState } from '@proctoring/shared';
import { ReconnectionManager } from '@proctoring/webrtc-utils';
import { useWebRTCStore } from '@/store/webrtc.store';

// ============================================================================
// Types
// ============================================================================

interface SignalingMessage {
  type: string;
  payload?: unknown;
  timestamp: number;
  correlationId?: string;
}

interface UseSignalingOptions {
  url: string;
  autoConnect?: boolean;
  onMessage?: (message: SignalingMessage) => void;
}

interface UseSignalingReturn {
  isConnected: boolean;
  connectionState: ConnectionState;
  connect: () => void;
  disconnect: () => void;
  send: (type: SignalMessageType, payload?: unknown) => void;
  lastError: string | null;
}

// ============================================================================
// Constants
// ============================================================================

const PING_INTERVAL_MS = 30000;
const PONG_TIMEOUT_MS = 10000;

// ============================================================================
// Hook
// ============================================================================

export function useSignaling({
  url,
  autoConnect = true,
  onMessage,
}: UseSignalingOptions): UseSignalingReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectionRef = useRef<ReconnectionManager | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>(
    ConnectionState.DISCONNECTED
  );
  const [lastError, setLastError] = useState<string | null>(null);

  const { setSignalingState } = useWebRTCStore();

  /**
   * Clear ping/pong timers
   */
  const clearTimers = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  /**
   * Start heartbeat
   */
  const startHeartbeat = useCallback(() => {
    clearTimers();

    pingIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: SignalMessageType.PING,
            timestamp: Date.now(),
          })
        );

        // Start pong timeout
        pongTimeoutRef.current = setTimeout(() => {
          console.warn('Pong timeout - connection may be dead');
          wsRef.current?.close();
        }, PONG_TIMEOUT_MS);
      }
    }, PING_INTERVAL_MS);
  }, [clearTimers]);

  /**
   * Handle incoming message
   */
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message = JSON.parse(event.data as string) as SignalingMessage;

        // Handle pong internally
        if (message.type === SignalMessageType.PONG) {
          if (pongTimeoutRef.current) {
            clearTimeout(pongTimeoutRef.current);
            pongTimeoutRef.current = null;
          }
          return;
        }

        // Forward to handler
        onMessage?.(message);
      } catch (error) {
        console.error('Failed to parse signaling message:', error);
      }
    },
    [onMessage]
  );

  /**
   * Connect to WebSocket server
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    setConnectionState(ConnectionState.CONNECTING);
    setSignalingState(ConnectionState.CONNECTING);
    setLastError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        setConnectionState(ConnectionState.CONNECTED);
        setSignalingState(ConnectionState.CONNECTED);
        reconnectionRef.current?.success();
        startHeartbeat();
      };

      ws.onmessage = handleMessage;

      ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setConnectionState(ConnectionState.DISCONNECTED);
        setSignalingState(ConnectionState.DISCONNECTED);
        clearTimers();

        // Attempt reconnection if not intentional close
        if (event.code !== 1000) {
          reconnectionRef.current?.start('Connection closed unexpectedly');
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setLastError('WebSocket connection failed');
        setConnectionState(ConnectionState.FAILED);
        setSignalingState(ConnectionState.FAILED);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setLastError('Failed to create WebSocket connection');
      setConnectionState(ConnectionState.FAILED);
      setSignalingState(ConnectionState.FAILED);
    }
  }, [url, handleMessage, startHeartbeat, clearTimers, setSignalingState]);

  /**
   * Disconnect from WebSocket server
   */
  const disconnect = useCallback(() => {
    clearTimers();
    reconnectionRef.current?.stop();

    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }

    setConnectionState(ConnectionState.DISCONNECTED);
    setSignalingState(ConnectionState.DISCONNECTED);
  }, [clearTimers, setSignalingState]);

  /**
   * Send message through WebSocket
   */
  const send = useCallback(
    (type: SignalMessageType, payload?: unknown) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.warn('Cannot send message: WebSocket not open');
        return;
      }

      const message: SignalingMessage = {
        type,
        payload,
        timestamp: Date.now(),
      };

      wsRef.current.send(JSON.stringify(message));
    },
    []
  );

  // Setup reconnection manager
  useEffect(() => {
    reconnectionRef.current = new ReconnectionManager();
    reconnectionRef.current.setReconnectCallback(async () => {
      connect();
      // Wait a bit to see if connection succeeds
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return wsRef.current?.readyState === WebSocket.OPEN;
    });

    reconnectionRef.current.onStateChange((status) => {
      if (status.state === 'waiting' || status.state === 'attempting') {
        setConnectionState(ConnectionState.RECONNECTING);
        setSignalingState(ConnectionState.RECONNECTING);
      }
    });

    return () => {
      reconnectionRef.current?.stop();
    };
  }, [connect, setSignalingState]);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    isConnected: connectionState === ConnectionState.CONNECTED,
    connectionState,
    connect,
    disconnect,
    send,
    lastError,
  };
}
