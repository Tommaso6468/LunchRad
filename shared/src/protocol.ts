/**
 * Everything that crosses the network: HTTP bodies and WebSocket messages.
 * The server validates every incoming value against these schemas and rejects
 * anything else. The client parses server messages with them too, so a bug on
 * either side fails loudly instead of rendering garbage.
 */
import * as z from 'zod/mini';
import { NAME_MAX_LENGTH } from './names';
import { CATEGORY_MAX, MAPS_URL_MAX, MAX_CATEGORIES, RESTAURANT_NAME_MAX } from './restaurants';
import { ROOM_CODE_LENGTH } from './room-code';

export const LIMITS = {
  /** Maximum participants per room. */
  maxParticipants: 20,
  /** Maximum restaurants on one wheel, so slices stay readable. */
  maxRestaurants: 30,
  /** A spin needs at least this many restaurants. */
  minRestaurantsToSpin: 2,
  /** How long the reel animation runs, the same on every phone. */
  spinDurationMs: 5000,
  /** How long the respin vote stays open. */
  voteDurationMs: 60_000,
  /** At most this many respins per room. */
  maxRespins: 3,
  /** The room closes this long after the final result. */
  closeAfterResultMs: 5 * 60_000,
  /** Maximum open sockets per room (a few tabs or devices per person). */
  maxSockets: 60,
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
  /** Extra slices for a restaurant that has never won, while new-place mode is on. */
  newPlaceSlices: 1,
  /** Team sessions (after entering the team key) last this long. */
  teamSessionMs: 90 * 24 * 60 * 60_000,
} as const;

const name = z.string().check(z.minLength(1), z.maxLength(100));
const participantId = z.string().check(z.regex(/^[a-f0-9]{16}$/));
const token = z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/));
const roomCode = z.string().check(z.length(ROOM_CODE_LENGTH));
const restaurantId = z.string().check(z.regex(/^[a-f0-9]{16}$/));
// Raw input lengths; the exact rules (characters, Maps hosts) run in the room.
const optionalText = (max: number) => z.optional(z.nullable(z.string().check(z.maxLength(max))));

// ---------- HTTP ----------

export const sessionRequest = z.strictObject({
  teamKey: z.string().check(z.minLength(1), z.maxLength(200)),
});
export const sessionResponse = z.strictObject({ token: z.string(), expiresAt: z.number() });

export const createRoomRequest = z.strictObject({
  name,
  turnstileToken: z.string().check(z.minLength(1), z.maxLength(2048)),
  /** Which preset the wheel starts with; the default preset when left out. */
  presetId: z.optional(z.string().check(z.regex(/^[a-f0-9]{16}$/))),
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
  'preset_not_found',
  'not_found',
  'not_configured',
  'server_error',
] as const;
export type ApiError = (typeof API_ERRORS)[number];
export const apiErrorBody = z.strictObject({ error: z.enum(API_ERRORS) });

// ---------- WebSocket: client → server ----------

export const clientMessage = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('hello'), token }),
  /** A big screen authenticates with its display token instead of a participant token. */
  z.strictObject({ type: z.literal('display_hello'), token }),
  z.strictObject({ type: z.literal('ping') }),
  z.strictObject({ type: z.literal('kick'), participantId }),
  z.strictObject({ type: z.literal('transfer_host'), participantId }),
  z.strictObject({ type: z.literal('leave') }),
  z.strictObject({ type: z.literal('end_room') }),
  z.strictObject({
    type: z.literal('add_restaurant'),
    name: z.string().check(z.minLength(1), z.maxLength(RESTAURANT_NAME_MAX * 4)),
    categories: z.optional(
      z
        .array(z.string().check(z.maxLength(CATEGORY_MAX * 4)))
        .check(z.maxLength(MAX_CATEGORIES * 2)),
    ),
    mapsUrl: optionalText(MAPS_URL_MAX),
  }),
  z.strictObject({ type: z.literal('remove_restaurant'), restaurantId }),
  z.strictObject({ type: z.literal('boost'), restaurantId }),
  z.strictObject({ type: z.literal('unboost') }),
  // No parameters on purpose: the client cannot influence the result.
  z.strictObject({ type: z.literal('start_spin') }),
  z.strictObject({ type: z.literal('vote'), choice: z.enum(['yes', 'no']) }),
  z.strictObject({ type: z.literal('set_new_place'), on: z.boolean() }),
  /** Host asks for a big-screen link; any earlier one stops working. */
  z.strictObject({ type: z.literal('create_display') }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

// ---------- WebSocket: server → client ----------

export const participantView = z.strictObject({
  id: participantId,
  name: z.string().check(z.maxLength(NAME_MAX_LENGTH * 4)),
  connected: z.boolean(),
  joinedAt: z.number(),
  /** The one restaurant this participant boosts, if any. */
  boost: z.nullable(restaurantId),
});

export const restaurantView = z.strictObject({
  id: restaurantId,
  name: z.string().check(z.maxLength(RESTAURANT_NAME_MAX * 4)),
  categories: z
    .array(z.string().check(z.maxLength(CATEGORY_MAX * 4)))
    .check(z.maxLength(MAX_CATEGORIES)),
  mapsUrl: z.nullable(z.string().check(z.maxLength(MAPS_URL_MAX))),
  /** Participant who added it in this session; null for preset restaurants. */
  addedBy: z.nullable(participantId),
  /** False for a restaurant the team has never ended up at (by name). */
  visited: z.boolean(),
});
export type RestaurantView = z.infer<typeof restaurantView>;
export type ParticipantView = z.infer<typeof participantView>;

export const roomState = z.strictObject({
  code: roomCode,
  hostId: participantId,
  createdAt: z.number(),
  expiresAt: z.number(),
  participants: z.array(participantView).check(z.maxLength(LIMITS.maxParticipants)),
  restaurants: z.array(restaurantView).check(z.maxLength(LIMITS.maxRestaurants)),
  /**
   * lobby: building the list; spinning: reel running; voting: respin vote
   * open; result: final winner, the room closes at `closesAt`.
   */
  phase: z.enum(['lobby', 'spinning', 'voting', 'result']),
  /** Respins still allowed in this room. */
  respinsLeft: z.number(),
  /** New-place mode: restaurants that never won get extra slices. */
  newPlace: z.boolean(),
  vote: z.nullable(
    z.strictObject({
      /** Participants who may vote: everyone connected when the vote opened. */
      eligible: z.array(participantId).check(z.maxLength(LIMITS.maxParticipants)),
      yes: z.array(participantId).check(z.maxLength(LIMITS.maxParticipants)),
      no: z.array(participantId).check(z.maxLength(LIMITS.maxParticipants)),
      durationMs: z.number(),
      /** Time left when the server sent this state. */
      remainingMs: z.number(),
    }),
  ),
  /** When the room closes after the final result; null before that. */
  closesInMs: z.nullable(z.number()),
  spin: z.nullable(
    z.strictObject({
      /** Increases with every spin, so clients notice a new one. */
      number: z.number(),
      /** Restaurant ids in reel order; boosted ones appear more than once. */
      reel: z
        .array(restaurantId)
        .check(z.maxLength(LIMITS.maxRestaurants + LIMITS.maxParticipants)),
      winnerIndex: z.number(),
      winnerId: restaurantId,
      durationMs: z.number(),
      /** How far into the animation the server was when it sent this state. */
      elapsedMs: z.number(),
    }),
  ),
});
export type SpinView = NonNullable<RoomState['spin']>;
export type VoteView = NonNullable<RoomState['vote']>;

/**
 * Slices on the wheel for one restaurant: one, plus one per boost, plus the
 * new-place bonus. The server builds the reel with this; the list shows the
 * same numbers.
 */
export function restaurantSlices(boosts: number, newPlace: boolean, visited: boolean): number {
  return 1 + boosts + (newPlace && !visited ? LIMITS.newPlaceSlices : 0);
}

/** A respin needs strictly more than half of the eligible voters. */
export function respinNeeds(eligible: number): number {
  return Math.floor(eligible / 2) + 1;
}
export type RoomPhase = RoomState['phase'];
export type RoomState = z.infer<typeof roomState>;

export const CLOSE_REASONS = ['ended', 'expired', 'empty', 'finished', 'closed_by_admin'] as const;
export type CloseReason = (typeof CLOSE_REASONS)[number];

export const SOCKET_ERRORS = [
  'bad_message',
  'unauthorized',
  'not_host',
  'unknown_participant',
  'not_connected',
  'rate_limited',
  'invalid_restaurant',
  'invalid_category',
  'invalid_maps_url',
  'restaurant_exists',
  'too_many_restaurants',
  'unknown_restaurant',
  'not_allowed',
  'locked',
  'not_enough_restaurants',
  'no_vote',
  'not_eligible',
] as const;
export type SocketError = (typeof SOCKET_ERRORS)[number];

export const roomEvent = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('vote_ended'),
    respin: z.boolean(),
    yes: z.number(),
    eligible: z.number(),
    /** The restaurant taken off the wheel for the respin. */
    removedName: z.nullable(z.string()),
  }),
  z.strictObject({ type: z.literal('host_changed'), hostId: participantId, auto: z.boolean() }),
  z.strictObject({ type: z.literal('new_place_changed'), on: z.boolean() }),
  z.strictObject({ type: z.literal('kicked'), name: z.string() }),
  z.strictObject({
    type: z.literal('boosted'),
    participantId,
    restaurantId,
    /** True when the participant moved an earlier boost to this restaurant. */
    moved: z.boolean(),
  }),
  z.strictObject({ type: z.literal('restaurant_added'), participantId, restaurantId }),
  z.strictObject({
    type: z.literal('restaurant_removed'),
    name: z.string(),
    removedBy: participantId,
    /** True when the host removed someone else's (or a preset) restaurant. */
    byHost: z.boolean(),
    /** Participants whose boost was on it and is now gone. */
    clearedBoosts: z.array(participantId),
  }),
]);
export type RoomEvent = z.infer<typeof roomEvent>;

export const serverMessage = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('welcome'), you: participantId, state: roomState }),
  /** To a big screen: it sees everything and can do nothing. */
  z.strictObject({ type: z.literal('display_welcome'), state: roomState }),
  /** Only to the host who asked: the token for /scherm/CODE#token. */
  z.strictObject({ type: z.literal('display_link'), token }),
  z.strictObject({ type: z.literal('state'), state: roomState }),
  z.strictObject({ type: z.literal('event'), event: roomEvent }),
  z.strictObject({ type: z.literal('error'), error: z.enum(SOCKET_ERRORS) }),
  z.strictObject({ type: z.literal('closed'), reason: z.enum(CLOSE_REASONS) }),
  z.strictObject({ type: z.literal('pong') }),
]);
export type ServerMessage = z.infer<typeof serverMessage>;

/**
 * WebSocket subprotocols. Browsers cannot set an Authorization header on a
 * WebSocket, so the team session travels as a second offered subprotocol
 * ("team.<token>"); the server answers with WS_PROTOCOL only.
 */
export const WS_PROTOCOL = 'lunchrad.v1';
export const WS_TEAM_PREFIX = 'team.';

/** WebSocket close codes in the 4000 range (application-defined). */
export const CLOSE_CODES = {
  roomClosed: 4000,
  unauthorized: 4001,
  kicked: 4003,
  left: 4004,
  tooLarge: 4009,
  rateLimited: 4029,
} as const;
