import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { LIMITS, type RoomState } from '@lunchrad/shared';
import { nl } from '../i18n/nl';

interface Row {
  id: string;
  name: string;
  categories: string[];
  mapsUrl: string | null;
  slices: number;
  boosters: string[];
  boostedByYou: boolean;
  canRemove: boolean;
}

/**
 * The restaurants on the wheel, as a list: reading names on a spinning wheel
 * is hard, so this is where people decide. Each row shows its share of the
 * wheel, so the effect of boosts is visible without the wheel.
 */
@Component({
  selector: 'app-restaurant-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-labelledby="restaurants-title">
      <h2 id="restaurants-title" class="visually-hidden">{{ t.title(rows().length) }}</h2>
      <p class="hint">{{ locked() ? t.locked : t.howBoostWorks }}</p>

      @if (rows().length === 0) {
        <p class="empty">{{ t.empty }}</p>
      } @else {
        <ul class="restaurants">
          @for (r of rows(); track r.id) {
            <li [class.mine]="r.boostedByYou" [class.open]="expanded() === r.id">
              <div class="line">
                <button
                  type="button"
                  class="what"
                  [attr.aria-expanded]="expanded() === r.id"
                  [attr.aria-controls]="'details-' + r.id"
                  [attr.aria-label]="t.details(r.name)"
                  (click)="toggle(r.id)"
                >
                  <span class="r-name">{{ r.name }}</span>
                  @if (r.categories.length) {
                    <span class="r-categories">
                      @for (c of r.categories; track c) {
                        <span class="tag">{{ c }}</span>
                      }
                    </span>
                  }
                </button>
                <span class="odds" [attr.aria-label]="t.oddsLabel(r.slices, total())" role="img">
                  {{ t.odds(r.slices, total()) }}
                </span>
                <button
                  type="button"
                  class="boost"
                  [disabled]="locked()"
                  [attr.aria-pressed]="r.boostedByYou"
                  [attr.aria-label]="r.boostedByYou ? t.unboostLabel(r.name) : t.boostLabel(r.name)"
                  (click)="toggleBoost.emit(r.boostedByYou ? null : r.id)"
                >
                  {{ r.boostedByYou ? t.boosted : t.boost }}
                </button>
              </div>

              @if (expanded() === r.id) {
                <div class="details" [id]="'details-' + r.id">
                  <p class="r-boosters">
                    {{ r.boosters.length ? t.boostedBy(r.boosters) : t.noBoosts }}
                  </p>
                  <div class="row">
                    @if (r.mapsUrl) {
                      <a
                        class="button secondary small-button"
                        [href]="r.mapsUrl"
                        target="_blank"
                        rel="noopener noreferrer external"
                        [attr.aria-label]="t.maps(r.name)"
                      >
                        {{ t.mapsShort }}
                      </a>
                    }
                    @if (r.canRemove && !locked()) {
                      <button
                        type="button"
                        class="small danger remove"
                        [attr.aria-label]="t.remove(r.name)"
                        (click)="remove.emit({ id: r.id, name: r.name })"
                      >
                        {{ t.removeShort }}
                      </button>
                    }
                  </div>
                </div>
              }
            </li>
          }
        </ul>
      }

      @if (locked()) {
        <!-- Nothing to add while the reel decides. -->
      } @else if (full()) {
        <p class="hint">{{ t.full }}</p>
      } @else {
        <button type="button" class="secondary add" (click)="addRequested.emit()">
          + {{ t.add }}
        </button>
      }
    </section>
  `,
  styles: `
    .restaurants {
      list-style: none;
      margin: 0.25rem 0 0;
      padding: 0;
    }
    .restaurants > li {
      border-top: 1px solid var(--line);
    }
    .restaurants > li:first-child {
      border-top: 0;
    }
    .line {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      min-height: 4rem;
    }
    .what {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.15rem;
      min-height: 3.5rem;
      padding: 0.35rem 0;
      border: 0;
      border-radius: 0.5rem;
      background: none;
      box-shadow: none;
      color: var(--ink);
      text-align: left;
      font-weight: 400;
    }
    .what:active:not(:disabled) {
      transform: none;
      box-shadow: none;
    }
    .r-name {
      max-width: 100%;
      font-weight: 700;
      font-size: 1.05rem;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .r-categories {
      display: flex;
      gap: 0.3rem;
      max-width: 100%;
      overflow: hidden;
      white-space: nowrap;
    }
    .tag {
      padding: 0 0.45rem;
      border: 1.5px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 0.8rem;
    }
    .odds {
      font-family: var(--font-code);
      font-weight: 600;
      font-size: 0.9rem;
    }
    .boost {
      min-height: 2.75rem;
      min-width: 5.6rem;
      padding: 0.3rem 0.7rem;
      background: var(--surface);
      color: var(--ink);
    }
    .boost[aria-pressed='true'] {
      background: var(--brass);
      color: var(--ink-on-brass);
    }
    .details {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0 0 0.85rem;
    }
    .r-boosters {
      font-size: 0.9rem;
      color: var(--muted);
    }
    .small-button {
      min-height: 2.5rem;
      padding: 0.3rem 0.85rem;
      font-size: 0.9rem;
      box-shadow: 0 3px 0 var(--ink);
    }
    .empty {
      padding: 1rem 0;
      color: var(--muted);
    }
    .add {
      align-self: flex-start;
      margin-top: 0.5rem;
    }
  `,
})
export class RestaurantList {
  readonly state = input.required<RoomState>();
  readonly you = input.required<string | null>();
  readonly isHost = input.required<boolean>();
  /** True once the spin has started: no boosts, additions or removals. */
  readonly locked = input(false);

  /** Restaurant id to boost, or null to remove your boost. */
  readonly toggleBoost = output<string | null>();
  readonly remove = output<{ id: string; name: string }>();
  readonly addRequested = output();

  protected readonly t = nl.restaurants;
  /** The one restaurant whose details (Maps, boosters, remove) are open. */
  protected readonly expanded = signal<string | null>(null);

  protected toggle(id: string): void {
    this.expanded.update((current) => (current === id ? null : id));
  }

  protected readonly rows = computed<Row[]>(() => {
    const state = this.state();
    const you = this.you();
    return state.restaurants.map((r) => {
      const boosters = state.participants.filter((p) => p.boost === r.id);
      return {
        id: r.id,
        name: r.name,
        categories: r.categories,
        mapsUrl: r.mapsUrl,
        slices: 1 + boosters.length,
        boosters: boosters.map((p) => p.name),
        boostedByYou: boosters.some((p) => p.id === you),
        canRemove: this.isHost() || (r.addedBy !== null && r.addedBy === you),
      };
    });
  });

  /** Slices on the wheel: one per restaurant plus one per boost. */
  protected readonly total = computed(() => this.rows().reduce((sum, r) => sum + r.slices, 0));
  protected readonly full = computed(() => this.rows().length >= LIMITS.maxRestaurants);
}
