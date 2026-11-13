import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CATEGORY_MAX,
  MAPS_URL_MAX,
  RESTAURANT_NAME_MAX,
  normalizeCategory,
  normalizeMapsUrl,
  normalizeRestaurantName,
} from '@lunchrad/shared';
import { nl } from '../i18n/nl';
import { bindInput } from './forms';

export interface NewRestaurant {
  name: string;
  category: string | null;
  mapsUrl: string | null;
}

/**
 * Bottom sheet for adding a restaurant, built on the native <dialog>: focus
 * is trapped, Escape closes it, and the rest of the page is inert while open.
 * Runs the same rules as the server, so mistakes show up before sending.
 */
@Component({
  selector: 'app-add-restaurant-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="add-title" (close)="reset()">
      <form (submit)="submit($event)" novalidate>
        <h2 id="add-title">{{ t.title }}</h2>

        <label for="add-name">{{ t.name }}</label>
        <input
          id="add-name"
          autocomplete="off"
          [attr.maxlength]="limits.name"
          [value]="name()"
          (input)="bind(name, $event)"
          [attr.aria-invalid]="error() === 'name' ? 'true' : null"
          aria-describedby="add-name-hint"
        />
        <p id="add-name-hint" class="hint">{{ t.nameHint }}</p>

        <label for="add-category">{{ t.category }}</label>
        <input
          id="add-category"
          list="add-category-options"
          autocomplete="off"
          [attr.maxlength]="limits.category"
          [value]="category()"
          (input)="bind(category, $event)"
          [attr.aria-invalid]="error() === 'category' ? 'true' : null"
          aria-describedby="add-category-hint"
        />
        <datalist id="add-category-options">
          @for (c of categories; track c) {
            <option [value]="c"></option>
          }
        </datalist>
        <p id="add-category-hint" class="hint">{{ t.categoryHint }}</p>

        <label for="add-maps">{{ t.maps }}</label>
        <input
          id="add-maps"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          [attr.maxlength]="limits.maps"
          [value]="mapsUrl()"
          (input)="bind(mapsUrl, $event)"
          [attr.aria-invalid]="error() === 'maps' ? 'true' : null"
          aria-describedby="add-maps-hint"
        />
        <p id="add-maps-hint" class="hint">{{ t.mapsHint }}</p>

        <p class="error" role="alert">{{ errorText() }}</p>
        <div class="row">
          <button type="submit" class="primary">{{ t.submit }}</button>
          <button type="button" class="secondary" (click)="close()">{{ t.cancel }}</button>
        </div>
      </form>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(28rem, 100%);
      max-width: 100%;
      margin: auto auto 0;
      padding: 1.5rem 1rem max(1.5rem, env(safe-area-inset-bottom));
      border: 2px solid var(--ink);
      border-bottom: 0;
      border-radius: 1.25rem 1.25rem 0 0;
      background: var(--surface);
      color: var(--ink);
    }
    dialog::backdrop {
      background: rgb(18 48 41 / 0.55);
    }
    dialog[open] {
      animation: rise 180ms ease-out;
    }
    @keyframes rise {
      from {
        transform: translateY(1.5rem);
        opacity: 0;
      }
    }
    @media (min-width: 40rem) {
      dialog {
        margin: auto;
        border-bottom: 2px solid var(--ink);
        border-radius: 1.25rem;
      }
    }
    form {
      margin: 0;
    }
  `,
})
export class AddRestaurantDialog {
  readonly added = output<NewRestaurant>();
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  protected readonly t = nl.restaurants.dialog;
  protected readonly categories = nl.restaurants.categories;
  protected readonly limits = {
    name: RESTAURANT_NAME_MAX,
    category: CATEGORY_MAX,
    maps: MAPS_URL_MAX,
  };
  /** Typing in any field clears the previous error. */
  protected bind(target: ReturnType<typeof signal<string>>, event: Event): void {
    this.error.set(null);
    bindInput(target, event);
  }
  protected readonly name = signal('');
  protected readonly category = signal('');
  protected readonly mapsUrl = signal('');
  protected readonly error = signal<'name' | 'category' | 'maps' | null>(null);

  protected errorText(): string {
    switch (this.error()) {
      case 'name':
        return nl.socketErrors.invalid_restaurant;
      case 'category':
        return nl.socketErrors.invalid_category;
      case 'maps':
        return nl.socketErrors.invalid_maps_url;
      default:
        return '';
    }
  }

  open(): void {
    this.dialog().nativeElement.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected reset(): void {
    this.name.set('');
    this.category.set('');
    this.mapsUrl.set('');
    this.error.set(null);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const name = normalizeRestaurantName(this.name());
    if (!name) return this.error.set('name');
    const category = normalizeCategory(this.category());
    if (category === undefined) return this.error.set('category');
    const mapsUrl = normalizeMapsUrl(this.mapsUrl());
    if (mapsUrl === undefined) return this.error.set('maps');
    this.added.emit({ name, category, mapsUrl });
    this.close();
  }
}
