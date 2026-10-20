import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index.ts';
import { BASELINE_HEADERS } from '../src/security.ts';

const SHELL_HTML = `<!doctype html><html lang="nl"><head>
<link rel="stylesheet" href="styles-ABC.css"></head>
<body><app-root></app-root><script src="main-XYZ.js" type="module"></script></body></html>`;

function makeEnv(assetStatus = 200): Env {
  return {
    ENVIRONMENT: 'test',
    ASSETS: {
      fetch: async () =>
        new Response(assetStatus === 200 ? SHELL_HTML : 'missing', {
          status: assetStatus,
          headers: { 'Content-Type': 'text/html' },
        }),
      connect: () => {
        throw new Error('not used');
      },
    } as unknown as Fetcher,
  };
}

async function request(path: string, init?: RequestInit, env = makeEnv()): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://lunchrad.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

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
    const res = await request('/', undefined, makeEnv(404));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Er ging iets mis' });
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
    expect(res.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
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
