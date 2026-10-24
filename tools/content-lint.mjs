// 内容 lint：剧本内容层的客观事实校验，verify 阶段与 canon-lint（剧透纪元）并列运行。
// canon-lint 管「设定引用合不合法」，这里管「文本自己说的实话对不对」：
//   1) 节气-日期一致性——本格玩家会拿笔算日期，写错的节气等于撕毁公平契约；
//   2) 转写溯源——@transcribe 的 target 必须能从同章上文的呼入原话里按序敲出，
//      让玩家「猜改写文」的转写是打字苦役，不是接线员的手艺。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcribeOk } from '../engine/state.mjs';

// 二十四节气表（公历月-日，按年入表）。来源：香港天文台 1901–2100 历表。
// 只有入表的年份参与校验；未入表的年份跳过，不误伤未来作品。
const SOLAR_TERMS = {
  1999: {
    小寒: '01-06', 大寒: '01-20', 立春: '02-04', 雨水: '02-19', 惊蛰: '03-06', 春分: '03-21',
    清明: '04-05', 谷雨: '04-20', 立夏: '05-06', 小满: '05-21', 芒种: '06-06', 夏至: '06-22',
    小暑: '07-07', 大暑: '07-23', 立秋: '08-08', 处暑: '08-23', 白露: '09-08', 秋分: '09-23',
    寒露: '10-09', 霜降: '10-24', 立冬: '11-08', 小雪: '11-23', 大雪: '12-07', 冬至: '12-22',
  },
};
const TERM_NAMES = Object.keys(SOLAR_TERMS[1999]);

// 中文小数字（1–99）→ 数值；纯阿拉伯数字直通。
function cnNum(s) {
  if (/^\d{1,2}$/.test(s)) return parseInt(s, 10);
  const d = { 零: 0, 〇: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (s === '' || [...s].some(c => !(c in d) && c !== '十')) return null;
  if (!s.includes('十')) return d[s];
  const [a, b = ''] = s.split('十');
  if (a === '' && b === '') return 10;
  if (a === '') return 10 + d[b];
  if (b === '') return d[a] * 10;
  return d[a] * 10 + d[b];
}

const dayDiff = (y, m, d, mm, dd) =>
  Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, mm - 1, dd)) / 86400000);

/** 节气-日期一致性。text 为章节原文，year 为故事年代（set_in）。
 *  口径：「X月X日，秋分。」要求当日即节气；「……秋分后N天」要求差恰为 N（不含当天）。 */
export function checkSolarTerms(text, year) {
  const table = SOLAR_TERMS[year];
  if (!table) return []; // 年份未入表：跳过，等作品需要时再补表
  const errs = [];
  const re = new RegExp(
    `([一二两三四五六七八九十]{1,3})月([一二两三四五六七八九十]{1,3}|\\d{1,2})日\\s*[,，]\\s*` +
    `(${TERM_NAMES.join('|')})(?:过?后(?:第)?([一二两三四五六七八九十]{1,3}|\\d{1,2})天)?`, 'g');
  for (const m of text.matchAll(re)) {
    const mo = cnNum(m[1]), day = cnNum(m[2]), term = m[3], after = m[4] ? cnNum(m[4]) : null;
    if (mo == null || day == null) continue;
    const [tm, td] = table[term].split('-').map(Number);
    const diff = dayDiff(year, mo, day, tm, td);
    if (after == null) {
      if (diff !== 0) errs.push(`${mo}月${day}日不是${term}（${year} 年${term}是 ${tm} 月 ${td} 日）`);
    } else if (diff !== after) {
      errs.push(`${term}后${after}天应为 ${tm} 月 ${td + after} 日，文本写的是 ${mo} 月 ${day} 日`);
    }
  }
  return errs;
}

/** 转写溯源：@transcribe 的 target 内容字须按序包含于同章更早出现的某句引语。 */
export function checkTranscribeSource(md) {
  const errs = [];
  const quotes = [...md.matchAll(/「([^」]+)」/g)].map(m => ({ pos: m.index, text: m[1] }));
  for (const m of md.matchAll(/@transcribe\s+(\S+)[^\n]*?target=([^\s\n]+)/g)) {
    const [, tid, target] = m;
    const ok = quotes.some(q => q.pos < m.index && transcribeOk(q.text, target));
    if (!ok) errs.push(`转写 ${tid} 的目标「${target}」无法从同章上文的呼入原话按序敲出——接线员转写原话，不改写`);
  }
  return errs;
}

/** 全章内容 lint：game.json 需声明 set_in 才启用节气校验；转写溯源恒开。 */
export function lintContent(gameDir, manifest) {
  const errs = [];
  const year = manifest?.set_in ? parseInt(manifest.set_in, 10) : null;
  for (const ch of manifest?.chapters ?? []) {
    const md = readFileSync(join(gameDir, 'chapters', ch.file), 'utf8');
    for (const e of checkSolarTerms(md, year)) errs.push(`${ch.id}：${e}`);
    for (const e of checkTranscribeSource(md)) errs.push(`${ch.id}：${e}`);
  }
  return errs;
}
