import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { classifyRoomCode } from '@lunchrad/shared';

/**
 * The room code as a ticket stub. Digits differ from letters in colour and
 * carry an underline, so the difference never relies on colour alone. The
 * font has a dotted zero, and O is not in the alphabet, so 0 is unambiguous.
 */
@Component({
  selector: 'app-room-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ticket" [class.small]="size() === 'small'">
      <span class="label">{{ label() }}</span>
      <span class="code" [attr.aria-label]="spoken()">
        @for (c of chars(); track $index) {
          <span [class]="c.kind" aria-hidden="true">{{ c.char }}</span>
        }
      </span>
    </div>
  `,
  styles: `
    .ticket {
      --notch: 0.7rem;
      display: inline-flex;
      flex-direction: column;
      gap: 0.15rem;
      padding: 0.75rem 1.6rem 0.9rem;
      background: var(--ticket);
      color: var(--on-ticket);
      border-radius: 0.35rem;
      /* Notches on both short sides, like a torn-off fairground ticket. */
      mask:
        radial-gradient(
            circle at left center,
            transparent var(--notch),
            #000 calc(var(--notch) + 0.5px)
          )
          left / 51% 100% no-repeat,
        radial-gradient(
            circle at right center,
            transparent var(--notch),
            #000 calc(var(--notch) + 0.5px)
          )
          right / 51% 100% no-repeat;
      transform: rotate(-1.5deg);
    }
    .label {
      font-size: 0.8rem;
      opacity: 0.85;
    }
    .code {
      font-family: var(--font-code);
      font-weight: 600;
      font-size: 2.4rem;
      letter-spacing: 0.12em;
      line-height: 1.1;
    }
    .digit {
      color: var(--ticket-digit);
      text-decoration: underline;
      text-decoration-thickness: 3px;
      text-underline-offset: 0.18em;
    }
    .small {
      padding: 0.45rem 1.2rem 0.55rem;
    }
    .small .code {
      font-size: 1.6rem;
    }
  `,
})
export class RoomCode {
  readonly code = input.required<string>();
  readonly label = input('Kamercode');
  readonly size = input<'large' | 'small'>('large');
  protected readonly chars = computed(() => classifyRoomCode(this.code()));
  protected readonly spoken = computed(() => [...this.code()].join(' '));
}
