import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { nl } from '../../i18n/nl';
import { AdminAudit } from './admin-audit';
import { AdminPresets } from './admin-presets';
import { AdminRestaurants } from './admin-restaurants';
import { AdminRooms } from './admin-rooms';
import { AdminStore } from './admin-store';
import { AdminTeamKey } from './admin-team-key';

type Tab = 'restaurants' | 'presets' | 'rooms' | 'teamKey' | 'audit';
const TABS: readonly Tab[] = ['restaurants', 'presets', 'rooms', 'teamKey', 'audit'];

/**
 * The admin panel at /admin. Cloudflare Access logs the admin in before this
 * page loads; the API checks the Access token on every call. Loaded lazily,
 * so the room screens never download it.
 */
@Component({
  selector: 'app-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [AdminStore],
  imports: [RouterLink, AdminRestaurants, AdminPresets, AdminRooms, AdminTeamKey, AdminAudit],
  template: `
    <header class="admin-head">
      <h1 class="page-title">{{ t.title }}</h1>
      @if (store.overview(); as o) {
        <p class="hint">{{ t.signedInAs(o.email) }}</p>
      }
      <a routerLink="/" class="button secondary small-link">{{ t.toApp }}</a>
    </header>

    @if (store.error()) {
      <div class="banner" role="alert">
        <p>{{ store.error() }}</p>
        @if (store.needsLogin()) {
          <button type="button" class="secondary" (click)="reload()">{{ t.loginAgain }}</button>
        }
      </div>
    }

    @if (store.overview()) {
      <div class="tabs admin-tabs" role="tablist" [attr.aria-label]="t.tabsLabel">
        @for (id of tabs; track id) {
          <button
            type="button"
            role="tab"
            [id]="'admin-tab-' + id"
            [attr.aria-controls]="'admin-panel-' + id"
            [attr.aria-selected]="tab() === id"
            [attr.tabindex]="tab() === id ? 0 : -1"
            (click)="tab.set(id)"
            (keydown)="keys($event)"
          >
            {{ t.tabs[id] }}
          </button>
        }
      </div>

      <section
        class="panel"
        role="tabpanel"
        [id]="'admin-panel-' + tab()"
        [attr.aria-labelledby]="'admin-tab-' + tab()"
      >
        @switch (tab()) {
          @case ('restaurants') {
            <app-admin-restaurants />
          }
          @case ('presets') {
            <app-admin-presets />
          }
          @case ('rooms') {
            <app-admin-rooms />
          }
          @case ('teamKey') {
            <app-admin-team-key />
          }
          @case ('audit') {
            <app-admin-audit />
          }
        }
      </section>
    } @else if (!store.error()) {
      <p class="muted" role="status">{{ t.loading }}</p>
    }
  `,
})
export class Admin {
  protected readonly store = inject(AdminStore);
  protected readonly t = nl.admin;
  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>('restaurants');

  constructor() {
    void this.store.load();
  }

  protected keys(event: KeyboardEvent): void {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      TABS[(TABS.indexOf(this.tab()) + step + TABS.length) % TABS.length] ?? 'restaurants';
    this.tab.set(next);
    document.getElementById(`admin-tab-${next}`)?.focus();
  }

  /** A full reload sends the browser through the Cloudflare Access login again. */
  protected reload(): void {
    location.reload();
  }
}
