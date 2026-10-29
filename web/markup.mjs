// 文本实体签名与杂志排版层（ADR-005）：纯函数、无 DOM、无 I/O。
// 剧本零演出标注——实体签名全部由 IR 的 canon 摘要块自动推导（纪元过滤在编译期完成）。
// 防泄底铁律：人物行内签名统一中性墨，不携带个体主题色；个体色只属于正在说话的人
// （声纹卡/锚点），否则「陈先生=廖志坤」这类别名串联会被颜色提前泄底。

// 代词与单字一律不入典：代词是叙诡载体（廖志坤 alias「他」），单字会误伤行文。
const PRONOUNS = new Set(['他', '她', '它', '你', '我', '您', '咱', '谁']);
// 泛用词别名不入典：这些词在普通行文里太常见，行内签名会到处开花。
// （舞台词汇策略，正典字段化列为舞台合同 v1 待办。）
const GENERIC_WORDS = new Set(['老板', '老板娘', '广场', '街机', '院长']);

/** 关键信息语法：日期 / 年份 / 时刻 / 号码 / 中文数码串。
 *  时刻的裸形「一点」是量词（推过来一点），在标注时剔除；带缀（一点半）不受影响。 */
const KEY_SRC = [
  '(?:[〇零一二三四五六七八九十\\d]{1,4}年)?[〇零一二三四五六七八九十\\d]{1,3}月[〇零一二三四五六七八九十\\d]{1,3}[日号]',
  '(?:[〇零一二三四五六七八九十\\d]{1,4}年)?[〇零一二三四五六七八九十\\d]{1,3}月[〇零一二三四五六七八九十]{2,3}(?![日号])',
  '(?:[〇零一二三四五六七八九]{4}|\\d{4})年',
  '[〇零一二三四五六七八九两十\\d]{1,3}点(?:零?[一二三四五六七八九\\d]{1,2}分|过?[一三]刻|过|半|整|钟)?',
  '\\d[\\d\\-]{2,}\\d',
  '\\d{4,}',
  '[〇零一二三四五六七八九]{4,}(?:转[〇零一二三四五六七八九\\d]{1,4})?',
].join('|');

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\\-]/g, '\\$&');
const htmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KIND_CLS = { p: 'ep', x: 'ex', o: 'eo', c: 'ec', u: 'eu', t: 'et' };

/** 从 IR 构建行内签名词典。kind：p=人物 x=地点 o=组织 u=宇宙级客串（class:universe 人物，
 *  永不主角，行文里以传闻与边缘在场出现——灯箱式金墨签名）；c=事件线索（朱砂纸签）；
 *  t=时代词条（ADR-006 图鉴：淡墨点线，提示「这是个老词，图鉴里有它的档案」）；
 *  同词先到先得（人物 > 地点 > 组织 > 事件线索 > 词条）。 */
export function buildLexicon(ir = {}) {
  const canon = ir.canon ?? {};
  const byText = new Map();
  for (const [kind, list] of [['p', canon.characters], ['x', canon.locations], ['o', canon.orgs], ['c', canon.events], ['t', canon.lexicon]]) {
    for (const e of list ?? []) {
      const k = kind === 'p' && e.class === 'universe' ? 'u' : kind;
      const names = kind === 'c' ? [e.title] : [e.name, ...(e.aliases ?? [])];
      for (const name of names) {
        const t = String(name ?? '').trim();
        if (t.length < 2 || PRONOUNS.has(t) || GENERIC_WORDS.has(t)) continue;
        if (!byText.has(t)) byText.set(t, k);
      }
    }
  }
  const alt = [...byText.keys()].sort((a, b) => b.length - a.length).map(reEsc).join('|');
  return {
    kinds: byText,
    // 实体 | 关键信息 | 开引号 —— 实体在前的优先级由交替顺序保证（同位长词由排序保证）
    master: new RegExp(`(${alt || '(?!x)x'})|(${KEY_SRC})|([「『])`, 'gu'),
  };
}

/** 扫描文本 → 标注 token 流。
 *  s=普通字串 p/x/o/c=实体 k=关键信息 qk=短引语（朱批，原子） lq=长引语（含递归 kids）。
 *  短引语判定：『』恒为朱批（≤24 字）；「」内文 ≤12 字且无句末标点。 */
function tokenize(text, lex) {
  const out = [];
  let i = 0;
  const re = lex.master;
  while (i < text.length) {
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) { out.push({ t: 's', s: text.slice(i) }); break; }
    if (m.index > i) out.push({ t: 's', s: text.slice(i, m.index) });
    if (m[1] !== undefined) {
      out.push({ t: lex.kinds.get(m[1]), s: m[1] });
      i = m.index + m[1].length;
    } else if (m[2] !== undefined) {
      // 量词「一点」不是时刻
      out.push(m[2] === '一点' ? { t: 's', s: m[2] } : { t: 'k', s: m[2] });
      i = m.index + m[2].length;
    } else {
      const open = m[3], close = open === '「' ? '」' : '』';
      let d = 1, j = m.index + 1;
      while (j < text.length) {
        if (text[j] === open) d++;
        else if (text[j] === close) { d--; if (d === 0) break; }
        j++;
      }
      if (d !== 0) { out.push({ t: 's', s: open }); i = m.index + 1; continue; }
      const inner = text.slice(m.index + 1, j);
      const short = open === '『' ? inner.length <= 24 : (inner.length <= 12 && !/[。！？…]/.test(inner));
      out.push(short
        ? { t: 'qk', s: open + inner + close }
        : { t: 'lq', open, close, kids: tokenize(inner, lex) });
      i = j + 1;
    }
  }
  return out;
}

const renderTokens = toks => toks.map(tk => {
  if (tk.t === 's') return htmlEsc(tk.s);
  if (tk.t === 'k') return `<span class="ek">${htmlEsc(tk.s)}</span>`;
  if (tk.t === 'qk') return `<span class="qk">${htmlEsc(tk.s)}</span>`;
  if (tk.t === 'lq') return `<span class="lq">${htmlEsc(tk.open)}${renderTokens(tk.kids)}${htmlEsc(tk.close)}</span>`;
  return `<span class="${KIND_CLS[tk.t]}">${htmlEsc(tk.s)}</span>`;
}).join('');

/** 文本 → 带实体签名的 HTML（选项标签、转写提示、底单回看等单串场景）。 */
export function markupText(text, lex) {
  return renderTokens(tokenize(String(text ?? ''), lex));
}

const CUT_ALL = /[。！？…；;]/;   // 任何位置都断拍（引语内也断——句子必须换气）
const CUT_OUT = /[，、,]/;        // 仅引语外断拍（逗顿在引语里是一口气）

/** 引语感知分句：呼吸单元切分。
 *  q=true 的拍属于跨拍引语（演出层给它楷体引文块）；frame=true 表示对话外框
 *  （台词文本以「」整体包裹），外框本身不算引语，框内逗号照常断拍。 */
export function segment(text, { frame = false } = {}) {
  const t = String(text ?? '');
  const out = [];
  let buf = '', depth = 0, qStart = false;
  const base = frame && t.startsWith('「') && closeAt(t, 0) === t.length - 1 ? 1 : 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    buf += c;
    if (c === '「' || c === '『') depth++;
    else if ((c === '」' || c === '』') && depth > 0) depth--;
    const next = t[i + 1] ?? '';
    let cut = false;
    if (CUT_ALL.test(c)) {
      while (c === '…' && t[i + 1] === '…') buf += t[++i]; // 省略号连字整支成拍
      cut = true;
    } else if (c === '—' && next === '—') { buf += next; i++; cut = true; }
    else if (CUT_OUT.test(c)) cut = depth <= base;
    else if (/[.!?]/.test(c)) cut = depth <= base && !/\d/.test(next);
    if (cut) {
      // 断拍后的闭引号/闭括号并入本拍
      while (/^[」』）)]/.test(t[i + 1] ?? '')) {
        buf += t[++i];
        if (t[i] === '」' || t[i] === '』') depth = Math.max(0, depth - 1);
      }
      out.push({ text: buf, q: qStart || depth > base });
      qStart = depth > base;
      buf = '';
    }
  }
  if (buf) out.push({ text: buf, q: qStart || depth > base });
  return out;
}

function closeAt(t, from) {
  let d = 0;
  for (let j = from; j < t.length; j++) {
    if (t[j] === '「') d++;
    else if (t[j] === '」') { d--; if (d === 0) return j; }
  }
  return -1;
}
