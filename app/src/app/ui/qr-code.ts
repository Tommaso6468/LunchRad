import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { encode } from 'uqr';

/**
 * QR code drawn as an SVG path from the module matrix. Nothing is injected
 * as HTML; the path data is a plain attribute binding.
 */
@Component({
  selector: 'app-qr-code',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="viewBox()"
      role="img"
      [attr.aria-label]="label()"
      shape-rendering="crispEdges"
    >
      <rect [attr.width]="size()" [attr.height]="size()" fill="#ffffff" />
      <path [attr.d]="path()" fill="#123029" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      width: min(16rem, 100%);
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      border-radius: 0.4rem;
    }
  `,
})
export class QrCode {
  readonly value = input.required<string>();
  readonly label = input.required<string>();

  private readonly matrix = computed(() => encode(this.value(), { border: 2, ecc: 'M' }));
  protected readonly size = computed(() => this.matrix().size);
  protected readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
  protected readonly path = computed(() => {
    const parts: string[] = [];
    this.matrix().data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
      }),
    );
    return parts.join('');
  });
}
