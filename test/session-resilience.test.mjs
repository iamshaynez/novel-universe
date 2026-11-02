// 离线优先合同：内容换版、后台同步失败隔离、本地存档与本地续读。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeOf, sentinelAction, isFatalStatus, retryDelayMs, updatePlan, resumePlan, manualUpdatePlan } from '../web/resilience.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const player = () => readFile(join(root, 'web', 'player.mjs'), 'utf8');
const pwa = () => readFile(join(root, 'web', 'pwa.mjs'), 'utf8');

describe('换版执行计划：开局演出与进行中的局不被急切重载打断', () => {
  it('新鲜页面一律缓换：章节卡/开场演出刚落地，稍后再评估', () => {
    assert.equal(updatePlan({ running: true, endcard: false, pageAgeMs: 3000 }).act, 'defer');
    assert.equal(updatePlan({ running: false, endcard: false, pageAgeMs: 500 }).act, 'defer');
    assert.equal(updatePlan({ running: true, endcard: false, pageAgeMs: 14999 }).act, 'defer');
  });
  it('局内换版只认停点：交给 runLoop 置 forceUpdate，不得定时器急切 reload', () => {
    const plan = updatePlan({ running: true, endcard: false, pageAgeMs: 60000 });
    assert.equal(plan.act, 'wait-stop');
  });
  it('封面无局直接换，结局页是天然停点也可换', () => {
    assert.equal(updatePlan({ running: false, endcard: false, pageAgeMs: 60000 }).act, 'reload-now');
    assert.equal(updatePlan({ running: false, endcard: true, pageAgeMs: 60000 }).act, 'reload-now');
  });
});

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

describe('开卷续档策略：自动进局必须是可预期的，坏档不得死循环', () => {
  const marker = saveId => ({ saveId, at: 1000 });
  it('PWA 独立窗口重开且标记新鲜（7 天内）：直进上次的档', () => {
    assert.equal(resumePlan({ marker: marker('s1'), brokenId: null, nowMs: 1000 + 3 * 86400e3, standalone: true }).act, 'resume');
  });
  it('普通浏览器访问落封面：由显式续读入口进入，不再不问自进', () => {
    assert.equal(resumePlan({ marker: marker('s1'), brokenId: null, nowMs: 1000 + 3600e3, standalone: false }).act, 'title');
  });
  it('标记超过七天：即使 PWA 也落封面（防长期弃坑档每次劫持开卷）', () => {
    assert.equal(resumePlan({ marker: marker('s1'), brokenId: null, nowMs: 1000 + 8 * 86400e3, standalone: true }).act, 'title');
  });
  it('上次崩溃的档不再自动进：坏档 × 自动续档不得成环', () => {
    const plan = resumePlan({ marker: marker('s1'), brokenId: 's1', nowMs: 1000 + 3600e3, standalone: true });
    assert.equal(plan.act, 'title');
    assert.equal(plan.reason, 'broken');
  });
  it('无标记不动作', () => assert.equal(resumePlan({ marker: null, nowMs: 0 }).act, 'title'));
});

describe('手动换版决策：版本指纹即按钮，用户主动点击即时生效', () => {
  const same = 'bundle:aaa', newer = 'bundle:bbb';
  it('页面与服务器同指纹：已是最新，不动', () => {
    assert.equal(manualUpdatePlan({ pageCode: same, serverCode: same, swReady: true }).act, 'current');
  });
  it('有新版且 SW 通道在场：走激活新壳（waiting/installing → skipWaiting），不打断式硬刷', () => {
    assert.equal(manualUpdatePlan({ pageCode: same, serverCode: newer, swReady: true }).act, 'activate');
  });
  it('有新版但无 SW 通道（注册失败/不支持的浏览器）：直接重载，HTTP 层 no-cache 拉新', () => {
    assert.equal(manualUpdatePlan({ pageCode: same, serverCode: newer, swReady: false }).act, 'reload');
  });
  it('页面指纹未知（首拍对时未完成）：当作有新版处理——重载即自愈', () => {
    assert.equal(manualUpdatePlan({ pageCode: null, serverCode: same, swReady: false }).act, 'reload');
  });
  it('服务器不可达：提示稍后再点，绝不瞎刷新', () => {
    assert.equal(manualUpdatePlan({ pageCode: same, serverCode: null, swReady: true }).act, 'offline');
  });
});

describe('播放器离线接线合同', () => {
  it('引擎、IndexedDB、后台同步都接入；玩法推进不调用服务端推进接口', async () => {
    const src = await player();
    assert.match(src, /import \{ LocalRuntime \}/);
    assert.match(src, /import \{ openLocalStore \}/);
    assert.match(src, /import \{ SyncClient \}/);
    assert.match(src, /app\.runtime\.advance\(app\.saveId/);    assert.match(src, /app\.runtime\.choose\(app\.saveId/);
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

  it('存档不膨胀：封面卡片优先续读未完成档，开新局必须是显式动作；冲突分叉重定向活动局', async () => {
    const src = await player();
    assert.match(src, /b\.onclick = \(\) => \(last && !AUTO\) \? loadSave\(last\.id\)/, '卡片点击优先续读未完成存档');
    assert.match(src, /开新局/, '存在未完成档时提供显式开新局入口');
    assert.match(src, /onFork/, '同步冲突分叉必须回调播放器');
    assert.match(src, /app\.saveId = fork\.id/, '活动局改走分叉谱系：不读到被顶替的主线');
    assert.match(src, /分支/, '存档列表标注分叉谱系');
  });

  it('版本可自查：页脚显示 shell 壳戳，手机一眼对出是否换到新壳', async () => {
    const src = await player();
    assert.match(src, /v\.shell/, 'vtag 必须渲染 /api/version 的 shell 壳戳');
  });

  it('存档面板接线：onclick 不得把事件对象误当 refresh 参数（b8d32c8 回归——点击存档无反应）', async () => {
    const src = await player();
    assert.match(src, /btnSaves'\)\.onclick = \(\) => openSaves\(\)/, '按钮必须箭头包裹，不得直挂带参函数');
    assert.match(src, /refresh !== true && !requestPanel\('#savesPanel'\)/, 'openSaves 只认字面 true 的刷新态，事件对象一律走完整开面板流程');
  });

  it('致命错误有逃生舱：常驻错误条 + 重新对位 + 回封面，坏档不再自动续进', async () => {
    const src = await player();
    assert.match(src, /function showFatal/, '本地档推不动时必须有常驻错误条，而不是一条会消失的 toast');
    assert.match(src, /btnRealign/, '提供「重新对位本档」动作：读档自愈链路就是恢复通道');
    assert.match(src, /btnFatalTitle/, '提供「回到封面」动作');
    assert.match(src, /brokenLastPlay/, '崩溃档要记账，下次开卷不得自动续进');
    assert.match(src, /resumePlan\(\{/, '开卷续档必须过策略门，不得无条件直进');
  });

  it('手动换版接线：版本指纹可点击检查新版，即时强制换壳（不受停点保护与防环限制）', async () => {
    const src = await player();
    assert.match(src, /manualUpdatePlan\(\{/, '点击必须先过决策（已是最新/激活新壳/直接重载/不可达）');
    assert.match(src, /vtag'\)\.addEventListener\('click', checkUpdate\)/, '版本指纹页脚就是换版按钮');
    assert.match(src, /已是最新/, '同指纹要有明确反馈，不瞎刷新');
    assert.match(src, /新壳还在路上/, '激活通道未就绪时给可重试的反馈，不盲目重载回旧壳');
  });

  it('SW 激活通道覆盖 installing 态：新壳还在下载时等它装完再激活，而不是误判无新版', async () => {
    const src = await pwa();
    assert.match(src, /registration\.installing/, '必须等待 installing 的新壳');
    assert.match(src, /statechange/, '下载中的壳完成（installed）后立即激活');
    assert.match(src, /NU_ACTIVATE/, '激活仍走 skipWaiting → controllerchange → 重载的既有通道');
  });

  it('开场兜底针对本地能力，而不是要求先登录', async () => {
    const src = await player();
    assert.match(src, /本地开卷失败：/);
    assert.match(src, /重新开卷/);
    assert.match(src, /支持本地存档的浏览器/);
  });
});
