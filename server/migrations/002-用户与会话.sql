-- 002-用户与会话：多用户身份与存档归属。
-- 游客优先：password_hash 为 NULL 即游客（不可凭名登录），注册=补录凭据、保 user id。
-- 存量 saves 的 user_id 留 NULL（匿名遗留数据，不属于任何用户，不出现在用户列表）。
-- 幂等性：本文件由迁移器按版本表只执行一次；ALTER 无 IF NOT EXISTS 形态，靠版本表保证不重放。
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

ALTER TABLE saves ADD COLUMN user_id INTEGER REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_saves_user ON saves(user_id, game_id);
