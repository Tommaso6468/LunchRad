import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { StatsResponse } from '@lunchrad/shared';
import { Api, ApiFailure } from '../core/api';
import { DeviceStore } from '../core/storage';
import { nl } from '../i18n/nl';
import { errorText } from '../ui/forms';
import { ThemeToggle } from '../ui/theme-toggle';
import { TeamKeyForm } from './team-key-form';

/** Where the team ended up: most picked and the latest lunches. Names and dates only. */
@Component({
  selector: 'app-stats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TeamKeyForm, ThemeToggle],
  template: `
    <header class="stats-head">
      <h1 class="page-title">{{ t.title }}</h1>
      <span class="head-right">
        <app-theme-toggle />
        <a routerLink="/" class="button secondary small-link">{{ t.back }}</a>
      </span>
    </header>

    @if (!hasTeam()) {
      <app-team-key-form (done)="onTeam()" />
    } @else if (error()) {
      <p class="banner" role="alert">{{ error() }}</p>
    } @else if (stats(); as s) {
      @if (s.total === 0) {
        <p class="placeholder">{{ t.empty }}</p>
      } @else {
        <p class="muted">{{ t.summary(s.total, when(s.since)) }}</p>

        <section class="panel" aria-labelledby="top-title">
          <h2 id="top-title">{{ t.top }}</h2>
          <ol class="top">
            @for (row of s.top; track row.name) {
              <li>
                <div class="top-line">
                  <span class="name">{{ row.name }}</span>
                  <span class="count">{{ t.times(row.count) }}</span>
                </div>
                <span class="bar" aria-hidden="true">
                  <span [style.width.%]="(row.count / max()) * 100"></span>
                </span>
                <span class="hint">{{ t.last(when(row.lastAt)) }}</span>
              </li>
            }
          </ol>
        </section>

        <section class="panel" aria-labelledby="recent-title">
          <h2 id="recent-title">{{ t.recent }}</h2>
          <ul class="recent">
            @for (row of s.recent; track $index) {
              <li>
                <span class="name">{{ row.name }}</span>
                <span class="hint">
                  {{ when(row.decidedAt) }}
                  @if (row.newPlace) {
                    · {{ t.newPlace }}
                  }
                </span>
              </li>
            }
          </ul>
        </section>
      }
    } @else {
      <p class="muted" role="status">{{ t.loading }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .stats-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding-top: 0.5rem;
    }
    .head-right {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .top,
    .recent {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .top > li,
    .recent > li {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      padding: 0.6rem 0;
      border-top: 1px solid var(--line);
    }
    .top > li:first-child,
    .recent > li:first-child {
      border-top: 0;
    }
    .top-line {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .count {
      font-family: var(--font-code);
      font-weight: 600;
      white-space: nowrap;
    }
    .bar {
      display: block;
      height: 0.55rem;
      border-radius: 999px;
      background: var(--bg);
      overflow: hidden;
    }
    .bar > span {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--ticket);
    }
  `,
})
export class Stats {
  private readonly api = inject(Api);
  private readonly store = inject(DeviceStore);
  protected readonly t = nl.stats;
  protected readonly hasTeam = signal(this.store.teamToken() !== null);
  protected readonly stats = signal<StatsResponse | null>(null);
  protected readonly error = signal('');
  protected readonly max = computed(() =>
    Math.max(1, ...(this.stats()?.top ?? []).map((r) => r.count)),
  );
  private readonly format = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'medium' });

  constructor() {
    if (this.hasTeam()) void this.load();
  }

  protected onTeam(): void {
    this.hasTeam.set(true);
    void this.load();
  }

  protected when(at: number | null): string {
    return at === null ? '' : this.format.format(at);
  }

  private async load(): Promise<void> {
    try {
      this.stats.set(await this.api.stats());
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'unauthorized') {
        this.hasTeam.set(false);
        return;
      }
      this.error.set(errorText(error));
    }
  }
}
