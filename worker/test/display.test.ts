import { CLOSE_CODES, LIMITS } from '@lunchrad/shared';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../src/room.ts';
import {
  connectAs,
  createRoom,
  joinRoom,
  mockTurnstile,
  openSocket,
  roomStub,
  type Creds,
  type TestSocket,
} from './helpers.ts';

beforeEach(() => {
  mockTurnstile();
});
afterEach(() => {
  vi.restoreAllMocks();
});

async function room() {
  const host = await createRoom('Sanne');
  const tom = (await (await joinRoom(host.code, 'Tom')).json()) as Creds;
  const hostSocket = await connectAs(host);
  const tomSocket = await connectAs(tom);
  const initial = await tomSocket.stateWhere(() => true);
  return { host, tom, hostSocket, tomSocket, initial };
}

async function displayToken(hostSocket: TestSocket): Promise<string> {
  hostSocket.send({ type: 'create_display' });
  return (await hostSocket.next('display_link')).token;
}

async function openDisplay(code: string, token: string): Promise<TestSocket> {
  const socket = await openSocket(code);
  socket.send({ type: 'display_hello', token });
  await socket.next('display_welcome');
  return socket;
}

async function advance(code: string, ms: number): Promise<void> {
  const stub = roomStub(code);
  await runInDurableObject(stub, (r: Room) => {
    const base = r.now();
    r.now = () => base + ms;
  });
  await runDurableObjectAlarm(stub);
}

describe('big-screen link', () => {
  it('only the host can make one; it goes to the host alone', async () => {
    const { hostSocket, tomSocket } = await room();
    tomSocket.send({ type: 'create_display' });
    expect((await tomSocket.next('error')).error).toBe('not_host');
    const token = await displayToken(hostSocket);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await new Promise((r) => setTimeout(r, 100));
    expect(tomSocket.messages.some((m) => m.type === 'display_link')).toBe(false);
  });

  it('a wrong token is refused; a new link revokes the old one', async () => {
    const { host, hostSocket } = await room();
    const bad = await openSocket(host.code);
    bad.send({ type: 'display_hello', token: 'A'.repeat(43) });
    expect((await bad.closed).code).toBe(CLOSE_CODES.unauthorized);

    // Without a link ever made, nothing is accepted either.
    const first = await displayToken(hostSocket);
    const screen = await openDisplay(host.code, first);
    const second = await displayToken(hostSocket);
    expect((await screen.closed).code).toBe(CLOSE_CODES.unauthorized);
    const again = await openSocket(host.code);
    again.send({ type: 'display_hello', token: first });
    expect((await again.closed).code).toBe(CLOSE_CODES.unauthorized);
    await openDisplay(host.code, second);
  });

  it('a participant token cannot be used as a display token and the other way round', async () => {
    const { host, hostSocket } = await room();
    const s1 = await openSocket(host.code);
    s1.send({ type: 'display_hello', token: host.token });
    expect((await s1.closed).code).toBe(CLOSE_CODES.unauthorized);
    const token = await displayToken(hostSocket);
    const s2 = await openSocket(host.code);
    s2.send({ type: 'hello', token });
    expect((await s2.closed).code).toBe(CLOSE_CODES.unauthorized);
  });
});

describe('the big screen', () => {
  it('sees state and events, but every action is refused and changes nothing', async () => {
    const { host, hostSocket, tomSocket, initial } = await room();
    const screen = await openDisplay(host.code, await displayToken(hostSocket));
    const target = initial.restaurants[0]?.id ?? '';

    for (const msg of [
      { type: 'start_spin' },
      { type: 'boost', restaurantId: target },
      { type: 'add_restaurant', name: 'Van het scherm' },
      { type: 'remove_restaurant', restaurantId: target },
      { type: 'vote', choice: 'yes' },
      { type: 'set_new_place', on: true },
      { type: 'create_display' },
      { type: 'end_room' },
      { type: 'hello', token: host.token },
    ]) {
      screen.send(msg);
      expect((await screen.next('error')).error, msg.type).toBe('not_allowed');
    }
    expect(screen.messages.some((m) => m.type === 'display_link')).toBe(false);

    tomSocket.send({ type: 'boost', restaurantId: target });
    expect((await screen.eventWhere((e) => e.type === 'boosted')).type).toBe('boosted');
    const seen = await screen.stateWhere((s) => s.participants.some((p) => p.boost === target));
    expect(seen.phase).toBe('lobby');
    expect(seen.participants.map((p) => p.name).sort()).toEqual(['Sanne', 'Tom']);
  });

  it('is not a participant: not counted, not a voter, no hello timeout', async () => {
    const { host, tom, hostSocket, tomSocket } = await room();
    const screen = await openDisplay(host.code, await displayToken(hostSocket));
    await advance(host.code, LIMITS.helloTimeoutMs + 1000);
    expect(screen.ws.readyState).toBe(WebSocket.OPEN);

    hostSocket.send({ type: 'start_spin' });
    await tomSocket.stateWhere((s) => s.phase === 'spinning');
    await advance(host.code, LIMITS.spinDurationMs + 10);
    const voting = await screen.stateWhere((s) => s.phase === 'voting');
    expect(voting.vote?.eligible.sort()).toEqual([host.participantId, tom.participantId].sort());
  });

  it('a room with only the big screen left counts as empty', async () => {
    const { host, hostSocket, tomSocket } = await room();
    const screen = await openDisplay(host.code, await displayToken(hostSocket));
    hostSocket.ws.close(1000);
    tomSocket.ws.close(1000);
    await new Promise((r) => setTimeout(r, 200));
    await advance(host.code, LIMITS.emptyRoomMs + 1000);
    const closed = await screen.next('closed');
    expect(closed.reason).toBe('empty');
  });
});
