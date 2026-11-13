import { Injectable } from '@angular/core';
import { LIMITS, type RoomCredentials } from '@lunchrad/shared';

/**
 * Everything the app remembers on this device. localStorage can throw
 * (private mode, blocked storage) or come back empty; every access is
 * guarded and the app keeps working without it.
 */
const KEYS = {
  team: 'lunchrad.team',
  name: 'lunchrad.name',
  roomPrefix: 'lunchrad.room.',
} as const;

interface TeamSession {
  token: string;
  expiresAt: number;
}

interface StoredRoom extends RoomCredentials {
  savedAt: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the app works, it just forgets.
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

@Injectable({ providedIn: 'root' })
export class DeviceStore {
  constructor() {
    this.pruneRooms();
  }

  teamToken(): string | null {
    const session = read<TeamSession>(KEYS.team);
    if (!session || typeof session.token !== 'string' || session.expiresAt <= Date.now()) {
      return null;
    }
    return session.token;
  }

  saveTeamSession(session: TeamSession): void {
    write(KEYS.team, session);
  }

  forgetTeamSession(): void {
    remove(KEYS.team);
  }

  lastName(): string {
    const name = read<string>(KEYS.name);
    return typeof name === 'string' ? name : '';
  }

  saveName(name: string): void {
    write(KEYS.name, name);
  }

  room(code: string): RoomCredentials | null {
    const stored = read<StoredRoom>(KEYS.roomPrefix + code);
    if (!stored || stored.code !== code) return null;
    return { code: stored.code, participantId: stored.participantId, token: stored.token };
  }

  saveRoom(credentials: RoomCredentials): void {
    write(KEYS.roomPrefix + credentials.code, { ...credentials, savedAt: Date.now() });
  }

  forgetRoom(code: string): void {
    remove(KEYS.roomPrefix + code);
  }

  /** Rooms live at most 30 minutes; drop credentials that cannot be valid any more. */
  private pruneRooms(): void {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key?.startsWith(KEYS.roomPrefix)) continue;
        const stored = read<StoredRoom>(key);
        if (!stored || Date.now() - stored.savedAt > LIMITS.roomLifetimeMs) remove(key);
      }
    } catch {
      // Ignore.
    }
  }
}
