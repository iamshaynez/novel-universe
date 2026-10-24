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
    chapter: n.chapter,
    chapterTitle: ir.chapters.find(c => c.id === n.chapter)?.title ?? n.chapter,
    flags: { ...run.flags },
    view: n.aview ?? null,
    ended: run.ended,
  };
  if (n.type === 'line') return { ...base, kind: 'line', speaker: n.speaker ?? null, text: n.text };
  if (n.type === 'choice') return { ...base, kind: 'choice', options: visibleOptions(run, n).map(o => ({ label: o.label })) };
  if (n.type === 'transcribe') return { ...base, kind: 'transcribe', id: n.id, tid: n.transId, caller: n.caller ?? null, target: n.target, misses: run.trMisses[n.transId] ?? 0 };
  if (n.type === 'ending') return { ...base, kind: 'ending', endingId: n.endingId, title: n.title };
  return { ...base, kind: 'beat' };
}

/** 转写文本规整：去空白后精确比较。 */
const norm = s => String(s).replace(/\s+/g, '');

/** 推进到下一个「停点」（台词/选项/转写/结局）；自动穿过 jump 等过渡节点。 */
export function advance(run, ir) {
  const cur = ir.nodes[run.nodeId];
  if (!cur) return cloneRun(run);
  if (cur.type === 'choice' || cur.type === 'ending' || cur.type === 'transcribe') return cloneRun(run);
  const nr = cloneRun(run);
  let nextId = cur.next ?? null, guard = 0;
  while (nextId) {
    if (++guard > 10000) throw new Error('advance: 节点遍历超限（疑似环）');
    const n = ir.nodes[nextId];
    if (!n) throw new Error(`advance: 节点不存在 ${nextId}`);
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

/** 转写提交：文本与目标一致（去空白比较）→ 记录、点亮 tr.<id>、推进到下一停点；
 *  不一致 → 原地计一次 miss（不推进）。转写是带提交语义的停点。 */
export function submit(run, ir, text) {
  const cur = ir.nodes[run.nodeId];
  if (!cur || cur.type !== 'transcribe') throw new Error('submit: 当前节点不是转写');
  const nr = cloneRun(run);
  if (norm(text) !== norm(cur.target)) {
    nr.trMisses[cur.transId] = (nr.trMisses[cur.transId] ?? 0) + 1;
    return nr;
  }
  nr.trLog[cur.transId] = String(text);
  nr.flags[`tr.${cur.transId}`] = true;
  let nextId = cur.next ?? null, guard = 0;
  while (nextId) {
    if (++guard > 10000) throw new Error('submit: 节点遍历超限（疑似环）');
    const n = ir.nodes[nextId];
    if (!n) throw new Error(`submit: 节点不存在 ${nextId}`);
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
