import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { HistoryEntry } from '@lunchrad/shared';
import { Toasts } from '../../core/toasts';
import { nl } from '../../i18n/nl';
import { AdminStore } from './admin-store';

/** Lunch history behind "Eerdere lunches" and new-place mode: remove single entries or all. */
@Component({
  selector: 'app-admin-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">{{ t.intro }}</p>
    @if (entries().length === 0 && !loading()) {
      <p class="placeholder">{{ t.empty }}</p>
    } @else {
      <div class="row">
        <button type="button" class="danger" (click)="clear()">{{ t.clear }}</button>
      </div>
      <ol class="admin-list">
        @for (e of entries(); track e.id) {
          <li>
            <div class="item-main">
              <span class="name">{{ e.name }}</span>
              <span class="hint">{{ when(e.decidedAt) }}</span>
            </div>
            <div class="actions">
              <button
                type="button"
                class="small danger"
                [attr.aria-label]="t.removeLabel(e.name, when(e.decidedAt))"
                (click)="remove(e)"
              >
                {{ t.remove }}
              </button>
            </div>
          </li>
        }
      </ol>
      @if (nextBefore() !== null) {
        <div class="row">
          <button type="button" class="secondary" (click)="load()" [disabled]="loading()">
            {{ t.more }}
          </button>
        </div>
      }
    }
  `,
})
export class AdminHistory {
  private readonly store = inject(AdminStore);
  private readonly toasts = inject(Toasts);
  protected readonly t = nl.admin.history;
  protected readonly entries = signal<HistoryEntry[]>([]);
  protected readonly nextBefore = signal<number | null>(null);
  protected readonly loading = signal(false);
  private readonly format = new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  constructor() {
    void this.load(true);
  }

  protected when(at: number): string {
    return this.format.format(at);
  }

  protected async load(first = false): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.store.api.history(first ? null : this.nextBefore());
      this.entries.update((list) => (first ? page.entries : [...list, ...page.entries]));
      this.nextBefore.set(page.nextBefore);
    } catch (error) {
      this.store.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected async remove(e: HistoryEntry): Promise<void> {
    if (!confirm(this.t.confirmRemove(e.name, this.when(e.decidedAt)))) return;
    try {
      await this.store.api.deleteHistory(e.id);
      this.entries.update((list) => list.filter((x) => x.id !== e.id));
      this.toasts.show(this.t.removed);
    } catch (error) {
      this.store.fail(error);
    }
  }

  protected async clear(): Promise<void> {
    if (!confirm(this.t.confirmClear)) return;
    try {
      await this.store.api.clearHistory();
      this.entries.set([]);
      this.nextBefore.set(null);
      this.toasts.show(this.t.cleared);
    } catch (error) {
      this.store.fail(error);
    }
  }
}
