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

// ---- 用户与会话 CRUD ----
export function createUser(db, username, passwordHash) {
  const r = db.prepare('INSERT INTO users(username, password_hash) VALUES (?, ?)')
    .run(username, passwordHash ?? null);
  return Number(r.lastInsertRowid);
}
export function getUserByName(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) ?? null;
}
/** 游客升级/改名：保 user id，存档归属不动。 */
export function setUserCredentials(db, id, username, passwordHash) {
  db.prepare('UPDATE users SET username = ?, password_hash = ? WHERE id = ?')
    .run(username, passwordHash, id);
}
/** 过期判定与续期都交给 SQLite 的 datetime('now')：与写入同一时钟，避免时区/格式错位。
 *  ttlSeconds 为负表示直接造过期会话（测试用）。 */
const ttlModifier = ttlSeconds => (ttlSeconds < 0 ? `${ttlSeconds}` : `+${ttlSeconds}`) + ' seconds';
export function createSession(db, userId, token, ttlSeconds) {
  db.prepare(`INSERT INTO sessions(token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .run(token, userId, ttlModifier(ttlSeconds));
}
export function refreshSession(db, token, ttlSeconds) {
  db.prepare(`UPDATE sessions SET expires_at = datetime('now', ?) WHERE token = ?`)
    .run(ttlModifier(ttlSeconds), token);
}
export function getSessionUser(db, token) {
  return db.prepare(`SELECT u.id AS id, u.username AS username, u.password_hash AS password_hash
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > datetime('now')`).get(token) ?? null;
}
export function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}
export function purgeExpiredSessions(db) {
  db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
}

// ---- 存档 CRUD ----
export function createSave(db, gameId, player, run, userId = null) {
  const r = db.prepare('INSERT INTO saves(game_id, player, node_id, run_json, user_id) VALUES (?, ?, ?, ?, ?)')
    .run(gameId, player ?? '无名', run.nodeId, JSON.stringify(run), userId);
  return Number(r.lastInsertRowid);
}
export function getSave(db, id) {
  return db.prepare('SELECT * FROM saves WHERE id = ?').get(id) ?? null;
}
export function listSaves(db, gameId, userId) {
  return db.prepare(`SELECT id, game_id, player, node_id, ended, created_at, updated_at
    FROM saves WHERE game_id = ? AND user_id IS ? ORDER BY id DESC LIMIT 50`).all(gameId, userId);
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
/** 结局收集是玩家级：同一用户跨存档聚合（「再来一局」不清零收集），但不与其他用户串档。 */
export function listEndingsByGame(db, gameId, userId) {
  return db.prepare(`SELECT es.ending_id AS ending_id, MIN(es.seen_at) AS seen_at
    FROM endings_seen es JOIN saves s ON s.id = es.save_id
    WHERE s.game_id = ? AND s.user_id IS ? GROUP BY es.ending_id ORDER BY seen_at`).all(gameId, userId);
}
