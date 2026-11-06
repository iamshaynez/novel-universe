// 作品发布与管理员预览：公开目录、内容直链、兼容存档、同步与身份边界。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, setGamePublished, createUser, createSession } from '../server/db.mjs';
import { loadGames, createApp } from '../server/app.mjs';
import { irHash } from '../server/content.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = {};

async function call(path, { method = 'GET', body, sid } = {}) {
  const res = await fetch(base.url + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(sid ? { Cookie: `nu_sid=${sid}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    body: await res.json().catch(() => ({})),
    headers: res.headers,
    newSid: res.headers.get('set-cookie')?.match(/nu_sid=([^;]+)/)?.[1] ?? null,
  };
}
const put = (path, body, sid) => call(path, { method: 'PUT', body, sid });
const post = (path, body, sid) => call(path, { method: 'POST', body, sid });
const text = async path => (await fetch(base.url + path)).text();

before(async () => {
  const db = openDb(':memory:');
  migrate(db, join(root, 'server/migrations'));
  const games = loadGames(join(root, 'test/fixtures/games'), join(root, 'test/fixtures/universe'));
  const published = games['g00-demo'];
  const draftIr = structuredClone(published.ir);
  draftIr.id = 'g00-draft';
  draftIr.title = '未发布档案';
  games['g00-draft'] = { ...published, ir: draftIr };
  setGamePublished(db, 'g00-demo', true);
  const server = createApp({ db, games, webDir: join(root, 'web') });
  await new Promise(r => server.listen(0, r));
  Object.assign(base, { db, games, server, url: `http://127.0.0.1:${server.address().port}` });
  setGamePublished(db, 'g00-demo', true);

  const adminId = createUser(db, 'admin', 'hash');
  createSession(db, adminId, 'admin-session', 3600);
  base.adminSid = 'admin-session';
  const adminLikeId = createUser(db, 'Admin', 'hash');
  createSession(db, adminLikeId, 'admin-like-session', 3600);
  base.adminLikeSid = 'admin-like-session';
  const ordinary = await post('/api/auth/register', { username: '普通读者', password: 'password-123' });
  base.userSid = ordinary.newSid;
  const guest = await call('/api/auth/guest');
  base.guestSid = guest.newSid;
});
after(() => { base.server.close(); base.db.close(); });
beforeEach(async () => {
  await put('/api/games/g00-demo/published', { published: true }, base.adminSid);
  await put('/api/games/g00-draft/published', { published: false }, base.adminSid);
});

describe('发布状态与管理员身份', () => {
  it('普通清单只含已发布；admin 默认看到全部与开关状态', async () => {
    for (const sid of [null, base.guestSid, base.userSid, base.adminLikeSid]) {
      const r = await call('/api/games', { sid });
      assert.equal(r.status, 200);
      assert.ok(r.body.some(g => g.id === 'g00-demo'));
      assert.ok(!r.body.some(g => g.id === 'g00-draft'));
      assert.equal((await call('/api/games/g00-draft', { sid })).status, 404);
    }
    const admin = await call('/api/games', { sid: base.adminSid });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.find(g => g.id === 'g00-draft').published, false);
    assert.equal(admin.body.find(g => g.id === 'g00-demo').published, true);
    const detail = await call('/api/games/g00-draft', { sid: base.adminSid });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.ir.id, 'g00-draft');
    assert.match(detail.headers.get('cache-control'), /no-store/);
    const me = await call('/api/auth/me', { sid: base.adminSid });
    assert.equal(me.body.user.admin, true);
    assert.equal((await call('/api/auth/me', { sid: base.adminLikeSid })).body.user.admin, false);
  });

  it('admin 用户名不能经公开注册抢占', async () => {
    const r = await post('/api/auth/register', { username: 'admin', password: 'password-123' });
    assert.equal(r.status, 403);
  });

  it('只有精确 admin 可切换；参数必须是 boolean', async () => {
    assert.equal((await put('/api/games/g00-draft/published', { published: true })).status, 401);
    for (const sid of [base.guestSid, base.userSid, base.adminLikeSid]) {
      assert.equal((await put('/api/games/g00-draft/published', { published: true }, sid)).status, 403);
    }
    assert.equal((await put('/api/games/g00-draft/published', { published: 'true' }, base.adminSid)).status, 400);
    assert.equal((await put('/api/games/nope/published', { published: true }, base.adminSid)).status, 404);
    const ok = await put('/api/games/g00-draft/published', { published: true }, base.adminSid);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.published, true);
    assert.equal((await call('/api/games/g00-draft')).status, 200);
  });
});

describe('公开目录、内容直链与离线包', () => {
  it('草稿不进入公共 catalog、版本化 IR 或 SW，即使请求者持有 admin cookie', async () => {
    const draftIrUrl = `/content/g00-draft.${irHash(base.games['g00-draft'].ir)}.json`;
    const catalog = await call('/content/catalog.json');
    assert.ok(!catalog.body.some(g => g.id === 'g00-draft'));
    assert.equal((await call(draftIrUrl)).status, 404);
    assert.equal((await call(draftIrUrl, { sid: base.adminSid })).status, 404);
    const sw = await text('/sw.js');
    assert.ok(!sw.includes('g00-draft'));
  });

  it('切换发布立即改变公开目录、IR、SW 与 bundle', async () => {
    const before = await call('/api/version');
    await put('/api/games/g00-draft/published', { published: true }, base.adminSid);
    const published = await call('/api/version');
    assert.notEqual(published.body.bundle, before.body.bundle);
    const draftIrUrl = `/content/g00-draft.${irHash(base.games['g00-draft'].ir)}.json`;
    assert.equal((await call(draftIrUrl)).status, 200);
    assert.ok((await call('/content/catalog.json')).body.some(g => g.id === 'g00-draft'));
    assert.ok((await text('/sw.js')).includes('g00-draft'));
    await put('/api/games/g00-draft/published', { published: false }, base.adminSid);
    const unpublished = await call('/api/version');
    assert.notEqual(unpublished.body.bundle, published.body.bundle);
    assert.equal((await call(draftIrUrl)).status, 404);
    assert.ok(!(await text('/sw.js')).includes('g00-draft'));
  });
});

describe('存档与同步不得绕过发布状态', () => {
  it('admin 可建草稿档；普通身份不能读取、推进或枚举草稿内容', async () => {
    const start = await post('/api/games/g00-draft/saves', { seed: 7 }, base.adminSid);
    assert.equal(start.status, 201);
    const id = start.body.saveId;
    for (const sid of [base.guestSid, base.userSid]) {
      assert.equal((await call(`/api/saves/${id}`, { sid })).status, 404);
      assert.equal((await post(`/api/saves/${id}/advance`, {}, sid)).status, 404);
      assert.equal((await call('/api/saves?gameId=g00-draft', { sid })).status, 404);
      assert.equal((await call('/api/games/g00-draft/cards', { sid })).status, 404);
      assert.equal((await call('/api/games/g00-draft/endings', { sid })).status, 404);
      assert.equal((await post('/api/games/g00-draft/saves', {}, sid)).status, 404);
    }
    assert.equal((await call(`/api/saves/${id}`, { sid: base.adminSid })).status, 200);
  });

  it('已发布档在下架后停止普通读取，但数据保留；重新发布恢复', async () => {
    await put('/api/games/g00-draft/published', { published: true }, base.adminSid);
    const start = await post('/api/games/g00-draft/saves', { seed: 8 }, base.userSid);
    assert.equal(start.status, 201);
    await put('/api/games/g00-draft/published', { published: false }, base.adminSid);
    assert.equal((await call(`/api/saves/${start.body.saveId}`, { sid: base.userSid })).status, 404);
    assert.ok(base.db.prepare('SELECT id FROM saves WHERE id = ?').get(start.body.saveId), '下架不得删除旧存档');
    await put('/api/games/g00-draft/published', { published: true }, base.adminSid);
    assert.equal((await call(`/api/saves/${start.body.saveId}`, { sid: base.userSid })).status, 200);
  });

  it('同步隐藏未发布作品的写入、拉取与收集，重新发布后恢复', async () => {
    await put('/api/games/g00-draft/published', { published: true }, base.adminSid);
    const doc = { schema: 1, id: 'draft-sync-doc', gameId: 'g00-draft', run: { nodeId: 'n1' }, vv: { A: 1 }, dirty: 1, deleted: 0 };
    const request = { protocol: 1, deviceId: 'A', cursor: 0, push: [doc], collect: { 'g00-draft': { endings: ['E1'], cards: [] } } };
    assert.equal((await post('/api/sync', request, base.userSid)).status, 200);
    await put('/api/games/g00-draft/published', { published: false }, base.adminSid);
    const blocked = await post('/api/sync', request, base.userSid);
    assert.equal(blocked.status, 404);
    const pulled = await post('/api/sync', { protocol: 1, deviceId: 'A', cursor: 0, push: [], collect: {} }, base.userSid);
    assert.equal(pulled.status, 200);
    assert.ok(!pulled.body.pull.some(d => d.gameId === 'g00-draft'));
    assert.ok(!pulled.body.collect['g00-draft']);
    await put('/api/games/g00-draft/published', { published: true }, base.adminSid);
    const restored = await post('/api/sync', { protocol: 1, deviceId: 'A', cursor: 0, push: [], collect: { 'g00-draft': { endings: [], cards: [] } } }, base.userSid);
    assert.ok(restored.body.pull.some(d => d.gameId === 'g00-draft'));
    assert.deepEqual(restored.body.collect['g00-draft'].endings, ['E1']);
  });
});
