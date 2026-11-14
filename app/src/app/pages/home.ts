import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { normalizeName, normalizeRoomCode, type PresetSummary } from '@lunchrad/shared';
import { Api, ApiFailure } from '../core/api';
import { DeviceStore } from '../core/storage';
import { Turnstile } from '../core/turnstile';
import { nl } from '../i18n/nl';
import { bindInput, errorText } from '../ui/forms';
import { TeamKeyForm } from './team-key-form';

@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TeamKeyForm],
  template: `
    <header class="masthead">
      <h1 class="wordmark">{{ t.appName }}</h1>
      <p class="tagline">{{ t.tagline }}</p>
    </header>

    @if (!hasTeam()) {
      <app-team-key-form (done)="onTeamReady()" />
    } @else {
      <section class="panel" aria-labelledby="join-title">
        <h2 id="join-title">{{ t.join.title }}</h2>
        <p class="muted">{{ t.join.intro }}</p>
        <form (submit)="join($event)" novalidate>
          <label for="join-code">{{ t.join.codeLabel }}</label>
          <input
            id="join-code"
            class="code-input"
            inputmode="text"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            maxlength="9"
            [value]="code()"
            (input)="bind(code, $event)"
            aria-describedby="join-code-hint"
          />
          <p id="join-code-hint" class="hint">{{ t.join.codeHint }}</p>
          <label for="join-name">{{ t.nameLabel }}</label>
          <input
            id="join-name"
            autocomplete="nickname"
            maxlength="20"
            [value]="name()"
            (input)="bind(name, $event)"
          />
          <p class="error" role="alert">{{ joinError() }}</p>
          <button type="submit" class="primary" [disabled]="busy()">{{ t.join.submit }}</button>
        </form>
      </section>

      <section class="panel" aria-labelledby="create-title">
        <h2 id="create-title">{{ t.create.title }}</h2>
        <p class="muted">{{ t.create.intro }}</p>
        <form (submit)="create($event)" novalidate>
          <label for="create-name">{{ t.nameLabel }}</label>
          <input
            id="create-name"
            autocomplete="nickname"
            maxlength="20"
            [value]="name()"
            (input)="bind(name, $event)"
            aria-describedby="create-name-hint"
          />
          <p id="create-name-hint" class="hint">{{ t.nameHint }}</p>
          @if (presets().length > 1) {
            <label for="create-preset">{{ t.create.presetLabel }}</label>
            <select
              id="create-preset"
              [value]="presetId()"
              (change)="bind(presetId, $event)"
              aria-describedby="create-preset-hint"
            >
              @for (p of presets(); track p.id) {
                <option [value]="p.id" [selected]="p.id === presetId()">
                  {{ t.create.presetOption(p.name, p.count) }}
                </option>
              }
            </select>
            <p id="create-preset-hint" class="hint">{{ t.create.presetHint }}</p>
          }
          <div class="bot-check" #botCheck></div>
          @if (botCheckState() === 'loading') {
            <p class="hint">{{ t.create.botCheckLoading }}</p>
          }
          <p class="error" role="alert">{{ createError() }}</p>
          <button type="submit" class="secondary" [disabled]="busy()">{{ t.create.submit }}</button>
        </form>
      </section>
    }
  `,
})
export class Home {
  private readonly api = inject(Api);
  private readonly store = inject(DeviceStore);
  private readonly router = inject(Router);
  private readonly turnstile = inject(Turnstile);
  private readonly botCheck = viewChild<ElementRef<HTMLElement>>('botCheck');

  protected readonly t = nl;
  protected readonly bind = bindInput;
  protected readonly hasTeam = signal(this.store.teamToken() !== null);
  protected readonly name = signal(this.store.lastName());
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly joinError = signal('');
  protected readonly createError = signal('');
  protected readonly botCheckState = signal<'loading' | 'ready' | 'failed'>('loading');
  protected readonly presets = signal<PresetSummary[]>([]);
  protected readonly presetId = signal('');

  private turnstileToken: string | null = null;
  private widgetId: string | null = null;
  private renderedInto: HTMLElement | null = null;
  private turnstileApi: Awaited<ReturnType<Turnstile['load']>> | null = null;

  constructor() {
    afterNextRender(() => {
      void this.renderBotCheck();
      void this.loadPresets();
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.widgetId) this.turnstileApi?.remove(this.widgetId);
    });
  }

  protected onTeamReady(): void {
    this.hasTeam.set(true);
    setTimeout(() => void this.renderBotCheck());
    void this.loadPresets();
  }

  protected async join(event: Event): Promise<void> {
    event.preventDefault();
    this.joinError.set('');
    const code = normalizeRoomCode(this.code());
    if (!code) {
      this.joinError.set(nl.join.invalidCode);
      return;
    }
    const name = normalizeName(this.name());
    if (!name) {
      this.joinError.set(nl.errors.invalid_name);
      return;
    }
    await this.run(this.joinError, async () => {
      const creds = await this.api.joinRoom(code, name);
      this.enter(creds, name);
    });
  }

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    this.createError.set('');
    const name = normalizeName(this.name());
    if (!name) {
      this.createError.set(nl.errors.invalid_name);
      return;
    }
    if (this.botCheckState() === 'failed') {
      this.createError.set(nl.create.botCheckFailed);
      return;
    }
    if (!this.turnstileToken) {
      this.createError.set(nl.create.botCheckWaiting);
      return;
    }
    const token = this.turnstileToken;
    // Turnstile tokens are single-use: get a fresh one for any retry.
    this.turnstileToken = null;
    if (this.widgetId) this.turnstileApi?.reset(this.widgetId);
    await this.run(this.createError, async () => {
      const creds = await this.api.createRoom(name, token, this.presetId() || null);
      this.enter(creds, name);
    });
  }

  /** Optional: without the list the room simply starts with the default preset. */
  private async loadPresets(): Promise<void> {
    if (!this.store.teamToken()) return;
    try {
      const presets = await this.api.presets();
      this.presets.set(presets);
      this.presetId.set(presets.find((p) => p.isDefault)?.id ?? presets[0]?.id ?? '');
    } catch {
      this.presets.set([]);
    }
  }

  private enter(creds: { code: string; participantId: string; token: string }, name: string): void {
    this.store.saveName(name);
    this.store.saveRoom(creds);
    void this.router.navigate(['/r', creds.code]);
  }

  private async run(error: ReturnType<typeof signal<string>>, action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await action();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === 'unauthorized') {
        this.hasTeam.set(false);
      }
      error.set(errorText(failure));
    } finally {
      this.busy.set(false);
    }
  }

  private async renderBotCheck(): Promise<void> {
    const container = this.botCheck()?.nativeElement;
    if (!container || container === this.renderedInto) return;
    this.renderedInto = container;
    this.botCheckState.set('loading');
    try {
      const [{ turnstileSiteKey }, turnstile] = await Promise.all([
        this.api.config(),
        this.turnstile.load(),
      ]);
      this.turnstileApi = turnstile;
      this.widgetId = turnstile.render(container, {
        sitekey: turnstileSiteKey,
        action: 'create-room',
        language: 'nl',
        theme: 'auto',
        callback: (token) => {
          this.turnstileToken = token;
          this.botCheckState.set('ready');
        },
        'expired-callback': () => {
          this.turnstileToken = null;
        },
        'error-callback': () => {
          this.turnstileToken = null;
          this.botCheckState.set('failed');
        },
      });
    } catch (error) {
      this.botCheckState.set('failed');
      if (error instanceof ApiFailure && error.code === 'not_configured') {
        this.createError.set(nl.errors.not_configured);
      }
    }
  }
}
