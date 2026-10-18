// HTTP 应用：静态资源 + 游戏 API。node:http 原生，零依赖。
// 设计：服务端驱动引擎（advance/choose 在服务端执行并落库），客户端只渲染状态。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve as resolvePath } from 'node:path';
import { compileGame } from '../tools/compile-scenario.mjs';
import { createRun, advance, choose, stateOf, loadRun } from '../engine/state.mjs';
import { validateGraph } from '../engine/graph.mjs';
import {
  createSave, getSave, listSaves, updateSave, recordEnding, listEndings,
} from './db.mjs';

export function loadGames(gamesRoot, universeDir) {
  const games = {};
  for (const name of readdirSync(gamesRoot).sort()) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const dir = join(gamesRoot, name);
    if (!existsSync(join(dir, 'game.json'))) continue;
    const { ir, manifest } = compileGame(dir, universeDir);
    const errs = validateGraph(ir);
    if (errs.length) throw new Error(`游戏 ${name} 图校验失败:\n${errs.join('\n')}`);
    games[ir.id] = { ir, manifest };
  }
  return games;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.wav': 'audio/wav',
};

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  if (text.length > 1e6) throw httpError(413, '请求体过大');
  try { return JSON.parse(text); } catch { throw httpError(400, '请求体不是合法 JSON'); }
}

export function createApp({ db, games, webDir, assetsDir }) {
  async function serveStatic(res, pathname) {
    let file = null;
    if (pathname === '/') file = join(webDir, 'index.html');
    else if (pathname.startsWith('/assets/')) {
      const rel = pathname.slice('/assets/'.length);
      file = resolvePath(join(assetsDir, rel));
      if (!file.startsWith(resolvePath(assetsDir))) throw httpError(403, '路径越界');
    } else {
      file = resolvePath(join(webDir, pathname.slice(1)));
      if (!file.startsWith(resolvePath(webDir))) throw httpError(403, '路径越界');
    }
    if (!file || !existsSync(file)) throw httpError(404, `未找到 ${pathname}`);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  }

  function loadRunOf(saveId) {
    const row = getSave(db, saveId);
    if (!row) throw httpError(404, `存档不存在 ${saveId}`);
    return { row, run: loadRun(row.run_json) };
  }
  function persist(saveId, run) {
    updateSave(db, saveId, run);
    if (run.ended) recordEnding(db, saveId, run.ended);
  }

  async function api(req, res, pathname, query) {
    const [,, a, b, c] = pathname.split('/'); // 跳过 '' 与 'api'

    if (req.method === 'GET' && a === 'games' && !b) {
      return json(res, 200, Object.values(games).map(g => ({
        id: g.ir.id, code: g.ir.code, title: g.ir.title, subtitle: g.ir.subtitle,
        chapters: g.ir.chapters, endings: g.ir.endings,
      })));
    }
    if (req.method === 'GET' && a === 'games' && b && !c) {
      const g = games[b];
      if (!g) throw httpError(404, `游戏不存在 ${b}`);
      return json(res, 200, { id: g.ir.id, code: g.ir.code, title: g.ir.title, subtitle: g.ir.subtitle,
        chapters: g.ir.chapters, endings: g.ir.endings, ir: g.ir });
    }
    if (req.method === 'POST' && a === 'games' && b && c === 'saves') {
      const g = games[b];
      if (!g) throw httpError(404, `游戏不存在 ${b}`);
      const body = await readBody(req);
      const run = createRun(g.ir, body.seed ?? Math.floor(Math.random() * 1e9));
      const saveId = createSave(db, g.ir.id, body.player, run);
      return json(res, 201, { saveId, state: stateOf(g.ir, run) });
    }
    if (req.method === 'GET' && a === 'saves' && !b && query.get('gameId')) {
      return json(res, 200, listSaves(db, query.get('gameId')));
    }
    if (req.method === 'GET' && a === 'saves' && b && !c) {
      const { row, run } = loadRunOf(Number(b));
      const g = games[row.game_id];
      return json(res, 200, { save: { id: row.id, gameId: row.game_id, player: row.player, ended: row.ended, updatedAt: row.updated_at }, state: stateOf(g.ir, run) });
    }
    if (req.method === 'POST' && a === 'saves' && b && c === 'advance') {
      const { row, run } = loadRunOf(Number(b));
      const g = games[row.game_id];
      const next = advance(run, g.ir);
      persist(row.id, next);
      return json(res, 200, { state: stateOf(g.ir, next) });
    }
    if (req.method === 'POST' && a === 'saves' && b && c === 'choose') {
      const body = await readBody(req);
      if (!Number.isInteger(body.index)) throw httpError(400, 'index 必须是整数');
      const { row, run } = loadRunOf(Number(b));
      const g = games[row.game_id];
      let next;
      try {
        next = choose(run, g.ir, body.index);
      } catch (e) {
        throw httpError(409, e.message);
      }
      persist(row.id, next);
      return json(res, 200, { state: stateOf(g.ir, next) });
    }
    if (req.method === 'GET' && a === 'saves' && b && c === 'endings') {
      const { row } = loadRunOf(Number(b));
      return json(res, 200, listEndings(db, row.id));
    }
    throw httpError(404, `无此路由 ${req.method} ${pathname}`);
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const pathname = decodeURIComponent(url.pathname);
    try {
      if (pathname.startsWith('/api/')) return await api(req, res, pathname, url.searchParams);
      return await serveStatic(res, pathname);
    } catch (e) {
      json(res, e.status ?? 500, { error: e.message });
    }
  });
}
