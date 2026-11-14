import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Toasts } from '../core/toasts';
import { nl } from '../i18n/nl';

/**
 * Shows the big-screen link to the host. The token travels in the URL
 * fragment, which browsers never send to the server or in a Referer.
 */
@Component({
  selector: 'app-display-link-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #dialog aria-labelledby="display-title" (close)="url.set('')">
      <div class="sheet">
        <h2 id="display-title">{{ t.title }}</h2>
        <p class="muted">{{ t.intro }}</p>
        <label for="display-url">{{ t.linkLabel }}</label>
        <input id="display-url" readonly [value]="url()" (focus)="select($event)" />
        <div class="row">
          <a class="button primary" [href]="url()" target="_blank" rel="noopener noreferrer">
            {{ t.open }}
          </a>
          <button type="button" class="secondary" (click)="copy()">{{ t.copy }}</button>
        </div>
        <p class="hint">{{ t.note }}</p>
        <div class="row">
          <button type="button" class="secondary" (click)="close()">{{ t.close }}</button>
        </div>
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(28rem, 100%);
      max-width: 100%;
      margin: auto auto 0;
      padding: 1.5rem 1rem max(1.5rem, env(safe-area-inset-bottom));
      border: 2px solid var(--ink);
      border-bottom: 0;
      border-radius: 1.25rem 1.25rem 0 0;
      background: var(--surface);
      color: var(--ink);
    }
    dialog::backdrop {
      background: rgb(18 48 41 / 0.55);
    }
    @media (min-width: 40rem) {
      dialog {
        margin: auto;
        border-bottom: 2px solid var(--ink);
        border-radius: 1.25rem;
      }
    }
    .sheet {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    input {
      font-family: var(--font-code);
      font-size: 0.85rem;
    }
  `,
})
export class DisplayLinkDialog {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly toasts = inject(Toasts);
  protected readonly t = nl.display.link;
  protected readonly url = signal('');

  show(url: string): void {
    this.url.set(url);
    const el = this.dialog().nativeElement;
    if (!el.open) el.showModal();
  }

  close(): void {
    this.dialog().nativeElement.close();
  }

  protected select(event: Event): void {
    (event.target as HTMLInputElement).select();
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url());
      this.toasts.show(this.t.copied);
    } catch {
      // Clipboard blocked: the link is selectable.
    }
  }
}
