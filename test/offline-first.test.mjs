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
import { compareVV, makeAnchor, resolveAnchor, canProceed, settleRun } from '../engine/save.mjs';

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

// 手工小图：断链自愈场景专用（正式内容有 verify 门禁不允许坏链，测试要能故意造坏）
const healLine = (id, next, { scene = 's1', chapter = 'c1' } = {}) =>
  ({ id, type: 'line', text: `台词-${id}`, next, scene, chapter, enter: [] });
const healEnding = id => ({ id, type: 'ending', endingId: 'E1', title: '终', scene: 's1', chapter: 'c1' });
const healIr = (nodes, entry) => ({
  id: 'g-heal', entry, chapters: [{ id: 'c1', title: '第一章' }], scenes: {}, characters: {}, speakers: {},
  endings: [{ id: 'E1', title: '终' }], nodes,
  canon: { characters: [], locations: [], events: [], lexicon: [] },
});
const healRun = nodeId => ({ nodeId, flags: {}, affinity: {}, choiceLog: [], seed: 1, ended: null, trLog: {}, trMisses: {} });

describe('锚点对位 v1.1：结构优先，文案修订不再把玩家降级到场首', () => {
  it('同 ID 停点的台词被改写：仍在原位，只标记指纹不再精确', () => {
    const anchor = makeAnchor(ir, 'ch1-n2');
    const edited = structuredClone(ir);
    edited.nodes['ch1-n2'].text = '作者改写了这一句';
    const resolved = resolveAnchor(edited, anchor);
    assert.equal(resolved.nodeId, 'ch1-n2', 'ID 还在就必须原位——改一句台词不得失位');
    assert.equal(resolved.level, 'same-id');
    assert.equal(resolved.exact, false);
  });

  it('ID 被删但内容在场内平移过：按内容指纹找回原拍', () => {
    const anchor = makeAnchor(ir, 'ch1-n2');
    const moved = structuredClone(ir);
    delete moved.nodes['ch1-n2'];
    moved.nodes['ch1-n2b'] = { ...ir.nodes['ch1-n2'], id: 'ch1-n2b' };
    moved.nodes['ch1-n1'].next = 'ch1-n2b';
    const resolved = resolveAnchor(moved, anchor);
    assert.equal(resolved.nodeId, 'ch1-n2b');
    assert.equal(resolved.level, 'scene');
  });

  it('ID 与内容都认不出时才走降级阶梯：先退本场景开头', () => {
    const anchor = makeAnchor(ir, 'ch1-n7');
    const rewritten = structuredClone(ir);
    delete rewritten.nodes['ch1-n7']; // 节点整个被删且内容无处在场（场景标签还在）
    rewritten.nodes['ch1-n6'].next = 'ch1-n8';
    const resolved = resolveAnchor(rewritten, anchor);
    assert.equal(resolved.level, 'scene-start');
    assert.equal(resolved.nodeId, 'ch1-n6');
  });
});

describe('断链自愈：读档必须落在推得动的停点上', () => {
  it('canProceed：结局是合法终点，正常停点可推，断链与失踪节点判死', () => {
    const good = healIr({ a: healLine('a', 'b'), b: healLine('b', 'end'), end: healEnding('end') }, 'a');
    assert.equal(canProceed(good, healRun('a')), true);
    assert.equal(canProceed(good, healRun('end')), true, '结局不能再推进，但它是合法终点');
    const bad = healIr({ a: healLine('a', 'ghost'), end: healEnding('end') }, 'a');
    assert.equal(canProceed(bad, healRun('a')), false, 'next 指向被删节点必须判死');
    assert.equal(canProceed(bad, healRun('nope')), false, '节点不存在必须判死');
  });

  it('canProceed：选项停点每个可见选项都必须可落位；转写停点正确项必须可推进', () => {
    const choice = healIr({
      q: { id: 'q', type: 'choice', scene: 's1', chapter: 'c1', options: [{ label: '甲', goto: 'a' }, { label: '乙', goto: 'b' }] },
      a: healLine('a', 'end'), b: healLine('b', 'end'), end: healEnding('end'),
    }, 'q');
    assert.equal(canProceed(choice, healRun('q')), true);
    choice.nodes.q.options[1].goto = 'ghost';
    assert.equal(canProceed(choice, healRun('q')), false, '任一可选分支断链都不许把死局端给玩家');
    const tr = healIr({
      t: { id: 't', type: 'transcribe', transId: 't1', caller: '呼入者', target: '留言内容', next: 'end', scene: 's1', chapter: 'c1' },
      end: healEnding('end'),
    }, 't');
    assert.equal(canProceed(tr, healRun('t')), true);
    tr.nodes.t.next = 'ghost';
    assert.equal(canProceed(tr, healRun('t')), false, '转写完成后的推进链断了必须判死');
  });

  it('settleRun：原位断链退到本场景第一个健康停点', () => {
    const broken = healIr({
      s1a: healLine('s1a', 's2a'), s2a: healLine('s2a', 's2b', { scene: 's2' }), s2b: healLine('s2b', 'ghost', { scene: 's2' }),
    }, 's1a');
    const settled = settleRun(broken, healRun('s2b'), { scene: 's2' });
    assert.deepEqual(settled, { nodeId: 's2a', level: 'scene-start' });
  });

  it('settleRun：整场景断链退到本章开头；原位健康则原地不动', () => {
    const broken = healIr({
      s1a: healLine('s1a', 's1b'), s1b: healLine('s1b', 's2a'), s2a: healLine('s2a', 'ghost', { scene: 's2' }),
    }, 's1a');
    assert.deepEqual(settleRun(broken, healRun('s2a'), { scene: 's2' }), { nodeId: 's1a', level: 'chapter-start' });
    const healthy = healIr({ a: healLine('a', 'end'), end: healEnding('end') }, 'a');
    assert.deepEqual(settleRun(healthy, healRun('a'), { scene: 's1' }), { nodeId: 'a', level: null });
  });
});

describe('内容迁移 v1.1：降级有留底，对位是版本化写入', () => {
  it('文案修订后读档仍在原停点；迁移回写置脏，同步协议能看到这次对位', async () => {
    const store = new MemoryStore();
    const runtime = runtimeFor(store);
    const started = await runtime.newGame(7);
    const advanced = await runtime.advance(started.doc.id);
    const edited = structuredClone(ir);
    edited.nodes[advanced.state.node].text = '作者修订了一句台词';
    const next = new LocalRuntime({ ir: edited, irHash: 'fixture-2', store, deviceId: 'A' });
    const loaded = await next.load(started.doc.id);
    assert.equal(loaded.state.node, advanced.state.node, '同 ID 原位，不退场首');
    assert.equal(loaded.level, 'same-id');
    assert.equal(loaded.backupId, null, '无损迁移不留底');
    const after = await store.getSave(started.doc.id);
    assert.equal(after.dirty, 1, '迁移回写必须置脏——否则远端永远收不到这次对位');
    assert.ok(after.vv.A > advanced.doc.vv.A, '迁移是版本化写入，向量前进');
  });

  it('对位落在断链上：自愈降级到健康停点，原进度确定性备份成分支档', async () => {
    const store = new MemoryStore();
    const runtime = runtimeFor(store);
    const started = await runtime.newGame(7);
    const advanced = await runtime.advance(started.doc.id); // 停在 ch1-n2
    const docBefore = await store.getSave(started.doc.id);
    const broken = structuredClone(ir);
    broken.nodes[advanced.state.node].next = 'node-that-was-removed';
    const next = new LocalRuntime({ ir: broken, irHash: 'fixture-broken', store, deviceId: 'A' });
    const loaded = await next.load(started.doc.id);
    assert.equal(loaded.level, 'scene-start', '断链必须自愈到本场景健康停点');
    assert.notEqual(loaded.state.node, advanced.state.node);
    assert.ok(loaded.backupId, '降级必须留底');
    assert.equal(loaded.backupId, `${started.doc.id}-backup-fixture-broken`, '备份 id 确定性：多设备同档同版本只留一份');
    const backup = await store.getSave(loaded.backupId);
    assert.equal(backup.run.nodeId, docBefore.run.nodeId, '备份保留迁移前的原始位置');
    assert.equal(backup.forkOf, started.doc.id);
    assert.equal(backup.dirty, 1, '留底随同步推到其他设备，进度永不单点');
    const after = await store.getSave(started.doc.id);
    assert.equal(after.dirty, 1);
    assert.ok(after.vv.A > docBefore.vv.A);
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

  it('冲突档不得热切正在玩的本地主线：静默分叉，不触发跟进通知', async () => {
    const store = new MemoryStore();
    // 本机正在玩： vv{C:5}、dirty、停在 n3
    await store.putSave({ ...docFor('doc-live', { C: 5 }, 'n3'), dirty: 1 });
    // 服务器并发副本： vv{B:4}，位置更早（n1）
    const serverCopy = { ...docFor('doc-live', { B: 4 }, 'n1'), dirty: 0 };
    let notified = 0;
    const client = new SyncClient({ store, deviceId: 'C', games: [ir.id], post: async () => ({}), onRemote: () => notified++ });
    await client.applyRemote(serverCopy);
    assert.equal(notified, 0, '并发冲突不得把正在玩的档热切回远端位置');
    assert.ok([...store.saves.keys()].some(id => id.startsWith('doc-live-fork-C-')), '本机进度必须先分叉保命');
    assert.equal((await store.getSave('doc-live')).run.nodeId, 'n1', '主线槽位按同步协议接受远端，但玩家不被拽走');
  });

  it('冲突分叉必须以 onFork 告知：分叉承载本机谱系与位置，活动局改走分叉继续', async () => {
    const store = new MemoryStore();
    await store.putSave({ ...docFor('doc-active', { C: 7 }, 'n5'), dirty: 1 });
    const serverCopy = { ...docFor('doc-active', { B: 2 }, 'n1'), dirty: 0 };
    let fork = null, remoteNotified = 0;
    const client = new SyncClient({ store, deviceId: 'C', games: [ir.id], post: async () => ({}),
      onRemote: () => remoteNotified++, onFork: f => { fork = f; } });
    await client.applyRemote(serverCopy);
    assert.ok(fork, '分叉必须回调 onFork——否则活动局下一拍会读到被顶替的主线，位置悄悄回退');
    assert.equal(fork.run.nodeId, 'n5', '分叉承载本机位置');
    assert.equal(fork.forkOf, 'doc-active');
    assert.ok(await store.getSave(fork.id), '分叉已落库且 dirty 待推');
    assert.equal((await store.getSave(fork.id)).dirty, 1);
    assert.equal(remoteNotified, 0, '冲突不是跟进：不触发 onRemote');
  });

  it('远端真正领先才通知跟进（跨设备续玩），新拉到的档不通知', async () => {
    const store = new MemoryStore();
    await store.putSave({ ...docFor('doc-follow', { C: 2 }, 'n1'), dirty: 0 });
    const ahead = { ...docFor('doc-follow', { C: 3 }, 'n3'), dirty: 0 };
    let notified = 0;
    const client = new SyncClient({ store, deviceId: 'C', games: [ir.id], post: async () => ({}), onRemote: () => notified++ });
    await client.applyRemote(ahead);
    assert.equal(notified, 1, '真领先要在停点跟进');
    assert.equal((await store.getSave('doc-follow')).run.nodeId, 'n3');

    notified = 0;
    const fresh = { ...docFor('doc-new-remote', { A: 1 }, 'n2') };
    await client.applyRemote(fresh);
    assert.equal(notified, 0, '新出现的远端档不通知（不在玩的档不热切）');
    assert.ok(await store.getSave('doc-new-remote'));
  });

  it('同负载并发（两台设备各自迁移过）：按向量合并不是冲突——seq 不得污染负载比较', async () => {
    const dbm = openDb(':memory:'); migrate(dbm, join(root, 'server/migrations')); createUser(dbm, '同负载合并', 'hash');
    try {
      syncFor(dbm, 1, { cursor: 0, push: [docFor('doc-same-payload', { A: 2 })], collect: {} });
      syncFor(dbm, 1, { cursor: 0, push: [docFor('doc-same-payload', { A: 3 })], collect: {} }); // 设备 A 迁移：A 分量前进
      const fromB = docFor('doc-same-payload', { A: 2, B: 1 });                                   // 设备 B 同版迁移：B 分量前进
      const response = syncFor(dbm, 1, { cursor: 0, push: [fromB], collect: {} });
      assert.equal(response.results[0].status, 'accepted', '负载相同只是各自迁移：向量取大合并，不得制造假冲突分叉');
      assert.deepEqual(response.results[0].doc?.vv, { A: 3, B: 1 });
    } finally { dbm.close(); }
  });

  it('干净本机档被并发顶替不再静默：同样分叉保命', async () => {
    const store = new MemoryStore();
    await store.putSave({ ...docFor('doc-clean-live', { C: 2 }, 'n3'), dirty: 0 });
    const serverCopy = { ...docFor('doc-clean-live', { B: 4 }, 'n1'), dirty: 0 };
    let fork = null;
    const client = new SyncClient({ store, deviceId: 'C', games: [ir.id], post: async () => ({}), onFork: f => { fork = f; } });
    await client.applyRemote(serverCopy);
    assert.ok(fork, '干净档被并发覆盖必须分叉保命——静默顶替会丢进度');
    assert.equal(fork.run.nodeId, 'n3', '分叉承载本机位置');
    assert.equal((await store.getSave('doc-clean-live')).run.nodeId, 'n1', '主线槽位按协议接受远端');
  });

  it('删除语义不回滚：干净副本撞上并发墓碑仍静默接受，不得分叉复活', async () => {
    const store = new MemoryStore();
    await store.putSave({ ...docFor('doc-clean-del', { C: 2 }, 'n3'), dirty: 0 });
    const tomb = { ...docFor('doc-clean-del', { B: 1 }, 'n3'), deleted: 1, dirty: 0 };
    let fork = null;
    const client = new SyncClient({ store, deviceId: 'C', games: [ir.id], post: async () => ({}), onFork: f => { fork = f; } });
    await client.applyRemote(tomb);
    assert.equal(fork, null, '另一台设备删掉的档不得被干净副本复活');
    assert.equal((await store.getSave('doc-clean-del')).deleted, 1);
  });

  it('真领先但负载相同（他机做过同版迁移）：静默落库，不再打扰玩家跟进', async () => {
    const store = new MemoryStore();
    await store.putSave({ ...docFor('doc-quiet', { C: 2 }, 'n3'), dirty: 0 });
    const ahead = { ...docFor('doc-quiet', { C: 3, B: 1 }, 'n3'), dirty: 0, seq: 9 };
    let notified = 0;
    const client = new SyncClient({ store, deviceId: 'C', games: [ir.id], post: async () => ({}), onRemote: () => notified++ });
    await client.applyRemote(ahead);
    assert.equal(notified, 0, '位置一字未变的「领先」只是收敛，不该弹跟进提示');
    assert.deepEqual((await store.getSave('doc-quiet')).vv, { C: 3, B: 1 });
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

describe('存档删除：本机与远端都可清（墓碑经同步传播）', () => {
  it('删除即墓碑：本机列表消失、置脏待推、重复删除幂等', async () => {
    const store = new MemoryStore();
    const runtime = runtimeFor(store);
    const started = await runtime.newGame(7);
    await runtime.advance(started.doc.id);
    const tomb = await runtime.remove(started.doc.id);
    assert.equal(tomb.deleted, 1, '删除是墓碑不是物理清除——同步协议需要它传播');
    assert.equal(tomb.dirty, 1, '墓碑必须置脏，否则永远留在本机');
    assert.equal((await store.listSaves(ir.id)).length, 0, '本机列表立即消失');
    await runtime.remove(started.doc.id); // 幂等：已删再删不炸
    assert.equal((await store.listSaves(ir.id)).length, 0);
  });

  it('墓碑经同步传播：另一台设备的同名活档被替换，两端列表都清空', async () => {
    const db = openDb(':memory:'); migrate(db, join(root, 'server/migrations')); createUser(db, '删除同步', 'hash');
    try {
      const storeA = new MemoryStore(), storeB = new MemoryStore();
      const post = async (path, body) => syncFor(db, 1, body);
      const A = new SyncClient({ store: storeA, deviceId: 'A', games: [ir.id], post });
      const B = new SyncClient({ store: storeB, deviceId: 'B', games: [ir.id], post });
      const runtime = runtimeFor(storeA);
      const started = await runtime.newGame(7);
      await runtime.advance(started.doc.id);
      await A.flush();
      await B.flush(); // B 拉到活档
      assert.equal((await storeB.listSaves(ir.id)).length, 1);
      await runtime.remove(started.doc.id);
      await A.flush(); // 推墓碑
      await B.flush(); // B 拉墓碑：活档被替换
      assert.equal((await storeB.listSaves(ir.id)).length, 0, '远端删除必须传播到 B');
      assert.equal((await storeA.listSaves(ir.id)).length, 0);
      const docB = await storeB.getSave(started.doc.id);
      assert.equal(docB?.deleted, 1, 'B 侧保留墓碑：已删除状态跨设备稳定');
    } finally { db.close(); }
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

  it('SW 注册 URL 带 bundle 戳：CDN 缓存不了它，换壳不被网络层卡死', async () => {
    const server = createApp({ db: null, games, webDir: join(root, 'web') });
    await new Promise(resolveListen => server.listen(0, resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const html = await (await fetch(`${base}/`)).text();
      const m = html.match(/__NU_SW_URL\s*=\s*"\/sw\.js\?b=([0-9a-f]+)"/);
      assert.ok(m, 'index.html 必须注入带 bundle 戳的 SW 注册 URL（否则 CDN 缓存 sw.js 时旧壳永远换不掉）');
      const stamped = await fetch(`${base}/sw.js?b=${m[1]}`);
      assert.equal(stamped.status, 200);
      assert.match(stamped.headers.get('cache-control') ?? '', /no-cache/);
      assert.match(await stamped.text(), /jinjiang-offline-/);
    } finally { server.close(); }
  });

  it('版本指纹可自查：/api/version 报 shell 壳戳且 API 响应 no-store', async () => {
    const server = createApp({ db: null, games, webDir: join(root, 'web') });
    await new Promise(resolveListen => server.listen(0, resolveListen));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const res = await fetch(`${base}/api/version`);
      const body = await res.json();
      assert.match(body.shell ?? '', /^[0-9a-f]{16}$/, '必须携带 shell 壳戳——否则用户无法排查手机是否换到新壳');
      assert.match(res.headers.get('cache-control') ?? '', /no-store/, 'API 响应必须 no-store，免疫任何 CDN 层缓存改写');
    } finally { server.close(); }
  });
});
