import { it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, getUserByName } from '../server/db.mjs';
import { upsertAdmin } from '../server/admin.mjs';
import { verifyPassword } from '../server/auth.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

it('admin 只能受控创建或重置，不生成默认密码', async () => {
  const db = openDb(':memory:');
  migrate(db, join(root, 'server/migrations'));
  try {
    await assert.rejects(() => upsertAdmin(db, 'short'), /密码/);
    assert.equal(getUserByName(db, 'admin'), null);
    const id = await upsertAdmin(db, 'password-123');
    const created = getUserByName(db, 'admin');
    assert.equal(created.id, id);
    assert.equal(await verifyPassword('password-123', created.password_hash), true);
    await upsertAdmin(db, 'new-password-456');
    const reset = getUserByName(db, 'admin');
    assert.equal(reset.id, id, '重置密码不另建 admin 用户');
    assert.equal(await verifyPassword('new-password-456', reset.password_hash), true);
  } finally { db.close(); }
});
