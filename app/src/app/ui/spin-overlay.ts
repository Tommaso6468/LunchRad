import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LIMITS, type RoomState } from '@lunchrad/shared';
import { nl } from '../i18n/nl';
import { Reel } from './reel';
import { VotePanel } from './vote-panel';

/**
 * Full-screen reel. Opens by itself on every phone when a spin starts, so
 * everyone watches the same moment; it can also be opened from the room to
 * look at the reel or pull the lever. The winner card appears only after this
 * phone's animation has stopped, never earlier.
 */
@Component({
  selector: 'app-spin-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Reel, VotePanel],
  template: `
    <dialog #dialog class="reel-dialog" aria-labelledby="reel-title" (close)="isOpen.set(false)">
      <div class="inner">
        <div class="row">
          <button type="button" class="secondary" (click)="close()">{{ t.back }}</button>
        </div>
        <h2 id="reel-title" class="page-title">{{ t.title }}</h2>
        @if (isOpen()) {
          <app-reel
            [names]="names()"
            [preview]="preview()"
            [spin]="state().spin"
            [canPull]="canPull()"
            [leverHint]="leverHint()"
            (leverPulled)="pull.emit()"
            (finished)="landed.set($event)"
          />
        }
        @if (state().phase === 'lobby' && isHost() && canPull()) {
          <p class="hint">{{ t.hostHint }}</p>
        }
        @if (winner(); as w) {
          <section #resultCard class="result-card" aria-labelledby="result-title">
            <p id="result-title" class="muted">
              {{ state().phase === 'result' ? t.resultTitle : t.candidateTitle }}
            </p>
            <p class="winner">{{ w.name }}</p>
            @if (w.categories.length) {
              <ul class="tags">
                @for (c of w.categories; track c) {
                  <li>{{ c }}</li>
                }
              </ul>
            }
            @if (w.mapsUrl) {
              <a
                class="button primary"
                [href]="w.mapsUrl"
                target="_blank"
                rel="noopener noreferrer external"
              >
                {{ t.maps }}
              </a>
            }
            @if (state().vote; as v) {
              <app-vote-panel
                [vote]="v"
                [you]="you()"
                [respinsLeft]="state().respinsLeft"
                (voted)="vote.emit($event)"
              />
            } @else if (state().phase === 'result') {
              <p class="hint">{{ t.final }}</p>
            }
          </section>
        }
      </div>
    </dialog>
  `,
})
export class SpinOverlay {
  readonly state = input.required<RoomState>();
  readonly isHost = input.required<boolean>();
  readonly you = input.required<string | null>();
  readonly pull = output();
  readonly vote = output<'yes' | 'no'>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly t = nl.reel;
  protected readonly isOpen = signal(false);
  /** Restaurant id this phone's reel stopped on. */
  protected readonly landed = signal<string | null>(null);
  private readonly resultCard = viewChild<ElementRef<HTMLElement>>('resultCard');
  private shownSpin = 0;

  protected readonly names = computed(
    () => new Map(this.state().restaurants.map((r) => [r.id, r.name] as const)),
  );
  protected readonly preview = computed(() => this.state().restaurants.map((r) => r.id));
  protected readonly canPull = computed(
    () =>
      this.isHost() &&
      this.state().phase === 'lobby' &&
      this.state().restaurants.length >= LIMITS.minRestaurantsToSpin,
  );
  protected readonly leverHint = computed(() => {
    if (this.state().phase !== 'lobby') return null;
    if (!this.isHost()) return nl.reel.onlyHost;
    if (this.state().restaurants.length < LIMITS.minRestaurantsToSpin) return nl.reel.needTwo;
    return null;
  });
  protected readonly winner = computed(() => {
    const id = this.landed();
    const spin = this.state().spin;
    if (!id || !spin || id !== spin.winnerId) return null;
    return this.state().restaurants.find((r) => r.id === id) ?? null;
  });

  constructor() {
    // A new spin opens the reel on every phone.
    effect(() => {
      const spin = this.state().spin;
      if (!spin || spin.number === this.shownSpin) return;
      this.shownSpin = spin.number;
      untracked(() => {
        this.landed.set(null);
        this.open();
      });
    });
  }

  /** On small phones the vote sits below the reel: bring it into view once the reel stops. */
  private readonly revealResult = effect(() => {
    const card = this.resultCard()?.nativeElement;
    if (!card) return;
    requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest' }));
  });

  open(): void {
    const el = this.dialog().nativeElement;
    if (!el.open) el.showModal();
    this.isOpen.set(true);
  }

  close(): void {
    this.dialog().nativeElement.close();
  }
}
