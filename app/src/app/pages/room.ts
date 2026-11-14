import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  normalizeName,
  normalizeRoomCode,
  type RoomEvent,
  type RoomState,
  type SocketError,
} from '@lunchrad/shared';
import { Api } from '../core/api';
import { RoomConnection } from '../core/room-connection';
import { DeviceStore } from '../core/storage';
import { Feedback } from '../core/feedback';
import { Toasts } from '../core/toasts';
import { nl } from '../i18n/nl';
import { bindInput, errorText } from '../ui/forms';
import { AddRestaurantDialog, type NewRestaurant } from '../ui/add-restaurant-dialog';
import { DisplayLinkDialog } from '../ui/display-link-dialog';
import { ParticipantList } from '../ui/participant-list';
import { QrCode } from '../ui/qr-code';
import { RestaurantList } from '../ui/restaurant-list';
import { SpinOverlay } from '../ui/spin-overlay';
import { RoomCode } from '../ui/room-code';
import { TeamKeyForm } from './team-key-form';

@Component({
  selector: 'app-room',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RoomCode,
    QrCode,
    TeamKeyForm,
    RouterLink,
    RestaurantList,
    AddRestaurantDialog,
    ParticipantList,
    SpinOverlay,
    DisplayLinkDialog,
  ],
  template: `
    @let validCode = roomCode();
    @if (!validCode) {
      <section class="panel">
        <h1 class="page-title">{{ t.finished.title }}</h1>
        <p>{{ t.join.invalidCode }}</p>
        <a routerLink="/" class="button secondary">{{ t.finished.home }}</a>
      </section>
    } @else if (connection(); as conn) {
      @if (conn.finished(); as reason) {
        <section class="panel">
          <h1 class="page-title">{{ t.finished.title }}</h1>
          <p>{{ t.finished.reasons[reason] }}</p>
          <a routerLink="/" class="button primary">{{ t.finished.home }}</a>
        </section>
      } @else {
        <header class="room-head">
          <h1 class="visually-hidden">{{ t.room.heading(validCode) }}</h1>
          <app-room-code [code]="validCode" [label]="t.room.codeLabel" size="small" />
          <div class="head-actions">
            <button type="button" class="secondary small" (click)="share(validCode)">
              {{ t.room.share }}
            </button>
            <button
              type="button"
              class="secondary small"
              [attr.aria-pressed]="feedback.enabled()"
              (click)="feedback.toggle()"
            >
              {{ t.room.sound }}
            </button>
            <button
              type="button"
              class="secondary small"
              [attr.aria-expanded]="showQr()"
              aria-controls="room-qr"
              (click)="showQr.set(!showQr())"
            >
              {{ showQr() ? t.room.hideQr : t.room.showQr }}
            </button>
            @if (conn.isHost()) {
              <button type="button" class="secondary small" (click)="askDisplayLink()">
                {{ t.display.button }}
              </button>
            }
            @if (minutesLeft(); as minutes) {
              <p class="muted closes">{{ t.room.closesIn(minutes) }}</p>
            }
          </div>
          @if (showQr()) {
            <div id="room-qr" class="qr">
              <app-qr-code [value]="shareUrl(validCode)" [label]="t.room.qrAlt(validCode)" />
            </div>
          }
        </header>

        @if (conn.status() === 'reconnecting') {
          <p class="banner" role="status">{{ t.room.reconnecting }}</p>
        } @else if (conn.status() === 'connecting') {
          <p class="banner" role="status">{{ t.room.connecting }}</p>
        }

        @if (conn.state(); as state) {
          @if (resultRestaurant(); as winner) {
            <section class="result-card" aria-labelledby="room-result-title">
              <p id="room-result-title" class="muted">{{ t.reel.resultTitle }}</p>
              <p class="winner">{{ winner.name }}</p>
              @if (winner.mapsUrl) {
                <a
                  class="button primary"
                  [href]="winner.mapsUrl"
                  target="_blank"
                  rel="noopener noreferrer external"
                  >{{ t.reel.maps }}</a
                >
              }
            </section>
          }
          <div class="tabs" role="tablist" [attr.aria-label]="t.room.tabsLabel">
            <button
              type="button"
              role="tab"
              id="tab-restaurants"
              aria-controls="panel-restaurants"
              [attr.aria-selected]="tab() === 'restaurants'"
              [attr.tabindex]="tab() === 'restaurants' ? 0 : -1"
              (click)="tab.set('restaurants')"
              (keydown)="tabKeys($event)"
            >
              {{ t.restaurants.tab(state.restaurants.length) }}
            </button>
            <button
              type="button"
              role="tab"
              id="tab-people"
              aria-controls="panel-people"
              [attr.aria-selected]="tab() === 'people'"
              [attr.tabindex]="tab() === 'people' ? 0 : -1"
              (click)="tab.set('people')"
              (keydown)="tabKeys($event)"
            >
              {{ t.room.peopleTab(state.participants.length) }}
            </button>
          </div>

          <div
            id="panel-restaurants"
            role="tabpanel"
            aria-labelledby="tab-restaurants"
            [hidden]="tab() !== 'restaurants'"
          >
            <app-restaurant-list
              [state]="state"
              [you]="conn.you()"
              [isHost]="conn.isHost()"
              [locked]="state.phase !== 'lobby'"
              (toggleBoost)="toggleBoost($event)"
              (remove)="removeRestaurant($event)"
              (addRequested)="addDialog.open()"
              (newPlace)="setNewPlace($event)"
            />
          </div>
          <app-add-restaurant-dialog #addDialog (added)="addRestaurant($event)" />
          <app-display-link-dialog />

          <div
            id="panel-people"
            role="tabpanel"
            aria-labelledby="tab-people"
            [hidden]="tab() !== 'people'"
          >
            <app-participant-list
              [state]="state"
              [you]="conn.you()"
              [isHost]="conn.isHost()"
              (makeHost)="makeHost($event)"
              (kick)="kick($event.id, $event.name)"
            />
          </div>

          <app-spin-overlay
            #spinOverlay
            [state]="state"
            [isHost]="conn.isHost()"
            [you]="conn.you()"
            (pull)="startSpin()"
            (vote)="vote($event)"
          />
          <div class="spin-bar">
            <p>{{ spinBarText(state.phase, conn.isHost()) }}</p>
            <button type="button" class="primary" (click)="spinOverlay.open()">
              {{
                state.phase === 'result'
                  ? t.reel.openResult
                  : state.phase === 'voting'
                    ? t.reel.openVote
                    : t.reel.open
              }}
            </button>
          </div>

          <footer class="room-foot">
            @if (conn.isHost()) {
              <button type="button" class="danger" (click)="endRoom()">{{ t.room.end }}</button>
            } @else {
              <button type="button" class="secondary" (click)="leave()">{{ t.room.leave }}</button>
            }
          </footer>
        }
      }
    } @else if (!hasTeam()) {
      <app-team-key-form (done)="hasTeam.set(true)" />
    } @else {
      <section class="panel" aria-labelledby="join-room-title">
        <app-room-code [code]="validCode" [label]="t.room.codeLabel" size="small" />
        <h1 id="join-room-title" class="page-title">{{ t.join.joinRoomTitle(validCode) }}</h1>
        <form (submit)="join($event, validCode)" novalidate>
          <label for="room-join-name">{{ t.nameLabel }}</label>
          <input
            id="room-join-name"
            autocomplete="nickname"
            maxlength="20"
            [value]="name()"
            (input)="bind(name, $event)"
            aria-describedby="room-join-hint"
          />
          <p id="room-join-hint" class="hint">{{ t.nameHint }}</p>
          <p class="error" role="alert">{{ joinError() }}</p>
          <button type="submit" class="primary" [disabled]="busy()">{{ t.join.submit }}</button>
        </form>
      </section>
    }
  `,
})
export class Room {
  /** Route parameter (bound by the router). */
  readonly code = input.required<string>();

  private readonly api = inject(Api);
  private readonly store = inject(DeviceStore);
  private readonly toasts = inject(Toasts);
  protected readonly feedback = inject(Feedback);

  protected readonly t = nl;
  protected readonly bind = bindInput;
  protected readonly roomCode = computed(() => normalizeRoomCode(this.code()));
  protected readonly connection = signal<RoomConnection | null>(null);
  protected readonly hasTeam = signal(this.store.teamToken() !== null);
  protected readonly name = signal(this.store.lastName());
  protected readonly busy = signal(false);
  protected readonly joinError = signal('');
  protected readonly showQr = signal(false);
  protected readonly tab = signal<'restaurants' | 'people'>('restaurants');

  /** Arrow keys move between the two tabs (WAI-ARIA tabs pattern). */
  protected tabKeys(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = this.tab() === 'restaurants' ? 'people' : 'restaurants';
    this.tab.set(next);
    document.getElementById(next === 'people' ? 'tab-people' : 'tab-restaurants')?.focus();
  }
  private readonly now = signal(Date.now());
  private warnedClosingSoon = false;

  /** When the room closes: its 30-minute lifetime, or 5 minutes after the final result. */
  private readonly closesAt = computed(() => {
    const state = this.connection()?.state();
    if (!state) return null;
    return state.closesInMs === null
      ? state.expiresAt
      : Math.min(state.expiresAt, Date.now() + state.closesInMs);
  });

  protected readonly minutesLeft = computed(() => {
    const closesAt = this.closesAt();
    if (closesAt === null) return null;
    // The clock signal ticks every 15 s and can be older than closesAt itself.
    return Math.max(1, Math.ceil((closesAt - Math.max(this.now(), Date.now())) / 60_000));
  });

  constructor() {
    const clock = setInterval(() => {
      this.now.set(Date.now());
      this.warnIfClosingSoon();
    }, 15_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      this.connection()?.dispose();
    });

    // Connect as soon as there are stored credentials for this room.
    effect(() => {
      const code = this.roomCode();
      if (!code) return;
      untracked(() => {
        const creds = this.store.room(code);
        if (creds && !this.connection()) this.connect(creds);
      });
    });

    // Forget credentials once the room is over for this device.
    effect(() => {
      const conn = this.connection();
      const code = this.roomCode();
      if (conn?.finished() && code) untracked(() => this.store.forgetRoom(code));
    });
  }

  protected shareUrl(code: string): string {
    return `${location.origin}/r/${code}`;
  }

  protected async share(code: string): Promise<void> {
    const url = this.shareUrl(code);
    try {
      if (navigator.share) {
        await navigator.share({ title: nl.appName, text: nl.room.shareText(code), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      this.toasts.show(nl.room.copied);
    } catch {
      // The user cancelled the share sheet, or clipboard access was denied.
    }
  }

  protected async join(event: Event, code: string): Promise<void> {
    event.preventDefault();
    this.joinError.set('');
    const name = normalizeName(this.name());
    if (!name) {
      this.joinError.set(nl.errors.invalid_name);
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const creds = await this.api.joinRoom(code, name);
      this.store.saveName(name);
      this.store.saveRoom(creds);
      this.connect(creds);
    } catch (error) {
      this.joinError.set(errorText(error));
      if (!this.store.teamToken()) this.hasTeam.set(false);
    } finally {
      this.busy.set(false);
    }
  }

  /** The winning restaurant once the reel has finished, for the banner above the list. */
  protected readonly resultRestaurant = computed(() => {
    const state = this.connection()?.state();
    if (!state || state.phase !== 'result' || !state.spin) return null;
    return state.restaurants.find((r) => r.id === state.spin?.winnerId) ?? null;
  });

  protected spinBarText(phase: string, isHost: boolean): string {
    if (phase === 'spinning') return nl.reel.spinning;
    if (phase === 'voting') return nl.vote.barText;
    if (phase === 'result') return nl.reel.finalBar;
    return isHost ? nl.reel.hostHint : nl.reel.waiting;
  }

  protected startSpin(): void {
    this.connection()?.send({ type: 'start_spin' });
  }

  private readonly displayDialog = viewChild(DisplayLinkDialog);

  protected askDisplayLink(): void {
    this.connection()?.send({ type: 'create_display' });
  }

  private showDisplayLink(code: string, token: string): void {
    this.displayDialog()?.show(`${location.origin}/scherm/${code}#${token}`);
  }

  protected setNewPlace(on: boolean): void {
    this.connection()?.send({ type: 'set_new_place', on });
  }

  protected vote(choice: 'yes' | 'no'): void {
    this.connection()?.send({ type: 'vote', choice });
  }

  protected toggleBoost(restaurantId: string | null): void {
    this.connection()?.send(restaurantId ? { type: 'boost', restaurantId } : { type: 'unboost' });
  }

  protected addRestaurant(restaurant: NewRestaurant): void {
    this.connection()?.send({ type: 'add_restaurant', ...restaurant });
  }

  protected removeRestaurant(restaurant: { id: string; name: string }): void {
    if (confirm(nl.restaurants.confirmRemove(restaurant.name))) {
      this.connection()?.send({ type: 'remove_restaurant', restaurantId: restaurant.id });
    }
  }

  protected makeHost(participantId: string): void {
    this.connection()?.send({ type: 'transfer_host', participantId });
  }

  protected kick(participantId: string, name: string): void {
    if (confirm(nl.room.confirmRemove(name))) {
      this.connection()?.send({ type: 'kick', participantId });
    }
  }

  protected endRoom(): void {
    if (confirm(nl.room.confirmEnd)) this.connection()?.send({ type: 'end_room' });
  }

  protected leave(): void {
    if (confirm(nl.room.confirmLeave)) this.connection()?.send({ type: 'leave' });
  }

  private connect(creds: { code: string; participantId: string; token: string }): void {
    this.connection.set(
      new RoomConnection(
        creds,
        () => this.store.teamToken(),
        (event) => this.onEvent(event),
        (error) => this.onSocketError(error),
        { onDisplayLink: (token) => this.showDisplayLink(creds.code, token) },
      ),
    );
  }

  private onEvent(event: RoomEvent): void {
    const conn = this.connection();
    switch (event.type) {
      case 'host_changed': {
        if (event.hostId === conn?.you()) {
          this.toasts.show(nl.toasts.youAreHost);
        } else {
          const name = conn?.state()?.participants.find((p) => p.id === event.hostId)?.name;
          if (name) this.toasts.show(nl.toasts.newHost(name));
        }
        break;
      }
      case 'new_place_changed':
        // The host just flipped the switch; everyone else hears about it.
        if (!conn?.isHost()) {
          this.toasts.show(event.on ? nl.toasts.newPlaceOn : nl.toasts.newPlaceOff);
        }
        break;
      case 'kicked':
        this.toasts.show(nl.toasts.kicked(event.name));
        break;
      case 'boosted': {
        // No toast for your own actions: you just saw the button change.
        if (event.participantId === conn?.you()) break;
        const state = conn?.state();
        const who = this.participantName(state, event.participantId);
        const where = state?.restaurants.find((r) => r.id === event.restaurantId)?.name;
        if (!who || !where) break;
        this.toasts.showGrouped(
          'boost',
          event.moved ? nl.toasts.boostMoved(who, where) : nl.toasts.boosted(who, where),
          nl.toasts.manyBoosts,
        );
        break;
      }
      case 'restaurant_added': {
        if (event.participantId === conn?.you()) break;
        const state = conn?.state();
        const who = this.participantName(state, event.participantId);
        const what = state?.restaurants.find((r) => r.id === event.restaurantId)?.name;
        if (who && what) {
          this.toasts.showGrouped('added', nl.toasts.added(who, what), nl.toasts.manyAdded);
        }
        break;
      }
      case 'restaurant_removed': {
        const you = conn?.you();
        if (you && event.clearedBoosts.includes(you) && event.removedBy !== you) {
          this.toasts.show(nl.toasts.yourBoostGone(event.name));
        } else if (event.removedBy !== you) {
          this.toasts.show(
            event.byHost ? nl.toasts.removedByHost(event.name) : nl.toasts.removed(event.name),
          );
        }
        break;
      }
      case 'vote_ended':
        this.toasts.show(
          event.respin
            ? nl.toasts.respin(event.removedName ?? '')
            : nl.toasts.noRespin(event.yes, event.eligible),
        );
        break;
    }
  }

  private onSocketError(error: SocketError): void {
    this.toasts.show(nl.socketErrors[error]);
  }

  private participantName(state: RoomState | null | undefined, id: string): string | undefined {
    return state?.participants.find((p) => p.id === id)?.name;
  }

  private warnIfClosingSoon(): void {
    const closesAt = this.closesAt();
    const state = this.connection()?.state();
    // After the final result the room closes in 5 minutes by design; the result card says so.
    if (closesAt === null || this.warnedClosingSoon || state?.phase === 'result') return;
    const left = closesAt - Date.now();
    if (left > 0 && left <= 5 * 60_000) {
      this.warnedClosingSoon = true;
      this.toasts.show(nl.toasts.closingSoon);
    }
  }
}
