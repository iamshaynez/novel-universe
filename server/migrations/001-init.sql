-- 001-init：存档与已见结局
CREATE TABLE IF NOT EXISTS saves (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id    TEXT    NOT NULL,
  player     TEXT    NOT NULL DEFAULT '无名',
  node_id    TEXT,
  run_json   TEXT    NOT NULL,
  ended      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_saves_game ON saves(game_id);

CREATE TABLE IF NOT EXISTS endings_seen (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  save_id   INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
  ending_id TEXT    NOT NULL,
  seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(save_id, ending_id)
);
