import { LIMITS } from '@lunchrad/shared';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../src/room.ts';
import { SEED_RESTAURANTS } from '../src/seed-preset.ts';
import { connectAs, createRoom, joinRoom, mockTurnstile, roomStub, type Creds } from './helpers.ts';

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

async function room() {
  const host = await createRoom('Sanne');
  const tom = await join(host.code, 'Tom');
  const hostSocket = await connectAs(host);
  const tomSocket = await connectAs(tom);
  const first = await tomSocket.stateWhere(() => true);
  return { host, tom, hostSocket, tomSocket, restaurants: first.restaurants };
}

async function advance(code: string, ms: number): Promise<void> {
  const stub = roomStub(code);
  await runInDurableObject(stub, (r: Room) => {
    const base = r.now();
    r.now = () => base + ms;
  });
  await runDurableObjectAlarm(stub);
}

describe('starting the spin', () => {
  it('is for the host only', async () => {
    const { tomSocket } = await room();
    tomSocket.send({ type: 'start_spin' });
    expect((await tomSocket.next('error')).error).toBe('not_host');
  });

  it('takes no parameters: a client cannot choose the winner', async () => {
    const { hostSocket, restaurants } = await room();
    hostSocket.send({ type: 'start_spin', winnerId: restaurants[0]?.id });
    expect((await hostSocket.next('error')).error).toBe('bad_message');
    hostSocket.send({ type: 'start_spin', winnerIndex: 0 });
    expect((await hostSocket.next('error')).error).toBe('bad_message');
  });

  it('needs at least two restaurants', async () => {
    const { hostSocket, restaurants } = await room();
    for (const r of restaurants.slice(1)) {
      hostSocket.send({ type: 'remove_restaurant', restaurantId: r.id });
    }
    await hostSocket.stateWhere((s) => s.restaurants.length === 1);
    hostSocket.send({ type: 'start_spin' });
    expect((await hostSocket.next('error')).error).toBe('not_enough_restaurants');
  });

  it('sends everyone the same reel and winner, with boosts as extra rows', async () => {
    const { tom, hostSocket, tomSocket, restaurants } = await room();
    const boosted = restaurants[0];
    if (!boosted) throw new Error('no restaurants');
    tomSocket.send({ type: 'boost', restaurantId: boosted.id });
    await hostSocket.stateWhere((s) => s.participants.some((p) => p.boost === boosted.id));

    hostSocket.send({ type: 'start_spin' });
    const seenByHost = await hostSocket.stateWhere((s) => s.phase === 'spinning');
    const seenByTom = await tomSocket.stateWhere((s) => s.phase === 'spinning');
    expect(seenByTom.spin).toMatchObject({
      number: 1,
      reel: seenByHost.spin?.reel,
      winnerIndex: seenByHost.spin?.winnerIndex,
      winnerId: seenByHost.spin?.winnerId,
      durationMs: LIMITS.spinDurationMs,
    });
    const spin = seenByTom.spin;
    if (!spin) throw new Error('no spin');
    expect(spin.reel).toHaveLength(SEED_RESTAURANTS.length + 1);
    expect(spin.reel.filter((id) => id === boosted.id)).toHaveLength(2);
    expect(spin.reel[spin.winnerIndex]).toBe(spin.winnerId);
    expect(new Set(spin.reel)).toEqual(new Set(restaurants.map((r) => r.id)));
    void tom;
  });
});

describe('during and after the spin', () => {
  it('locks the list and the boosts', async () => {
    const { hostSocket, tomSocket, restaurants } = await room();
    hostSocket.send({ type: 'start_spin' });
    await tomSocket.stateWhere((s) => s.phase === 'spinning');
    const target = restaurants[0]?.id ?? '';
    for (const msg of [
      { type: 'boost', restaurantId: target },
      { type: 'unboost' },
      { type: 'add_restaurant', name: 'Te laat' },
      { type: 'remove_restaurant', restaurantId: target },
    ]) {
      tomSocket.send(msg);
      expect((await tomSocket.next('error')).error, msg.type).toBe('locked');
    }
    hostSocket.send({ type: 'start_spin' });
    expect((await hostSocket.next('error')).error).toBe('locked');
  });

  it('opens the respin vote when the animation time is over, not before', async () => {
    const { host, hostSocket, tomSocket } = await room();
    hostSocket.send({ type: 'start_spin' });
    const spinning = await tomSocket.stateWhere((s) => s.phase === 'spinning');

    await advance(host.code, LIMITS.spinDurationMs - 500);
    expect(tomSocket.messages.some((m) => m.type === 'state' && m.state.phase === 'voting')).toBe(
      false,
    );

    await advance(host.code, 1000);
    const result = await tomSocket.stateWhere((s) => s.phase === 'voting');
    expect(result.spin?.winnerId).toBe(spinning.spin?.winnerId);
    expect(result.spin?.elapsedMs).toBe(LIMITS.spinDurationMs);
  });

  it('a phone that reconnects mid-spin gets how far the animation is', async () => {
    const { host, hostSocket } = await room();
    hostSocket.send({ type: 'start_spin' });
    await hostSocket.stateWhere((s) => s.phase === 'spinning');
    await runInDurableObject(roomStub(host.code), (r: Room) => {
      const base = r.now();
      r.now = () => base + 2000;
    });
    const again = await connectAs(host);
    const welcome = again.messages[0];
    if (welcome?.type !== 'welcome') throw new Error('no welcome');
    expect(welcome.state.spin?.elapsedMs).toBeGreaterThanOrEqual(2000);
    expect(welcome.state.spin?.elapsedMs).toBeLessThan(LIMITS.spinDurationMs);
  });
});
