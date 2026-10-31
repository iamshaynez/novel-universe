// 离线优先合同：内容换版、后台同步失败隔离、本地存档与本地续读。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOf, sentinelAction, isFatalStatus, retryDelayMs } from '../web/resilience.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const player = () => readFile(join(root, 'web', 'player.mjs'), 'utf8');

describe('版本哨兵：服务器重启不弹回封面，真正换版才换', () => {
  const v = (version, sha, boot) => ({ version, sha, boot });
  it('首次对时只认定出身指纹，不做任何动作', () => assert.equal(sentinelAction(null, v('0.1.0', 'abc1234', 'T1')), 'observe'));
  it('同镜像重启只报平安，不换版', () => assert.equal(sentinelAction(v('0.1.0', 'abc1234', 'T1'), v('0.1.0', 'abc1234', 'T2')), 'notice'));
  it('部署新镜像换版', () => assert.equal(sentinelAction(v('0.1.0', 'abc1234', 'T1'), v('0.1.0', 'def5678', 'T2')), 'reload'));
  it('内容 bundle 优先于 snapshot sha；同 bundle 重启只报平安', () => {
    const a = { version: '0.1.0', sha: 'snapshot', bundle: 'aaa', boot: 'T1' };
    assert.equal(sentinelAction(a, { ...a, bundle: 'bbb' }), 'reload');
    assert.equal(sentinelAction(a, { ...a, boot: 'T2' }), 'notice');
    assert.equal(codeOf(a), 'bundle:aaa');
  });
  it('例行对时无变化保持沉默', () => assert.equal(sentinelAction(v('0.1.0', 'abc1234', 'T1'), v('0.1.0', 'abc1234', 'T1')), 'none'));
});

describe('同步失败分类：瞬时失败退避，永久失败不空转', () => {
  it('4xx 永久失败不重试，408/429 例外', () => {
    for (const status of [400, 401, 403, 404, 409]) assert.equal(isFatalStatus(status), true);
    for (const status of [408, 429, 500, 502, 503, undefined, null]) assert.equal(isFatalStatus(status), false);
  });
  it('退避从 1 秒起步封顶 5 秒', () => assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelayMs), [1000, 2000, 3000, 4000, 5000, 5000]));
});

describe('播放器离线接线合同', () => {
  it('引擎、IndexedDB、后台同步都接入；玩法推进不调用服务端推进接口', async () => {
    const src = await player();
    assert.match(src, /import \{ LocalRuntime \}/);
    assert.match(src, /import \{ openLocalStore \}/);
    assert.match(src, /import \{ SyncClient \}/);
    assert.match(src, /app\.runtime\.advance\(app\.saveId/);
    assert.match(src, /app\.runtime\.choose\(app\.saveId/);
    assert.doesNotMatch(src, /api\.post\(`\/api\/saves\/\$\{app\.saveId\}\/advance/);
    assert.doesNotMatch(src, /api\.post\(`\/api\/saves\/\$\{app\.saveId\}\/choose/);
  });

  it('本地进度先落盘，开卷直接续读；账号查询在后台，不阻塞首屏', async () => {
    const src = await player();
    assert.match(src, /app\.store = await openLocalStore\(\)/);
    assert.match(src, /app\.runtime\.newGame\(/);
    assert.match(src, /app\.runtime\.load\(saveId\)/);
    assert.match(src, /await tryResume\(\)/);
    assert.match(src, /api\.j\('\/api\/auth\/me'\)\.then/);
    assert.match(src, /本机进度 · 可离线游玩/);
  });

  it('读档不重播章节卡/印章；同步失败只显示状态，不进入推进循环', async () => {
    const src = await player();
    assert.match(src, /app\.resume = true/);
    assert.match(src, /const resuming = app\.resume/);
    assert.match(src, /queueSync\(\)/);
    assert.match(src, /本地存档出了岔子/);
    assert.doesNotMatch(src, /async function reconnect\(/);
  });

  it('开场兜底针对本地能力，而不是要求先登录', async () => {
    const src = await player();
    assert.match(src, /本地开卷失败：/);
    assert.match(src, /重新开卷/);
    assert.match(src, /支持本地存档的浏览器/);
  });
});
