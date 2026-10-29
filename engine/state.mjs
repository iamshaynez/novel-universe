// VN 引擎内核：纯函数、无 I/O、无 DOM。
// 合同：(IR, 选择序列, seed) → 演进结果恒定；存档即 run 快照。
import { visibleOptions } from './graph.mjs';

export function createRun(ir, seed = 1) {
  const run = { nodeId: ir.entry, flags: {}, affinity: {}, choiceLog: [], seed, ended: null, trLog: {}, trMisses: {} };
  const n = ir.nodes[ir.entry];
  applyEnter(run, n);
  if (n.type === 'ending') run.ended = n.endingId;
  return run;
}

export function applyOp(run, op) {
  if (op.op === 'flag') run.flags[op.name] = op.value ?? true;
  else if (op.op === 'affinity') run.affinity[op.who] = (run.affinity[op.who] ?? 0) + op.delta;
  else throw new Error(`applyOp: 未知指令 ${op.op}`);
}

function applyEnter(run, node) {
  for (const op of node.enter ?? []) applyOp(run, op);
}

export function stateOf(ir, run) {
  const n = ir.nodes[run.nodeId];
  if (!n) return { kind: 'void', flags: { ...run.flags } };
  const base = {
    node: run.nodeId,
    chapter: n.chapter,
    chapterTitle: ir.chapters.find(c => c.id === n.chapter)?.title ?? n.chapter,
    flags: { ...run.flags },
    view: n.aview ?? null,
    peak: n.peak ?? null, // 峰值拍标记（舞台合同 v1）：引擎纯透传，演出归 web
    date: n.adate ?? null, // 戏中日期（ADR-003 增补）：纯透传，时间结构信号归 web
    ended: run.ended,
  };
  if (n.type === 'line') return { ...base, kind: 'line', speaker: n.speaker ?? null, text: n.text };
  if (n.type === 'choice') return { ...base, kind: 'choice', options: visibleOptions(run, n).map(o => ({ label: o.label })) };
  if (n.type === 'transcribe') return { ...base, kind: 'transcribe', id: n.id, tid: n.transId, caller: n.caller ?? null, caller_char: n.callerChar ?? null, target: n.target, misses: run.trMisses[n.transId] ?? 0, options: transcribeOptions(ir, run, n) };
  if (n.type === 'ending') return { ...base, kind: 'ending', endingId: n.endingId, title: n.title };
  return { ...base, kind: 'beat' };
}

/** 转写选项（玩家只做选择题）：正确项 + 至多两条干扰项。
 *  干扰项只取本局已完成转写的历史留言（trLog，最新在前）——绝不引用未读内容，零剧透；
 *  全序按 (seed, tid) 确定性旋转，正确项不恒在首位，同 run 重试选项不跳位。 */
export function transcribeOptions(ir, run, node) {
  const byTid = new Map(Object.values(ir.nodes).filter(n => n.type === 'transcribe').map(n => [n.transId, n]));
  const pool = [];
  for (const tid of Object.keys(run.trLog).reverse()) {
    if (pool.length >= 2) break;
    const t = byTid.get(tid)?.target;
    if (t && t !== node.target && !pool.includes(t)) pool.push(t);
  }
  const opts = [node.target, ...pool];
  let h = Math.imul(run.seed | 0, 2654435761) >>> 0;
  for (const ch of node.transId) h = (Math.imul(h, 31) + ch.codePointAt(0)) >>> 0;
  const rot = opts.length > 1 ? h % opts.length : 0;
  return rot ? [...opts.slice(rot), ...opts.slice(0, rot)] : opts;
}

/** 转写文本规整：去空白与全部中英标点符号，只留内容字。 */
const norm = s => String(s).replace(/[\s\p{P}\p{S}]/gu, '');

/** 转写溯源判定：目标内容字须按序包含于同章上文引语——内容 lint 复用同一把尺。
 *  （交互已改选择题；此尺只管剧本侧「target 必须敲得出来」的溯源合同。） */
export function transcribeOk(input, target) {
  const t = norm(target);
  if (!t) return true;
  let i = 0;
  for (const ch of norm(input)) {
    if (ch === t[i]) i++;
    if (i >= t.length) return true;
  }
  return false;
}

/** 推进到下一个「停点」（台词/选项/转写/结局）；自动穿过 jump 等过渡节点。 */
export function advance(run, ir) {
  const cur = ir.nodes[run.nodeId];
  if (!cur) return cloneRun(run);
  if (cur.type === 'choice' || cur.type === 'ending' || cur.type === 'transcribe') return cloneRun(run);
  return walkToStop(cloneRun(run), ir, cur.next ?? null);
}

/** 从 nextId 起走到下一停点（advance/submitPick 共用的尾巴）。 */
function walkToStop(nr, ir, nextId) {
  let guard = 0;
  while (nextId) {
    if (++guard > 10000) throw new Error('walkToStop: 节点遍历超限（疑似环）');
    const n = ir.nodes[nextId];
    if (!n) throw new Error(`walkToStop: 节点不存在 ${nextId}`);
    if (n.type === 'line' || n.type === 'choice' || n.type === 'transcribe') {
      nr.nodeId = nextId; applyEnter(nr, n); return nr;
    }
    if (n.type === 'ending') {
      nr.nodeId = nextId; applyEnter(nr, n); nr.ended = n.endingId; return nr;
    }
    applyEnter(nr, n);
    nextId = n.type === 'jump' ? n.goto : (n.next ?? null);
  }
  nr.nodeId = null;
  return nr;
}

/** 转写提交（选择题）：选中正确项 → 记录、点亮 tr.<id>、推进；选错 → 原地计一次 miss。
 *  判定以选项文本为准，选项由 transcribeOptions 确定（同 run 同选项，miss 不改变顺序）。 */
export function submitPick(run, ir, index) {
  const cur = ir.nodes[run.nodeId];
  if (!cur || cur.type !== 'transcribe') throw new Error('submitPick: 当前节点不是转写');
  const opts = transcribeOptions(ir, run, cur);
  if (!Number.isInteger(index) || index < 0 || index >= opts.length) throw new Error(`submitPick: 选项越界 ${index}`);
  const nr = cloneRun(run);
  if (opts[index] !== cur.target) {
    nr.trMisses[cur.transId] = (nr.trMisses[cur.transId] ?? 0) + 1;
    return nr;
  }
  nr.trLog[cur.transId] = cur.target;
  nr.flags[`tr.${cur.transId}`] = true;
  return walkToStop(nr, ir, cur.next ?? null);
}

export function choose(run, ir, index) {
  const n = ir.nodes[run.nodeId];
  if (!n || n.type !== 'choice') throw new Error('choose: 当前节点不是选项');
  const opts = visibleOptions(run, n);
  const opt = opts[index];
  if (!opt) throw new Error(`choose: 选项越界或被守卫隐藏 ${index}`);
  const nr = cloneRun(run);
  nr.choiceLog.push(index);
  for (const op of opt.set ?? []) applyOp(nr, op);
  const t = ir.nodes[opt.goto];
  if (!t) throw new Error(`choose: 目标节点不存在 ${opt.goto}`);
  applyEnter(nr, t);
  nr.nodeId = opt.goto;
  if (t.type === 'ending') nr.ended = t.endingId;
  return nr;
}

export function cloneRun(run) {
  return { ...run, flags: { ...run.flags }, affinity: { ...run.affinity }, choiceLog: [...run.choiceLog], trLog: { ...run.trLog }, trMisses: { ...run.trMisses } };
}

export function serializeRun(run) { return JSON.stringify(run); }
export function loadRun(json) {
  const run = typeof json === 'string' ? JSON.parse(json) : json;
  if (typeof run.nodeId !== 'string' && run.nodeId !== null) throw new Error('loadRun: 存档损坏');
  return run;
}
