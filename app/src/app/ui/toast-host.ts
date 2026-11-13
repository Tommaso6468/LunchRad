import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Toasts } from '../core/toasts';

@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="region" aria-live="polite" aria-atomic="true">
      @if (toasts.toast(); as toast) {
        <button type="button" class="toast" (click)="toasts.dismiss()">{{ toast.text }}</button>
      }
    </div>
  `,
  styles: `
    .region {
      position: fixed;
      inset: max(0.75rem, env(safe-area-inset-top)) 1rem auto;
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 10;
    }
    .toast {
      pointer-events: auto;
      max-width: 28rem;
      padding: 0.7rem 1.1rem;
      border: 2px solid var(--ink);
      border-radius: 999px;
      background: var(--brass);
      color: var(--ink-on-brass);
      font: inherit;
      font-weight: 700;
      box-shadow: 0 3px 0 var(--ink);
      animation: drop 180ms ease-out;
      cursor: pointer;
    }
    @keyframes drop {
      from {
        transform: translateY(-0.6rem);
        opacity: 0;
      }
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(Toasts);
}
