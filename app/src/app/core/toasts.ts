import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
}

const VISIBLE_MS = 3500;

/**
 * Small notices at the top of the screen. At most one is visible; a new one
 * replaces the current one, so a burst of events never stacks up.
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private readonly current = signal<Toast | null>(null);
  readonly toast = this.current.asReadonly();
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(text: string): void {
    clearTimeout(this.timer);
    this.current.set({ id: this.nextId++, text });
    this.timer = setTimeout(() => this.current.set(null), VISIBLE_MS);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.current.set(null);
  }
}
