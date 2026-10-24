// 文本实体签名与杂志排版层（ADR-005）：纯函数，无 DOM。
// 合同：词典只从 canon 摘要块推导（纪元过滤已在编译期完成）；人物行内签名统一中性墨，
// 不携带个体主题色——别名串联（陈先生=廖志坤）不得被颜色提前泄底。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';
import { buildLexicon, segment, markupText } from '../web/markup.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ir: g00 } = compileGame(join(root, 'test/fixtures/games/g00-demo'), join(root, 'test/fixtures/universe'));

const synth = (canon = {}) => buildLexicon({ canon: { characters: [], locations: [], orgs: [], ...canon } });
const EMPTY = synth();
const JIEXIAN = synth({
  characters: [
    { id: 'liaozhikun', name: '廖志坤', aliases: ['他', '陈先生', '刘先生'], stage: { theme: '#e0523f' }, class: 'cast' },
    { id: 'dujuan', name: '杜鹃', aliases: ['杜鹃'], stage: { theme: '#ffd9a3' }, class: 'cast' },
    { id: 'xiaowen', name: '潇文', aliases: ['望哥', '老板'], class: 'universe' },
    { id: 'wanglei', name: '王磊', aliases: ['街机', '磊哥'], class: 'universe' },
  ],
  locations: [
    { id: 'chuantai', name: '锦声传呼台', aliases: ['传呼台'] },
    { id: 'tianfu', name: '天府广场', aliases: ['广场'] },
  ],
  orgs: [{ id: 'org-quanxing', name: '四川全兴足球俱乐部', aliases: ['全兴', '川军'] }],
});

describe('标注层：词典从 canon 摘要块自动推导', () => {
  it('正作 IR 可直接建词典：人物名与别名获签名，单字别名不入典', () => {
    const lex = buildLexicon(g00);
    assert.equal(markupText('小桃坐在水箱上。', lex), '<span class="ep">小桃</span>坐在水箱上。');
    assert.equal(markupText('沈砚来了。', lex), '<span class="ep">沈砚</span>来了。');
    assert.equal(markupText('桃子熟了。', lex), '桃子熟了。', '单字别名「桃」会误伤行文，不入典');
  });

  it('人物行内签名是中性墨：同一人的本名与别名同款，且全程不输出任何 style 属性', () => {
    const a = markupText('廖志坤。', JIEXIAN), b = markupText('陈先生。', JIEXIAN);
    assert.equal(a, '<span class="ep">廖志坤</span>。');
    assert.equal(b, '<span class="ep">陈先生</span>。');
    assert.ok(!/style=|#e0523f/.test(a + b), '个体主题色只属于正在说话的人（声纹卡/锚点），行内不得携带');
  });

  it('代词与泛用词别名不入典（叙诡防泄底 + 防误伤行文）', () => {
    assert.equal(markupText('他要的是钱，她晓得。', JIEXIAN), '他要的是钱，她晓得。');
    assert.equal(markupText('老板在柜台后头。', JIEXIAN), '老板在柜台后头。');
    assert.equal(markupText('康乐街机城的电子音。', JIEXIAN), '康乐街机城的电子音。');
    assert.equal(markupText('广场上风大。', JIEXIAN), '广场上风大。');
  });

  it('地名与组织各有签名类，长词优先覆盖短别名', () => {
    assert.equal(markupText('锦声传呼台的玻璃门。', JIEXIAN), '<span class="ex">锦声传呼台</span>的玻璃门。');
    assert.equal(markupText('传呼台在二楼。', JIEXIAN), '<span class="ex">传呼台</span>在二楼。');
    assert.equal(markupText('全兴赢了。', JIEXIAN), '<span class="eo">全兴</span>赢了。');
    assert.equal(markupText('天府广场。', JIEXIAN), '<span class="ex">天府广场</span>。', '全名胜过被屏蔽的短别名');
  });

  it('不在 canon 块里的名字不签名——纪元过滤由编译器保证，演出层不越权', () => {
    assert.equal(markupText('贺青禾在河对岸。', JIEXIAN), '贺青禾在河对岸。');
  });

  it('宇宙级客串签名 eu：universe 类人物名与别名皆获灯箱签名，cast 仍 ep，仍是中性墨', () => {
    assert.equal(markupText('望哥的灯亮着。', JIEXIAN), '<span class="eu">望哥</span>的灯亮着。');
    assert.equal(markupText('潇文笑了。', JIEXIAN), '<span class="eu">潇文</span>笑了。');
    assert.equal(markupText('杜鹃交班。', JIEXIAN), '<span class="ep">杜鹃</span>交班。');
    assert.ok(!markupText('望哥的灯亮着。', JIEXIAN).includes('style='), '客串签名不携带个体色（防泄底铁律）');
  });
});

describe('标注层：g01 实战（宇宙客串出道）', () => {
  const { ir: g01 } = compileGame(join(root, 'games/g01-jiexianyuan'), join(root, 'universe'));
  const lex = buildLexicon(g01);

  it('向师傅两处现身均为 eu 客串签名（正典别名入典）', () => {
    assert.equal(markupText('修机的向师傅那台座机又串音。', lex),
      '修机的<span class="eu">向师傅</span>那台座机又串音。');
    assert.ok(markupText('斜对面修行情机的向师傅的灯箱刚刚亮起。', lex).includes('<span class="eu">向师傅</span>'));
  });
});

describe('标注层：关键信息（日期 / 时刻 / 号码）', () => {
  const cases = ['一九九九年六月四日', '九月十四日', '九月二十八日', '十月二十六', '一九九九年', '二〇〇一年',
    '十点零七分', '十一点过', '零点过一刻', '十点半', '6688-7', '333-1188', '六六八八转七'];
  for (const c of cases) {
    it(`「${c}」整块成关键信息`, () => {
      assert.equal(markupText(`${c}。`, EMPTY), `<span class="ek">${c}</span>。`);
    });
  }

  it('语境前缀词（深夜/晚上/凌晨）留在块外', () => {
    assert.equal(markupText('深夜十一点，', EMPTY), '深夜<span class="ek">十一点</span>，');
    assert.equal(markupText('晚上十点半。', EMPTY), '晚上<span class="ek">十点半</span>。');
  });

  it('「一点」是量词不是时刻；「二十四张」不是号码', () => {
    assert.equal(markupText('他把手抄本推过来一点。', EMPTY), '他把手抄本推过来一点。');
    assert.equal(markupText('二十四张座席。', EMPTY), '二十四张座席。');
    assert.equal(markupText('距离那件事，还有二十八天。', EMPTY), '距离那件事，还有二十八天。');
  });

  it('实体优先于数字：组织别名 420 不被当成号码', () => {
    const lex = synth({ orgs: [{ id: 'o', name: '420厂', aliases: ['420'] }] });
    assert.equal(markupText('420的人。', lex), '<span class="eo">420</span>的人。');
  });
});

describe('标注层：引语语法（短引语=朱批，长引语=楷体引文）', () => {
  it('短引语整体朱批，括号一并染色', () => {
    assert.equal(markupText('你在「宽限」旁边点了一个点。', EMPTY), '你在<span class="qk">「宽限」</span>旁边点了一个点。');
    assert.equal(markupText('「念你」两个字最贵。', EMPTY), '<span class="qk">「念你」</span>两个字最贵。');
  });

  it('『』嵌套引语恒为朱批，即便带逗号', () => {
    assert.equal(markupText('喊她『老地方』。', EMPTY), '喊她<span class="qk">『老地方』</span>。');
    assert.equal(markupText('『钱的事，再宽限几天』——', EMPTY), '<span class="qk">『钱的事，再宽限几天』</span>——');
  });

  it('朱批是原子的：引语内的实体与数字不再单独签名', () => {
    assert.equal(markupText('上个月那位「陈先生」也是这个调子。', JIEXIAN), '上个月那位<span class="qk">「陈先生」</span>也是这个调子。');
    assert.equal(markupText('「锦声传呼台」的玻璃门后。', JIEXIAN), '<span class="qk">「锦声传呼台」</span>的玻璃门后。');
  });

  it('长引语成楷体引文，内部关键信息与实体照常签名', () => {
    const out = markupText('「今晚十点，长街尽头的茶寮。雨停之前，把话说完。」', EMPTY);
    assert.equal(out, '<span class="lq">「今晚<span class="ek">十点</span>，长街尽头的茶寮。雨停之前，把话说完。」</span>');
    const out2 = markupText('「6688-7 频呼，注意文明用语」。', EMPTY);
    assert.equal(out2, '<span class="lq">「<span class="ek">6688-7</span> 频呼，注意文明用语」</span>。');
  });

  it('未闭合引号按普通字处理，不抛错', () => {
    assert.equal(markupText('他说「就这样', EMPTY), '他说「就这样');
    assert.equal(markupText('就这样」他说', EMPTY), '就这样」他说');
  });
});

describe('标注层：引语感知分句（呼吸节奏）', () => {
  const texts = s => segment(s).map(p => p.text);
  const flags = s => segment(s).map(p => p.q);

  it('普通叙述：句末与逗顿都断拍', () => {
    assert.deepEqual(texts('一九九九年六月四日，夜。'), ['一九九九年六月四日，', '夜。']);
    assert.deepEqual(flags('一九九九年六月四日，夜。'), [false, false]);
  });

  it('引语之内逗号不换气，句号照常断拍，整段标记为引语块', () => {
    const s = '「呼我儿——降温了哈，被子换成厚的，莫要嘴硬。你老汉儿风湿又犯了，念你。」';
    assert.deepEqual(texts(s), ['「呼我儿——', '降温了哈，被子换成厚的，莫要嘴硬。', '你老汉儿风湿又犯了，念你。」']);
    assert.deepEqual(flags(s), [true, true, true]);
  });

  it('对话外框（frame）不算引语：台词内逗号照常断拍，不进引语块', () => {
    const s = '「交接了哈。今晚呼量不大，你莫拦。」';
    const segs = segment(s, { frame: true });
    assert.deepEqual(segs.map(p => p.text), ['「交接了哈。', '今晚呼量不大，', '你莫拦。」']);
    assert.deepEqual(segs.map(p => p.q), [false, false, false]);
  });

  it('对话外框内的嵌套引语仍然原子', () => {
    const segs = segment('「因为除了『一定会来的人』，我不知道还能相信谁。」', { frame: true });
    assert.deepEqual(segs.map(p => p.text), ['「因为除了『一定会来的人』，', '我不知道还能相信谁。」']);
  });

  it('闭引号并入本拍；破折号与省略号整支成拍', () => {
    assert.deepEqual(texts('他喊了一声「莫慌」，转身就走。'), ['他喊了一声「莫慌」，', '转身就走。']);
    assert.deepEqual(texts('有一栏被红笔圈过——「6688-7 频呼，注意文明用语」。'), ['有一栏被红笔圈过——', '「6688-7 频呼，注意文明用语」。']);
    assert.deepEqual(texts('她：「……你是谁。」'.slice(2)), ['「……', '你是谁。」']);
  });

  it('分句无损：任何文本重组后与原文逐字相等', () => {
    for (const s of ['十一点四十分。', '「麻烦你，呼六六八八转七。留言——钱的事，再宽限几天。就这样。」',
      '你盯着底单看了两秒。这个人客气得——怎么说呢，客气得像把刀包在了帕子里。', '', '无标点一整句']) {
      assert.equal(segment(s).map(p => p.text).join(''), s);
    }
  });
});

describe('标注层：转义与健壮性', () => {
  it('HTML 特殊字符转义，实体签名不被注入', () => {
    assert.equal(markupText('a<b>&"c', EMPTY), 'a&lt;b&gt;&amp;&quot;c');
  });
  it('空输入与空词典安全', () => {
    assert.equal(markupText('', EMPTY), '');
    assert.equal(markupText(null, EMPTY), '');
    assert.deepEqual(segment(''), []);
    assert.equal(markupText('纯文本', buildLexicon({})), '纯文本');
  });
});
