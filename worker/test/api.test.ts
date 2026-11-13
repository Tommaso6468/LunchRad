import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  call,
  createRoom,
  jsonInit,
  joinRoom,
  makeEnv,
  mockTurnstile,
  openSocket,
  teamToken,
} from './helpers.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('configuration', () => {
  it('serves the public Turnstile site key', async () => {
    const res = await call('/api/config');
    expect(await res.json()).toEqual({ turnstileSiteKey: '1x00000000000000000000AA' });
  });

  it('fails closed with 503 when a secret is missing or too weak', async () => {
    for (const env of [
      makeEnv({ TEAM_KEY: undefined }),
      makeEnv({ SESSION_SECRET: 'short' }),
      makeEnv({ TURNSTILE_SECRET_KEY: '' }),
    ]) {
      const res = await call('/api/session', jsonInit({ teamKey: 'test-team-key' }), env);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'not_configured' });
    }
  });
});

describe('POST /api/session (team key)', () => {
  it('returns a session token for the right key', async () => {
    const res = await call('/api/session', jsonInit({ teamKey: 'test-team-key' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(body.token).toMatch(/^[\w-]+\.[\w-]+$/);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects a wrong key', async () => {
    const res = await call('/api/session', jsonInit({ teamKey: 'wrong' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'wrong_team_key' });
  });

  it('rate limits guessing per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await call(
        '/api/session',
        jsonInit({ teamKey: `guess-${i}` }, { ip: '203.0.113.7' }),
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });

  it('rejects malformed bodies', async () => {
    const cases: RequestInit[] = [
      {
        method: 'POST',
        body: 'teamKey=x',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
      { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } },
      jsonInit({ teamKey: 'test-team-key', extra: true }),
      jsonInit({ teamKey: 'x'.repeat(5000) }),
      jsonInit([]),
    ];
    for (const init of cases) {
      expect((await call('/api/session', init)).status).toBe(400);
    }
  });
});

describe('team session tokens', () => {
  const createWith = (token: string) =>
    call(
      '/api/rooms',
      jsonInit(
        { name: 'A', turnstileToken: 't' },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );

  it('are required for room endpoints', async () => {
    expect((await call('/api/rooms', jsonInit({ name: 'A', turnstileToken: 't' }))).status).toBe(
      401,
    );
    expect((await joinRoom('K7Q4M0', 'A', 'garbage')).status).toBe(401);
  });

  it('cannot be tampered with', async () => {
    const token = await teamToken();
    const [payload, signature] = token.split('.') as [string, string];
    const forged = btoa(JSON.stringify({ v: 1, kf: 'x', exp: 9e15 })).replace(/=+$/, '');
    for (const bad of [
      `${forged}.${signature}`,
      `${payload}.${signature.slice(0, -2)}AA`,
      `${payload}`,
    ]) {
      expect((await createWith(bad)).status).toBe(401);
    }
  });

  it('become invalid when the team key is rotated', async () => {
    mockTurnstile();
    const token = await teamToken();
    const rotated = makeEnv({ TEAM_KEY: 'a-new-team-key' });
    const res = await call(
      '/api/rooms',
      jsonInit(
        { name: 'A', turnstileToken: 't' },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
      rotated,
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /api/rooms', () => {
  it('creates a room after a passing bot check', async () => {
    const spy = mockTurnstile();
    const creds = await createRoom('Sanne');
    expect(creds.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(creds.participantId).toMatch(/^[a-f0-9]{16}$/);
    expect(creds.token).toHaveLength(43);
    const sent = spy.mock.calls[0]?.[1]?.body as FormData;
    expect(sent.get('secret')).toBe('1x0000000000000000000000000000000AA');
    expect(sent.get('response')).toBe('XXXX.DUMMY.TOKEN');
  });

  it('refuses when the bot check fails or cannot be reached', async () => {
    const token = await teamToken();
    const tryCreate = () =>
      call(
        '/api/rooms',
        jsonInit(
          { name: 'A', turnstileToken: 't' },
          { headers: { Authorization: `Bearer ${token}` } },
        ),
      );

    mockTurnstile({ success: false, 'error-codes': ['invalid-input-response'] });
    expect((await tryCreate()).status).toBe(403);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    expect((await tryCreate()).status).toBe(403);
  });

  it('checks hostname and action with real keys (staging/production)', async () => {
    const token = await teamToken();
    const staging = makeEnv({ ENVIRONMENT: 'staging' });
    const tryCreate = () =>
      call(
        '/api/rooms',
        jsonInit(
          { name: 'A', turnstileToken: 't' },
          { headers: { Authorization: `Bearer ${token}` } },
        ),
        staging,
      );
    mockTurnstile({ success: true, hostname: 'evil.example', action: 'create-room' });
    expect((await tryCreate()).status).toBe(403);
    vi.restoreAllMocks();
    mockTurnstile({ success: true, hostname: 'lunchrad.test', action: 'other' });
    expect((await tryCreate()).status).toBe(403);
    vi.restoreAllMocks();
    mockTurnstile({ success: true, hostname: 'lunchrad.test', action: 'create-room' });
    expect((await tryCreate()).status).toBe(201);
  });

  it('rejects invalid host names', async () => {
    mockTurnstile();
    const token = await teamToken();
    const res = await call(
      '/api/rooms',
      jsonInit(
        { name: '<img src=x>', turnstileToken: 't' },
        { headers: { Authorization: `Bearer ${token}` } },
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_name' });
  });

  it('rate limits room creation per IP', async () => {
    mockTurnstile();
    const token = await teamToken();
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await call(
        '/api/rooms',
        jsonInit(
          { name: 'A', turnstileToken: 't' },
          { ip: '203.0.113.99', headers: { Authorization: `Bearer ${token}` } },
        ),
      );
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);
  });
});

describe('POST /api/rooms/:code/join', () => {
  it('joins with a unique name and normalises the code', async () => {
    mockTurnstile();
    const host = await createRoom('Host');
    const res = await joinRoom(host.code.toLowerCase(), 'Tom');
    expect(res.status).toBe(201);
    expect(((await res.json()) as { code: string }).code).toBe(host.code);
  });

  it('rejects duplicate names case-insensitively', async () => {
    mockTurnstile();
    const host = await createRoom('Sanne');
    const res = await joinRoom(host.code, 'sanne');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'name_taken' });
  });

  it('returns 404 for unknown or malformed codes', async () => {
    expect((await joinRoom('ZZZZZZ', 'Tom')).status).toBe(404);
    expect((await joinRoom('K7Q%3C4', 'Tom')).status).toBe(404);
    // Path traversal is resolved by URL parsing and never reaches a room.
    expect((await joinRoom('../../x', 'Tom')).status).not.toBe(201);
  });

  it('caps a room at 20 participants', async () => {
    mockTurnstile();
    const team = await teamToken();
    const host = await createRoom('P0', team);
    for (let i = 1; i < 20; i++) {
      expect((await joinRoom(host.code, `P${i}`, team)).status).toBe(201);
    }
    const res = await joinRoom(host.code, 'P20', team);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'room_full' });
  });
});

describe('GET /api/rooms/:code/ws', () => {
  it('requires a same-origin Origin header (no cross-site WebSocket hijacking)', async () => {
    mockTurnstile();
    const host = await createRoom();
    for (const origin of [null, 'https://evil.example', 'http://lunchrad.test']) {
      await expect(openSocket(host.code, origin)).rejects.toThrow(/upgrade failed: 403/);
    }
  });

  it('requires an Upgrade header', async () => {
    expect(
      (await call('/api/rooms/K7Q4M0/ws', { headers: { Origin: 'https://lunchrad.test' } })).status,
    ).toBe(426);
  });

  it('returns 404 for rooms that do not exist', async () => {
    await expect(openSocket('ZZZZZZ')).rejects.toThrow(/upgrade failed: 404/);
  });
});

describe('WebSocket team session', () => {
  it('is required: without it, nobody can even tell whether a room exists', async () => {
    mockTurnstile();
    const host = await createRoom();
    for (const code of [host.code, 'ZZZZZZ']) {
      await expect(openSocket(code, undefined, null)).rejects.toThrow(/upgrade failed: 401/);
      await expect(openSocket(code, undefined, 'forged.token')).rejects.toThrow(
        /upgrade failed: 401/,
      );
    }
  });

  it('selects the lunchrad subprotocol and never echoes the session token', async () => {
    mockTurnstile();
    const host = await createRoom();
    const team = await teamToken();
    const res = await call(`/api/rooms/${host.code}/ws`, {
      headers: {
        Upgrade: 'websocket',
        Origin: 'https://lunchrad.test',
        'Sec-WebSocket-Protocol': `lunchrad.v1, team.${team}`,
      },
    });
    expect(res.status).toBe(101);
    expect(res.headers.get('Sec-WebSocket-Protocol')).toBe('lunchrad.v1');
    res.webSocket?.accept();
    res.webSocket?.close(1000);
  });
});
