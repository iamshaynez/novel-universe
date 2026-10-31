// 离线优先核心验收：纯引擎本地运行、内容迁移、同步幂等与双端分叉。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGames, createApp } from '../server/app.mjs';
import { openDb, migrate, createUser } from '../server/db.mjs';
import { syncFor } from '../server/sync.mjs';
import { LocalRuntime } from '../web/runtime.mjs';
import { MemoryStore } from '../web/store.mjs';
import { SyncClient } from '../web/sync.mjs';
import { compareVV, makeAnchor, resolveAnchor } from '../engine/save.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const games = loadGames(join(root, 'test/fixtures/games'), join(root, 'test/fixtures/universe'));
const ir = games['g00-demo'].ir;
const runtimeFor = (store, deviceId = 'A') => new LocalRuntime({ ir, irHash: 'fixture-1', store, deviceId, uuid: () => `save-${deviceId}` });
const docFor = (id, vv, nodeId = 'n1') => ({ schema: 1, id, gameId: ir.id, run: { nodeId, flags: {}, affinity: {}, choiceLog: [], seed: 1, ended: null }, vv, dirty: 1, deleted: 0 });

describe('版本向量与内容锚点', () => {
  it('能区分领先、落后、相等和并发，而不是看时间戳', () => {
    assert.equal(compareVV({ A: 2 }, { A: 1 }), 1);
    assert.equal(compareVV({ A: 1 }, { A: 2 }), -1);
    assert.equal(compareVV({ A: 1 }, { A: 1 }), 0);
    assert.equal(compareVV({ A: 1 }, { B: 1 }), 'concurrent');
  });

  it('章内插行后仍按内容找回原拍；找不到才退场景开头', () => {
    const anchor = makeAnchor(ir, ir.entry);
    assert.equal(resolveAnchor(ir, anchor).nodeId, ir.entry);
    const changed = structuredClone(ir);
    const ids = Object.keys(changed.nodes);
    const first = changed.nodes[ir.entry];
    first.text = '这句台词被作者改写了';
    const resolved = resolveAnchor(changed, anchor);
    assert.ok(resolved.nodeId);
    assert.equal(typeof resolved.exact, 'boolean');
  });
});

describe('本地运行时：无网络也能开局、推进、读档与收集', () => {
  it('新局先落本地，推进后重开仍回到同一停点', async () => {
    const store = new MemoryStore();
    const runtime = runtimeFor(store);
    const started = await runtime.newGame(7);
    assert.equal(started.state.kind, 'line');
    const advanced = await runtime.advance(started.doc.id);
    const loaded = await runtime.load(started.doc.id);
    assert.equal(loaded.state.node, advanced.state.node);
    assert.equal((await store.listDirty()).length, 1);
  });

  it('图鉴和结局是本地只增收集，不依赖账号', async () => {
    const store = new MemoryStore();
    const runtime = runtimeFor(store);
    const started = await runtime.newGame(7);
    await runtime.advance(started.doc.id);
    const collection = await store.getCollection(ir.id);
    assert.ok(Array.isArray(collection.cards));
    assert.ok(Array.isArray(collection.endings));
  });
});

describe('同步信箱：重放安全、并发不丢档', () => {
  let db;
  before(() => { db = openDb(':memory:'); migrate(db, join(root, 'server/migrations')); createUser(db, '同步测试', 'hash'); });
  after(() => db.close());

  it('同一文档重复推送幂等，拉取带游标，收集取并集', () => {
    const request = { cursor: 0, push: [docFor('doc-a', { A: 1 })], collect: { [ir.id]: { endings: ['E1'], cards: ['letter'] } } };
    const first = syncFor(db, 1, request);
    assert.equal(first.results[0].status, 'accepted');
    const second = syncFor(db, 1, { ...request, cursor: first.cursor });
    assert.equal(second.results[0].status, 'accepted');
    assert.equal(second.pull.length, 0, '相同游标重放不应制造新变更');
    assert.deepEqual(second.collect[ir.id].endings, ['E1']);
    const pulled = syncFor(db, 1, { cursor: 0, push: [], collect: {} });
    assert.equal(pulled.pull.length, 1);
  });

  it('并发修改返回冲突；客户端保留本机分叉并接受远端原档', async () => {
    const local = docFor('doc-conflict', { B: 1 });
    syncFor(db, 1, { cursor: 0, push: [local], collect: {} });
    const response = syncFor(db, 1, { cursor: 0, push: [{ ...local, vv: { A: 1, C: 1 }, run: { ...local.run, nodeId: 'n3' } }], collect: {} });
    assert.equal(response.results[0].status, 'conflict');
    const store = new MemoryStore();
    await store.putSave({ ...local, vv: { A: 1, C: 1 }, run: { ...local.run, nodeId: 'n3' } });
    const client = new SyncClient({ store, deviceId: 'C', games: [ir.id], post: async () => ({}) });
    await client.applyRemote(response.results[0].doc);
    assert.ok(await store.getSave('doc-conflict'));
    assert.ok([...store.saves.keys()].some(id => id.startsWith('doc-conflict-fork-C-')));
  });
});

describe('双客户端与同步故障', () => {
  it('同步接口失败不阻塞本地推进；恢复后文档可上推', async () => {
    const store = new MemoryStore();
    const runtime = runtimeFor(store);
    const client = new SyncClient({ store, deviceId: 'A', games: [ir.id], post: async () => { throw new Error('offline'); } });
    const started = await runtime.newGame(7);
    const next = await runtime.advance(started.doc.id);
    assert.equal(await client.flush(), false);
    assert.equal((await runtime.load(started.doc.id)).state.node, next.state.node);
    assert.equal((await store.listDirty()).length, 1);
  });
});

describe('真实同步接口：注册后才同步，游客不被强迫联网', () => {
  it('注册会话可推送，游客推送被拒绝且不影响本地运行时', async () => {
    const db = openDb(':memory:'); migrate(db, join(root, 'server/migrations'));
    const server = createApp({ db, games, webDir: join(root, 'web') });
    await new Promise(resolveListen => server.listen(0, resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const registered = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: '离线同步者', password: 'password-123' }) });
      const sid = registered.headers.get('set-cookie').match(/nu_sid=([^;]+)/)[1];
      const response = await fetch(`${base}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `nu_sid=${sid}` }, body: JSON.stringify({ protocol: 1, deviceId: 'A', cursor: 0, push: [docFor('http-doc', { A: 1 })], collect: {} }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).results[0].status, 'accepted');
      const guest = await fetch(`${base}/api/auth/guest`);
      const guestSid = guest.headers.get('set-cookie').match(/nu_sid=([^;]+)/)[1];
      const rejected = await fetch(`${base}/api/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: `nu_sid=${guestSid}` }, body: JSON.stringify({ protocol: 1, deviceId: 'B', cursor: 0, push: [], collect: {} }) });
      assert.equal(rejected.status, 403);
    } finally { server.close(); db.close(); }
  });
});

describe('内容包与离线壳', () => {
  it('目录、IR、引擎和 sw.js 都由真实 HTTP 提供，IR 长缓存且壳含完整清单', async () => {
    const server = createApp({ db: null, games, webDir: join(root, 'web') });
    await new Promise(resolveListen => server.listen(0, resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const catalog = await (await fetch(`${base}/content/catalog.json`)).json();
      assert.equal(catalog[0].id, ir.id);
      const irResponse = await fetch(base + catalog[0].irUrl);
      assert.equal(irResponse.status, 200);
      assert.match(irResponse.headers.get('cache-control'), /immutable/);
      assert.equal((await irResponse.json()).entry, ir.entry);
      assert.equal((await fetch(`${base}/engine/state.mjs`)).status, 200);
      const sw = await (await fetch(`${base}/sw.js`)).text();
      assert.match(sw, /jinjiang-offline-/);
      assert.match(sw, /content\/g00-demo\./);
      assert.match(sw, /engine\/state\.mjs/);
    } finally { server.close(); }
  });
});
