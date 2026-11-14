import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  type OnInit,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  normalizeRoomCode,
  respinNeeds,
  restaurantSlices,
  type RoomEvent,
  type RoomState,
} from '@lunchrad/shared';
import { confettiBurst } from '../core/confetti';
import { RoomConnection } from '../core/room-connection';
import { DeviceStore } from '../core/storage';
import { Toasts } from '../core/toasts';
import { nl } from '../i18n/nl';
import { QrCode } from '../ui/qr-code';
import { Reel } from '../ui/reel';
import { RoomCode } from '../ui/room-code';
import { ThemeToggle } from '../ui/theme-toggle';
import { TeamKeyForm } from './team-key-form';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

interface Odds {
  id: string;
  name: string;
  percent: number;
  boosts: number;
  isNew: boolean;
}

/** WakeLockSentinel, without depending on lib.dom having it. */
interface WakeLock {
  release(): Promise<void>;
}

/**
 * /scherm/CODE#token: the room on a TV or laptop. It follows the room's
 * phases (lobby, reel, vote, result) and never needs a touch. The display
 * token in the URL fragment never reaches the server in a request line or a
 * Referer; it is moved to sessionStorage and removed from the address bar.
 * The server treats this connection as read-only (see Room.handleDisplayHello).
 */
@Component({
  selector: 'app-big-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoomCode, QrCode, Reel, TeamKeyForm, RouterLink, ThemeToggle],
  template: `
    @let validCode = roomCode();
    @if (!validCode || !token()) {
      <section class="panel message">
        <p>{{ t.noToken }}</p>
        <a routerLink="/" class="button secondary">{{ t.home }}</a>
      </section>
    } @else if (!hasTeam()) {
      <app-team-key-form (done)="onTeam()" />
    } @else if (connection()?.finished(); as reason) {
      <section class="panel message">
        <p class="big">{{ reason === 'gone' ? t.replaced : t.closed }}</p>
      </section>
    } @else if (state(); as s) {
      <div class="screen" [attr.data-phase]="s.phase">
        <header class="bar">
          <span class="mark">{{ appName }}</span>
          @if (s.phase !== 'lobby') {
            <h1 class="visually-hidden">{{ heading(validCode) }}</h1>
            <app-room-code [code]="validCode" [label]="codeLabel" size="small" />
          }
          <span class="status">{{ statusLine(s) }}</span>
          <app-theme-toggle />
          @if (!fullscreen()) {
            <button type="button" class="secondary small" (click)="goFullscreen()">
              {{ t.fullscreen }}
            </button>
          }
        </header>

        @switch (s.phase) {
          @case ('lobby') {
            <section class="lobby">
              <div class="join">
                <h1 class="title">{{ t.lobbyTitle }}</h1>
                <app-room-code [code]="validCode" [label]="codeLabel" />
                <div class="qr-card">
                  <app-qr-code [value]="joinUrl()" [label]="qrLabel(validCode)" />
                </div>
                <p class="url">{{ t.scan }} {{ joinUrlText() }}</p>
              </div>
              <div class="side">
                <h2>{{ t.onWheel }}</h2>
                <ul class="odds" [class.two]="odds().length > 10">
                  @for (o of odds(); track o.id) {
                    <li>
                      <span class="o-name">
                        {{ o.name }}
                        @if (o.isNew) {
                          <span class="chip new">{{ newTag }}</span>
                        }
                        @if (o.boosts) {
                          <span class="chip">{{ t.boosts(o.boosts) }}</span>
                        }
                      </span>
                      <span class="pct">{{ o.percent }}%</span>
                    </li>
                  }
                </ul>
                <h2>{{ t.joined(s.participants.length) }}</h2>
                @if (s.participants.length === 0) {
                  <p class="muted">{{ t.nobodyYet }}</p>
                } @else {
                  <ul class="people">
                    @for (p of s.participants; track p.id) {
                      <li [class.away]="!p.connected">{{ p.name }}</li>
                    }
                  </ul>
                }
              </div>
            </section>
          }
          @case ('spinning') {
            <section class="spin">
              <div class="reel-box">
                <app-reel
                  [names]="names()"
                  [preview]="preview()"
                  [spin]="s.spin"
                  [showLever]="false"
                  (finished)="landed.set($event)"
                />
              </div>
              <div class="side">
                <h2>{{ t.onWheel }}</h2>
                <ul class="odds" [class.two]="odds().length > 10">
                  @for (o of odds(); track o.id) {
                    <li>
                      <span class="o-name">{{ o.name }}</span>
                      <span class="pct">{{ o.percent }}%</span>
                    </li>
                  }
                </ul>
              </div>
            </section>
          }
          @default {
            <section class="result">
              <p class="label">{{ s.phase === 'result' ? t.final : t.candidate }}</p>
              <p class="winner">{{ winnerName(s) }}</p>
              @if (winnerTags(s).length) {
                <ul class="tags big-tags">
                  @for (c of winnerTags(s); track c) {
                    <li>{{ c }}</li>
                  }
                </ul>
              }
              @if (s.vote; as v) {
                <div class="vote">
                  <p class="vote-title">{{ t.voteTitle }} {{ t.voteHint }}</p>
                  <div class="timer" aria-hidden="true">
                    <span [style.width.%]="(voteLeft() / v.durationMs) * 100"></span>
                  </div>
                  <p class="tally">
                    {{ t.voteTally(v.yes.length, needs(v.eligible.length)) }} ·
                    {{ seconds(voteLeft()) }} s
                  </p>
                </div>
              }
            </section>
          }
        }
      </div>
    } @else {
      <p class="muted message" role="status">{{ waiting }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .message {
      max-width: 40rem;
      margin: 10vh auto;
      text-align: center;
    }
    .message .big {
      font-size: 1.6rem;
    }
    .screen {
      display: flex;
      flex-direction: column;
      gap: 2.5vh;
      min-height: 92vh;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 2vw;
    }
    .mark {
      font-family: var(--font-display);
      font-size: 2rem;
      color: var(--ticket-text);
    }
    .status {
      flex: 1;
      text-align: right;
      color: var(--muted);
      font-size: clamp(1rem, 1.4vw, 1.6rem);
    }
    h2 {
      font-size: clamp(1.4rem, 2vw, 2.4rem);
    }
    .lobby,
    .spin {
      flex: 1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
      gap: 4vw;
      align-items: start;
    }
    .join {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2.5vh;
    }
    .title {
      font-family: var(--font-display);
      font-weight: 400;
      font-size: clamp(3rem, 6vw, 7rem);
      line-height: 1;
    }
    .join app-room-code {
      zoom: 1.8;
    }
    .qr-card app-qr-code {
      display: block;
      width: 100%;
      max-width: none;
    }
    .qr-card {
      width: min(24vw, 38vh);
      padding: 1rem;
      background: #ffffff;
      border: 3px solid var(--ink);
      border-radius: 1rem;
    }
    .url {
      font-family: var(--font-code);
      font-size: clamp(1rem, 1.5vw, 1.8rem);
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: 1.5vh;
    }
    .odds {
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: clamp(1.1rem, 1.7vw, 2.1rem);
    }
    .odds.two {
      columns: 2;
      column-gap: 3vw;
    }
    .odds li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 0.35em 0;
      border-bottom: 1px solid var(--line);
      break-inside: avoid;
    }
    .o-name {
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .pct {
      font-family: var(--font-code);
      font-weight: 600;
      white-space: nowrap;
    }
    .chip {
      margin-left: 0.4em;
      padding: 0 0.45em;
      border: 2px solid var(--line);
      border-radius: 999px;
      font-size: 0.65em;
      font-weight: 700;
      vertical-align: middle;
    }
    .chip.new {
      background: var(--brass);
      color: var(--ink-on-brass);
      border-color: var(--brass);
    }
    .people {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      list-style: none;
      margin: 0;
      padding: 0;
      font-size: clamp(1.1rem, 1.6vw, 2rem);
      font-weight: 700;
    }
    .people li {
      padding: 0.2em 0.8em;
      background: var(--surface);
      border: 2px solid var(--ink);
      border-radius: 999px;
      animation: pop 380ms cubic-bezier(0.3, 1.6, 0.5, 1);
    }
    .people li.away {
      color: var(--muted);
      border-style: dashed;
    }
    @keyframes pop {
      from {
        transform: scale(0.4);
        opacity: 0;
      }
    }
    .reel-box {
      zoom: 1.9;
    }
    .result {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3vh;
      text-align: center;
    }
    .result .label {
      font-size: clamp(1.6rem, 2.6vw, 3.2rem);
      color: var(--muted);
    }
    .result .winner {
      font-family: var(--font-display);
      font-size: clamp(4rem, 11vw, 13rem);
      line-height: 1;
      color: var(--ticket-text);
      overflow-wrap: anywhere;
      animation: pop 420ms cubic-bezier(0.3, 1.6, 0.5, 1);
    }
    .big-tags {
      justify-content: center;
      gap: 0.6rem;
    }
    .big-tags li {
      padding: 0.15em 0.8em;
      border-width: 2px;
      color: var(--ink);
      font-size: clamp(1.1rem, 1.8vw, 2.2rem);
    }
    .vote {
      width: min(60vw, 60rem);
      display: flex;
      flex-direction: column;
      gap: 1.2vh;
    }
    .vote-title,
    .tally {
      font-size: clamp(1.3rem, 2vw, 2.6rem);
      font-weight: 700;
    }
    .timer {
      height: 1.4rem;
      border: 3px solid var(--ink);
      border-radius: 999px;
      overflow: hidden;
      background: var(--bg);
    }
    .timer span {
      display: block;
      height: 100%;
      background: var(--brass);
    }
    @media (prefers-reduced-motion: reduce) {
      .people li,
      .result .winner {
        animation: none;
      }
    }
  `,
})
export class BigScreen implements OnInit {
  readonly code = input.required<string>();

  private readonly store = inject(DeviceStore);
  private readonly toasts = inject(Toasts);
  protected readonly t = nl.display;
  protected readonly appName = nl.appName;
  protected readonly codeLabel = nl.room.codeLabel;
  protected readonly newTag = nl.restaurants.newPlace.tag;
  protected readonly waiting = nl.room.connecting;
  protected readonly roomCode = computed(() => normalizeRoomCode(this.code()));
  protected readonly token = signal<string | null>(null);
  protected readonly hasTeam = signal(this.store.teamToken() !== null);
  protected readonly connection = signal<RoomConnection | null>(null);
  protected readonly fullscreen = signal(false);
  protected readonly landed = signal<string | null>(null);
  private readonly now = signal(Date.now());
  private readonly voteReceived = signal(Date.now());
  private wakeLock: WakeLock | null = null;
  private watchedSpin = 0;
  private votedSpin = 0;
  private burst = 0;

  protected readonly state = computed<RoomState | null>(() => this.connection()?.state() ?? null);
  protected readonly names = computed(
    () => new Map((this.state()?.restaurants ?? []).map((r) => [r.id, r.name] as const)),
  );
  protected readonly preview = computed(() => (this.state()?.restaurants ?? []).map((r) => r.id));
  protected readonly joinUrl = computed(() => `${location.origin}/r/${this.roomCode() ?? ''}`);
  protected readonly joinUrlText = computed(() => `${location.host}/r/${this.roomCode() ?? ''}`);

  protected readonly odds = computed<Odds[]>(() => {
    const s = this.state();
    if (!s) return [];
    const rows = s.restaurants.map((r) => {
      const boosts = s.participants.filter((p) => p.boost === r.id).length;
      return {
        id: r.id,
        name: r.name,
        boosts,
        slices: restaurantSlices(boosts, s.newPlace, r.visited),
        isNew: s.newPlace && !r.visited,
      };
    });
    const total = rows.reduce((sum, r) => sum + r.slices, 0) || 1;
    return rows.map((r) => ({ ...r, percent: Math.round((r.slices / total) * 100) }));
  });

  protected readonly voteLeft = computed(() => {
    const vote = this.state()?.vote;
    if (!vote) return 0;
    return Math.max(0, vote.remainingMs - (this.now() - this.voteReceived()));
  });

  ngOnInit(): void {
    // Inputs (the room code) are available from here on, not in the constructor.
    this.readToken();
  }

  constructor() {
    const clock = setInterval(() => this.now.set(Date.now()), 250);
    const onFullscreen = () => this.fullscreen.set(document.fullscreenElement !== null);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void this.keepAwake();
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('visibilitychange', onVisible);
    void this.keepAwake();

    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('visibilitychange', onVisible);
      void this.wakeLock?.release().catch(() => undefined);
      this.connection()?.dispose();
    });

    effect(() => {
      if (this.hasTeam() && this.token() && this.roomCode()) untracked(() => this.connect());
    });

    // Countdown restarts from every snapshot the server sends.
    effect(() => {
      void this.state()?.vote;
      this.voteReceived.set(Date.now());
    });

    // Confetti when the result appears on a spin this screen watched, and for the final decision.
    effect(() => {
      const s = this.state();
      const spin = s?.spin;
      if (!s || !spin) return;
      if (s.phase === 'spinning') {
        this.watchedSpin = spin.number;
        return;
      }
      if (s.phase === 'voting') this.votedSpin = spin.number;
      if (this.watchedSpin !== spin.number) return;
      const firstTime = this.burst !== spin.number;
      const finalAfterVote = s.phase === 'result' && this.votedSpin === spin.number;
      if (firstTime || finalAfterVote) {
        this.burst = spin.number;
        if (finalAfterVote) this.votedSpin = 0;
        untracked(() => confettiBurst());
      }
    });
  }

  protected onTeam(): void {
    this.hasTeam.set(true);
  }

  protected heading(code: string): string {
    return nl.room.heading(code);
  }

  protected qrLabel(code: string): string {
    return nl.room.qrAlt(code);
  }

  protected needs(eligible: number): number {
    return respinNeeds(eligible);
  }

  protected seconds(ms: number): number {
    return Math.ceil(ms / 1000);
  }

  protected winnerName(s: RoomState): string {
    return s.restaurants.find((r) => r.id === s.spin?.winnerId)?.name ?? '';
  }

  protected winnerTags(s: RoomState): string[] {
    return s.restaurants.find((r) => r.id === s.spin?.winnerId)?.categories ?? [];
  }

  /** When the room closes, fixed when the state arrives (closesInMs is relative to then). */
  private readonly closesAt = computed(() => {
    const s = this.state();
    if (!s) return 0;
    return s.closesInMs === null ? s.expiresAt : Date.now() + s.closesInMs;
  });

  protected statusLine(s: RoomState): string {
    if (s.phase === 'spinning') return this.t.spinning;
    // The clock signal can lag up to 250 ms behind the moment closesAt was fixed.
    const now = Math.max(this.now(), Date.now());
    return this.t.closesIn(Math.max(1, Math.ceil((this.closesAt() - now) / 60_000)));
  }

  protected async goFullscreen(): Promise<void> {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      // Not allowed (some TVs): the page still works.
    }
  }

  /** Keep the screen on. Released by the browser when the tab is hidden; asked again on return. */
  private async keepAwake(): Promise<void> {
    const nav = navigator as unknown as {
      wakeLock?: { request(type: 'screen'): Promise<WakeLock> };
    };
    try {
      this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      // Not supported or not allowed (battery saver): ignore.
    }
  }

  private readToken(): void {
    const code = this.roomCode();
    if (!code) return;
    const key = `lunchrad.display.${code}`;
    const fromHash = location.hash.slice(1);
    if (TOKEN.test(fromHash)) {
      try {
        sessionStorage.setItem(key, fromHash);
      } catch {
        // Storage blocked: the token only lives in this page.
      }
      // Out of the address bar, the history and any screenshot of the URL.
      history.replaceState(history.state, '', location.pathname);
      this.token.set(fromHash);
      return;
    }
    try {
      const stored = sessionStorage.getItem(key);
      if (stored && TOKEN.test(stored)) this.token.set(stored);
    } catch {
      // Ignore.
    }
  }

  private connect(): void {
    const code = this.roomCode();
    const token = this.token();
    if (!code || !token || this.connection()) return;
    this.connection.set(
      new RoomConnection(
        { code, participantId: '', token },
        () => this.store.teamToken(),
        (event) => this.onEvent(event),
        () => undefined,
        { display: true },
      ),
    );
  }

  private onEvent(event: RoomEvent): void {
    const s = this.state();
    const name = (id: string) => s?.participants.find((p) => p.id === id)?.name;
    const place = (id: string) => s?.restaurants.find((r) => r.id === id)?.name;
    switch (event.type) {
      case 'boosted': {
        const who = name(event.participantId);
        const where = place(event.restaurantId);
        if (who && where) {
          this.toasts.showGrouped(
            'boost',
            event.moved ? nl.toasts.boostMoved(who, where) : nl.toasts.boosted(who, where),
            nl.toasts.manyBoosts,
          );
        }
        break;
      }
      case 'restaurant_added': {
        const who = name(event.participantId);
        const what = place(event.restaurantId);
        if (who && what) {
          this.toasts.showGrouped('added', nl.toasts.added(who, what), nl.toasts.manyAdded);
        }
        break;
      }
      case 'new_place_changed':
        this.toasts.show(event.on ? nl.toasts.newPlaceOn : nl.toasts.newPlaceOff);
        break;
      case 'vote_ended':
        this.toasts.show(
          event.respin
            ? nl.toasts.respin(event.removedName ?? '')
            : nl.toasts.noRespin(event.yes, event.eligible),
        );
        break;
      default:
        break;
    }
  }
}
