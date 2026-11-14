-- M7: where the team ended up. One row per room that reached a final result.
-- Only the restaurant and the time; never who was in the room.
CREATE TABLE lunch_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Random per room (not the room code, which can be reused): makes the
  -- write idempotent if the room's alarm runs twice.
  room_ref    TEXT NOT NULL UNIQUE CHECK (length(room_ref) = 16),
  decided_at  INTEGER NOT NULL,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  name_key    TEXT NOT NULL,
  categories  TEXT NOT NULL DEFAULT '[]',
  respins     INTEGER NOT NULL DEFAULT 0,
  new_place   INTEGER NOT NULL DEFAULT 0 CHECK (new_place IN (0, 1))
);
CREATE INDEX lunch_history_by_name ON lunch_history (name_key);
CREATE INDEX lunch_history_by_time ON lunch_history (decided_at);
