import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import type { SpinView } from '@lunchrad/shared';
import { Feedback } from '../core/feedback';
import { nl } from '../i18n/nl';

const ROW_HEIGHT = 64;
const VISIBLE = 5;
/** The drum's radius: rows curve away from the window like on a real drum. */
const RADIUS = (ROW_HEIGHT * VISIBLE) / 2.2;
const REDUCED_MS = 1000;

interface ReelRow {
  key: number;
  name: string;
  transform: string;
  opacity: number;
  center: boolean;
}

/** Fast start, long slow-down, like a heavy drum coming to rest. */
function easeOutQuart(t: number): number {
  return 1 - (1 - t) ** 4;
}

/**
 * The arcade reel: a drum seen from the front, names scrolling from top to
 * bottom and fading towards the edges, a highlighted window in the middle.
 *
 * It never decides anything. It receives the reel order and the winning row
 * from the server and animates towards that row; every phone uses the same
 * duration and the server's elapsed time, so they all stop together.
 */
@Component({
  selector: 'app-reel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cabinet">
      <div class="drum" aria-hidden="true">
        @for (row of rows(); track row.key) {
          <div
            class="row"
            [class.center]="row.center"
            [style.transform]="row.transform"
            [style.opacity]="row.opacity"
          >
            {{ row.name }}
          </div>
        }
        <div class="window"></div>
        <span class="pointer left"></span>
        <span class="pointer right"></span>
      </div>

      <div class="lever-column">
        <button
          type="button"
          class="lever"
          [class.pulled]="pulled()"
          [disabled]="!canPull()"
          [attr.aria-label]="t.lever"
          [attr.aria-describedby]="canPull() ? null : 'lever-why'"
          (click)="pull()"
        >
          <span class="shaft"></span>
          <span class="knob"></span>
        </button>
      </div>
    </div>
    @if (!canPull() && leverHint(); as hint) {
      <p id="lever-why" class="hint lever-hint">{{ hint }}</p>
    }
    <p class="visually-hidden" aria-live="assertive">{{ announcement() }}</p>
  `,
  styles: `
    :host {
      display: block;
    }
    .cabinet {
      display: grid;
      grid-template-columns: 1fr 4.5rem;
      gap: 0.75rem;
      align-items: stretch;
    }
    .drum {
      position: relative;
      height: ${ROW_HEIGHT * VISIBLE}px;
      overflow: hidden;
      border: 3px solid var(--ink);
      border-radius: 1rem;
      background: linear-gradient(
        var(--drum-edge) 0%,
        var(--surface) 30%,
        var(--surface) 70%,
        var(--drum-edge) 100%
      );
      box-shadow: inset 0 0 0 6px var(--surface);
    }
    .row {
      position: absolute;
      left: 0.5rem;
      right: 0.5rem;
      top: 50%;
      height: ${ROW_HEIGHT}px;
      margin-top: -${ROW_HEIGHT / 2}px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 1.2rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      will-change: transform;
    }
    .row.center {
      font-size: 1.35rem;
    }
    .window {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: ${ROW_HEIGHT}px;
      margin-top: -${ROW_HEIGHT / 2}px;
      border-block: 3px solid var(--ticket);
      background: var(--ticket-glow);
      pointer-events: none;
    }
    .pointer {
      position: absolute;
      top: 50%;
      width: 0;
      height: 0;
      margin-top: -10px;
      border-block: 10px solid transparent;
    }
    .pointer.left {
      left: 0;
      border-left: 14px solid var(--ticket);
    }
    .pointer.right {
      right: 0;
      border-right: 14px solid var(--ticket);
    }
    .lever-column {
      display: flex;
      justify-content: center;
    }
    .lever {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 12rem;
      padding: 0;
      border: 3px solid var(--ink);
      border-radius: 2.25rem;
      background: var(--surface);
      box-shadow: 0 4px 0 var(--ink);
      cursor: grab;
    }
    .shaft {
      position: absolute;
      left: 50%;
      top: 1.6rem;
      bottom: 1.6rem;
      width: 0.6rem;
      margin-left: -0.3rem;
      border-radius: 1rem;
      background: var(--ink);
    }
    .knob {
      position: absolute;
      left: 50%;
      top: 0.4rem;
      width: 3rem;
      height: 3rem;
      margin-left: -1.5rem;
      border: 3px solid var(--ink);
      border-radius: 50%;
      background: var(--ticket);
      transition: top 220ms cubic-bezier(0.3, 1.6, 0.5, 1);
    }
    .lever.pulled .knob {
      top: calc(100% - 3.4rem);
      transition: top 140ms ease-in;
    }
    .lever:disabled {
      opacity: 1;
      cursor: not-allowed;
    }
    .lever:disabled .knob {
      background: var(--line);
    }
    .lever-hint {
      margin-top: 0.75rem;
    }
    @media (prefers-reduced-motion: reduce) {
      .knob,
      .lever.pulled .knob {
        transition: none;
      }
    }
  `,
})
export class Reel {
  /** Restaurant id → name, for every restaurant that can appear. */
  readonly names = input.required<ReadonlyMap<string, string>>();
  /** Rows to show while no spin has happened yet. */
  readonly preview = input.required<readonly string[]>();
  readonly spin = input<SpinView | null>(null);
  readonly canPull = input(false);
  readonly leverHint = input<string | null>(null);

  readonly leverPulled = output();
  readonly finished = output<string>();

  protected readonly t = nl.reel;
  private readonly feedback = inject(Feedback);
  protected readonly pulled = signal(false);
  protected readonly announcement = signal('');

  /** Position on the drum in rows; the centre shows row round(position). */
  private readonly position = signal(0);
  private frame = 0;
  private animatedSpin = 0;
  private readonly reduceMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  private readonly order = computed(() => this.spin()?.reel ?? this.preview());

  protected readonly rows = computed<ReelRow[]>(() => {
    const order = this.order();
    const names = this.names();
    const n = order.length;
    if (n === 0) return [];
    const p = this.position();
    const base = Math.round(p);
    const rows: ReelRow[] = [];
    for (let d = -3; d <= 3; d++) {
      const i = base + d;
      const angle = ((i - p) * ROW_HEIGHT) / RADIUS;
      if (Math.abs(angle) >= Math.PI / 2) continue;
      const id = order[((i % n) + n) % n] ?? '';
      // Rows above the window have a higher index: names travel downwards.
      const y = -Math.sin(angle) * RADIUS;
      rows.push({
        key: i,
        name: names.get(id) ?? '',
        transform: `translateY(${y.toFixed(2)}px) scaleY(${Math.cos(angle).toFixed(3)})`,
        opacity: 0.2 + 0.8 * Math.cos(angle),
        center: Math.abs(i - p) < 0.5,
      });
    }
    return rows;
  });

  constructor() {
    effect(() => {
      const spin = this.spin();
      if (!spin) {
        this.animatedSpin = 0;
        untracked(() => this.position.set(0));
        return;
      }
      if (spin.number === this.animatedSpin) return;
      this.animatedSpin = spin.number;
      untracked(() => this.animate(spin));
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  protected pull(): void {
    if (!this.canPull()) return;
    this.pulled.set(true);
    this.feedback.lever();
    setTimeout(() => this.pulled.set(false), 450);
    this.leverPulled.emit();
  }

  private animate(spin: SpinView): void {
    cancelAnimationFrame(this.frame);
    const n = spin.reel.length;
    const winner = spin.reel[spin.winnerIndex] ?? spin.winnerId;
    const name = this.names().get(winner) ?? '';
    const duration = this.reduceMotion ? REDUCED_MS : spin.durationMs;
    const elapsed = this.reduceMotion
      ? (spin.elapsedMs / spin.durationMs) * REDUCED_MS
      : spin.elapsedMs;

    // Travel upwards through the indices (names move down) for a few full
    // turns, ending exactly on the winning row.
    const start = 0;
    const turns = this.reduceMotion ? 1 : Math.max(3, Math.ceil(30 / n));
    const target = spin.winnerIndex + n * turns;

    const done = () => {
      this.position.set(target);
      this.announcement.set(nl.reel.landed(name));
      this.finished.emit(winner);
    };
    if (elapsed >= duration) {
      done();
      return;
    }
    this.announcement.set(nl.reel.spinning);
    const startedAt = performance.now() - elapsed;
    let lastRow = Math.round(start);
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const position = start + (target - start) * easeOutQuart(t);
      this.position.set(position);
      if (Math.round(position) !== lastRow) {
        lastRow = Math.round(position);
        this.feedback.tick();
      }
      if (t < 1) this.frame = requestAnimationFrame(step);
      else done();
    };
    this.frame = requestAnimationFrame(step);
  }
}
