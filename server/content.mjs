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
  // 壳戳：只随壳/引擎文件字节变化，独立于内容 bundle——SW 注册 URL 与注入体定稿用它，
  // 破 bundle↔注入体的循环依赖；带戳 URL 唯一，CDN/HTTP 缓存层困不住旧壳换新版。
  // 壳戳包含 sw.js 模板：缓存策略改变也必须激活新壳；模板中的 bundle 占位符不会造成循环依赖。
  const shellFiles = [...filesUnder(webDir), ...filesUnder(engineDir).filter(f => f.endsWith('.mjs'))];
  const shellStamp = sha256(shellFiles.map(f => sha256(readFileSync(f))).join('')).slice(0, 16);
  const inject = html => html.replace('<head>',
    `<head><script id="nu-sw-url">window.__NU_SW_URL = "/sw.js?b=${shellStamp}"</script>`);
  const entries = [];
  const addFile = (url, file) => entries.push({ url, sha256: sha256(readFileSync(file)) });
  let shellHtml = null;
  for (const file of filesUnder(webDir)) {
    const name = relative(webDir, file).split('\\').join('/');
    if (name === 'sw.js') continue; // 模板由服务端注入，不缓存自身旧模板
    if (name === 'index.html') {
      shellHtml = inject(readFileSync(file, 'utf8'));
      entries.push({ url: '/index.html', sha256: sha256(shellHtml) }); // 摘要按注入后的定稿体
      continue;
    }
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
  return { entries, games: gameList, bundle, shellStamp, shellHtml };
}
