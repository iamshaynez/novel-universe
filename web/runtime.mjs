// 本地运行时：与旧服务端 advance/choose 同一份纯引擎，但所有推进先写 IndexedDB。
import { createRun, advance, choose, stateOf, loadRun, submitPick } from '../engine/state.mjs';
import { makeAnchor, resolveAnchor, settleRun, bumpVV } from '../engine/save.mjs';

const copy = value => structuredClone(value);
const isoNow = () => new Date().toISOString();
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// 对位结果分级：这三级意味着玩家位置被回拨（场首/章首/卷首），必须留底可回退
const LOSSY_LEVELS = new Set(['scene-start', 'chapter-start', 'entry']);

export class LocalRuntime {
  constructor({ ir, irHash = null, store, deviceId = 'device', now = isoNow, uuid = makeId }) {
    this.ir = ir; this.irHash = irHash; this.store = store; this.deviceId = deviceId;
    this.now = now; this.uuid = uuid;
  }

  state(run) { return stateOf(this.ir, run); }
  async get(id) { return this.store.getSave(id); }

  async newGame(seed = 1) {
    const run = createRun(this.ir, seed);
    const at = this.now();
    const doc = {
      schema: 1, id: this.uuid(), gameId: this.ir.id, irHash: this.irHash,
      run: copy(run), anchor: makeAnchor(this.ir, run.nodeId),
      vv: { [this.deviceId]: 1 }, summary: this.summary(run),
      createdAt: at, updatedAt: at, deleted: 0, dirty: 1, forkOf: null,
    };
    await this.store.putSave(doc);
    await this.collect(run, {});
    return { doc, state: this.state(run) };
  }

  summary(run) {
    const s = this.state(run);
    return { chapter: s.chapter ?? null, chapterTitle: s.chapterTitle ?? null, ended: s.ended ?? null };
  }

  async load(id) {
    const doc = await this.store.getSave(id);
    if (!doc) throw new Error(`本地存档不存在 ${id}`);
    const originalNodeId = loadRun(doc.run).nodeId; // 迁移前的原始位置：位移判断与留底都以此为据（loadRun 不拷贝对象，只取标量）
    const run = copy(loadRun(doc.run)); // 工作副本：doc 在留底完成前必须保持迁移前的原貌
    const previousHash = doc.irHash;
    const irChanged = previousHash !== this.irHash || !doc.anchor;
    let level = null;
    if (irChanged) {
      // 内容版本变化时先按锚点对位（v1.1 结构优先：ID 在则原位，不因文案修订失位）
      const resolved = doc.anchor ? resolveAnchor(this.ir, doc.anchor) : { nodeId: run.nodeId, exact: true, level: 'legacy' };
      if (resolved.nodeId && resolved.nodeId !== run.nodeId) run.nodeId = resolved.nodeId;
      level = resolved.level;
    }
    // 断链自愈：对位落点必须真的推得动，推不动沿 场首→章首→卷首 降级——
    // 旧存档 × 新内容图的结合部不再把死局端给玩家
    const settled = settleRun(this.ir, run, doc.anchor ?? {});
    if (settled.nodeId !== run.nodeId) { run.nodeId = settled.nodeId; level = settled.level; }
    const moved = run.nodeId !== originalNodeId;
    const backupId = moved && LOSSY_LEVELS.has(level) ? await this.backupOriginal(doc) : null;
    if (irChanged || moved) {
      doc.run = copy(run); doc.irHash = this.irHash; doc.anchor = makeAnchor(this.ir, run.nodeId);
      doc.summary = this.summary(run);
      // v1.1：内容迁移是版本化写入（bump + 置脏）。同负载并发由服务器合并向量；
      // 旧策略「不递增」会让远端永远收不到这次对位，反而制造静默回退。
      doc.vv = bumpVV(doc, this.deviceId); doc.dirty = 1; doc.updatedAt = this.now();
      await this.store.putSave(doc);
    }
    return { doc, state: this.state(run), migrated: previousHash !== this.irHash, level, moved, backupId };
  }

  /** 降级迁移前的进度留底：确定性 id（多设备同档同版本只留一份），forkOf 指回原档。 */
  async backupOriginal(doc) {
    const id = `${doc.id}-backup-${this.irHash}`;
    if (await this.store.getSave(id)) return id;
    const at = this.now();
    const backup = { ...copy(doc), id, forkOf: doc.id, note: '内容更新前的进度备份',
      vv: { [this.deviceId]: 1 }, createdAt: at, updatedAt: at, dirty: 1, deleted: 0 };
    await this.store.putSave(backup);
    return id;
  }

  async write(doc, run) {
    const previousFlags = doc._previousFlags ?? {};
    delete doc._previousFlags;
    doc.run = copy(run); doc.irHash = this.irHash; doc.anchor = makeAnchor(this.ir, run.nodeId);
    doc.summary = this.summary(run); doc.updatedAt = this.now(); doc.vv = bumpVV(doc, this.deviceId); doc.dirty = 1;
    await this.store.putSave(doc);
    await this.collect(run, previousFlags);
    return { doc, state: this.state(run) };
  }

  async advance(id, pick = undefined) {
    return this.locked(id, async () => {
      const doc = await this.store.getSave(id);
      if (!doc) throw new Error(`本地存档不存在 ${id}`);
      const run = loadRun(doc.run);
      const next = this.state(run).kind === 'transcribe' ? submitPick(run, this.ir, pick) : advance(run, this.ir);
      doc._previousFlags = { ...run.flags };
      return this.write(doc, next);
    });
  }

  async choose(id, index) {
    return this.locked(id, async () => {
      const doc = await this.store.getSave(id);
      if (!doc) throw new Error(`本地存档不存在 ${id}`);
      const run = loadRun(doc.run);
      const next = choose(run, this.ir, index);
      doc._previousFlags = { ...run.flags };
      return this.write(doc, next);
    });
  }

  async locked(id, fn) {
    if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request(`nu-save-${id}`, fn);
    return fn();
  }

  async collect(run, previousFlags = {}) {
    const cards = Object.keys(run.flags ?? {}).filter(k => k.startsWith('card.') && !previousFlags[k]).map(k => k.slice(5));
    const endings = run.ended ? [run.ended] : [];
    if (cards.length || endings.length) await this.store.mergeCollection(this.ir.id, { cards, endings });
  }

  async importLegacy(save, run) {
    const at = this.now();
    const doc = {
      schema: 1, id: `legacy-${save.id}`, gameId: this.ir.id, irHash: this.irHash,
      run: copy(run), anchor: makeAnchor(this.ir, run.nodeId), vv: { legacy: 1 },
      summary: this.summary(run), createdAt: save.created_at ?? at, updatedAt: save.updated_at ?? at,
      deleted: 0, dirty: 1, forkOf: null,
    };
    await this.store.putSave(doc);
    await this.collect(run, {});
    return doc;
  }

  /** 删除即墓碑：置脏 + 版本向量自增，随同步推到服务器与其他设备（活档并发时活档胜的协议不变）。 */
  async remove(id) {
    return this.locked(id, async () => {
      const doc = await this.store.getSave(id);
      if (!doc) throw new Error(`本地存档不存在 ${id}`);
      if (doc.deleted) return doc; // 幂等
      const tomb = { ...doc, deleted: 1, dirty: 1, vv: bumpVV(doc, this.deviceId), updatedAt: this.now() };
      await this.store.putSave(tomb);
      return tomb;
    });
  }

  async fork(doc) {
    const at = this.now();
    const fork = { ...copy(doc), id: this.uuid(), forkOf: doc.id, vv: { [this.deviceId]: 1 }, createdAt: at, updatedAt: at, dirty: 1, deleted: 0 };
    await this.store.putSave(fork);
    return fork;
  }
}
