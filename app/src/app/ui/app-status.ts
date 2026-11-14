import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Pwa } from '../core/pwa';
import { nl } from '../i18n/nl';

/** Offline notice and "new version" prompt, at the bottom of every screen. */
@Component({
  selector: 'app-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-status" role="status" aria-live="polite">
      @if (!pwa.online()) {
        <p class="status-card">{{ t.offline }}</p>
      } @else if (pwa.updateReady()) {
        <div class="status-card">
          <p>{{ t.updateReady }}</p>
          <button type="button" class="primary small-cta" (click)="pwa.applyUpdate()">
            {{ t.reload }}
          </button>
        </div>
      }
    </div>
  `,
})
export class AppStatus {
  protected readonly pwa = inject(Pwa);
  protected readonly t = nl.app;
}
