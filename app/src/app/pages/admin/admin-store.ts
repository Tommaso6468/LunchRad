import { Injectable, inject, signal } from '@angular/core';
import type { AdminOverview } from '@lunchrad/shared';
import { AdminApi, AdminFailure } from '../../core/admin-api';
import { Toasts } from '../../core/toasts';
import { nl } from '../../i18n/nl';

/**
 * State shared by the admin sections: the catalogue and presets as the
 * server last returned them, and one error line. Every change answers with
 * the full new overview, so the screen always shows what is stored.
 */
@Injectable()
export class AdminStore {
  readonly api = inject(AdminApi);
  private readonly toasts = inject(Toasts);

  readonly overview = signal<AdminOverview | null>(null);
  readonly error = signal('');
  readonly needsLogin = signal(false);
  readonly busy = signal(false);

  async load(): Promise<void> {
    await this.run(() => this.api.overview());
  }

  /** Runs a change; on success shows `done` (if given) and stores the new overview. */
  async run(action: () => Promise<AdminOverview>, done?: string): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set('');
    try {
      this.overview.set(await action());
      if (done) this.toasts.show(done);
      return true;
    } catch (error) {
      this.fail(error);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  fail(error: unknown): void {
    const code = error instanceof AdminFailure ? error.code : 'server_error';
    if (code === 'login' || code === 'unauthorized') this.needsLogin.set(true);
    this.error.set(nl.admin.errors[code]);
  }
}
