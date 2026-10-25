// HTTP 应用：静态资源 + 游戏 API。node:http 原生，零依赖。
// 设计：服务端驱动引擎（advance/choose 在服务端执行并落库），客户端只渲染状态。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { extname, join, resolve as resolvePath } from 'node:path';
import { compileGame } from '../tools/compile-scenario.mjs';
import { createRun, advance, choose, stateOf, loadRun, submit } from '../engine/state.mjs';
import { validateGraph } from '../engine/graph.mjs';
import {
  createSave, getSave, listSaves, updateSave, recordEnding, listEndingsByGame, recordCards, listCards,
  createUser, getUserByName, setUserCredentials, createSession, getSessionUser,
  refreshSession, deleteSession, purgeExpiredSessions,
} from './db.mjs';
import {
  SESSION_COOKIE, SESSION_TTL_SECONDS, newSessionToken, hashPassword, verifyPassword,
  credentialError, guestUsername, parseCookies, sessionCookie, clearSessionCookie,
} from './auth.mjs';

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
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
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

export function createApp({ db, games, webDir }) {
  async function serveStatic(res, pathname) {
    let file = null;
    if (pathname === '/') file = join(webDir, 'index.html');
    else {
      file = resolvePath(join(webDir, pathname.slice(1)));
      if (!file.startsWith(resolvePath(webDir))) throw httpError(403, '路径越界');
    }
    if (!file || !existsSync(file)) throw httpError(404, `未找到 ${pathname}`);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  }

  function loadRunOf(saveId, userId) {
    const row = getSave(db, saveId);
    // 归属不符一律 404：不向他人泄露存档 ID 的存在性
    if (!row || row.user_id !== userId) throw httpError(404, `存档不存在 ${saveId}`);
    return { row, run: loadRun(row.run_json) };
  }
  function persist(row, run) {
    updateSave(db, row.id, run);
    if (run.ended) recordEnding(db, row.id, run.ended);
    recordCards(db, row.user_id, row.game_id, run.flags); // 图鉴入档随进度同步（幂等）
  }

  // ---- 会话（游客优先：me 自动发游客；其余存档操作要求已持有会话）----
  const publicUser = u => ({ id: u.id, username: u.username, guest: u.password_hash == null });
  function currentUser(req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const user = getSessionUser(db, token);
    if (!user) return null;
    refreshSession(db, token, SESSION_TTL_SECONDS); // 滑动续期
    return user;
  }
  function startSession(res, userId) {
    const token = newSessionToken();
    purgeExpiredSessions(db);
    createSession(db, userId, token, SESSION_TTL_SECONDS);
    res.setHeader('Set-Cookie', sessionCookie(token));
    return token;
  }
  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw httpError(401, '没有会话，请先访问 /api/auth/me');
    return user;
  }
  function createGuestUser() {
    for (let i = 0; i < 3; i++) {
      const name = guestUsername();
      if (getUserByName(db, name)) continue;
      return { id: createUser(db, name, null), username: name, password_hash: null };
    }
    throw httpError(500, '游客名生成失败');
  }

  async function api(req, res, pathname, query) {
    const [,, a, b, c] = pathname.split('/'); // 跳过 '' 与 'api'

    // ---- 认证 ----
    if (req.method === 'GET' && a === 'auth' && b === 'me' && !c) {
      let user = currentUser(req);
      if (!user) { user = createGuestUser(); startSession(res, user.id); }
      return json(res, 200, { user: publicUser(user) });
    }
    if (req.method === 'POST' && a === 'auth' && b === 'register' && !c) {
      const body = await readBody(req);
      const err = credentialError(body);
      if (err) throw httpError(400, err);
      const username = body.username.trim();
      const passwordHash = await hashPassword(body.password);
      if (getUserByName(db, username)) throw httpError(409, '用户名已被占用');
      const cur = currentUser(req);
      if (cur && cur.password_hash) throw httpError(409, '当前会话已注册，请直接登录');
      // 游客升级：补录凭据、保 user id，存档归属原样保留；匿名直注册：新建用户
      let user;
      if (cur) {
        setUserCredentials(db, cur.id, username, passwordHash);
        user = { ...cur, username, password_hash: passwordHash };
      } else {
        user = { id: createUser(db, username, passwordHash), username, password_hash: passwordHash };
      }
      startSession(res, user.id); // 身份升级换 token，防会话固定
      return json(res, 200, { user: publicUser(user) });
    }
    if (req.method === 'POST' && a === 'auth' && b === 'login' && !c) {
      const body = await readBody(req);
      const user = typeof body?.username === 'string' ? getUserByName(db, body.username.trim()) : null;
      const ok = user?.password_hash && await verifyPassword(String(body?.password ?? ''), user.password_hash);
      if (!ok) throw httpError(401, '用户名或密码错误');
      const old = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (old) deleteSession(db, old);
      startSession(res, user.id);
      return json(res, 200, { user: publicUser(user) });
    }
    if (req.method === 'POST' && a === 'auth' && b === 'logout' && !c) {
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) deleteSession(db, token);
      res.setHeader('Set-Cookie', clearSessionCookie());
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && a === 'games' && !b) {
      return json(res, 200, Object.values(games).map(g => ({
        id: g.ir.id, code: g.ir.code, title: g.ir.title, subtitle: g.ir.subtitle, hook: g.ir.hook,
        chapters: g.ir.chapters, endings: g.ir.endings,
      })));
    }
    if (req.method === 'GET' && a === 'games' && b && !c) {
      const g = games[b];
      if (!g) throw httpError(404, `游戏不存在 ${b}`);
      return json(res, 200, { id: g.ir.id, code: g.ir.code, title: g.ir.title, subtitle: g.ir.subtitle, hook: g.ir.hook,
        chapters: g.ir.chapters, endings: g.ir.endings, ir: g.ir });
    }
    if (req.method === 'GET' && a === 'games' && b && c === 'cards') {
      // 图鉴：玩家级已入档键（跨存档），面板据此渲染收集态
      const g = games[b];
      if (!g) throw httpError(404, `游戏不存在 ${b}`);
      const user = requireUser(req);
      return json(res, 200, listCards(db, user.id, g.ir.id));
    }
    if (req.method === 'GET' && a === 'games' && b && c === 'endings') {
      // 结局档案：用户 × 游戏级收集（标题页/结局卡回读入口，无需挂靠某个存档）
      const g = games[b];
      if (!g) throw httpError(404, `游戏不存在 ${b}`);
      const user = requireUser(req);
      return json(res, 200, listEndingsByGame(db, g.ir.id, user.id));
    }
    if (req.method === 'POST' && a === 'games' && b && c === 'saves') {
      const g = games[b];
      if (!g) throw httpError(404, `游戏不存在 ${b}`);
      const user = requireUser(req);
      const body = await readBody(req);
      const run = createRun(g.ir, body.seed ?? Math.floor(Math.random() * 1e9));
      const saveId = createSave(db, g.ir.id, body.player ?? user.username, run, user.id);
      recordCards(db, user.id, g.ir.id, run.flags); // 开局即入档（入口节点携带的 card.* flag）
      return json(res, 201, { saveId, state: stateOf(g.ir, run) });
    }
    if (req.method === 'GET' && a === 'saves' && !b && query.get('gameId')) {
      const user = requireUser(req);
      return json(res, 200, listSaves(db, query.get('gameId'), user.id));
    }
    if (req.method === 'GET' && a === 'saves' && b && !c) {
      const user = requireUser(req);
      const { row, run } = loadRunOf(Number(b), user.id);
      const g = games[row.game_id];
      return json(res, 200, { save: { id: row.id, gameId: row.game_id, player: row.player, ended: row.ended, updatedAt: row.updated_at }, state: stateOf(g.ir, run) });
    }
    if (req.method === 'POST' && a === 'saves' && b && c === 'advance') {
      const user = requireUser(req);
      const body = await readBody(req);
      const { row, run } = loadRunOf(Number(b), user.id);
      const g = games[row.game_id];
      // 转写停点：advance 携带 {text} 走 submit；无 text 时不推进（幂等重取状态）
      if (stateOf(g.ir, run).kind === 'transcribe') {
        if (typeof body.text !== 'string') return json(res, 200, { state: stateOf(g.ir, run) });
        const next = submit(run, g.ir, body.text);
        persist(row, next);
        return json(res, 200, { state: stateOf(g.ir, next) });
      }
      const next = advance(run, g.ir);
      persist(row, next);
      return json(res, 200, { state: stateOf(g.ir, next) });
    }
    if (req.method === 'POST' && a === 'saves' && b && c === 'choose') {
      const user = requireUser(req);
      const body = await readBody(req);
      if (!Number.isInteger(body.index)) throw httpError(400, 'index 必须是整数');
      const { row, run } = loadRunOf(Number(b), user.id);
      const g = games[row.game_id];
      let next;
      try {
        next = choose(run, g.ir, body.index);
      } catch (e) {
        throw httpError(409, e.message);
      }
      persist(row, next);
      return json(res, 200, { state: stateOf(g.ir, next) });
    }
    if (req.method === 'GET' && a === 'saves' && b && c === 'endings') {
      const user = requireUser(req);
      const { row } = loadRunOf(Number(b), user.id);
      return json(res, 200, listEndingsByGame(db, row.game_id, user.id));
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
