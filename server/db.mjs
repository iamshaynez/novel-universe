// 数据库：连接、迁移器、存档 CRUD。node:sqlite 原生，零依赖。
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

/** 按编号升序应用迁移；事务内执行；幂等（已应用跳过）。 */
export function migrate(db, migrationsDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const files = readdirSync(migrationsDir)
    .filter(f => /^\d{3}-.*\.sql$/.test(f))
    .sort();
  const seen = new Set();
  let count = 0;
  for (const f of files) {
    const version = parseInt(f.slice(0, 3), 10);
    if (seen.has(version)) throw new Error(`迁移编号重复: ${f}`);
    seen.add(version);
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(version, name) VALUES (?, ?)').run(version, f);
      db.exec('COMMIT');
      count++;
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`迁移失败 ${f}: ${e.message}`);
    }
  }
  return { appliedCount: count, total: files.length };
}

export function migrationStatus(db, migrationsDir) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  return readdirSync(migrationsDir)
    .filter(f => /^\d{3}-.*\.sql$/.test(f))
    .sort()
    .map(f => ({ file: f, applied: applied.has(parseInt(f.slice(0, 3), 10)) }));
}

// ---- 存档 CRUD ----
export function createSave(db, gameId, player, run) {
  const r = db.prepare('INSERT INTO saves(game_id, player, node_id, run_json) VALUES (?, ?, ?, ?)')
    .run(gameId, player ?? '无名', run.nodeId, JSON.stringify(run));
  return Number(r.lastInsertRowid);
}
export function getSave(db, id) {
  return db.prepare('SELECT * FROM saves WHERE id = ?').get(id) ?? null;
}
export function listSaves(db, gameId) {
  return db.prepare('SELECT id, game_id, player, node_id, ended, created_at, updated_at FROM saves WHERE game_id = ? ORDER BY id DESC LIMIT 50').all(gameId);
}
export function updateSave(db, id, run) {
  db.prepare('UPDATE saves SET node_id = ?, run_json = ?, ended = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(run.nodeId, JSON.stringify(run), run.ended ?? null, id);
}
export function recordEnding(db, saveId, endingId) {
  db.prepare('INSERT OR IGNORE INTO endings_seen(save_id, ending_id) VALUES (?, ?)').run(saveId, endingId);
}
export function listEndings(db, saveId) {
  return db.prepare('SELECT ending_id, seen_at FROM endings_seen WHERE save_id = ? ORDER BY seen_at').all(saveId);
}
/** 结局收集是游戏级：跨存档聚合（同一玩家的「再来一局」不清零收集）。 */
export function listEndingsByGame(db, gameId) {
  return db.prepare(`SELECT es.ending_id AS ending_id, MIN(es.seen_at) AS seen_at
    FROM endings_seen es JOIN saves s ON s.id = es.save_id
    WHERE s.game_id = ? GROUP BY es.ending_id ORDER BY seen_at`).all(gameId);
}
