// 后台同步：任何失败都只影响同步状态，不影响 LocalRuntime。
import { compareVV, mergeVV, samePayload, publicDoc } from '../engine/save.mjs';

export class SyncClient {
  constructor({ store, deviceId, post, games = [], onStatus = () => {}, onRemote = () => {} }) {
    this.store = store; this.deviceId = deviceId; this.post = post; this.games = games; this.onStatus = onStatus; this.onRemote = onRemote;
    this.cursor = 0; this.busy = null; this.paused = false; this.attempt = 0;
  }

  status(text, extra = {}) { this.onStatus({ text, ...extra }); }

  async applyRemote(remote) {
    const clean = { ...remote, dirty: 0 };
    delete clean.seq;
    const storeRemote = async (doc, notify = true) => { await this.store.putSave(doc); if (notify) this.onRemote(doc); };
    const local = await this.store.getSave(remote.id);
    if (!local) { await storeRemote(clean); return; }
    const relation = compareVV(local.vv, remote.vv);
    if (relation === -1) { await storeRemote(clean); return; }
    if (relation === 1) return; // 本机领先，留在下一次 push
    if (relation === 0 && samePayload(local, remote)) { await storeRemote(clean, false); return; }
    if (samePayload(local, remote)) {
      const merged = { ...remote, vv: mergeVV(local.vv, remote.vv), dirty: local.dirty ? 1 : 0 };
      delete merged.seq;
      await storeRemote(merged, false); return;
    }
    if (local.dirty) {
      const forkId = `${local.id}-fork-${this.deviceId}-${Date.now().toString(36)}`;
      await this.store.putSave({ ...local, id: forkId, forkOf: local.id, vv: { [this.deviceId]: 1 }, dirty: 1 });
    }
    await storeRemote(clean);
  }

  async flush() {
    if (globalThis.navigator?.locks?.request) return globalThis.navigator.locks.request('nu-sync', () => this.flushUnlocked());
    return this.flushUnlocked();
  }

  async flushUnlocked() {
    if (this.paused) return false;
    if (this.busy) return this.busy;
    this.busy = (async () => {
      let dirty = [];
      try {
        dirty = await this.store.listDirty();
        const collect = {};
        for (const gameId of this.games) collect[gameId] = await this.store.getCollection(gameId);
        const pushed = new Map(dirty.map(doc => [doc.id, doc.vv]));
        const response = await this.post('/api/sync', {
          protocol: 1, deviceId: this.deviceId, cursor: this.cursor,
          push: dirty.map(publicDoc), collect,
        });
        for (const result of response.results ?? []) {
          if (result.status === 'accepted') {
            if (result.doc) await this.applyRemote(result.doc);
            const local = await this.store.getSave(result.id);
            if (local && JSON.stringify(local.vv) === JSON.stringify(pushed.get(result.id))) await this.store.putSave({ ...local, dirty: 0 });
          } else if (result.doc) {
            await this.applyRemote(result.doc);
          }
        }
        for (const doc of response.pull ?? []) await this.applyRemote(doc);
        for (const [gameId, patch] of Object.entries(response.collect ?? {})) await this.store.mergeCollection(gameId, patch);
        this.cursor = response.cursor ?? this.cursor;
        await this.store.setMeta('syncCursor', this.cursor);
        this.attempt = 0;
        const left = (await this.store.listDirty()).length;
        this.status(left ? `待同步 ${left} 项` : '已同步', { dirty: left, online: true });
        return true;
      } catch (error) {
        if (error.status === 401 || error.status === 403) {
          this.paused = true; this.status('需要重新登录', { online: false, paused: true });
        } else {
          this.attempt++;
          this.status(`同步稍后重试（${error.message}）`, { online: false, dirty: dirty.length });
        }
        return false;
      } finally { this.busy = null; }
    })();
    return this.busy;
  }

  async init() {
    this.cursor = (await this.store.getMeta('syncCursor')) ?? 0;
    return this.flush();
  }
}
