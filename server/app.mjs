// HTTP 应用：静态资源 + 游戏 API。node:http 原生，零依赖。
// 设计：服务端驱动引擎（advance/choose 在服务端执行并落库），客户端只渲染状态。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { extname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';
import { createRun, advance, choose, stateOf, loadRun, submitPick } from '../engine/state.mjs';
import { validateGraph } from '../engine/graph.mjs';
import { buildOfflineManifest } from './content.mjs';
import { syncFor, validDoc } from './sync.mjs';
import {
  createSave, getSave, listSaves, updateSave, recordEnding, listEndingsByGame, recordCards, listCards,
  createUser, getUserByName, setUserCredentials, createSession, getSessionUser,
  refreshSession, deleteSession, purgeExpiredSessions,
} from './db.mjs';
import {
  SESSION_COOKIE, SESSION_TTL_SECONDS, newSessionToken, hashPassword, verifyPassword,
  credentialError, guestUsername, parseCookies, sessionCookie, clearSessionCookie,
} from './auth.mjs';

// ---- 版本指纹（footer 部署追踪）：package 版本 + git sha + 起服时刻。
// sha 兜底链：env NU_SHA（Dockerfile ARG 注入）→ git（源码直跑）→ snapshot（无 .git 的镜像）。
const BOOT_AT = new Date();
const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const detectSha = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: fileURLToPath(new URL('..', import.meta.url)) }).toString().trim();
  } catch {
    return process.env.NU_SHA ?? 'snapshot';
  }
};
const GIT_SHA = detectSha();

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
  '.webmanifest': 'application/manifest+json; charset=utf-8',
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

export function createApp({ db, games, webDir, engineDir = fileURLToPath(new URL('../engine', import.meta.url)) }) {
  const offline = buildOfflineManifest({ games, webDir, engineDir });
  const bundle = offline.bundle;
  const swTemplate = readFileSync(join(webDir, 'sw.js'), 'utf8');
  async function serveStatic(res, pathname, req, rootDir = webDir) {
    let file = null;
    if (pathname === '/') file = join(rootDir, 'index.html');
    else {
      file = resolvePath(join(rootDir, pathname.slice(1)));
      if (!file.startsWith(resolvePath(rootDir))) throw httpError(403, '路径越界');
    }
    if (!file || !existsSync(file)) throw httpError(404, `未找到 ${pathname}`);
    // no-cache = 每次回源校验（部署必达手机）；ETag/304 让校验零成本。
    // 前端零打包直出，静态层绝不给可过期的宽限。
    const st = await stat(file);
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    if (req?.headers?.['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ETag: etag,
    });
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

    // ---- 版本指纹（无需会话）：footer 部署追踪 ----
    if (req.method === 'GET' && a === 'version' && !b) {
      return json(res, 200, { version: PKG_VERSION, sha: GIT_SHA, bundle, boot: BOOT_AT.toISOString(), now: new Date().toISOString() });
    }

    // ---- 同步信箱：只有已注册账号可写；游客由客户端本地优先，兼容期另行导入 ----
    if (req.method === 'POST' && a === 'sync' && !b) {
      const user = requireUser(req);
      if (!user.password_hash) throw httpError(403, '游客进度只存本机，请先注册以同步');
      const body = await readBody(req);
      if (body.protocol !== 1 || typeof body.deviceId !== 'string' || body.deviceId.length > 100) throw httpError(400, '同步协议或设备标识无效');
      if (!Array.isArray(body.push) || body.push.length > 50 || body.push.some(doc => !validDoc(doc))) throw httpError(413, '同步文档过大或格式无效');
      return json(res, 200, syncFor(db, user.id, body));
    }

    // ---- 认证 ----
    // 兼容接口：旧客户端/旧游客数据迁移专用；新播放器不为游客建立服务端身份。
    if (req.method === 'GET' && a === 'auth' && b === 'guest' && !c) {
      let user = currentUser(req);
      if (!user) { user = createGuestUser(); startSession(res, user.id); }
      return json(res, 200, { user: publicUser(user) });
    }
    if (req.method === 'GET' && a === 'auth' && b === 'me' && !c) {
      const user = currentUser(req);
      return json(res, 200, { user: user ? publicUser(user) : null });
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
      return json(res, 200, { save: { id: row.id, gameId: row.game_id, player: row.player, ended: row.ended, updatedAt: row.updated_at }, run, state: stateOf(g.ir, run) });
    }
    if (req.method === 'POST' && a === 'saves' && b && c === 'advance') {
      const user = requireUser(req);
      const body = await readBody(req);
      const { row, run } = loadRunOf(Number(b), user.id);
      const g = games[row.game_id];
      // 转写停点：advance 携带 {pick} 走 submitPick（玩家只做选择题）；无 pick 时不推进（幂等重取状态）
      if (stateOf(g.ir, run).kind === 'transcribe') {
        if (!Number.isInteger(body.pick)) return json(res, 200, { state: stateOf(g.ir, run) });
        let next;
        try {
          next = submitPick(run, g.ir, body.pick);
        } catch (e) {
          throw httpError(409, e.message);
        }
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
      if (pathname === '/sw.js') {
        const body = swTemplate
          .replace('"/*__NU_BUNDLE__*/"', JSON.stringify(bundle))
          .replace('/*__NU_PRECACHE__*/[]', JSON.stringify(offline.entries));
        res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache' });
        return res.end(body);
      }
      if (pathname === '/content/catalog.json') {
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache' });
        return res.end(JSON.stringify(offline.games));
      }
      if (pathname.startsWith('/content/')) {
        const game = offline.games.find(g => g.irUrl === pathname);
        if (!game) throw httpError(404, '内容版本不存在');
        res.writeHead(200, {
          'Content-Type': MIME['.json'],
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: `"${game.irHash}"`,
        });
        return res.end(JSON.stringify(games[game.id].ir));
      }
      if (pathname.startsWith('/engine/')) return await serveStatic(res, pathname.slice('/engine'.length), req, engineDir);
      return await serveStatic(res, pathname, req);
    } catch (e) {
      json(res, e.status ?? 500, { error: e.message });
    }
  });
}
