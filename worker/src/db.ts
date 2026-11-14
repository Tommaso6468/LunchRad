/**
 * D1 access: the restaurant catalogue, presets, the admin audit log, the
 * open-room registry and the admin-set team key. Every query is a prepared
 * statement with bound parameters; no SQL is ever built from input.
 *
 * Every admin change runs in one batch together with its audit row, so a
 * change without an audit entry (or the other way round) cannot happen.
 */
import {
  normalizeCategories,
  normalizeMapsUrl,
  normalizeRestaurantName,
  restaurantKey,
  type AdminPreset,
  type AdminRestaurant,
  type AuditEntry,
  type PresetSummary,
} from '@lunchrad/shared';

export interface MenuItem {
  name: string;
  categories: string[];
  mapsUrl: string | null;
}

export interface AuditInput {
  email: string;
  action: string;
  entity: 'restaurant' | 'preset' | 'room' | 'team_key' | 'history';
  entityId: string | null;
  detail?: Record<string, unknown>;
}

export function auditStatement(db: D1Database, now: number, a: AuditInput): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO admin_audit (at, admin_email, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(now, a.email, a.action, a.entity, a.entityId, JSON.stringify(a.detail ?? {}));
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

function parseCategories(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function splitIds(list: string | null): string[] {
  return list ? list.split(',') : [];
}

// ---------- Catalogue ----------

interface RestaurantRow {
  id: string;
  name: string;
  categories: string;
  maps_url: string | null;
  updated_at: number;
  preset_ids: string | null;
}

export async function listRestaurants(db: D1Database): Promise<AdminRestaurant[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.name, r.categories, r.maps_url, r.updated_at,
              (SELECT group_concat(preset_id) FROM preset_restaurant WHERE restaurant_id = r.id) AS preset_ids
         FROM restaurant r ORDER BY r.name_key`,
    )
    .all<RestaurantRow>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    categories: parseCategories(r.categories),
    mapsUrl: r.maps_url,
    presetIds: splitIds(r.preset_ids),
    updatedAt: r.updated_at,
  }));
}

interface PresetRow {
  id: string;
  name: string;
  is_default: number;
  updated_at: number;
  restaurant_ids: string | null;
}

export async function listPresets(db: D1Database): Promise<AdminPreset[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.is_default, p.updated_at,
              (SELECT group_concat(restaurant_id) FROM
                 (SELECT restaurant_id FROM preset_restaurant WHERE preset_id = p.id ORDER BY position)
              ) AS restaurant_ids
         FROM preset p ORDER BY p.is_default DESC, p.name_key`,
    )
    .all<PresetRow>();
  return results.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.is_default === 1,
    restaurantIds: splitIds(p.restaurant_ids),
    updatedAt: p.updated_at,
  }));
}

export async function presetSummaries(db: D1Database): Promise<PresetSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT p.id, p.name, p.is_default,
              (SELECT count(*) FROM preset_restaurant WHERE preset_id = p.id) AS count
         FROM preset p ORDER BY p.is_default DESC, p.name_key`,
    )
    .all<{ id: string; name: string; is_default: number; count: number }>();
  return results.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.is_default === 1,
    count: p.count,
  }));
}

/**
 * The restaurants a new room starts with. `presetId` undefined means the
 * default preset (an empty wheel when there is none). Returns null for an
 * unknown preset id. Rows are re-validated: anything that would not pass the
 * room's own rules is skipped.
 */
export async function presetMenu(
  db: D1Database,
  presetId: string | undefined,
): Promise<MenuItem[] | null> {
  const preset = await db
    .prepare(
      presetId === undefined
        ? 'SELECT id FROM preset WHERE is_default = 1'
        : 'SELECT id FROM preset WHERE id = ?',
    )
    .bind(...(presetId === undefined ? [] : [presetId]))
    .first<{ id: string }>();
  if (!preset) return presetId === undefined ? [] : null;

  const { results } = await db
    .prepare(
      `SELECT r.name, r.categories, r.maps_url FROM preset_restaurant pr
         JOIN restaurant r ON r.id = pr.restaurant_id
        WHERE pr.preset_id = ? ORDER BY pr.position`,
    )
    .bind(preset.id)
    .all<{ name: string; categories: string; maps_url: string | null }>();
  const menu: MenuItem[] = [];
  for (const row of results) {
    const name = normalizeRestaurantName(row.name);
    const categories = normalizeCategories(parseCategories(row.categories));
    const mapsUrl = normalizeMapsUrl(row.maps_url);
    if (!name || categories === undefined || mapsUrl === undefined) continue;
    menu.push({ name, categories, mapsUrl });
  }
  return menu;
}

export async function restaurantCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT count(*) AS n FROM restaurant').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function presetCount(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT count(*) AS n FROM preset').first<{ n: number }>();
  return row?.n ?? 0;
}

export function restaurantNameKey(name: string): string {
  return restaurantKey(name);
}

// ---------- Audit ----------

interface AuditRow {
  id: number;
  at: number;
  admin_email: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: string;
}

export async function listAudit(
  db: D1Database,
  before: number | null,
  pageSize: number,
): Promise<AuditEntry[]> {
  const { results } = await db
    .prepare(
      before === null
        ? 'SELECT * FROM admin_audit ORDER BY id DESC LIMIT ?'
        : 'SELECT * FROM admin_audit WHERE id < ? ORDER BY id DESC LIMIT ?',
    )
    .bind(...(before === null ? [pageSize] : [before, pageSize]))
    .all<AuditRow>();
  return results.map((r) => {
    let detail: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(r.detail);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        detail = parsed as Record<string, unknown>;
      }
    } catch {
      // Keep an empty detail rather than failing the whole page.
    }
    return {
      id: r.id,
      at: r.at,
      adminEmail: r.admin_email,
      action: r.action,
      entity: r.entity,
      entityId: r.entity_id,
      detail,
    };
  });
}

// ---------- Open rooms ----------

export async function registerRoom(
  db: D1Database,
  code: string,
  createdAt: number,
  expiresAt: number,
): Promise<void> {
  await db
    .prepare('INSERT OR REPLACE INTO open_room (code, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(code, createdAt, expiresAt)
    .run();
}

export async function unregisterRoom(db: D1Database, code: string): Promise<void> {
  await db.prepare('DELETE FROM open_room WHERE code = ?').bind(code).run();
}

export async function openRooms(
  db: D1Database,
  now: number,
): Promise<{ code: string; createdAt: number; expiresAt: number }[]> {
  // Rows of rooms that closed without removing themselves expire on their own.
  await db.prepare('DELETE FROM open_room WHERE expires_at < ?').bind(now).run();
  const { results } = await db
    .prepare(
      'SELECT code, created_at, expires_at FROM open_room ORDER BY created_at DESC LIMIT 100',
    )
    .all<{ code: string; created_at: number; expires_at: number }>();
  return results.map((r) => ({ code: r.code, createdAt: r.created_at, expiresAt: r.expires_at }));
}

// ---------- Team key ----------

export interface StoredTeamKey {
  checkHash: string;
  rotatedAt: number;
  rotatedBy: string;
}

export async function storedTeamKey(db: D1Database): Promise<StoredTeamKey | null> {
  const row = await db
    .prepare('SELECT check_hash, rotated_at, rotated_by FROM team_key WHERE id = 1')
    .first<{ check_hash: string; rotated_at: number; rotated_by: string }>();
  return row
    ? { checkHash: row.check_hash, rotatedAt: row.rotated_at, rotatedBy: row.rotated_by }
    : null;
}

// ---------- Lunch history ----------

export async function visitedKeys(db: D1Database): Promise<string[]> {
  const { results } = await db
    .prepare('SELECT DISTINCT name_key FROM lunch_history LIMIT 5000')
    .all<{ name_key: string }>();
  return results.map((r) => r.name_key);
}

export async function recordLunch(
  db: D1Database,
  lunch: {
    ref: string;
    at: number;
    name: string;
    categories: string[];
    respins: number;
    newPlace: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO lunch_history
         (room_ref, decided_at, name, name_key, categories, respins, new_place)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      lunch.ref,
      lunch.at,
      lunch.name,
      restaurantKey(lunch.name),
      JSON.stringify(lunch.categories),
      lunch.respins,
      lunch.newPlace ? 1 : 0,
    )
    .run();
}

export interface HistoryEntry {
  id: number;
  decidedAt: number;
  name: string;
  categories: string[];
  respins: number;
  newPlace: boolean;
}

interface HistoryRow {
  id: number;
  decided_at: number;
  name: string;
  categories: string;
  respins: number;
  new_place: number;
}

function historyEntry(r: HistoryRow): HistoryEntry {
  return {
    id: r.id,
    decidedAt: r.decided_at,
    name: r.name,
    categories: parseCategories(r.categories),
    respins: r.respins,
    newPlace: r.new_place === 1,
  };
}

export async function listHistory(
  db: D1Database,
  before: number | null,
  pageSize: number,
): Promise<HistoryEntry[]> {
  const { results } = await db
    .prepare(
      before === null
        ? 'SELECT id, decided_at, name, categories, respins, new_place FROM lunch_history ORDER BY id DESC LIMIT ?'
        : 'SELECT id, decided_at, name, categories, respins, new_place FROM lunch_history WHERE id < ? ORDER BY id DESC LIMIT ?',
    )
    .bind(...(before === null ? [pageSize] : [before, pageSize]))
    .all<HistoryRow>();
  return results.map(historyEntry);
}

export interface Stats {
  total: number;
  since: number | null;
  top: { name: string; count: number; lastAt: number }[];
  recent: { name: string; categories: string[]; decidedAt: number; newPlace: boolean }[];
}

export async function stats(db: D1Database): Promise<Stats> {
  const [summary, top, recent] = await db.batch([
    db.prepare('SELECT count(*) AS total, min(decided_at) AS since FROM lunch_history'),
    db.prepare(
      `SELECT name_key, count(*) AS count, max(decided_at) AS last_at,
              (SELECT name FROM lunch_history h2 WHERE h2.name_key = h.name_key ORDER BY id DESC LIMIT 1) AS name
         FROM lunch_history h GROUP BY name_key ORDER BY count DESC, last_at DESC LIMIT 10`,
    ),
    db.prepare(
      'SELECT id, decided_at, name, categories, respins, new_place FROM lunch_history ORDER BY id DESC LIMIT 20',
    ),
  ]);
  const s = (summary?.results[0] ?? {}) as { total?: number; since?: number | null };
  return {
    total: s.total ?? 0,
    since: s.since ?? null,
    top: ((top?.results ?? []) as { name: string; count: number; last_at: number }[]).map((r) => ({
      name: r.name,
      count: r.count,
      lastAt: r.last_at,
    })),
    recent: ((recent?.results ?? []) as HistoryRow[]).map((r) => {
      const e = historyEntry(r);
      return {
        name: e.name,
        categories: e.categories,
        decidedAt: e.decidedAt,
        newPlace: e.newPlace,
      };
    }),
  };
}
