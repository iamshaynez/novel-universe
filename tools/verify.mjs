// verify：全游戏编译 + lint + 图校验 + 结局全可达。CI/提交门。
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from './compile-scenario.mjs';
import { lintGame } from './canon-lint.mjs';
import { lintContent } from './content-lint.mjs';
import { validateGraph, enumerateRoutes } from '../engine/graph.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gamesRoot = join(root, 'games');
const universeDir = join(root, 'universe');

let failed = false;
for (const name of readdirSync(gamesRoot).sort()) {
  if (name.startsWith('_') || name.startsWith('.')) continue;
  const dir = join(gamesRoot, name);
  if (!existsSync(join(dir, 'game.json'))) continue;

  const { ir, manifest } = compileGame(dir, universeDir);
  const errs = validateGraph(ir);
  const lint = [...lintGame(dir, universeDir), ...lintContent(dir, manifest)];
  const routes = enumerateRoutes(ir);
  const dead = routes.filter(r => r.ending.startsWith('__'));
  const reached = new Set(routes.map(r => r.ending));
  const missingEndings = ir.endings.filter(e => !reached.has(e.id));

  const ok = errs.length === 0 && lint.length === 0 && dead.length === 0 && missingEndings.length === 0;
  if (!ok) failed = true;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}  结局 ${[...reached].join(', ')}  路径 ${routes.length} 条`);
  for (const e of [...errs, ...lint]) console.log(`   · ${e}`);
  if (dead.length) console.log(`   · 存在死路/断路路径: ${dead.length} 条`);
  if (missingEndings.length) console.log(`   · 不可达结局: ${missingEndings.map(e => e.id).join(', ')}`);
}
process.exit(failed ? 1 : 0);
