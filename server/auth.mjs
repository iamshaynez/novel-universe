// 认证原语：scrypt 密码哈希 + 不透明会话 token/cookie。零依赖，只碰 node:crypto。
// 会话不签名不入 JWT：token 存库可吊销，进程重启不丢，也免引入 SESSION_SECRET 环境变量。
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = 'nu_sid';
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;

export function newSessionToken() {
  return randomBytes(32).toString('hex');
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** 注册凭据校验：用户名 2-24 字（文字/数字/._-），密码 8-128 位。返回错误消息或 null。 */
export function credentialError({ username, password } = {}) {
  if (typeof username !== 'string') return '用户名缺失';
  const name = username.trim();
  if (name.length < 2 || name.length > 24) return '用户名需 2-24 个字符';
  if (!/^[\p{L}\p{N}._-]+$/u.test(name)) return '用户名只能用文字、数字与 . _ -';
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) return '密码需 8-128 位';
  return null;
}

/** 游客名：游客 + 6 位十六进制；碰撞由调用方查库重试。 */
export function guestUsername() {
  return `游客${randomBytes(3).toString('hex')}`;
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// Secure 标记暂不启用：本地 http demo 与 https 反代共用同一份 cookie 语义，
// 对外仅 https 暴露（runbook 部署章节），HttpOnly + SameSite=Lax 先行。
export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}
export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
