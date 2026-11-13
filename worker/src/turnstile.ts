/** Server-side Turnstile validation (tokens are single-use and expire after 5 minutes). */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'create-room';

interface SiteverifyResult {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
}

export async function verifyTurnstile(options: {
  secret: string;
  token: string;
  remoteIp: string | null;
  /** Expected hostname; null skips the hostname and action checks (local development only). */
  expectedHostname: string | null;
}): Promise<boolean> {
  const body = new FormData();
  body.set('secret', options.secret);
  body.set('response', options.token);
  if (options.remoteIp) body.set('remoteip', options.remoteIp);
  body.set('idempotency_key', crypto.randomUUID());

  let result: SiteverifyResult;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    result = await response.json();
  } catch {
    // Network errors or timeouts fail closed: no bot check, no room.
    return false;
  }

  if (result.success !== true) return false;
  // Cloudflare's dummy test keys return placeholder hostname/action values, so
  // these checks only run where real keys are used (staging and production).
  if (options.expectedHostname === null) return true;
  return result.hostname === options.expectedHostname && result.action === TURNSTILE_ACTION;
}
