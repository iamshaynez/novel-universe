// 引擎内核场景测试：推进、选择、守卫、flag、确定性、存档回放。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRun, advance, choose, stateOf, serializeRun, loadRun, submit } from '../engine/state.mjs';
import { compileGame } from '../tools/compile-scenario.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ir } = compileGame(join(root, 'test/fixtures/games/g00-demo'), join(root, 'test/fixtures/universe'));

describe('场景：黄昏的天台开场', () => {
  it('开局即第一章第一条旁白，地点已就位（文字舞台：view 只含 bg）', () => {
    const run = createRun(ir);
    const s = stateOf(ir, run);
    assert.equal(s.kind, 'line');
    assert.equal(s.chapter, 'ch1');
    assert.equal(s.speaker, null);
    assert.match(s.text, /黄昏时分/);
    assert.equal(s.view.bg.id, 'rooftop');
    assert.equal(s.view.bg.params.time, 'dusk');
    assert.equal('bgm' in s.view, false);
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

// ---- 转写交互（g01 接线员原语）：submit + 停点 + 错误计数 ----
describe('场景：转写交互（g01）', () => {
  let g01 = null, why = '';
  try { g01 = compileGame(join(root, 'games/g01-jiexianyuan'), join(root, 'universe')).ir; }
  catch (e) { why = e.message; }

  it('g01 可编译：含转写节点与「她/他」声纹解析', () => {
    assert.ok(g01, `g01 编译失败: ${why}`);
    const trs = Object.values(g01.nodes).filter(n => n.type === 'transcribe');
    assert.ok(trs.length >= 8, `转写节点应≥8，实际 ${trs.length}`);
    assert.equal(g01.speakers['她']?.char, 'suwan', '「她」应解析到苏晚');
    assert.equal(g01.speakers['他']?.char, 'liaozhikun', '「他」应解析到廖志坤');
  });

  it('stateOf 透传呼入者绑定：陈先生/刘先生携带 caller_char=liaozhikun（声纹法证）', () => {
    assert.ok(g01);
    const byTid = tid => Object.values(g01.nodes).find(n => n.type === 'transcribe' && n.transId === tid);
    const st = n => stateOf(g01, { ...createRun(g01), nodeId: n.id });
    assert.equal(st(byTid('t3')).caller_char, 'liaozhikun', '陈先生 → 廖志坤');
    assert.equal(st(byTid('t4')).caller_char, 'liaozhikun', '刘先生 → 廖志坤');
    assert.equal(st(byTid('t9')).caller_char, 'liaozhikun', '终章前最后一条 → 廖志坤');
    assert.equal(st(byTid('t1')).caller_char, null, '张嬢嬢刻意无档');
  });

  it('advance 不得越过转写节点（转写是停点）', () => {
    assert.ok(g01);
    let r = createRun(g01), guard = 0, hit = null;
    while (guard++ < 800) {
      const st = stateOf(g01, r);
      if (st.kind === 'transcribe') { hit = st; break; }
      if (st.kind === 'ending') break;
      if (st.kind === 'choice') { r = choose(r, g01, 0); continue; }
      r = advance(r, g01);
    }
    assert.ok(hit, '应遇到转写停点');
    assert.equal(advance(r, g01).nodeId, r.nodeId, 'advance 越过了转写节点');
  });

  it('submit：正确→tr.* 点亮并推进；错误→原地计数', () => {
    assert.ok(g01);
    let r = createRun(g01), guard = 0;
    while (guard++ < 800) {
      const st = stateOf(g01, r);
      if (st.kind === 'ending') assert.fail('未遇到转写停点');
      if (st.kind === 'choice') { r = choose(r, g01, 0); continue; }
      if (st.kind === 'transcribe') {
        const wrong = submit(r, g01, '完全不相干的话');
        assert.equal(wrong.nodeId, r.nodeId, '错误提交不得推进');
        assert.ok((wrong.trMisses[st.tid] ?? 0) >= 1, '错误应计数');
        const ok = submit(wrong, g01, st.target);
        assert.ok(ok.flags[`tr.${st.tid}`], '成功应点亮 tr.* flag');
        assert.notEqual(ok.nodeId, r.nodeId, '成功后应推进');
        return;
      }
      r = advance(r, g01);
    }
  });

  it('submit 判定容错：照呼入原话全文可过，去标点可过，漏关键字不过（打字跟人声走）', () => {
    assert.ok(g01);
    let r = createRun(g01), guard = 0;
    while (guard++ < 800) {
      const st = stateOf(g01, r);
      if (st.kind === 'ending') assert.fail('未遇到 t1 转写停点');
      if (st.kind === 'choice') { r = choose(r, g01, 0); continue; }
      if (st.kind === 'transcribe' && st.tid === 't1') {
        // 张嬢嬢的呼入原话全文照打（含语气词，标点不同）→ 应通过
        const full = submit(r, g01, '呼我儿——降温了哈，被子换成厚的，莫要嘴硬。你老汉儿风湿又犯了，念你。');
        assert.notEqual(full.nodeId, r.nodeId, '照呼入原话全文打应通过');
        assert.ok(full.flags['tr.t1'], '全文照打应点亮 tr.t1');
        // 目标裸文去标点 → 应通过
        const bare = submit(r, g01, '降温了被子换成厚的念你');
        assert.notEqual(bare.nodeId, r.nodeId, '去标点裸文应通过');
        // 漏掉「念你」 → 不得推进
        const miss = submit(r, g01, '降温了，被子换成厚的。');
        assert.equal(miss.nodeId, r.nodeId, '漏掉关键字不得推进');
        assert.ok((miss.trMisses['t1'] ?? 0) >= 1, '漏关键字应计数');
        return;
      }
      r = advance(r, g01);
    }
  });
});
