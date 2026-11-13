import type { Room } from './room.ts';

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<Room>;
  ENVIRONMENT: string;

  // Secrets (wrangler secret put / dashboard). Missing secrets make the room
  // API answer 503 instead of running with an insecure default.
  TEAM_KEY?: string | undefined;
  SESSION_SECRET?: string | undefined;
  TURNSTILE_SECRET_KEY?: string | undefined;
  TURNSTILE_SITE_KEY?: string | undefined;

  // Workers rate limiting bindings (approximate, per Cloudflare location).
  SESSION_LIMITER: RateLimit;
  CREATE_LIMITER: RateLimit;
  JOIN_LIMITER: RateLimit;
  WS_LIMITER: RateLimit;
}

export interface ConfiguredEnv extends Env {
  TEAM_KEY: string;
  SESSION_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
}

/** Narrow to an env with all secrets present and long enough to be safe. */
export function isConfigured(env: Env): env is ConfiguredEnv {
  return (
    typeof env.TEAM_KEY === 'string' &&
    env.TEAM_KEY.length >= 8 &&
    typeof env.SESSION_SECRET === 'string' &&
    env.SESSION_SECRET.length >= 32 &&
    typeof env.TURNSTILE_SECRET_KEY === 'string' &&
    env.TURNSTILE_SECRET_KEY.length > 0 &&
    typeof env.TURNSTILE_SITE_KEY === 'string' &&
    env.TURNSTILE_SITE_KEY.length > 0
  );
}
