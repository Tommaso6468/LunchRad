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
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { normalizeName, normalizeRoomCode, type RoomEvent } from '@lunchrad/shared';
import { Api } from '../core/api';
import { RoomConnection } from '../core/room-connection';
import { DeviceStore } from '../core/storage';
import { Toasts } from '../core/toasts';
import { nl } from '../i18n/nl';
import { bindInput, errorText } from '../ui/forms';
import { QrCode } from '../ui/qr-code';
import { RoomCode } from '../ui/room-code';
import { TeamKeyForm } from './team-key-form';

@Component({
  selector: 'app-room',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoomCode, QrCode, TeamKeyForm, RouterLink],
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
          <app-room-code [code]="validCode" [label]="t.room.codeLabel" />
          <div class="row">
            <button type="button" class="secondary" (click)="share(validCode)">
              {{ t.room.share }}
            </button>
            <button
              type="button"
              class="secondary"
              [attr.aria-expanded]="showQr()"
              aria-controls="room-qr"
              (click)="showQr.set(!showQr())"
            >
              {{ showQr() ? t.room.hideQr : t.room.showQr }}
            </button>
          </div>
          @if (showQr()) {
            <div id="room-qr" class="qr">
              <app-qr-code [value]="shareUrl(validCode)" [label]="t.room.qrAlt(validCode)" />
            </div>
          }
          @if (minutesLeft(); as minutes) {
            <p class="muted">{{ t.room.closesIn(minutes) }}</p>
          }
        </header>

        @if (conn.status() === 'reconnecting') {
          <p class="banner" role="status">{{ t.room.reconnecting }}</p>
        } @else if (conn.status() === 'connecting') {
          <p class="banner" role="status">{{ t.room.connecting }}</p>
        }

        @if (conn.state(); as state) {
          <section class="panel" aria-labelledby="people-title">
            <h2 id="people-title">{{ t.room.participants(state.participants.length) }}</h2>
            <ul class="people">
              @for (p of state.participants; track p.id) {
                <li [class.offline]="!p.connected">
                  <span class="person">
                    <span class="name">{{ p.name }}</span>
                    @if (p.id === state.hostId) {
                      <span class="badge host">{{ t.room.host }}</span>
                    }
                    @if (p.id === conn.you()) {
                      <span class="badge">{{ t.room.you }}</span>
                    }
                    @if (!p.connected) {
                      <span class="status">{{ t.room.offline }}</span>
                    }
                  </span>
                  @if (conn.isHost() && p.id !== conn.you()) {
                    <span class="actions">
                      @if (p.connected) {
                        <button
                          type="button"
                          class="small"
                          [attr.aria-label]="t.room.makeHost(p.name)"
                          (click)="makeHost(p.id)"
                        >
                          {{ t.room.makeHostShort }}
                        </button>
                      }
                      <button
                        type="button"
                        class="small danger"
                        [attr.aria-label]="t.room.remove(p.name)"
                        (click)="kick(p.id, p.name)"
                      >
                        {{ t.room.removeShort }}
                      </button>
                    </span>
                  }
                </li>
              }
            </ul>
          </section>

          <p class="placeholder">{{ t.room.restaurantsSoon }}</p>

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

  protected readonly t = nl;
  protected readonly bind = bindInput;
  protected readonly roomCode = computed(() => normalizeRoomCode(this.code()));
  protected readonly connection = signal<RoomConnection | null>(null);
  protected readonly hasTeam = signal(this.store.teamToken() !== null);
  protected readonly name = signal(this.store.lastName());
  protected readonly busy = signal(false);
  protected readonly joinError = signal('');
  protected readonly showQr = signal(false);
  private readonly now = signal(Date.now());
  private warnedClosingSoon = false;

  protected readonly minutesLeft = computed(() => {
    const state = this.connection()?.state();
    if (!state) return null;
    return Math.max(1, Math.ceil((state.expiresAt - this.now()) / 60_000));
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
      case 'kicked':
        this.toasts.show(nl.toasts.kicked(event.name));
        break;
    }
  }

  private warnIfClosingSoon(): void {
    const state = this.connection()?.state();
    if (!state || this.warnedClosingSoon) return;
    const left = state.expiresAt - Date.now();
    if (left > 0 && left <= 5 * 60_000) {
      this.warnedClosingSoon = true;
      this.toasts.show(nl.toasts.closingSoon);
    }
  }
}
