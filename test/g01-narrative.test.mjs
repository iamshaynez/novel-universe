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

  it('两位假协查不混淆：外貌区分、空间分工与信息递进各就各位', () => {
    const a2b = after(chapter(3), '# chA2b').split('# chA2c')[0];
    assert.match(a2b, /四十来岁/, '廖的辨认特征在 11.5 给出');
    assert.doesNotMatch(a2b, /也是遗物登记/, '他翻的内容不得在 11.5 提前泄出');
    assert.match(chapter(4), /上回跟你提过的那个男老师/, 'R4 递进追问同一人的内容');
    assert.match(chapter(5), /台里我白天一回都没去过/, '空间分工：台里白天=苏晚，派出所与夜档=廖');
    assert.match(chapter(5), /你前脚走，我后脚到/, '廖如何得知她追问须有来源');
  });

  it('E3 苏晚照常上班并重新点起铅笔点，廖带手抄本去桥头', () => {
    const e3 = after(chapter(5), '# E3');
    assert.match(e3, /照常|上班/);
    assert.match(e3, /第一个点/);
    assert.match(e3, /手抄本/);
    assert.doesNotMatch(e3, /一个深夜/);
  });

  it('E1 的向师傅仍修传呼机，不出现修行情机', () => {
    const ch5 = chapter(5);
    assert.doesNotMatch(ch5, /修行情机/);
    assert.match(ch5, /修传呼机的向师傅/);
  });

  it('盲测修复：ch2 开篇即交代溺亡前提，ch1/ch2 正文显式报出 333-1188 与 901-7544', () => {
    const ch1 = chapter(1);
    const ch2 = chapter(2);
    assert.match(ch1, /333-1188/, 'ch1 正文须出现第一次催债回电号 333-1188');
    assert.match(ch2.split('# chA1-archive')[0], /府南河|打捞|落水/, 'ch2 开篇须交代贺青禾溺亡背景');
    const beforeT4 = after(ch2, '# chR2').split('@transcribe t4')[0];
    assert.match(beforeT4, /901-7544/, 'ch2 R2 转写前须显式报出新回电号 901-7544');
  });

  it('盲测修复：呼机不瞬移、茶铺修机匠不撞梗微咳、布鞋有路灯照明前提、E1 不向死者父亲瞒报', () => {
    const ch3 = chapter(3);
    const ch4 = chapter(4);
    const ch5 = chapter(5);
    assert.doesNotMatch(ch3, /微咳的修机匠/, '茶铺路人不得撞梗核心咳嗽声纹线索');
    assert.doesNotMatch(ch3, /竟然还有点余电/, '泡水十天的呼机不应在出租屋窗台亮屏瞬移');
    assert.match(ch3, /皮套/, '出租屋窗台只留空呼机皮套，实物在贺国栋手中');
    assert.doesNotMatch(ch4.split('# chA3-bridge')[0], /它这会儿就贴在你自己身上/, 'ch4 A3 不得吞没 original_locker 分支');
    assert.match(ch5, /桥头路灯|路灯底下/, '廖志坤看清布鞋须有桥头路灯物理照明前提');
    const e1 = after(ch5, '# E1').split('# E2')[0];
    assert.doesNotMatch(e1, /我张了张嘴，答不上来/, 'E1 苏晚面对贺国栋不再隐瞒出门钟点');
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

  it('当夜原话与发出话在 t9 之前都已成立，删改的九个字有凭据', () => {
    const beforeT9 = chapter(3).split('@transcribe t9')[0];
    assert.match(beforeT9, /等你到十二点/);
    assert.match(beforeT9, /来不来，你自己定/);
    assert.match(beforeT9, /算了。不呼了/);
    const t9 = Object.values(ir.nodes).find(n => n.type === 'transcribe' && n.transId === 't9');
    assert.equal(t9.target, '十点，老地方，河对岸等你。就这样。');
    assert.ok(!t9.target.includes('你自己定'), '发出的话不得保留被删掉的选择权');
  });

  it('全图路线中的双轨流转：记录轨、走访轨与汇流精确交错且终局汇流', async () => {
    const { currentTrackInfo } = await import('../web/reading-aids.mjs');
    const run = createRun(ir, 7);
    let st = stateOf(ir, run);
    const initialTrack = currentTrackInfo(ir, st);
    assert.equal(initialTrack.id, 'record');
    assert.equal(initialTrack.symbol, '耳');

    // 验证 chA1 归属走访轨
    const a1State = { ...st, node: 'chA1', chapter: 'ch2' };
    assert.equal(currentTrackInfo(ir, a1State).id, 'visit');
    assert.equal(currentTrackInfo(ir, a1State).symbol, '街');

    // 验证 chF 归属汇流
    const fState = { ...st, node: 'chF', chapter: 'ch5' };
    assert.equal(currentTrackInfo(ir, fState).id, 'convergence');
    assert.equal(currentTrackInfo(ir, fState).converged, true);
  });

  it('t9 强制选择：廖的原话作为选项在场，点了被注记驳回，只有紧的入机', () => {
    const t9 = Object.values(ir.nodes).find(n => n.type === 'transcribe' && n.transId === 't9');
    assert.equal(t9.full, '老地方，河对岸，等你到十二点。来不来，你自己定。就这样。', '原话必须在选项里');
    assert.ok((t9.note ?? '').includes('紧一紧'), '点原话的驳回注记必须是那句胁迫');
    let run = { ...createRun(ir), nodeId: t9.id };
    let st = stateOf(ir, run);
    const fi = st.options.indexOf(t9.full);
    assert.ok(fi >= 0, '原话在选项里');
    const miss = submitPick(run, ir, fi);
    assert.equal(miss.nodeId, t9.id, '点原话不得入机');
    assert.equal(miss.trMisses.t9 ?? 0, 1, '点原话计一次 miss');
    st = stateOf(ir, miss);
    const ok = submitPick(miss, ir, st.options.indexOf(t9.target));
    assert.ok(ok.flags['tr.t9'], '只有紧的那条能点亮入机');
  });

  it('终章对稿钉死差值：原话、发出话、「哪个删的」与十点四十七同场，三物件仪式各成一拍', () => {
    const ch5 = chapter(5);
    assert.match(ch5, /来不来，你自己定/);
    assert.match(ch5, /哪个删的/);
    assert.match(ch5, /十点四十七/);
    assert.match(ch5, /她穿布鞋，走那种路/);
    assert.match(ch5, /我会水/);
    assert.match(ch5, /\n.*手抄本.*捻起了毛。\n.*底单.*摊平。.*焐.*\n.*最后铺.*对照纸。\n/);
    assert.doesNotMatch(chapter(3), /三千块/, '三千块学费借条只属于终章忏悔，不在 R3 提前泄出');
  });

  it('E1 上交有凭据；E2 真相交父亲；E3 廖亲述，纸证各自结清', () => {
    assert.ok(routes.length > 0);
    for (const r of routes) {
      if (r.ending === 'E1') {
        assert.ok(r.flags.can_indict, 'E1 必须先留安全副本');
        assert.ok(r.flags.evidence_submitted, 'E1 必须登记上交事实');
      }
      if (r.ending === 'E2') assert.ok(r.flags.evidence_to_father, 'E2 必须登记真相交父亲');
      if (r.ending === 'E3') assert.ok(r.flags.lzk_to_bridge, 'E3 必须登记廖去桥头亲述');
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
