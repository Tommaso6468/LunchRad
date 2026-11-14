import { Injectable, isDevMode, signal } from '@angular/core';

const SW_URL = '/sw.js';
const POLICY_NAME = 'lunchrad#sw';

interface TrustedTypesWindow {
  trustedTypes?: {
    createPolicy(
      name: string,
      rules: { createScriptURL: (url: string) => string },
    ): { createScriptURL(url: string): unknown };
  };
}

/**
 * Installs the service worker and tells the app when a new version is ready
 * or the network is gone. A new version waits until the person chooses to
 * reload, so nobody is pulled out of a room in the middle of a spin.
 */
@Injectable({ providedIn: 'root' })
export class Pwa {
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly updateReady = signal(false);
  private waiting: ServiceWorker | null = null;

  start(): void {
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
    if (isDevMode() || !('serviceWorker' in navigator)) return;
    void this.register();
  }

  /** Activates the waiting version and reloads once it has taken over. */
  applyUpdate(): void {
    if (!this.waiting) return;
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
      once: true,
    });
    this.waiting.postMessage('update');
  }

  private async register(): Promise<void> {
    try {
      const w = window as unknown as TrustedTypesWindow;
      // Trusted Types: register() is a script-URL sink; this policy allows /sw.js only.
      const policy = w.trustedTypes?.createPolicy(POLICY_NAME, {
        createScriptURL: (url) => {
          if (url !== SW_URL) throw new Error('Service worker URL not allowed');
          return url;
        },
      });
      const url = (policy ? policy.createScriptURL(SW_URL) : SW_URL) as string;
      const registration = await navigator.serviceWorker.register(url, {
        scope: '/',
        updateViaCache: 'none',
      });

      const watch = (worker: ServiceWorker | null) => {
        if (!worker) return;
        const check = () => {
          // Only an update, not the very first install, needs a reload.
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            this.waiting = worker;
            this.updateReady.set(true);
          }
        };
        worker.addEventListener('statechange', check);
        check();
      };
      watch(registration.waiting);
      registration.addEventListener('updatefound', () => watch(registration.installing));

      // Look for a new version when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible')
          void registration.update().catch(() => undefined);
      });
    } catch (error) {
      console.warn('Service worker not registered', error);
    }
  }
}
