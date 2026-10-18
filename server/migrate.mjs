#!/usr/bin/env node
// 迁移 CLI：`node server/migrate.mjs [status]`（默认应用全部）。
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate, migrationStatus } from './db.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.DB_PATH ?? join(root, 'data/novel.db');
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = openDb(DB_PATH);
const dir = join(root, 'server/migrations');

if (process.argv[2] === 'status') {
  const rows = migrationStatus(db, dir);
  for (const r of rows) console.log(`${r.applied ? '[applied]' : '[pending]'} ${r.file}`);
  const pending = rows.filter(r => !r.applied).length;
  console.log(pending ? `待应用: ${pending} 个` : '迁移已是最新');
  process.exit(pending ? 1 : 0);
} else {
  const { appliedCount, total } = migrate(db, dir);
  console.log(`迁移完成: 本次应用 ${appliedCount}/${total}`);
}
