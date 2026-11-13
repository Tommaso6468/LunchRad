/**
 * Everything that crosses the network: HTTP bodies and WebSocket messages.
 * The server validates every incoming value against these schemas and rejects
 * anything else. The client parses server messages with them too, so a bug on
 * either side fails loudly instead of rendering garbage.
 */
import { z } from 'zod';
import { NAME_MAX_LENGTH } from './names.ts';
import { ROOM_CODE_LENGTH } from './room-code.ts';

export const LIMITS = {
  /** Maximum participants per room. */
  maxParticipants: 20,
  /** Hard cap on a room's lifetime. */
  roomLifetimeMs: 30 * 60_000,
  /** A room with nobody connected closes after this long. */
  emptyRoomMs: 5 * 60_000,
  /** The host role moves on after the host has been disconnected this long. */
  hostAwayMs: 60_000,
  /** A socket must authenticate within this time. */
  helloTimeoutMs: 10_000,
  /** Maximum size of one WebSocket message, in characters. */
  maxMessageChars: 2048,
  /** Maximum size of an HTTP request body, in bytes. */
  maxBodyBytes: 4096,
  /** Per-socket message budget: this many messages per window. */
  socketMessagesPerWindow: 20,
  socketWindowMs: 10_000,
  /** Team sessions (after entering the team key) last this long. */
  teamSessionMs: 90 * 24 * 60 * 60_000,
} as const;

const name = z.string().min(1).max(100);
const participantId = z.string().regex(/^[a-f0-9]{16}$/);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const roomCode = z.string().length(ROOM_CODE_LENGTH);

// ---------- HTTP ----------

export const sessionRequest = z.strictObject({ teamKey: z.string().min(1).max(200) });
export const sessionResponse = z.strictObject({ token: z.string(), expiresAt: z.number() });

export const createRoomRequest = z.strictObject({
  name,
  turnstileToken: z.string().min(1).max(2048),
});
export const joinRoomRequest = z.strictObject({ name });

export const roomCredentials = z.strictObject({
  code: roomCode,
  participantId,
  token,
});
export type RoomCredentials = z.infer<typeof roomCredentials>;

export const configResponse = z.strictObject({ turnstileSiteKey: z.string() });

/** Error codes the API returns as { error: code }. The app maps them to Dutch text. */
export const API_ERRORS = [
  'bad_request',
  'unauthorized',
  'wrong_team_key',
  'rate_limited',
  'bot_check_failed',
  'invalid_name',
  'name_taken',
  'room_full',
  'room_not_found',
  'not_found',
  'not_configured',
  'server_error',
] as const;
export type ApiError = (typeof API_ERRORS)[number];
export const apiErrorBody = z.strictObject({ error: z.enum(API_ERRORS) });

// ---------- WebSocket: client → server ----------

export const clientMessage = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('hello'), token }),
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('kick'), participantId }),
  z.strictObject({ type: z.literal('transfer_host'), participantId }),
  z.strictObject({ type: z.literal('leave') }),
  z.strictObject({ type: z.literal('end_room') }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ---------- WebSocket: server → client ----------

export const participantView = z.strictObject({
  id: participantId,
  name: z.string().max(NAME_MAX_LENGTH * 4),
  connected: z.boolean(),
  joinedAt: z.number(),
});
export type ParticipantView = z.infer<typeof participantView>;

export const roomState = z.strictObject({
  code: roomCode,
  hostId: participantId,
  createdAt: z.number(),
  expiresAt: z.number(),
  participants: z.array(participantView).max(LIMITS.maxParticipants),
});
export type RoomState = z.infer<typeof roomState>;

export const CLOSE_REASONS = ['ended', 'expired', 'empty'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const SOCKET_ERRORS = [
  'bad_message',
  'unauthorized',
  'not_host',
  'unknown_participant',
  'not_connected',
  'rate_limited',
] as const;

export const roomEvent = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('host_changed'), hostId: participantId, auto: z.boolean() }),
  z.strictObject({ type: z.literal('kicked'), name: z.string() }),
]);
export type RoomEvent = z.infer<typeof roomEvent>;

export const serverMessage = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('welcome'), you: participantId, state: roomState }),
  z.strictObject({ type: z.literal('state'), state: roomState }),
  z.strictObject({ type: z.literal('event'), event: roomEvent }),
  z.strictObject({ type: z.literal('error'), error: z.enum(SOCKET_ERRORS) }),
  z.strictObject({ type: z.literal('closed'), reason: z.enum(CLOSE_REASONS) }),
  z.strictObject({ type: z.literal('pong') }),
]);
export type ServerMessage = z.infer<typeof serverMessage>;

/** WebSocket close codes in the 4000 range (application-defined). */
export const CLOSE_CODES = {
  roomClosed: 4000,
  unauthorized: 4001,
  kicked: 4003,
  left: 4004,
  tooLarge: 4009,
  rateLimited: 4029,
} as const;
