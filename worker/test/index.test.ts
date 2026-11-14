import { describe, expect, it } from 'vitest';
import { API_CSP, BASELINE_HEADERS } from '../src/security.ts';
import { call, makeEnv } from './helpers.ts';

const request = (path: string, init?: RequestInit, env = makeEnv()) => call(path, init ?? {}, env);

function nonceFromCsp(csp: string): string {
  const match = /'nonce-([^']+)'/.exec(csp);
  if (!match?.[1]) throw new Error('No nonce in CSP');
  return match[1];
}

describe('app shell', () => {
  it('injects the same fresh nonce into the CSP, app-root and tags', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const nonce = nonceFromCsp(csp);
    const html = await res.text();

    // HTML attribute names are case-insensitive; HTMLRewriter writes lowercase
    // and Angular's getAttribute('ngCspNonce') still finds it.
    expect(html).toContain(`<app-root ngcspnonce="${nonce}">`);
    expect(html).toContain(`<script src="main-XYZ.js" type="module" nonce="${nonce}">`);
    expect(html).toContain(`href="styles-ABC.css" nonce="${nonce}"`);
  });

  it('uses a different nonce on every request', async () => {
    const a = nonceFromCsp((await request('/')).headers.get('Content-Security-Policy') ?? '');
    const b = nonceFromCsp((await request('/')).headers.get('Content-Security-Policy') ?? '');
    expect(a).not.toBe(b);
    expect(atob(a)).toHaveLength(16);
  });

  it('has a strict CSP without unsafe directives', async () => {
    const csp = (await request('/')).headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("require-trusted-types-for 'script'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('allows only Turnstile as third party, and the WebSocket to our own host', async () => {
    const csp = (await request('/')).headers.get('Content-Security-Policy') ?? '';
    const directives = Object.fromEntries(
      csp.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1)]),
    );
    expect(directives['script-src']).toEqual([
      "'self'",
      expect.stringMatching(/^'nonce-/),
      'https://challenges.cloudflare.com',
    ]);
    expect(directives['frame-src']).toEqual(['https://challenges.cloudflare.com']);
    expect(directives['connect-src']).toEqual(["'self'", 'wss://lunchrad.test']);
    expect(directives['trusted-types']).toEqual([
      'angular',
      'angular#bundler',
      'lunchrad#turnstile',
      'lunchrad#sw',
    ]);
    expect(directives['manifest-src']).toEqual(["'self'"]);
    expect(directives['worker-src']).toEqual(["'self'"]);
  });

  it('is never cacheable', async () => {
    expect((await request('/')).headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves the shell for client-side routes', async () => {
    const res = await request('/r/K7Q4M0');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<app-root');
  });

  it('returns 404 for missing files instead of the shell', async () => {
    const res = await request('/missing-file.js');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<app-root');
  });

  it('returns a generic 500 when the shell asset is missing', async () => {
    const res = await request('/', undefined, makeEnv({}, 404));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
  });
});

describe('API', () => {
  it('answers the health check', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Security-Policy')).toBe(API_CSP);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });

  it('rejects methods the shell does not support', async () => {
    const res = await request('/', { method: 'POST' });
    expect(res.status).toBe(405);
  });
});

describe('security headers', () => {
  it.each(['/', '/api/health', '/api/nope', '/missing.js'])(
    'applies the baseline to %s',
    async (path) => {
      const res = await request(path);
      for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
        expect(res.headers.get(name), name).toBe(value);
      }
      expect(res.headers.get('Content-Security-Policy')).toBeTruthy();
    },
  );
});

describe('service worker script', () => {
  const swEnv = (status = 200) =>
    makeEnv({
      ASSETS: {
        fetch: async () =>
          new Response(status === 200 ? 'self.addEventListener("fetch", () => {});' : 'missing', {
            status,
          }),
        connect: () => {
          throw new Error('not used');
        },
      } as unknown as Fetcher,
    });

  it('is never HTTP-cached and may only talk to this origin', async () => {
    const res = await call('/sw.js', {}, swEnv());
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/javascript');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; connect-src 'self'",
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('answers 404 when the build has none', async () => {
    expect((await call('/sw.js', {}, swEnv(404))).status).toBe(404);
  });
});
