// 本地优先存储：浏览器使用 IndexedDB；MemoryStore 供 node:test 与同步协议测试复用。
// 所有玩法写入先落盘，网络同步只读取 dirty 文档，不参与推进。

const clone = value => value == null ? value : structuredClone(value);

export class MemoryStore {
  constructor() { this.saves = new Map(); this.collections = new Map(); this.meta = new Map(); }
  async getSave(id) { return clone(this.saves.get(id) ?? null); }
  async putSave(doc) { this.saves.set(doc.id, clone(doc)); return doc; }
  async listSaves(gameId) {
    return [...this.saves.values()].filter(d => d.gameId === gameId && !d.deleted)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).map(clone);
  }
  async listDirty() { return [...this.saves.values()].filter(d => d.dirty).map(clone); }
  async getCollection(gameId) { return clone(this.collections.get(gameId) ?? { gameId, endings: [], cards: [] }); }
  async mergeCollection(gameId, patch = {}) {
    const old = await this.getCollection(gameId);
    const next = { gameId, endings: [...new Set([...old.endings, ...(patch.endings ?? [])])], cards: [...new Set([...old.cards, ...(patch.cards ?? [])])] };
    this.collections.set(gameId, clone(next)); return next;
  }
  async getMeta(key) { return clone(this.meta.get(key) ?? null); }
  async setMeta(key, value) { this.meta.set(key, clone(value)); }
  async clearAll() { this.saves.clear(); this.collections.clear(); this.meta.clear(); }
}

const request = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error ?? new Error('本地存储请求失败'));
});
const transaction = (db, names, mode, fn) => new Promise((resolve, reject) => {
  const tx = db.transaction(names, mode);
  let result;
  try { result = fn(tx); } catch (e) { reject(e); return; }
  tx.oncomplete = () => resolve(result);
  tx.onerror = () => reject(tx.error ?? new Error('本地存储事务失败'));
  tx.onabort = () => reject(tx.error ?? new Error('本地存储事务中止'));
});

export async function openLocalStore() {
  if (typeof indexedDB === 'undefined') throw new Error('当前浏览器不支持本地存档');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('novel-universe-local', 1);
    req.onupgradeneeded = () => {
      const saves = req.result.createObjectStore('saves', { keyPath: 'id' });
      saves.createIndex('gameId', 'gameId');
      saves.createIndex('dirty', 'dirty');
      saves.createIndex('updatedAt', 'updatedAt');
      req.result.createObjectStore('collections', { keyPath: 'gameId' });
      req.result.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('无法打开本地存档'));
  });
  const store = {
    async getSave(id) { return transaction(db, ['saves'], 'readonly', tx => request(tx.objectStore('saves').get(id))); },
    async putSave(doc) { return transaction(db, ['saves'], 'readwrite', tx => { tx.objectStore('saves').put(doc); return doc; }); },
    async listSaves(gameId) {
      const all = await transaction(db, ['saves'], 'readonly', tx => request(tx.objectStore('saves').index('gameId').getAll(gameId)));
      return all.filter(d => !d.deleted).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    },
    async listDirty() {
      const all = await transaction(db, ['saves'], 'readonly', tx => request(tx.objectStore('saves').getAll()));
      return all.filter(d => d.dirty);
    },
    async getCollection(gameId) {
      return (await transaction(db, ['collections'], 'readonly', tx => request(tx.objectStore('collections').get(gameId)))) ?? { gameId, endings: [], cards: [] };
    },
    async mergeCollection(gameId, patch = {}) {
      return transaction(db, ['collections'], 'readwrite', tx => {
        const os = tx.objectStore('collections');
        const old = os.get(gameId);
        old.onsuccess = () => {
          const value = old.result ?? { gameId, endings: [], cards: [] };
          os.put({ gameId, endings: [...new Set([...value.endings, ...(patch.endings ?? [])])], cards: [...new Set([...value.cards, ...(patch.cards ?? [])])] });
        };
        return gameId;
      }).then(() => store.getCollection(gameId));
    },
    async getMeta(key) { return (await transaction(db, ['meta'], 'readonly', tx => request(tx.objectStore('meta').get(key))))?.value ?? null; },
    async setMeta(key, value) { return transaction(db, ['meta'], 'readwrite', tx => { tx.objectStore('meta').put({ key, value }); return value; }); },
    async clearAll() { return transaction(db, ['saves', 'collections', 'meta'], 'readwrite', tx => { for (const name of ['saves', 'collections', 'meta']) tx.objectStore(name).clear(); }); },
  };
  return store;
}
