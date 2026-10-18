// 入口：env 单点校验（fail-fast）→ 迁移 → 编译游戏 → 监听。
import { mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, migrate } from './db.mjs';
import { loadGames, createApp } from './app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PORT = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  throw new Error(`PORT 无效: ${process.env.PORT ?? '(默认3000)'}`);
}
const DB_PATH = process.env.DB_PATH ?? join(root, 'data/novel.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = openDb(DB_PATH);
const { appliedCount, total } = migrate(db, join(root, 'server/migrations'));
if (appliedCount) console.log(`[migrate] 应用 ${appliedCount}/${total}`);

const games = loadGames(join(root, 'games'), join(root, 'universe'));
console.log(`[games] ${Object.keys(games).join(', ') || '(空)'}`);

const app = createApp({
  db, games,
  webDir: join(root, 'web'),
  assetsDir: join(root, 'assets'),
});
app.listen(PORT, () => {
  console.log(`[novel-universe] http://127.0.0.1:${PORT}`);
});
