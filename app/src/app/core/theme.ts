import { Injectable, signal } from '@angular/core';

export type ThemeChoice = 'system' | 'light' | 'dark';

const KEY = 'lunchrad.theme';
const ORDER: readonly ThemeChoice[] = ['system', 'light', 'dark'];
/** The page background per theme, for the browser bar (meta theme-color). */
const BAR: Record<'light' | 'dark', string> = { light: '#e4f0e8', dark: '#0f2a24' };

/**
 * Light, dark, or whatever the device uses. The choice is remembered on this
 * device only and applied as data-theme on <html>; styles.css does the rest.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly choice = signal<ThemeChoice>(read());

  constructor() {
    apply(this.choice());
  }

  next(): void {
    const index = ORDER.indexOf(this.choice());
    this.set(ORDER[(index + 1) % ORDER.length] ?? 'system');
  }

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked: the choice lasts until the page closes.
    }
    apply(choice);
  }
}

function read(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Also called from main.ts before the app starts, so a chosen theme never flashes. */
export function apply(choice: ThemeChoice = read()): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = BAR[choice === 'system' ? scheme : choice];
  }
}
