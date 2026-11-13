import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
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
      <h2 id="restaurants-title">{{ t.title(rows().length) }}</h2>
      <p class="hint">{{ t.howBoostWorks }}</p>

      @if (rows().length === 0) {
        <p class="empty">{{ t.empty }}</p>
      } @else {
        <ul class="restaurants">
          @for (r of rows(); track r.id) {
            <li [class.mine]="r.boostedByYou">
              <div class="what">
                <span class="r-name">{{ r.name }}</span>
                @if (r.categories.length) {
                  <ul class="r-categories" [attr.aria-label]="t.categoriesLabel">
                    @for (c of r.categories; track c) {
                      <li>{{ c }}</li>
                    }
                  </ul>
                }
                @if (r.boosters.length) {
                  <span class="r-boosters">{{ t.boostedBy(r.boosters) }}</span>
                }
              </div>
              <div class="tools">
                <button
                  type="button"
                  class="boost"
                  [attr.aria-pressed]="r.boostedByYou"
                  [attr.aria-label]="r.boostedByYou ? t.unboostLabel(r.name) : t.boostLabel(r.name)"
                  (click)="toggleBoost.emit(r.boostedByYou ? null : r.id)"
                >
                  {{ r.boostedByYou ? t.boosted : t.boost }}
                </button>
                @if (r.mapsUrl) {
                  <a
                    class="icon-button"
                    [href]="r.mapsUrl"
                    target="_blank"
                    rel="noopener noreferrer external"
                    [attr.aria-label]="t.maps(r.name)"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"
                      />
                    </svg>
                  </a>
                }

                @if (r.canRemove) {
                  <button
                    type="button"
                    class="icon-button remove"
                    [attr.aria-label]="t.remove(r.name)"
                    (click)="remove.emit({ id: r.id, name: r.name })"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                }
                <span class="odds" [attr.aria-label]="t.oddsLabel(r.slices, total())" role="img">
                  {{ t.odds(r.slices, total()) }}
                </span>
              </div>
            </li>
          }
        </ul>
      }

      @if (full()) {
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
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem 0;
      border-top: 1px solid var(--line);
    }
    .restaurants > li:first-child {
      border-top: 0;
    }
    .what {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .r-name {
      font-weight: 700;
      font-size: 1.1rem;
      overflow-wrap: anywhere;
    }
    .r-categories {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      list-style: none;
      margin: 0.2rem 0 0.1rem;
      padding: 0;
    }
    .r-categories li {
      padding: 0 0.5rem;
      border: 1.5px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 0.85rem;
    }
    .r-boosters {
      font-size: 0.9rem;
    }
    .r-boosters {
      color: var(--ink);
    }
    .tools {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .odds {
      margin-left: auto;
      font-family: var(--font-code);
      font-weight: 600;
      font-size: 0.95rem;
    }
    .boost {
      min-height: 2.75rem;
      padding: 0.35rem 0.9rem;
      background: var(--surface);
      color: var(--ink);
    }
    .boost[aria-pressed='true'] {
      background: var(--brass);
      color: var(--ink-on-brass);
    }
    .icon-button {
      display: inline-grid;
      place-items: center;
      width: 2.75rem;
      height: 2.75rem;
      padding: 0;
      border: 2px solid var(--ink);
      border-radius: 0.75rem;
      background: var(--surface);
      color: var(--ink);
      box-shadow: 0 3px 0 var(--ink);
    }
    .icon-button svg {
      width: 1.3rem;
      height: 1.3rem;
      fill: currentColor;
      stroke: currentColor;
      stroke-width: 0;
    }
    .remove svg {
      fill: none;
      stroke-width: 2.5;
      stroke-linecap: round;
    }
    .remove {
      color: var(--danger);
      border-color: var(--danger);
      box-shadow: 0 3px 0 var(--danger);
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

  /** Restaurant id to boost, or null to remove your boost. */
  readonly toggleBoost = output<string | null>();
  readonly remove = output<{ id: string; name: string }>();
  readonly addRequested = output();

  protected readonly t = nl.restaurants;

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
