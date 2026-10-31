// 同步信箱：只存文档与版本向量，不执行剧情。所有写库操作在一次 SQLite 事务内完成。
import { compareVV, mergeVV, samePayload, publicDoc } from '../engine/save.mjs';

const parse = row => row ? ({ ...JSON.parse(row.body_json), vv: JSON.parse(row.vv_json), deleted: row.deleted ? 1 : 0, seq: row.seq }) : null;
const head = (db, userId) => db.prepare('SELECT seq FROM sync_heads WHERE user_id = ?').get(userId)?.seq ?? 0;
const get = (db, userId, id) => parse(db.prepare('SELECT * FROM sync_docs WHERE user_id = ? AND doc_id = ?').get(userId, id));

function nextSeq(db, userId) {
  db.prepare(`INSERT INTO sync_heads(user_id, seq) VALUES (?, 1)
    ON CONFLICT(user_id) DO UPDATE SET seq = seq + 1`).run(userId);
  return head(db, userId);
}
function writeDoc(db, userId, doc, seq) {
  const clean = publicDoc(doc);
  db.prepare(`INSERT INTO sync_docs(user_id, doc_id, game_id, seq, vv_json, body_json, deleted, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, doc_id) DO UPDATE SET game_id=excluded.game_id, seq=excluded.seq,
      vv_json=excluded.vv_json, body_json=excluded.body_json, deleted=excluded.deleted, updated_at=excluded.updated_at`)
    .run(userId, doc.id, doc.gameId, seq, JSON.stringify(doc.vv ?? {}), JSON.stringify(clean), doc.deleted ? 1 : 0);
}

function collectionsFor(db, userId, gameIds) {
  const out = {};
  for (const gameId of gameIds) {
    out[gameId] = { endings: [], cards: [] };
    for (const row of db.prepare('SELECT kind, key FROM collections WHERE user_id = ? AND game_id = ?').all(userId, gameId)) {
      if (row.kind === 'ending') out[gameId].endings.push(row.key);
      if (row.kind === 'card') out[gameId].cards.push(row.key);
    }
  }
  return out;
}

export function syncFor(db, userId, request) {
  const cursor = Number.isInteger(request.cursor) && request.cursor >= 0 ? request.cursor : 0;
  const push = Array.isArray(request.push) ? request.push : [];
  const collect = request.collect && typeof request.collect === 'object' ? request.collect : {};
  const results = [];
  db.exec('BEGIN');
  try {
    for (const doc of push) {
      const existing = get(db, userId, doc.id);
      if (!existing) {
        const seq = nextSeq(db, userId); writeDoc(db, userId, doc, seq);
        results.push({ id: doc.id, status: 'accepted' }); continue;
      }
      const relation = compareVV(doc.vv, existing.vv);
      if (relation === 0) { results.push({ id: doc.id, status: 'accepted' }); continue; }
      if (relation === 1) {
        const seq = nextSeq(db, userId); writeDoc(db, userId, doc, seq);
        results.push({ id: doc.id, status: 'accepted' }); continue;
      }
      if (relation === -1) { results.push({ id: doc.id, status: 'stale', doc: existing }); continue; }
      // 并发且内容相同只是不同设备各自迁移过：向量取大，不能制造假冲突。
      if (samePayload(doc, existing)) {
        const merged = { ...doc, vv: mergeVV(doc.vv, existing.vv) };
        const seq = nextSeq(db, userId); writeDoc(db, userId, merged, seq);
        results.push({ id: doc.id, status: 'accepted', doc: merged }); continue;
      }
      // 墓碑与活档并发时活档胜，避免误删另一台设备的新进度。
      if (doc.deleted !== existing.deleted) {
        const winner = doc.deleted ? existing : doc;
        const merged = { ...winner, vv: mergeVV(doc.vv, existing.vv) };
        const seq = nextSeq(db, userId); writeDoc(db, userId, merged, seq);
        results.push({ id: doc.id, status: 'accepted', doc: merged }); continue;
      }
      results.push({ id: doc.id, status: 'conflict', doc: existing });
    }
    for (const [gameId, patch] of Object.entries(collect)) {
      for (const [kind, keys] of [['ending', patch?.endings ?? []], ['card', patch?.cards ?? []]]) {
        const stmt = db.prepare('INSERT OR IGNORE INTO collections(user_id, game_id, kind, key) VALUES (?, ?, ?, ?)');
        for (const key of keys) stmt.run(userId, gameId, kind, key);
      }
    }
    const rows = db.prepare('SELECT * FROM sync_docs WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT 201').all(userId, cursor);
    const more = rows.length > 200;
    const page = rows.slice(0, 200);
    const lastSeq = page.at(-1)?.seq ?? cursor;
    const responseCursor = more ? lastSeq : head(db, userId);
    const gameIds = new Set([...Object.keys(collect), ...push.map(d => d.gameId), ...page.map(d => d.game_id)]);
    const response = {
      cursor: responseCursor, more, results,
      pull: page.map(parse),
      collect: collectionsFor(db, userId, gameIds),
    };
    db.exec('COMMIT');
    return response;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function validDoc(doc) {
  return doc && typeof doc === 'object' && typeof doc.id === 'string' && doc.id.length > 0 && doc.id.length <= 100
    && typeof doc.gameId === 'string' && doc.gameId.length <= 100
    && doc.run && typeof doc.run === 'object' && typeof doc.vv === 'object'
    && JSON.stringify(doc).length <= 65536;
}
