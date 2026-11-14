import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LIMITS, type RoomState } from '@lunchrad/shared';
import { confettiBurst } from '../core/confetti';
import { Feedback } from '../core/feedback';
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
            (finished)="onLanded($event)"
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
  private readonly feedback = inject(Feedback);
  /** Spin number already celebrated, so a snapshot or reconnect never repeats it. */
  private celebrated = 0;
  /** Only celebrate results this page saw happen, not ones it loaded later. */
  private sawUnfinished = false;

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

  /** Spin numbers this page saw spinning (not ones it only loaded afterwards). */
  private watched = 0;
  /** Spin number that already got its confetti. */
  private burst = 0;
  /** Spin number that had a respin vote. */
  private votedOn = 0;
  private readonly watchSpins = effect(() => {
    const state = this.state();
    if (state.phase === 'spinning' && state.spin) this.watched = state.spin.number;
    if (state.phase === 'voting' && state.spin) this.votedOn = state.spin.number;
  });

  protected onLanded(id: string): void {
    const fresh = this.landed() !== id;
    this.landed.set(id);
    const spin = this.state().spin;
    if (!fresh || !spin || spin.number !== this.watched) return;
    // Confetti the moment the result card appears, on every spin this phone watched.
    this.burst = spin.number;
    confettiBurst();
    if (this.state().phase !== 'result') this.feedback.landed();
  }

  /** The final result: fanfare and confetti, once per spin, after this phone's reel stopped. */
  private readonly celebrate = effect(() => {
    const state = this.state();
    if (state.phase !== 'result') {
      this.sawUnfinished = true;
      return;
    }
    const spin = state.spin;
    const winner = this.winner();
    if (!spin || !winner || !this.sawUnfinished || this.celebrated === spin.number) return;
    this.celebrated = spin.number;
    untracked(() => {
      this.feedback.celebrate();
      // After a vote the decision gets its own burst; without one, the landing already had it.
      if (this.burst !== spin.number || this.votedOn === spin.number) {
        this.burst = spin.number;
        confettiBurst();
      }
    });
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
