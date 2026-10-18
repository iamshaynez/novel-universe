// 引擎内核场景测试：推进、选择、守卫、flag、确定性、存档回放。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, advance, choose, stateOf, serializeRun, loadRun } from '../engine/state.mjs';
import { compileGame } from '../tools/compile-scenario.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ir } = compileGame(join(root, 'games/g00-demo'), join(root, 'universe'));

describe('场景：黄昏的天台开场', () => {
  it('开局即第一章第一条旁白，背景与配乐已就位', () => {
    const run = createRun(ir);
    const s = stateOf(ir, run);
    assert.equal(s.kind, 'line');
    assert.equal(s.chapter, 'ch1');
    assert.equal(s.speaker, null);
    assert.match(s.text, /黄昏时分/);
    assert.equal(s.view.bg.id, 'rooftop');
    assert.equal(s.view.bgm, 'rooftop');
  });

  it('推进到第一个选择点，出现两个选项', () => {
    let run = createRun(ir);
    let s = stateOf(ir, run);
    let guard = 0;
    while (s.kind === 'line' && guard++ < 50) { run = advance(run, ir); s = stateOf(ir, run); }
    assert.equal(s.kind, 'choice');
    assert.equal(s.options.length, 2);
    assert.match(s.options[0].label, /开门见山/);
  });
});

describe('场景：选择与 flag', () => {
  it('选「问过去」会置 fact.ev-rooftop-2019，选「问信」不会', () => {
    let run = createRun(ir);
    run = advance(run, ir); run = advance(run, ir); run = advance(run, ir);
    let s = stateOf(ir, run);
    while (s.kind === 'line') { run = advance(run, ir); s = stateOf(ir, run); }
    run = choose(run, ir, 1);
    assert.equal(run.flags['fact.ev-rooftop-2019'], true);
    assert.equal(run.flags['fact.ev-letter'], undefined);
  });

  it('跨章 flag 守卫：只有问过过去，后巷才出现「迎上去」选项', () => {
    const advanceToChoice = (run) => {
      let s = stateOf(ir, run);
      while (s.kind !== 'choice') { run = advance(run, ir); s = stateOf(ir, run); }
      return { run, s };
    };
    const toAlleyChoice = (ch1Choice) => {
      let { run } = advanceToChoice(createRun(ir));
      run = choose(run, ir, ch1Choice);
      let r1 = advanceToChoice(run);           // 第二章街道选择点
      run = choose(r1.run, ir, 1);             // 绕去后巷
      return advanceToChoice(run);             // 后巷选择点（守卫所在）
    };
    const askedPast = toAlleyChoice(1);
    assert.equal(askedPast.s.options.length, 2, '问过过去：真结局选项可见');
    assert.match(askedPast.s.options[0].label, /迎上去/);

    const askedLetter = toAlleyChoice(0);
    assert.equal(askedLetter.s.options.length, 1, '没问过过去：真结局选项被守卫隐藏');
    assert.match(askedLetter.s.options[0].label, /犹豫/);
  });

  it('被守卫隐藏的选项无法通过任何索引选中（引擎拒绝非法输入）', () => {
    const step = (run) => {
      let s = stateOf(ir, run);
      while (s.kind !== 'choice') { run = advance(run, ir); s = stateOf(ir, run); }
      return run;
    };
    let run = step(createRun(ir));
    run = step(choose(run, ir, 0));   // 问信（不置守卫 flag）→ 推进到街道选择点
    run = step(choose(run, ir, 1));   // 绕去后巷 → 推进到后巷选择点
    const s = stateOf(ir, run);
    assert.equal(s.options.length, 1, '真结局选项不可见');
    assert.throws(() => choose(run, ir, 1), /越界或被守卫隐藏/, '越界索引被拒');
    const missRun = choose(run, ir, 0); // 唯一可见选项 → MISS 线
    assert.equal(missRun.choiceLog.at(-1), 0);
  });
});

describe('场景：结局与存档', () => {
  it('雨夜长街三条结局可达且互不相同', () => {
    const step = (run) => {
      let s = stateOf(ir, run);
      while (s.kind !== 'choice') { run = advance(run, ir); s = stateOf(ir, run); }
      return run;
    };
    let run = step(createRun(ir));
    run = step(choose(run, ir, 1));   // 问过去（置守卫 flag）
    run = step(choose(run, ir, 1));   // 绕去后巷
    run = choose(run, ir, 0);         // 迎上去
    let s = stateOf(ir, run);
    while (s.kind !== 'ending') { run = advance(run, ir); s = stateOf(ir, run); }
    assert.equal(s.endingId, 'END_TRUTH');
  });

  it('存档序列化往返后可继续推进到相同结局（回放一致性）', () => {
    let run = createRun(ir);
    let s = stateOf(ir, run);
    while (s.kind !== 'choice') { run = advance(run, ir); s = stateOf(ir, run); }
    run = choose(run, ir, 0);
    const saved = serializeRun(run);
    const restored = loadRun(saved);
    assert.deepEqual(restored.flags, run.flags);
    let r2 = restored;
    let s2 = stateOf(ir, r2);
    while (s2.kind !== 'choice') { r2 = s2.kind === 'choice' ? choose(r2, ir, 0) : advance(r2, ir); s2 = stateOf(ir, r2); }
    r2 = choose(r2, ir, 0);
    s2 = stateOf(ir, r2);
    while (s2.kind !== 'ending') { r2 = advance(r2, ir); s2 = stateOf(ir, r2); }
    assert.equal(s2.endingId, 'END_WAIT');
  });

  it('同选择序列两次运行结果完全一致（确定性）', () => {
    const play = () => {
      let run = createRun(ir, 42), s = stateOf(ir, run), log = [];
      while (s.kind !== 'ending') {
        if (s.kind === 'choice') { run = choose(run, ir, 0); log.push('c0'); }
        else run = advance(run, ir);
        s = stateOf(ir, run);
      }
      return [s.endingId, JSON.stringify(run.flags), log.join(',')].join('|');
    };
    assert.equal(play(), play());
  });
});
