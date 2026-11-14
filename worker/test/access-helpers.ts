import { vi } from 'vitest';
import { base64url } from '../src/crypto.ts';
import { call, jsonInit, ORIGIN } from './helpers.ts';

export const TEAM_DOMAIN = 'lunchrad-test.cloudflareaccess.com';
export const AUD = 'a'.repeat(64);
export const ADMIN = 'beheer@example.com';
export const KID = 'test-kid-1';

const encoder = new TextEncoder();

export interface Keys {
  privateKey: CryptoKey;
  jwk: JsonWebKey;
}

export async function makeKeys(): Promise<Keys> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  return { privateKey: pair.privateKey, jwk };
}

function part(value: unknown): string {
  return base64url(encoder.encode(JSON.stringify(value)));
}

export async function signJwt(
  keys: Keys,
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const head = part({ alg: 'RS256', kid: KID, typ: 'JWT', ...header });
  const body = part({
    iss: `https://${TEAM_DOMAIN}`,
    aud: [AUD],
    email: ADMIN,
    iat: now,
    nbf: now,
    exp: now + 3600,
    sub: 'user-1',
    ...claims,
  });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    keys.privateKey,
    encoder.encode(`${head}.${body}`),
  );
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

/** Serves the Access public keys (and Turnstile) to the Worker under test. */
export function mockAccessKeys(keys: Keys, kid = KID) {
  const certs = vi.fn(() =>
    Response.json({ keys: [{ ...keys.jwk, kid, alg: 'RS256', use: 'sig' }] }),
  );
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === `https://${TEAM_DOMAIN}/cdn-cgi/access/certs`) return certs();
    if (url.startsWith('https://challenges.cloudflare.com/'))
      return Response.json({ success: true });
    throw new Error(`Unexpected outbound fetch in test: ${url}`);
  });
  return certs;
}

/** An admin request as Access would forward it. */
export function adminCall(
  token: string | null,
  path: string,
  init: RequestInit & { origin?: string | null; adminHeader?: boolean } = {},
) {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set('Cf-Access-Jwt-Assertion', token);
  const method = init.method ?? 'GET';
  if (method !== 'GET') {
    if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
    if (init.adminHeader !== false) headers.set('X-Lunchrad-Admin', '1');
  }
  return call(`/admin/api${path}`, { ...init, headers });
}

export function adminJson(
  token: string,
  path: string,
  body: unknown,
  method = 'POST',
  extra: { origin?: string | null; adminHeader?: boolean } = {},
) {
  const init = jsonInit(body);
  return adminCall(token, path, { ...init, method, ...extra });
}
