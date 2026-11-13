import { Hono } from 'hono';
import { api } from './api.ts';
import type { Env } from './env.ts';
import { generateNonce, shellCsp, withSecurityHeaders } from './security.ts';

export { Room } from './room.ts';
export type { Env } from './env.ts';

const app = new Hono<{ Bindings: Env }>();

// Generic Dutch error bodies; details go to logs only (without request data).
const textError = (status: 404 | 405, message: string): Response =>
  new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });

app.route('/api', api);

/**
 * Serves the Angular app shell for every non-file path ("/", "/r/ABC123", ...),
 * with a fresh CSP nonce injected into the HTML.
 */
app.on(['GET', 'HEAD'], '*', async (c) => {
  const url = new URL(c.req.url);

  // A path with a file extension that reached the Worker is a missing asset,
  // not an app route. Answer 404 instead of serving the shell.
  if (/\.[a-z0-9]+$/i.test(url.pathname) && url.pathname !== '/index.html') {
    return textError(404, 'Niet gevonden');
  }

  const shell = await c.env.ASSETS.fetch(new Request(new URL('/', url)));
  if (!shell.ok) {
    console.error('App shell unavailable', { status: shell.status });
    return Response.json(
      { error: 'server_error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const nonce = generateNonce();
  const rewritten = new HTMLRewriter()
    .on('app-root', {
      element(el) {
        el.setAttribute('ngCspNonce', nonce);
      },
    })
    .on('script, style, link[rel="stylesheet"]', {
      element(el) {
        el.setAttribute('nonce', nonce);
      },
    })
    .transform(shell);

  const response = new Response(rewritten.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Each response carries a unique nonce: it must never be cached by a CDN.
      'Cache-Control': 'no-store',
    },
  });
  return withSecurityHeaders(response, shellCsp(nonce, url.host));
});

app.all('*', () => textError(405, 'Methode niet toegestaan'));

app.onError((err) => {
  console.error('Unhandled error', { name: err.name, message: err.message });
  return Response.json(
    { error: 'server_error' },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const response = await app.fetch(request, env, ctx);
    // WebSocket upgrades must be returned untouched.
    if (response.status === 101) return response;
    const isShell = response.headers.get('Content-Security-Policy') !== null;
    return isShell ? response : withSecurityHeaders(response);
  },
} satisfies ExportedHandler<Env>;
