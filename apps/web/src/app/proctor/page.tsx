'use client';

/**
 * Proctor Dashboard Page
 *
 * Multi-candidate monitoring interface:
 * - Grid view of all candidate streams
 * - Real-time violation alerts
 * - Event timeline
 * - Candidate detail view on click
 *
 * PHASE 3: Proctoring Logic Implementation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ConnectionState,
  UserRole,
  ProctoringEventType,
  ViolationSeverity,
  MediaTrackType,
} from '@proctoring/shared';
import type { ProctoringEvent, MediaState } from '@proctoring/shared';
import { useSignaling } from '@/hooks/useSignaling';
import { useMediasoupClient } from '@/hooks/useMediasoupClient';
import { useWebRTCStore } from '@/store/webrtc.store';
import { useProctoringStore } from '@/store/proctoring.store';

/**
 * Generate UUID using crypto API
 */
function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ============================================================================
// Constants
// ============================================================================

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';

// ============================================================================
// Types
// ============================================================================

interface CandidateData {
  id: string;
  displayName: string;
  connectionQuality: 'good' | 'fair' | 'poor' | 'disconnected';
  mediaState: MediaState;
  violationCount: number;
  lastSeen: number;
  webcamStream?: MediaStream;
  screenStream?: MediaStream;
}

// Shared room ID for demo - candidates and proctors should use same room
const DEMO_ROOM_ID = 'proctoring-demo-room';

// ============================================================================
// Page Component
// ============================================================================

export default function ProctorPage(): JSX.Element {
  const router = useRouter();
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null);
  const [gridSize, setGridSize] = useState<2 | 3 | 4>(3);
  const [showEventPanel, setShowEventPanel] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<ViolationSeverity | 'all'>('all');

  // Generate user ID on mount
  const [userId] = useState(() => generateId());
  // Use shared room ID so proctor and candidates are in same room
  const [roomId] = useState(() => DEMO_ROOM_ID);

  // Stores
  const { signalingState, setUser, setRoomId, participants } = useWebRTCStore();
  const {
    events,
    addEvent,
    setSession,
    activeAlerts,
    dismissAlert,
    setRole,
    alertSound,
    setAlertSound,
  } = useProctoringStore();

  // Hooks
  const { connect, disconnect } = useSignaling({
    url: WS_URL,
    autoConnect: false,
  });

  // mediasoup client for consuming candidate streams
  const {
    isConnected: mediasoupConnected,
    isDeviceLoaded,
    remoteStreams,
    connect: connectMediasoup,
    disconnect: disconnectMediasoup,
    lastError: mediasoupError,
  } = useMediasoupClient({
    url: WS_URL,
    roomId,
    userId,
    displayName: `Proctor ${userId.slice(0, 8)}`,
    role: 'proctor',
    autoConnect: false,
  });

  // Debug logging
  useEffect(() => {
    console.log('Mediasoup status:', {
      connected: mediasoupConnected,
      deviceLoaded: isDeviceLoaded,
      streamCount: remoteStreams.size,
      remoteStreamKeys: Array.from(remoteStreams.keys()),
      remoteStreamDetails: Array.from(remoteStreams.entries()).map(([k, v]) => ({
        peerId: k,
        hasWebcam: !!v.webcamStream,
        hasScreen: !!v.screenStream,
        hasAudio: !!v.audioStream,
      })),
      error: mediasoupError,
    });
  }, [mediasoupConnected, isDeviceLoaded, remoteStreams, mediasoupError]);

  // Real connected candidates from participants
  const [candidates, setCandidates] = useState<CandidateData[]>([]);

  // Update candidates when participants change
  useEffect(() => {
    const participantArray = Array.from(participants.values());
    console.log('Participants updated:', {
      count: participantArray.length,
      participantIds: participantArray.map(p => p.user.id),
      remoteStreamKeys: Array.from(remoteStreams.keys()),
    });
    
    if (participantArray.length > 0) {
      // Use real participants
      const realCandidates: CandidateData[] = participantArray
        .filter(p => p.user.role === UserRole.CANDIDATE)
        .map(p => {
          // Determine connection quality from connectionState
          const qualityFromState = (): 'good' | 'fair' | 'poor' | 'disconnected' => {
            switch (p.connectionState) {
              case ConnectionState.CONNECTED:
                return 'good';
              case ConnectionState.CONNECTING:
              case ConnectionState.RECONNECTING:
                return 'fair';
              case ConnectionState.DISCONNECTED:
                return 'disconnected';
              case ConnectionState.FAILED:
                return 'poor';
              default:
                return 'good';
            }
          };

          // Determine media state from activeTracks
          const hasWebcam = p.activeTracks.includes(MediaTrackType.WEBCAM);
          const hasScreen = p.activeTracks.includes(MediaTrackType.SCREEN);
          const hasAudio = p.activeTracks.includes(MediaTrackType.AUDIO);

          // Get streams from remoteStreams map
          const remoteStream = remoteStreams.get(p.user.id);
          console.log('Candidate stream lookup:', {
            participantId: p.user.id,
            foundStream: !!remoteStream,
            hasWebcam: !!remoteStream?.webcamStream,
            hasScreen: !!remoteStream?.screenStream,
          });

          return {
            id: p.user.id,
            displayName: p.user.displayName || `Candidate ${p.user.id.slice(0, 8)}`,
            connectionQuality: qualityFromState(),
            mediaState: {
              webcamEnabled: hasWebcam || !!remoteStream?.webcamStream,
              screenShareEnabled: hasScreen || !!remoteStream?.screenStream,
              audioEnabled: hasAudio,
            },
            violationCount: 0,
            lastSeen: p.joinedAt,
            webcamStream: remoteStream?.webcamStream,
            screenStream: remoteStream?.screenStream,
          };
        });
      setCandidates(realCandidates);
    }
  }, [participants, remoteStreams]);

  // Get connected clients count
  const connectedClientsCount = useMemo(() => {
    return Array.from(participants.values()).filter(p => p.user.role === UserRole.CANDIDATE).length;
  }, [participants]);

  /**
   * Initialize user and session
   */
  useEffect(() => {
    setUser({
      id: userId,
      role: UserRole.PROCTOR,
      displayName: `Proctor ${userId.slice(0, 8)}`,
    });
    setRoomId(roomId);
    setRole(UserRole.PROCTOR);

    setSession({
      roomId,
      examName: 'Proctored Examination',
      startedAt: Date.now(),
      endsAt: Date.now() + 60 * 60 * 1000, // 1 hour
      duration: 60,
      status: 'active',
    });

    // Connect to signaling server
    connect();
    
    // Connect to mediasoup for consuming streams
    connectMediasoup();


    return () => {
      disconnect();
      disconnectMediasoup();
    };
  }, [userId, roomId, setUser, setRoomId, setSession, setRole, connect, disconnect, connectMediasoup, disconnectMediasoup]);


  /**
   * Filter events by severity
   */
  const filteredEvents = useMemo(() => {
    if (filterSeverity === 'all') return events;
    return events.filter((e) => e.severity === filterSeverity);
  }, [events, filterSeverity]);

  /**
   * Get candidate statistics
   */
  const stats = useMemo(() => {
    const connected = candidates.filter((c) => c.connectionQuality !== 'disconnected').length;
    const totalViolations = candidates.reduce((sum, c) => sum + c.violationCount, 0);
    const webcamIssues = candidates.filter((c) => !c.mediaState.webcamEnabled).length;
    const realConnected = connectedClientsCount > 0 ? connectedClientsCount : connected;
    return { total: candidates.length, connected: realConnected, totalViolations, webcamIssues };
  }, [candidates, connectedClientsCount]);

  /**
   * Handle candidate selection
   */
  const handleSelectCandidate = useCallback((candidateId: string) => {
    setSelectedCandidate((prev) => (prev === candidateId ? null : candidateId));
  }, []);

  /**
   * Handle flag candidate (mark for review)
   */
  const handleFlagCandidate = useCallback(
    (candidateId: string) => {
      addEvent({
        type: ProctoringEventType.VIOLATION_DETECTED,
        userId: candidateId,
        roomId,
        severity: ViolationSeverity.WARNING,
        description: 'Flagged by proctor for review',
        metadata: { flaggedBy: userId },
      });
    },
    [addEvent, roomId, userId]
  );

  return (
    <main className="min-h-screen flex flex-col bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold">👁️ Proctor Dashboard</h1>
            <ConnectionStatusBadge state={signalingState} />
            <div className="px-3 py-1 bg-blue-900 rounded text-sm">
              🔗 {connectedClientsCount} client{connectedClientsCount !== 1 ? 's' : ''} connected
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Stats */}
            <div className="flex gap-4 text-sm">
              <StatBadge label="Candidates" value={`${stats.connected}/${stats.total}`} />
              <StatBadge label="Violations" value={stats.totalViolations} warning={stats.totalViolations > 0} />
              <StatBadge label="Webcam Issues" value={stats.webcamIssues} warning={stats.webcamIssues > 0} />
            </div>
            {/* Controls */}
            <div className="flex items-center gap-2 border-l border-gray-700 pl-4">
              <GridSizeSelector size={gridSize} onChange={setGridSize} />
              <button
                onClick={() => setShowEventPanel(!showEventPanel)}
                className={`px-3 py-1.5 rounded text-sm ${
                  showEventPanel ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                📋 Events
              </button>
              <button
                onClick={() => setAlertSound(!alertSound)}
                className={`px-3 py-1.5 rounded text-sm ${
                  alertSound ? 'bg-blue-600' : 'bg-gray-700'
                }`}
              >
                {alertSound ? '🔔' : '🔕'}
              </button>
              <button
                onClick={() => router.push('/')}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Candidate Grid */}
        <div className="flex-1 p-4 overflow-auto">
          <CandidateGrid
            candidates={candidates}
            gridSize={gridSize}
            selectedId={selectedCandidate}
            onSelect={handleSelectCandidate}
            onFlag={handleFlagCandidate}
          />
        </div>

        {/* Event Panel */}
        {showEventPanel && (
          <div className="w-80 border-l border-gray-800 flex flex-col">
            <EventPanel
              events={filteredEvents}
              filterSeverity={filterSeverity}
              onFilterChange={setFilterSeverity}
            />
          </div>
        )}
      </div>

      {/* Selected Candidate Detail Modal */}
      {selectedCandidate && (
        <CandidateDetailModal
          candidate={candidates.find((c) => c.id === selectedCandidate)!}
          events={events.filter((e) => e.userId === selectedCandidate)}
          onClose={() => setSelectedCandidate(null)}
          onFlag={() => handleFlagCandidate(selectedCandidate)}
        />
      )}

      {/* Alert Toast */}
      <AlertContainer alerts={activeAlerts} onDismiss={dismissAlert} />
    </main>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

function ConnectionStatusBadge({ state }: { state: ConnectionState }): JSX.Element {
  const config = {
    [ConnectionState.CONNECTED]: { color: 'bg-green-500', label: 'Connected' },
    [ConnectionState.CONNECTING]: { color: 'bg-yellow-500', label: 'Connecting...' },
    [ConnectionState.DISCONNECTED]: { color: 'bg-gray-500', label: 'Disconnected' },
    [ConnectionState.RECONNECTING]: { color: 'bg-yellow-500', label: 'Reconnecting...' },
    [ConnectionState.FAILED]: { color: 'bg-red-500', label: 'Failed' },
  };

  const { color, label } = config[state];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-sm text-gray-400">{label}</span>
    </div>
  );
}

function StatBadge({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string | number;
  warning?: boolean;
}): JSX.Element {
  return (
    <div className={`px-3 py-1 rounded ${warning ? 'bg-red-900' : 'bg-gray-800'}`}>
      <span className="text-gray-400">{label}: </span>
      <span className={warning ? 'text-red-400 font-semibold' : 'text-white'}>{value}</span>
    </div>
  );
}

function GridSizeSelector({
  size,
  onChange,
}: {
  size: 2 | 3 | 4;
  onChange: (size: 2 | 3 | 4) => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 bg-gray-800 rounded p-1">
      {([2, 3, 4] as const).map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className={`w-8 h-8 rounded text-sm ${
            size === s ? 'bg-blue-600' : 'hover:bg-gray-700'
          }`}
        >
          {s}×{s}
        </button>
      ))}
    </div>
  );
}

interface CandidateGridProps {
  candidates: CandidateData[];
  gridSize: 2 | 3 | 4;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onFlag: (id: string) => void;
}

function CandidateGrid({
  candidates,
  gridSize,
  selectedId,
  onSelect,
  onFlag,
}: CandidateGridProps): JSX.Element {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-4',
  };

  return (
    <div className={`grid ${gridCols[gridSize]} gap-4`}>
      {candidates.map((candidate) => (
        <CandidateCard
          key={candidate.id}
          candidate={candidate}
          isSelected={candidate.id === selectedId}
          onClick={() => onSelect(candidate.id)}
          onFlag={() => onFlag(candidate.id)}
        />
      ))}
    </div>
  );
}

interface CandidateCardProps {
  candidate: CandidateData;
  isSelected: boolean;
  onClick: () => void;
  onFlag: () => void;
}

function CandidateCard({
  candidate,
  isSelected,
  onClick,
  onFlag,
}: CandidateCardProps): JSX.Element {
  const connectionColors = {
    good: 'border-green-500',
    fair: 'border-yellow-500',
    poor: 'border-red-500',
    disconnected: 'border-gray-600',
  };

  return (
    <div
      className={`bg-gray-900 rounded-xl overflow-hidden cursor-pointer transition-all ${
        isSelected ? 'ring-2 ring-blue-500' : ''
      } ${connectionColors[candidate.connectionQuality]} border-2`}
      onClick={onClick}
    >
      {/* Video Area */}
      <div className="aspect-video bg-gray-800 relative">
        {candidate.webcamStream ? (
          <video
            autoPlay
            playsInline
            muted
            ref={(video) => {
              if (video && video.srcObject !== candidate.webcamStream) {
                video.srcObject = candidate.webcamStream!;
              }
            }}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-6xl opacity-30">👤</div>
          </div>
        )}

        {/* Overlay indicators */}
        <div className="absolute top-2 left-2 flex gap-1">
          {!candidate.mediaState.webcamEnabled && (
            <span className="px-2 py-0.5 bg-red-600 rounded text-xs">📷 OFF</span>
          )}
          {!candidate.mediaState.screenShareEnabled && (
            <span className="px-2 py-0.5 bg-red-600 rounded text-xs">🖥️ OFF</span>
          )}
        </div>

        {/* Violation badge */}
        {candidate.violationCount > 0 && (
          <div className="absolute top-2 right-2 px-2 py-0.5 bg-red-600 rounded text-xs font-bold">
            ⚠️ {candidate.violationCount}
          </div>
        )}

        {/* Connection quality indicator */}
        <div className="absolute bottom-2 left-2">
          <ConnectionQualityIndicator quality={candidate.connectionQuality} />
        </div>
      </div>

      {/* Info Bar */}
      <div className="p-3 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">{candidate.displayName}</h3>
          <p className="text-xs text-gray-500">
            Last seen: {formatLastSeen(candidate.lastSeen)}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFlag();
          }}
          className="p-2 hover:bg-gray-700 rounded transition-colors"
          title="Flag for review"
        >
          🚩
        </button>
      </div>
    </div>
  );
}

function ConnectionQualityIndicator({
  quality,
}: {
  quality: 'good' | 'fair' | 'poor' | 'disconnected';
}): JSX.Element {
  const bars = {
    good: [true, true, true, true],
    fair: [true, true, true, false],
    poor: [true, true, false, false],
    disconnected: [false, false, false, false],
  };

  const colors = {
    good: 'bg-green-500',
    fair: 'bg-yellow-500',
    poor: 'bg-red-500',
    disconnected: 'bg-gray-600',
  };

  return (
    <div className="flex items-end gap-0.5 h-4">
      {bars[quality].map((active, i) => (
        <div
          key={i}
          className={`w-1 rounded-t ${active ? colors[quality] : 'bg-gray-600'}`}
          style={{ height: `${(i + 1) * 25}%` }}
        />
      ))}
    </div>
  );
}

interface EventPanelProps {
  events: ProctoringEvent[];
  filterSeverity: ViolationSeverity | 'all';
  onFilterChange: (severity: ViolationSeverity | 'all') => void;
}

function EventPanel({ events, filterSeverity, onFilterChange }: EventPanelProps): JSX.Element {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <h2 className="font-semibold mb-2">Event Timeline</h2>
        <select
          value={filterSeverity}
          onChange={(e) => onFilterChange(e.target.value as ViolationSeverity | 'all')}
          className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
        >
          <option value="all">All Events</option>
          <option value={ViolationSeverity.INFO}>Info Only</option>
          <option value={ViolationSeverity.WARNING}>Warnings</option>
          <option value={ViolationSeverity.CRITICAL}>Critical</option>
          <option value={ViolationSeverity.FATAL}>Fatal</option>
        </select>
      </div>

      {/* Event List */}
      <div className="flex-1 overflow-auto p-4 space-y-2">
        {events.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">No events yet</p>
        ) : (
          events.map((event) => <EventCard key={event.id} event={event} />)
        )}
      </div>
    </div>
  );
}

function EventCard({ event }: { event: ProctoringEvent }): JSX.Element {
  const severityConfig = {
    [ViolationSeverity.INFO]: { bg: 'bg-gray-800', border: 'border-gray-600', icon: 'ℹ️' },
    [ViolationSeverity.WARNING]: { bg: 'bg-yellow-900/30', border: 'border-yellow-600', icon: '⚠️' },
    [ViolationSeverity.CRITICAL]: { bg: 'bg-red-900/30', border: 'border-red-600', icon: '🚨' },
    [ViolationSeverity.FATAL]: { bg: 'bg-red-900', border: 'border-red-500', icon: '💀' },
  };

  const config = severityConfig[event.severity];
  const time = new Date(event.timestamp).toLocaleTimeString();

  return (
    <div className={`p-3 rounded-lg border-l-2 ${config.bg} ${config.border}`}>
      <div className="flex items-start gap-2">
        <span>{config.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center">
            <span className="font-medium text-sm">{formatEventType(event.type)}</span>
            <span className="text-xs text-gray-500">{time}</span>
          </div>
          {event.description && (
            <p className="text-xs text-gray-400 mt-1">{event.description}</p>
          )}
          {event.userId !== 'system' && (
            <p className="text-xs text-gray-500 mt-1">User: {event.userId.slice(0, 8)}...</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface CandidateDetailModalProps {
  candidate: CandidateData;
  events: ProctoringEvent[];
  onClose: () => void;
  onFlag: () => void;
}

function CandidateDetailModal({
  candidate,
  events,
  onClose,
  onFlag,
}: CandidateDetailModalProps): JSX.Element {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-800 flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">{candidate.displayName}</h2>
            <p className="text-sm text-gray-400">ID: {candidate.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onFlag}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm"
            >
              🚩 Flag Candidate
            </button>
            <button onClick={onClose} className="p-2 hover:bg-gray-800 rounded text-xl">
              ×
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 grid grid-cols-2 gap-4">
          {/* Webcam View */}
          <div>
            <h3 className="font-semibold mb-2">📷 Webcam Feed</h3>
            <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
              {candidate.webcamStream ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(video) => {
                    if (video && video.srcObject !== candidate.webcamStream) {
                      console.log('[Video] Setting webcam srcObject for', candidate.id);
                      video.srcObject = candidate.webcamStream!;
                    }
                  }}
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : (
                <span className="text-gray-500">
                  {candidate.mediaState.webcamEnabled ? 'Connecting...' : '📷 Webcam Disabled'}
                </span>
              )}
            </div>
          </div>

          {/* Screen Share View */}
          <div>
            <h3 className="font-semibold mb-2">🖥️ Screen Share</h3>
            <div className="aspect-video bg-gray-800 rounded-lg flex items-center justify-center">
              {candidate.screenStream ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(video) => {
                    if (video && video.srcObject !== candidate.screenStream) {
                      console.log('[Video] Setting screen srcObject for', candidate.id);
                      video.srcObject = candidate.screenStream!;
                    }
                  }}
                  className="w-full h-full object-contain rounded-lg"
                />
              ) : (
                <span className="text-gray-500">
                  {candidate.mediaState.screenShareEnabled ? 'Connecting...' : '🖥️ Screen Share Disabled'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="px-4 pb-4">
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gray-800 p-3 rounded-lg">
              <p className="text-xs text-gray-400">Connection</p>
              <p className="font-semibold capitalize">{candidate.connectionQuality}</p>
            </div>
            <div className="bg-gray-800 p-3 rounded-lg">
              <p className="text-xs text-gray-400">Violations</p>
              <p className={`font-semibold ${candidate.violationCount > 0 ? 'text-red-400' : ''}`}>
                {candidate.violationCount}
              </p>
            </div>
            <div className="bg-gray-800 p-3 rounded-lg">
              <p className="text-xs text-gray-400">Webcam</p>
              <p className={`font-semibold ${candidate.mediaState.webcamEnabled ? 'text-green-400' : 'text-red-400'}`}>
                {candidate.mediaState.webcamEnabled ? 'On' : 'Off'}
              </p>
            </div>
            <div className="bg-gray-800 p-3 rounded-lg">
              <p className="text-xs text-gray-400">Screen Share</p>
              <p className={`font-semibold ${candidate.mediaState.screenShareEnabled ? 'text-green-400' : 'text-red-400'}`}>
                {candidate.mediaState.screenShareEnabled ? 'On' : 'Off'}
              </p>
            </div>
          </div>
        </div>

        {/* Events */}
        <div className="px-4 pb-4">
          <h3 className="font-semibold mb-2">📋 Recent Events</h3>
          <div className="bg-gray-800 rounded-lg max-h-48 overflow-y-auto">
            {events.length === 0 ? (
              <p className="p-4 text-gray-500 text-sm">No events for this candidate</p>
            ) : (
              <div className="p-2 space-y-1">
                {events.slice(0, 10).map((event) => (
                  <div key={event.id} className="flex justify-between text-sm p-2 hover:bg-gray-700 rounded">
                    <span>{formatEventType(event.type)}</span>
                    <span className="text-gray-500">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface AlertContainerProps {
  alerts: Array<{
    title: string;
    message: string;
    severity: ViolationSeverity;
    dismissable: boolean;
    candidateId?: string;
  }>;
  onDismiss: (index: number) => void;
}

function AlertContainer({ alerts, onDismiss }: AlertContainerProps): JSX.Element | null {
  if (alerts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-50 space-y-2 max-w-sm">
      {alerts.map((alert, index) => (
        <div
          key={index}
          className={`p-4 rounded-lg shadow-lg border animate-pulse ${
            alert.severity === ViolationSeverity.CRITICAL ||
            alert.severity === ViolationSeverity.FATAL
              ? 'bg-red-900 border-red-700'
              : 'bg-yellow-900 border-yellow-700'
          }`}
        >
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-semibold">{alert.title}</h4>
              <p className="text-sm mt-1 opacity-80">{alert.message}</p>
              {alert.candidateId && (
                <p className="text-xs mt-1 opacity-60">
                  Candidate: {alert.candidateId.slice(0, 8)}...
                </p>
              )}
            </div>
            {alert.dismissable && (
              <button
                onClick={() => onDismiss(index)}
                className="ml-4 text-lg opacity-60 hover:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatEventType(type: ProctoringEventType): string {
  const labels: Partial<Record<ProctoringEventType, string>> = {
    [ProctoringEventType.SESSION_STARTED]: 'Session Started',
    [ProctoringEventType.SESSION_ENDED]: 'Session Ended',
    [ProctoringEventType.CONNECTION_ESTABLISHED]: 'Connected',
    [ProctoringEventType.CONNECTION_LOST]: 'Disconnected',
    [ProctoringEventType.WEBCAM_ENABLED]: 'Webcam On',
    [ProctoringEventType.WEBCAM_DISABLED]: 'Webcam Off',
    [ProctoringEventType.SCREEN_SHARE_STARTED]: 'Screen Share On',
    [ProctoringEventType.SCREEN_SHARE_STOPPED]: 'Screen Share Off',
    [ProctoringEventType.TAB_SWITCH_DETECTED]: 'Tab Switch',
    [ProctoringEventType.VIOLATION_DETECTED]: 'Violation',
    [ProctoringEventType.NO_FACE_DETECTED]: 'No Face',
    [ProctoringEventType.MULTIPLE_FACES_DETECTED]: 'Multiple Faces',
  };

  return labels[type] || type.split('.').pop()?.replace(/_/g, ' ') || type;
}

function formatLastSeen(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return new Date(timestamp).toLocaleTimeString();
}

