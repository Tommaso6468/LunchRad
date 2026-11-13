import { describe, expect, it } from 'vitest';
import { clientMessage, createRoomRequest, sessionRequest } from './protocol.ts';

const TOKEN = 'A'.repeat(43);

describe('clientMessage', () => {
  it('accepts every known message', () => {
    for (const msg of [
      { type: 'hello', token: TOKEN },
      { type: 'ping' },
      { type: 'kick', participantId: '0123456789abcdef' },
      { type: 'transfer_host', participantId: '0123456789abcdef' },
      { type: 'leave' },
      { type: 'end_room' },
    ]) {
      expect(clientMessage.safeParse(msg).success, msg.type).toBe(true);
    }
  });

  it('rejects unknown types, extra fields and malformed ids', () => {
    for (const msg of [
      { type: 'spin' },
      { type: 'ping', extra: 1 },
      { type: 'kick', participantId: 'not-an-id' },
      { type: 'hello', token: 'short' },
      { type: 'hello', token: TOKEN, isHost: true },
      null,
      'ping',
      [],
    ]) {
      expect(clientMessage.safeParse(msg).success, JSON.stringify(msg)).toBe(false);
    }
  });
});

describe('HTTP bodies', () => {
  it('reject extra fields', () => {
    expect(sessionRequest.safeParse({ teamKey: 'x', admin: true }).success).toBe(false);
    expect(createRoomRequest.safeParse({ name: 'a', turnstileToken: 't', host: 'x' }).success).toBe(
      false,
    );
  });
});
