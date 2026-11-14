import type { AdminOverview, AuditPage } from '@lunchrad/shared';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN,
  adminCall,
  adminJson,
  makeKeys,
  mockAccessKeys,
  signJwt,
  type Keys,
} from './access-helpers.ts';
import { call, connectAs, createRoom, jsonInit, makeEnv, teamToken } from './helpers.ts';

let keys: Keys;
let token: string;

beforeAll(async () => {
  keys = await makeKeys();
});
beforeEach(async () => {
  mockAccessKeys(keys);
  token = await signJwt(keys);
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function overview(): Promise<AdminOverview> {
  const res = await adminCall(token, '/overview');
  expect(res.status).toBe(200);
  return (await res.json()) as AdminOverview;
}

async function audit(): Promise<AuditPage> {
  return (await (await adminCall(token, '/audit')).json()) as AuditPage;
}

describe('admin authentication', () => {
  it('lets a valid Access token for an allowed email in', async () => {
    const body = await overview();
    expect(body.email).toBe(ADMIN);
    expect(body.presets.some((p) => p.isDefault)).toBe(true);
  });

  it('refuses a request without the Access header (Access bypassed or misconfigured)', async () => {
    expect((await adminCall(null, '/overview')).status).toBe(401);
  });

  it('refuses forged and tampered tokens', async () => {
    const other = await makeKeys();
    const [head, body] = token.split('.');
    const forgedPayload = btoa(JSON.stringify({ email: 'x@example.com' }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const cases: Record<string, string> = {
      'signed with another key': await signJwt(other),
      'alg none': `${btoa('{"alg":"none","kid":"test-kid-1"}').replace(/=+$/, '')}.${body}.`,
      'alg HS256': await signJwt(keys, {}, { alg: 'HS256' }),
      'payload swapped': `${head}.${forgedPayload}.${token.split('.')[2]}`,
      'unknown kid': await signJwt(keys, {}, { kid: 'other' }),
      'wrong audience': await signJwt(keys, { aud: ['b'.repeat(64)] }),
      'wrong issuer': await signJwt(keys, { iss: 'https://evil.cloudflareaccess.com' }),
      expired: await signJwt(keys, { exp: Math.floor(Date.now() / 1000) - 3600 }),
      'not yet valid': await signJwt(keys, { nbf: Math.floor(Date.now() / 1000) + 3600 }),
      'email not on the list': await signJwt(keys, { email: 'collega@example.com' }),
      'no email': await signJwt(keys, { email: undefined }),
      garbage: 'not.a.jwt',
      'too long': 'a'.repeat(9000),
    };
    for (const [name, bad] of Object.entries(cases)) {
      expect((await adminCall(bad, '/overview')).status, name).toBe(401);
    }
  });

  it('matches the email allow-list case-insensitively and accepts a string audience', async () => {
    const t = await signJwt(keys, { email: 'Tweede@Example.com', aud: 'a'.repeat(64) });
    expect((await adminCall(t, '/overview')).status).toBe(200);
  });

  it('fails closed when Access is not configured', async () => {
    for (const overrides of [
      { ACCESS_AUD: undefined },
      { ACCESS_TEAM_DOMAIN: 'https://evil.example.com' },
      { ADMIN_EMAILS: '' },
    ]) {
      const res = await call(
        '/admin/api/overview',
        { headers: { 'Cf-Access-Jwt-Assertion': token } },
        makeEnv(overrides),
      );
      expect(res.status, JSON.stringify(overrides)).toBe(503);
    }
  });

  it('blocks cross-site changes even with a valid token', async () => {
    const add = { name: 'Csrf Café' };
    const evil = await adminJson(token, '/restaurants', add, 'POST', {
      origin: 'https://evil.example',
    });
    expect(evil.status).toBe(403);
    const noOrigin = await adminJson(token, '/restaurants', add, 'POST', { origin: null });
    expect(noOrigin.status).toBe(403);
    const noHeader = await adminJson(token, '/restaurants', add, 'POST', { adminHeader: false });
    expect(noHeader.status).toBe(403);
    const form = await adminCall(token, '/restaurants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'name=Csrf',
    });
    expect(form.status).toBe(400);
    expect((await overview()).restaurants.some((r) => r.name === 'Csrf Café')).toBe(false);
  });

  it('is never cached', async () => {
    const res = await adminCall(token, '/overview');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('restaurants', () => {
  it('creates, updates and deletes, each with an audit entry', async () => {
    const created = await adminJson(token, '/restaurants', {
      name: '  Pho  99 ',
      categories: 'Vietnamees, Soep',
      mapsUrl: 'https://maps.app.goo.gl/abc123',
    });
    expect(created.status).toBe(200);
    const pho = ((await created.json()) as AdminOverview).restaurants.find(
      (r) => r.name === 'Pho 99',
    );
    expect(pho).toMatchObject({ categories: ['Vietnamees', 'Soep'], presetIds: [] });
    if (!pho) throw new Error('missing');

    const updated = await adminJson(token, `/restaurants/${pho.id}`, { name: 'Pho 100' }, 'PATCH');
    const after = ((await updated.json()) as AdminOverview).restaurants.find(
      (r) => r.id === pho.id,
    );
    expect(after).toMatchObject({ name: 'Pho 100', categories: [], mapsUrl: null });

    expect((await adminCall(token, `/restaurants/${pho.id}`, { method: 'DELETE' })).status).toBe(
      200,
    );
    expect((await overview()).restaurants.some((r) => r.id === pho.id)).toBe(false);

    const actions = (await audit()).entries
      .filter((e) => e.entityId === pho.id)
      .map((e) => [e.action, e.adminEmail]);
    expect(actions).toEqual([
      ['delete', ADMIN],
      ['update', ADMIN],
      ['create', ADMIN],
    ]);
  });

  it('applies the same rules as rooms', async () => {
    const cases: [unknown, string][] = [
      [{ name: '<img src=x onerror=alert(1)>' }, 'invalid_restaurant'],
      [{ name: '' }, 'bad_request'],
      [{ name: 'Ok', categories: ['a', 'b', 'c', 'd'] }, 'invalid_category'],
      [{ name: 'Ok', mapsUrl: 'https://evil.example/maps' }, 'invalid_maps_url'],
      [{ name: 'Ok', mapsUrl: 'javascript:alert(1)' }, 'invalid_maps_url'],
      [{ name: 'Ok', extra: true }, 'bad_request'],
      [{ name: 'dikke MIK' }, 'restaurant_exists'],
    ];
    for (const [input, error] of cases) {
      const res = await adminJson(token, '/restaurants', input);
      expect(await res.json(), JSON.stringify(input)).toEqual({ error });
    }
  });

  it('answers 404 for unknown or malformed ids', async () => {
    expect(
      (await adminJson(token, '/restaurants/ffffffffffffffff', { name: 'X' }, 'PATCH')).status,
    ).toBe(404);
    expect((await adminCall(token, "/restaurants/1' OR '1'='1", { method: 'DELETE' })).status).toBe(
      404,
    );
  });
});

describe('presets', () => {
  it('creates a preset, fills it, makes it the default, and new rooms start with it', async () => {
    const before = await overview();
    const created = (await (
      await adminJson(token, '/presets', { name: 'Vrijdag' })
    ).json()) as AdminOverview;
    const vrijdag = created.presets.find((p) => p.name === 'Vrijdag');
    if (!vrijdag) throw new Error('missing');
    expect(vrijdag.isDefault).toBe(false);

    const ids = before.restaurants
      .slice(0, 2)
      .map((r) => r.id)
      .reverse();
    const filled = await adminJson(
      token,
      `/presets/${vrijdag.id}/restaurants`,
      { restaurantIds: ids },
      'PUT',
    );
    expect(
      ((await filled.json()) as AdminOverview).presets.find((p) => p.id === vrijdag.id)
        ?.restaurantIds,
    ).toEqual(ids);

    const made = await adminCall(token, `/presets/${vrijdag.id}/default`, { method: 'POST' });
    const presets = ((await made.json()) as AdminOverview).presets;
    expect(presets.filter((p) => p.isDefault).map((p) => p.id)).toEqual([vrijdag.id]);

    const host = await createRoom('Sanne');
    const socket = await connectAs(host);
    const state = await socket.stateWhere(() => true);
    const names = ids.map((id) => before.restaurants.find((r) => r.id === id)?.name);
    expect(state.restaurants.map((r) => r.name)).toEqual(names);

    // Put the original default back for other tests.
    const original = before.presets.find((p) => p.isDefault);
    if (original) await adminCall(token, `/presets/${original.id}/default`, { method: 'POST' });
  });

  it('a host can pick a preset; an unknown preset is refused', async () => {
    const created = (await (
      await adminJson(token, '/presets', { name: 'Leeg' })
    ).json()) as AdminOverview;
    const leeg = created.presets.find((p) => p.name === 'Leeg');
    if (!leeg) throw new Error('missing');

    const team = await teamToken();
    const list = await call('/api/presets', { headers: { Authorization: `Bearer ${team}` } });
    const presets = ((await list.json()) as { presets: { id: string; count: number }[] }).presets;
    expect(presets.find((p) => p.id === leeg.id)?.count).toBe(0);
    expect((await call('/api/presets')).status).toBe(401);

    const res = await call(
      '/api/rooms',
      jsonInit(
        { name: 'Sanne', turnstileToken: 'XXXX.DUMMY', presetId: leeg.id },
        { headers: { Authorization: `Bearer ${team}` } },
      ),
    );
    expect(res.status).toBe(201);
    const creds = (await res.json()) as { code: string; participantId: string; token: string };
    const state = await (await connectAs(creds)).stateWhere(() => true);
    expect(state.restaurants).toEqual([]);

    const unknown = await call(
      '/api/rooms',
      jsonInit(
        { name: 'Sanne', turnstileToken: 'XXXX.DUMMY', presetId: 'f'.repeat(16) },
        { headers: { Authorization: `Bearer ${team}` } },
      ),
    );
    expect(await unknown.json()).toEqual({ error: 'preset_not_found' });
  });

  it('refuses deleting the default preset, unknown restaurants and oversized presets', async () => {
    const { presets, restaurants } = await overview();
    const def = presets.find((p) => p.isDefault);
    if (!def) throw new Error('no default');
    expect(
      await (await adminCall(token, `/presets/${def.id}`, { method: 'DELETE' })).json(),
    ).toEqual({
      error: 'default_preset',
    });
    const unknown = await adminJson(
      token,
      `/presets/${def.id}/restaurants`,
      { restaurantIds: ['f'.repeat(16)] },
      'PUT',
    );
    expect(unknown.status).toBe(404);
    const tooMany = await adminJson(
      token,
      `/presets/${def.id}/restaurants`,
      { restaurantIds: Array.from({ length: 31 }, () => restaurants[0]?.id) },
      'PUT',
    );
    expect(tooMany.status).toBe(400);
    expect((await adminJson(token, '/presets', { name: def.name.toUpperCase() })).status).toBe(409);
  });

  it('deleting a restaurant removes it from presets, not from open rooms', async () => {
    const add = (await (
      await adminJson(token, '/restaurants', { name: 'Tijdelijk' })
    ).json()) as AdminOverview;
    const tijdelijk = add.restaurants.find((r) => r.name === 'Tijdelijk');
    const def = add.presets.find((p) => p.isDefault);
    if (!tijdelijk || !def) throw new Error('missing');
    await adminJson(
      token,
      `/presets/${def.id}/restaurants`,
      { restaurantIds: [...def.restaurantIds, tijdelijk.id] },
      'PUT',
    );

    const host = await createRoom('Sanne');
    const socket = await connectAs(host);
    expect((await socket.stateWhere(() => true)).restaurants.map((r) => r.name)).toContain(
      'Tijdelijk',
    );

    await adminCall(token, `/restaurants/${tijdelijk.id}`, { method: 'DELETE' });
    expect((await overview()).presets.find((p) => p.id === def.id)?.restaurantIds).toEqual(
      def.restaurantIds,
    );
    const again = await connectAs(host);
    expect((await again.stateWhere(() => true)).restaurants.map((r) => r.name)).toContain(
      'Tijdelijk',
    );
  });
});

describe('rooms', () => {
  it('lists open rooms and closes one for everyone', async () => {
    const host = await createRoom('Sanne');
    const socket = await connectAs(host);
    await socket.stateWhere(() => true);

    const list = (await (await adminCall(token, '/rooms')).json()) as {
      rooms: { code: string; participants: number; connected: number; phase: string }[];
    };
    expect(list.rooms.find((r) => r.code === host.code)).toMatchObject({
      participants: 1,
      connected: 1,
      phase: 'lobby',
    });

    const closed = await adminCall(token, `/rooms/${host.code}/close`, { method: 'POST' });
    expect(closed.status).toBe(200);
    const msg = await socket.next('closed');
    expect(msg.reason).toBe('closed_by_admin');

    const after = (await (await adminCall(token, '/rooms')).json()) as {
      rooms: { code: string }[];
    };
    expect(after.rooms.some((r) => r.code === host.code)).toBe(false);
    expect((await adminCall(token, `/rooms/${host.code}/close`, { method: 'POST' })).status).toBe(
      404,
    );
    expect((await audit()).entries[0]).toMatchObject({
      action: 'close',
      entity: 'room',
      entityId: host.code,
    });
  });
});

describe('team key', () => {
  it('rotation returns a strong key once, logs out every device, and never logs the key', async () => {
    const old = await teamToken();
    const res = await adminCall(token, '/team-key/rotate', { method: 'POST' });
    const { teamKey } = (await res.json()) as { teamKey: string };
    expect(teamKey).toMatch(/^[a-z0-9]{5}(-[a-z0-9]{5}){3}$/);

    // Old sessions and the old key stop working.
    expect(
      (await call('/api/presets', { headers: { Authorization: `Bearer ${old}` } })).status,
    ).toBe(401);
    expect((await call('/api/session', jsonInit({ teamKey: 'test-team-key' }))).status).toBe(401);
    // The new key works, also typed with a capital first letter and spaces.
    const typed = ` ${teamKey[0]?.toUpperCase()}${teamKey.slice(1)} `;
    expect((await call('/api/session', jsonInit({ teamKey: typed }))).status).toBe(200);

    const status = (await (await adminCall(token, '/team-key')).json()) as {
      source: string;
      rotatedBy: string;
    };
    expect(status).toMatchObject({ source: 'admin', rotatedBy: ADMIN });

    const entry = (await audit()).entries[0];
    expect(entry).toMatchObject({ action: 'rotate', entity: 'team_key' });
    expect(JSON.stringify(entry)).not.toContain(teamKey);
    const { results } = await (env as unknown as { DB: D1Database }).DB.prepare(
      'SELECT * FROM team_key',
    ).all();
    expect(JSON.stringify(results)).not.toContain(teamKey);

    // Back to the secret for other tests.
    await (env as unknown as { DB: D1Database }).DB.prepare('DELETE FROM team_key').run();
  });
});

describe('own team key', () => {
  const db = () => (env as unknown as { DB: D1Database }).DB;

  it('accepts a long enough key, matched without case or extra spaces', async () => {
    const res = await adminJson(token, '/team-key/rotate', { teamKey: '  Kroket Fiets  Wolk ' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { teamKey: string }).teamKey).toBe('kroket fiets wolk');
    expect((await call('/api/session', jsonInit({ teamKey: 'KROKET fiets wolk' }))).status).toBe(
      200,
    );
    expect((await call('/api/session', jsonInit({ teamKey: 'kroket fiets' }))).status).toBe(401);

    const entry = (await audit()).entries[0];
    expect(entry).toMatchObject({ action: 'rotate', detail: { chosen: 'custom' } });
    expect(JSON.stringify(entry)).not.toContain('kroket');
    expect(
      JSON.stringify((await db().prepare('SELECT * FROM team_key').all()).results),
    ).not.toContain('kroket');
    await db().prepare('DELETE FROM team_key').run();
  });

  it('refuses weak keys and leaves the current key in place', async () => {
    for (const weak of [
      'kort',
      'aaaaaaaaaaaaaaaa',
      '123412341234',
      '1234 5678 9012',
      'x'.repeat(65),
    ]) {
      const res = await adminJson(token, '/team-key/rotate', { teamKey: weak });
      expect(await res.json(), weak).toEqual({ error: 'weak_team_key' });
    }
    expect((await adminJson(token, '/team-key/rotate', { teamKey: 1 })).status).toBe(400);
    expect((await adminJson(token, '/team-key/rotate', { key: 'kroket fiets wolk' })).status).toBe(
      400,
    );
    expect((await call('/api/session', jsonInit({ teamKey: 'test-team-key' }))).status).toBe(200);
  });
});

describe('audit log', () => {
  it('pages backwards and rejects bad cursors', async () => {
    for (let i = 0; i < 3; i++) await adminJson(token, '/restaurants', { name: `Pagina ${i}` });
    const first = await audit();
    expect(first.entries.length).toBeGreaterThanOrEqual(3);
    const ids = first.entries.map((e) => e.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);
    expect((await adminCall(token, '/audit?before=abc')).status).toBe(400);
    expect((await adminCall(token, '/audit?before=-1')).status).toBe(400);
  });
});
