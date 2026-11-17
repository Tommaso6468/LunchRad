/** Server-side Turnstile validation (tokens are single-use and expire after 5 minutes). */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'create-room';

interface SiteverifyResult {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  'error-codes'?: unknown;
}

/** Only Cloudflare's own short codes and names reach the logs; never the token, secret or IP. */
function codes(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((c): c is string => typeof c === 'string')
        .slice(0, 5)
        .map((c) => c.slice(0, 60))
    : [];
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
    if (!response.ok) {
      console.warn('Turnstile failed', { reason: 'http', status: response.status });
      return false;
    }
    result = await response.json();
  } catch (err) {
    // Network errors or timeouts fail closed: no bot check, no room.
    console.warn('Turnstile failed', { reason: 'network', name: (err as Error).name });
    return false;
  }

  if (result.success !== true) {
    // e.g. invalid-input-secret (secret of another widget), timeout-or-duplicate.
    console.warn('Turnstile failed', { reason: 'rejected', codes: codes(result['error-codes']) });
    return false;
  }
  // Cloudflare's dummy test keys return placeholder hostname/action values, so
  // these checks only run where real keys are used (staging and production).
  if (options.expectedHostname === null) return true;
  if (result.hostname !== options.expectedHostname) {
    console.warn('Turnstile failed', {
      reason: 'hostname',
      expected: options.expectedHostname,
      got: typeof result.hostname === 'string' ? result.hostname.slice(0, 100) : null,
    });
    return false;
  }
  if (result.action !== TURNSTILE_ACTION) {
    console.warn('Turnstile failed', { reason: 'action' });
    return false;
  }
  return true;
}
