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
  // 播放器 boot 合同：先 me 建立会话（游客），此后所有存档操作带 cookie
  const boot = await fetch(base.url + '/api/auth/me');
  base.sid = boot.headers.get('set-cookie').match(/nu_sid=([^;]+)/)[1];
});
after(() => { base.server.close(); base.db.close(); });

const j = async (path, opts = {}) => {
  const res = await fetch(base.url + path, { ...opts, headers: { ...opts.headers, Cookie: `nu_sid=${base.sid}` } });
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

  it('结局收集是玩家级：同一用户两个存档各通一个结局，任一存档都能看到两个', async () => {
    // 玩家的收集进度不该因为「再来一局」清零——那是收集型三结局的命根；
    // 但收集范围是「用户 × 游戏」，跨用户不得串档（auth.test 另有隔离用例）
    const walk = async choices => {
      const start = await post('/api/games/g00-demo/saves', { player: 'collect' });
      let state = start.body.state, queue = [...choices], guard = 0;
      while (state.kind !== 'ending') {
        assert.ok(++guard < 200);
        const r = state.kind === 'choice'
          ? await post(`/api/saves/${start.body.saveId}/choose`, { index: queue.shift() ?? 0 })
          : await post(`/api/saves/${start.body.saveId}/advance`);
        state = r.body.state;
      }
      return { saveId: start.body.saveId, ending: state.endingId };
    };
    const a = await walk([0, 0]);        // END_WAIT
    const b = await walk([1, 1, 0]);     // END_TRUTH
    assert.notEqual(a.ending, b.ending, '两条序列应打到不同结局');
    for (const id of [a.saveId, b.saveId]) {
      const { body } = await j(`/api/saves/${id}/endings`);
      const ids = body.map(e => e.ending_id);
      assert.ok(ids.includes(a.ending) && ids.includes(b.ending), `存档 ${id} 应看到两个结局，实际 ${ids}`);
    }
  });
});

describe('静态资源与安全', () => {
  it('GET / 返回页面', async () => {
    const res = await fetch(base.url + '/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });

  it('静态资源带 no-cache：部署后手机不得吃到过期缓存（footer 追踪的前提）', async () => {
    const res = await fetch(base.url + '/');
    assert.match(res.headers.get('cache-control') ?? '', /no-cache/i);
  });

  it('静态资源带 ETag，If-None-Match 回源得 304（no-cache 的零成本校验）', async () => {
    const first = await fetch(base.url + '/');
    const etag = first.headers.get('etag');
    assert.ok(etag, '首响应必须带 ETag');
    const revalidate = await fetch(base.url + '/', { headers: { 'If-None-Match': etag } });
    assert.equal(revalidate.status, 304, '内容未变时回源应 304');
    assert.match(revalidate.headers.get('cache-control') ?? '', /no-cache/i);
  });

  it('路径穿越被拒', async () => {
    const res = await fetch(base.url + '/%2e%2e/%2e%2e/package.json');
    assert.ok([403, 404].includes(res.status));
  });
});

describe('版本指纹（footer 部署追踪）', () => {
  it('GET /api/version 返回版本、sha、起服与当前时间', async () => {
    const { status, body } = await j('/api/version');
    assert.equal(status, 200);
    assert.match(body.version, /^\d+\.\d+\.\d+$/, 'semver 版本号');
    assert.ok(typeof body.sha === 'string' && body.sha.length >= 4, 'sha 或其兜底');
    assert.ok(!Number.isNaN(Date.parse(body.boot)), '起服时间可解析');
    assert.ok(!Number.isNaN(Date.parse(body.now)), '服务器时间可解析');
    assert.ok(Date.parse(body.boot) <= Date.parse(body.now), '起服不晚于当前');
  });
});

describe('游戏元数据与结局档案', () => {
  it('游戏列表与详情携带封面钩子 hook', async () => {
    const list = await j('/api/games');
    const g00 = list.body.find(g => g.id === 'g00-demo');
    assert.equal(typeof g00.hook, 'string');
    const detail = await j('/api/games/g00-demo');
    assert.equal(detail.body.hook, g00.hook);
  });

  it('GET /api/games/:id/endings：无会话 401；有会话返回本人收集', async () => {
    assert.equal((await fetch(base.url + '/api/games/g00-demo/endings')).status, 401);
    const mine = await j('/api/games/g00-demo/endings');
    assert.equal(mine.status, 200);
    // 本套件先前的用例已用同一会话通到两个结局——玩家级聚合应原样可见
    const ids = mine.body.map(e => e.ending_id);
    assert.ok(ids.includes('END_WAIT') && ids.includes('END_TRUTH'), `应含先前收集，实际 ${ids}`);
    assert.equal((await j('/api/games/nope/endings')).status, 404);
  });
});

describe('图鉴：时代词条与人物档案', () => {
  it('GET /api/games/:id/cards：无会话 401；入档跨存档持久（玩家级）', async () => {
    assert.equal((await fetch(base.url + '/api/games/g00-demo/cards')).status, 401);
    const mine = await j('/api/games/g00-demo/cards');
    assert.equal(mine.status, 200);
    assert.ok(mine.body.includes('char.momo'), '先前对局的人物自动入档应持久化');
  });
});
