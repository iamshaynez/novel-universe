// 内容分发与离线包清单：编译即加载的产物在此获得内容地址与完整性指纹。
// 纯 Node 边界模块；不进入 engine/。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const irHash = ir => sha256(JSON.stringify(ir)).slice(0, 16);

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

/** 生成 sw.js 注入用的完整预缓存清单。清单本身也参与 bundle，任何壳/引擎/内容变化都换版。 */
export function buildOfflineManifest({ games, webDir, engineDir }) {
  const entries = [];
  const addFile = (url, file) => entries.push({ url, sha256: sha256(readFileSync(file)) });
  for (const file of filesUnder(webDir)) {
    const name = relative(webDir, file).split('\\').join('/');
    if (name === 'sw.js') continue; // 模板由服务端注入，不缓存自身旧模板
    addFile(`/${name}`, file);
  }
  for (const file of filesUnder(engineDir).filter(f => f.endsWith('.mjs'))) {
    addFile(`/engine/${relative(engineDir, file).split('\\').join('/')}`, file);
  }
  const gameList = Object.values(games).sort((a, b) => a.ir.id.localeCompare(b.ir.id)).map(({ ir }) => ({
    id: ir.id, code: ir.code, title: ir.title, subtitle: ir.subtitle, hook: ir.hook,
    chapters: ir.chapters, endings: ir.endings, reading: !!ir.reading,
    irHash: irHash(ir), irUrl: `/content/${ir.id}.${irHash(ir)}.json`,
  }));
  for (const game of gameList) entries.push({ url: game.irUrl, sha256: sha256(JSON.stringify(games[game.id].ir)) });
  entries.push({ url: '/content/catalog.json', sha256: sha256(JSON.stringify(gameList)) });
  entries.sort((a, b) => a.url.localeCompare(b.url));
  const bundle = sha256(JSON.stringify(entries)).slice(0, 16);
  return { entries, games: gameList, bundle };
}
