/**
 * The JSON API under /api. Every route validates its body with the shared
 * Zod schema, is rate limited, and fails closed when secrets are missing.
 */
import {
  WS_PROTOCOL,
  WS_TEAM_PREFIX,
  createRoomRequest,
  generateRoomCode,
  joinRoomRequest,
  normalizeRoomCode,
  sessionRequest,
} from '@lunchrad/shared';
import { Hono, type Context, type Next } from 'hono';
import { isConfigured, type ConfiguredEnv, type Env } from './env.ts';
import { apiError, apiOk, clientIp, readJson } from './http.ts';
import { presetMenu, presetSummaries, registerRoom } from './db.ts';
import { teamKeyMatches } from './team-key.ts';
import { issueTeamSession, verifyTeamSession } from './team-session.ts';
import { verifyTurnstile } from './turnstile.ts';

interface AppEnv {
  Bindings: Env;
}
type ApiContext = Context<AppEnv>;

export const api = new Hono<AppEnv>();

async function limited(limiter: RateLimit, key: string): Promise<boolean> {
  try {
    const { success } = await limiter.limit({ key });
    return !success;
  } catch (err) {
    // Fail open on limiter outages: Turnstile and the team key still apply.
    console.error('Rate limiter unavailable', { name: (err as Error).name });
    return false;
  }
}

function configured(c: ApiContext): ConfiguredEnv | null {
  return isConfigured(c.env) ? c.env : null;
}

const requireTeamSession = async (c: ApiContext, next: Next) => {
  const env = configured(c);
  if (!env) return apiError('not_configured');
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer ([A-Za-z0-9_.-]{1,512})$/.exec(header);
  if (!match?.[1] || !(await verifyTeamSession(env, match[1], Date.now()))) {
    return apiError('unauthorized');
  }
  await next();
  return undefined;
};

api.get('/health', () => apiOk({ status: 'ok' }));

api.get('/config', (c) => {
  const env = configured(c);
  if (!env) return apiError('not_configured');
  return apiOk({ turnstileSiteKey: env.TURNSTILE_SITE_KEY });
});

api.post('/session', async (c) => {
  const env = configured(c);
  if (!env) return apiError('not_configured');
  if (await limited(env.SESSION_LIMITER, `session:${clientIp(c.req.raw)}`)) {
    return apiError('rate_limited');
  }
  const body = sessionRequest.safeParse(await readJson(c.req.raw));
  if (!body.success) return apiError('bad_request');
  if (!(await teamKeyMatches(env, body.data.teamKey))) return apiError('wrong_team_key');
  return apiOk(await issueTeamSession(env, Date.now()));
});

api.post('/rooms', requireTeamSession, async (c) => {
  const env = c.env as ConfiguredEnv;
  const ip = clientIp(c.req.raw);
  if (await limited(env.CREATE_LIMITER, `create:${ip}`)) return apiError('rate_limited');
  const body = createRoomRequest.safeParse(await readJson(c.req.raw));
  if (!body.success) return apiError('bad_request');

  const strict = env.ENVIRONMENT === 'staging' || env.ENVIRONMENT === 'production';
  const human = await verifyTurnstile({
    secret: env.TURNSTILE_SECRET_KEY,
    token: body.data.turnstileToken,
    remoteIp: ip === 'unknown' ? null : ip,
    expectedHostname: strict ? new URL(c.req.url).hostname : null,
  });
  if (!human) return apiError('bot_check_failed');

  const menu = await presetMenu(env.DB, body.data.presetId);
  if (!menu) return apiError('preset_not_found');

  // A code collision with a live room is astronomically rare; retry anyway.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const result = await env.ROOMS.get(env.ROOMS.idFromName(code)).init(code, body.data.name, menu);
    if (result.ok) {
      // Only so the admin can list and close it; a room works without it.
      c.executionCtx.waitUntil(
        registerRoom(env.DB, code, result.createdAt, result.expiresAt).catch((err: unknown) =>
          console.error('Could not register room', { name: (err as Error).name }),
        ),
      );
      return apiOk({ code, participantId: result.participantId, token: result.token }, 201);
    }
    if (result.error === 'invalid_name') return apiError('invalid_name');
  }
  console.error('Could not allocate a room code');
  return apiError('server_error');
});

/** The presets a host can start a room with (names only). */
api.get('/presets', requireTeamSession, async (c) => {
  return apiOk({ presets: await presetSummaries(c.env.DB) });
});

api.post('/rooms/:code/join', requireTeamSession, async (c) => {
  const env = c.env as ConfiguredEnv;
  if (await limited(env.JOIN_LIMITER, `join:${clientIp(c.req.raw)}`)) {
    return apiError('rate_limited');
  }
  const code = normalizeRoomCode(c.req.param('code') ?? '');
  if (!code) return apiError('room_not_found');
  const body = joinRoomRequest.safeParse(await readJson(c.req.raw));
  if (!body.success) return apiError('bad_request');

  const result = await env.ROOMS.get(env.ROOMS.idFromName(code)).join(body.data.name);
  if (!result.ok) return apiError(result.error);
  return apiOk({ code, participantId: result.participantId, token: result.token }, 201);
});

/**
 * WebSocket upgrade. Checked here, before anything reaches a room:
 * same-origin (no cross-site WebSocket hijacking), a rate limit, a valid
 * code, and the team session, offered as the subprotocol "team.<token>"
 * because browsers cannot set headers on a WebSocket. Without a team session
 * nobody can even learn whether a room code exists. The participant itself
 * then authenticates with its own token in the first message (see Room).
 */
api.get('/rooms/:code/ws', async (c) => {
  const env = configured(c);
  if (!env) return apiError('not_configured');
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Verwacht WebSocket', { status: 426 });
  }
  const origin = c.req.header('Origin');
  if (!origin || origin !== new URL(c.req.url).origin) {
    return new Response('Verboden', { status: 403 });
  }
  if (await limited(env.WS_LIMITER, `ws:${clientIp(c.req.raw)}`)) {
    return apiError('rate_limited');
  }
  const offered = (c.req.header('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
  const teamToken = offered.find((p) => p.startsWith(WS_TEAM_PREFIX))?.slice(WS_TEAM_PREFIX.length);
  if (
    !offered.includes(WS_PROTOCOL) ||
    !teamToken ||
    !(await verifyTeamSession(env, teamToken, Date.now()))
  ) {
    return apiError('unauthorized');
  }
  const code = normalizeRoomCode(c.req.param('code') ?? '');
  if (!code) return apiError('room_not_found');
  // Forward without the session token: the room does not need it.
  const headers = new Headers(c.req.raw.headers);
  headers.set('Sec-WebSocket-Protocol', WS_PROTOCOL);
  const forwarded = new Request(c.req.raw, { headers });
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(forwarded);
});

api.all('*', () => apiError('not_found'));
