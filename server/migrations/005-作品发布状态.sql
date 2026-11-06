-- 005-作品发布状态：运行时开关与剧本内容分离；没有记录的新作品默认未发布。
CREATE TABLE IF NOT EXISTS game_publications (
  game_id   TEXT PRIMARY KEY,
  published INTEGER NOT NULL CHECK (published IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 升级时保护既有公开作品；后续新游戏不自动回填，默认保持草稿态。
INSERT OR IGNORE INTO game_publications(game_id, published) VALUES ('g01-jiexianyuan', 1);
