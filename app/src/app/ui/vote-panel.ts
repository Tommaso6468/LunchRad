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
} from '@angular/core';
import { respinNeeds, type VoteView } from '@lunchrad/shared';
import { nl } from '../i18n/nl';

/**
 * "Opnieuw draaien?" with a 30-second countdown. The server decides when the
 * vote ends; the countdown here only shows the time it reported.
 */
@Component({
  selector: 'app-vote-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = vote();
    <div class="vote" role="group" aria-labelledby="vote-title">
      <p id="vote-title" class="vote-title">{{ t.question }}</p>
      <div
        class="timer"
        role="progressbar"
        [attr.aria-label]="t.timeLeftLabel"
        aria-valuemin="0"
        [attr.aria-valuemax]="seconds(v.durationMs)"
        [attr.aria-valuenow]="seconds(remaining())"
        [attr.aria-valuetext]="t.secondsLeft(seconds(remaining()))"
      >
        <span class="bar" [style.width.%]="(remaining() / v.durationMs) * 100"></span>
      </div>
      <p class="hint">
        {{ t.secondsLeft(seconds(remaining())) }}. {{ t.tally(v.yes.length, needs()) }}
      </p>

      @if (eligible()) {
        <div class="row">
          <button
            type="button"
            class="secondary"
            [attr.aria-pressed]="yourVote() === 'yes'"
            (click)="voted.emit('yes')"
          >
            {{ t.yes }}
          </button>
          <button
            type="button"
            class="secondary"
            [attr.aria-pressed]="yourVote() === 'no'"
            (click)="voted.emit('no')"
          >
            {{ t.no }}
          </button>
        </div>
        <p class="hint">{{ t.rules(respinsLeft()) }}</p>
      } @else {
        <p class="hint">{{ t.notEligible }}</p>
      }
    </div>
  `,
  styles: `
    .vote {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--line);
    }
    .vote-title {
      font-weight: 700;
      font-size: 1.15rem;
    }
    .timer {
      height: 0.6rem;
      border: 2px solid var(--ink);
      border-radius: 999px;
      overflow: hidden;
      background: var(--bg);
    }
    .bar {
      display: block;
      height: 100%;
      background: var(--brass);
    }
    button[aria-pressed='true'] {
      background: var(--ink);
      color: var(--surface);
    }
  `,
})
export class VotePanel {
  readonly vote = input.required<VoteView>();
  readonly you = input.required<string | null>();
  readonly respinsLeft = input.required<number>();
  readonly voted = output<'yes' | 'no'>();

  protected readonly t = nl.vote;
  private readonly receivedAt = signal(performance.now());
  private readonly now = signal(performance.now());

  protected readonly needs = computed(() => respinNeeds(this.vote().eligible.length));
  protected readonly eligible = computed(() => {
    const you = this.you();
    return you !== null && this.vote().eligible.includes(you);
  });
  protected readonly yourVote = computed(() => {
    const you = this.you() ?? '';
    if (this.vote().yes.includes(you)) return 'yes';
    if (this.vote().no.includes(you)) return 'no';
    return null;
  });
  protected readonly remaining = computed(() =>
    Math.max(0, this.vote().remainingMs - (this.now() - this.receivedAt())),
  );

  constructor() {
    // Every new snapshot from the server restarts the local countdown from its figure.
    effect(() => {
      this.vote();
      this.receivedAt.set(performance.now());
    });
    const timer = setInterval(() => this.now.set(performance.now()), 250);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected seconds(ms: number): number {
    return Math.ceil(ms / 1000);
  }
}
