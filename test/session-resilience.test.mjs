// 会话韧性：版本哨兵、断线自愈、续档恢复——出错与重启都不再把局中人摔回封面。
// 三条合同：
//   换版才重载（version|sha 变才是真换版；同镜像重启只报平安，会话与存档都在库里）；
//   断线以服务端当前状态对齐续跑（绝不盲目重发 advance/choose，防双推进）；
//   上次进行到的存档开卷即回（刻意回封面/退出登录的除外）。
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

  it('首次对时只认定出身指纹，不做任何动作', () => {
    assert.equal(sentinelAction(null, v('0.1.0', 'abc1234', 'T1')), 'observe');
  });

  it('同镜像重启（version|sha 不变、起服时刻变）：报一声平安，不换版', () => {
    assert.equal(sentinelAction(v('0.1.0', 'abc1234', 'T1'), v('0.1.0', 'abc1234', 'T2')), 'notice');
  });

  it('部署新镜像（sha 变）：换版重载，拿新前端代码', () => {
    assert.equal(sentinelAction(v('0.1.0', 'abc1234', 'T1'), v('0.1.0', 'def5678', 'T2')), 'reload');
  });

  it('镜像里没有 .git 时 sha 兜底同值，版本号变化也算换版', () => {
    assert.equal(sentinelAction(v('0.1.0', 'snapshot', 'T1'), v('0.2.0', 'snapshot', 'T2')), 'reload');
  });

  it('每 30 秒的例行对时若无任何变化，保持沉默', () => {
    assert.equal(sentinelAction(v('0.1.0', 'abc1234', 'T1'), v('0.1.0', 'abc1234', 'T1')), 'none');
  });

  it('换版指纹只由 version|sha 构成，boot 不参与', () => {
    assert.equal(codeOf(v('0.1.0', 'abc1234', '任意')), '0.1.0|abc1234');
  });
});

describe('断线自愈：瞬时失败退避重连，永久失败不空转', () => {
  it('存档不存在、会话失效、非法推进（400/401/403/404/409）不该重试——重试只会原地打转', () => {
    for (const status of [400, 401, 403, 404, 409]) assert.equal(isFatalStatus(status), true, String(status));
  });

  it('超时、限流、网关瞬断（408/429/5xx）与断网（无状态码）都算瞬时，继续重连', () => {
    for (const status of [408, 429, 500, 502, 503]) assert.equal(isFatalStatus(status), false, String(status));
    assert.equal(isFatalStatus(undefined), false, 'fetch 抛出的网络错误没有状态码');
    assert.equal(isFatalStatus(null), false);
  });

  it('退避从 1 秒起步逐次 +1 秒，封顶 5 秒——部署窗口数十秒内必回来', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs), [1000, 2000, 3000, 4000, 5000, 5000, 5000]);
  });
});

describe('播放器接线合同：三条韧性路径都真实接进 player', () => {
  it('局内出错不再静默死循环：捕获拍内异常，以幂等 GET 对齐服务端状态后续跑', async () => {
    const src = await player();
    assert.match(src, /async function reconnect\(/);
    assert.match(src, /catch \(e\) \{[\s\S]{0,80}?await reconnect\(e\)/, 'runLoop 捕获拍内异常并转入重连');
    assert.match(src, /api\.j\(`\/api\/saves\/\$\{app\.saveId\}`\)/, '重连走幂等 GET，不盲目重发推进请求');
    assert.match(src, /finally \{[\s\S]{0,120}?app\.running = false/, '异常路径也要落下 running，状态不再永久错乱');
  });

  it('续档恢复：开局/读档记下存档号，开卷自动回去；回封面与退出登录清标记，保留「刻意离开」', async () => {
    const src = await player();
    assert.match(src, /const LASTPLAY = /);
    assert.match(src, /function markLastPlay\(/);
    assert.match(src, /markLastPlay\(r\.saveId\)/, '开局记标记');
    assert.match(src, /markLastPlay\(saveId\)/, '读档记标记');
    assert.match(src, /await tryResume\(/, '开卷时尝试续档');
    assert.match(src, /clearLastPlay\(\); sessionStorage\.setItem\('nu\.reload\.cause', 'btnTitle'\)/, '回到封面清标记');
    assert.match(src, /clearLastPlay\(\); sessionStorage\.setItem\('nu\.reload\.cause', 'btnBackTitle'\)/, '结案页回到封面清标记');
    assert.match(src, /clearLastPlay\(\); sessionStorage\.setItem\('nu\.reload\.cause', 'btnLogout'\)/, '退出登录清标记');
  });

  it('开场兜底：boot 失败给出原因与重试入口，标题页不再静默空白', async () => {
    const src = await player();
    assert.match(src, /开场失败：/);
    assert.match(src, /重新开卷/);
  });

  it('同镜像重启只报平安；冒烟模式既不自动续档也不自动换版', async () => {
    const src = await player();
    assert.match(src, /sentinelAction\(fpBase, v\)/);
    assert.match(src, /服务器刚重启过/);
    assert.match(src, /if \(!marker\?\.saveId \|\| AUTO\) return;/, '续档恢复跳过冒烟');
    assert.match(src, /if \(!AUTO\) stage\.toast\('服务器刚重启过/, '重启报平安跳过冒烟');
  });

  it('开局/调档的前置请求失败当场给反馈，不再静默无响应', async () => {
    const src = await player();
    const catches = src.match(/\.catch\(failNote\)/g) ?? [];
    assert.ok(catches.length >= 4, `开局/读档入口共 5 处，至少 4 处接了失败反馈，实际 ${catches.length}`);
  });
});
