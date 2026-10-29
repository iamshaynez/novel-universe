import { trackModel, messageModel, evidenceModel, debtModel, mapModel, recapModel } from '/reading-aids.mjs';

const $ = s => document.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));
const TABS = [['tracks', '轨迹'], ['messages', '留言'], ['evidence', '证物'], ['debt', '关系'], ['map', '地图'], ['recap', '回读']];
const KIND = { original: '原始底单', hand: '手抄本', draft: '转写底稿', summary: '汇总纸', copy: '复印件' };

function tracksView(ir, state) {
  const model = trackModel(ir, state);
  const tracks = model.tracks.map(track => `<section class="ra-track">
    <div class="ra-track-label" aria-hidden="true">${esc(track.symbol)}</div>
    <div><div class="ra-note">${esc(track.label)}</div><div class="ra-stops">${track.stops.map(stop =>
      `<div class="ra-stop${stop.current ? ' current' : ''}">${esc(stop.label)}</div>`).join('')}</div></div>
  </section>`).join('');
  return `${tracks}${model.converged ? `<div class="ra-converge">${esc(model.convergence.label)}</div>` : ''}`;
}

function messagesView(ir, state, mark) {
  const model = messageModel(ir, state);
  if (!model.rows.length) return '<div class="ra-locked">完成相关转写后，留言会在这里并排出现。</div>';
  return `<div class="ra-note">只陈列已经入机的留言。号码、原话、轻咳和时间由你自己对照。</div><div class="ra-grid">${model.rows.map(row => `<article class="ra-card">
    <div class="ra-card-head"><span>${esc(row.date)} · ${mark(row.caller)}</span><span class="ra-number">${esc(row.number)}</span></div>
    <div class="ra-text">${mark(row.target)}</div>
    ${row.cough ? '<span class="ra-cough">挂前轻咳</span>' : ''}
    ${row.appointment ? `<div class="ra-late"><span>留言约定 <strong>${esc(row.appointment)}</strong></span><span>实际呼入 <strong>${esc(row.time)}</strong></span></div>` : `<div class="ra-late"><span>呼入 ${esc(row.time)}</span></div>`}
  </article>`).join('')}</div>`;
}

function evidenceView(ir, state, mark) {
  const model = evidenceModel(ir, state);
  if (!model.rows.length) return '<div class="ra-locked">底单与底稿出现后会在这里登记，不提前展示。</div>';
  return `<div class="ra-note">先分清纸是什么，再看它在谁手里。</div><div class="ra-grid ra-evidence">${model.rows.map(row => `<article class="ra-card ra-paper ${esc(row.kind)}${row.empty ? ' empty' : ''}">
    <div class="ra-kind">${esc(KIND[row.kind] ?? row.kind)}</div>
    <div class="ra-text">${mark(row.label)}</div>
    <div class="ra-holder">${row.empty ? '状态' : '位置 / 持有人'} · ${mark(row.holder)}</div>
  </article>`).join('')}</div>`;
}

function debtView(ir, state, mark) {
  const model = debtModel(ir, state);
  if (!model.unlocked) return '<div class="ra-locked">借条、担保和收账安排在这段对话之后开放。</div>';
  return `<div class="ra-note">借条与担保不是同一支签名；接账与救人也不是同一件事。</div><div class="ra-debt">${model.rows.map(row => `<div class="ra-debt-row">
    <span class="ra-from">${mark(row.from)}</span><span class="ra-relation">${esc(row.relation)}</span><span class="ra-to">${mark(row.to)}</span>
  </div>`).join('')}</div>`;
}

function mapView(ir, state) {
  const model = mapModel(ir, state);
  const lines = model.lines.map(line => {
    const [x, y] = line.points.split(' ')[0].split(',').map(Number);
    return `<polyline class="${esc(line.kind)}" points="${esc(line.points)}"></polyline><text x="${x}" y="${y - 14}">${esc(line.label)}</text>`;
  }).join('');
  const nodes = model.nodes.map(node => `<g class="${node.current ? 'current' : ''}">
    <circle cx="${node.x}" cy="${node.y}" r="8"></circle><text x="${node.x + 13}" y="${node.y + 5}">${esc(node.label)}</text>
  </g>`).join('');
  const current = model.nodes.find(n => n.current)?.label ?? '途中';
  return `<div class="ra-note">${esc(model.note)}；只出现剧情已到访地点。</div>
    <svg class="ra-map" viewBox="0 0 640 360" role="img" aria-label="地点示意图：${esc(current)}">
      <title>地点示意图，当前位置：${esc(current)}</title>${lines}${nodes}
    </svg>
    <div class="ra-note">当前位置 · ${esc(current)}</div>`;
}

function recapView(ir, state, mark) {
  const model = recapModel(ir, state);
  if (!model.unlocked) return '<div class="ra-locked">完成第一支结局后，这里才开放三支回读对照。</div>';
  return `<div class="ra-note">你已经走到一支结局。可以对照三支的证据与人物去向，再决定是否回读。</div><div class="ra-recap">${model.rows.map(row => `<article class="ra-recap-card${row.current ? ' current' : ''}">
    <h4>${esc(row.id)} · ${esc(row.title)}</h4><dl>
      <dt>证据</dt><dd>${mark(row.evidence)}</dd>
      <dt>人物</dt><dd>${mark(row.people)}</dd>
      <dt>选择</dt><dd>${mark(row.point)}</dd>
    </dl></article>`).join('')}</div>`;
}

/** 面板只是模型投影；页签切换不触碰剧情状态。 */
export function renderReadingPanel({ ir, state, tab, onTab, mark }) {
  const nav = $('#readTabs');
  const makeTab = ([id, label]) => {
    const button = document.createElement('button');
    button.className = 'read-tab';
    button.type = 'button';
    button.role = 'tab';
    button.dataset.tab = id;
    button.textContent = label;
    button.setAttribute('aria-selected', String(id === tab));
    button.setAttribute('aria-controls', 'readBody');
    button.onclick = () => onTab(id);
    return button;
  };
  if (nav.children.length !== TABS.length) nav.replaceChildren(...TABS.map(makeTab));
  else [...nav.children].forEach((button, i) => button.setAttribute('aria-selected', String(TABS[i][0] === tab)));
  const body = $('#readBody');
  if (!state) { body.innerHTML = '<div class="ra-locked">开始阅读后，导读会跟随当前场景。</div>'; return; }
  const views = { tracks: tracksView, messages: messagesView, evidence: evidenceView, debt: debtView, map: mapView, recap: recapView };
  body.innerHTML = (views[tab] ?? tracksView)(ir, state, mark);
}
