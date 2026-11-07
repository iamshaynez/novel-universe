// g02《出线之夜》叙事合同：历史事实、两只钟诡计、揭示顺序、可信度守卫与四结局全路线健康。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';
import { enumerateRoutes } from '../engine/graph.mjs';
import { createRun, stateOf, advance, choose } from '../engine/state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chapter = n => readFileSync(join(root, `games/g02-chuxian/chapters/ch${n}.md`), 'utf8');
const ir = compileGame(join(root, 'games/g02-chuxian'), join(root, 'universe')).ir;
const routes = enumerateRoutes(ir);

describe('历史：这一夜先作为真实公共记忆成立', () => {
  it('五里河、白色球衣、米卢、马明宇、祁宏停赛与于根伟第36分钟进球各就各位', () => {
    const ch1 = chapter(1);
    for (const fact of ['五里河', '白色球衣', '米卢', '马明宇', '祁宏', '于根伟', '第36分钟']) {
      assert.ok(ch1.includes(fact), `缺少历史锚点 ${fact}`);
    }
    assert.match(ch1, /@fact pub-2001-qualify/);
    assert.doesNotMatch(ch1, /已经出线|正式出线/);
  });

  it('1995是八一与翟飚；终场后才明确首次提前两轮出线', () => {
    const ch3 = chapter(3);
    assert.match(ch3, /八一/);
    assert.match(ch3, /翟飚/);
    assert.doesNotMatch(ch3, /最后一轮.{0,12}青岛|马明宇.{0,12}头球/);
    assert.match(chapter(5), /提前两轮/);
  });
});

describe('揭示：两只钟、一拦一送与四层答案按章释放', () => {
  it('ch1 严守陈拾限知视角不泄底「求早退」，且埋下柜门、汉显机习惯、台球课与一拦一送', () => {
    const ch1 = chapter(1);
    assert.ok(ch1.indexOf('柜门') > 0);
    assert.ok(ch1.indexOf('柜门') < ch1.indexOf('冯世昌坐在墙边'));
    assert.doesNotMatch(ch1, /来求过/);
    assert.doesNotMatch(ch1 + chapter(2), /假失窃|计划作者|物理作者|唐国梁递出/);
    assert.match(ch1, /汉显|传呼|呼机/);
    assert.match(ch1, /白球最忌讳跟着进去/);
    assert.ok(ch1.indexOf('呼了他两遍') < ch1.indexOf('第36分钟'), '19:58 一拦须先于第36分钟进球');
    assert.ok(ch1.indexOf('第36分钟') < ch1.indexOf('报个喜'), '进球欢呼须先于唐国梁一送陈拾入室');
  });

  it('假失窃、两只钟对表、母球计划作者分三章递进释放，且兑现可信度守卫', () => {
    const ch2 = chapter(2), ch3 = chapter(3), ch4 = chapter(4), ch5 = chapter(5);
    assert.match(ch2, /未读/);
    assert.doesNotMatch(ch2, /19:52/);
    assert.match(ch3, /假失窃/);
    assert.match(ch3, /28600/);
    assert.match(ch3, /罚单/);
    assert.match(ch4, /开球前/);
    assert.match(ch4, /19:52/);
    assert.match(ch4, /19:57/);
    assert.doesNotMatch(ch4, /物理作者|计划作者/);
    assert.match(ch5, /陈拾来求过|小陈来求过/);
    assert.match(ch5, /对不上就说遭贼/);
    assert.match(ch5, /白球/);
    assert.match(ch5, /\bif hid_copy\b/);
    assert.match(ch5, /\bif told_copy\b/);
  });
});

describe('路线：四个结局与最终选择都兑现', () => {
  it('全路径无死链，E_FULL / E_LEAVE / E_WRONG / E_RUN 四结局均可达', () => {
    assert.ok(routes.length >= 8);
    for (const route of routes) assert.ok(!['__DEAD__', '__GAP__'].includes(route.ending));
    assert.deepEqual(
      new Set(routes.map(route => route.ending)),
      new Set(['E_FULL', 'E_LEAVE', 'E_WRONG', 'E_RUN']),
    );
    for (const route of routes) {
      if (route.ending === 'E_FULL') {
        assert.ok(route.flags.full_confession);
        assert.ok(route.flags.time_solved);
      }
      if (route.ending === 'E_LEAVE') {
        assert.ok(route.flags.self_only);
        assert.ok(route.flags.time_solved);
      }
      if (route.ending === 'E_WRONG') assert.ok(route.flags.wrong_clock);
      if (route.ending === 'E_RUN') assert.ok(route.flags.fled_alley);
    }
  });

  it('全部路线经真实引擎回放，结局与旗标完全一致', () => {
    for (const route of routes) {
      let run = createRun(ir, 7);
      let state = stateOf(ir, run);
      const queue = [...route.choices];
      let guard = 0;
      while (state.kind !== 'ending') {
        assert.ok(++guard < 2000, `步数超限 ${route.choices.join('→')}`);
        if (state.kind === 'choice') {
          const index = queue.shift();
          assert.ok(Number.isInteger(index), '选择序列提前耗尽');
          run = choose(run, ir, index);
        } else {
          run = advance(run, ir);
        }
        state = stateOf(ir, run);
      }
      assert.equal(state.endingId, route.ending);
      for (const [flag, value] of Object.entries(route.flags)) assert.equal(run.flags[flag], value);
    }
  });

  it('作品不使用 g01 转写或第二人称叙诡', () => {
    assert.ok(!Object.values(ir.nodes).some(node => node.type === 'transcribe'));
    assert.equal(ir.reading, null);
    const all = [1, 2, 3, 4, 5].map(chapter).join('\n');
    assert.doesNotMatch(all, /^你：/m);
  });
});
