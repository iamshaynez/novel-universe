// 内容 lint 场景测试：剧本内容的客观事实校验。
// 1) 节气-日期一致性：本格玩家会拿笔算日期，写错的节气等于撕毁公平契约；
// 2) 转写溯源：@transcribe 的 target 必须能从同章上文的呼入原话里按序敲出——
//    让玩家「猜改写文」的转写是打字苦役，不是接线员的手艺。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintContent, checkSolarTerms, checkTranscribeSource, checkPeaks } from '../tools/content-lint.mjs';
import { compileGame } from '../tools/compile-scenario.mjs';
import { readFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('场景：节气-日期一致性（1999 年表）', () => {
  it('「九月二十八日，秋分。」应报错（1999 年秋分是 9 月 23 日）', () => {
    const errs = checkSolarTerms('九月二十八日，秋分。距离那件事，还有二十八天。', 1999);
    assert.ok(errs.length === 1 && errs[0].includes('秋分'), JSON.stringify(errs));
  });

  it('「九月二十三日，秋分。」通过', () => {
    assert.deepEqual(checkSolarTerms('九月二十三日，秋分。', 1999), []);
  });

  it('「十月二十六日，霜降后两天。」通过（霜降 10 月 24 日，不含当天计）', () => {
    assert.deepEqual(checkSolarTerms('十月二十六日，霜降后两天。', 1999), []);
  });

  it('「十月二十六日，霜降后四天。」应报错（至多后两天）', () => {
    const errs = checkSolarTerms('十月二十六日，霜降后四天。', 1999);
    assert.ok(errs.length === 1 && errs[0].includes('霜降'), JSON.stringify(errs));
  });

  it('「白露过后第七天」以同句日期核对（9 月 14 日应报错，9 月 15 日通过）', () => {
    assert.ok(checkSolarTerms('九月十四日，白露过后第七天。', 1999).length === 1);
    assert.deepEqual(checkSolarTerms('九月十五日，白露过后第七天。', 1999), []);
  });

  it('未知年份跳过（只有 1999 年入了表，别的内容不误伤）', () => {
    assert.deepEqual(checkSolarTerms('九月二十八日，秋分。', 2003), []);
  });
});

describe('场景：转写溯源（target 须按序来自同章上文引语）', () => {
  const md = (quote, target) =>
    `# s1\n${quote}\n@transcribe t1 caller=测试 target=${target}\n`;

  it('target 是呼入原话的逐字子串 → 通过', () => {
    assert.deepEqual(checkTranscribeSource(md('「呼我儿——降温了哈，被子换成厚的，莫要嘴硬。念你。」', '降温了，被子换成厚的。念你。')), []);
  });

  it('target 含原话里没有的措辞（改写文）→ 报错', () => {
    const errs = checkTranscribeSource(md('「新到了一批打口碟，给你留了最后两张，就来。」', '打口碟到了，给你留了最后两张。'));
    assert.ok(errs.length === 1 && errs[0].includes('t1'), JSON.stringify(errs));
  });

  it('target 出现在 @transcribe 之前的引语才作数（后文不算）', () => {
    const errs = checkTranscribeSource('# s1\n@transcribe t1 caller=测试 target=事后才说的话\n「事后才说的话。」\n');
    assert.ok(errs.length === 1, JSON.stringify(errs));
  });
});

describe('场景：@peak 演出预算与词表（满屏都在喊，就没有惊讶了）', () => {
  it('合法 kind 且在预算内 → 通过', () => {
    assert.deepEqual(checkPeaks('@peak inner\n一句。\n@peak desk t3,t4\n一句。\n@peak dead 22:47\n一句。\n'), []);
    for (const k of ['collapse', 'retype', 'split']) {
      assert.deepEqual(checkPeaks(`@peak ${k}${k === 'retype' ? ' 老地方' : ''}\n一句。\n`), [], k);
    }
  });

  it('词表外 kind → 报错', () => {
    const errs = checkPeaks('@peak fireworks\n一句要炸的话。\n');
    assert.ok(errs.length === 1 && errs[0].includes('fireworks'), JSON.stringify(errs));
  });

  it('本章超 3 处 → 报错', () => {
    const md = ['@peak inner', '@peak inner', '@peak inner', '@peak inner'].join('\n一句。\n') + '\n一句。\n';
    const errs = checkPeaks(md);
    assert.ok(errs.some(e => e.includes('超预算')), JSON.stringify(errs));
  });
});

describe('场景：真实 g01 全量内容 lint', () => {
  it('g01 五章零报错（节气、转写溯源与峰值预算）', () => {
    const errs = lintContent(
      join(root, 'games/g01-jiexianyuan'),
      JSON.parse(readFileSync(join(root, 'games/g01-jiexianyuan/game.json'), 'utf8')),
    );
    assert.deepEqual(errs, []);
    // 顺带守住 g01 仍可编译（内容 lint 不应绕过编译）
    assert.ok(compileGame(join(root, 'games/g01-jiexianyuan'), join(root, 'universe')).ir);
  });
  it('g01 六个峰值拍在册（inner/dead/desk/collapse/retype/split 各就其位）', () => {
    const peaks = [];
    for (const f of ['ch1.md', 'ch2.md', 'ch3.md', 'ch4.md', 'ch5.md']) {
      const md = readFileSync(join(root, 'games/g01-jiexianyuan/chapters', f), 'utf8');
      for (const m of md.matchAll(/@peak\s+(\S+)/g)) peaks.push(m[1]);
    }
    assert.deepEqual(peaks.sort(), ['collapse', 'dead', 'desk', 'inner', 'retype', 'split']);
  });
});
