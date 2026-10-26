// g01 叙事合同：双「你」的知识边界、时间因果、证物流与结局反馈。
// 只锁故事必须满足的事实，不锁整篇措辞，给文学修订保留空间。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';
import { enumerateRoutes } from '../engine/graph.mjs';
import { createRun, stateOf, advance, choose, submitPick } from '../engine/state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chapter = n => readFileSync(join(root, `games/g01-jiexianyuan/chapters/ch${n}.md`), 'utf8');
const character = id => JSON.parse(readFileSync(join(root, `universe/characters/${id}.json`), 'utf8'));
const after = (text, marker) => text.slice(text.indexOf(marker));

describe('场景：苏晚只能调用自己经历过的事实', () => {
  it('E3 不回忆廖线路的雨靴与三根火柴，终章也不凭空知道青禾工资', () => {
    const ch5 = chapter(5);
    const e3 = after(ch5, '# E3');
    assert.doesNotMatch(e3, /雨靴|火柴划了三根|老金划了三根/);
    assert.doesNotMatch(ch5, /三百二/);
    assert.doesNotMatch(ch5, /话烧不脱/);
  });

  it('十点四十七才送达的留言，终章必须回应这个时间因果', () => {
    const ch5 = chapter(5);
    assert.match(ch5, /十点四十七/);
    assert.doesNotMatch(ch5, /她拖到十一点才动身/);
  });
});

describe('场景：时间和关键记忆在首次发生时就已成立', () => {
  it('九月十四到九月二十八是十四天，不是上个月', () => {
    assert.match(chapter(2), /十四天前那位「陈先生」/);
  });

  it('按重、删掉、重打在致命留言当夜就有，不在终章补写', () => {
    const beforeT9 = chapter(3).split('@transcribe t9')[0];
    assert.match(beforeT9, /按重/);
    assert.match(beforeT9, /重打/);
  });

  it('A1 空出的三张座席与调查者站在隔板外的动作必须一致', () => {
    const ch2 = chapter(2);
    assert.match(ch2, /白班六个座席只有三个有人/);
    assert.match(ch2, /白班的座席空着三张/);
    assert.doesNotMatch(ch2, /白班的座席都有人用/);
  });

  it('夜班十点到次日八点覆盖案发夜全部转写，清晨碰面也留有交班余量', () => {
    const ch2 = chapter(2);
    const ch3 = chapter(3);
    assert.match(ch2, /晚十点到次日八点/);
    assert.match(ch2, /离交班还有两个小时/);
    assert.doesNotMatch(ch3, /晚上九点五十|那八个小时/);
    assert.match(ch3, /晚上十点。333-1188/);
  });

  it('E3 保留白班去向，新号来电不能在无解释的深夜', () => {
    const e3 = after(chapter(5), '# E3');
    assert.match(e3, /转了白班/);
    assert.doesNotMatch(e3, /一个深夜/);
    assert.match(e3, /下午|傍晚|交班/);
  });

  it('E1 的向师傅仍修传呼机，不出现修行情机', () => {
    const ch5 = chapter(5);
    assert.doesNotMatch(ch5, /修行情机/);
    assert.match(ch5, /修传呼机的向师傅/);
  });
});

describe('场景：正典只记录已经建立的人物事实', () => {
  it('青禾的十一点动身与致命犹豫不再被全知档案写成定论', () => {
    const text = JSON.stringify(character('heqinghe'));
    assert.doesNotMatch(text, /十一点才动身/);
    assert.doesNotMatch(text, /犹豫是她的致命处/);
  });

  it('最后一条留言的时间依赖不能反向指向随后的坠河', () => {
    const timeline = JSON.parse(readFileSync(join(root, 'universe/timeline.json'), 'utf8'));
    const message = timeline.events.find(e => e.id === 'ev-g01-message');
    assert.ok(!(message.depends_on ?? []).includes('ev-g01-heqinghe'));
    assert.doesNotMatch(message.summary, /引向修路的黑岸/);
  });

  it('老彭的女儿年龄、秦姐的字条年限与廖的回电号数量自洽', () => {
    assert.doesNotMatch(character('laopeng').profile.background, /和贺青禾差不多年纪/);
    assert.doesNotMatch(JSON.stringify(character('qinjie')), /六年没换|压在柜面玻璃下六年|字条六年/);
    assert.doesNotMatch(JSON.stringify(character('liaozhikun')), /三个呼号|三个回电号/);
  });
});

describe('场景：每条结局路线都结清自己造成的证据状态', () => {
  const ir = compileGame(join(root, 'games/g01-jiexianyuan'), join(root, 'universe')).ir;
  const routes = enumerateRoutes(ir);

  it('E3 新号转写的 HUD 日期与舞台昼夜也进入二〇〇〇年夏季白天', () => {
    const t10 = Object.values(ir.nodes).find(n => n.type === 'transcribe' && n.transId === 't10');
    const st = stateOf(ir, { ...createRun(ir), nodeId: t10.id });
    assert.match(st.date ?? '', /二〇〇〇年/);
    assert.match(st.date ?? '', /夏/);
    assert.equal(st.view?.bg?.params?.time, 'day');
  });

  it('E1 上交有凭据；E2/E3 无论副本在哪都完成结清', () => {
    assert.ok(routes.length > 0);
    for (const r of routes) {
      if (r.ending === 'E1') {
        assert.ok(r.flags.can_indict, 'E1 必须先留安全副本');
        assert.ok(r.flags.evidence_submitted, 'E1 必须登记上交事实');
      }
      if (r.ending === 'E2') {
        assert.ok(r.flags.copies_resolved, 'E2 必须处理锁柜/杜鹃/无副本三种状态');
        assert.ok(r.flags.evidence_burned, 'E2 必须登记证物烧毁事实');
      }
      if (r.ending === 'E3') {
        assert.ok(r.flags.copies_resolved, 'E3 必须处理锁柜/杜鹃/无副本三种状态');
        assert.ok(r.flags.evidence_surrendered, 'E3 必须登记证物交出事实');
      }
    }
  });

  it('不留副本也能尝试上交，并得到场景内失败反馈后转向其余结局', () => {
    const attempts = routes.filter(r => r.flags.no_copy && r.flags.indict_attempted);
    assert.ok(attempts.length > 0, '无副本路径没有上交尝试场景');
    for (const r of attempts) assert.notEqual(r.ending, 'E1', '无副本的犹豫尝试不应直接变成完整 E1');
  });

  it('全部选项路线都经真实引擎回放，转写、门禁与结局旗标逐一兑现', () => {
    for (const route of routes) {
      let run = createRun(ir, 7);
      let st = stateOf(ir, run);
      const queue = [...route.choices];
      let guard = 0;
      while (st.kind !== 'ending') {
        assert.ok(++guard < 2000, `路线步数超限: ${route.choices.join('→')}`);
        if (st.kind === 'choice') {
          const index = queue.shift();
          assert.ok(Number.isInteger(index), '选择序列提前耗尽');
          run = choose(run, ir, index);
        } else if (st.kind === 'transcribe') {
          run = submitPick(run, ir, st.options.indexOf(st.target));
        } else {
          run = advance(run, ir);
        }
        st = stateOf(ir, run);
      }
      assert.equal(st.endingId, route.ending, `结局不符: ${route.choices.join('→')}`);
      for (const [flag, value] of Object.entries(route.flags)) {
        assert.equal(run.flags[flag], value, `旗标 ${flag} 不符: ${route.choices.join('→')}`);
      }
    }
  });
});
