import { CLOSE_CODES, LIMITS } from '@lunchrad/shared';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../src/room.ts';
import {
  call,
  connectAs,
  createRoom,
  joinRoom,
  mockTurnstile,
  openSocket,
  roomStub,
  teamToken,
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

/** What the "big screen" button on the home screen does: the code and the team session, nothing else. */
async function displayToken(code: string): Promise<string> {
  const team = await teamToken();
  const res = await call(`/api/rooms/${code}/display`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${team}` },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
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

describe('joining as a big screen', () => {
  it('needs only the code and a team session; no name, not in the people list', async () => {
    const { host, hostSocket } = await room();
    const token = await displayToken(host.code);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const screen = await openDisplay(host.code, token);
    await new Promise((r) => setTimeout(r, 100));
    expect(hostSocket.messages.some((m) => m.type === 'event')).toBe(false);
    const welcome = screen.messages.find((m) => m.type === 'display_welcome');
    expect(welcome?.type === 'display_welcome' && welcome.state.participants.length).toBe(2);
  });

  it('is refused without a team session and for rooms that do not exist', async () => {
    const { host } = await room();
    const noTeam = await call(`/api/rooms/${host.code}/display`, { method: 'POST' });
    expect(noTeam.status).toBe(401);
    const team = await teamToken();
    const missing = await call('/api/rooms/ZZZZZZ/display', {
      method: 'POST',
      headers: { Authorization: `Bearer ${team}` },
    });
    expect(await missing.json()).toEqual({ error: 'room_not_found' });
  });

  it('a wrong token is refused; tokens cannot be swapped between screens and people', async () => {
    const { host } = await room();
    const bad = await openSocket(host.code);
    bad.send({ type: 'display_hello', token: 'A'.repeat(43) });
    expect((await bad.closed).code).toBe(CLOSE_CODES.unauthorized);

    const s1 = await openSocket(host.code);
    s1.send({ type: 'display_hello', token: host.token });
    expect((await s1.closed).code).toBe(CLOSE_CODES.unauthorized);
    const token = await displayToken(host.code);
    const s2 = await openSocket(host.code);
    s2.send({ type: 'hello', token });
    expect((await s2.closed).code).toBe(CLOSE_CODES.unauthorized);
  });

  it(`keeps at most ${LIMITS.maxDisplays} screens; a new one replaces the oldest`, async () => {
    const { host } = await room();
    const first = await displayToken(host.code);
    const oldest = await openDisplay(host.code, first);
    for (let i = 0; i < LIMITS.maxDisplays; i++) await displayToken(host.code);
    expect((await oldest.closed).code).toBe(CLOSE_CODES.unauthorized);
    const again = await openSocket(host.code);
    again.send({ type: 'display_hello', token: first });
    expect((await again.closed).code).toBe(CLOSE_CODES.unauthorized);
  });
});

describe('the big screen', () => {
  it('sees state and events, but every action is refused and changes nothing', async () => {
    const { host, tomSocket, initial } = await room();
    const screen = await openDisplay(host.code, await displayToken(host.code));
    const target = initial.restaurants[0]?.id ?? '';

    for (const msg of [
      { type: 'start_spin' },
      { type: 'boost', restaurantId: target },
      { type: 'add_restaurant', name: 'Van het scherm' },
      { type: 'remove_restaurant', restaurantId: target },
      { type: 'vote', choice: 'yes' },
      { type: 'set_new_place', on: true },
      { type: 'end_room' },
      { type: 'hello', token: host.token },
    ]) {
      screen.send(msg);
      expect((await screen.next('error')).error, msg.type).toBe('not_allowed');
    }

    tomSocket.send({ type: 'boost', restaurantId: target });
    expect((await screen.eventWhere((e) => e.type === 'boosted')).type).toBe('boosted');
    const seen = await screen.stateWhere((s) => s.participants.some((p) => p.boost === target));
    expect(seen.phase).toBe('lobby');
    expect(seen.participants.map((p) => p.name).sort()).toEqual(['Sanne', 'Tom']);
  });

  it('is not a participant: not counted, not a voter, no hello timeout', async () => {
    const { host, tom, hostSocket, tomSocket } = await room();
    const screen = await openDisplay(host.code, await displayToken(host.code));
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
    const screen = await openDisplay(host.code, await displayToken(host.code));
    hostSocket.ws.close(1000);
    tomSocket.ws.close(1000);
    await new Promise((r) => setTimeout(r, 200));
    await advance(host.code, LIMITS.emptyRoomMs + 1000);
    const closed = await screen.next('closed');
    expect(closed.reason).toBe('empty');
  });
});
