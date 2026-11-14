import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type { AdminRestaurant } from '@lunchrad/shared';
import { nl } from '../../i18n/nl';
import { AddRestaurantDialog, type NewRestaurant } from '../../ui/add-restaurant-dialog';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-restaurants',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AddRestaurantDialog],
  template: `
    <p class="muted">{{ t.intro }}</p>
    <div class="row">
      <button type="button" class="primary" (click)="startAdd()" [disabled]="store.busy()">
        {{ t.add }}
      </button>
    </div>
    @if (restaurants().length === 0) {
      <p class="placeholder">{{ t.empty }}</p>
    } @else {
      <ul class="admin-list">
        @for (r of restaurants(); track r.id) {
          <li>
            <div class="item-main">
              <span class="name">{{ r.name }}</span>
              @if (r.categories.length) {
                <ul class="tags">
                  @for (c of r.categories; track c) {
                    <li>{{ c }}</li>
                  }
                </ul>
              }
              <span class="hint">{{ t.inLists(r.presetIds.length) }}</span>
            </div>
            <div class="actions">
              <button
                type="button"
                class="small"
                [attr.aria-label]="t.editLabel(r.name)"
                (click)="startEdit(r)"
              >
                {{ t.edit }}
              </button>
              <button
                type="button"
                class="small danger"
                [attr.aria-label]="t.removeLabel(r.name)"
                (click)="remove(r)"
              >
                {{ t.remove }}
              </button>
            </div>
          </li>
        }
      </ul>
    }
    <app-add-restaurant-dialog
      [heading]="editing() ? t.editTitle : null"
      [submitLabel]="editing() ? t.save : null"
      (added)="save($event)"
    />
  `,
})
export class AdminRestaurants {
  protected readonly store = inject(AdminStore);
  protected readonly t = nl.admin.restaurants;
  protected readonly editing = signal<AdminRestaurant | null>(null);
  protected readonly restaurants = computed(() => this.store.overview()?.restaurants ?? []);

  private readonly dialog = viewChild.required(AddRestaurantDialog);

  protected startAdd(): void {
    this.editing.set(null);
    this.dialog().open();
  }

  protected startEdit(r: AdminRestaurant): void {
    this.editing.set(r);
    this.dialog().open({ name: r.name, categories: r.categories, mapsUrl: r.mapsUrl });
  }

  protected async save(input: NewRestaurant): Promise<void> {
    const editing = this.editing();
    await this.store.run(
      () =>
        editing
          ? this.store.api.updateRestaurant(editing.id, input)
          : this.store.api.addRestaurant(input),
      editing ? nl.admin.saved : this.t.added(input.name),
    );
  }

  protected async remove(r: AdminRestaurant): Promise<void> {
    if (!confirm(this.t.confirmRemove(r.name, r.presetIds.length))) return;
    await this.store.run(() => this.store.api.deleteRestaurant(r.id), this.t.removed(r.name));
  }
}
