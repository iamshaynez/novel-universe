-- 003-图鉴入档：时代词条与人物档案的玩家级收集（用户 × 游戏 × 键）。
-- 键约定：flag 剥去 card. 前缀（char.<cid> / <词条id> / <自定义解锁键>）。
CREATE TABLE IF NOT EXISTS cards_seen (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT    NOT NULL,
  key     TEXT    NOT NULL,
  seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, game_id, key)
);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards_seen(user_id, game_id);
