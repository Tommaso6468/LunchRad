import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Pwa } from './core/pwa';
import { AppStatus } from './ui/app-status';
import { ToastHost } from './ui/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastHost, AppStatus],
  template: `
    <app-toast-host />
    <main class="shell">
      <app-status />
      <router-outlet />
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  constructor() {
    inject(Pwa).start();
  }
}
