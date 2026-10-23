// API 集成测试：真实 HTTP（node:http 监听随机端口 + fetch）。
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
  base.server = server;
  base.db = db;
});
after(() => { base.server.close(); base.db.close(); });

const j = async (path, opts) => {
  const res = await fetch(base.url + path, opts);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
};
const post = (path, data) => j(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {}) });

describe('游戏 API', () => {
  it('GET /api/games 列出 g00', async () => {
    const { status, body } = await j('/api/games');
    assert.equal(status, 200);
    assert.ok(body.some(g => g.id === 'g00-demo' && g.title === '雨夜来信'));
  });

  it('GET /api/games/g00-demo 返回含 IR 与 3 个结局', async () => {
    const { body } = await j('/api/games/g00-demo');
    assert.equal(body.endings.length, 3);
    assert.ok(body.ir.nodes[body.ir.entry]);
  });

  it('未知游戏 404', async () => {
    const { status } = await j('/api/games/nope');
    assert.equal(status, 404);
  });
});

describe('存档 API', () => {
  it('建档 → 开局是台词且带视图', async () => {
    const { status, body } = await post('/api/games/g00-demo/saves', { player: 'API测试' });
    assert.equal(status, 201);
    base.saveId = body.saveId;
    assert.equal(body.state.kind, 'line');
    assert.equal(body.state.view.bg.id, 'rooftop');
  });

  it('advance 推进剧情并落库', async () => {
    const { body } = await post(`/api/saves/${base.saveId}/advance`);
    assert.equal(body.state.kind, 'line');
    const got = await j(`/api/saves/${base.saveId}`);
    assert.notEqual(got.body.state.text, undefined);
  });

  it('advance 到选项点后，choose 生效', async () => {
    let s;
    do { s = (await post(`/api/saves/${base.saveId}/advance`)).body.state; } while (s.kind === 'line');
    assert.equal(s.kind, 'choice');
    assert.equal(s.options.length, 2);
    const c = await post(`/api/saves/${base.saveId}/choose`, { index: 1 });
    assert.equal(c.status, 200);
    assert.equal(c.body.state.flags['fact.ev-rooftop-2019'], true, '选「问过去」应置正典 flag');
  });

  it('非法 index → 409/400；非整数 → 400', async () => {
    const bad = await post(`/api/saves/${base.saveId}/choose`, { index: 99 });
    assert.equal(bad.status, 409);
    const nan = await post(`/api/saves/${base.saveId}/choose`, { index: 'x' });
    assert.equal(nan.status, 400);
  });

  it('存档列表按游戏过滤', async () => {
    const { body } = await j('/api/saves?gameId=g00-demo');
    assert.ok(body.length >= 1);
    const empty = await j('/api/saves?gameId=nope');
    assert.deepEqual(empty.body, []);
  });

  it('不存在的存档 404', async () => {
    const { status } = await j('/api/saves/99999');
    assert.equal(status, 404);
  });
});

describe('静态资源与安全', () => {
  it('GET / 返回页面', async () => {
    const res = await fetch(base.url + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });

  it('路径穿越被拒', async () => {
    const res = await fetch(base.url + '/%2e%2e/%2e%2e/package.json');
    assert.ok([403, 404].includes(res.status));
  });
});
