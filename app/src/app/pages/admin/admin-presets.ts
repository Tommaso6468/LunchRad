import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  PRESET_MAX_RESTAURANTS,
  normalizeRestaurantName,
  type AdminPreset,
} from '@lunchrad/shared';
import { nl } from '../../i18n/nl';
import { bindInput } from '../../ui/forms';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-presets',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="muted">{{ t.intro }}</p>
    <form class="inline-form" (submit)="add($event)" novalidate>
      <label for="new-preset">{{ t.newLabel }}</label>
      <div class="row">
        <input
          id="new-preset"
          autocomplete="off"
          maxlength="40"
          [value]="newName()"
          (input)="bind(newName, $event)"
        />
        <button type="submit" class="secondary" [disabled]="store.busy()">{{ t.add }}</button>
      </div>
    </form>

    <ul class="admin-list">
      @for (p of presets(); track p.id) {
        <li class="preset">
          <div class="item-main">
            <span class="name">
              {{ p.name }}
              @if (p.isDefault) {
                <span class="badge host">{{ t.default }}</span>
              }
            </span>
            <span class="hint">{{ t.count(p.restaurantIds.length) }}</span>
          </div>
          <div class="actions wrap">
            <button
              type="button"
              class="small"
              [attr.aria-expanded]="choosing() === p.id"
              [attr.aria-controls]="'choose-' + p.id"
              [attr.aria-label]="t.chooseLabel(p.name)"
              (click)="toggleChoose(p)"
            >
              {{ t.choose }}
            </button>
            @if (!p.isDefault) {
              <button type="button" class="small" (click)="makeDefault(p)">
                {{ t.makeDefault }}
              </button>
            }
            <button type="button" class="small" (click)="rename(p)">{{ t.rename }}</button>
            @if (!p.isDefault) {
              <button type="button" class="small danger" (click)="remove(p)">{{ t.remove }}</button>
            }
          </div>

          @if (choosing() === p.id) {
            <fieldset class="choose" [id]="'choose-' + p.id">
              <legend class="visually-hidden">{{ t.chooseLabel(p.name) }}</legend>
              <p class="hint" aria-live="polite">{{ t.selected(selected().length, max) }}</p>
              @for (r of restaurants(); track r.id) {
                <label class="check">
                  <input
                    type="checkbox"
                    [checked]="selected().includes(r.id)"
                    [disabled]="!selected().includes(r.id) && selected().length >= max"
                    (change)="toggleRestaurant(r.id)"
                  />
                  <span>{{ r.name }}</span>
                </label>
              }
              <div class="row">
                <button type="button" class="primary" (click)="saveChoice(p)">
                  {{ t.saveChoice }}
                </button>
                <button type="button" class="secondary" (click)="choosing.set(null)">
                  {{ t.cancel }}
                </button>
              </div>
            </fieldset>
          }
        </li>
      }
    </ul>
  `,
})
export class AdminPresets {
  protected readonly store = inject(AdminStore);
  protected readonly t = nl.admin.presets;
  protected readonly bind = bindInput;
  protected readonly max = PRESET_MAX_RESTAURANTS;
  protected readonly newName = signal('');
  protected readonly choosing = signal<string | null>(null);
  protected readonly selected = signal<string[]>([]);
  protected readonly presets = computed(() => this.store.overview()?.presets ?? []);
  protected readonly restaurants = computed(() => this.store.overview()?.restaurants ?? []);

  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    const name = normalizeRestaurantName(this.newName());
    if (!name) {
      this.store.error.set(nl.admin.errors.invalid_preset_name);
      return;
    }
    if (await this.store.run(() => this.store.api.addPreset(name), nl.admin.saved)) {
      this.newName.set('');
    }
  }

  protected toggleChoose(p: AdminPreset): void {
    if (this.choosing() === p.id) {
      this.choosing.set(null);
      return;
    }
    this.selected.set([...p.restaurantIds]);
    this.choosing.set(p.id);
  }

  protected toggleRestaurant(id: string): void {
    this.selected.update((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
    );
  }

  protected async saveChoice(p: AdminPreset): Promise<void> {
    const ids = this.selected();
    if (
      await this.store.run(() => this.store.api.setPresetRestaurants(p.id, ids), nl.admin.saved)
    ) {
      this.choosing.set(null);
    }
  }

  protected async makeDefault(p: AdminPreset): Promise<void> {
    await this.store.run(() => this.store.api.makeDefault(p.id), nl.admin.saved);
  }

  protected async rename(p: AdminPreset): Promise<void> {
    const answer = prompt(this.t.renamePrompt, p.name);
    if (answer === null) return;
    const name = normalizeRestaurantName(answer);
    if (!name) {
      this.store.error.set(nl.admin.errors.invalid_preset_name);
      return;
    }
    await this.store.run(() => this.store.api.renamePreset(p.id, name), nl.admin.saved);
  }

  protected async remove(p: AdminPreset): Promise<void> {
    if (!confirm(this.t.confirmRemove(p.name))) return;
    await this.store.run(() => this.store.api.deletePreset(p.id), nl.admin.saved);
  }
}
