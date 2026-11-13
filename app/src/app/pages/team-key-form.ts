import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { Api, ApiFailure } from '../core/api';
import { nl } from '../i18n/nl';
import { bindInput, errorText } from '../ui/forms';

@Component({
  selector: 'app-team-key-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="panel" aria-labelledby="team-key-title">
      <h2 id="team-key-title">{{ t.title }}</h2>
      <p class="muted">{{ t.intro }}</p>
      <form (submit)="submit($event)" novalidate>
        <label for="team-key">{{ t.label }}</label>
        <input
          id="team-key"
          type="password"
          autocomplete="current-password"
          maxlength="200"
          required
          [value]="key()"
          (input)="bind(key, $event)"
          [attr.aria-invalid]="wrongKey() ? 'true' : null"
          aria-describedby="team-key-error"
        />
        <p id="team-key-error" class="error" role="alert">{{ error() }}</p>
        <button type="submit" class="primary" [disabled]="busy() || !key()">{{ t.submit }}</button>
      </form>
    </section>
  `,
})
export class TeamKeyForm {
  private readonly api = inject(Api);
  readonly done = output();
  protected readonly t = nl.teamKey;
  protected readonly key = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** Only a wrong key marks the field invalid; other errors are not about the input. */
  protected readonly wrongKey = signal(false);
  protected readonly bind = bindInput;

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.key() || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.wrongKey.set(false);
    try {
      await this.api.startTeamSession(this.key());
      this.key.set('');
      this.done.emit();
    } catch (error) {
      this.error.set(errorText(error));
      this.wrongKey.set(error instanceof ApiFailure && error.code === 'wrong_team_key');
    } finally {
      this.busy.set(false);
    }
  }
}
