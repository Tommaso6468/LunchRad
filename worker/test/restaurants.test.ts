import {
  LIMITS,
  normalizeCategories,
  normalizeMapsUrl,
  normalizeRestaurantName,
} from '@lunchrad/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import {
  connectAs,
  createRoom,
  joinRoom,
  mockTurnstile,
  type Creds,
  type TestSocket,
} from './helpers.ts';

beforeEach(() => {
  mockTurnstile();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function join(code: string, name: string): Promise<Creds> {
  const res = await joinRoom(code, name);
  expect(res.status).toBe(201);
  return (await res.json()) as Creds;
}

async function add(socket: TestSocket, name: string, extra: Record<string, unknown> = {}) {
  socket.send({ type: 'add_restaurant', name, ...extra });
  const stored = normalizeRestaurantName(name);
  const state = await socket.stateWhere((s) => s.restaurants.some((r) => r.name === stored));
  const restaurant = state.restaurants.find((r) => r.name === stored);
  if (!restaurant) throw new Error('not added');
  return restaurant;
}

/** Two participants in one room: the host and Tom, both connected. */
async function room() {
  const host = await createRoom('Sanne');
  const tom = await join(host.code, 'Tom');
  const hostSocket = await connectAs(host);
  const tomSocket = await connectAs(tom);
  return { host, tom, hostSocket, tomSocket };
}

interface SeedRow {
  name: string;
  categories: string;
  maps_url: string | null;
}

/** The default preset straight from D1 (migration 0002), in wheel order. */
async function defaultPreset(): Promise<
  { name: string; categories: string[]; mapsUrl: string | null }[]
> {
  const { results } = await (env as unknown as { DB: D1Database }).DB.prepare(
    `SELECT r.name, r.categories, r.maps_url FROM preset p
       JOIN preset_restaurant pr ON pr.preset_id = p.id
       JOIN restaurant r ON r.id = pr.restaurant_id
      WHERE p.is_default = 1 ORDER BY pr.position`,
  ).all<SeedRow>();
  return results.map((r) => ({
    name: r.name,
    categories: JSON.parse(r.categories) as string[],
    mapsUrl: r.maps_url,
  }));
}

describe('seed preset (migration)', () => {
  it('only contains entries that pass the restaurant rules', async () => {
    const seed = await defaultPreset();
    expect(seed.length).toBeGreaterThanOrEqual(2);
    expect(seed.length).toBeLessThanOrEqual(LIMITS.maxRestaurants);
    for (const r of seed) {
      expect(normalizeRestaurantName(r.name), r.name).toBe(r.name);
      expect(normalizeCategories(r.categories), r.name).toEqual(r.categories);
      expect(normalizeMapsUrl(r.mapsUrl), r.name).toBe(r.mapsUrl);
    }
  });
});

describe('new rooms', () => {
  it('start with the default preset, in order, as preset entries', async () => {
    const seed = await defaultPreset();
    const host = await createRoom('Sanne');
    const socket = await connectAs(host);
    const state = (socket.messages[0] as { state: { restaurants: unknown[] } }).state;
    expect(state.restaurants).toEqual(
      seed.map((r) => ({
        id: expect.stringMatching(/^[a-f0-9]{16}$/),
        name: r.name,
        categories: r.categories,
        mapsUrl: r.mapsUrl,
        addedBy: null,
      })),
    );
  });

  it('only the host can remove a preset restaurant, and only for this room', async () => {
    const { hostSocket, tomSocket, host } = await room();
    const first = (await tomSocket.stateWhere(() => true)).restaurants[0];
    if (!first) throw new Error('seed list is empty');
    tomSocket.send({ type: 'remove_restaurant', restaurantId: first.id });
    expect((await tomSocket.next('error')).error).toBe('not_allowed');
    hostSocket.send({ type: 'remove_restaurant', restaurantId: first.id });
    await tomSocket.stateWhere((s) => !s.restaurants.some((r) => r.id === first.id));

    const other = await connectAs(await createRoom('Mila'));
    const fresh = (other.messages[0] as { state: { restaurants: { name: string }[] } }).state;
    expect(fresh.restaurants.map((r) => r.name)).toContain(first.name);
    void host;
  });
});

describe('adding restaurants', () => {
  it('shows a new restaurant to everyone, with who added it', async () => {
    const { tom, hostSocket, tomSocket } = await room();
    const wok = await add(tomSocket, '  Wok   To Go ', {
      categories: ['Chinees', 'Noedels'],
      mapsUrl: 'https://maps.app.goo.gl/AbC123#frag',
    });
    expect(wok).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{16}$/),
      name: 'Wok To Go',
      categories: ['Chinees', 'Noedels'],
      mapsUrl: 'https://maps.app.goo.gl/AbC123',
      addedBy: tom.participantId,
    });
    const seen = await hostSocket.stateWhere((s) =>
      s.restaurants.some((r) => r.name === 'Wok To Go'),
    );
    expect(seen.restaurants.at(-1)?.name).toBe('Wok To Go');
    expect((await hostSocket.next('event')).event).toMatchObject({ type: 'restaurant_added' });
  });

  it('needs only a name', async () => {
    const { hostSocket } = await room();
    const r = await add(hostSocket, 'Bagels & Beans');
    expect(r.categories).toEqual([]);
    expect(r.mapsUrl).toBeNull();
  });

  it('rejects invalid names, categories and non-Google-Maps links', async () => {
    const { hostSocket } = await room();
    const cases: [Record<string, unknown>, string][] = [
      [{ name: '<img src=x onerror=alert(1)>' }, 'invalid_restaurant'],
      [{ name: 'Wok', categories: ['<b>'] }, 'invalid_category'],
      [{ name: 'Wok', categories: ['A', 'B', 'C', 'D'] }, 'invalid_category'],
      [{ name: 'Wok', mapsUrl: 'javascript:alert(1)' }, 'invalid_maps_url'],
      [{ name: 'Wok', mapsUrl: 'https://evil.example/maps' }, 'invalid_maps_url'],
    ];
    for (const [extra, error] of cases) {
      hostSocket.send({ type: 'add_restaurant', ...extra });
      expect((await hostSocket.next('error')).error, JSON.stringify(extra)).toBe(error);
    }
  });

  it('keeps names unique per room, case-insensitively', async () => {
    const { hostSocket, tomSocket } = await room();
    await add(hostSocket, 'Wok To Go');
    tomSocket.send({ type: 'add_restaurant', name: 'wok to go' });
    expect((await tomSocket.next('error')).error).toBe('restaurant_exists');
  });

  it('caps a room at 30 restaurants', async () => {
    const host = await createRoom('Sanne');
    const tom = await join(host.code, 'Tom');
    // Two sockets, so neither hits the per-socket message budget.
    const a = await connectAs(host);
    const b = await connectAs(tom);
    const start = (await a.stateWhere(() => true)).restaurants.length;
    for (let i = start; i < LIMITS.maxRestaurants; i++) {
      await add(i % 2 ? b : a, `Plek ${i}`);
      if (i % 15 === 14) await new Promise((r) => setTimeout(r, 0));
    }
    const c = await connectAs(host);
    c.send({ type: 'add_restaurant', name: 'Eén te veel' });
    expect((await c.next('error')).error).toBe('too_many_restaurants');
  }, 20_000);
});

describe('removing restaurants', () => {
  it('participants can remove only what they added; the host can remove anything', async () => {
    const { tom, hostSocket, tomSocket } = await room();
    const hostsPick = await add(hostSocket, 'Bagels & Beans');
    const tomsPick = await add(tomSocket, 'Wok To Go');

    tomSocket.send({ type: 'remove_restaurant', restaurantId: hostsPick.id });
    expect((await tomSocket.next('error')).error).toBe('not_allowed');

    tomSocket.send({ type: 'remove_restaurant', restaurantId: tomsPick.id });
    await hostSocket.stateWhere((s) => !s.restaurants.some((r) => r.id === tomsPick.id));

    const tomsSecond = await add(tomSocket, 'Pho 99');
    hostSocket.send({ type: 'remove_restaurant', restaurantId: tomsSecond.id });
    const removed = await tomSocket.stateWhere(
      (s) => !s.restaurants.some((r) => r.id === tomsSecond.id),
    );
    expect(removed.restaurants.map((r) => r.name)).toContain('Bagels & Beans');
    expect(removed.restaurants.map((r) => r.name)).not.toContain('Pho 99');
    void tom;
  });

  it('clears boosts on a removed restaurant and tells everyone whose boost went', async () => {
    const { tom, hostSocket, tomSocket } = await room();
    const wok = await add(hostSocket, 'Wok To Go');
    tomSocket.send({ type: 'boost', restaurantId: wok.id });
    await hostSocket.stateWhere((s) => s.participants.some((p) => p.boost === wok.id));

    hostSocket.send({ type: 'remove_restaurant', restaurantId: wok.id });
    const state = await tomSocket.stateWhere((s) => !s.restaurants.some((r) => r.id === wok.id));
    expect(state.participants.every((p) => p.boost === null)).toBe(true);
    const removed = await tomSocket.eventWhere((e) => e.type === 'restaurant_removed');
    expect(removed).toEqual({
      type: 'restaurant_removed',
      name: 'Wok To Go',
      removedBy: expect.any(String),
      byHost: false,
      clearedBoosts: [tom.participantId],
    });
  });

  it('rejects unknown restaurant ids', async () => {
    const { hostSocket } = await room();
    hostSocket.send({ type: 'remove_restaurant', restaurantId: '0000000000000000' });
    expect((await hostSocket.next('error')).error).toBe('unknown_restaurant');
  });
});

describe('boosts', () => {
  it('one boost per participant: boosting another moves it, unboost removes it', async () => {
    const { tom, hostSocket, tomSocket } = await room();
    const wok = await add(hostSocket, 'Wok To Go');
    const pho = await add(hostSocket, 'Pho 99');
    const boostOf = (s: { participants: { id: string; boost: string | null }[] }) =>
      s.participants.find((p) => p.id === tom.participantId)?.boost;

    tomSocket.send({ type: 'boost', restaurantId: wok.id });
    await hostSocket.stateWhere((s) => boostOf(s) === wok.id);
    tomSocket.send({ type: 'boost', restaurantId: pho.id });
    await hostSocket.stateWhere((s) => boostOf(s) === pho.id);
    tomSocket.send({ type: 'unboost' });
    await hostSocket.stateWhere((s) => boostOf(s) === null);

    const boosts = hostSocket.messages
      .filter((m) => m.type === 'event' && m.event.type === 'boosted')
      .map((m) => (m.type === 'event' ? m.event : null));
    expect(boosts).toEqual([
      { type: 'boosted', participantId: tom.participantId, restaurantId: wok.id, moved: false },
      { type: 'boosted', participantId: tom.participantId, restaurantId: pho.id, moved: true },
    ]);
  });

  it('cannot boost a restaurant that does not exist', async () => {
    const { tomSocket } = await room();
    tomSocket.send({ type: 'boost', restaurantId: '0000000000000000' });
    expect((await tomSocket.next('error')).error).toBe('unknown_restaurant');
  });

  it('a removed participant takes their boost with them', async () => {
    const { tom, hostSocket, tomSocket } = await room();
    const wok = await add(hostSocket, 'Wok To Go');
    tomSocket.send({ type: 'boost', restaurantId: wok.id });
    await hostSocket.stateWhere((s) => s.participants.some((p) => p.boost === wok.id));
    hostSocket.send({ type: 'kick', participantId: tom.participantId });
    const state = await hostSocket.stateWhere((s) => s.participants.length === 1);
    expect(state.participants.some((p) => p.boost !== null)).toBe(false);
  });
});
