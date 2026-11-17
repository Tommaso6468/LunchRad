import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { restaurantKey, type AdminPreset, type RestaurantView } from '@lunchrad/shared';
import { AdminApi, AdminFailure } from '../core/admin-api';
import { Toasts } from '../core/toasts';
import { nl } from '../i18n/nl';

/**
 * Full-screen sheet in the room, for admins: pick the lists a restaurant
 * should be in, then save at the bottom. The room stays connected behind it.
 */
@Component({
  selector: 'app-save-to-list-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog class="save-sheet" aria-labelledby="save-title" (close)="reset()">
      <div class="inner">
        <div class="row">
          <button type="button" class="secondary" (click)="close()">{{ t.back }}</button>
        </div>
        <h2 id="save-title" class="page-title">{{ t.title }}</h2>
        @if (restaurant(); as r) {
          <p class="name">{{ r.name }}</p>
          @if (r.categories.length) {
            <ul class="tags">
              @for (c of r.categories; track c) {
                <li>{{ c }}</li>
              }
            </ul>
          }
        }
        <p class="muted">{{ t.intro }}</p>

        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
        @if (presets(); as list) {
          <fieldset class="lists">
            <legend class="visually-hidden">{{ t.title }}</legend>
            @for (p of list; track p.id) {
              <label class="check">
                <input type="checkbox" [checked]="chosen().has(p.id)" (change)="toggle(p.id)" />
                <span>
                  {{ p.name }}
                  <span class="hint">{{ t.count(p.restaurantIds.length) }}</span>
                </span>
              </label>
            }
          </fieldset>
        } @else if (!error()) {
          <p class="muted" role="status">{{ t.loading }}</p>
        }
      </div>
      <div class="save-bar">
        <button
          type="button"
          class="primary"
          [disabled]="busy() || presets() === null"
          (click)="save()"
        >
          {{ t.save }}
        </button>
      </div>
    </dialog>
  `,
  styles: `
    .save-sheet {
      width: 100%;
      max-width: 100%;
      height: 100%;
      max-height: 100%;
      margin: 0;
      padding: max(1.5rem, env(safe-area-inset-top)) 1rem 7rem;
      border: 0;
      background: var(--bg);
      color: var(--ink);
    }
    .save-sheet::backdrop {
      background: var(--bg);
    }
    .inner {
      max-width: 28rem;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.9rem;
    }
    .name {
      font-family: var(--font-display);
      font-size: 1.8rem;
      line-height: 1.1;
      color: var(--ticket-text);
      overflow-wrap: anywhere;
    }
    .lists {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin: 0;
      padding: 0.75rem 1rem;
      background: var(--surface);
      border: 2px solid var(--ink);
      border-radius: 1rem;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 3rem;
      font-weight: 700;
    }
    .check input {
      width: 1.4rem;
      min-height: 1.4rem;
      accent-color: var(--ticket);
    }
    .check .hint {
      display: block;
      font-weight: 400;
    }
    /* Floating save button, always reachable at the bottom. */
    .save-bar {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 0.75rem 1rem max(0.75rem, env(safe-area-inset-bottom));
      background: var(--bg);
      border-top: 2px solid var(--line);
    }
    .save-bar .primary {
      display: block;
      width: 100%;
      max-width: 28rem;
      margin: 0 auto;
    }
  `,
})
export class SaveToListDialog {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly api = inject(AdminApi);
  private readonly toasts = inject(Toasts);
  protected readonly t = nl.saveToList;
  protected readonly restaurant = signal<RestaurantView | null>(null);
  protected readonly presets = signal<AdminPreset[] | null>(null);
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly key = computed(() => {
    const r = this.restaurant();
    return r ? restaurantKey(r.name) : '';
  });

  async open(restaurant: RestaurantView): Promise<void> {
    this.restaurant.set(restaurant);
    const el = this.dialog().nativeElement;
    if (!el.open) el.showModal();
    try {
      const overview = await this.api.overview();
      // Already in the catalogue (by name)? Then its current lists are ticked.
      const existing = overview.restaurants.find((r) => restaurantKey(r.name) === this.key());
      this.chosen.set(new Set(existing?.presetIds ?? []));
      this.presets.set(overview.presets);
    } catch (error) {
      this.fail(error);
    }
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected reset(): void {
    this.restaurant.set(null);
    this.presets.set(null);
    this.chosen.set(new Set());
    this.error.set('');
    this.busy.set(false);
  }

  protected toggle(id: string): void {
    this.chosen.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected async save(): Promise<void> {
    const r = this.restaurant();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.saveFromRoom({
        restaurant: { name: r.name, categories: r.categories, mapsUrl: r.mapsUrl },
        presetIds: [...this.chosen()],
      });
      this.toasts.show(this.t.saved(r.name, this.chosen().size));
      this.close();
    } catch (error) {
      this.fail(error);
      this.busy.set(false);
    }
  }

  private fail(error: unknown): void {
    const code = error instanceof AdminFailure ? error.code : 'server_error';
    this.error.set(nl.admin.errors[code]);
  }
}
