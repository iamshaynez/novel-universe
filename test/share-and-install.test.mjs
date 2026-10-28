// 首页分享与安装：分享卡片、Web App Manifest、离线壳和静态服务合同。
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = (...parts) => join(root, 'web', ...parts);
const text = path => readFile(path, 'utf8');
const base = {};

function pngSize(data) {
  assert.equal(data.subarray(1, 4).toString(), 'PNG', '必须是 PNG 而不是改后缀的图片');
  assert.equal(data.subarray(12, 16).toString(), 'IHDR');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

before(async () => {
  const server = createApp({ db: null, games: {}, webDir: web() });
  await new Promise(resolveListen => server.listen(0, resolveListen));
  base.server = server;
  base.url = `http://127.0.0.1:${server.address().port}`;
});
after(() => base.server.close());

describe('首页被分享时，社交平台和读者看到的是同一张案卷名片', () => {
  it('Open Graph 与 Twitter 都声明绝对地址的大图、标题、简介和替代文本', async () => {
    const html = await text(web('index.html'));
    assert.match(html, /<meta property="og:type" content="website">/);
    assert.match(html, /<meta property="og:title" content="锦江悬疑宇宙 · 文字舞台">/);
    assert.match(html, /<meta property="og:description" content="[^"]+">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/chengdu\.xiaowenz\.com\/og-card\.png">/);
    assert.match(html, /<meta property="og:image:width" content="1200">/);
    assert.match(html, /<meta property="og:image:height" content="630">/);
    assert.match(html, /<meta property="og:image:alt" content="[^"]+">/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /<meta name="twitter:image" content="https:\/\/chengdu\.xiaowenz\.com\/og-card\.png">/);
    assert.match(html, /<meta name="twitter:image:alt" content="[^"]+">/);
  });

  it('真实分享图是 1200×630 PNG，保留可读的中文案卷设计源文件', async () => {
    const card = await readFile(web('og-card.png'));
    assert.deepEqual(pngSize(card), { width: 1200, height: 630 });
    const source = await text(web('og-card.svg'));
    assert.match(source, /锦江悬疑宇宙/);
    assert.match(source, /接线员/);
  });
});

describe('首页可以像手机小应用一样安装，并保持档案室视觉身份', () => {
  it('Manifest 声明独立窗口、主题色、作用域和任意/遮罩图标', async () => {
    const manifest = JSON.parse(await text(web('manifest.webmanifest')));
    assert.equal(manifest.name, '锦江悬疑宇宙 · 文字舞台');
    assert.equal(manifest.short_name, '锦江卷宗');
    assert.equal(manifest.id, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.background_color, '#17130d');
    assert.equal(manifest.theme_color, '#17130d');
    for (const purpose of ['any', 'maskable']) {
      assert.ok(manifest.icons.some(icon => icon.sizes === '192x192' && icon.purpose === purpose), `缺 ${purpose} 192 图标`);
      assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === purpose), `缺 ${purpose} 512 图标`);
    }
    for (const icon of manifest.icons) {
      const data = await readFile(web(icon.src.replace(/^\//, '')));
      const [width, height] = icon.sizes.split('x').map(Number);
      assert.deepEqual(pngSize(data), { width, height }, icon.src);
    }
  });

  it('iOS 与 Android 都有图标、主题色和启动入口，页面提供安装按钮与帮助', async () => {
    const html = await text(web('index.html'));
    assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(html, /<meta name="theme-color" content="#17130d">/);
    assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
    assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/icons\/apple-touch-icon\.png">/);
    assert.match(html, /<script type="module" src="\/pwa\.mjs"><\/script>/);
    assert.match(html, /id="btnInstall"/);
    assert.match(html, /id="installHelp"/);
    assert.deepEqual(pngSize(await readFile(web('icons/apple-touch-icon.png'))), { width: 180, height: 180 });
  });

  it('原生安装对话框覆盖全局 margin reset，保持居中', async () => {
    const html = await text(web('index.html'));
    const rule = html.match(/#installHelp\{[^}]+\}/)?.[0] ?? '';
    assert.match(rule, /margin:auto/);
  });

  it('离线壳不拦截或缓存账号、存档 API；断网导航返回明确提示页', async () => {
    const sw = await text(web('sw.js'));
    assert.match(sw, /request\.method !== 'GET'/);
    assert.match(sw, /pathname\.startsWith\('\/api\/'\)/);
    assert.match(sw, /request\.mode === 'navigate'/);
    assert.match(sw, /caches\.match\('\/offline\.html'\)/);
    assert.doesNotMatch(sw, /cache\.addAll\([^\)]*\/api\//s);
    const offline = await text(web('offline.html'));
    assert.match(offline, /连接已中断/);
    assert.match(offline, /location\.reload/);
  });
});

describe('静态服务把安装与分享资源按正确类型送出', () => {
  it('Manifest、Service Worker、分享图和安装图标均可通过真实 HTTP 获取', async () => {
    const cases = [
      ['/manifest.webmanifest', /application\/manifest\+json/],
      ['/sw.js', /text\/javascript/],
      ['/og-card.png', /image\/png/],
      ['/icons/icon-192.png', /image\/png/],
      ['/offline.html', /text\/html/],
    ];
    for (const [path, mime] of cases) {
      const res = await fetch(base.url + path);
      assert.equal(res.status, 200, path);
      assert.match(res.headers.get('content-type') ?? '', mime, path);
      assert.match(res.headers.get('cache-control') ?? '', /no-cache/i, path);
      await res.arrayBuffer();
    }
  });
});
