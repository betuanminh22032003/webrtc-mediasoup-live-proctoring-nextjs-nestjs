/**
 * Room Service
 *
 * Manages room state for proctoring sessions.
 *
 * WHY in-memory for now?
 * - Phase 1 is single-server
 * - Simplifies initial implementation
 * - Will need Redis/distributed cache for Phase 5 scaling
 */

import { Injectable } from '@nestjs/common';
import type {
  RoomConfig,
  Participant,
  RoomStateType,
} from '@proctoring/shared';
import { RoomState } from '@proctoring/shared';
import { logger } from '../common/logger';

interface Room {
  config: RoomConfig;
  state: RoomState;
  participants: Map<string, Participant>;
  startedAt?: number;
  endedAt?: number;
}

@Injectable()
export class RoomService {
  /**
   * In-memory room storage
   *
   * TRADE-OFF:
   * - Simple and fast for single server
   * - Lost on restart (not persisted)
   * - Doesn't scale to multiple servers
   *
   * FUTURE: Replace with Redis for distributed state
   */
  private rooms: Map<string, Room> = new Map();

  /**
   * Create a new room
   */
  createRoom(roomId: string, config: RoomConfig): Room {
    if (this.rooms.has(roomId)) {
      logger.warn({ roomId }, 'Room already exists, returning existing');
      return this.rooms.get(roomId)!;
    }

    const room: Room = {
      config,
      state: RoomState.WAITING,
      participants: new Map(),
    };

    this.rooms.set(roomId, room);
    logger.info({ roomId, config }, 'Room created');

    return room;
  }

  /**
   * Check if room exists
   */
  roomExists(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /**
   * Get room by ID
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Add participant to room
   */
  addParticipant(roomId: string, participant: Participant): Participant | null {
    const room = this.rooms.get(roomId);

    if (!room) {
      logger.error({ roomId }, 'Cannot add participant: room not found');
      return null;
    }

    // Check capacity
    if (room.participants.size >= room.config.maxParticipants) {
      logger.warn(
        { roomId, current: room.participants.size, max: room.config.maxParticipants },
        'Room at capacity'
      );
      return null;
    }

    room.participants.set(participant.user.id, participant);

    logger.info(
      { roomId, userId: participant.user.id, role: participant.user.role },
      'Participant added to room'
    );

    return participant;
  }

  /**
   * Remove participant from room
   */
  removeParticipant(roomId: string, userId: string): boolean {
    const room = this.rooms.get(roomId);

    if (!room) {
      return false;
    }

    const removed = room.participants.delete(userId);

    if (removed) {
      logger.info({ roomId, userId }, 'Participant removed from room');

      // Auto-cleanup empty rooms
      if (room.participants.size === 0) {
        this.rooms.delete(roomId);
        logger.info({ roomId }, 'Empty room deleted');
      }
    }

    return removed;
  }

  /**
   * Get participant by user ID
   */
  getParticipant(roomId: string, userId: string): Participant | undefined {
    const room = this.rooms.get(roomId);
    return room?.participants.get(userId);
  }

  /**
   * Update participant state
   */
  updateParticipant(
    roomId: string,
    userId: string,
    updates: Partial<Participant>
  ): Participant | null {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(userId);

    if (!participant) {
      return null;
    }

    const updated = { ...participant, ...updates };
    room!.participants.set(userId, updated);

    return updated;
  }

  /**
   * Get full room state (for sending to clients)
   */
  getRoomState(roomId: string): RoomStateType | null {
    const room = this.rooms.get(roomId);

    if (!room) {
      return null;
    }

    return {
      config: room.config,
      state: room.state,
      participants: Array.from(room.participants.values()),
      startedAt: room.startedAt,
      endedAt: room.endedAt,
    };
  }

  /**
   * Update room state
   */
  updateRoomState(roomId: string, state: RoomState): boolean {
    const room = this.rooms.get(roomId);

    if (!room) {
      return false;
    }

    const previousState = room.state;
    room.state = state;

    // Track timestamps for audit
    if (state === RoomState.ACTIVE && !room.startedAt) {
      room.startedAt = Date.now();
    }

    if (state === RoomState.ENDED && !room.endedAt) {
      room.endedAt = Date.now();
    }

    logger.info(
      { roomId, previousState, newState: state },
      'Room state updated'
    );

    return true;
  }

  /**
   * Get all participants in a room
   */
  getParticipants(roomId: string): Participant[] {
    const room = this.rooms.get(roomId);
    return room ? Array.from(room.participants.values()) : [];
  }

  /**
   * Get room statistics
   */
  getRoomStats(): {
    totalRooms: number;
    totalParticipants: number;
    roomsByState: Record<RoomState, number>;
  } {
    const stats = {
      totalRooms: this.rooms.size,
      totalParticipants: 0,
      roomsByState: {
        [RoomState.WAITING]: 0,
        [RoomState.ACTIVE]: 0,
        [RoomState.PAUSED]: 0,
        [RoomState.ENDED]: 0,
        [RoomState.INVALIDATED]: 0,
      },
    };

    this.rooms.forEach((room) => {
      stats.totalParticipants += room.participants.size;
      stats.roomsByState[room.state]++;
    });

    return stats;
  }
}
