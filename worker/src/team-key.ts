/**
 * The shared team key. It starts as the TEAM_KEY secret; once an admin
 * rotates it in the admin panel, an HMAC of the new key in D1 takes over and
 * the secret is ignored. The key itself is never stored and never logged.
 *
 * Every Worker instance caches what is in D1 for a short time, so a rotation
 * reaches all of them within TEAM_KEY_CACHE_MS.
 */
import { ROOM_CODE_ALPHABET, normalizeTeamKey } from '@lunchrad/shared';
import { base64url, hmac, safeEqual } from './crypto.ts';
import { storedTeamKey, type StoredTeamKey } from './db.ts';
import type { ConfiguredEnv } from './env.ts';
import { randomIndex } from './spin.ts';

export const TEAM_KEY_CACHE_MS = 30_000;

let cache: { at: number; value: StoredTeamKey | null } | null = null;

/** Forget the cached value (after a rotation, and between tests). */
export function clearTeamKeyCache(): void {
  cache = null;
}

async function current(env: ConfiguredEnv): Promise<StoredTeamKey | null> {
  const now = Date.now();
  if (cache && now - cache.at < TEAM_KEY_CACHE_MS) return cache.value;
  const value = await storedTeamKey(env.DB);
  cache = { at: now, value };
  return value;
}

export async function teamKeyCheckHash(env: ConfiguredEnv, key: string): Promise<string> {
  return base64url(await hmac(env.SESSION_SECRET, `team-key-check:${normalizeTeamKey(key)}`));
}

export async function teamKeyMatches(env: ConfiguredEnv, candidate: string): Promise<boolean> {
  const stored = await current(env);
  if (!stored) return safeEqual(candidate, env.TEAM_KEY);
  return safeEqual(await teamKeyCheckHash(env, candidate), stored.checkHash);
}

/**
 * Part of every team session. Changes whenever the key changes, so a
 * rotation logs out every device at once.
 */
export async function teamKeyFingerprint(env: ConfiguredEnv): Promise<string> {
  const stored = await current(env);
  const material = stored ? `admin:${stored.checkHash}` : `team-key:${env.TEAM_KEY}`;
  return base64url((await hmac(env.SESSION_SECRET, material)).slice(0, 12));
}

export async function teamKeySource(
  env: ConfiguredEnv,
): Promise<{ source: 'secret' | 'admin'; rotatedAt: number | null; rotatedBy: string | null }> {
  const stored = await storedTeamKey(env.DB);
  return stored
    ? { source: 'admin', rotatedAt: stored.rotatedAt, rotatedBy: stored.rotatedBy }
    : { source: 'secret', rotatedAt: null, rotatedBy: null };
}

/**
 * A new key: four groups of five characters from the room-code alphabet,
 * lower case (about 100 bits). Made on the server so it is always strong.
 */
export function generateTeamKey(): string {
  const alphabet = ROOM_CODE_ALPHABET.toLowerCase();
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let group = '';
    for (let i = 0; i < 5; i++) group += alphabet[randomIndex(alphabet.length)];
    groups.push(group);
  }
  return groups.join('-');
}
