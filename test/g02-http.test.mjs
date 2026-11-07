// g02 真实 HTTP 通关：发布后每个结局至少一条完整线路。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, setGamePublished } from '../server/db.mjs';
import { loadGames, createApp } from '../server/app.mjs';
import { enumerateRoutes } from '../engine/graph.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const games = loadGames(join(root, 'games'), join(root, 'universe'));
const routes = enumerateRoutes(games['g02-chuxian'].ir);
const base = {};

before(async () => {
  const db = openDb(':memory:');
  migrate(db, join(root, 'server/migrations'));
  setGamePublished(db, 'g02-chuxian', true);
  const server = createApp({ db, games, webDir: join(root, 'web') });
  await new Promise(r => server.listen(0, r));
  base.url = `http://127.0.0.1:${server.address().port}`;
  base.server = server; base.db = db;
  const guest = await fetch(`${base.url}/api/auth/guest`);
  base.sid = guest.headers.get('set-cookie').match(/nu_sid=([^;]+)/)[1];
});
after(() => { base.server.close(); base.db.close(); });

async function post(path, data) {
  const res = await fetch(base.url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `nu_sid=${base.sid}` },
    body: JSON.stringify(data ?? {}),
  });
  return { status: res.status, body: await res.json() };
}

describe('g02《出线之夜》真实 HTTP 结局', () => {
  for (const ending of ['E_FULL', 'E_LEAVE', 'E_WRONG', 'E_RUN']) {
    it(`发布后可完整走到 ${ending}`, async () => {
      const route = routes.find(r => r.ending === ending);
      assert.ok(route, `缺少 ${ending} 路线`);
      const start = await post('/api/games/g02-chuxian/saves', { seed: 7, player: '陈拾' });
      assert.equal(start.status, 201);
      let state = start.body.state;
      const queue = [...route.choices];
      let guard = 0;
      while (state.kind !== 'ending') {
        assert.ok(++guard < 1000);
        const response = state.kind === 'choice'
          ? await post(`/api/saves/${start.body.saveId}/choose`, { index: queue.shift() })
          : await post(`/api/saves/${start.body.saveId}/advance`, {});
        assert.equal(response.status, 200, JSON.stringify(response.body));
        state = response.body.state;
      }
      assert.equal(state.endingId, ending);
    });
  }
});
