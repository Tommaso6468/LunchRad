import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { AdminRoom } from '@lunchrad/shared';
import { Toasts } from '../../core/toasts';
import { nl } from '../../i18n/nl';
import { RoomCode } from '../../ui/room-code';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-rooms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RoomCode],
  template: `
    <p class="muted">{{ t.intro }}</p>
    <div class="row">
      <button type="button" class="secondary" (click)="load()" [disabled]="loading()">
        {{ t.refresh }}
      </button>
    </div>
    @if (rooms().length === 0 && !loading()) {
      <p class="placeholder">{{ t.empty }}</p>
    } @else {
      <ul class="admin-list">
        @for (r of rooms(); track r.code) {
          <li>
            <div class="item-main">
              <app-room-code [code]="r.code" [label]="codeLabel" size="small" />
              <span class="hint">
                {{ t.phase[r.phase] }}, {{ t.people(r.connected, r.participants) }},
                {{ t.closesIn(minutesLeft(r)) }}
              </span>
            </div>
            <div class="actions">
              <button
                type="button"
                class="small danger"
                [attr.aria-label]="t.closeLabel(r.code)"
                (click)="close(r)"
              >
                {{ t.close }}
              </button>
            </div>
          </li>
        }
      </ul>
    }
  `,
})
export class AdminRooms {
  private readonly store = inject(AdminStore);
  private readonly toasts = inject(Toasts);
  protected readonly t = nl.admin.rooms;
  protected readonly codeLabel = nl.room.codeLabel;
  protected readonly rooms = signal<AdminRoom[]>([]);
  protected readonly loading = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.rooms.set(await this.store.api.rooms());
    } catch (error) {
      this.store.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected minutesLeft(r: AdminRoom): number {
    return Math.max(1, Math.ceil((r.expiresAt - Date.now()) / 60_000));
  }

  protected async close(r: AdminRoom): Promise<void> {
    if (!confirm(this.t.confirmClose(r.code))) return;
    try {
      await this.store.api.closeRoom(r.code);
      this.toasts.show(this.t.closed(r.code));
    } catch (error) {
      this.store.fail(error);
    }
    await this.load();
  }
}
