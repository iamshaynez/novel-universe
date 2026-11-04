import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../web/store.mjs';
import { LocalRuntime } from '../web/runtime.mjs';
import { SyncClient } from '../web/sync.mjs';
import { parseSaveTime, saveTimestamp, compareSaveDocs, formatSaveTime, resumeSave, saveViewModel } from '../web/save-view.mjs';

describe('存档时间戳：不同年代的数据都用同一口径', () => {
  it('标准 ISO 与旧 SQLite UTC 文本都按真实时刻解析', () => {
    assert.equal(parseSaveTime('2026-11-04T08:30:00.000Z'), Date.UTC(2026, 10, 4, 8, 30, 0));
    assert.equal(parseSaveTime('2026-11-04 08:29:58'), Date.UTC(2026, 10, 4, 8, 29, 58));
    assert.equal(parseSaveTime('不是时间'), null);
    assert.equal(parseSaveTime(''), null);
    assert.equal(parseSaveTime(null), null);
    assert.equal(parseSaveTime(1e20), null, '超出 Date TimeClip 的数字也必须拒绝');
  });

  it('最后保存时间缺失时回退创建时间，显示固定格式的本机时间', () => {
    const doc = { createdAt: '2026-11-04T08:30:00.000Z' };
    assert.equal(saveTimestamp(doc), Date.UTC(2026, 10, 4, 8, 30, 0));
    assert.match(formatSaveTime(doc), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.equal(formatSaveTime({ updatedAt: '坏数据', createdAt: '也没有' }), '时间未知');
  });

  it('混合格式按时刻排序而不是字符串排序；缺失时间沉底且 ID 破平', () => {
    const iso = { id: 'iso', updatedAt: '2026-11-04T08:30:00.000Z' };
    const sqlite = { id: 'sqlite', updatedAt: '2026-11-04 09:00:00' };
    const unknown = { id: 'unknown' };
    assert.deepEqual([iso, unknown, sqlite].sort(compareSaveDocs).map(d => d.id), ['sqlite', 'iso', 'unknown']);
    assert.deepEqual([{ id: 'b' }, { id: 'a' }].sort(compareSaveDocs).map(d => d.id), ['a', 'b']);
  });

  it('MemoryStore 同样按归一化时刻排序并排除墓碑', async () => {
    const store = new MemoryStore();
    await store.putSave({ id: 'old', gameId: 'g1', updatedAt: '2026-11-04T08:30:00.000Z' });
    await store.putSave({ id: 'new', gameId: 'g1', updatedAt: '2026-11-04 09:00:00' });
    await store.putSave({ id: 'deleted', gameId: 'g1', updatedAt: '2026-11-04T10:00:00.000Z', deleted: 1 });
    assert.deepEqual((await store.listSaves('g1')).map(d => d.id), ['new', 'old']);
  });
});

describe('选档视图：快捷续读与全部存档各有明确职责', () => {
  it('最新档已通关时，作品卡仍续读最近的未完成档；全部通关则不自动读档', () => {
    const saves = [
      { id: 'ended', summary: { ended: 'E1' }, updatedAt: '2026-11-04T10:00:00.000Z' },
      { id: 'playing', summary: { ended: null }, updatedAt: '2026-11-04 09:00:00' },
      { id: 'older', summary: { ended: null }, updatedAt: '2026-11-04T08:00:00.000Z' },
    ];
    assert.equal(resumeSave(saves)?.id, 'playing');
    assert.equal(resumeSave([saves[0]]), null);
    assert.equal(resumeSave([{ ...saves[1], deleted: 1 }]), null);
  });

  it('已通关、待同步与分支身份分行展示，互不遮蔽', () => {
    const view = saveViewModel({
      id: 'fork-123456789', gameId: 'g01', forkOf: 'root', dirty: 1,
      summary: { chapterTitle: '第三章 · 河对岸', ended: 'E2' },
      updatedAt: '2026-11-04T08:30:00.000Z',
    }, { title: '接线员' });
    assert.equal(view.title, '接线员');
    assert.equal(view.chapter, '第三章 · 河对岸');
    assert.equal(view.shortId, 'fork-123');
    assert.equal(view.kind, '分支存档');
    assert.equal(view.progress, '已通关 · E2');
    assert.equal(view.sync, '待同步');
    assert.match(view.time, /^\d{4}-/);
  });

  it('同步冲突产生的新分叉使用自己的创建时间，不冒充原档年代', async () => {
    const old = '2020-01-01T00:00:00.000Z';
    const local = { id: 'doc', gameId: 'g1', run: { nodeId: 'n2', flags: {}, affinity: {}, choiceLog: [], seed: 1, ended: null }, vv: { A: 1 }, dirty: 1, deleted: 0, createdAt: old, updatedAt: old };
    const remote = { ...local, run: { ...local.run, nodeId: 'n1' }, vv: { B: 1 }, dirty: 0 };
    const store = new MemoryStore();
    await store.putSave(local);
    let fork = null;
    const client = new SyncClient({ store, deviceId: 'A', post: async () => ({}), onFork: value => { fork = value; } });
    await client.applyRemote(remote);
    assert.ok(fork);
    assert.ok(saveTimestamp(fork) > Date.parse(old));
    assert.equal(fork.createdAt, fork.updatedAt);
  });

  it('离线删除只写墓碑，不需要该作品的 IR 缓存', async () => {
    const store = new MemoryStore();
    await store.putSave({ id: 'offline-doc', gameId: 'uncached-game', run: { nodeId: 'n1' }, vv: { A: 1 }, dirty: 0, deleted: 0 });
    const runtime = new LocalRuntime({ ir: null, store, deviceId: 'A', now: () => '2026-11-04T08:30:00.000Z' });
    const tomb = await runtime.remove('offline-doc');
    assert.equal(tomb.deleted, 1);
    assert.equal(tomb.dirty, 1);
    assert.equal(tomb.updatedAt, '2026-11-04T08:30:00.000Z');
  });
});
