import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { TeamKeyStatus } from '@lunchrad/shared';
import { Toasts } from '../../core/toasts';
import { nl } from '../../i18n/nl';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-team-key',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">{{ t.intro }}</p>
    @if (status(); as s) {
      <p>
        @if (s.source === 'secret') {
          {{ t.fromSecret }}
        } @else {
          {{ t.rotatedAt(when(s.rotatedAt), s.rotatedBy ?? '') }}
        }
      </p>
    }
    @if (newKey(); as key) {
      <section class="new-key" aria-labelledby="new-key-title">
        <p id="new-key-title" class="muted">{{ t.newKey }}</p>
        <p class="key">{{ key }}</p>
        <p class="hint">{{ t.showOnce }}</p>
        <div class="row">
          <button type="button" class="secondary" (click)="copy(key)">{{ t.copy }}</button>
        </div>
      </section>
    }
    <div class="row">
      <button type="button" class="danger" (click)="rotate()" [disabled]="busy()">
        {{ t.rotate }}
      </button>
    </div>
  `,
  styles: `
    .new-key {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 1rem;
      border: 3px solid var(--ink);
      border-radius: 1rem;
      background: var(--bg);
    }
    .key {
      font-family: var(--font-code);
      font-weight: 600;
      font-size: 1.35rem;
      letter-spacing: 0.04em;
      overflow-wrap: anywhere;
      user-select: all;
    }
  `,
})
export class AdminTeamKey {
  private readonly store = inject(AdminStore);
  private readonly toasts = inject(Toasts);
  protected readonly t = nl.admin.teamKey;
  protected readonly status = signal<TeamKeyStatus | null>(null);
  protected readonly newKey = signal<string | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  protected when(at: number | null): string {
    return at === null
      ? ''
      : new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long', timeStyle: 'short' }).format(at);
  }

  private async load(): Promise<void> {
    try {
      this.status.set(await this.store.api.teamKeyStatus());
    } catch (error) {
      this.store.fail(error);
    }
  }

  protected async rotate(): Promise<void> {
    if (!confirm(this.t.confirmRotate)) return;
    this.busy.set(true);
    try {
      this.newKey.set(await this.store.api.rotateTeamKey());
      await this.load();
    } catch (error) {
      this.store.fail(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(key);
      this.toasts.show(this.t.copied);
    } catch {
      // Clipboard blocked: the key is selectable on screen.
    }
  }
}
