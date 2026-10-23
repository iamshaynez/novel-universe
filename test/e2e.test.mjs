// e2e：全分支流程覆盖。
// 方法：用引擎枚举 IR 的全部可玩路径（含守卫模拟），逐条通过真实 HTTP API 从头玩到结局，
// 断言结局正确、存档落库、结局登记——「分支覆盖率 100%」由图枚举保证，而非抽样。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, listEndings } from '../server/db.mjs';
import { loadGames, createApp } from '../server/app.mjs';
import { enumerateRoutes } from '../engine/graph.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 编译与路由枚举是同步纯函数：在收集阶段完成，it() 块据此静态生成
const games = loadGames(join(root, 'test/fixtures/games'), join(root, 'test/fixtures/universe'));
const routes = enumerateRoutes(games['g00-demo'].ir);
const base = {};

before(async () => {
  const db = openDb(':memory:');
  migrate(db, join(root, 'server/migrations'));
  const server = createApp({ db, games, webDir: join(root, 'web') });
  await new Promise(r => server.listen(0, r));
  base.url = `http://127.0.0.1:${server.address().port}`;
  base.server = server; base.db = db;
});
after(() => { base.server.close(); base.db.close(); });

async function post(path, data) {
  const res = await fetch(base.url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
  });
  return { status: res.status, body: await res.json() };
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
      const res = await fetch(`${base.url}/api/saves/${saveId}/endings`);
      const endings = await res.json();
      assert.ok(endings.some(e => e.ending_id === route.ending), 'endings_seen 应登记');
      // 存档持久的 run 快照与该路径 flag 一致
      const saveRes = await fetch(`${base.url}/api/saves/${saveId}`);
      const save = await saveRes.json();
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
