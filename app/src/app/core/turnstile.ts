import { Injectable } from '@angular/core';

/**
 * Loads Cloudflare Turnstile (the bot check before creating a room).
 *
 * The page runs with Trusted Types enforced, so a script URL can only be set
 * through a policy. This policy accepts exactly one URL. The script also gets
 * the page's CSP nonce, which Turnstile passes on to what it loads.
 */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const POLICY_NAME = 'lunchrad#turnstile';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      language: string;
      theme: 'auto';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

interface TrustedTypesWindow {
  trustedTypes?: {
    createPolicy(
      name: string,
      rules: { createScriptURL: (url: string) => string },
    ): { createScriptURL(url: string): unknown };
  };
  turnstile?: TurnstileApi;
}

let loading: Promise<TurnstileApi> | null = null;
let scriptUrlPolicy: { createScriptURL(url: string): unknown } | null | undefined;

function trustedScriptUrl(): unknown {
  const w = window as unknown as TrustedTypesWindow;
  if (scriptUrlPolicy === undefined) {
    // Policies can only be created once per name; keep the first one.
    scriptUrlPolicy =
      w.trustedTypes?.createPolicy(POLICY_NAME, {
        createScriptURL: (url) => {
          if (url !== SCRIPT_URL) throw new Error('Script URL not allowed');
          return url;
        },
      }) ?? null;
  }
  return scriptUrlPolicy ? scriptUrlPolicy.createScriptURL(SCRIPT_URL) : SCRIPT_URL;
}

@Injectable({ providedIn: 'root' })
export class Turnstile {
  load(): Promise<TurnstileApi> {
    const w = window as unknown as TrustedTypesWindow;
    if (w.turnstile) return Promise.resolve(w.turnstile);
    loading ??= new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      // Trusted Types: the policy returns a TrustedScriptURL for this one URL.
      (script as unknown as { src: unknown }).src = trustedScriptUrl();
      script.async = true;
      script.nonce = document.querySelector('app-root')?.getAttribute('ngcspnonce') ?? '';
      script.addEventListener('load', () => {
        if (w.turnstile) resolve(w.turnstile);
        else reject(new Error('Turnstile missing'));
      });
      script.addEventListener('error', () => {
        loading = null;
        reject(new Error('Turnstile failed to load'));
      });
      document.head.appendChild(script);
    });
    return loading;
  }
}
