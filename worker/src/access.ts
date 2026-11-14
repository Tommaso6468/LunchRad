/**
 * Cloudflare Access in front of /admin. Access logs the admin in (email
 * one-time PIN) and adds a signed JWT to every request it lets through, in
 * the Cf-Access-Jwt-Assertion header. The Worker never trusts that header's
 * presence: it verifies the RS256 signature against the team's published
 * keys, the issuer, the audience, the time window and the email allow-list.
 * Anything else, or missing configuration, is refused.
 */
import { fromBase64url } from './crypto.ts';
import type { Env } from './env.ts';

export interface AdminConfig {
  teamDomain: string;
  audience: string;
  emails: ReadonlySet<string>;
}

export interface AdminIdentity {
  email: string;
}

const CLOCK_SKEW_S = 60;
const JWKS_TTL_MS = 10 * 60_000;
/** A token with an unknown key id may refetch the keys at most this often. */
const JWKS_REFETCH_MS = 60_000;
const MAX_TOKEN_LENGTH = 8192;

export function adminConfig(env: Env): AdminConfig | null {
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim().toLowerCase() ?? '';
  const audience = env.ACCESS_AUD?.trim() ?? '';
  const emails = new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@')),
  );
  // Only a real Access team domain: never a URL, never anything else.
  if (!/^[a-z0-9-]{1,63}\.cloudflareaccess\.com$/.test(teamDomain)) return null;
  if (!/^[a-f0-9]{64}$/.test(audience)) return null;
  if (emails.size === 0) return null;
  return { teamDomain, audience, emails };
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

let jwks: { domain: string; at: number; keys: Map<string, CryptoKey> } | null = null;
let lastRefetch = 0;

/** Between tests. */
export function clearAccessKeyCache(): void {
  jwks = null;
  lastRefetch = 0;
}

async function loadKeys(domain: string): Promise<Map<string, CryptoKey>> {
  const response = await fetch(`https://${domain}/cdn-cgi/access/certs`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Access keys: HTTP ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const jwk of body.keys ?? []) {
    if (jwk.kty !== 'RSA' || typeof jwk.kid !== 'string') continue;
    if (jwk.alg !== undefined && jwk.alg !== 'RS256') continue;
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(jwk.kid, key);
  }
  return keys;
}

async function keyFor(domain: string, kid: string): Promise<CryptoKey | null> {
  const now = Date.now();
  if (!jwks || jwks.domain !== domain || now - jwks.at > JWKS_TTL_MS) {
    jwks = { domain, at: now, keys: await loadKeys(domain) };
    lastRefetch = now;
  }
  let key = jwks.keys.get(kid);
  if (!key && now - lastRefetch > JWKS_REFETCH_MS) {
    // Access rotates its keys; a new kid may have appeared.
    lastRefetch = now;
    jwks = { domain, at: now, keys: await loadKeys(domain) };
    key = jwks.keys.get(kid);
  }
  return key ?? null;
}

function decodeJson(part: string): Record<string, unknown> | null {
  const bytes = fromBase64url(part);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
    );
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Returns the admin's identity, or null for anything that is not a valid,
 * current Access token for this application and an allowed email address.
 */
export async function verifyAccessJwt(
  config: AdminConfig,
  token: string | null | undefined,
  nowMs: number = Date.now(),
): Promise<AdminIdentity | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  const header = decodeJson(headerPart);
  // Only RS256: never "none", never an HMAC algorithm keyed with a public key.
  if (!header || header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') return null;
  const payload = decodeJson(payloadPart);
  const signature = fromBase64url(signaturePart);
  if (!payload || !signature) return null;

  const key = await keyFor(config.teamDomain, header['kid']);
  if (!key) return null;
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) return null;

  const now = Math.floor(nowMs / 1000);
  const { iss, aud, exp, nbf, iat, email } = payload;
  if (iss !== `https://${config.teamDomain}`) return null;
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(config.audience)) return null;
  if (typeof exp !== 'number' || exp + CLOCK_SKEW_S < now) return null;
  if (typeof nbf === 'number' && nbf - CLOCK_SKEW_S > now) return null;
  if (typeof iat === 'number' && iat - CLOCK_SKEW_S > now) return null;
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!config.emails.has(normalized)) return null;
  return { email: normalized };
}
