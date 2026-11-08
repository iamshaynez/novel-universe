import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Stage, historyKeyDelta, historyTopInset, historyNeedsSnap, shouldHandleStageKey, stageContentBounds, flowOffset, clampHistoryPan, trackBannerMarkup, ambientMoodPlan } from '../web/stage.mjs';

describe('舞台节奏与停顿：符合人类自然阅读与呼吸习惯', () => {
  it('标点停顿满足阶梯呼吸律：句末深长停顿、逗号自然换气、破折号悬停、并具备字数动态补偿', () => {
    // 句末标点（。！？…）：读者需要消化完整语义，短句也需要 >= 1100ms
    assert.ok(Stage.pauseOf('深秋的暴雨把整个东郊抽打得一片迷蒙。', false) >= 1100);
    assert.ok(Stage.pauseOf('「你在里头到底看见了啥子？！」', true) >= 1200);

    // 句中逗顿（，、,;）：行内呼吸停顿，约 650-800ms
    assert.ok(Stage.pauseOf('宋明伏在二层检修天车的最深处，', false) >= 650);
    assert.ok(Stage.pauseOf('「七点五十二分，', true) >= 700);

    // 破折号（——）：戏剧化悬念悬气，约 950-1100ms
    assert.ok(Stage.pauseOf('呼入原话——', false) >= 950);

    // 字数动态补偿：长分句需给予眼睛更多扫视时间
    const shortPause = Stage.pauseOf('坐下，', false);
    const longPause = Stage.pauseOf('在全城最较真的测温登记薄与居委会大姐的注视下，', false);
    assert.ok(longPause > shortPause, '长分句停顿时间应长于短分句');
  });
});

describe('停点回看：键盘浏览已展示历史', () => {
  it('向上方向键往回翻，向下方向键回到较新文字', () => {
    assert.equal(historyKeyDelta('ArrowUp', 800), 72);
    assert.equal(historyKeyDelta('ArrowDown', 800), -72);
  });

  it('PageUp / PageDown 按视口高度的 75% 翻页', () => {
    assert.equal(historyKeyDelta('PageUp', 800), 600);
    assert.equal(historyKeyDelta('PageDown', 800), -600);
  });

  it('最早历史停在 HUD 下方，小屏多行按钮不会遮住首行', () => {
    assert.equal(historyTopInset(0), 8);
    assert.equal(historyTopInset(154.2), 167);
  });

  it('只要界面仍在回看态，第一次确认就只归位，不推进剧情', () => {
    assert.equal(historyNeedsSnap(true, 0), true);
    assert.equal(historyNeedsSnap(false, 9), true);
    assert.equal(historyNeedsSnap(false, 8), false);
    assert.equal(historyNeedsSnap(false, 0), false);
  });

  it('推进键与其他按键不触发历史滚动', () => {
    for (const key of [' ', 'Space', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'a']) {
      assert.equal(historyKeyDelta(key, 800), null);
    }
  });
});

describe('舞台快捷键让位于输入与响应式可用区域', () => {
  const target = hit => ({ closest: () => hit ? {} : null });

  it('输入框、按钮和可编辑区域里的 Space/Enter 不推进剧情', () => {
    assert.equal(shouldHandleStageKey({ code: 'Space', target: target(true) }), false);
    assert.equal(shouldHandleStageKey({ key: 'Enter', target: target(true) }), false);
    assert.equal(shouldHandleStageKey({ code: 'Space', target: target(false) }), true);
  });

  it('中文输入法组词与已被界面处理的按键不穿透到舞台', () => {
    assert.equal(shouldHandleStageKey({ key: 'Enter', isComposing: true, target: target(false) }), false);
    assert.equal(shouldHandleStageKey({ key: 'Enter', keyCode: 229, target: target(false) }), false);
    assert.equal(shouldHandleStageKey({ key: 'Enter', defaultPrevented: true, target: target(false) }), false);
  });

  it('正文同时避让真实 HUD、时间轴与底部提示', () => {
    assert.deepEqual(stageContentBounds({ viewportHeight: 844, hudBottom: 154.2, timelineBottom: 182.6, hintTop: 790 }), {
      top: 195, bottom: 778, anchor: 506,
    });
    assert.deepEqual(stageContentBounds({ viewportHeight: 390, hudBottom: 96, timelineBottom: 0, hintTop: 344 }), {
      top: 108, bottom: 332, anchor: 234,
    });
  });

  it('当前拍特别高时先保住顶部，不让选项钻到 HUD 后面', () => {
    assert.equal(flowOffset({ anchor: 234, contentTop: 108, lastTop: 600, lastHeight: 180 }), -492);
    assert.equal(flowOffset({ anchor: 506, contentTop: 100, lastTop: 400, lastHeight: 60 }), 46);
  });

  it('旋转与视口收缩后回看位移立即夹回合法范围', () => {
    assert.equal(clampHistoryPan(-40, 180), 0);
    assert.equal(clampHistoryPan(240, 180), 180);
    assert.equal(clampHistoryPan(72, 180), 72);
  });
});

describe('双轨视界与昼夜氛围：文字舞台对齐合同', () => {
  it('trackBannerMarkup 生成包含轨道徽标、标题与日期的切分卡', () => {
    const recordCard = trackBannerMarkup({ id: 'record', symbol: '耳', label: '记录轨', sub: '夜班座席' }, '九月二十八日');
    assert.match(recordCard, /class="tb-sym">耳<\/span>/);
    assert.match(recordCard, /记录轨 · 夜班座席/);
    assert.match(recordCard, /九月二十八日/);

    const visitCard = trackBannerMarkup({ id: 'visit', symbol: '街', label: '走访轨', sub: '案发后协查' }, '十一月三日');
    assert.match(visitCard, /class="tb-sym">街<\/span>/);
    assert.match(visitCard, /走访轨 · 案发后协查/);
    assert.match(visitCard, /十一月三日/);
  });

  it('ambientMoodPlan 在白天关闭霓虹并在白天过滤夜字水印', () => {
    const dayPlan = ambientMoodPlan({ sign: '呼叫成都', bigchar: '夜' }, { time: 'day' });
    assert.equal(dayPlan.showNeon, false);
    assert.equal(dayPlan.bigchar, '');

    const nightPlan = ambientMoodPlan({ sign: '呼叫成都', bigchar: '夜' }, { time: 'night' });
    assert.equal(nightPlan.showNeon, true);
    assert.equal(nightPlan.bigchar, '夜');
  });
});
