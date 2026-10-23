// 编译器测试：DSL → IR 结构、视图绝对化、错误路径、舞台合同 canon 块。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function makeGame(files, mutateManifest) {
  const dir = mkdtempSync(join(tmpdir(), 'nu-compile-'));
  mkdirSync(join(dir, 'chapters'), { recursive: true });
  cpSync(join(root, 'universe'), join(dir, 'universe'), { recursive: true });
  let manifest = {
    code: 'gx', id: 'gx-test', title: 'T', canon: '>=0.2 <1', assumes: [],
    player: { name: '你', voice_hz: 185 },
    chapters: [{ id: 'ch1', title: '一', file: 'ch1.md' }],
  };
  if (mutateManifest) manifest = mutateManifest(manifest);
  writeFileSync(join(dir, 'game.json'), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return { dir, compile: () => compileGame(dir, join(dir, 'universe')) };
}

describe('编译：g00 正作结构', () => {
  const { ir } = compileGame(join(root, 'games/g00-demo'), join(root, 'universe'));

  it('场景标签与结局登记正确', () => {
    for (const label of ['ch1-rooftop', 'ch1-ask-letter', 'ch1-ask-past', 'ch1-bridge', 'ch2-street', 'ch2-wait', 'ch2-alley', 'ch2-truth', 'ch2-miss']) {
      assert.ok(ir.scenes[label], `缺少标签 ${label}`);
    }
    assert.deepEqual(ir.endings.map(e => e.id).sort(), ['END_MISS', 'END_TRUTH', 'END_WAIT']);
  });

  it('章节尾自动续接下一章入口', () => {
    const bridgeNodes = Object.values(ir.nodes).filter(n => n.scene === 'ch1-bridge');
    const last = bridgeNodes[bridgeNodes.length - 1];
    const ch2Entry = ir.nodes[ir.scenes['ch2-street']];
    assert.equal(ir.nodes[last.next], ch2Entry);
  });

  it('视图合同 v0：aview 只含地点 bg（无 show/bgm）', () => {
    const s = ir.nodes[ir.scenes['ch2-street']];
    assert.equal(s.aview.bg.id, 'night-street');
    assert.equal('show' in s.aview, false, 'show 已随立绘体系移除');
    assert.equal('bgm' in s.aview, false, 'bgm 已移除，乐谱属舞台合同 v1');
  });

  it('守卫与 flag 编译正确', () => {
    const alley = ir.nodes[Object.keys(ir.nodes).find(id => ir.nodes[id].scene === 'ch2-alley' && ir.nodes[id].type === 'choice')];
    const guarded = alley.options.find(o => o.when);
    assert.equal(guarded.when, 'fact.ev-rooftop-2019');
    const past = ir.nodes[ir.scenes['ch1-ask-past']];
    assert.ok(past.enter.some(op => op.name === 'fact.ev-rooftop-2019'));
  });

  it('说话者解析到正典角色并携带声线与站位', () => {
    assert.equal(ir.speakers['小桃'].char, 'momo');
    assert.equal(ir.speakers['小桃'].voice_hz, 205);
    assert.equal(ir.speakers['沈砚'].char, 'yan');
    assert.equal(ir.characters.momo.stage.side, 'right');
    assert.equal(ir.characters.yan.stage.side, 'left');
  });

  it('舞台合同 v0：IR 携带纪元过滤后的 canon 摘要块', () => {
    assert.equal(ir.canon.world, '雾川市');
    assert.ok(ir.canon.characters.some(c => c.id === 'momo' && c.voice_hz === 205 && c.stage.side === 'right'));
    assert.ok(ir.canon.characters.some(c => c.id === 'yan' && typeof c.bio_public === 'string'));
    assert.ok(ir.canon.locations.some(l => l.id === 'night-street' && l.mood.rain === true));
    assert.ok(ir.canon.events.some(e => e.id === 'ev-rooftop-2019' && /^\d{4}/.test(e.date)));
    assert.ok(ir.canon.events.every(e => e.disclosed_in === 'g00'), '只携带本作可披露的事件');
    assert.ok(ir.canon.characters.every(c => !('chibi' in c)), 'chibi 字段已移除');
  });
});

describe('编译：错误路径', () => {
  it('跳转目标不存在 → 报错', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n去向不明。\n-> nope\n' });
    assert.throws(g.compile, /跳转目标不存在/);
  });
  it('场景标签重复 → 报错', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n甲。\n# a\n乙。\n' });
    assert.throws(g.compile, /场景标签重复/);
  });
  it('选项后线性落穿 → 报错', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n甲。\n* 选A -> b\n接着说话。\n# b\n乙。\n' });
    assert.throws(g.compile, /选项块之后必须以 "# 标签" 开新场景/);
  });
  it('未知说话者 → 报错', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n路人甲：「我是谁？」\n' });
    assert.throws(g.compile, /未知说话者/);
  });
  it('未知地点 → 报错', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n@bg nowhere\n旁白。\n' });
    assert.throws(g.compile, /未知地点/);
  });
  it('未知指令 → 报错', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n@magic spell\n旁白。\n' });
    assert.throws(g.compile, /未知指令/);
  });
  it('@show 已随立绘体系移除 → 报未知指令', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n@bg rooftop\n@show momo usual\n旁白。\n' });
    assert.throws(g.compile, /未知指令/);
  });
  it('@bgm 已移除 → 报未知指令', () => {
    const g = makeGame({ 'chapters/ch1.md': '# a\n@bg rooftop\n@bgm rain\n旁白。\n' });
    assert.throws(g.compile, /未知指令/);
  });
  it('编译是纯函数：两次编译 IR 深相等', () => {
    const a = compileGame(join(root, 'games/g00-demo'), join(root, 'universe')).ir;
    const b = compileGame(join(root, 'games/g00-demo'), join(root, 'universe')).ir;
    assert.deepEqual(a, b);
  });
});
