// 文字舞台播放器:API 驱动循环 + 状态差分渲染。
// 舞台合同 v0(ADR-004):chapter 变→章节卡;bg 变→氛围+印章;新说话者→声纹卡+锚点;
// fact.* 新增→时间轴点亮+线索;台词→呼吸节奏;选择→分支;结局→收集。
import { StageAudio } from '/audio.mjs';
import { Stage, callerHz } from '/stage.mjs';

const $ = s => document.querySelector(s);
const AUTO = new URLSearchParams(location.search).has('auto');
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const audio = new StageAudio();
const stage = new Stage(audio, { auto: AUTO });

const api = {
  async j(path, opts) {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    return body;
  },
  post(path, data) {
    return api.j(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {}) });
  },
};

const app = {
  ir: null, saveId: null, gameId: null, user: null,
  prev: { chapter: null, bgKey: null, date: null },
  met: new Set(), facts: new Set(), timelineBuilt: false, running: false,
  cards: new Set(), // 本局已见的 card.* flag（读档种子先灌满，避免补播入档提示）
  sheet: new Map(), // 转写底单：tid -> {caller, target}（本局回看）
  trByTid: new Map(), // tid -> 转写节点（证物拍/并轨拍的呈堂材料）
  gen: 0,           // 换代令牌：切档/重开时 +1，旧渲染循环立即退场，防止双驱动
};

/** IR 就绪时重建索引：转写节点按 tid 一张表（峰值拍的呈堂材料）。 */
function indexIr() {
  app.trByTid = new Map(
    Object.values(app.ir.nodes).filter(n => n.type === 'transcribe').map(n => [n.transId, n]));
}

// 代词说话者是剧本刻意匿名（g01 叙诡合同）：声纹卡/锚点只显声线，不揭名——
// 「我姓廖」那一拍之前的任何姓名都是剧透。
const MASKED_SPEAKERS = new Set(['他', '她', '它']);

const charOf = name => {
  const sp = app.ir.speakers[name];
  return sp ? app.ir.characters[sp.char] : null;
};

/** 峰值拍数据行：按 tid 从 IR 取转写节点（证物拍/并轨拍的呈堂材料，不依赖存档）。 */
function peakRows(tids) {
  return tids.map(tid => app.trByTid?.get(tid)).filter(Boolean).map(n => ({
    caller: n.caller,
    target: n.target,
    hz: n.callerChar ? (app.ir.characters[n.callerChar]?.voice_hz ?? callerHz(n.caller)) : callerHz(n.caller),
  }));
}

function resetRun() {
  app.gen++;
  app.prev = { chapter: null, bgKey: null, date: null };
  app.met = new Set(); app.facts = new Set(); app.timelineBuilt = false; app.sheet.clear(); app.cards.clear();
  stage.reset(); stage.clearClues(); stage.clearAnchors(); stage.clearDateLabel();
  $('#timeline').classList.remove('on');
  $('#chapterLabel').classList.remove('on');
  $('#sheetPanel').classList.remove('on');
}

/** 渲染一个停点;返回下一停点状态(结局/选择后返回其状态),终局返回 null。 */
async function renderBeat(s) {
  const gen = app.gen;
  // 章节切换 → 清场 + 章节卡（带本章起始日期——双时间线在章卡上就亮明年代）
  if (s.chapter !== app.prev.chapter) {
    const idx = Math.max(0, app.ir.chapters.findIndex(c => c.id === s.chapter));
    const ch = app.ir.chapters[idx];
    const num = CN[idx] ?? String(idx + 1);
    await stage.wipe();
    await stage.chapterCard(`第${num}章`, ch.title, s.date ?? null);
    stage.setChapterLabel(`第${num}章 · ${ch.title}`);
    if (s.date) { stage.setDateLabel(s.date); app.prev.date = s.date; } // 章卡已示日期，流内不再重复盖章
    app.prev.chapter = s.chapter;
    app.prev.bgKey = null;
  }
  // 章内时间跳变（@date 变更）→ HUD 罗盘换日 + 流内日期章：回拨/前跳都被钉在纸上
  if (s.date && s.date !== app.prev.date) {
    stage.setDateLabel(s.date);
    await stage.dateLine(s.date);
    app.prev.date = s.date;
  }
  // 地点或昼夜切换 → 氛围层 + 印章（白日/夜翻面本身是场景信号，同地点也要换）
  const bgId = s.view?.bg?.id ?? null;
  const bgTime = s.view?.bg?.params?.time ?? null;
  const bgKey = bgId ? `${bgId}|${bgTime}` : null;
  if (bgKey && bgKey !== app.prev.bgKey) {
    const loc = app.ir.canon.locations.find(l => l.id === bgId);
    const time = ({ day: '白日', dusk: '黄昏', night: '夜' })[bgTime];
    stage.setAmbient(bgId, loc?.mood ?? {}, s.view.bg.params ?? {});
    if (loc) await stage.seal(loc.name, app.ir.canon.world + (time ? ` · ${time}` : ''));
    app.prev.bgKey = bgKey;
  }
  // 正典事实差分 → 时间轴点亮 + 线索解锁
  for (const k of Object.keys(s.flags ?? {})) {
    if (!k.startsWith('fact.') || app.facts.has(k)) continue;
    app.facts.add(k);
    const ev = app.ir.canon.events.find(e => e.id === k.slice(5));
    if (!ev) continue;
    if (!app.timelineBuilt) {
      // 时间轴带只摆本作私有事件（宇宙编年史归 canon.html）
      const own = app.ir.canon.events.filter(e => e.disclosed_in === app.ir.code);
      stage.buildTimeline(own.length ? own : app.ir.canon.events);
      app.timelineBuilt = true;
    }
      stage.showTimeline(); stage.lightEvent(ev); stage.addClue(ev.title); audio.chime();
  }

  // 图鉴入档差分：新出现的 card.* 键 → 提示入档（词条/人物卡提示，解锁键静默）
  for (const k of Object.keys(s.flags ?? {})) {
    if (!k.startsWith('card.') || app.cards.has(k)) continue;
    app.cards.add(k);
    let name = null;
    if (k.startsWith('card.char.')) {
      const c = canonChar(k.slice(9));
      if (c) name = dossierName(c, app.cards);
    } else {
      name = app.ir.canon.lexicon.find(e => `card.${e.id}` === k)?.name ?? null;
    }
    if (name) { stage.toast(`档案入档 · ${name}`); audio.chime(); }
  }

  // 峰值拍（@peak · 舞台合同 v1 首片）：回报拍演出——播种拍保持安静。
  // 词表见 tools/content-lint.mjs 的 PEAK_KINDS（lint 门禁）；未知 kind 安静降级为普通拍。
  const peak = s.peak;
  stage.ambientDim(peak?.kind === 'dead');
  if (peak?.kind === 'desk') await stage.desk(peakRows(peak.args));
  if (peak?.kind === 'collapse') await stage.collapse(peakRows(peak.args));
  if (peak?.kind === 'retype') await stage.retype(peak.args[0] ?? '……');

  if (s.kind === 'line') {
    let card = null;
    if (s.speaker) {
      const c = charOf(s.speaker);
      const masked = MASKED_SPEAKERS.has(s.speaker);
      // 正典 side 为 left|right（ADR-004），这里归一化为 l/r
      const sideRaw = c?.stage?.side;
      const side = sideRaw === 'l' || sideRaw === 'left' ? 'l' : 'r';
      const theme = c?.stage?.theme ?? 'var(--accent)';
      const hz = c?.voice_hz ?? 218;
      if (c && !app.met.has(c.id)) {
        app.met.add(c.id);
        card = await stage.charCard({ name: masked ? s.speaker : c.name, hz, side, theme, bio: masked ? '' : c.bio_public });
      }
      if (c) stage.setAnchor(masked ? s.speaker : c.name, side, theme);
      await stage.say(s.speaker, s.text, { theme, hz, dir: side, split: peak?.kind === 'split' });
    } else if (peak?.kind === 'inner') {
      // 内声拍：叙述首次携带声纹——用玩家自己的声线
      await stage.tellInner(s.text, app.ir.player?.voice_hz ?? 218);
    } else {
      await stage.tell(s.text);
    }
    stage.dismissCard(card);
    await stage.gate();
    if (gen !== app.gen) return null; // 等待期间换了幕/档：不再触碰任何存档
    const r = await api.post(`/api/saves/${app.saveId}/advance`);
    if (r.state.kind === 'void') { stage.toast('剧情已到尽头'); return null; }
    return r.state;
  }

  if (s.kind === 'choice') {
    const idx = await stage.choice(null, s.options.map(o => o.label));
    if (gen !== app.gen) return null;
    const r = await api.post(`/api/saves/${app.saveId}/choose`, { index: idx });
    return r.state;
  }

  if (s.kind === 'transcribe') {
    let cur = s;
    while (cur.kind === 'transcribe') {
      // 呼入者声纹：登典者用正典 voice_hz（陈先生/刘先生=96Hz 同形——公平线索埋在界面里），
      // 未登典者用名字哈希伪声纹（无「有档/无档」元泄漏）
      const hz = cur.caller_char
        ? (app.ir.characters[cur.caller_char]?.voice_hz ?? callerHz(cur.caller))
        : callerHz(cur.caller);
      const text = await stage.transcribe({
        caller: cur.caller, target: cur.target, misses: cur.misses, hz,
        dead: cur.peak?.kind === 'dead', stamp: cur.peak?.args[0] ?? null,
      });
      if (gen !== app.gen) return null;
      const r = await api.post(`/api/saves/${app.saveId}/advance`, { text });
      if (r.state.kind === 'transcribe' && r.state.id === cur.id) { stage.toast('听岔了——再听一遍'); cur = r.state; }
      // tid 用于底单/flag 追踪；同节点判定用 id
      else { app.sheet.set(cur.tid, { caller: cur.caller, target: cur.target, hz }); return r.state; }
    }
  }

  if (s.kind === 'ending') {
    await showEnding(s);
    return null;
  }

  stage.toast(`未知状态 ${s.kind}`);
  return null;
}

async function runLoop(s0) {
  const gen = app.gen;
  app.running = true;
  let s = s0;
  while (s) {
    if (gen !== app.gen) break; // 换幕/换档：旧循环退场
    s = await renderBeat(s);
  }
  if (gen === app.gen) app.running = false;
}

async function showEnding(s) {
  const seen = await api.j(`/api/saves/${app.saveId}/endings`).catch(() => []);
  const names = seen.map(e => app.ir.endings.find(x => x.id === e.ending_id)?.title ?? e.ending_id);
  $('#endTitle').textContent = s.title;
  $('#endCollected').innerHTML = `已收集结局 ${seen.length}/${app.ir.endings.length}` +
    (names.length ? `<br>${names.join(' · ')}` : '');
  $('#endcard').classList.add('on', 'settle'); // 安静期：整局养成的连点惯性不得当场命中「回到封面」
  setTimeout(() => $('#endcard').classList.remove('settle'), 1200);
}

async function startGame(gameId) {
  const info = await api.j(`/api/games/${gameId}`);
  app.ir = info.ir; app.gameId = gameId;
  stage.setLexicon(app.ir); // 行内签名词典随 IR 重建（ADR-005）
  indexIr();
  const r = await api.post(`/api/games/${gameId}/saves`); // player 缺省=服务端取会话用户名
  app.saveId = r.saveId;
  for (const k of Object.keys(r.state.flags ?? {})) if (k.startsWith('card.')) app.cards.add(k); // 开局种子：不补播提示
  $('#title').style.display = 'none';
  $('#endcard').classList.remove('on');
  $('#savesPanel').classList.remove('on');
  $('#worldLabel').textContent = `${app.ir.canon.world}悬疑宇宙 · ${app.ir.code}`;
  resetRun();
  runLoop(r.state);
}

async function loadSave(saveId) {
  const r = await api.j(`/api/saves/${saveId}`);
  const info = await api.j(`/api/games/${r.save.gameId}`);
  app.ir = info.ir; app.gameId = r.save.gameId; app.saveId = saveId;
  for (const k of Object.keys(r.state.flags ?? {})) if (k.startsWith('card.')) app.cards.add(k); // 读档种子
  stage.setLexicon(app.ir);
  indexIr();
  $('#title').style.display = 'none';
  $('#savesPanel').classList.remove('on');
  $('#endcard').classList.remove('on');
  $('#worldLabel').textContent = `${app.ir.canon.world}悬疑宇宙 · ${app.ir.code}`;
  resetRun();
  runLoop(r.state);
}

async function openSaves() {
  if (!app.gameId) { stage.toast('先开始游戏'); return; }
  if (!requestPanel('#savesPanel')) return;
  const list = await api.j(`/api/saves?gameId=${app.gameId}`);
  $('#savesList').innerHTML = list.length ? '' : '<div style="color:var(--ink-dim);font-size:12px">暂无存档</div>';
  for (const sv of list) {
    const div = document.createElement('div');
    div.className = 'save';
    div.innerHTML = `<span>#${sv.id} 存档</span><span style="color:var(--ink-dim)">${sv.ended ? `已通关(${sv.ended})` : '进行中'}</span>`;
    div.onclick = () => loadSave(sv.id);
    $('#savesList').appendChild(div);
  }
  settlePanel('#savesPanel');
}

// ---- 侧面板统一合同：互斥开关 + 关闭钮 + 点外关闭（该拍不推进）+ ESC/空格冻结 ----
const SIDE_PANELS = ['#savesPanel', '#sheetPanel', '#endsPanel', '#codexPanel'];
const panelOpen = () => SIDE_PANELS.find(sel => $(sel).classList.contains('on')) ?? null;
let pendingPanel = null; // 点击即声明：异步开面板取数期间，别的面板不得反杀
function closePanels() {
  pendingPanel = null;
  for (const sel of SIDE_PANELS) $(sel).classList.remove('on');
  if (stage.pendingGate) stage.hint(true); // 面板让位后，推进提示回来
}
/** 同步面板：点击即开（含 toggle）。已开着 → 关（toggle 语义）。 */
function openPanel(sel) {
  if ($(sel).classList.contains('on')) return closePanels();
  closePanels();
  pendingPanel = sel;
  $(sel).classList.add('on');
  stage.hint(false); // 面板在场时「点击·空格——继续」是误导
}
/** 异步面板：点击时先声明占位（关别人），取数完成后落位——期间用户改点别的即作废。 */
function requestPanel(sel) {
  if ($(sel).classList.contains('on')) return closePanels(), false;
  closePanels();
  pendingPanel = sel;
  stage.hint(false);
  return true;
}
function settlePanel(sel) {
  if (pendingPanel !== sel) return; // 用户已改点别的面板：本次开面板作废
  $(sel).classList.add('on');
}

// HUD 按钮的按压不得冒泡到舞台（否则开面板会偷推进一拍）
document.querySelectorAll('#hud button').forEach(b =>
  b.addEventListener('pointerdown', e => e.stopPropagation()));

// 点面板外 = 关面板，且这一拍绝不推进剧情；HUD 按钮豁免（保 toggle 语义）
document.addEventListener('pointerdown', e => {
  if (!panelOpen()) return;
  if (e.target.closest('.sidepanel')) return;
  if (e.target.closest('#hud button')) return;
  closePanels();
  e.stopPropagation();
}, true);

// 面板在场冻结空格/回车（浏览时误触推进），ESC 关闭
document.addEventListener('keydown', e => {
  if (!panelOpen()) return;
  if (e.key === 'Escape') { closePanels(); e.stopPropagation(); }
  else if (e.code === 'Space' || e.key === 'Enter') e.stopPropagation();
}, true);

document.querySelectorAll('.pnl-x').forEach(b => b.onclick = () => closePanels());

// ---- HUD 按钮 ----
$('#btnSaves').onclick = openSaves;
// 底单回看：本局转写记录（悬疑玩家要翻回去对时间戳与号码）
// 同频聚簇：同形声纹相邻并列——形状即线索，不标数字（播种层公平证据的回看强化）
$('#btnSheet').onclick = () => {
  const panel = $('#sheetPanel'), list = $('#sheetList');
  const items = [...app.sheet.values()];
  list.innerHTML = items.length ? '' : '<div style="color:#6e6549;font-size:12px">还没有转写记录</div>';
  const byHz = new Map(), groups = [];
  for (const it of items) {
    const k = it.hz ?? 0;
    if (!byHz.has(k)) { byHz.set(k, []); groups.push(byHz.get(k)); }
    byHz.get(k).push(it);
  }
  groups.forEach((grp, gi) => {
    if (gi > 0) { const sep = document.createElement('hr'); sep.className = 'tr-sep'; list.appendChild(sep); }
    for (const it of grp) {
      const div = document.createElement('div');
      div.className = 'tr-row';
      div.innerHTML = `<span class="tr-row-caller">${it.caller ?? '呼入'}${it.hz ? Stage.waveChip(it.hz) : ''}</span><span class="tr-row-text">${stage.mark(it.target)}</span>`;
      list.appendChild(div);
    }
  });
  openPanel('#sheetPanel'); // 底单同步取数：直开
};

// ---- 结局档案：已归档回读全文（IR 静态提取，不重跑舞台）；未归档只给暗示 ----
function endingBody(eid) {
  let id = app.ir.scenes[eid], out = '', guard = 0;
  while (id && ++guard < 500) {
    const n = app.ir.nodes[id];
    if (!n || n.type === 'ending') break;
    if (n.type === 'line') out += `<p>${n.speaker ? `<i>${n.speaker}：</i>` : ''}${stage.mark(n.text)}</p>`;
    else if (n.type === 'transcribe') out += `<p class="end-tr">【转写】${n.caller ?? '呼入'}：${stage.mark(n.target)}</p>`;
    id = n.next;
  }
  return out;
}
async function openEnds() {
  if (!app.gameId) { stage.toast('先开始游戏'); return; }
  const seen = await api.j(`/api/games/${app.gameId}/endings`).catch(() => []);
  const seenIds = new Set(seen.map(e => e.ending_id));
  const box = $('#endsList');
  box.innerHTML = '';
  for (const e of app.ir.endings) {
    const div = document.createElement('div');
    if (seenIds.has(e.id)) {
      div.className = 'end-item';
      div.innerHTML = `<div class="end-title">◆ ${e.title}</div><div class="end-body">${endingBody(e.id)}</div>`;
    } else {
      div.className = 'end-item locked';
      div.innerHTML = `<div class="end-title">◇ 未归档</div><div class="end-hint">${e.hint ?? '——还没走到这一页'}</div>`;
    }
    box.appendChild(div);
  }
  settlePanel('#endsPanel');
}
$('#btnEnds').onclick = openEnds;
$('#btnEnds2').onclick = () => { $('#endcard').classList.remove('on'); openEnds(); };

// ---- 图鉴：时代词条 + 人物案卷（入档读全文，未入档悬影；案卷字段逐条解锁，未解锁 ？？？）----
const canonChar = cid => app.ir.canon.characters.find(c => c.id === cid) ?? null;
/** 案卷显示名：未揭名（name_unlock 未置位）显示遮罩名——叙诡人物（廖志坤→「他」）的防泄底。 */
function dossierName(c, revealed) {
  const d = c.dossier;
  return d?.name_unlock && !revealed.has(d.name_unlock) ? (d.masked_as ?? '？？？') : c.name;
}
async function openCodex() {
  if (!app.gameId) { stage.toast('先开始游戏'); return; }
  if (!requestPanel('#codexPanel')) return;
  const seen = await api.j(`/api/games/${app.gameId}/cards`).catch(() => []);
  // 统一用全名（card.*）判收集与解锁：服务端历史键补 card. 前缀
  const has = new Set([...app.cards, ...seen.map(k => 'card.' + k)]);
  const box = $('#codexList');
  box.innerHTML = '';
  const sec = label => { const d = document.createElement('div'); d.className = 'cx-sec'; d.textContent = label; box.appendChild(d); };
  const item = (ghost, html) => { const d = document.createElement('div'); d.className = 'cx-item' + (ghost ? ' ghost' : ''); d.innerHTML = html; box.appendChild(d); };

  sec('人物档案');
  for (const c of app.ir.canon.characters) {
    if (!has.has(`card.char.${c.id}`)) { item(true, '<div class="cx-name">？？？</div>'); continue; }
    const fields = (c.dossier?.fields ?? []).map(f => {
      const open = !f.unlock || has.has(f.unlock);
      return `<div class="cx-field${open ? '' : ' locked'}"><b>${f.label}</b><span>${open ? stage.mark(f.text) : '？？？'}</span></div>`;
    }).join('');
    item(false, `<div class="cx-name">${dossierName(c, has)}${Stage.waveChip(c.voice_hz)}</div>` +
      `<div class="cx-body">${stage.mark(c.bio_public ?? '')}</div>${fields}`);
  }
  sec('时代词条');
  for (const e of app.ir.canon.lexicon) {
    if (!has.has(`card.${e.id}`)) { item(true, `<div class="cx-name">？？？<span class="cx-kind">${e.kind}</span></div>`); continue; }
    item(false, `<div class="cx-name">${e.name}<span class="cx-kind">${e.kind}</span></div>` +
      `<div class="cx-kicker">${e.kicker}</div><div class="cx-body">${stage.mark(e.body)}</div>`);
  }
  settlePanel('#codexPanel');
}
$('#btnCodex').onclick = openCodex;
// 破坏性操作二次确认：第一次点击武装（红框「确认？」），2.5s 内再点才执行。
// 武装后 500ms 内的点击一律忽略——反射性双击（间隔多在 300ms 内）不得触发破坏性动作，
// 读到「确认？」再点必然超过 500ms。
function armConfirm(btn, fn) {
  btn.onclick = () => {
    if (btn.dataset.armed) {
      if (Date.now() - Number(btn.dataset.armedAt) < 500) return; // 反射双击：忽略
      btn.dataset.armed = ''; btn.classList.remove('armed');
      btn.textContent = btn.dataset.label;
      fn();
    } else {
      btn.dataset.label = btn.textContent;
      btn.dataset.armed = '1'; btn.dataset.armedAt = String(Date.now());
      btn.classList.add('armed'); btn.textContent = '确认？';
      setTimeout(() => {
        if (btn.dataset.armed) { btn.dataset.armed = ''; btn.classList.remove('armed'); btn.textContent = btn.dataset.label; }
      }, 2500);
    }
  };
}
armConfirm($('#btnRestart'), () => app.gameId && startGame(app.gameId));
armConfirm($('#btnTitle'), () => { sessionStorage.setItem('nu.reload.cause', 'btnTitle'); location.reload(); });
$('#btnAgain').onclick = () => startGame(app.gameId);
armConfirm($('#btnBackTitle'), () => { sessionStorage.setItem('nu.reload.cause', 'btnBackTitle'); location.reload(); }); // 回到封面=重载：二次确认
$('#btnMute').onclick = e => {
  audio.muted = !audio.muted;
  e.currentTarget.textContent = audio.muted ? '♪ 已静' : '♪ 音效';
};
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// ---- 账籍（游客优先：boot 的 me 自动发游客会话；注册=游客补录凭据，进度归属不动）----
const authMode = { now: 'register' }; // register | login
function renderAuthBar() {
  const bar = $('#authBar');
  if (!app.user) { bar.innerHTML = ''; return; }
  // 用户名经服务端字符白名单校验（文字/数字/._-），不含标记字符，innerHTML 安全
  bar.innerHTML = app.user.guest
    ? `<span>游客进度仅存本机</span><button id="btnAuth">注册留存</button>`
    : `<span>档案 · ${app.user.username}</span><button id="btnLogout">退出</button>`;
  if (app.user.guest) $('#btnAuth').onclick = () => openAuth('register');
  else $('#btnLogout').onclick = async () => { await api.post('/api/auth/logout'); sessionStorage.setItem('nu.reload.cause', 'btnLogout'); location.reload(); };
}
function openAuth(mode) {
  authMode.now = mode;
  $('#apTitle').textContent = mode === 'register' ? '注册 · 留存进度' : '登录 · 调取档案';
  $('#apSubmit').textContent = mode === 'register' ? '立档' : '登录';
  $('#apSwitch').textContent = mode === 'register' ? '已有档案？直接登录' : '还没有档案？注册一个';
  $('#apErr').textContent = '';
  $('#apPass').value = '';
  $('#authPanel').classList.add('on');
  $('#apUser').focus();
}
$('#apClose').onclick = () => $('#authPanel').classList.remove('on');
$('#authPanel').onclick = e => { if (e.target.id === 'authPanel') $('#authPanel').classList.remove('on'); };
$('#apSwitch').onclick = () => openAuth(authMode.now === 'register' ? 'login' : 'register');
$('#apPass').onkeydown = e => { if (e.key === 'Enter') $('#apSubmit').click(); };
$('#apSubmit').onclick = async () => {
  try {
    const r = await api.post(`/api/auth/${authMode.now}`, {
      username: $('#apUser').value.trim(), password: $('#apPass').value,
    });
    app.user = r.user;
    stage.toast(authMode.now === 'register' ? `已立档：${r.user.username}，进度已留存` : `档案调取：${r.user.username}`);
    $('#authPanel').classList.remove('on');
    renderAuthBar();
  } catch (e) { $('#apErr').textContent = e.message; }
};

// ---- 启动:标题页游戏列表;?auto=1 冒烟 ----
(async () => {
  // 重载原因标记：按钮重载前写入；boot 时若 reload 但无标记 = 浏览器行为（下拉刷新/标签回收）——
  // 玩家看到的「莫名弹回封面」由此可当场分辨
  try {
    if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
      sessionStorage.setItem('nu.reload.cause', sessionStorage.getItem('nu.reload.cause') ?? 'browser');
    } else {
      sessionStorage.removeItem('nu.reload.cause');
    }
  } catch { /* sessionStorage 不可用时静默 */ }
  const me = await api.j('/api/auth/me'); // 播放器 boot 合同：先立会话，存档从此有归属
  app.user = me.user;
  renderAuthBar();
  const games = await api.j('/api/games');
  for (const g of games) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center';
    const b = document.createElement('button');
    b.innerHTML = `${g.title}<span class="g-sub">${g.subtitle ?? ''}</span>${g.hook ? `<span class="g-hook">${g.hook}</span>` : ''}`;
    b.onclick = () => startGame(g.id);
    row.appendChild(b);
    // 「继续上次」：任何 reload/误触都不再是灾难——一键回到最近的进行中存档
    const saves = await api.j(`/api/saves?gameId=${g.id}`).catch(() => []);
    const last = saves.filter(s => !s.ended).sort((a, b2) => b2.id - a.id)[0];
    if (last && !AUTO) {
      const c = document.createElement('button');
      c.innerHTML = `继续存档 #${last.id}`;
      c.style.cssText = 'font-size:13px;padding:6px 12px';
      c.onclick = () => loadSave(last.id);
      row.appendChild(c);
    }
    $('#gameList').appendChild(row);
  }
  if (AUTO) await startGame(games[0].id);
  else {
    // 若页面是「被刷新」回来的，当场告知原因（诊断玩家报告的「莫名弹回」）
    try {
      const cause = sessionStorage.getItem('nu.reload.cause');
      if (cause === 'browser') { sessionStorage.removeItem('nu.reload.cause'); stage.toast('页面被浏览器刷新（下拉刷新/系统回收）——进度在存档里，点「继续存档」即可回来'); }
      else if (cause) { sessionStorage.removeItem('nu.reload.cause'); }
    } catch { /* 静默 */ }
  }
})();
