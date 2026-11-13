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

/** Moves the room's clock forward and runs its alarm. */
async function advance(code: string, ms: number): Promise<void> {
  const stub = roomStub(code);
  await runInDurableObject(stub, (room: Room) => {
    const base = room.now();
    room.now = () => base + ms;
  });
  await runDurableObjectAlarm(stub);
}

describe('authentication', () => {
  it('welcomes a participant with the room state, without any tokens in it', async () => {
    const host = await createRoom('Sanne');
    const socket = await openSocket(host.code);
    socket.send({ type: 'hello', token: host.token });
    const welcome = await socket.next('welcome');
    expect(welcome.you).toBe(host.participantId);
    expect(welcome.state.hostId).toBe(host.participantId);
    expect(welcome.state.participants).toEqual([
      { id: host.participantId, name: 'Sanne', connected: true, joinedAt: expect.any(Number) },
    ]);
    expect(welcome.state.expiresAt - welcome.state.createdAt).toBe(LIMITS.roomLifetimeMs);
    expect(JSON.stringify(socket.messages)).not.toContain(host.token);
  });

  it('closes sockets with a wrong token', async () => {
    const host = await createRoom();
    const socket = await openSocket(host.code);
    socket.send({ type: 'hello', token: 'B'.repeat(43) });
    expect((await socket.next('error')).error).toBe('unauthorized');
    expect((await socket.closed).code).toBe(CLOSE_CODES.unauthorized);
  });

  it('does not accept a token from another room', async () => {
    const a = await createRoom('A');
    const b = await createRoom('B');
    const socket = await openSocket(a.code);
    socket.send({ type: 'hello', token: b.token });
    expect((await socket.closed).code).toBe(CLOSE_CODES.unauthorized);
  });

  it('closes sockets that send anything before hello', async () => {
    const host = await createRoom();
    const socket = await openSocket(host.code);
    socket.send({ type: 'end_room' });
    expect((await socket.closed).code).toBe(CLOSE_CODES.unauthorized);
  });

  it('closes sockets that never say hello', async () => {
    const host = await createRoom();
    const socket = await openSocket(host.code);
    await advance(host.code, LIMITS.helloTimeoutMs + 1);
    expect((await socket.closed).code).toBe(CLOSE_CODES.unauthorized);
  });
});

describe('message hygiene', () => {
  it('rejects malformed and unknown messages without crashing', async () => {
    const host = await createRoom();
    const socket = await connectAs(host);
    socket.ws.send('not json');
    expect((await socket.next('error')).error).toBe('bad_message');
    socket.send({ type: 'spin' });
    expect((await socket.next('error')).error).toBe('bad_message');
    socket.send({ type: 'kick', participantId: host.participantId, extra: 1 });
    expect((await socket.next('error')).error).toBe('bad_message');
  });

  it('closes on oversized messages', async () => {
    const host = await createRoom();
    const socket = await connectAs(host);
    socket.ws.send('x'.repeat(LIMITS.maxMessageChars + 1));
    expect((await socket.closed).code).toBe(CLOSE_CODES.tooLarge);
  });

  it('caps the number of open sockets per room', async () => {
    const host = await createRoom();
    const sockets = [];
    for (let i = 0; i < LIMITS.maxSockets; i++) sockets.push(await openSocket(host.code));
    await expect(openSocket(host.code)).rejects.toThrow(/upgrade failed: 503/);
    for (const s of sockets) s.ws.close(1000);
  });

  it('closes sockets that flood messages', async () => {
    const host = await createRoom();
    const socket = await connectAs(host);
    for (let i = 0; i < LIMITS.socketMessagesPerWindow + 5; i++) {
      socket.send({ type: 'transfer_host', participantId: '0000000000000000' });
    }
    expect((await socket.closed).code).toBe(CLOSE_CODES.rateLimited);
  });
});

describe('participants', () => {
  it('broadcasts joins and connection status to everyone', async () => {
    const host = await createRoom('Host');
    const hostSocket = await connectAs(host);
    const tom = await join(host.code, 'Tom');
    const joined = await hostSocket.stateWhere((s) => s.participants.length === 2);
    expect(joined.participants.map((p) => [p.name, p.connected])).toEqual([
      ['Host', true],
      ['Tom', false],
    ]);
    await connectAs(tom);
    const connected = await hostSocket.stateWhere((s) => s.participants.every((p) => p.connected));
    expect(connected.participants.map((p) => p.connected)).toEqual([true, true]);
  });

  it('lets a participant reconnect with the same token', async () => {
    const host = await createRoom();
    const first = await connectAs(host);
    first.ws.close(1000);
    const again = await connectAs(host);
    expect(again.messages[0]?.type).toBe('welcome');
  });
});

describe('host powers', () => {
  it('only the host can kick, and a kicked token is dead', async () => {
    const host = await createRoom('Host');
    const tom = await join(host.code, 'Tom');
    const mila = await join(host.code, 'Mila');
    const hostSocket = await connectAs(host);
    const tomSocket = await connectAs(tom);
    const milaSocket = await connectAs(mila);

    tomSocket.send({ type: 'kick', participantId: mila.participantId });
    expect((await tomSocket.next('error')).error).toBe('not_host');

    hostSocket.send({ type: 'kick', participantId: tom.participantId });
    expect((await tomSocket.closed).code).toBe(CLOSE_CODES.kicked);
    expect((await milaSocket.next('event')).event).toEqual({ type: 'kicked', name: 'Tom' });

    const retry = await openSocket(host.code);
    retry.send({ type: 'hello', token: tom.token });
    expect((await retry.closed).code).toBe(CLOSE_CODES.unauthorized);
  });

  it('the host cannot kick themselves', async () => {
    const host = await createRoom();
    const socket = await connectAs(host);
    socket.send({ type: 'kick', participantId: host.participantId });
    expect((await socket.next('error')).error).toBe('unknown_participant');
  });

  it('transfers the host role only to a connected participant', async () => {
    const host = await createRoom('Host');
    const tom = await join(host.code, 'Tom');
    const hostSocket = await connectAs(host);

    hostSocket.send({ type: 'transfer_host', participantId: tom.participantId });
    expect((await hostSocket.next('error')).error).toBe('not_connected');

    const tomSocket = await connectAs(tom);
    hostSocket.send({ type: 'transfer_host', participantId: tom.participantId });
    expect((await tomSocket.next('event')).event).toEqual({
      type: 'host_changed',
      hostId: tom.participantId,
      auto: false,
    });

    // The old host has lost its powers.
    hostSocket.send({ type: 'end_room' });
    expect((await hostSocket.next('error')).error).toBe('not_host');
  });

  it('ending the room closes every socket and destroys all tokens', async () => {
    const host = await createRoom();
    const tom = await join(host.code, 'Tom');
    const hostSocket = await connectAs(host);
    const tomSocket = await connectAs(tom);
    hostSocket.send({ type: 'end_room' });
    expect((await tomSocket.next('closed')).reason).toBe('ended');
    expect((await tomSocket.closed).code).toBe(CLOSE_CODES.roomClosed);
    expect((await joinRoom(host.code, 'Late')).status).toBe(404);
  });
});

describe('leaving', () => {
  it('a leaving host hands over to the longest-present connected participant', async () => {
    const host = await createRoom('Host');
    const tom = await join(host.code, 'Tom');
    const mila = await join(host.code, 'Mila');
    const hostSocket = await connectAs(host);
    const milaSocket = await connectAs(mila);
    // Tom joined before Mila but is not connected, so Mila becomes host.
    void tom;
    hostSocket.send({ type: 'leave' });
    expect((await milaSocket.next('event')).event).toMatchObject({
      type: 'host_changed',
      hostId: mila.participantId,
      auto: true,
    });
    expect((await hostSocket.closed).code).toBe(CLOSE_CODES.left);
  });

  it('the last participant leaving ends the room', async () => {
    const host = await createRoom();
    const socket = await connectAs(host);
    socket.send({ type: 'leave' });
    await socket.closed;
    expect((await joinRoom(host.code, 'Late')).status).toBe(404);
  });
});

describe('timers', () => {
  it('hands the host role over after the host has been away for 60 seconds', async () => {
    const host = await createRoom('Host');
    const tom = await join(host.code, 'Tom');
    const hostSocket = await connectAs(host);
    const tomSocket = await connectAs(tom);
    hostSocket.ws.close(1000);
    await tomSocket.next('state');

    await advance(host.code, LIMITS.hostAwayMs - 1000);
    expect(tomSocket.messages.some((m) => m.type === 'event')).toBe(false);

    await advance(host.code, 2000);
    expect((await tomSocket.next('event')).event).toEqual({
      type: 'host_changed',
      hostId: tom.participantId,
      auto: true,
    });
  });

  it('keeps the host role when the host comes back in time', async () => {
    const host = await createRoom('Host');
    const tom = await join(host.code, 'Tom');
    const hostSocket = await connectAs(host);
    const tomSocket = await connectAs(tom);
    hostSocket.ws.close(1000);
    await tomSocket.next('state');
    await advance(host.code, 30_000);
    await connectAs(host);
    await advance(host.code, LIMITS.hostAwayMs);
    expect(tomSocket.messages.some((m) => m.type === 'event')).toBe(false);
  });

  it('closes a room 30 minutes after creation, whatever happens', async () => {
    const host = await createRoom();
    const socket = await connectAs(host);
    await advance(host.code, LIMITS.roomLifetimeMs);
    expect((await socket.next('closed')).reason).toBe('expired');
    expect((await joinRoom(host.code, 'Late')).status).toBe(404);
  });

  it('closes a room after 5 minutes with nobody connected', async () => {
    const host = await createRoom();
    const socket = await connectAs(host);
    socket.ws.close(1000);
    await socket.closed;
    await advance(host.code, LIMITS.emptyRoomMs - 1000);
    expect((await joinRoom(host.code, 'Still open')).status).toBe(201);
    await advance(host.code, 2000);
    expect((await joinRoom(host.code, 'Late')).status).toBe(404);
  });

  it('closes a room whose host never connects', async () => {
    const host = await createRoom();
    await advance(host.code, LIMITS.emptyRoomMs);
    expect((await joinRoom(host.code, 'Late')).status).toBe(404);
  });
});
