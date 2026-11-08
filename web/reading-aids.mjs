// g01 导读的纯视图模型：只依赖 IR 与当前 state，读档即可重建。
// 不把 DOM、玩家猜测或未来正典带进阅读辅助。

const sceneIndex = (ir, scene) => {
  const id = ir.scenes[scene] ?? scene;
  return Object.keys(ir.nodes).indexOf(id);
};
const currentIndex = (ir, state) => sceneIndex(ir, state.node);
const has = (state, flag) => Boolean(state.flags?.[flag]);
const endingOf = state => state.endingId ??
  (has(state, 'evidence_submitted') ? 'E1' : has(state, 'evidence_to_father') ? 'E2' : has(state, 'lzk_to_bridge') ? 'E3' : null);

export function trackModel(ir, state) {
  const reading = ir.reading;
  if (!reading) return { converged: false, current: null, tracks: [], convergence: null };
  const now = currentIndex(ir, state);
  const convergenceIndex = sceneIndex(ir, reading.convergence.scene);
  const converged = state.chapter === 'ch5' || now >= convergenceIndex;
  const tracks = reading.tracks.map(track => {
    const stops = track.stops.filter(stop => sceneIndex(ir, stop.scene) <= now)
      .map(stop => ({ ...stop, index: sceneIndex(ir, stop.scene) }));
    return { ...track, stops };
  });
  let current = null;
  if (!converged) {
    let latest = -1;
    for (const track of tracks) {
      const stop = track.stops.at(-1);
      if (stop && stop.index > latest) { latest = stop.index; current = track.id; }
    }
    for (const track of tracks) {
      const stop = track.stops.at(-1);
      if (stop) stop.current = track.id === current && stop.index === latest;
    }
  }
  return { converged, current, tracks, convergence: converged ? { ...reading.convergence, current: true } : reading.convergence };
}

export function currentTrackInfo(ir, state) {
  const model = trackModel(ir, state);
  if (!model || (!model.tracks.length && !model.converged)) return null;
  if (model.converged) {
    return {
      id: 'convergence',
      label: model.convergence?.label ?? '档案室 · 汇流',
      name: '汇流',
      symbol: '合',
      sub: '对稿、在场与三份纸证的归宿',
      converged: true,
    };
  }
  const track = model.tracks.find(t => t.id === model.current);
  if (!track) return null;
  const sub = track.id === 'record'
    ? '夜班座席 · 一座城市把秘密排进你的耳机'
    : '案发后走访 · 手持蓝皮证件的白日协查';
  return {
    id: track.id,
    label: `${track.label}轨`,
    name: track.label,
    symbol: track.symbol,
    sub,
    converged: false,
  };
}

export function messageModel(ir, state) {
  const reading = ir.reading;
  if (!reading) return { rows: [] };
  const nodes = Object.values(ir.nodes).filter(n => n.type === 'transcribe');
  const byTid = new Map(nodes.map(n => [n.transId, n]));
  const rows = Object.entries(reading.messages).flatMap(([tid, meta]) => {
    if (!has(state, `tr.${tid}`)) return [];
    const node = byTid.get(tid);
    if (!node) return [];
    return [{
      tid,
      caller: node.caller,
      target: node.target,
      date: meta.date,
      time: meta.time,
      appointment: meta.appointment ?? null,
      number: meta.number,
      cough: Boolean(meta.cough),
      late: Boolean(meta.appointment && meta.appointment !== meta.time),
    }];
  });
  return { rows };
}

export function evidenceModel(ir, state) {
  const reading = ir.reading;
  if (!reading) return { rows: [] };
  const ending = endingOf(state);
  const rows = [];
  for (const item of reading.evidence) {
    const empty = item.emptyWhen && has(state, item.emptyWhen);
    const unlocked = item.unlock ? has(state, item.unlock) : (item.anyUnlock ?? []).some(f => has(state, f));
    if (!unlocked && !empty) continue;
    let holder;
    if (empty) holder = item.emptyHolder;
    else if (ending && item.holders[ending]) holder = item.holders[ending];
    else {
      const variants = item.variantFlags ?? item.anyUnlock ?? [];
      const active = variants.filter(f => has(state, f)).map(f => item.holders[f]).filter(Boolean);
      holder = active.at(-1) ?? item.holders.default ?? '';
    }
    rows.push({ id: item.id, label: item.label, kind: item.kind, holder, empty: Boolean(empty) });
  }
  return { rows };
}

export function relationsModel(ir, state, opts = {}) {
  const g = ir.reading?.relations;
  if (!g) return { note: '', nodes: [], edges: [] };
  const full = Boolean(opts.full);
  const nodes = g.nodes
    .filter(n => full || !n.unlock || has(state, n.unlock))
    .map(n => ({
      id: n.id,
      label: full || !n.reveal || has(state, n.reveal) ? n.label : (n.alias ?? n.label),
      masked: !full && Boolean(n.reveal) && !has(state, n.reveal),
      kind: n.kind ?? 'cast',
      x: n.x,
      y: n.y,
    }));
  const visible = new Set(nodes.map(n => n.id));
  // 边跟随剧本落地的拍点（unlock）；两端任一未出场则不画，避免悬空连线。
  const edges = [...(g.edges ?? []), ...(full ? (g.truth ?? []) : [])]
    .filter(e => (full || !e.unlock || has(state, e.unlock)) && visible.has(e.from) && visible.has(e.to))
    .map(e => ({ from: e.from, to: e.to, label: e.label, key: Boolean(e.key), truth: Boolean(e.truth) }));
  return { note: g.note ?? '', nodes, edges };
}

export function mapModel(ir, state) {
  const map = ir.reading?.map;
  if (!map) return { note: '', lines: [], nodes: [], current: null };
  const now = currentIndex(ir, state);
  const current = state.view?.bg?.id ?? null;
  const nodes = map.nodes.filter(node => sceneIndex(ir, node.since) <= now)
    .map(node => ({ ...node, current: node.id === current }));
  return { note: map.note, lines: map.lines, nodes, current };
}

export function recapModel(ir, state) {
  const unlocked = state.kind === 'ending' || Boolean(state.endingId);
  const current = unlocked ? state.endingId : null;
  return {
    unlocked,
    current,
    rows: unlocked ? (ir.reading?.recap ?? []).map(row => ({ ...row, current: row.id === current })) : [],
  };
}
