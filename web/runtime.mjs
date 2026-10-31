// 本地运行时：与旧服务端 advance/choose 同一份纯引擎，但所有推进先写 IndexedDB。
import { createRun, advance, choose, stateOf, loadRun, submitPick } from '../engine/state.mjs';
import { makeAnchor, resolveAnchor, bumpVV } from '../engine/save.mjs';

const copy = value => structuredClone(value);
const isoNow = () => new Date().toISOString();
const makeId = () => globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;

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
    const run = loadRun(doc.run);
    const previousHash = doc.irHash;
    // 内容版本变化时只移动快照定位，不制造版本向量冲突。
    if (previousHash !== this.irHash || !doc.anchor) {
      const resolved = doc.anchor ? resolveAnchor(this.ir, doc.anchor) : { nodeId: run.nodeId, exact: true, level: 'legacy' };
      if (resolved.nodeId && resolved.nodeId !== run.nodeId) run.nodeId = resolved.nodeId;
      doc.run = copy(run); doc.irHash = this.irHash; doc.anchor = makeAnchor(this.ir, run.nodeId);
      doc.summary = this.summary(run);
      await this.store.putSave(doc);
    }
    return { doc, state: this.state(run), migrated: previousHash !== this.irHash };
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

  async fork(doc) {
    const at = this.now();
    const fork = { ...copy(doc), id: this.uuid(), forkOf: doc.id, vv: { [this.deviceId]: 1 }, createdAt: at, updatedAt: at, dirty: 1, deleted: 0 };
    await this.store.putSave(fork);
    return fork;
  }
}
