-- M5: presets, restaurants, the admin audit log, the open-room registry and
-- the team key set from the admin panel. D1 enforces foreign keys.

CREATE TABLE restaurant (
  id          TEXT PRIMARY KEY CHECK (length(id) = 16),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  -- Lower-cased, whitespace-collapsed name: no two restaurants may look alike.
  name_key    TEXT NOT NULL UNIQUE,
  -- JSON array of up to 3 food types.
  categories  TEXT NOT NULL DEFAULT '[]',
  maps_url    TEXT CHECK (maps_url IS NULL OR length(maps_url) <= 500),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE preset (
  id          TEXT PRIMARY KEY CHECK (length(id) = 16),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key    TEXT NOT NULL UNIQUE,
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
-- At most one default preset.
CREATE UNIQUE INDEX preset_one_default ON preset (is_default) WHERE is_default = 1;

CREATE TABLE preset_restaurant (
  preset_id      TEXT NOT NULL REFERENCES preset (id) ON DELETE CASCADE,
  restaurant_id  TEXT NOT NULL REFERENCES restaurant (id) ON DELETE CASCADE,
  position       INTEGER NOT NULL,
  PRIMARY KEY (preset_id, restaurant_id)
);
CREATE INDEX preset_restaurant_by_restaurant ON preset_restaurant (restaurant_id);

CREATE TABLE admin_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  admin_email  TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  -- JSON: what changed. Never secrets (the team key itself is never logged).
  detail       TEXT NOT NULL DEFAULT '{}'
);

-- Rooms that are open now, so the admin can see and close them. Durable
-- Objects cannot be listed; rows are removed when a room closes and ignored
-- once expired.
CREATE TABLE open_room (
  code        TEXT PRIMARY KEY CHECK (length(code) = 6),
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- The team key set from the admin panel. Only an HMAC of the key is stored.
-- Without a row, the TEAM_KEY secret is used.
CREATE TABLE team_key (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  check_hash  TEXT NOT NULL,
  rotated_at  INTEGER NOT NULL,
  rotated_by  TEXT NOT NULL
);
