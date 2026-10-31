// 认证与存档归属 API 测试：游客会话 → 注册升级 → 登录切换 → 归属隔离。
// 设计合同：不透明 token 存库（node:sqlite），cookie 只放 sid；引擎层零改动。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '../server/db.mjs';
import { loadGames, createApp } from '../server/app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = {};

before(async () => {
  const db = openDb(':memory:');
  migrate(db, join(root, 'server/migrations'));
  const games = loadGames(join(root, 'test/fixtures/games'), join(root, 'test/fixtures/universe'));
  const server = createApp({ db, games, webDir: join(root, 'web') });
  await new Promise(r => server.listen(0, r));
  base.url = `http://127.0.0.1:${server.address().port}`;
  base.server = server; base.db = db;
});
after(() => { base.server.close(); base.db.close(); });

/** 带可选会话的请求；返回 set-cookie 里的 nu_sid 值便于链式持有。 */
async function call(path, { method, body, sid } = {}) {
  const res = await fetch(base.url + path, {
    method: method ?? 'GET',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(sid ? { Cookie: `nu_sid=${sid}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  const newSid = setCookie?.match(/nu_sid=([^;]+)/)?.[1] ?? null;
  return { status: res.status, body: await res.json().catch(() => ({})), setCookie, newSid };
}
const post = (path, body, sid) => call(path, { method: 'POST', body, sid });
const me = sid => call('/api/auth/me', { sid });

/** 拿一个全新游客会话（模拟一个新浏览器）。 */
async function newGuest() {
  const r = await call('/api/auth/guest');
  assert.equal(r.status, 200);
  return r.newSid;
}

describe('会话：本机优先，游客接口仅作兼容', () => {
  it('me 无 cookie → 返回空身份且不下发服务端游客会话', async () => {
    const r = await me();
    assert.equal(r.status, 200);
    assert.equal(r.body.user, null);
    assert.equal(r.newSid, null);
  });

  it('兼容 guest 接口 → 建游客并发 HttpOnly 会话 cookie', async () => {
    const r = await call('/api/auth/guest');
    assert.equal(r.status, 200);
    assert.equal(r.body.user.guest, true);
    assert.match(r.body.user.username, /^游客/);
    assert.ok(r.newSid, '应下发会话 cookie');
    assert.match(r.setCookie, /HttpOnly/);
    assert.match(r.setCookie, /SameSite=Lax/i);
  });

  it('同一 cookie 再 me → 同一用户，不重复建游客', async () => {
    const sid = await newGuest();
    const before = base.db.prepare('SELECT COUNT(*) c FROM users').get().c;
    const a = await me(sid);
    const b = await me(sid);
    assert.equal(a.body.user.id, b.body.user.id);
    const after = base.db.prepare('SELECT COUNT(*) c FROM users').get().c;
    assert.equal(after, before, '两次 me 不得新增用户');
  });

  it('登出后会话作废，me 换新游客', async () => {
    const sid = await newGuest();
    const before = (await me(sid)).body.user;
    const out = await post('/api/auth/logout', {}, sid);
    assert.equal(out.status, 200);
    assert.match(out.setCookie, /nu_sid=;/, '应清空 cookie');
    // 旧 token 已从 sessions 删除：兼容 guest 接口才会另发游客
    const after = await call('/api/auth/guest');
    assert.equal(after.body.user.guest, true);
    assert.notEqual(after.body.user.id, before.id);
    assert.ok(after.newSid && after.newSid !== sid);
  });
});

describe('注册与登录', () => {
  it('游客注册升级：user id 不变，存档归属保留', async () => {
    const sid = await newGuest();
    const guest = (await me(sid)).body.user;
    const start = await post('/api/games/g00-demo/saves', {}, sid);
    assert.equal(start.status, 201);
    const reg = await post('/api/auth/register', { username: '沈默', password: 'rainy-night-2019' }, sid);
    assert.equal(reg.status, 200);
    assert.equal(reg.body.user.guest, false);
    assert.equal(reg.body.user.id, guest.id, '升级应保留 user id（存档归属不变）');
    const list = await call('/api/saves?gameId=g00-demo', { sid });
    assert.ok(list.body.some(s => s.id === start.body.saveId), '升级后存档应仍可见');
    const dbRow = base.db.prepare('SELECT user_id FROM saves WHERE id = ?').get(start.body.saveId);
    assert.equal(dbRow.user_id, guest.id);
  });

  it('注册校验：用户名 2-24 字符、密码 ≥8 位，非法 400', async () => {
    const sid = await newGuest();
    assert.equal((await post('/api/auth/register', { username: '沈', password: 'longenough' }, sid)).status, 400);
    assert.equal((await post('/api/auth/register', { username: '沈默!', password: 'longenough' }, sid)).status, 400);
    assert.equal((await post('/api/auth/register', { username: '沈默', password: 'short' }, sid)).status, 400);
  });

  it('重复用户名 409；已注册用户再注册 409', async () => {
    const a = await newGuest();
    await post('/api/auth/register', { username: '重名者', password: 'password-1' }, a);
    const b = await newGuest();
    assert.equal((await post('/api/auth/register', { username: '重名者', password: 'password-2' }, b)).status, 409);
    assert.equal((await post('/api/auth/register', { username: '换一个名', password: 'password-1' }, a)).status, 409, '已注册会话不可再注册');
  });

  it('登录切换会话到目标用户；密码错 401；用户不存在与密码错误同响应', async () => {
    const sidA = await newGuest();
    const reg = await post('/api/auth/register', { username: '老彭', password: 'password-1' }, sidA);
    assert.ok(reg.newSid, '注册后应刷新会话 cookie');

    const sidB = await newGuest();
    await post('/api/games/g00-demo/saves', {}, sidB); // B 游客期自己的存档
    const bad = await post('/api/auth/login', { username: '老彭', password: 'wrong-pass' }, sidB);
    assert.equal(bad.status, 401);
    const ghost = await post('/api/auth/login', { username: '不存在的人', password: 'wrong-pass' }, sidB);
    assert.equal(ghost.status, 401);
    assert.equal(ghost.body.error, bad.body.error, '不得泄露「用户是否存在」');

    const ok = await post('/api/auth/login', { username: '老彭', password: 'password-1' }, sidB);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.username, '老彭');
    // 登录后 B 的列表只看得到 A 名下内容，游客期存档不跟过来
    const list = await call('/api/saves?gameId=g00-demo', { sid: ok.newSid });
    assert.deepEqual(list.body, []);
  });
});

describe('存档归属隔离', () => {
  it('无会话操作存档 → 401', async () => {
    assert.equal((await call('/api/saves?gameId=g00-demo')).status, 401);
    assert.equal((await post('/api/games/g00-demo/saves')).status, 401);
    assert.equal((await post('/api/saves/1/advance')).status, 401);
  });

  it('别人的存档：读取/推进/选择/结局一律 404，列表互不可见', async () => {
    const sidA = await newGuest();
    const sidB = await newGuest();
    const start = await post('/api/games/g00-demo/saves', {}, sidA);
    const id = start.body.saveId;
    assert.equal((await call(`/api/saves/${id}`, { sid: sidB })).status, 404);
    assert.equal((await post(`/api/saves/${id}/advance`, {}, sidB)).status, 404);
    assert.equal((await post(`/api/saves/${id}/choose`, { index: 0 }, sidB)).status, 404);
    assert.equal((await call(`/api/saves/${id}/endings`, { sid: sidB })).status, 404);
    const listB = await call('/api/saves?gameId=g00-demo', { sid: sidB });
    assert.deepEqual(listB.body, []);
    const listA = await call('/api/saves?gameId=g00-demo', { sid: sidA });
    assert.ok(listA.body.some(s => s.id === id));
    assert.equal((await call(`/api/saves/${id}`, { sid: sidA })).status, 200);
  });

  it('结局收集按用户隔离：A 通关的结局不进 B 的图鉴', async () => {
    const sidA = await newGuest();
    // A 打到任一结局
    const start = await post('/api/games/g00-demo/saves', {}, sidA);
    let state = start.body.state, guard = 0;
    while (state.kind !== 'ending') {
      assert.ok(++guard < 200);
      const r = state.kind === 'choice'
        ? await post(`/api/saves/${start.body.saveId}/choose`, { index: 0 }, sidA)
        : await post(`/api/saves/${start.body.saveId}/advance`, {}, sidA);
      state = r.body.state;
    }
    const seenA = await call(`/api/saves/${start.body.saveId}/endings`, { sid: sidA });
    assert.equal(seenA.body.length, 1);

    // B 新开一局尚未通关：旧的全库聚合语义会把 A 的结局漏给 B
    const sidB = await newGuest();
    const b = await post('/api/games/g00-demo/saves', {}, sidB);
    const seenB = await call(`/api/saves/${b.body.saveId}/endings`, { sid: sidB });
    assert.deepEqual(seenB.body, [], '结局收集必须按用户隔离');
  });
});
