import { LIMITS, respinNeeds } from '@lunchrad/shared';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '../src/room.ts';
import {
  connectAs,
  createRoom,
  joinRoom,
  mockTurnstile,
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

async function join(code: string, name: string): Promise<Creds> {
  const res = await joinRoom(code, name);
  expect(res.status).toBe(201);
  return (await res.json()) as Creds;
}

async function advance(code: string, ms: number): Promise<void> {
  const stub = roomStub(code);
  await runInDurableObject(stub, (r: Room) => {
    const base = r.now();
    r.now = () => base + ms;
  });
  await runDurableObjectAlarm(stub);
}

/** A room with `count` connected people, spun once and now voting. */
async function votingRoom(count: number) {
  const host = await createRoom('P0');
  const people: Creds[] = [host];
  for (let i = 1; i < count; i++) people.push(await join(host.code, `P${i}`));
  const sockets: TestSocket[] = [];
  for (const p of people) sockets.push(await connectAs(p));
  const hostSocket = sockets[0] as TestSocket;
  hostSocket.send({ type: 'start_spin' });
  const spinning = await hostSocket.stateWhere((s) => s.phase === 'spinning');
  await advance(host.code, LIMITS.spinDurationMs);
  const voting = await hostSocket.stateWhere((s) => s.phase === 'voting');
  return { host, people, sockets, hostSocket, firstWinner: spinning.spin?.winnerId, voting };
}

describe('respin threshold', () => {
  it('needs strictly more than half', () => {
    expect([1, 2, 3, 4, 5, 6].map(respinNeeds)).toEqual([1, 2, 2, 3, 3, 4]);
  });
});

describe('the respin vote', () => {
  it('opens after the spin for everyone connected, with a 30 s timer', async () => {
    const { people, voting } = await votingRoom(3);
    expect(voting.vote).toMatchObject({
      eligible: expect.arrayContaining(people.map((p) => p.participantId)),
      yes: [],
      no: [],
      durationMs: LIMITS.voteDurationMs,
    });
    expect(voting.vote?.eligible).toHaveLength(3);
    expect(voting.respinsLeft).toBe(LIMITS.maxRespins);
  });

  it('a majority yes respins at once, without the removed winner', async () => {
    const { sockets, hostSocket, firstWinner } = await votingRoom(3);
    sockets[0]?.send({ type: 'vote', choice: 'yes' });
    sockets[1]?.send({ type: 'vote', choice: 'yes' });
    const ended = await hostSocket.eventWhere((e) => e.type === 'vote_ended');
    expect(ended).toMatchObject({ respin: true, yes: 2, eligible: 3 });
    const again = await hostSocket.stateWhere(
      (s) => s.phase === 'spinning' && s.spin?.number === 2,
    );
    expect(again.restaurants.some((r) => r.id === firstWinner)).toBe(false);
    expect(again.spin?.reel).not.toContain(firstWinner);
    expect(again.respinsLeft).toBe(LIMITS.maxRespins - 1);
  });

  it('exactly half is not enough: 2 of 4 yes gives the final result', async () => {
    const { host, sockets, hostSocket, firstWinner } = await votingRoom(4);
    sockets[0]?.send({ type: 'vote', choice: 'yes' });
    sockets[1]?.send({ type: 'vote', choice: 'yes' });
    await hostSocket.stateWhere((s) => (s.vote?.yes.length ?? 0) === 2);
    await advance(host.code, LIMITS.voteDurationMs);
    const final = await hostSocket.stateWhere((s) => s.phase === 'result');
    expect(final.spin?.winnerId).toBe(firstWinner);
    expect(final.closesInMs).toBe(LIMITS.closeAfterResultMs);
  });

  it('not voting counts as no: one yes out of three when time runs out', async () => {
    const { host, sockets, hostSocket } = await votingRoom(3);
    sockets[2]?.send({ type: 'vote', choice: 'yes' });
    await hostSocket.stateWhere((s) => (s.vote?.yes.length ?? 0) === 1);
    await advance(host.code, LIMITS.voteDurationMs - 1000);
    expect(hostSocket.messages.some((m) => m.type === 'state' && m.state.phase === 'result')).toBe(
      false,
    );
    await advance(host.code, 1000);
    await hostSocket.stateWhere((s) => s.phase === 'result');
  });

  it('ends early once yes can no longer win', async () => {
    const { sockets, hostSocket } = await votingRoom(3);
    sockets[0]?.send({ type: 'vote', choice: 'no' });
    sockets[1]?.send({ type: 'vote', choice: 'no' });
    const ended = await hostSocket.eventWhere((e) => e.type === 'vote_ended');
    expect(ended).toMatchObject({ respin: false });
    await hostSocket.stateWhere((s) => s.phase === 'result');
  });

  it('one vote per person: changing your mind replaces your vote', async () => {
    const { sockets, hostSocket, people } = await votingRoom(5);
    const s0 = sockets[0] as TestSocket;
    s0.send({ type: 'vote', choice: 'yes' });
    await hostSocket.stateWhere(
      (s) => s.vote?.yes.includes(people[0]?.participantId ?? '') ?? false,
    );
    s0.send({ type: 'vote', choice: 'yes' });
    s0.send({ type: 'vote', choice: 'no' });
    const state = await hostSocket.stateWhere((s) => (s.vote?.no.length ?? 0) === 1);
    expect(state.vote?.yes).toEqual([]);
    expect(state.vote?.no).toEqual([people[0]?.participantId]);
  });

  it('people who join or connect after the vote opened cannot vote', async () => {
    const { host, hostSocket } = await votingRoom(2);
    const late = await connectAs(await join(host.code, 'Laat'));
    late.send({ type: 'vote', choice: 'yes' });
    expect((await late.next('error')).error).toBe('not_eligible');
    void hostSocket;
  });

  it('a disconnect mid-vote counts as no; the denominator stays fixed', async () => {
    const { host, sockets, hostSocket } = await votingRoom(3);
    (sockets[2] as TestSocket).ws.close(1000);
    sockets[1]?.send({ type: 'vote', choice: 'yes' });
    const state = await hostSocket.stateWhere((s) => (s.vote?.yes.length ?? 0) === 1);
    expect(state.vote?.eligible).toHaveLength(3);
    await advance(host.code, LIMITS.voteDurationMs);
    await hostSocket.stateWhere((s) => s.phase === 'result');
  });

  it('the host leaving mid-vote hands over the role and the vote goes on', async () => {
    const { sockets, people } = await votingRoom(3);
    const [hostSocket, s1, s2] = sockets as [TestSocket, TestSocket, TestSocket];
    hostSocket.send({ type: 'leave' });
    const after = await s1.stateWhere((s) => s.hostId !== people[0]?.participantId);
    expect(after.phase).toBe('voting');
    s1.send({ type: 'vote', choice: 'yes' });
    s2.send({ type: 'vote', choice: 'yes' });
    expect(await s1.eventWhere((e) => e.type === 'vote_ended')).toMatchObject({ respin: true });
  });

  it('votes are refused outside a vote', async () => {
    const host = await createRoom('Sanne');
    const socket = await connectAs(host);
    socket.send({ type: 'vote', choice: 'yes' });
    expect((await socket.next('error')).error).toBe('no_vote');
    socket.send({ type: 'vote', choice: 'maybe' });
    expect((await socket.next('error')).error).toBe('bad_message');
  });
});

describe('limits and the end', () => {
  it('after 3 respins the next result is final without a vote', async () => {
    const { host, sockets, hostSocket } = await votingRoom(1);
    for (let respin = 1; respin <= LIMITS.maxRespins; respin++) {
      sockets[0]?.send({ type: 'vote', choice: 'yes' });
      await hostSocket.stateWhere((s) => s.spin?.number === respin + 1);
      await advance(host.code, LIMITS.spinDurationMs);
      if (respin < LIMITS.maxRespins)
        await hostSocket.stateWhere((s) => s.phase === 'voting' && s.spin?.number === respin + 1);
    }
    const final = await hostSocket.stateWhere((s) => s.phase === 'result');
    expect(final.respinsLeft).toBe(0);
    expect(final.vote).toBeNull();
  });

  it('no vote when fewer than two restaurants would be left', async () => {
    const host = await createRoom('Sanne');
    const socket = await connectAs(host);
    const first = await socket.stateWhere(() => true);
    for (const r of first.restaurants.slice(2)) {
      socket.send({ type: 'remove_restaurant', restaurantId: r.id });
    }
    await socket.stateWhere((s) => s.restaurants.length === 2);
    socket.send({ type: 'start_spin' });
    await socket.stateWhere((s) => s.phase === 'spinning');
    await advance(host.code, LIMITS.spinDurationMs);
    await socket.stateWhere((s) => s.phase === 'result');
  });

  it('the room closes 5 minutes after the final result', async () => {
    const { host, sockets, hostSocket } = await votingRoom(2);
    sockets[0]?.send({ type: 'vote', choice: 'no' });
    await hostSocket.stateWhere((s) => s.phase === 'result');
    await advance(host.code, LIMITS.closeAfterResultMs - 1000);
    expect(hostSocket.messages.some((m) => m.type === 'closed')).toBe(false);
    await advance(host.code, 1000);
    expect((await hostSocket.next('closed')).reason).toBe('finished');
  });
});
