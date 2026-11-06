import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOfflineManifest } from '../server/content.mjs';

it('Service Worker 模板变化会改变壳指纹并触发已有设备安装新版', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nu-shell-version-'));
  const webDir = join(dir, 'web');
  const engineDir = join(dir, 'engine');
  mkdirSync(webDir, { recursive: true });
  mkdirSync(engineDir, { recursive: true });
  try {
    writeFileSync(join(webDir, 'index.html'), '<html><head></head><body>壳</body></html>');
    writeFileSync(join(webDir, 'sw.js'), 'const CACHE = "a";');
    const first = buildOfflineManifest({ games: {}, webDir, engineDir });
    writeFileSync(join(webDir, 'sw.js'), 'const CACHE = "b";');
    const second = buildOfflineManifest({ games: {}, webDir, engineDir });
    assert.notEqual(second.shellStamp, first.shellStamp, 'sw.js 缓存策略变化不得保持旧壳戳');
    assert.notEqual(second.shellHtml, first.shellHtml, '注入后的首页应携带新壳戳');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
