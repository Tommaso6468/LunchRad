import type { WritableSignal } from '@angular/core';
import { ApiFailure } from '../core/api';
import { nl } from '../i18n/nl';

/** Binds an input's value to a signal without $any() in templates. */
export function bindInput(target: WritableSignal<string>, event: Event): void {
  target.set((event.target as HTMLInputElement).value);
}

/** Dutch message for any thrown value. */
export function errorText(error: unknown): string {
  return error instanceof ApiFailure ? nl.errors[error.code] : nl.errors.server_error;
}
