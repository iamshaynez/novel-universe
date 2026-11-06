import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeGameCatalog, gameIrRequest } from '../web/publication.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const published = [{ id: 'g01', title: '公开', published: true, irUrl: '/content/g01.abc.json', irHash: 'abc' }];
const all = [...published, { id: 'g02', title: '草稿', published: false }];

describe('admin 草稿目录与公开缓存分离', () => {
  it('普通用户只继承公开目录；admin 草稿带预览标记但没有公共 IR 地址', () => {
    assert.equal(mergeGameCatalog(published, all, false).length, 1);
    const merged = mergeGameCatalog(published, all, true);
    assert.equal(merged.length, 2);
    assert.equal(merged[1].preview, true);
    assert.equal(merged[1].irUrl, null);
    assert.equal(merged[0].irUrl, '/content/g01.abc.json');
  });

  it('公开 IR 走内容地址并可缓存；草稿 IR 仅 admin 走 no-store API', () => {
    assert.deepEqual(gameIrRequest(published[0], null), { url: '/content/g01.abc.json', preview: false, cache: true });
    const draft = mergeGameCatalog(published, all, true)[1];
    assert.deepEqual(gameIrRequest(draft, { admin: true }), { url: '/api/games/g02', preview: true, cache: false });
    assert.throws(() => gameIrRequest(draft, null), /尚未开放/);
    assert.throws(() => gameIrRequest(null, { admin: true }), /尚未开放/);
  });
});

describe('作品管理与预览接线', () => {
  it('页面提供管理 dialog、未发布标识，播放器只在 admin 身份下合并草稿', async () => {
    const html = await readFile(join(root, 'web/index.html'), 'utf8');
    const player = await readFile(join(root, 'web/player.mjs'), 'utf8');
    assert.match(html, /id="publicationPanel"/);
    assert.match(html, /id="previewBadge"[^>]*hidden/);
    assert.match(player, /app\.user\?\.admin/);
    assert.match(player, /refreshCatalogForIdentity/);
    assert.match(player, /api\.j\('\/api\/games'\)/);
    assert.match(player, /request\.preview/);
    assert.match(player, /store\.setMeta\(`ir:\$\{gameId\}`/);
  });

  it('Service Worker 只缓存公开清单，作品目录在线时先回源，避免旧下架目录复活', async () => {
    const sw = await readFile(join(root, 'web/sw.js'), 'utf8');
    assert.match(sw, /if \(!SHELL\.has\(pathname\)\) return/);
    assert.doesNotMatch(sw, /!pathname\.startsWith\('\/content\/'\)/);
    const catalog = sw.indexOf("pathname === '/content/catalog.json'");
    assert.ok(catalog > 0);
    assert.match(sw.slice(catalog, catalog + 700), /fetch\(request, \{ cache: 'no-store' \}\)/);
    assert.match(sw.slice(catalog, catalog + 700), /catch\(\(\) => caches\.match\(request\)\)/);
  });
});
