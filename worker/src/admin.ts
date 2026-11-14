/**
 * The admin API under /admin/api. Cloudflare Access sits in front of /admin;
 * this file still checks everything itself:
 *
 * - the Access JWT (signature, issuer, audience, time, email allow-list),
 * - for every change: the exact Origin, a custom header that cross-site
 *   forms cannot send, and a JSON body (so the Access cookie alone can never
 *   be used for cross-site request forgery),
 * - every input against the shared schemas and the same text rules as rooms.
 *
 * Each change is written together with its audit row in one D1 batch.
 */
import {
  AUDIT_PAGE_SIZE,
  CATALOGUE_MAX_RESTAURANTS,
  PRESETS_MAX,
  normalizeCategories,
  normalizeMapsUrl,
  normalizeRestaurantName,
  normalizeRoomCode,
  presetInput,
  presetRestaurantsInput,
  restaurantInput,
  acceptableTeamKey,
  teamKeyInput,
  type AdminError,
} from '@lunchrad/shared';
import { Hono, type Context, type Next } from 'hono';
import { adminConfig, verifyAccessJwt, type AdminIdentity } from './access.ts';
import { randomId } from './crypto.ts';
import {
  auditStatement,
  isUniqueViolation,
  listAudit,
  listPresets,
  listRestaurants,
  openRooms,
  presetCount,
  restaurantCount,
  restaurantNameKey,
  type AuditInput,
} from './db.ts';
import { isConfigured, type ConfiguredEnv, type Env } from './env.ts';
import { readJson } from './http.ts';
import { clearTeamKeyCache, generateTeamKey, teamKeyCheckHash, teamKeySource } from './team-key.ts';

interface AdminEnv {
  Bindings: Env;
  Variables: { admin: AdminIdentity; env: ConfiguredEnv };
}
type AdminContext = Context<AdminEnv>;

const STATUS: Record<AdminError, 400 | 401 | 403 | 404 | 409 | 500 | 503> = {
  unauthorized: 401,
  forbidden: 403,
  not_configured: 503,
  bad_request: 400,
  not_found: 404,
  invalid_restaurant: 400,
  invalid_category: 400,
  invalid_maps_url: 400,
  restaurant_exists: 409,
  catalogue_full: 409,
  invalid_preset_name: 400,
  preset_exists: 409,
  too_many_presets: 409,
  too_many_restaurants: 400,
  default_preset: 409,
  weak_team_key: 400,
  server_error: 500,
};

/** Admin responses are personal and must never be cached anywhere. */
const PRIVATE = { 'Cache-Control': 'no-store, private' };

export const ADMIN_HEADER = 'X-Lunchrad-Admin';

function fail(error: AdminError): Response {
  return Response.json({ error }, { status: STATUS[error], headers: PRIVATE });
}

function ok(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: PRIVATE });
}

export const admin = new Hono<AdminEnv>();

admin.use('*', async (c: AdminContext, next: Next) => {
  const config = adminConfig(c.env);
  if (!config || !isConfigured(c.env)) return fail('not_configured');
  const identity = await verifyAccessJwt(config, c.req.header('Cf-Access-Jwt-Assertion'));
  if (!identity) return fail('unauthorized');

  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('Origin');
    if (!origin || origin !== new URL(c.req.url).origin) return fail('forbidden');
    if (c.req.header(ADMIN_HEADER) !== '1') return fail('forbidden');
  }
  c.set('admin', identity);
  c.set('env', c.env);
  await next();
  return undefined;
});

async function overview(c: AdminContext): Promise<Response> {
  const db = c.env.DB;
  const [restaurants, presets] = await Promise.all([listRestaurants(db), listPresets(db)]);
  return ok({ email: c.get('admin').email, restaurants, presets });
}

/** Runs the change and its audit row atomically, then answers with the new overview. */
async function change(
  c: AdminContext,
  statements: D1PreparedStatement[],
  audit: Omit<AuditInput, 'email'>,
  conflict: AdminError | null = null,
): Promise<Response> {
  const db = c.env.DB;
  try {
    await db.batch([
      ...statements,
      auditStatement(db, Date.now(), { ...audit, email: c.get('admin').email }),
    ]);
  } catch (err) {
    if (conflict && isUniqueViolation(err)) return fail(conflict);
    throw err;
  }
  return overview(c);
}

async function body(c: AdminContext): Promise<unknown> {
  return readJson(c.req.raw);
}

const ID = /^[a-f0-9]{16}$/;

function validId(c: AdminContext): string | null {
  const id = c.req.param('id') ?? '';
  return ID.test(id) ? id : null;
}

// ---------- Overview ----------

admin.get('/overview', (c) => overview(c));

// ---------- Restaurants ----------

type CleanRestaurant =
  | { ok: true; name: string; categories: string[]; mapsUrl: string | null }
  | { ok: false; error: AdminError };

function cleanRestaurant(raw: unknown): CleanRestaurant {
  const parsed = restaurantInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'bad_request' };
  const name = normalizeRestaurantName(parsed.data.name);
  if (!name) return { ok: false, error: 'invalid_restaurant' };
  const categories = normalizeCategories(parsed.data.categories);
  if (categories === undefined) return { ok: false, error: 'invalid_category' };
  const mapsUrl = normalizeMapsUrl(parsed.data.mapsUrl);
  if (mapsUrl === undefined) return { ok: false, error: 'invalid_maps_url' };
  return { ok: true, name, categories, mapsUrl };
}

admin.post('/restaurants', async (c) => {
  const input = cleanRestaurant(await body(c));
  if (!input.ok) return fail(input.error);
  if ((await restaurantCount(c.env.DB)) >= CATALOGUE_MAX_RESTAURANTS) return fail('catalogue_full');
  const id = randomId();
  const now = Date.now();
  return change(
    c,
    [
      c.env.DB.prepare(
        'INSERT INTO restaurant (id, name, name_key, categories, maps_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        id,
        input.name,
        restaurantNameKey(input.name),
        JSON.stringify(input.categories),
        input.mapsUrl,
        now,
        now,
      ),
    ],
    {
      action: 'create',
      entity: 'restaurant',
      entityId: id,
      detail: { name: input.name, categories: input.categories, mapsUrl: input.mapsUrl },
    },
    'restaurant_exists',
  );
});

admin.patch('/restaurants/:id', async (c) => {
  const id = validId(c);
  if (!id) return fail('not_found');
  const input = cleanRestaurant(await body(c));
  if (!input.ok) return fail(input.error);
  const before = await c.env.DB.prepare(
    'SELECT name, categories, maps_url FROM restaurant WHERE id = ?',
  )
    .bind(id)
    .first<{ name: string; categories: string; maps_url: string | null }>();
  if (!before) return fail('not_found');
  return change(
    c,
    [
      c.env.DB.prepare(
        'UPDATE restaurant SET name = ?, name_key = ?, categories = ?, maps_url = ?, updated_at = ? WHERE id = ?',
      ).bind(
        input.name,
        restaurantNameKey(input.name),
        JSON.stringify(input.categories),
        input.mapsUrl,
        Date.now(),
        id,
      ),
    ],
    {
      action: 'update',
      entity: 'restaurant',
      entityId: id,
      detail: {
        before: { name: before.name, categories: before.categories, mapsUrl: before.maps_url },
        after: { name: input.name, categories: input.categories, mapsUrl: input.mapsUrl },
      },
    },
    'restaurant_exists',
  );
});

admin.delete('/restaurants/:id', async (c) => {
  const id = validId(c);
  if (!id) return fail('not_found');
  const before = await c.env.DB.prepare('SELECT name FROM restaurant WHERE id = ?')
    .bind(id)
    .first<{ name: string }>();
  if (!before) return fail('not_found');
  // Removed from every preset by ON DELETE CASCADE; open rooms keep their copy.
  return change(c, [c.env.DB.prepare('DELETE FROM restaurant WHERE id = ?').bind(id)], {
    action: 'delete',
    entity: 'restaurant',
    entityId: id,
    detail: { name: before.name },
  });
});

// ---------- Presets ----------

async function presetName(c: AdminContext): Promise<string | AdminError> {
  const parsed = presetInput.safeParse(await body(c));
  if (!parsed.success) return 'bad_request';
  return normalizeRestaurantName(parsed.data.name) ?? 'invalid_preset_name';
}

function isError(value: string): value is AdminError {
  return value === 'bad_request' || value === 'invalid_preset_name';
}

admin.post('/presets', async (c) => {
  const name = await presetName(c);
  if (isError(name)) return fail(name);
  const count = await presetCount(c.env.DB);
  if (count >= PRESETS_MAX) return fail('too_many_presets');
  const id = randomId();
  const now = Date.now();
  return change(
    c,
    [
      c.env.DB.prepare(
        'INSERT INTO preset (id, name, name_key, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(id, name, restaurantNameKey(name), count === 0 ? 1 : 0, now, now),
    ],
    { action: 'create', entity: 'preset', entityId: id, detail: { name } },
    'preset_exists',
  );
});

admin.patch('/presets/:id', async (c) => {
  const id = validId(c);
  if (!id) return fail('not_found');
  const name = await presetName(c);
  if (isError(name)) return fail(name);
  const before = await c.env.DB.prepare('SELECT name FROM preset WHERE id = ?')
    .bind(id)
    .first<{ name: string }>();
  if (!before) return fail('not_found');
  return change(
    c,
    [
      c.env.DB.prepare(
        'UPDATE preset SET name = ?, name_key = ?, updated_at = ? WHERE id = ?',
      ).bind(name, restaurantNameKey(name), Date.now(), id),
    ],
    {
      action: 'rename',
      entity: 'preset',
      entityId: id,
      detail: { before: before.name, after: name },
    },
    'preset_exists',
  );
});

admin.put('/presets/:id/restaurants', async (c) => {
  const id = validId(c);
  if (!id) return fail('not_found');
  const parsed = presetRestaurantsInput.safeParse(await body(c));
  if (!parsed.success) return fail('too_many_restaurants');
  const ids = [...new Set(parsed.data.restaurantIds)];
  const db = c.env.DB;
  const preset = await db
    .prepare('SELECT name FROM preset WHERE id = ?')
    .bind(id)
    .first<{ name: string }>();
  if (!preset) return fail('not_found');
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const found = await db
      .prepare(`SELECT count(*) AS n FROM restaurant WHERE id IN (${placeholders})`)
      .bind(...ids)
      .first<{ n: number }>();
    if (found?.n !== ids.length) return fail('not_found');
  }
  return change(
    c,
    [
      db.prepare('DELETE FROM preset_restaurant WHERE preset_id = ?').bind(id),
      ...ids.map((rid, position) =>
        db
          .prepare(
            'INSERT INTO preset_restaurant (preset_id, restaurant_id, position) VALUES (?, ?, ?)',
          )
          .bind(id, rid, position),
      ),
      db.prepare('UPDATE preset SET updated_at = ? WHERE id = ?').bind(Date.now(), id),
    ],
    {
      action: 'set_restaurants',
      entity: 'preset',
      entityId: id,
      detail: { name: preset.name, restaurantIds: ids },
    },
  );
});

admin.post('/presets/:id/default', async (c) => {
  const id = validId(c);
  if (!id) return fail('not_found');
  const db = c.env.DB;
  const preset = await db
    .prepare('SELECT name FROM preset WHERE id = ?')
    .bind(id)
    .first<{ name: string }>();
  if (!preset) return fail('not_found');
  return change(
    c,
    [
      db.prepare('UPDATE preset SET is_default = 0 WHERE is_default = 1 AND id <> ?').bind(id),
      db
        .prepare('UPDATE preset SET is_default = 1, updated_at = ? WHERE id = ?')
        .bind(Date.now(), id),
    ],
    { action: 'make_default', entity: 'preset', entityId: id, detail: { name: preset.name } },
  );
});

admin.delete('/presets/:id', async (c) => {
  const id = validId(c);
  if (!id) return fail('not_found');
  const preset = await c.env.DB.prepare('SELECT name, is_default FROM preset WHERE id = ?')
    .bind(id)
    .first<{ name: string; is_default: number }>();
  if (!preset) return fail('not_found');
  // Rooms start from the default; make another one the default first.
  if (preset.is_default === 1) return fail('default_preset');
  return change(c, [c.env.DB.prepare('DELETE FROM preset WHERE id = ?').bind(id)], {
    action: 'delete',
    entity: 'preset',
    entityId: id,
    detail: { name: preset.name },
  });
});

// ---------- Rooms ----------

admin.get('/rooms', async (c) => {
  const env = c.get('env');
  const rows = await openRooms(env.DB, Date.now());
  const rooms = [];
  for (const row of rows) {
    const summary = await env.ROOMS.get(env.ROOMS.idFromName(row.code)).summary();
    if (summary) rooms.push({ ...row, ...summary });
  }
  return ok({ rooms });
});

admin.post('/rooms/:code/close', async (c) => {
  const env = c.get('env');
  const code = normalizeRoomCode(c.req.param('code') ?? '');
  if (!code) return fail('not_found');
  const closed = await env.ROOMS.get(env.ROOMS.idFromName(code)).adminClose();
  if (!closed) return fail('not_found');
  await env.DB.batch([
    auditStatement(env.DB, Date.now(), {
      email: c.get('admin').email,
      action: 'close',
      entity: 'room',
      entityId: code,
    }),
  ]);
  return ok({ closed: code });
});

// ---------- Team key ----------

admin.get('/team-key', async (c) => ok(await teamKeySource(c.get('env'))));

/**
 * Makes a new team key, shown once in the response. Every device has to enter
 * it; existing team sessions stop working (within 30 seconds everywhere).
 * Open rooms keep running for the people already in them.
 */
admin.post('/team-key/rotate', async (c) => {
  const env = c.get('env');
  // With a JSON body {teamKey}: the admin's own key. Without a body: a generated one.
  let teamKey: string;
  let chosen: 'custom' | 'generated';
  if (c.req.header('Content-Length') === '0' || !c.req.raw.body) {
    teamKey = generateTeamKey();
    chosen = 'generated';
  } else {
    const parsed = teamKeyInput.safeParse(await body(c));
    if (!parsed.success) return fail('bad_request');
    const key = acceptableTeamKey(parsed.data.teamKey);
    if (!key) return fail('weak_team_key');
    teamKey = key;
    chosen = 'custom';
  }
  const rotatedAt = Date.now();
  const email = c.get('admin').email;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR REPLACE INTO team_key (id, check_hash, rotated_at, rotated_by) VALUES (1, ?, ?, ?)',
    ).bind(await teamKeyCheckHash(env, teamKey), rotatedAt, email),
    // Never the key itself.
    auditStatement(env.DB, rotatedAt, {
      email,
      action: 'rotate',
      entity: 'team_key',
      entityId: null,
      detail: { chosen },
    }),
  ]);
  clearTeamKeyCache();
  return ok({ teamKey, rotatedAt });
});

// ---------- Audit log ----------

admin.get('/audit', async (c) => {
  const raw = c.req.query('before');
  const before = raw === undefined ? null : Number(raw);
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) return fail('bad_request');
  const entries = await listAudit(c.env.DB, before, AUDIT_PAGE_SIZE);
  const last = entries.at(-1);
  return ok({
    entries,
    nextBefore: entries.length === AUDIT_PAGE_SIZE && last ? last.id : null,
  });
});

admin.all('*', () => fail('not_found'));

admin.onError((err) => {
  console.error('Admin API error', { name: err.name, message: err.message });
  return fail('server_error');
});
