// 存档文档与同步裁决的纯函数：浏览器和 Node 测试共用，不做任何 I/O。
// 版本向量只由玩法写入与内容迁移推进；锚点用于内容更新后的安全定位。
import { advance, choose, submitPick, transcribeOptions } from './state.mjs';
import { visibleOptions } from './graph.mjs';

export function compareVV(a = {}, b = {}) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGreater = false, bGreater = false;
  for (const key of keys) {
    const av = a[key] ?? 0, bv = b[key] ?? 0;
    if (av > bv) aGreater = true;
    if (bv > av) bGreater = true;
  }
  if (aGreater && bGreater) return 'concurrent';
  if (aGreater) return 1;
  if (bGreater) return -1;
  return 0;
}

export function mergeVV(a = {}, b = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) out[key] = Math.max(a[key] ?? 0, b[key] ?? 0);
  return out;
}

// 非安全用途的内容指纹：只用于在 IR 更新后认回同一拍，避免引入异步 crypto。
export function fingerprint(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const stopTypes = new Set(['line', 'choice', 'transcribe', 'ending']);
const stops = ir => Object.values(ir.nodes).filter(n => stopTypes.has(n.type));

// 节点内容指纹只看内容不看 id：场景重写会重新生成节点 id，内容还在就要认得回来
const nodeFingerprint = node => {
  const { id, ...content } = node;
  return fingerprint(content);
};

export function makeAnchor(ir, nodeId) {
  const node = ir.nodes[nodeId];
  if (!node) return { nodeId: null, scene: null, ord: 0, h: null };
  const sameScene = stops(ir).filter(n => n.scene === node.scene);
  return { nodeId, scene: node.scene ?? null, ord: Math.max(0, sameScene.findIndex(n => n.id === nodeId)), h: nodeFingerprint(node) };
}

/** 返回 { nodeId, exact, level }；level 用于告知玩家是否发生了内容迁移。
 *  v1.1 结构优先：节点 ID 还在且仍是停点 → 原位（内容指纹只标记「台词被改过」，
 *  不再因文案修订把玩家降级到场景开头）；ID 消失才按指纹找回，最后才走降级阶梯。 */
export function resolveAnchor(ir, anchor) {
  if (!anchor) return { nodeId: ir.entry, exact: false, level: 'entry' };
  const byId = ir.nodes[anchor.nodeId];
  if (byId && stopTypes.has(byId.type)) {
    const same = anchor.h != null && nodeFingerprint(byId) === anchor.h;
    return { nodeId: anchor.nodeId, exact: same, level: same ? 'same' : 'same-id' };
  }
  const all = stops(ir);
  const sameScene = all.filter(n => n.scene === anchor.scene);
  const local = sameScene.find(n => nodeFingerprint(n) === anchor.h);
  if (local) return { nodeId: local.id, exact: true, level: 'scene' };
  const global = all.filter(n => nodeFingerprint(n) === anchor.h);
  if (global.length === 1) return { nodeId: global[0].id, exact: true, level: 'global' };
  if (sameScene.length) return { nodeId: sameScene[0].id, exact: false, level: 'scene-start' };
  const chapter = byId?.chapter ?? all.find(n => n.scene === anchor.scene)?.chapter;
  const inChapter = all.filter(n => n.chapter === chapter);
  if (inChapter.length) return { nodeId: inChapter[0].id, exact: false, level: 'chapter-start' };
  return { nodeId: ir.entry, exact: false, level: 'entry' };
}

/** 停点存活性：这一拍能否完成交互并走到下一停点（结局是合法终点，不必再推）。
 *  纯干跑不落库——读档时用它校验旧存档在新内容图上没有被断链卡死。 */
export function canProceed(ir, run) {
  const n = ir.nodes[run.nodeId];
  if (!n) return false;
  if (n.type === 'ending') return true;
  if (n.type === 'line') {
    try { advance(run, ir); } catch { return false; }
    return true;
  }
  if (n.type === 'choice') {
    const opts = visibleOptions(run, n);
    if (!opts.length) return false;
    return opts.every((_, i) => {
      try { choose(run, ir, i); } catch { return false; }
      return true;
    });
  }
  if (n.type === 'transcribe') {
    const hit = transcribeOptions(ir, run, n).indexOf(n.target);
    if (hit < 0) return false;
    try { submitPick(run, ir, hit); } catch { return false; }
    return true;
  }
  return false;
}

/** 断链自愈：当前停点推不动时沿 原位→场首→章首→卷首 找第一个能推进的落点。
 *  返回 { nodeId, level }；level 为 null 表示原位本来就健康（不产生迁移话术）。 */
export function settleRun(ir, run, anchor = {}) {
  const tried = new Set();
  const ladder = [];
  const consider = (nodeId, level) => {
    if (nodeId && ir.nodes[nodeId] && !tried.has(nodeId)) { tried.add(nodeId); ladder.push({ nodeId, level }); }
  };
  consider(run.nodeId, null);
  const sceneStops = stops(ir).filter(n => n.scene === anchor.scene);
  if (sceneStops.length) consider(sceneStops[0].id, 'scene-start');
  const chapter = (ir.nodes[run.nodeId] ?? sceneStops[0])?.chapter ?? null;
  const chapterStops = chapter ? stops(ir).filter(n => n.chapter === chapter) : [];
  if (chapterStops.length) consider(chapterStops[0].id, 'chapter-start');
  consider(ir.entry, 'entry');
  for (const step of ladder) {
    if (canProceed(ir, { ...run, nodeId: step.nodeId })) return step;
  }
  return { nodeId: ir.entry, level: 'entry' }; // 全图皆断的兜底：交给 verify 层去抓内容问题
}

export function bumpVV(doc, deviceId) {
  return { ...doc.vv, [deviceId]: (doc.vv?.[deviceId] ?? 0) + 1 };
}

export function publicDoc(doc) {
  const out = { ...doc };
  delete out.dirty;
  return out;
}

export function samePayload(a, b) {
  const strip = doc => {
    const out = { ...doc };
    // seq 是服务端信箱的游标戳，不参与负载比较——否则「同负载并发合并」永远判不中
    for (const key of ['vv', 'updatedAt', 'dirty', 'createdAt', 'summary', 'seq']) delete out[key];
    return out;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
