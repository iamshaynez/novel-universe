import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { historyKeyDelta, historyTopInset, historyNeedsSnap } from '../web/stage.mjs';

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
