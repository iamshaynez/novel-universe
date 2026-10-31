-- 004-sync：本地优先后的服务端同步信箱与只增收集。
-- 兼容期保留 saves/cards_seen/endings_seen；本迁移把有账号归属的存量转换为同步文档，可重放。
CREATE TABLE IF NOT EXISTS sync_docs (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doc_id     TEXT    NOT NULL,
  game_id    TEXT    NOT NULL,
  seq        INTEGER NOT NULL,
  vv_json    TEXT    NOT NULL,
  body_json  TEXT    NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, doc_id)
);
CREATE INDEX IF NOT EXISTS idx_sync_docs_seq ON sync_docs(user_id, seq);

CREATE TABLE IF NOT EXISTS sync_heads (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  seq     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collections (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL CHECK (kind IN ('ending', 'card')),
  key        TEXT    NOT NULL,
  first_seen TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, game_id, kind, key)
);

INSERT OR IGNORE INTO sync_docs(user_id, doc_id, game_id, seq, vv_json, body_json, deleted, updated_at)
SELECT user_id, 'legacy-' || id, game_id, id, '{"legacy":1}',
  json_object(
    'schema', 1,
    'id', 'legacy-' || id,
    'gameId', game_id,
    'irHash', NULL,
    'run', json(run_json),
    'anchor', NULL,
    'vv', json('{"legacy":1}'),
    'summary', json_object('chapter', NULL, 'chapterTitle', NULL, 'ended', ended),
    'createdAt', created_at,
    'updatedAt', updated_at,
    'deleted', 0,
    'forkOf', NULL
  ), 0, updated_at
FROM saves WHERE user_id IS NOT NULL;

INSERT OR IGNORE INTO sync_heads(user_id, seq)
SELECT user_id, MAX(id) FROM saves WHERE user_id IS NOT NULL GROUP BY user_id;

INSERT OR IGNORE INTO collections(user_id, game_id, kind, key, first_seen)
SELECT user_id, game_id, 'card', key, seen_at FROM cards_seen;

INSERT OR IGNORE INTO collections(user_id, game_id, kind, key, first_seen)
SELECT s.user_id, s.game_id, 'ending', es.ending_id, es.seen_at
FROM endings_seen es JOIN saves s ON s.id = es.save_id
WHERE s.user_id IS NOT NULL;
