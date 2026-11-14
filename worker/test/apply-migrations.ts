import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { beforeEach } from 'vitest';
import { clearAccessKeyCache } from '../src/access.ts';
import { clearTeamKeyCache } from '../src/team-key.ts';

const testEnv = env as unknown as { DB: D1Database; TEST_MIGRATIONS: D1Migration[] };

// Migrations are idempotent (tracked in d1_migrations), so this is cheap.
await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);

beforeEach(() => {
  clearTeamKeyCache();
  clearAccessKeyCache();
});
