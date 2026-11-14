import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { AuditEntry } from '@lunchrad/shared';
import { nl } from '../../i18n/nl';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-audit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">{{ t.intro }}</p>
    @if (entries().length === 0 && !loading()) {
      <p class="placeholder">{{ t.empty }}</p>
    } @else {
      <ol class="admin-list audit">
        @for (e of entries(); track e.id) {
          <li>
            <div class="item-main">
              <span>
                <strong>{{ describe(e) }}</strong>
              </span>
              <span class="hint">{{ when(e.at) }}, {{ e.adminEmail }}</span>
            </div>
          </li>
        }
      </ol>
    }
    @if (nextBefore() !== null) {
      <div class="row">
        <button type="button" class="secondary" (click)="load()" [disabled]="loading()">
          {{ t.more }}
        </button>
      </div>
    }
  `,
})
export class AdminAudit {
  private readonly store = inject(AdminStore);
  protected readonly t = nl.admin.audit;
  protected readonly entries = signal<AuditEntry[]>([]);
  protected readonly nextBefore = signal<number | null>(null);
  protected readonly loading = signal(false);
  private readonly format = new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  constructor() {
    void this.load(true);
  }

  protected async load(first = false): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.store.api.audit(first ? null : this.nextBefore());
      this.entries.update((list) => (first ? page.entries : [...list, ...page.entries]));
      this.nextBefore.set(page.nextBefore);
    } catch (error) {
      this.store.fail(error);
    } finally {
      this.loading.set(false);
    }
  }

  protected when(at: number): string {
    return this.format.format(at);
  }

  /** "Restaurant Pho 99 toegevoegd". Names come from the stored detail, shown as text only. */
  protected describe(e: AuditEntry): string {
    const entity = this.t.entity[e.entity] ?? e.entity;
    const action = this.t.action[e.action] ?? e.action;
    const detail = e.detail;
    const after = detail['after'];
    const name =
      typeof detail['name'] === 'string'
        ? detail['name']
        : typeof after === 'string'
          ? after
          : after &&
              typeof after === 'object' &&
              typeof (after as { name?: unknown }).name === 'string'
            ? (after as { name: string }).name
            : e.entity === 'room'
              ? (e.entityId ?? '')
              : '';
    return [entity, name, action].filter(Boolean).join(' ');
  }
}
