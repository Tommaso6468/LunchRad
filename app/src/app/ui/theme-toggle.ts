import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemeService } from '../core/theme';
import { nl } from '../i18n/nl';

/** One button that cycles automatic → light → dark. The label says the current theme. */
@Component({
  selector: 'app-theme-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="secondary small theme-toggle"
      [attr.aria-label]="t.label(t.names[theme.choice()])"
      (click)="theme.next()"
    >
      {{ t.short }}: {{ t.names[theme.choice()] }}
    </button>
  `,
})
export class ThemeToggle {
  protected readonly theme = inject(ThemeService);
  protected readonly t = nl.theme;
}
