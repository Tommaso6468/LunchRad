import { LIMITS, type RoomState } from '@lunchrad/shared';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../src/room.ts';
import { adminCall, makeKeys, mockAccessKeys, signJwt, type Keys } from './access-helpers.ts';
import {
  call,
  connectAs,
  createRoom,
  joinRoom,
  roomStub,
  teamToken,
  type Creds,
  type TestSocket,
} from './helpers.ts';

const db = () => (env as unknown as { DB: D1Database }).DB;
let keys: Keys;

beforeAll(async () => {
  keys = await makeKeys();
});
beforeEach(async () => {
  mockAccessKeys(keys);
  await db().prepare('DELETE FROM lunch_history').run();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function addHistory(name: string, ref: string): Promise<void> {
  await db()
    .prepare(
      "INSERT INTO lunch_history (room_ref, decided_at, name, name_key, categories) VALUES (?, ?, ?, ?, '[]')",
    )
    .bind(ref, Date.now(), name, name.toLocaleLowerCase('nl'))
    .run();
}

async function room(): Promise<{ host: Creds; hostSocket: TestSocket; tomSocket: TestSocket }> {
  const host = await createRoom('Sanne');
  const res = await joinRoom(host.code, 'Tom');
  const tom = (await res.json()) as Creds;
  const hostSocket = await connectAs(host);
  const tomSocket = await connectAs(tom);
  await tomSocket.stateWhere(() => true);
  return { host, hostSocket, tomSocket };
}

async function advance(code: string, ms: number): Promise<void> {
  const stub = roomStub(code);
  await runInDurableObject(stub, (r: Room) => {
    const base = r.now();
    r.now = () => base + ms;
  });
  await runDurableObjectAlarm(stub);
}

describe('visited restaurants', () => {
  it('marks restaurants the team ended up at before, also ones added in the room', async () => {
    await addHistory('Bibimbap', 'a'.repeat(16));
    await addHistory('Pho 99', 'b'.repeat(16));
    const { hostSocket } = await room();
    const state = await hostSocket.stateWhere(() => true);
    const visited = state.restaurants.filter((r) => r.visited).map((r) => r.name);
    expect(visited).toEqual(['Bibimbap']);
    hostSocket.send({ type: 'add_restaurant', name: 'PHO 99' });
    const after = await hostSocket.stateWhere((s) =>
      s.restaurants.some((r) => r.name === 'PHO 99'),
    );
    expect(after.restaurants.find((r) => r.name === 'PHO 99')?.visited).toBe(true);
  });
});

describe('new-place mode', () => {
  it('is for the host only, before the spin, and announced to everyone', async () => {
    const { hostSocket, tomSocket } = await room();
    tomSocket.send({ type: 'set_new_place', on: true });
    expect((await tomSocket.next('error')).error).toBe('not_host');
    tomSocket.send({ type: 'set_new_place', on: 'yes' });
    expect((await tomSocket.next('error')).error).toBe('bad_message');

    hostSocket.send({ type: 'set_new_place', on: true });
    expect(await tomSocket.eventWhere((e) => e.type === 'new_place_changed')).toEqual({
      type: 'new_place_changed',
      on: true,
    });
    await tomSocket.stateWhere((s) => s.newPlace);

    hostSocket.send({ type: 'start_spin' });
    await hostSocket.stateWhere((s) => s.phase === 'spinning');
    hostSocket.send({ type: 'set_new_place', on: false });
    expect((await hostSocket.next('error')).error).toBe('locked');
  });

  it('gives every restaurant that never won one extra slice on the reel', async () => {
    await addHistory('Bibimbap', 'c'.repeat(16));
    const { hostSocket } = await room();
    hostSocket.send({ type: 'set_new_place', on: true });
    const state = await hostSocket.stateWhere((s) => s.newPlace);
    hostSocket.send({ type: 'start_spin' });
    const spun = await hostSocket.stateWhere((s: RoomState) => s.phase === 'spinning');
    const reel = spun.spin?.reel ?? [];
    for (const r of state.restaurants) {
      const expected = r.visited ? 1 : 1 + LIMITS.newPlaceSlices;
      expect(reel.filter((id) => id === r.id).length, r.name).toBe(expected);
    }
  });
});

describe('lunch history', () => {
  it('records the final winner once, with no names of people', async () => {
    const { host, hostSocket } = await room();
    hostSocket.send({ type: 'start_spin' });
    const spinning = await hostSocket.stateWhere((s) => s.phase === 'spinning');
    await advance(host.code, LIMITS.spinDurationMs + 10);
    await hostSocket.stateWhere((s) => s.phase === 'voting');
    hostSocket.send({ type: 'vote', choice: 'no' });
    await advance(host.code, LIMITS.voteDurationMs + 10);
    await hostSocket.stateWhere((s) => s.phase === 'result');
    // An alarm that runs again must not write a second row.
    await runDurableObjectAlarm(roomStub(host.code));

    const { results } = await db().prepare('SELECT * FROM lunch_history').all();
    expect(results).toHaveLength(1);
    const winner = spinning.restaurants.find((r) => r.id === spinning.spin?.winnerId);
    expect(results[0]).toMatchObject({ name: winner?.name, respins: 0, new_place: 0 });
    expect(JSON.stringify(results)).not.toMatch(/Sanne|Tom/);

    const team = await teamToken();
    const stats = (await (
      await call('/api/stats', { headers: { Authorization: `Bearer ${team}` } })
    ).json()) as { total: number; top: { name: string; count: number }[] };
    expect(stats.total).toBe(1);
    expect(stats.top[0]).toMatchObject({ name: winner?.name, count: 1 });
    expect((await call('/api/stats')).status).toBe(401);
  });

  it('admins can delete one entry or everything, both audited', async () => {
    await addHistory('Bibimbap', 'd'.repeat(16));
    await addHistory('Zino', 'e'.repeat(16));
    const token = await signJwt(keys);
    const page = (await (await adminCall(token, '/history')).json()) as {
      entries: { id: number; name: string }[];
    };
    expect(page.entries.map((e) => e.name)).toEqual(['Zino', 'Bibimbap']);
    const first = page.entries[1];
    if (!first) throw new Error('missing');

    expect((await adminCall(token, `/history/${first.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await adminCall(token, `/history/${first.id}`, { method: 'DELETE' })).status).toBe(404);
    expect((await adminCall(token, '/history/1;DROP', { method: 'DELETE' })).status).toBe(404);
    // Changes need the admin header and origin like every other change.
    expect(
      (await adminCall(token, '/history', { method: 'DELETE', adminHeader: false })).status,
    ).toBe(403);
    expect((await adminCall(token, '/history', { method: 'DELETE' })).status).toBe(200);
    expect((await db().prepare('SELECT count(*) AS n FROM lunch_history').first())?.['n']).toBe(0);

    const audit = (await (await adminCall(token, '/audit')).json()) as {
      entries: { action: string; entity: string }[];
    };
    expect(audit.entries.slice(0, 2).map((e) => `${e.entity}:${e.action}`)).toEqual([
      'history:clear',
      'history:delete',
    ]);
    expect((await adminCall(null, '/history')).status).toBe(401);
  });
});
