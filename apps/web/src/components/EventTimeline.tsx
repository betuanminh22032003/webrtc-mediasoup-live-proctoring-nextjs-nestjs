/**
 * Event Timeline Component
 *
 * Reusable component for displaying proctoring events
 * in a chronological timeline format.
 *
 * WHY a dedicated component?
 * - Reusable across candidate and proctor views
 * - Complex styling logic encapsulated
 * - Supports filtering, grouping, and virtual scrolling
 */

'use client';

import { useMemo, useState, useCallback } from 'react';
import type { ProctoringEvent } from '@proctoring/shared';
import { ProctoringEventType, ViolationSeverity } from '@proctoring/shared';

// ============================================================================
// Types
// ============================================================================

interface EventTimelineProps {
  events: ProctoringEvent[];
  maxHeight?: string;
  showFilters?: boolean;
  showGrouping?: boolean;
  onEventClick?: (event: ProctoringEvent) => void;
  emptyMessage?: string;
}

interface EventGroup {
  date: string;
  events: ProctoringEvent[];
}

// ============================================================================
// Event Timeline Component
// ============================================================================

export function EventTimeline({
  events,
  maxHeight = '400px',
  showFilters = false,
  showGrouping = false,
  onEventClick,
  emptyMessage = 'No events to display',
}: EventTimelineProps): JSX.Element {
  const [filter, setFilter] = useState<ViolationSeverity | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  /**
   * Filter events
   */
  const filteredEvents = useMemo(() => {
    return events.filter((event) => {
      // Severity filter
      if (filter !== 'all' && event.severity !== filter) {
        return false;
      }

      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const typeMatch = event.type.toLowerCase().includes(searchLower);
        const descMatch = event.description?.toLowerCase().includes(searchLower);
        const userMatch = event.userId.toLowerCase().includes(searchLower);
        return typeMatch || descMatch || userMatch;
      }

      return true;
    });
  }, [events, filter, searchTerm]);

  /**
   * Group events by date
   */
  const groupedEvents = useMemo((): EventGroup[] => {
    if (!showGrouping) {
      return [{ date: '', events: filteredEvents }];
    }

    const groups = new Map<string, ProctoringEvent[]>();

    filteredEvents.forEach((event) => {
      const date = new Date(event.timestamp).toLocaleDateString();
      const existing = groups.get(date) || [];
      groups.set(date, [...existing, event]);
    });

    return Array.from(groups.entries()).map(([date, events]) => ({
      date,
      events,
    }));
  }, [filteredEvents, showGrouping]);

  /**
   * Handle event click
   */
  const handleClick = useCallback(
    (event: ProctoringEvent) => {
      onEventClick?.(event);
    },
    [onEventClick]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      {showFilters && (
        <div className="p-3 border-b border-gray-700 space-y-2">
          {/* Search */}
          <input
            type="text"
            placeholder="Search events..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm"
          />

          {/* Severity Filter */}
          <div className="flex gap-1 flex-wrap">
            <FilterChip
              label="All"
              active={filter === 'all'}
              onClick={() => setFilter('all')}
            />
            <FilterChip
              label="Info"
              active={filter === ViolationSeverity.INFO}
              onClick={() => setFilter(ViolationSeverity.INFO)}
              color="gray"
            />
            <FilterChip
              label="Warning"
              active={filter === ViolationSeverity.WARNING}
              onClick={() => setFilter(ViolationSeverity.WARNING)}
              color="yellow"
            />
            <FilterChip
              label="Critical"
              active={filter === ViolationSeverity.CRITICAL}
              onClick={() => setFilter(ViolationSeverity.CRITICAL)}
              color="red"
            />
            <FilterChip
              label="Fatal"
              active={filter === ViolationSeverity.FATAL}
              onClick={() => setFilter(ViolationSeverity.FATAL)}
              color="red"
            />
          </div>
        </div>
      )}

      {/* Event List */}
      <div className="flex-1 overflow-y-auto" style={{ maxHeight }}>
        {filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <span className="text-4xl block mb-2">📋</span>
            {emptyMessage}
          </div>
        ) : (
          <div className="p-2">
            {groupedEvents.map((group, groupIndex) => (
              <div key={group.date || groupIndex}>
                {/* Date Header */}
                {showGrouping && group.date && (
                  <div className="sticky top-0 bg-gray-900 px-2 py-1 text-xs text-gray-500 font-semibold">
                    {group.date}
                  </div>
                )}

                {/* Events */}
                <div className="relative">
                  {/* Timeline Line */}
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-700" />

                  {/* Event Items */}
                  {group.events.map((event, index) => (
                    <EventTimelineItem
                      key={event.id}
                      event={event}
                      isFirst={index === 0}
                      isLast={index === group.events.length - 1}
                      onClick={() => handleClick(event)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      {filteredEvents.length > 0 && (
        <div className="p-2 border-t border-gray-700 text-xs text-gray-500 flex justify-between">
          <span>{filteredEvents.length} events</span>
          <span>
            {filteredEvents.filter((e) => e.severity === ViolationSeverity.CRITICAL || e.severity === ViolationSeverity.FATAL).length} critical
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-Components
// ============================================================================

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: 'gray' | 'yellow' | 'red';
}

function FilterChip({ label, active, onClick, color = 'gray' }: FilterChipProps): JSX.Element {
  const colors = {
    gray: 'bg-gray-700 text-gray-300',
    yellow: 'bg-yellow-900 text-yellow-300',
    red: 'bg-red-900 text-red-300',
  };

  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-xs transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : `${colors[color]} hover:opacity-80`
      }`}
    >
      {label}
    </button>
  );
}

interface EventTimelineItemProps {
  event: ProctoringEvent;
  isFirst: boolean;
  isLast: boolean;
  onClick: () => void;
}

function EventTimelineItem({ event, onClick }: EventTimelineItemProps): JSX.Element {
  const config = getEventConfig(event);
  const time = new Date(event.timestamp).toLocaleTimeString();

  return (
    <div
      className="relative pl-8 pr-2 py-2 cursor-pointer hover:bg-gray-800/50 rounded-lg transition-colors"
      onClick={onClick}
    >
      {/* Timeline Dot */}
      <div
        className={`absolute left-2.5 top-3 w-3 h-3 rounded-full border-2 ${config.dotColor} bg-gray-900`}
      />

      {/* Event Content */}
      <div className={`p-2 rounded-lg ${config.bgColor} border-l-2 ${config.borderColor}`}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span>{config.icon}</span>
            <span className="font-medium text-sm">{config.label}</span>
          </div>
          <span className="text-xs text-gray-500 shrink-0">{time}</span>
        </div>

        {/* Description */}
        {event.description && (
          <p className="text-xs text-gray-400 mt-1 ml-6">{event.description}</p>
        )}

        {/* User Badge */}
        {event.userId && event.userId !== 'system' && (
          <div className="mt-1 ml-6">
            <span className="inline-block px-1.5 py-0.5 bg-gray-700 rounded text-xs text-gray-400">
              👤 {event.userId.slice(0, 8)}...
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Compact Timeline (for sidebars)
// ============================================================================

interface CompactTimelineProps {
  events: ProctoringEvent[];
  limit?: number;
  onEventClick?: (event: ProctoringEvent) => void;
}

export function CompactTimeline({
  events,
  limit = 5,
  onEventClick,
}: CompactTimelineProps): JSX.Element {
  const displayEvents = events.slice(0, limit);

  return (
    <div className="space-y-1">
      {displayEvents.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">No recent events</p>
      ) : (
        displayEvents.map((event) => {
          const config = getEventConfig(event);
          const time = new Date(event.timestamp).toLocaleTimeString();

          return (
            <div
              key={event.id}
              className={`flex items-center gap-2 p-2 rounded ${config.bgColor} cursor-pointer hover:opacity-80 transition-opacity`}
              onClick={() => onEventClick?.(event)}
            >
              <span className="text-sm">{config.icon}</span>
              <span className="flex-1 text-xs truncate">{config.label}</span>
              <span className="text-xs text-gray-500">{time}</span>
            </div>
          );
        })
      )}

      {events.length > limit && (
        <p className="text-xs text-gray-500 text-center pt-1">
          +{events.length - limit} more events
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

interface EventConfig {
  label: string;
  icon: string;
  bgColor: string;
  borderColor: string;
  dotColor: string;
}

function getEventConfig(event: ProctoringEvent): EventConfig {
  // Severity-based colors
  const severityConfig: Record<ViolationSeverity, Pick<EventConfig, 'bgColor' | 'borderColor' | 'dotColor'>> = {
    [ViolationSeverity.INFO]: {
      bgColor: 'bg-gray-800/50',
      borderColor: 'border-gray-600',
      dotColor: 'border-gray-500',
    },
    [ViolationSeverity.WARNING]: {
      bgColor: 'bg-yellow-900/20',
      borderColor: 'border-yellow-600',
      dotColor: 'border-yellow-500',
    },
    [ViolationSeverity.CRITICAL]: {
      bgColor: 'bg-red-900/20',
      borderColor: 'border-red-600',
      dotColor: 'border-red-500',
    },
    [ViolationSeverity.FATAL]: {
      bgColor: 'bg-red-900/40',
      borderColor: 'border-red-500',
      dotColor: 'border-red-400',
    },
  };

  // Type-based labels and icons
  const typeConfig: Partial<Record<ProctoringEventType, { label: string; icon: string }>> = {
    [ProctoringEventType.SESSION_STARTED]: { label: 'Session Started', icon: '🎬' },
    [ProctoringEventType.SESSION_ENDED]: { label: 'Session Ended', icon: '🏁' },
    [ProctoringEventType.SESSION_PAUSED]: { label: 'Session Paused', icon: '⏸️' },
    [ProctoringEventType.SESSION_RESUMED]: { label: 'Session Resumed', icon: '▶️' },
    [ProctoringEventType.CONNECTION_ESTABLISHED]: { label: 'Connected', icon: '🔗' },
    [ProctoringEventType.CONNECTION_LOST]: { label: 'Disconnected', icon: '🔌' },
    [ProctoringEventType.CONNECTION_RECOVERED]: { label: 'Reconnected', icon: '🔄' },
    [ProctoringEventType.ICE_RESTART_TRIGGERED]: { label: 'ICE Restart', icon: '🔧' },
    [ProctoringEventType.ICE_RESTART_COMPLETED]: { label: 'ICE Restored', icon: '✅' },
    [ProctoringEventType.WEBCAM_ENABLED]: { label: 'Webcam On', icon: '📷' },
    [ProctoringEventType.WEBCAM_DISABLED]: { label: 'Webcam Off', icon: '📷' },
    [ProctoringEventType.WEBCAM_BLOCKED]: { label: 'Webcam Blocked', icon: '🚫' },
    [ProctoringEventType.SCREEN_SHARE_STARTED]: { label: 'Screen Share On', icon: '🖥️' },
    [ProctoringEventType.SCREEN_SHARE_STOPPED]: { label: 'Screen Share Off', icon: '🖥️' },
    [ProctoringEventType.AUDIO_ENABLED]: { label: 'Audio On', icon: '🎤' },
    [ProctoringEventType.AUDIO_DISABLED]: { label: 'Audio Off', icon: '🔇' },
    [ProctoringEventType.QUALITY_DEGRADED]: { label: 'Quality Degraded', icon: '📉' },
    [ProctoringEventType.QUALITY_RECOVERED]: { label: 'Quality Recovered', icon: '📈' },
    [ProctoringEventType.PACKET_LOSS_HIGH]: { label: 'High Packet Loss', icon: '📶' },
    [ProctoringEventType.BANDWIDTH_LIMITED]: { label: 'Low Bandwidth', icon: '🐢' },
    [ProctoringEventType.VIOLATION_DETECTED]: { label: 'Violation', icon: '⚠️' },
    [ProctoringEventType.VIOLATION_ACKNOWLEDGED]: { label: 'Acknowledged', icon: '👁️' },
    [ProctoringEventType.MULTIPLE_FACES_DETECTED]: { label: 'Multiple Faces', icon: '👥' },
    [ProctoringEventType.NO_FACE_DETECTED]: { label: 'No Face', icon: '🚷' },
    [ProctoringEventType.TAB_SWITCH_DETECTED]: { label: 'Tab Switch', icon: '🔀' },
  };

  const typeInfo = typeConfig[event.type] || {
    label: event.type.split('.').pop()?.replace(/_/g, ' ') || event.type,
    icon: '📌',
  };

  return {
    ...severityConfig[event.severity],
    ...typeInfo,
  };
}

// ============================================================================
// Exports
// ============================================================================

export { getEventConfig };
export type { EventTimelineProps, CompactTimelineProps };
