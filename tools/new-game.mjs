#!/usr/bin/env node
// 脚手架：node tools/new-game.mjs <slug> [标题]
// 从 games/_template 复制并替换占位符，产出一个可编译通过的新游戏目录。
import { cpSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [slug, titleArg] = process.argv.slice(2);
if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
  console.error('用法: node tools/new-game.mjs <kebab-case-slug> [标题]');
  process.exit(1);
}
const dest = join(root, 'games', slug);
if (existsSync(dest)) {
  console.error(`已存在: ${dest}`);
  process.exit(1);
}
const title = titleArg ?? slug;
cpSync(join(root, 'games/_template'), dest, { recursive: true });

// 目录内所有文本文件做占位符替换
const walk = dir => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(json|md)$/.test(f.name)) {
      writeFileSync(p, readFileSync(p, 'utf8')
        .replaceAll('__SLUG__', slug)
        .replaceAll('__TITLE__', title));
    }
  }
};
walk(dest);
console.log(`已创建 games/${slug}（${title}）`);
console.log('下一步：改 game.json 的 code/assumes，写 chapters/*.md，然后 npm run verify');
