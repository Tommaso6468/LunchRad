/**
 * The admin API under /admin/api and the public preset list. Inputs are
 * checked for shape here; the exact text rules (characters, Maps hosts) run
 * on the server with the same normalizers the rooms use.
 */
import * as z from 'zod/mini';
import { MAPS_URL_MAX, MAX_CATEGORIES } from './restaurants';

const id = z.string().check(z.regex(/^[a-f0-9]{16}$/));
const shortText = z.string().check(z.minLength(1), z.maxLength(100));

/** Presets and the restaurants in them are capped like a wheel. */
export const PRESET_MAX_RESTAURANTS = 30;
/** Restaurants in the shared catalogue. */
export const CATALOGUE_MAX_RESTAURANTS = 300;
export const PRESETS_MAX = 30;
export const AUDIT_PAGE_SIZE = 50;

export const ADMIN_ERRORS = [
  'unauthorized',
  'forbidden',
  'not_configured',
  'bad_request',
  'not_found',
  'invalid_restaurant',
  'invalid_category',
  'invalid_maps_url',
  'restaurant_exists',
  'catalogue_full',
  'invalid_preset_name',
  'preset_exists',
  'too_many_presets',
  'too_many_restaurants',
  'default_preset',
  'weak_team_key',
  'server_error',
] as const;
export type AdminError = (typeof ADMIN_ERRORS)[number];

// ---------- Requests ----------

export const restaurantInput = z.strictObject({
  name: shortText,
  categories: z.optional(
    z.union([
      z.array(z.string().check(z.maxLength(100))).check(z.maxLength(MAX_CATEGORIES * 2)),
      z.string().check(z.maxLength(200)),
    ]),
  ),
  mapsUrl: z.optional(z.nullable(z.string().check(z.maxLength(MAPS_URL_MAX * 2)))),
});
export type RestaurantInput = z.infer<typeof restaurantInput>;

export const presetInput = z.strictObject({ name: shortText });

export const presetRestaurantsInput = z.strictObject({
  restaurantIds: z.array(id).check(z.maxLength(PRESET_MAX_RESTAURANTS)),
});

// ---------- Responses ----------

export const adminRestaurant = z.strictObject({
  id,
  name: z.string(),
  categories: z.array(z.string()),
  mapsUrl: z.nullable(z.string()),
  presetIds: z.array(id),
  updatedAt: z.number(),
});
export type AdminRestaurant = z.infer<typeof adminRestaurant>;

export const adminPreset = z.strictObject({
  id,
  name: z.string(),
  isDefault: z.boolean(),
  restaurantIds: z.array(id),
  updatedAt: z.number(),
});
export type AdminPreset = z.infer<typeof adminPreset>;

export const adminRoom = z.strictObject({
  code: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  phase: z.enum(['lobby', 'spinning', 'voting', 'result']),
  participants: z.number(),
  connected: z.number(),
});
export type AdminRoom = z.infer<typeof adminRoom>;

export const auditEntry = z.strictObject({
  id: z.number(),
  at: z.number(),
  adminEmail: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.nullable(z.string()),
  detail: z.record(z.string(), z.unknown()),
});
export type AuditEntry = z.infer<typeof auditEntry>;

export const adminOverview = z.strictObject({
  email: z.string(),
  restaurants: z.array(adminRestaurant),
  presets: z.array(adminPreset),
});
export type AdminOverview = z.infer<typeof adminOverview>;

export const adminRooms = z.strictObject({ rooms: z.array(adminRoom) });
export const auditPage = z.strictObject({
  entries: z.array(auditEntry),
  nextBefore: z.nullable(z.number()),
});
export type AuditPage = z.infer<typeof auditPage>;

/** Rules for a team key an admin types in (the generated ones are always stronger). */
export const TEAM_KEY_MIN = 12;
export const TEAM_KEY_MAX = 64;

/** Team keys are compared without case and with spaces collapsed: phones like to capitalise. */
export function normalizeTeamKey(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** The normalized key when it is acceptable, otherwise null. */
export function acceptableTeamKey(input: string): string | null {
  const key = normalizeTeamKey(input);
  const length = [...key].length;
  if (length < TEAM_KEY_MIN || length > TEAM_KEY_MAX) return null;
  // No control characters; no "aaaaaaaaaaaa" or "123123123123".
  if ([...key].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return null;
  if (new Set(key).size < 6) return null;
  if (/^[0-9 ]+$/.test(key)) return null;
  return key;
}

export const teamKeyInput = z.strictObject({
  teamKey: z.string().check(z.maxLength(200)),
});

export const teamKeyRotated = z.strictObject({ teamKey: z.string(), rotatedAt: z.number() });
export const teamKeyStatus = z.strictObject({
  source: z.enum(['secret', 'admin']),
  rotatedAt: z.nullable(z.number()),
  rotatedBy: z.nullable(z.string()),
});
export type TeamKeyStatus = z.infer<typeof teamKeyStatus>;

// ---------- Public (team session) ----------

export const presetSummary = z.strictObject({
  id,
  name: z.string(),
  isDefault: z.boolean(),
  count: z.number(),
});
export type PresetSummary = z.infer<typeof presetSummary>;
export const presetList = z.strictObject({ presets: z.array(presetSummary) });
