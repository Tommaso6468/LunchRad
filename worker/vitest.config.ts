import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Tests run inside workerd (the real Workers runtime), so HTMLRewriter,
// crypto, Durable Objects and WebSockets behave as in production. Bindings
// are declared here rather than read from wrangler.jsonc, so tests do not
// need the Angular build. Secrets use Cloudflare's always-pass Turnstile
// test secret and throwaway values.
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  test: {
    setupFiles: ['./test/apply-migrations.ts'],
  },
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      miniflare: {
        compatibilityDate: '2026-10-01',
        bindings: {
          ENVIRONMENT: 'test',
          TEAM_KEY: 'test-team-key',
          SESSION_SECRET: 'test-session-secret-that-is-at-least-32-chars',
          TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
          TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
          ACCESS_TEAM_DOMAIN: 'lunchrad-test.cloudflareaccess.com',
          ACCESS_AUD: 'a'.repeat(64),
          ADMIN_EMAILS: 'beheer@example.com, tweede@example.com',
          TEST_MIGRATIONS: migrations,
        },
        d1Databases: ['DB'],
        durableObjects: { ROOMS: { className: 'Room', useSQLite: true } },
        ratelimits: {
          SESSION_LIMITER: { namespace_id: '1', simple: { limit: 10, period: 60 } },
          CREATE_LIMITER: { namespace_id: '2', simple: { limit: 5, period: 60 } },
          JOIN_LIMITER: { namespace_id: '3', simple: { limit: 60, period: 60 } },
          WS_LIMITER: { namespace_id: '4', simple: { limit: 120, period: 60 } },
        },
      },
    }),
  ],
});
