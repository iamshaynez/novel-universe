// g03《借刀》叙事合同：时代事实、借刀杀人倒叙诡计、法医逆向指纹、因果回旋与三结局全路线引擎回放。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';
import { enumerateRoutes } from '../engine/graph.mjs';
import { createRun, stateOf, advance, choose } from '../engine/state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chapter = n => readFileSync(join(root, `games/g03-jiedao/chapters/ch${n}.md`), 'utf8');
const ir = compileGame(join(root, 'games/g03-jiedao'), join(root, 'universe')).ir;
const routes = enumerateRoutes(ir);

describe('历史与空间：二〇〇三年深秋真实锚点', () => {
  it('非典余波测温登记、国企下岗改制、东郊泵站与火车北站真实就位', () => {
    const ch0 = chapter(0);
    const ch1 = chapter(1);
    const ch4 = chapter(4);
    const ch5 = chapter(5);

    assert.match(ch0, /@fact ev-g03-murder/);
    assert.match(ch0, /二十五公斤/);
    assert.match(ch0, /铸铁滑轮/);

    assert.match(ch1, /@fact pub-2003-sars/);
    assert.match(ch1, /三十六度四/);
    assert.match(ch1, /半夜面/);

    assert.match(ch4, /@fact pub-1997-soe/);
    assert.match(ch4, /刘建国/);
    assert.match(ch4, /翻砂工/);

    assert.match(ch5, /火车北站/);
    assert.match(ch5, /K192/);
    assert.match(ch5, /成都/);
  });
});

describe('叙事契约与诡计释放阶梯', () => {
  it('ch0 严守宋明受害者视角盲区：只认羊皮大衣、手杖与火机三响，绝不提前泄底刘亮真身', () => {
    const ch0 = chapter(0);
    assert.match(ch0, /羊皮领大衣/);
    assert.match(ch0, /黄铜兽首/);
    assert.match(ch0, /咔嗒/);
    assert.doesNotMatch(ch0, /刘亮|哑巴|替身|骗保/);
  });

  it('ch1 献血证核爆：宋明发现错杀二十二岁少年刘亮，并确立半夜面体温不在场证明', () => {
    const ch1 = chapter(1);
    assert.match(ch1, /四川省无偿献血证/);
    assert.match(ch1, /刘亮/);
    assert.match(ch1, /二十二岁/);
    assert.match(ch1, /B型/);
    assert.match(ch1, /has_blood_card/);
    assert.match(ch1, /alibi_confirmed/);
    assert.doesNotMatch(ch1, /假死脱身|周翠兰合谋/);
  });

  it('ch2 死者午夜来电：韩荣现形致谢，出示录像并逼迫自首或交易', () => {
    const ch2 = chapter(2);
    assert.match(ch2, /韩荣/);
    assert.match(ch2, /枕骨大孔/);
    assert.match(ch2, /谢谢你/);
    assert.match(ch2, /两个选择/);
    assert.match(ch2, /phone_answered/);
  });

  it('ch3 识破法医逆向指纹陷阱与周翠兰三百万意外险骗保合谋', () => {
    const ch3 = chapter(3);
    assert.match(ch3, /紫砂茶杯/);
    assert.match(ch3, /八个特征点/);
    assert.match(ch3, /周翠兰/);
    assert.match(ch3, /参佰万元/);
    assert.match(ch3, /双倍赔付/);
    assert.match(ch3, /has_deduced_trick/);
  });

  it('ch4 道德与因果回旋：宋明揭开六年前亲手排挤刘父的旧账，并在档案室拿到韩荣烫伤铁证', () => {
    const ch4 = chapter(4);
    assert.match(ch4, /改制分流下岗人员终审审批名册/);
    assert.match(ch4, /审核工会干事：宋明/);
    assert.match(ch4, /因公负伤治疗鉴定表/);
    assert.match(ch4, /菱形永久性增生瘢痕/);
    assert.match(ch4, /has_scar_archive/);
  });
});

describe('全结局可达性与引擎真机回放', () => {
  it('六条路径全通，END_TRUTH / END_MISS / END_WRONG 三结局均可达且无死链', () => {
    assert.equal(routes.length, 6);
    for (const route of routes) {
      assert.ok(!['__DEAD__', '__GAP__'].includes(route.ending));
    }
    const endings = new Set(routes.map(r => r.ending));
    assert.deepEqual(endings, new Set(['END_TRUTH', 'END_MISS', 'END_WRONG']));

    for (const route of routes) {
      if (route.ending === 'END_TRUTH') {
        assert.ok(route.flags.has_blood_card);
        assert.ok(route.flags.has_scar_archive);
      }
    }
  });

  it('全部路径经引擎真实回放，结局与旗标完全吻合', () => {
    for (const route of routes) {
      let run = createRun(ir, 42);
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
      for (const [flag, value] of Object.entries(route.flags)) {
        assert.equal(run.flags[flag], value);
      }
    }
  });
});
