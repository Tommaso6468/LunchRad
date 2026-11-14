/**
 * HTTP security headers and the Content Security Policy.
 *
 * Static assets get equivalent headers from app/public/_headers; keep the
 * two in sync (a test in worker/test checks the shared baseline).
 */

export const BASELINE_HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy':
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  // An internal team tool: keep it out of search engines (less to discover).
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

/** CSP for anything that is not the HTML app shell (JSON, errors). */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/**
 * CSP for the app shell. Angular injects component styles at runtime, so
 * styles need the per-request nonce (picked up via the ngCspNonce attribute).
 * No 'unsafe-inline', no 'unsafe-eval'. Trusted Types restrict DOM sinks to
 * Angular's own policies plus one that only allows the Turnstile script URL.
 *
 * Turnstile (bot check on room creation) loads from challenges.cloudflare.com
 * and renders in an iframe from there. The WebSocket goes to our own host;
 * wss: is listed explicitly because older Safari does not match it to 'self'.
 */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
export const TURNSTILE_TT_POLICY = 'lunchrad#turnstile';
/** Trusted Types policy that only allows registering /sw.js. */
export const SW_TT_POLICY = 'lunchrad#sw';

/**
 * The service worker script's own CSP: it may only talk to this origin.
 * (A worker's CSP comes from its script response, not from the page.)
 */
export const SW_CSP = "default-src 'none'; connect-src 'self'";

export function shellCsp(nonce: string, host: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' ${TURNSTILE_ORIGIN}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' wss://${host}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    // Angular routing needs <base href="/">; 'self' still blocks foreign bases.
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "require-trusted-types-for 'script'",
    `trusted-types angular angular#bundler ${TURNSTILE_TT_POLICY} ${SW_TT_POLICY}`,
    'upgrade-insecure-requests',
  ].join('; ');
}

/** 128-bit random nonce, base64-encoded. Fresh for every shell response. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Returns a copy of the response with baseline headers and the given CSP applied. */
export function withSecurityHeaders(response: Response, csp: string = API_CSP): Response {
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
    secured.headers.set(name, value);
  }
  secured.headers.set('Content-Security-Policy', csp);
  // Never reveal the platform or framework in headers.
  secured.headers.delete('X-Powered-By');
  return secured;
}
