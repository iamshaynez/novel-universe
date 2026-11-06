// 受控管理员初始化：只允许离线命令调用，不提供 HTTP 创建入口。
import { credentialError, hashPassword } from './auth.mjs';
import { createUser, getUserByName, setUserCredentials } from './db.mjs';

export async function upsertAdmin(db, password) {
  const err = credentialError({ username: 'admin', password });
  if (err) throw new Error(err);
  const passwordHash = await hashPassword(password);
  const existing = getUserByName(db, 'admin');
  if (existing) {
    setUserCredentials(db, existing.id, 'admin', passwordHash);
    return existing.id;
  }
  return createUser(db, 'admin', passwordHash);
}
