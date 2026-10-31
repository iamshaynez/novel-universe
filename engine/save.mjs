// 存档文档与同步裁决的纯函数：浏览器和 Node 测试共用，不做任何 I/O。
// 版本向量只由玩法写入推进；锚点用于内容更新后的安全定位。

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

export function makeAnchor(ir, nodeId) {
  const node = ir.nodes[nodeId];
  if (!node) return { nodeId: null, scene: null, ord: 0, h: null };
  const sameScene = stops(ir).filter(n => n.scene === node.scene);
  return { nodeId, scene: node.scene ?? null, ord: Math.max(0, sameScene.findIndex(n => n.id === nodeId)), h: fingerprint(node) };
}

/** 返回 { nodeId, exact, level }；level 用于告知玩家是否发生了内容迁移。 */
export function resolveAnchor(ir, anchor) {
  if (!anchor) return { nodeId: ir.entry, exact: false, level: 'entry' };
  const byId = ir.nodes[anchor.nodeId];
  if (byId && fingerprint(byId) === anchor.h) return { nodeId: anchor.nodeId, exact: true, level: 'same' };
  const all = stops(ir);
  const sameScene = all.filter(n => n.scene === anchor.scene);
  const local = sameScene.find(n => fingerprint(n) === anchor.h);
  if (local) return { nodeId: local.id, exact: true, level: 'scene' };
  const global = all.filter(n => fingerprint(n) === anchor.h);
  if (global.length === 1) return { nodeId: global[0].id, exact: true, level: 'global' };
  if (sameScene.length) return { nodeId: sameScene[0].id, exact: false, level: 'scene-start' };
  const chapter = byId?.chapter ?? all.find(n => n.scene === anchor.scene)?.chapter;
  const inChapter = all.filter(n => n.chapter === chapter);
  if (inChapter.length) return { nodeId: inChapter[0].id, exact: false, level: 'chapter-start' };
  return { nodeId: ir.entry, exact: false, level: 'entry' };
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
    for (const key of ['vv', 'updatedAt', 'dirty', 'createdAt', 'summary']) delete out[key];
    return out;
  };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
