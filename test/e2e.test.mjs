// e2e：全分支流程覆盖。
// 方法：用引擎枚举 IR 的全部可玩路径（含守卫模拟），逐条通过真实 HTTP API 从头玩到结局，
// 断言结局正确、存档落库、结局登记——「分支覆盖率 100%」由图枚举保证，而非抽样。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from '../server/db.mjs';
import { loadGames, createApp } from '../server/app.mjs';
import { enumerateRoutes } from '../engine/graph.mjs';
import { createRun, advance, choose, stateOf } from '../engine/state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 编译与路由枚举是同步纯函数：在收集阶段完成，it() 块据此静态生成
const games = loadGames(join(root, 'test/fixtures/games'), join(root, 'test/fixtures/universe'));
const realGames = loadGames(join(root, 'games'), join(root, 'universe'));
const routes = enumerateRoutes(games['g00-demo'].ir);
const base = {};

before(async () => {
  const db = openDb(':memory:');
  migrate(db, join(root, 'server/migrations'));
  const server = createApp({ db, games: { ...games, ...realGames }, webDir: join(root, 'web') });
  await new Promise(r => server.listen(0, r));
  base.url = `http://127.0.0.1:${server.address().port}`;
  base.server = server; base.db = db;
  const boot = await fetch(base.url + '/api/auth/me');
  base.sid = boot.headers.get('set-cookie').match(/nu_sid=([^;]+)/)[1];
});
after(() => { base.server.close(); base.db.close(); });

const cookie = () => ({ Cookie: `nu_sid=${base.sid}` });
async function post(path, data) {
  const res = await fetch(base.url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...cookie() },
    body: JSON.stringify(data ?? {}),
  });
  return { status: res.status, body: await res.json() };
}
async function get(path) {
  const res = await fetch(base.url + path, { headers: cookie() });
  return res.json();
}

describe('e2e：g00《雨夜来信》全分支', () => {
  it('静态枚举出 5 条路径（这是覆盖基线，不是抽样）', () => {
    assert.equal(routes.length, 5);
  });

  for (const route of routes) {
    it(`路径 [${route.choices.join('→')}] 走到结局 ${route.ending}`, async () => {
      const start = await post('/api/games/g00-demo/saves', { player: `e2e-${route.choices.join('')}` });
      assert.equal(start.status, 201);
      const saveId = start.body.saveId;
      let state = start.body.state;
      const queue = [...route.choices];
      let guard = 0;

      while (state.kind !== 'ending') {
        assert.ok(++guard < 200, '步数超限，疑似卡死');
        if (state.kind === 'choice') {
          const idx = queue.shift();
          const r = await post(`/api/saves/${saveId}/choose`, { index: idx });
          assert.equal(r.status, 200, `choose(${idx}) 失败: ${JSON.stringify(r.body)}`);
          state = r.body.state;
        } else {
          const r = await post(`/api/saves/${saveId}/advance`);
          assert.equal(r.status, 200);
          state = r.body.state;
        }
      }

      assert.equal(state.endingId, route.ending, '结局应与静态枚举一致');
      // 结局落库
      const endings = await get(`/api/saves/${saveId}/endings`);
      assert.ok(endings.some(e => e.ending_id === route.ending), 'endings_seen 应登记');
      // 存档持久的 run 快照与该路径 flag 一致
      const save = await get(`/api/saves/${saveId}`);
      assert.equal(save.state.endingId, route.ending);
      for (const [k, v] of Object.entries(route.flags)) {
        assert.equal(save.state.flags[k], v, `flag ${k} 应持久化`);
      }
    });
  }

  it('3 个结局全部被至少一条路径触达（结局覆盖率 100%）', () => {
    const hit = new Set(routes.map(r => r.ending));
    const declared = games['g00-demo'].ir.endings.map(e => e.id);
    for (const e of declared) assert.ok(hit.has(e), `结局 ${e} 未被任何路径触达`);
  });

  it('同一路径重玩两次，结局与最终状态完全一致（确定性回放）', async () => {
    const play = async () => {
      const s = await post('/api/games/g00-demo/saves', { player: 'determinism', seed: 7 });
      let state = s.body.state;
      const seq = [1, 1, 0];
      let guard = 0;
      while (state.kind !== 'ending') {
        assert.ok(++guard < 200);
        const r = state.kind === 'choice'
          ? await post(`/api/saves/${s.body.saveId}/choose`, { index: seq.shift() })
          : await post(`/api/saves/${s.body.saveId}/advance`);
        state = r.body.state;
      }
      return [state.endingId, JSON.stringify(state.flags)].join('|');
    };
    assert.equal(await play(), await play());
  });
});


// ---- g01《接线员》：全路径引擎级断言 + 每结局一条真实 HTTP 线路（含转写提交）----
describe('e2e：g01《接线员》', () => {
  const g01 = realGames['g01-jiexianyuan'];
  const routes = enumerateRoutes(g01.ir);

  it('全路径枚举健康：无死路断路，E1/E2/E3 全部可达', () => {
    assert.ok(routes.length > 0);
    const dead = routes.filter(r => r.ending.startsWith('__'));
    assert.equal(dead.length, 0, `死路 ${dead.length} 条`);
    const endings = new Set(routes.map(r => r.ending));
    for (const e of ['E1', 'E2', 'E3']) assert.ok(endings.has(e), `结局 ${e} 不可达`);
  });

  it('E1 门禁成立：can_indict 缺席的路径永远到不了 E1', () => {
    const e1Routes = routes.filter(r => r.ending === 'E1');
    assert.ok(e1Routes.length > 0);
    for (const r of e1Routes) assert.ok(r.flags.can_indict, 'E1 路径应带 can_indict');
    for (const r of routes) {
      if (r.flags.no_copy) assert.notEqual(r.ending, 'E1', '无副本的尝试不得直接成为完整 E1');
      if (r.flags.copy_locker || r.flags.copy_dj) assert.ok(r.flags.can_indict, '安全副本应解锁 E1');
    }
  });

  // 三个结局各取一条代表路径，走真实 HTTP（转写停点自动提交 target）
  const picks = ['E1', 'E2', 'E3'].map(e => ({ e, route: routes.find(r => r.ending === e) }));

  for (const { e, route } of picks) {
    it(`真实线路打到结局 ${e}（选择序列 ${route.choices.join('→')}）`, async () => {
      const start = await post('/api/games/g01-jiexianyuan/saves', { player: `e2e-${e}` });
      assert.equal(start.status, 201);
      const saveId = start.body.saveId;
      let state = start.body.state;
      const queue = [...route.choices];
      let guard = 0, trCount = 0;
      while (state.kind !== 'ending') {
        assert.ok(++guard < 1200, '步数超限，疑似卡死');
        if (state.kind === 'choice') {
          const r = await post(`/api/saves/${saveId}/choose`, { index: queue.shift() });
          assert.equal(r.status, 200, `choose 失败: ${JSON.stringify(r.body)}`);
          state = r.body.state;
        } else if (state.kind === 'transcribe') {
          // 玩家只做选择题：先故意听岔一次（若有干扰项），再选正确项
          const badIdx = state.options.findIndex(o => o !== state.target);
          if (badIdx >= 0) {
            const bad = await post(`/api/saves/${saveId}/advance`, { pick: badIdx });
            assert.equal(bad.body.state.kind, 'transcribe', '错误转写不得推进');
          }
          const r = await post(`/api/saves/${saveId}/advance`, { pick: state.options.indexOf(state.target) });
          assert.equal(r.status, 200);
          assert.notEqual(r.body.state.id, state.id, '正确转写应离开停点');
          state = r.body.state;
          trCount++;
        } else {
          const r = await post(`/api/saves/${saveId}/advance`);
          assert.equal(r.status, 200);
          state = r.body.state;
        }
      }
      assert.equal(state.endingId, e);
      const save = await get(`/api/saves/${saveId}`);
      const trFlags = Object.keys(save.state.flags).filter(k => k.startsWith('tr.'));
      assert.ok(trCount >= 8, `该线路转写应≥8 次，实际 ${trCount}`);
      assert.equal(trFlags.length, trCount, 'tr.* flag 应与转写次数一致并持久化');
    });
  }
});
