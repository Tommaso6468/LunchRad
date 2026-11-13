import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
}

const VISIBLE_MS = 3500;
const GROUP_WINDOW_MS = 2000;

/**
 * Small notices at the top of the screen. At most one is visible; a new one
 * replaces the current one, so a burst of events never stacks up. Events of
 * the same kind within 2 seconds merge into one ("3 nieuwe boosts").
 */
@Injectable({ providedIn: 'root' })
export class Toasts {
  private readonly current = signal<Toast | null>(null);
  readonly toast = this.current.asReadonly();
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private group: { key: string; count: number; at: number } | null = null;

  show(text: string): void {
    this.group = null;
    this.display(text);
  }

  /** Shows `single` for one event; repeats within 2 s become `many(count)`. */
  showGrouped(key: string, single: string, many: (count: number) => string): void {
    const now = Date.now();
    if (this.group && this.group.key === key && now - this.group.at < GROUP_WINDOW_MS) {
      this.group = { key, count: this.group.count + 1, at: now };
      this.display(many(this.group.count));
      return;
    }
    this.group = { key, count: 1, at: now };
    this.display(single);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.group = null;
    this.current.set(null);
  }

  private display(text: string): void {
    clearTimeout(this.timer);
    this.current.set({ id: this.nextId++, text });
    this.timer = setTimeout(() => {
      this.current.set(null);
      this.group = null;
    }, VISIBLE_MS);
  }
}
