/** Small WebCrypto helpers. Nothing here uses Math.random. */

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/** 256-bit random token, base64url (43 characters). */
export function randomToken(): string {
  return base64url(randomBytes(32));
}

/** 64-bit random id, hex (16 characters). */
export function randomId(): string {
  return [...randomBytes(8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export async function sha256Base64url(text: string): Promise<string> {
  return base64url(await sha256(text));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await hmacKey(secret);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Constant-time HMAC check (crypto.subtle.verify compares in constant time). */
export async function hmacVerify(
  secret: string,
  message: string,
  signature: Uint8Array,
): Promise<boolean> {
  const key = await hmacKey(secret);
  return crypto.subtle.verify(
    'HMAC',
    key,
    signature as Uint8Array<ArrayBuffer>,
    encoder.encode(message),
  );
}

/**
 * Constant-time equality of two strings, independent of their lengths:
 * both are hashed first, then compared with timingSafeEqual.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}
