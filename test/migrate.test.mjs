// 迁移系统测试：应用、幂等、状态、CRUD。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, migrationStatus, createSave, getSave, updateSave, listSaves, recordEnding, listEndings } from '../server/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIG = join(root, 'server/migrations');

describe('迁移', () => {
  let dir, dbPath, db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nu-mig-'));
    dbPath = join(dir, 't.db');
  });
  afterEach(() => { db?.close(); rmSync(dir, { recursive: true, force: true }); });

  it('全新库：应用全部迁移并建表', () => {
    db = openDb(dbPath);
    const r = migrate(db, MIG);
    assert.equal(r.appliedCount, 1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('saves','endings_seen','schema_migrations') ORDER BY name").all();
    assert.deepEqual(tables.map(t => t.name), ['endings_seen', 'saves', 'schema_migrations']);
  });

  it('重复应用幂等：第二次 appliedCount=0', () => {
    db = openDb(dbPath);
    migrate(db, MIG);
    const r2 = migrate(db, MIG);
    assert.equal(r2.appliedCount, 0);
  });

  it('坏迁移在事务中回滚，不留半套结构', () => {
    const badDir = join(dir, 'mig');
    mkdirSync(badDir);
    writeFileSync(join(badDir, '001-ok.sql'), 'CREATE TABLE a(x);');
    writeFileSync(join(badDir, '002-bad.sql'), 'CREATE TABLE b(y); INSERT INTO nope VALUES (1);');
    db = openDb(join(dir, 'bad.db'));
    assert.throws(() => migrate(db, badDir), /迁移失败 002-bad/);
    const has = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='b'").get();
    assert.equal(has.c, 0, '失败迁移的表应被回滚');
  });

  it('status 能区分 applied/pending', () => {
    db = openDb(dbPath);
    const before = migrationStatus(db, MIG);
    assert.ok(before.every(r => !r.applied));
    migrate(db, MIG);
    const after = migrationStatus(db, MIG);
    assert.ok(after.every(r => r.applied));
  });
});

describe('存档 CRUD', () => {
  let dir, db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nu-crud-'));
    db = openDb(':memory:');
    migrate(db, MIG);
  });
  afterEach(() => { db?.close(); rmSync(dir, { recursive: true, force: true }); });

  it('建档/读取/更新/列表全链路', () => {
    const run = { nodeId: 'n1', flags: {}, affinity: {}, choiceLog: [], seed: 1, ended: null };
    const id = createSave(db, 'g00-demo', '测试者', run);
    assert.ok(Number.isInteger(id));
    const row = getSave(db, id);
    assert.equal(row.game_id, 'g00-demo');
    assert.equal(row.player, '测试者');
    assert.deepEqual(JSON.parse(row.run_json).choiceLog, []);

    const run2 = { ...run, nodeId: 'n9', choiceLog: [0, 1] };
    updateSave(db, id, run2);
    assert.equal(getSave(db, id).node_id, 'n9');
    assert.equal(listSaves(db, 'g00-demo').length, 1);
  });

  it('结局记录去重，外键级联可用', () => {
    const run = { nodeId: 'n1', flags: {}, affinity: {}, choiceLog: [], seed: 1, ended: 'END_WAIT' };
    const id = createSave(db, 'g00-demo', null, run);
    recordEnding(db, id, 'END_WAIT');
    recordEnding(db, id, 'END_WAIT');
    assert.equal(listEndings(db, id).length, 1);
    db.prepare('DELETE FROM saves WHERE id = ?').run(id);
    assert.equal(listEndings(db, id).length, 0, '外键级联应清掉 endings_seen');
  });
});
