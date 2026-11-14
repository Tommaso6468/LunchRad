/**
 * One Durable Object per room. It is the single source of truth for who is
 * in the room, who is host, which restaurants are on the wheel and who boosts
 * what. Everything a client sends is validated here;
 * roles are checked here and never trusted from the client.
 *
 * WebSockets use the Hibernation API, so an idle room costs nothing. All
 * timers (30-minute cap, empty room, host away, hello timeout, end of the
 * spin) share the one Durable Object alarm, recomputed after every change.
 *
 * The spin is decided here, once, with the platform CSPRNG (see spin.ts).
 * Clients only receive the reel and the winning row and animate towards it.
 */
import {
  CLOSE_CODES,
  LIMITS,
  WS_PROTOCOL,
  clientMessage,
  nameKey,
  normalizeCategories,
  normalizeMapsUrl,
  normalizeName,
  normalizeRestaurantName,
  restaurantKey,
  type ClientMessage,
  type CloseReason,
  type RoomEvent,
  type RoomState,
  type ServerMessage,
  type SocketError,
  respinNeeds,
  restaurantSlices,
} from '@lunchrad/shared';
import { DurableObject } from 'cloudflare:workers';
import { randomId, randomToken, sha256Base64url } from './crypto.ts';
import { recordLunch, unregisterRoom, type MenuItem } from './db.ts';
import type { Env } from './env.ts';
import { buildReel, randomIndex } from './spin.ts';

interface RoomMeta {
  code: string;
  createdAt: number;
  expiresAt: number;
  hostId: string;
  /** Set while no participant is connected. */
  emptySince: number | null;
  /** Set while the host is disconnected. */
  hostAwaySince: number | null;
  phase: 'lobby' | 'spinning' | 'voting' | 'result';
  spin: Spin | null;
  respins: number;
  vote: Vote | null;
  /** When the final result was reached; the room closes a while later. */
  finalAt: number | null;
  /** New-place mode: restaurants that never won get extra slices. */
  newPlace: boolean;
  /** Name keys of restaurants the team has ended up at before (from D1, at creation). */
  visited: string[];
  /** Random id for this room's history row (room codes can be reused). */
  ref: string;
  /** Hash of the one valid big-screen token, if the host made one. */
  displayHash: string | null;
}

interface Vote {
  /** Fixed when the vote opens: everyone connected at that moment. */
  eligible: string[];
  yes: string[];
  no: string[];
  startedAt: number;
  durationMs: number;
}

interface Spin {
  number: number;
  reel: string[];
  winnerIndex: number;
  winnerId: string;
  startedAt: number;
  durationMs: number;
}

interface Participant {
  id: string;
  name: string;
  tokenHash: string;
  joinedAt: number;
  /** Restaurant id this participant boosts; at most one. */
  boost: string | null;
}

interface Restaurant {
  id: string;
  name: string;
  categories: string[];
  mapsUrl: string | null;
  /** Participant who added it; null for preset restaurants. */
  addedBy: string | null;
  addedAt: number;
}

interface SocketAttachment {
  /** Participant id once the socket has sent a valid hello. */
  pid: string | null;
  openedAt: number;
  /** A big screen: read-only, not a participant, never counted or eligible. */
  display?: boolean;
}

export interface Credentials {
  participantId: string;
  token: string;
}
export type InitResult =
  | ({ ok: true; createdAt: number; expiresAt: number } & Credentials)
  | { ok: false; error: 'exists' | 'invalid_name' };
export interface RoomSummary {
  phase: 'lobby' | 'spinning' | 'voting' | 'result';
  participants: number;
  connected: number;
}
export type JoinResult =
  | ({ ok: true } & Credentials)
  | { ok: false; error: 'room_not_found' | 'invalid_name' | 'name_taken' | 'room_full' };

const OPEN = 1;

export class Room extends DurableObject<Env> {
  private meta: RoomMeta | null = null;
  private readonly participants = new Map<string, Participant>();
  private readonly tokenIndex = new Map<string, string>();
  private readonly restaurants = new Map<string, Restaurant>();
  private readonly budgets = new WeakMap<WebSocket, { windowStart: number; count: number }>();

  /** Overridable in tests. */
  now: () => number = () => Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      const meta = await ctx.storage.get<RoomMeta>('meta');
      // Rooms created before M3/M4 lack the newer fields.
      this.meta = meta
        ? {
            ...meta,
            phase: meta.phase ?? 'lobby',
            spin: meta.spin ?? null,
            respins: meta.respins ?? 0,
            vote: meta.vote ?? null,
            finalAt: meta.finalAt ?? null,
            newPlace: meta.newPlace ?? false,
            visited: meta.visited ?? [],
            ref: meta.ref ?? randomId(),
            displayHash: meta.displayHash ?? null,
          }
        : null;
      const stored = await ctx.storage.list<Participant>({ prefix: 'p:' });
      for (const p of stored.values()) {
        this.participants.set(p.id, p);
        this.tokenIndex.set(p.tokenHash, p.id);
      }
      const menu = await ctx.storage.list<Restaurant>({ prefix: 'r:' });
      for (const r of menu.values()) this.restaurants.set(r.id, r);
    });
    // Answer keep-alive pings without waking the object.
    ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
  }

  // ---------- RPC from the Worker ----------

  /** `menu` is the chosen preset, read from D1 by the Worker; checked again here. */
  async init(
    code: string,
    rawName: string,
    menu: readonly MenuItem[],
    visited: readonly string[] = [],
  ): Promise<InitResult> {
    if (this.meta) return { ok: false, error: 'exists' };
    const name = normalizeName(rawName);
    if (!name) return { ok: false, error: 'invalid_name' };

    const now = this.now();
    const host = await this.newParticipant(name, now);
    this.meta = {
      code,
      createdAt: now,
      expiresAt: now + LIMITS.roomLifetimeMs,
      hostId: host.participant.id,
      // Nobody is connected yet; if the host never connects, the room closes.
      emptySince: now,
      hostAwaySince: null,
      phase: 'lobby',
      spin: null,
      respins: 0,
      vote: null,
      finalAt: null,
      newPlace: false,
      visited: [...new Set(visited)].slice(0, 5000),
      ref: randomId(),
      displayHash: null,
    };
    await this.persistMeta();
    await this.seedRestaurants(now, menu);
    await this.scheduleAlarm();
    return {
      ok: true,
      participantId: host.participant.id,
      token: host.token,
      createdAt: now,
      expiresAt: this.meta.expiresAt,
    };
  }

  async join(rawName: string): Promise<JoinResult> {
    if (!this.meta) return { ok: false, error: 'room_not_found' };
    const name = normalizeName(rawName);
    if (!name) return { ok: false, error: 'invalid_name' };
    if (this.participants.size >= LIMITS.maxParticipants) return { ok: false, error: 'room_full' };
    const key = nameKey(name);
    for (const p of this.participants.values()) {
      if (nameKey(p.name) === key) return { ok: false, error: 'name_taken' };
    }
    const { participant, token } = await this.newParticipant(name, this.now());
    this.broadcastState();
    return { ok: true, participantId: participant.id, token };
  }

  /** For the admin room list. Null when the room does not exist (any more). */
  async summary(): Promise<RoomSummary | null> {
    if (!this.meta) return null;
    return {
      phase: this.meta.phase,
      participants: this.participants.size,
      connected: this.connectedIds().size,
    };
  }

  /** Closes the room for everyone on an admin's request. */
  async adminClose(): Promise<boolean> {
    if (!this.meta) return false;
    await this.closeRoom('closed_by_admin');
    return true;
  }

  // ---------- WebSocket upgrade ----------

  override async fetch(request: Request): Promise<Response> {
    if (!this.meta) return new Response('Niet gevonden', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Verwacht WebSocket', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= LIMITS.maxSockets) {
      return new Response('Te veel verbindingen', { status: 503 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const attachment: SocketAttachment = { pid: null, openedAt: this.now() };
    server.serializeAttachment(attachment);
    await this.scheduleAlarm();
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': WS_PROTOCOL },
    });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.meta) {
      this.safeClose(ws, CLOSE_CODES.roomClosed, 'closed');
      return;
    }
    if (typeof raw !== 'string') {
      this.safeClose(ws, 1003, 'text only');
      return;
    }
    if (raw.length > LIMITS.maxMessageChars) {
      this.safeClose(ws, CLOSE_CODES.tooLarge, 'too large');
      return;
    }
    if (!this.withinBudget(ws)) {
      this.send(ws, { type: 'error', error: 'rate_limited' });
      this.safeClose(ws, CLOSE_CODES.rateLimited, 'rate limited');
      return;
    }

    let parsed: ClientMessage;
    try {
      const result = clientMessage.safeParse(JSON.parse(raw));
      if (!result.success) throw new Error('invalid');
      parsed = result.data;
    } catch {
      this.send(ws, { type: 'error', error: 'bad_message' });
      const att = this.attachment(ws);
      if (!att.pid && !att.display) this.safeClose(ws, CLOSE_CODES.unauthorized, 'bad message');
      return;
    }

    const attachment = this.attachment(ws);
    if (attachment.display) {
      // A big screen may only watch (its pings are answered without waking the room).
      this.send(ws, { type: 'error', error: 'not_allowed' });
      return;
    }
    if (parsed.type === 'hello') {
      await this.handleHello(ws, attachment, parsed.token);
      return;
    }
    if (parsed.type === 'display_hello') {
      await this.handleDisplayHello(ws, attachment, parsed.token);
      return;
    }
    const pid = attachment.pid;
    if (!pid || !this.participants.has(pid)) {
      this.send(ws, { type: 'error', error: 'unauthorized' });
      this.safeClose(ws, CLOSE_CODES.unauthorized, 'unauthorized');
      return;
    }

    switch (parsed.type) {
      case 'ping':
        this.send(ws, { type: 'pong' });
        return;
      case 'kick':
        await this.handleKick(ws, pid, parsed.participantId);
        return;
      case 'transfer_host':
        await this.handleTransfer(ws, pid, parsed.participantId);
        return;
      case 'leave':
        await this.handleLeave(pid);
        return;
      case 'end_room':
        if (!this.isHost(pid)) {
          this.send(ws, { type: 'error', error: 'not_host' });
          return;
        }
        await this.closeRoom('ended');
        return;
      case 'start_spin':
        await this.handleStartSpin(ws, pid);
        return;
      case 'create_display':
        await this.handleCreateDisplay(ws, pid);
        return;
      case 'set_new_place':
        await this.handleNewPlace(ws, pid, parsed.on);
        return;
      case 'vote':
        await this.handleVote(ws, pid, parsed.choice);
        return;
      case 'add_restaurant':
        if (this.meta.phase !== 'lobby') return this.reject(ws, 'locked');
        await this.handleAddRestaurant(ws, pid, parsed);
        return;
      case 'remove_restaurant':
        if (this.meta.phase !== 'lobby') return this.reject(ws, 'locked');
        await this.handleRemoveRestaurant(ws, pid, parsed.restaurantId);
        return;
      case 'boost':
        if (this.meta.phase !== 'lobby') return this.reject(ws, 'locked');
        await this.handleBoost(ws, pid, parsed.restaurantId);
        return;
      case 'unboost':
        if (this.meta.phase !== 'lobby') return this.reject(ws, 'locked');
        await this.handleUnboost(pid);
        return;
    }
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Complete the close handshake; harmless if the runtime already did.
    this.safeClose(ws, code === 1005 ? 1000 : code, '');
    await this.handleDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  override async alarm(): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    const now = this.now();

    if (now >= meta.expiresAt) {
      await this.closeRoom('expired');
      return;
    }
    if (meta.emptySince !== null && now >= meta.emptySince + LIMITS.emptyRoomMs) {
      await this.closeRoom('empty');
      return;
    }
    await this.maybeHandOffHost(now);

    const spin = meta.spin;
    if (meta.phase === 'spinning' && spin && now >= spin.startedAt + spin.durationMs) {
      await this.afterSpin(now);
    } else if (
      meta.phase === 'voting' &&
      meta.vote &&
      now >= meta.vote.startedAt + meta.vote.durationMs
    ) {
      const needs = respinNeeds(meta.vote.eligible.length);
      await this.endVote(meta.vote.yes.length >= needs);
    } else if (
      meta.phase === 'result' &&
      meta.finalAt !== null &&
      now >= meta.finalAt + LIMITS.closeAfterResultMs
    ) {
      await this.closeRoom('finished');
      return;
    }

    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (!att.pid && !att.display && now >= att.openedAt + LIMITS.helloTimeoutMs) {
        this.safeClose(ws, CLOSE_CODES.unauthorized, 'hello timeout');
      }
    }
    await this.scheduleAlarm();
  }

  // ---------- Handlers ----------

  private async handleHello(ws: WebSocket, att: SocketAttachment, token: string): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (att.pid) return; // Already authenticated; ignore repeats.
    const pid = this.tokenIndex.get(await sha256Base64url(token));
    if (!pid || !this.participants.has(pid)) {
      this.send(ws, { type: 'error', error: 'unauthorized' });
      this.safeClose(ws, CLOSE_CODES.unauthorized, 'unauthorized');
      return;
    }
    ws.serializeAttachment({ ...att, pid } satisfies SocketAttachment);
    meta.emptySince = null;
    if (pid === meta.hostId) meta.hostAwaySince = null;
    await this.persistMeta();

    this.send(ws, { type: 'welcome', you: pid, state: this.stateView() });
    await this.maybeHandOffHost(this.now());
    this.broadcastState();
    await this.scheduleAlarm();
  }

  /** The host makes a big-screen link. The previous one stops working at once. */
  private async handleCreateDisplay(ws: WebSocket, pid: string): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (!this.isHost(pid)) return this.reject(ws, 'not_host');
    const token = randomToken();
    meta.displayHash = await sha256Base64url(token);
    await this.persistMeta();
    for (const other of this.ctx.getWebSockets()) {
      if (this.attachment(other).display) {
        this.safeClose(other, CLOSE_CODES.unauthorized, 'display replaced');
      }
    }
    this.send(ws, { type: 'display_link', token });
  }

  private async handleDisplayHello(
    ws: WebSocket,
    att: SocketAttachment,
    token: string,
  ): Promise<void> {
    const meta = this.meta;
    if (!meta || att.pid || att.display) return;
    if (meta.displayHash === null || (await sha256Base64url(token)) !== meta.displayHash) {
      this.send(ws, { type: 'error', error: 'unauthorized' });
      this.safeClose(ws, CLOSE_CODES.unauthorized, 'unauthorized');
      return;
    }
    ws.serializeAttachment({ ...att, display: true } satisfies SocketAttachment);
    this.send(ws, { type: 'display_welcome', state: this.stateView() });
    await this.scheduleAlarm();
  }

  private async handleKick(ws: WebSocket, pid: string, target: string): Promise<void> {
    if (!this.isHost(pid)) {
      this.send(ws, { type: 'error', error: 'not_host' });
      return;
    }
    const victim = this.participants.get(target);
    if (!victim || target === pid) {
      this.send(ws, { type: 'error', error: 'unknown_participant' });
      return;
    }
    await this.removeParticipant(target, CLOSE_CODES.kicked, 'kicked');
    this.broadcastEvent({ type: 'kicked', name: victim.name });
    this.broadcastState();
    await this.afterMembershipChange();
  }

  private async handleTransfer(ws: WebSocket, pid: string, target: string): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (!this.isHost(pid)) {
      this.send(ws, { type: 'error', error: 'not_host' });
      return;
    }
    if (!this.participants.has(target) || target === pid) {
      this.send(ws, { type: 'error', error: 'unknown_participant' });
      return;
    }
    if (!this.connectedIds().has(target)) {
      this.send(ws, { type: 'error', error: 'not_connected' });
      return;
    }
    meta.hostId = target;
    meta.hostAwaySince = null;
    await this.persistMeta();
    this.broadcastEvent({ type: 'host_changed', hostId: target, auto: false });
    this.broadcastState();
    await this.scheduleAlarm();
  }

  private async handleLeave(pid: string): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    const wasHost = pid === meta.hostId;
    await this.removeParticipant(pid, CLOSE_CODES.left, 'left');
    if (this.participants.size === 0) {
      await this.closeRoom('ended');
      return;
    }
    if (wasHost) {
      const next = this.pickNextHost();
      if (next) {
        meta.hostId = next.id;
        meta.hostAwaySince = this.connectedIds().has(next.id) ? null : this.now();
        await this.persistMeta();
        this.broadcastEvent({ type: 'host_changed', hostId: next.id, auto: true });
      }
    }
    this.broadcastState();
    await this.afterMembershipChange();
  }

  private async handleAddRestaurant(
    ws: WebSocket,
    pid: string,
    msg: Extract<ClientMessage, { type: 'add_restaurant' }>,
  ): Promise<void> {
    const name = normalizeRestaurantName(msg.name);
    if (!name) return this.reject(ws, 'invalid_restaurant');
    const categories = normalizeCategories(msg.categories);
    if (categories === undefined) return this.reject(ws, 'invalid_category');
    const mapsUrl = normalizeMapsUrl(msg.mapsUrl);
    if (mapsUrl === undefined) return this.reject(ws, 'invalid_maps_url');
    if (this.restaurants.size >= LIMITS.maxRestaurants) {
      return this.reject(ws, 'too_many_restaurants');
    }
    const key = restaurantKey(name);
    for (const r of this.restaurants.values()) {
      if (restaurantKey(r.name) === key) return this.reject(ws, 'restaurant_exists');
    }
    const restaurant: Restaurant = {
      id: randomId(),
      name,
      categories,
      mapsUrl,
      addedBy: pid,
      addedAt: this.now(),
    };
    await this.putRestaurant(restaurant);
    this.broadcastState();
    this.broadcastEvent({
      type: 'restaurant_added',
      participantId: pid,
      restaurantId: restaurant.id,
    });
  }

  private async handleRemoveRestaurant(ws: WebSocket, pid: string, id: string): Promise<void> {
    const restaurant = this.restaurants.get(id);
    if (!restaurant) return this.reject(ws, 'unknown_restaurant');
    const byHost = this.isHost(pid);
    // The host can remove anything, preset entries included (for this room
    // only); everyone else only what they added themselves.
    if (!byHost && restaurant.addedBy !== pid) return this.reject(ws, 'not_allowed');

    const clearedBoosts = await this.deleteRestaurant(id);
    this.broadcastState();
    this.broadcastEvent({
      type: 'restaurant_removed',
      name: restaurant.name,
      removedBy: pid,
      byHost: byHost && restaurant.addedBy !== pid,
      clearedBoosts,
    });
  }

  private async handleBoost(ws: WebSocket, pid: string, id: string): Promise<void> {
    const participant = this.participants.get(pid);
    if (!participant) return;
    if (!this.restaurants.has(id)) return this.reject(ws, 'unknown_restaurant');
    if (participant.boost === id) return; // Already boosting this one.
    const moved = participant.boost !== null;
    participant.boost = id;
    await this.ctx.storage.put(`p:${pid}`, participant);
    this.broadcastState();
    this.broadcastEvent({ type: 'boosted', participantId: pid, restaurantId: id, moved });
  }

  private async handleUnboost(pid: string): Promise<void> {
    const participant = this.participants.get(pid);
    if (!participant || participant.boost === null) return;
    participant.boost = null;
    await this.ctx.storage.put(`p:${pid}`, participant);
    this.broadcastState();
  }

  /** Host switches new-place mode; only before the spin, like boosts. */
  private async handleNewPlace(ws: WebSocket, pid: string, on: boolean): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (!this.isHost(pid)) return this.reject(ws, 'not_host');
    if (meta.phase !== 'lobby') return this.reject(ws, 'locked');
    if (meta.newPlace === on) return;
    meta.newPlace = on;
    await this.persistMeta();
    this.broadcastEvent({ type: 'new_place_changed', on });
    this.broadcastState();
  }

  private isVisited(name: string): boolean {
    return this.meta?.visited.includes(restaurantKey(name)) ?? false;
  }

  /** Host pulls the lever. The list and boosts lock and the reel runs. */
  private async handleStartSpin(ws: WebSocket, pid: string): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (!this.isHost(pid)) return this.reject(ws, 'not_host');
    if (meta.phase !== 'lobby') return this.reject(ws, 'locked');
    if (this.restaurants.size < LIMITS.minRestaurantsToSpin) {
      return this.reject(ws, 'not_enough_restaurants');
    }
    await this.runSpin();
  }

  /**
   * Builds the reel from the current restaurants and boosts, picks the
   * winning row with the CSPRNG and tells everyone. Used for the first spin
   * and for every respin.
   */
  private async runSpin(): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    const boosts = new Map<string, number>();
    for (const p of this.participants.values()) {
      if (p.boost && this.restaurants.has(p.boost)) {
        boosts.set(p.boost, (boosts.get(p.boost) ?? 0) + 1);
      }
    }
    const reel = buildReel(
      [...this.restaurants.values()].map((r) => ({
        id: r.id,
        slices: restaurantSlices(boosts.get(r.id) ?? 0, meta.newPlace, this.isVisited(r.name)),
      })),
    );
    const winnerIndex = randomIndex(reel.length);
    meta.phase = 'spinning';
    meta.vote = null;
    meta.spin = {
      number: (meta.spin?.number ?? 0) + 1,
      reel,
      winnerIndex,
      winnerId: reel[winnerIndex] as string,
      startedAt: this.now(),
      durationMs: LIMITS.spinDurationMs,
    };
    await this.persistMeta();
    this.broadcastState();
    await this.scheduleAlarm();
  }

  /**
   * The reel has stopped. Open the respin vote, unless respins are used up,
   * fewer than two restaurants would be left, or nobody is there to vote.
   */
  private async afterSpin(now: number): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    const voters = [...this.connectedIds()];
    const canRespin =
      meta.respins < LIMITS.maxRespins &&
      this.restaurants.size - 1 >= LIMITS.minRestaurantsToSpin &&
      voters.length > 0;
    if (!canRespin) {
      await this.finalize(now);
      return;
    }
    meta.phase = 'voting';
    meta.vote = {
      eligible: voters,
      yes: [],
      no: [],
      startedAt: now,
      durationMs: LIMITS.voteDurationMs,
    };
    await this.persistMeta();
    this.broadcastState();
  }

  private async handleVote(ws: WebSocket, pid: string, choice: 'yes' | 'no'): Promise<void> {
    const meta = this.meta;
    const vote = meta?.vote;
    if (!meta || meta.phase !== 'voting' || !vote) return this.reject(ws, 'no_vote');
    if (!vote.eligible.includes(pid)) return this.reject(ws, 'not_eligible');
    // One vote per participant; changing your mind replaces the earlier vote.
    vote.yes = vote.yes.filter((id) => id !== pid);
    vote.no = vote.no.filter((id) => id !== pid);
    vote[choice].push(pid);
    await this.persistMeta();

    const needs = respinNeeds(vote.eligible.length);
    if (vote.yes.length >= needs) {
      await this.endVote(true);
    } else if (vote.eligible.length - vote.no.length < needs) {
      // Even if everyone left voted yes, it would not be enough.
      await this.endVote(false);
    } else {
      this.broadcastState();
    }
  }

  /** Respin (winner off the wheel, spin again) or final result. */
  private async endVote(respin: boolean): Promise<void> {
    const meta = this.meta;
    const vote = meta?.vote;
    const spin = meta?.spin;
    if (!meta || !vote || !spin) return;
    const winner = this.restaurants.get(spin.winnerId);
    this.broadcastEvent({
      type: 'vote_ended',
      respin,
      yes: vote.yes.length,
      eligible: vote.eligible.length,
      removedName: respin ? (winner?.name ?? null) : null,
    });
    if (!respin) {
      await this.finalize(this.now());
      return;
    }
    meta.respins += 1;
    await this.deleteRestaurant(spin.winnerId);
    await this.runSpin();
  }

  private async finalize(now: number): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    meta.phase = 'result';
    meta.vote = null;
    meta.finalAt = now;
    await this.persistMeta();
    this.broadcastState();
    await this.scheduleAlarm();
    const winner = meta.spin ? this.restaurants.get(meta.spin.winnerId) : undefined;
    if (winner) {
      // Best effort: the room works without it; a retry of the alarm writes nothing twice.
      await recordLunch(this.env.DB, {
        ref: meta.ref,
        at: now,
        name: winner.name,
        categories: winner.categories,
        respins: meta.respins,
        newPlace: meta.newPlace,
      }).catch((err: unknown) =>
        console.error('Could not record lunch', { name: (err as Error).name }),
      );
    }
  }

  /** Removes a restaurant from this room and clears boosts on it. Returns who lost a boost. */
  private async deleteRestaurant(id: string): Promise<string[]> {
    this.restaurants.delete(id);
    await this.ctx.storage.delete(`r:${id}`);
    const cleared: string[] = [];
    for (const p of this.participants.values()) {
      if (p.boost === id) {
        p.boost = null;
        cleared.push(p.id);
        await this.ctx.storage.put(`p:${p.id}`, p);
      }
    }
    return cleared;
  }

  private reject(ws: WebSocket, error: SocketError): void {
    this.send(ws, { type: 'error', error });
  }

  private async seedRestaurants(now: number, menu: readonly MenuItem[]): Promise<void> {
    let order = 0;
    const seen = new Set<string>();
    for (const item of menu.slice(0, LIMITS.maxRestaurants)) {
      const name = normalizeRestaurantName(item.name);
      const categories = normalizeCategories(item.categories);
      const mapsUrl = normalizeMapsUrl(item.mapsUrl);
      // Invalid or duplicate entries are skipped, never stored unchecked.
      if (!name || categories === undefined || mapsUrl === undefined) continue;
      if (seen.has(restaurantKey(name))) continue;
      seen.add(restaurantKey(name));
      await this.putRestaurant({
        id: randomId(),
        name,
        categories,
        mapsUrl,
        addedBy: null,
        addedAt: now + order++,
      });
    }
  }

  private async putRestaurant(restaurant: Restaurant): Promise<void> {
    this.restaurants.set(restaurant.id, restaurant);
    await this.ctx.storage.put(`r:${restaurant.id}`, restaurant);
  }

  private async handleDisconnect(closing: WebSocket): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    const pid = this.attachment(closing).pid;
    const connected = this.connectedIds(closing);
    let changed = false;
    if (pid && pid === meta.hostId && !connected.has(pid) && meta.hostAwaySince === null) {
      meta.hostAwaySince = this.now();
      changed = true;
    }
    if (connected.size === 0 && meta.emptySince === null) {
      meta.emptySince = this.now();
      changed = true;
    }
    if (changed) await this.persistMeta();
    if (pid) this.broadcastState(closing);
    await this.scheduleAlarm();
  }

  /** Moves the host role to the longest-present connected participant once the host has been away too long. */
  private async maybeHandOffHost(now: number): Promise<void> {
    const meta = this.meta;
    if (!meta || meta.hostAwaySince === null) return;
    if (now < meta.hostAwaySince + LIMITS.hostAwayMs) return;
    const connected = this.connectedIds();
    if (connected.has(meta.hostId)) {
      meta.hostAwaySince = null;
      await this.persistMeta();
      return;
    }
    const next = this.sortedParticipants().find((p) => p.id !== meta.hostId && connected.has(p.id));
    if (!next) return; // Nobody connected to hand over to; the empty-room timer applies.
    meta.hostId = next.id;
    meta.hostAwaySince = null;
    await this.persistMeta();
    this.broadcastEvent({ type: 'host_changed', hostId: next.id, auto: true });
    this.broadcastState();
  }

  private async afterMembershipChange(): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    if (this.connectedIds().size === 0 && meta.emptySince === null) {
      meta.emptySince = this.now();
      await this.persistMeta();
    }
    await this.scheduleAlarm();
  }

  // ---------- Room lifecycle ----------

  private async closeRoom(reason: CloseReason): Promise<void> {
    const code = this.meta?.code;
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { type: 'closed', reason });
      this.safeClose(ws, CLOSE_CODES.roomClosed, reason);
    }
    this.meta = null;
    this.participants.clear();
    this.tokenIndex.clear();
    this.restaurants.clear();
    // Delete everything: tokens of a closed room can never be used again, and
    // the same code can later start a completely fresh room.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (code) {
      // Best effort: a stale row expires on its own.
      await unregisterRoom(this.env.DB, code).catch((err: unknown) =>
        console.error('Could not unregister room', { name: (err as Error).name }),
      );
    }
  }

  private async scheduleAlarm(): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    const now = this.now();
    const deadlines = [meta.expiresAt];
    if (meta.phase === 'spinning' && meta.spin) {
      deadlines.push(meta.spin.startedAt + meta.spin.durationMs);
    }
    if (meta.phase === 'voting' && meta.vote) {
      deadlines.push(meta.vote.startedAt + meta.vote.durationMs);
    }
    if (meta.phase === 'result' && meta.finalAt !== null) {
      deadlines.push(meta.finalAt + LIMITS.closeAfterResultMs);
    }
    if (meta.emptySince !== null) deadlines.push(meta.emptySince + LIMITS.emptyRoomMs);
    if (meta.hostAwaySince !== null && meta.hostAwaySince + LIMITS.hostAwayMs > now) {
      deadlines.push(meta.hostAwaySince + LIMITS.hostAwayMs);
    }
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws);
      if (!att.pid && !att.display) deadlines.push(att.openedAt + LIMITS.helloTimeoutMs);
    }
    await this.ctx.storage.setAlarm(Math.max(Math.min(...deadlines), now + 50));
  }

  // ---------- Participants ----------

  private async newParticipant(
    name: string,
    now: number,
  ): Promise<{ participant: Participant; token: string }> {
    const token = randomToken();
    const participant: Participant = {
      id: randomId(),
      name,
      tokenHash: await sha256Base64url(token),
      joinedAt: now,
      boost: null,
    };
    this.participants.set(participant.id, participant);
    this.tokenIndex.set(participant.tokenHash, participant.id);
    await this.ctx.storage.put(`p:${participant.id}`, participant);
    return { participant, token };
  }

  private async removeParticipant(pid: string, code: number, reason: string): Promise<void> {
    const participant = this.participants.get(pid);
    if (!participant) return;
    this.participants.delete(pid);
    this.tokenIndex.delete(participant.tokenHash);
    if (this.meta?.vote) {
      this.meta.vote.yes = this.meta.vote.yes.filter((id) => id !== pid);
      this.meta.vote.no = this.meta.vote.no.filter((id) => id !== pid);
      await this.persistMeta();
    }
    await this.ctx.storage.delete(`p:${pid}`);
    for (const ws of this.ctx.getWebSockets()) {
      if (this.attachment(ws).pid === pid) {
        ws.serializeAttachment({ ...this.attachment(ws), pid: null } satisfies SocketAttachment);
        this.safeClose(ws, code, reason);
      }
    }
  }

  private pickNextHost(): Participant | undefined {
    const connected = this.connectedIds();
    const sorted = this.sortedParticipants();
    return sorted.find((p) => connected.has(p.id)) ?? sorted[0];
  }

  private sortedParticipants(): Participant[] {
    return [...this.participants.values()].sort((a, b) => a.joinedAt - b.joinedAt);
  }

  private isHost(pid: string): boolean {
    return this.meta?.hostId === pid;
  }

  /** Participant ids with at least one open, authenticated socket. */
  private connectedIds(exclude?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude || ws.readyState !== OPEN) continue;
      const pid = this.attachment(ws).pid;
      if (pid && this.participants.has(pid)) ids.add(pid);
    }
    return ids;
  }

  // ---------- Messaging ----------

  private stateView(exclude?: WebSocket): RoomState {
    const meta = this.meta;
    if (!meta) throw new Error('No room');
    const connected = this.connectedIds(exclude);
    return {
      code: meta.code,
      hostId: meta.hostId,
      createdAt: meta.createdAt,
      expiresAt: meta.expiresAt,
      participants: this.sortedParticipants().map((p) => ({
        id: p.id,
        name: p.name,
        connected: connected.has(p.id),
        joinedAt: p.joinedAt,
        boost: p.boost,
      })),
      restaurants: [...this.restaurants.values()]
        .sort((a, b) => a.addedAt - b.addedAt)
        .map((r) => ({
          id: r.id,
          name: r.name,
          categories: r.categories,
          mapsUrl: r.mapsUrl,
          addedBy: r.addedBy,
          visited: this.isVisited(r.name),
        })),
      phase: meta.phase,
      respinsLeft: Math.max(0, LIMITS.maxRespins - meta.respins),
      newPlace: meta.newPlace,
      vote: meta.vote
        ? {
            eligible: meta.vote.eligible,
            yes: meta.vote.yes,
            no: meta.vote.no,
            durationMs: meta.vote.durationMs,
            remainingMs: Math.max(0, meta.vote.startedAt + meta.vote.durationMs - this.now()),
          }
        : null,
      closesInMs:
        meta.phase === 'result' && meta.finalAt !== null
          ? Math.max(0, meta.finalAt + LIMITS.closeAfterResultMs - this.now())
          : null,
      spin: meta.spin
        ? {
            number: meta.spin.number,
            reel: meta.spin.reel,
            winnerIndex: meta.spin.winnerIndex,
            winnerId: meta.spin.winnerId,
            durationMs: meta.spin.durationMs,
            elapsedMs: Math.min(
              meta.spin.durationMs,
              Math.max(0, this.now() - meta.spin.startedAt),
            ),
          }
        : null,
    };
  }

  private broadcastState(exclude?: WebSocket): void {
    if (!this.meta) return;
    this.broadcast({ type: 'state', state: this.stateView(exclude) }, exclude);
  }

  private broadcastEvent(event: RoomEvent): void {
    this.broadcast({ type: 'event', event });
  }

  private broadcast(message: ServerMessage, exclude?: WebSocket): void {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude || ws.readyState !== OPEN) continue;
      const att = this.attachment(ws);
      if (att.display || (att.pid && this.participants.has(att.pid))) this.sendRaw(ws, data);
    }
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    this.sendRaw(ws, JSON.stringify(message));
  }

  private sendRaw(ws: WebSocket, data: string): void {
    try {
      ws.send(data);
    } catch {
      // Socket already closing; the close handler cleans up.
    }
  }

  private safeClose(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private attachment(ws: WebSocket): SocketAttachment {
    const att = ws.deserializeAttachment() as SocketAttachment | null;
    return att ?? { pid: null, openedAt: 0 };
  }

  private withinBudget(ws: WebSocket): boolean {
    const now = this.now();
    const budget = this.budgets.get(ws);
    if (!budget || now - budget.windowStart >= LIMITS.socketWindowMs) {
      this.budgets.set(ws, { windowStart: now, count: 1 });
      return true;
    }
    budget.count += 1;
    return budget.count <= LIMITS.socketMessagesPerWindow;
  }

  private async persistMeta(): Promise<void> {
    if (this.meta) await this.ctx.storage.put('meta', this.meta);
  }
}
