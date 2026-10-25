// 迁移系统测试：应用、幂等、状态、CRUD。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, migrationStatus, createSave, getSave, updateSave, listSaves, recordEnding, listEndings,
  createUser, getUserByName, setUserCredentials, createSession, getSessionUser, deleteSession, listEndingsByGame,
  recordCards, listCards } from '../server/db.mjs';

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
    assert.equal(r.appliedCount, 3);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('saves','endings_seen','users','sessions','cards_seen','schema_migrations') ORDER BY name").all();
    assert.deepEqual(tables.map(t => t.name), ['cards_seen', 'endings_seen', 'saves', 'schema_migrations', 'sessions', 'users']);
    // 002 给存量表加的归属列必须就位
    const cols = db.prepare("SELECT name FROM pragma_table_info('saves') WHERE name = 'user_id'").all();
    assert.equal(cols.length, 1);
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
    assert.equal(listSaves(db, 'g00-demo', null).length, 1, '显式传 null 可列出匿名遗留存档');
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

describe('用户与会话 CRUD', () => {
  let dir, db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nu-user-'));
    db = openDb(':memory:');
    migrate(db, MIG);
  });
  afterEach(() => { db?.close(); rmSync(dir, { recursive: true, force: true }); });

  it('游客（无密码）可建可升级，用户名唯一', () => {
    const id = createUser(db, '游客ab12cd', null);
    assert.equal(getUserByName(db, '游客ab12cd').id, id);
    setUserCredentials(db, id, '沈默', 'scrypt$aa$bb');
    const upgraded = getUserByName(db, '沈默');
    assert.equal(upgraded.id, id, '升级保 id：存档归属不动');
    assert.equal(getUserByName(db, '游客ab12cd'), null);
  });

  it('会话按 token 取用户，过期即失效，删除即登出', () => {
    const id = createUser(db, '会话用户', 'scrypt$aa$bb');
    createSession(db, id, 'tok-expired', -1);   // ttl 负数 = 已过期
    createSession(db, id, 'tok-live', 3600);
    assert.equal(getSessionUser(db, 'tok-expired'), null, '过期会话不得换出用户');
    assert.equal(getSessionUser(db, 'tok-live').id, id);
    deleteSession(db, 'tok-live');
    assert.equal(getSessionUser(db, 'tok-live'), null);
  });

  it('存档归属：列表与结局聚合都按用户过滤', () => {
    const u1 = createUser(db, '玩家一', null);
    const u2 = createUser(db, '玩家二', null);
    const run = { nodeId: 'n1', flags: {}, affinity: {}, choiceLog: [], seed: 1, ended: 'END_WAIT' };
    const a = createSave(db, 'g00-demo', null, run, u1);
    createSave(db, 'g00-demo', null, run, u2);
    recordEnding(db, a, 'END_WAIT');
    assert.equal(listSaves(db, 'g00-demo', u1).length, 1);
    assert.equal(listSaves(db, 'g00-demo', u2).length, 1);
    assert.equal(listEndingsByGame(db, 'g00-demo', u1).length, 1);
    assert.equal(listEndingsByGame(db, 'g00-demo', u2).length, 0, '结局收集不得跨用户串档');
    // 遗留匿名存档（002 之前的数据）：不属于任何用户，不可见
    const legacy = createSave(db, 'g00-demo', '无名', run);
    assert.equal(getSave(db, legacy).user_id, null);
    assert.equal(listSaves(db, 'g00-demo', u1).length, 1, '遗留存档不得混入用户列表');
  });

  it('图鉴入档：card.* flag 幂等落库，按用户隔离', () => {
    const u1 = createUser(db, '玩家甲', null);
    const u2 = createUser(db, '玩家乙', null);
    const flags = { 'card.letter': true, 'card.char.momo': true, 'fact.ev-letter': true, 'card.momo.faces': true };
    recordCards(db, u1, 'g00-demo', flags);
    recordCards(db, u1, 'g00-demo', flags); // 幂等
    assert.deepEqual(listCards(db, u1, 'g00-demo').sort(),
      ['char.momo', 'letter', 'momo.faces'], '只收 card.* 前缀且剥前缀存键');
    assert.deepEqual(listCards(db, u2, 'g00-demo'), [], '图鉴不得跨用户串档');
  });
});
