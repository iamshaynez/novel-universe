// 结局回读：从结局节点所属场景提取正文，不要求结局 ID 恰好等于场景 ID。
export function endingSceneNodes(ir, endingId) {
  const ending = Object.values(ir.nodes).find(node => node.type === 'ending' && node.endingId === endingId);
  if (!ending) return [];
  const out = [];
  let id = ir.scenes[ending.scene];
  let guard = 0;
  while (id && guard++ < 500) {
    const node = ir.nodes[id];
    if (!node || node.type === 'ending') break;
    out.push(node);
    id = node.next;
  }
  return out;
}
