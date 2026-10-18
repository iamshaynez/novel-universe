// 分支图静态分析：结构校验 + 全路径枚举（带守卫模拟）。
export function visibleOptions(run, node) {
  return node.options.filter(o => !o.when || run.flags[o.when]);
}

function successors(n) {
  if (n.type === 'choice') return n.options.map(o => o.goto);
  if (n.type === 'ending') return [];
  const t = n.type === 'jump' ? n.goto : n.next;
  return t ? [t] : [];
}

/** 结构校验，返回错误列表（空数组 = 通过）。 */
export function validateGraph(ir) {
  const errs = [];
  const exists = id => Boolean(ir.nodes[id]);
  if (!ir.nodes[ir.entry]) errs.push(`入口节点不存在: ${ir.entry}`);

  for (const [id, n] of Object.entries(ir.nodes)) {
    if (n.type === 'choice') {
      if (n.next) errs.push(`${id}: 选项节点不允许线性落穿（next 必须为空）`);
      if (!n.options?.length) errs.push(`${id}: 选项节点缺少选项`);
      n.options.forEach((o, i) => { if (!exists(o.goto)) errs.push(`${id} 选项#${i}: 目标不存在 ${o.goto}`); });
    } else if (n.type !== 'ending') {
      const t = n.type === 'jump' ? n.goto : n.next;
      if (!t) errs.push(`${id}: ${n.type} 节点缺少后继（章节是否未闭合？）`);
      else if (!exists(t)) errs.push(`${id}: 后继不存在 ${t}`);
    }
    for (const op of n.enter ?? []) {
      if (op.op === 'flag' && typeof op.name !== 'string') errs.push(`${id}: flag 指令缺少 name`);
    }
  }

  // 可达性 + 环检测（v0 宇宙剧本约定为 DAG）
  const color = {};
  const dfs = id => {
    const n = ir.nodes[id];
    if (!n) return;
    if (color[id] === 1) { errs.push(`检测到环: ${id}`); return; }
    if (color[id] === 2) return;
    color[id] = 1;
    for (const out of successors(n)) dfs(out);
    color[id] = 2;
  };
  if (ir.nodes[ir.entry]) dfs(ir.entry);
  for (const id of Object.keys(ir.nodes)) {
    if (!color[id]) errs.push(`孤儿节点（从入口不可达）: ${id}`);
  }

  for (const [id, n] of Object.entries(ir.nodes)) {
    if (n.type === 'ending' && !ir.endings.some(e => e.id === n.endingId)) {
      errs.push(`${id}: 结局未在结局表登记 ${n.endingId}`);
    }
  }
  return errs;
}

/** 枚举全部可玩路径（模拟 flag 守卫），供 e2e 与「结局全可达」断言使用。 */
export function enumerateRoutes(ir) {
  const routes = [];
  const dfs = (run, choices, depth) => {
    if (depth > 500) throw new Error('enumerateRoutes: 路径过深（守卫疑似成环）');
    const n = ir.nodes[run.nodeId];
    if (!n) { routes.push({ choices: [...choices], ending: '__GAP__' }); return; }
    if (n.type === 'ending') {
      routes.push({ choices: [...choices], ending: n.endingId, flags: { ...run.flags } });
      return;
    }
    if (n.type === 'choice') {
      const opts = visibleOptions(run, n);
      if (!opts.length) { routes.push({ choices: [...choices], ending: '__DEAD__' }); return; }
      opts.forEach((_, i) => dfs(applyChoose(ir, run, i), [...choices, i], depth + 1));
      return;
    }
    dfs(applyAdvance(ir, run), choices, depth + 1);
  };
  const initial = { nodeId: ir.entry, flags: {}, affinity: {}, choiceLog: [], seed: 1, ended: null };
  applyEnter(initial, ir.nodes[ir.entry]);
  dfs(initial, [], 0);
  return routes;
}

// 内部小步进（避免循环 import state.mjs）；与 state.mjs 语义一致：抵达即应用 enter。
function applyEnter(run, node) {
  for (const op of node.enter ?? []) {
    if (op.op === 'flag') run.flags[op.name] = op.value ?? true;
  }
}
function applyAdvance(ir, run) {
  const cur = ir.nodes[run.nodeId];
  if (!cur) return run;
  if (cur.type === 'choice' || cur.type === 'ending') return run;
  const nr = { ...run, flags: { ...run.flags }, choiceLog: [...run.choiceLog] };
  let nextId = cur.next ?? null, guard = 0;
  while (nextId) {
    if (++guard > 10000) throw new Error('图遍历超限');
    const n = ir.nodes[nextId];
    if (!n) { nr.nodeId = null; return nr; }
    applyEnter(nr, n);
    if (n.type === 'line' || n.type === 'choice') { nr.nodeId = nextId; return nr; }
    if (n.type === 'ending') { nr.nodeId = nextId; return nr; }
    nextId = n.type === 'jump' ? n.goto : (n.next ?? null);
  }
  nr.nodeId = null;
  return nr;
}
function applyChoose(ir, run, index) {
  const n = ir.nodes[run.nodeId];
  const opt = visibleOptions(run, n)[index];
  const nr = { ...run, flags: { ...run.flags }, choiceLog: [...run.choiceLog, index] };
  for (const op of opt.set ?? []) if (op.op === 'flag') nr.flags[op.name] = op.value ?? true;
  const t = ir.nodes[opt.goto];
  if (t) applyEnter(nr, t);
  nr.nodeId = opt.goto;
  return nr;
}
