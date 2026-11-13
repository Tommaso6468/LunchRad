/**
 * Team sessions. Entering the shared team key once returns a signed session
 * token, which the app stores instead of the key itself.
 *
 * Token: base64url(payload) "." base64url(HMAC-SHA256(SESSION_SECRET, payload))
 * Payload: { v: 1, kf: <team-key fingerprint>, exp: <ms> }
 *
 * The fingerprint is derived from the current TEAM_KEY, so rotating the team
 * key invalidates every existing session at once.
 */
import { LIMITS } from '@lunchrad/shared';
import { base64url, fromBase64url, hmac, hmacVerify } from './crypto.ts';
import type { ConfiguredEnv } from './env.ts';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function keyFingerprint(env: ConfiguredEnv): Promise<string> {
  return base64url((await hmac(env.SESSION_SECRET, `team-key:${env.TEAM_KEY}`)).slice(0, 12));
}

export async function issueTeamSession(
  env: ConfiguredEnv,
  now: number,
): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = now + LIMITS.teamSessionMs;
  const payload = base64url(
    encoder.encode(JSON.stringify({ v: 1, kf: await keyFingerprint(env), exp: expiresAt })),
  );
  const signature = base64url(await hmac(env.SESSION_SECRET, payload));
  return { token: `${payload}.${signature}`, expiresAt };
}

export async function verifyTeamSession(
  env: ConfiguredEnv,
  token: string,
  now: number,
): Promise<boolean> {
  if (token.length > 512) return false;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return false;
  const signatureBytes = fromBase64url(signature);
  if (!signatureBytes) return false;
  if (!(await hmacVerify(env.SESSION_SECRET, payload, signatureBytes))) return false;

  const payloadBytes = fromBase64url(payload);
  if (!payloadBytes) return false;
  let data: unknown;
  try {
    data = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return false;
  }
  if (typeof data !== 'object' || data === null) return false;
  const { v, kf, exp } = data as Record<string, unknown>;
  return v === 1 && typeof exp === 'number' && exp > now && kf === (await keyFingerprint(env));
}
