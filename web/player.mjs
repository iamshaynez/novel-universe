// 文字舞台播放器:API 驱动循环 + 状态差分渲染。
// 舞台合同 v0(ADR-004):chapter 变→章节卡;bg 变→氛围+印章;新说话者→声纹卡+锚点;
// fact.* 新增→时间轴点亮+线索;台词→呼吸节奏;选择→分支;结局→收集。
import { StageAudio } from '/audio.mjs';
import { Stage, callerHz } from '/stage.mjs';
import { renderReadingPanel } from '/reading-view.mjs';
import { codeOf, sentinelAction } from '/resilience.mjs';
import { LocalRuntime } from '/runtime.mjs';
import { openLocalStore } from '/store.mjs';
import { SyncClient } from '/sync.mjs';

const $ = s => document.querySelector(s);
const AUTO = new URLSearchParams(location.search).has('auto');
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const audio = new StageAudio();
const stage = new Stage(audio, { auto: AUTO });

const api = {
  async j(path, opts) {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(body.error ?? res.statusText);
      e.status = res.status; // 断线自愈据此区分「等一等会好」与「重试无意义」
      throw e;
    }
    return body;
  },
  post(path, data) {
    return api.j(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {}) });
  },
};

const app = {
  ir: null, saveId: null, gameId: null, user: null,
  store: null, runtime: null, sync: null, deviceId: null, catalog: [], irByGame: new Map(), syncStatus: '', pendingRemote: null,
  prev: { chapter: null, bgKey: null, date: null },
  met: new Set(), facts: new Set(), timelineBuilt: false, running: false,
  cards: new Set(), // 本局已见的 card.* flag（读档种子先灌满，避免补播入档提示）
  sheet: new Map(), // 转写底单：tid -> {caller, target}（本局回看）
  trByTid: new Map(), // tid -> 转写节点（证物拍/并轨拍的呈堂材料）
  gen: 0,           // 换代令牌：切档/重开时 +1，旧渲染循环立即退场，防止双驱动
  forceUpdate: false, // 服务器指纹已变：最近的停点自动换版重载
  current: null,    // 当前停点：导读从 IR + 当前 state 投影，读档无需第二套历史
  resume: false,    // 读档首拍：落当前停点，不重播章节卡/印章仪式
  readTab: 'tracks',
};

let syncTimer = null;
function queueSync() {
  if (!app.sync || !app.user || app.user.guest) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => app.sync.flush(), 3000);
}

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
  app.current = null; app.readTab = 'tracks'; readReturnFocus = null;
  app.resume = false;
  app.prev = { chapter: null, bgKey: null, date: null };
  app.met = new Set(); app.facts = new Set(); app.timelineBuilt = false; app.sheet.clear(); app.cards.clear();
  stage.reset(); stage.clearClues(); stage.clearAnchors(); stage.clearDateLabel();
  $('#timeline').classList.remove('on');
  $('#chapterLabel').classList.remove('on');
  $('#sheetPanel').classList.remove('on');
  $('#readPanel').classList.remove('on');
}

/** 渲染一个停点;返回下一停点状态(结局/选择后返回其状态),终局返回 null。 */
async function renderBeat(s) {
  const gen = app.gen;
  const dead = () => gen !== app.gen; // 切档/重开令牌：舞台层只保演出干净，推进权归新代
  // 章节切换 → 清场 + 章节卡；读档首拍只落 HUD 与氛围，不把玩家拉回章首仪式
  const resuming = app.resume;
  app.resume = false;
  if (s.chapter !== app.prev.chapter) {
    const idx = Math.max(0, app.ir.chapters.findIndex(c => c.id === s.chapter));
    const ch = app.ir.chapters[idx];
    const num = CN[idx] ?? String(idx + 1);
    if (!resuming) {
      await stage.wipe();
      await stage.chapterCard(`第${num}章`, ch.title, s.date ?? null);
      if (dead()) return null; // 卡播到一半被切档：不再触碰新幕
    }
    stage.setChapterLabel(`第${num}章 · ${ch.title}`);
    if (s.date) { stage.setDateLabel(s.date); app.prev.date = s.date; } // 章卡已示日期，流内不再重复盖章
    app.prev.chapter = s.chapter;
    app.prev.bgKey = null;
  }
  // 章内时间跳变（@date 变更）→ HUD 罗盘换日 + 流内日期章；读档只恢复 HUD，不重播日期章
  if (s.date && s.date !== app.prev.date) {
    stage.setDateLabel(s.date);
    if (!resuming) {
      await stage.dateLine(s.date);
      if (dead()) return null;
    }
    app.prev.date = s.date;
  }
  // 地点或昼夜切换 → 氛围层 + 印章；读档只落氛围，不再次等待印章停点
  const bgId = s.view?.bg?.id ?? null;
  const bgTime = s.view?.bg?.params?.time ?? null;
  const bgKey = bgId ? `${bgId}|${bgTime}` : null;
  if (bgKey && bgKey !== app.prev.bgKey) {
    const loc = app.ir.canon.locations.find(l => l.id === bgId);
    const time = ({ day: '白日', dusk: '黄昏', night: '夜' })[bgTime];
    stage.setAmbient(bgId, loc?.mood ?? {}, s.view.bg.params ?? {});
    if (!resuming && loc) await stage.seal(loc.name, app.ir.canon.world + (time ? ` · ${time}` : ''));
    if (dead()) return null; // 旧幕的印章等完：新档已接管，旧循环不得再往新舞台渲染
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
  if (dead()) return null; // 峰值演出中切档：新幕不被旧拍污染

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
        if (dead()) { stage.dismissCard(card); return null; }
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
    const r = await app.runtime.advance(app.saveId);
    queueSync();
    if (r.state.kind === 'void') { stage.toast('剧情已到尽头'); return null; }
    return r.state;
  }

  if (s.kind === 'choice') {
    const idx = await stage.choice(null, s.options.map(o => o.label));
    if (gen !== app.gen) return null;
    const r = await app.runtime.choose(app.saveId, idx);
    queueSync();
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
      const pick = await stage.transcribe({
        caller: cur.caller, target: cur.target, options: cur.options ?? [cur.target],
        misses: cur.misses, hz,
        dead: cur.peak?.kind === 'dead', stamp: cur.peak?.args[0] ?? null,
      });
      if (gen !== app.gen) return null;
      const r = await app.runtime.advance(app.saveId, pick);
      queueSync();
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

// 玩法推进不再访问网络：本地数据库异常只报告并停住，绝不用旧服务端状态覆盖本地进度。
async function runLoop(s0) {
  const gen = app.gen;
  app.running = true;
  try {
    let s = s0;
    while (s) {
      if (gen !== app.gen) break;
      app.current = s;
      if ($('#readPanel').classList.contains('on')) renderRead();
      if (app.forceUpdate && !stage.revealing) { reloadForUpdate(); return; }
      if (app.pendingRemote && !stage.revealing) {
        const remoteId = app.pendingRemote; app.pendingRemote = null;
        stage.toast('另一台设备已更新此存档——在停点跟进');
        await loadSave(remoteId).catch(failNote);
        return;
      }
      try {
        s = await renderBeat(s);
      } catch (e) {
        if (gen !== app.gen) break;
        stage.toast(`本地存档出了岔子：${e.message}——进度未被覆盖，请重开当前存档`);
        s = null;
      }
    }
  } finally {
    if (gen === app.gen) app.running = false;
  }
}

async function showEnding(s) {
  const collection = await app.store.getCollection(app.gameId).catch(() => ({ endings: [] }));
  const seen = collection.endings.map(ending_id => ({ ending_id }));
  const names = seen.map(e => app.ir.endings.find(x => x.id === e.ending_id)?.title ?? e.ending_id);
  $('#endTitle').textContent = s.title;
  $('#btnReadEnd').hidden = !app.ir.reading;
  $('#endCollected').innerHTML = `已收集结局 ${seen.length}/${app.ir.endings.length}` +
    (names.length ? `<br>${names.join(' · ')}` : '');
  $('#endcard').classList.add('on', 'settle'); // 安静期：整局养成的连点惯性不得当场命中「回到封面」
  setTimeout(() => $('#endcard').classList.remove('settle'), 1200);
}

async function loadIr(gameId) {
  if (app.irByGame.has(gameId)) return app.irByGame.get(gameId);
  const meta = app.catalog.find(g => g.id === gameId);
  if (!meta) throw new Error(`本地目录没有这部作品 ${gameId}`);
  let ir;
  try {
    ir = await api.j(meta.irUrl);
    await app.store.setMeta(`ir:${gameId}`, { irHash: meta.irHash, ir });
  } catch (error) {
    const cached = await app.store.getMeta(`ir:${gameId}`);
    if (!cached?.ir) throw error;
    ir = cached.ir;
  }
  app.irByGame.set(gameId, ir);
  return ir;
}

function useRuntime(ir) {
  const meta = app.catalog.find(g => g.id === ir.id);
  app.runtime = new LocalRuntime({ ir, irHash: meta?.irHash ?? null, store: app.store, deviceId: app.deviceId });
  app.ir = ir; app.gameId = ir.id;
  $('#btnRead').hidden = !app.ir.reading;
  stage.setLexicon(app.ir);
  indexIr();
}

async function startGame(gameId) {
  const ir = await loadIr(gameId);
  useRuntime(ir);
  const seed = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0] : 1;
  const r = await app.runtime.newGame(seed);
  app.saveId = r.doc.id;
  if (!AUTO) markLastPlay(r.doc.id);
  for (const k of Object.keys(r.state.flags ?? {})) if (k.startsWith('card.')) app.cards.add(k);
  $('#title').style.display = 'none';
  $('#endcard').classList.remove('on');
  $('#savesPanel').classList.remove('on');
  $('#worldLabel').textContent = `${app.ir.canon.world}悬疑宇宙 · ${app.ir.code}`;
  resetRun();
  queueSync();
  runLoop(r.state);
}

async function loadSave(saveId) {
  const existing = await app.store.getSave(saveId);
  if (!existing) throw new Error('本地存档不存在');
  const ir = await loadIr(existing.gameId);
  useRuntime(ir);
  const r = await app.runtime.load(saveId);
  app.saveId = saveId;
  if (!AUTO) markLastPlay(saveId);
  $('#btnRead').hidden = !app.ir.reading;
  for (const k of Object.keys(r.state.flags ?? {})) if (k.startsWith('card.')) app.cards.add(k);
  $('#title').style.display = 'none';
  $('#savesPanel').classList.remove('on');
  $('#endcard').classList.remove('on');
  $('#worldLabel').textContent = `${app.ir.canon.world}悬疑宇宙 · ${app.ir.code}`;
  resetRun();
  app.resume = true;
  queueSync();
  runLoop(r.state);
}

async function openSaves() {
  if (!app.gameId) { stage.toast('先开始游戏'); return; }
  if (!requestPanel('#savesPanel')) return;
  const list = await app.store.listSaves(app.gameId);
  $('#savesList').innerHTML = list.length ? '' : '<div style="color:var(--ink-dim);font-size:12px">暂无本地存档</div>';
  for (const sv of list) {
    const div = document.createElement('div');
    div.className = 'save';
    const label = sv.summary?.chapterTitle ? `${sv.summary.chapterTitle} · ` : '';
    div.innerHTML = `<span>${label}存档 ${String(sv.id).slice(0, 8)}</span><span style="color:var(--ink-dim)">${sv.summary?.ended ? `已通关(${sv.summary.ended})` : (sv.dirty ? '仅本机 · 待同步' : '已同步')}</span>`;
    div.onclick = () => loadSave(sv.id).catch(failNote);
    $('#savesList').appendChild(div);
  }
  settlePanel('#savesPanel');
}

let readReturnFocus = null;
function renderRead() {
  if (!app.ir?.reading) return;
  renderReadingPanel({
    ir: app.ir,
    state: app.current,
    tab: app.readTab,
    onTab: id => { app.readTab = id; renderRead(); },
    mark: text => stage.mark(text),
  });
}
function openRead(tab = null) {
  if (!app.ir?.reading) { stage.toast('本作没有导读'); return; }
  if (!readReturnFocus) readReturnFocus = document.activeElement;
  if (!requestPanel('#readPanel')) return;
  app.readTab = tab ?? app.readTab ?? 'tracks';
  renderRead();
  settlePanel('#readPanel');
  $('#readPanel .read-tab[aria-selected="true"]')?.focus();
}

// ---- 侧面板统一合同：互斥开关 + 关闭钮 + 点外关闭（该拍不推进）+ ESC/空格冻结 ----
const SIDE_PANELS = ['#savesPanel', '#sheetPanel', '#endsPanel', '#codexPanel', '#readPanel'];
const panelOpen = () => SIDE_PANELS.find(sel => $(sel).classList.contains('on')) ?? null;
let pendingPanel = null;
function closePanels() {
  const restoreReadFocus = $('#readPanel').classList.contains('on');
  pendingPanel = null;
  for (const sel of SIDE_PANELS) $(sel).classList.remove('on');
  if (restoreReadFocus && readReturnFocus) {
    const el = readReturnFocus; readReturnFocus = null;
    if (el?.isConnected) el.focus();
  }
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
$('#btnRead').onclick = () => openRead();
$('#btnReadEnd').onclick = () => { $('#endcard').classList.remove('on'); openRead('recap'); };
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
      div.innerHTML = `<span class="tr-row-caller">${stage.mark(it.caller ?? '呼入')}${it.hz ? Stage.waveChip(it.hz) : ''}</span><span class="tr-row-text">${stage.mark(it.target)}</span>`;
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
    if (n.type === 'line') out += `<p>${n.speaker ? `<i>${stage.mark(n.speaker)}：</i>` : ''}${stage.mark(n.text)}</p>`;
    else if (n.type === 'transcribe') out += `<p class="end-tr">【转写】${stage.mark(n.caller ?? '呼入')}：${stage.mark(n.target)}</p>`;
    id = n.next;
  }
  return out;
}
async function openEnds() {
  if (!app.gameId) { stage.toast('先开始游戏'); return; }
  if (!requestPanel('#endsPanel')) return;
  const collection = await app.store.getCollection(app.gameId).catch(() => ({ endings: [] }));
  const seenIds = new Set(collection.endings);
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
  const collection = await app.store.getCollection(app.gameId).catch(() => ({ cards: [] }));
  // 统一用全名（card.*）判收集与解锁：本地收集与存档 flags 同构
  const has = new Set([...app.cards, ...collection.cards.map(k => 'card.' + k)]);
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
// 开局/调档的前置请求失败（部署窗口的 502、切网）不再静默无响应——点按者当场得到反馈
const failNote = e => stage.toast(`出了点状况：${e.message}——稍候再点一次`);

armConfirm($('#btnRestart'), () => app.gameId && startGame(app.gameId).catch(failNote));
armConfirm($('#btnTitle'), () => { clearLastPlay(); sessionStorage.setItem('nu.reload.cause', 'btnTitle'); location.reload(); });
$('#btnAgain').onclick = () => startGame(app.gameId).catch(failNote);
armConfirm($('#btnBackTitle'), () => { clearLastPlay(); sessionStorage.setItem('nu.reload.cause', 'btnBackTitle'); location.reload(); }); // 回到封面=重载：二次确认
$('#btnMute').onclick = e => {
  audio.muted = !audio.muted;
  e.currentTarget.textContent = audio.muted ? '♪ 已静' : '♪ 音效';
};
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// ---- 账籍：本机进度为默认；注册/登录只负责把本机进度同步到远端 ----
const authMode = { now: 'register' }; // register | login
function renderAuthBar() {
  const bar = $('#authBar');
  const syncText = app.syncStatus ? ` · ${app.syncStatus}` : '';
  if (!app.user) {
    bar.innerHTML = `<span>本机进度 · 可离线游玩${syncText}</span><button id="btnAuth">注册/登录同步</button>`;
    $('#btnAuth').onclick = () => openAuth('register');
    return;
  }
  if (app.user.guest) {
    bar.innerHTML = `<span>本机进度 · 可离线游玩${syncText}</span><button id="btnAuth">注册留存</button>`;
    $('#btnAuth').onclick = () => openAuth('register');
    return;
  }
  bar.innerHTML = `<span>档案 · ${app.user.username}${syncText}</span><button id="btnLogout">退出</button>`;
  $('#btnLogout').onclick = async () => {
    const synced = await app.sync?.flush();
    const dirty = await app.store.listDirty();
    if (dirty.length && !synced) { stage.toast('还有未同步进度，暂不退档；联网同步后再试'); return; }
    await api.post('/api/auth/logout').catch(() => null);
    await app.store.clearAll(); // 共享设备默认清除本机账号数据
    clearLastPlay(); sessionStorage.setItem('nu.reload.cause', 'btnLogout'); location.reload();
  };
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
    if (app.sync) { app.sync.paused = false; app.sync.init(); }
    stage.toast(authMode.now === 'register' ? `已立档：${r.user.username}，本机进度将同步到远端` : `档案调取：${r.user.username}，正在合并本机与远端进度`);
    $('#authPanel').classList.remove('on');
    renderAuthBar();
  } catch (e) { $('#apErr').textContent = e.message; }
};

// ---- 版本指纹（footer 部署追踪）：v版本 · sha · 起服 · 服务器时间，30s 对时 ----
// 看不到这条 = 浏览器还在吃旧缓存；时间不走 = 会话挂在旧实例上。
// 指纹哨兵：「换版」只看 version|sha（前端代码是否更新）；仅 boot 变 = 同镜像重启，
// 会话与存档都在 SQLite，客户端无需动作——报一声平安即可，不再把局中人弹回封面。
// 真换版：局内等最近停点换版，不打断揭示；进度全在服务端，自动续档开卷即回。
const fmtClock = iso => {
  const d = new Date(iso), p = n => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const FP_RELOADED = 'nu.server.fp.reloaded';
let fpBase = null; // 出身指纹（页面生命周期内变量：每次加载重新认定，跨重载不残留）
function reloadForUpdate() {
  try { sessionStorage.setItem('nu.reload.cause', 'server-updated'); } catch { /* 静默 */ }
  if (window.nuActivateUpdate) window.nuActivateUpdate();
  else location.reload();
}
function armForceUpdate(fpNew) {
  if (AUTO) return; // 冒烟不自戕
  try {
    if (sessionStorage.getItem(FP_RELOADED) === fpNew) return; // 此版已换过：防环
    sessionStorage.setItem(FP_RELOADED, fpNew);
  } catch { /* 静默 */ }
  stage.toast('服务器已更新——即将自动载入新版');
  if (!app.running && !$('#endcard').classList.contains('on')) {
    setTimeout(reloadForUpdate, 800); // 封面/无局：直接换版（toast 露个脸）
    return;
  }
  app.forceUpdate = true; // 局内/结案页：最近的停点换版
  if (!stage.revealing) setTimeout(reloadForUpdate, 1200); // 已停在等待拍/选项：这里就是停点，就地换版
}
async function tickVtag() {
  const v = await api.j('/api/version').catch(() => null);
  if (!v) { $('#vtag').textContent = 'v? · /api/version 不可达'; return; }
  $('#vtag').textContent = `v${v.version} · ${v.sha} · 起 ${fmtClock(v.boot)} · 服务器 ${fmtClock(v.now)}`;
  const action = sentinelAction(fpBase, v);
  if (action === 'observe') { fpBase = v; return; } // 出身指纹：本页加载时服务器是谁
  if (action === 'reload') return armForceUpdate(codeOf(v));
  if (action === 'notice') {
    fpBase = v; // 记下新 boot：报一次平安即可，不逐 30s 重复
    if (!AUTO) stage.toast('服务器刚重启过——会话与进度都续着，继续即可');
  }
}
tickVtag();
setInterval(tickVtag, 30000);

// ---- 续档恢复：上次进行到哪个存档，开卷即回（PWA 重开/换版弹回不再摔在封面）----
// 进度全在服务端：自动回去只是重新 GET 停点，不重放已推进的拍。
// 刻意离开的尊重其选择：回到封面/退出登录都清标记，下次开卷停在封面。
const LASTPLAY = 'nu.lastPlay';
function markLastPlay(saveId) {
  try { localStorage.setItem(LASTPLAY, JSON.stringify({ saveId, at: Date.now() })); } catch { /* 静默 */ }
}
function clearLastPlay() {
  try { localStorage.removeItem(LASTPLAY); } catch { /* 静默 */ }
}
/** 开卷续档：直接读本地存档；网络与账号状态完全不参与。 */
async function tryResume() {
  let marker = null;
  try { marker = JSON.parse(localStorage.getItem(LASTPLAY) ?? 'null'); } catch { clearLastPlay(); return; }
  if (!marker?.saveId || AUTO) return;
  const doc = await app.store.getSave(marker.saveId);
  if (!doc || doc.deleted || doc.summary?.ended) { clearLastPlay(); return; }
  try {
    await loadSave(marker.saveId);
    stage.toast('回到上次的本地停点——可继续离线游玩');
  } catch (e) {
    stage.toast(`上次进度没能自动回来：${e.message}——可从本地存档进入`);
  }
}

/** 兼容期一次性导入旧服务端游客存档；导入后本地成为唯一权威，旧游客会话注销。 */
async function importLegacyGuest() {
  if (await app.store.getMeta('legacyImported')) return;
  let count = 0;
  for (const game of app.catalog) {
    const list = await api.j(`/api/saves?gameId=${game.id}`);
    for (const summary of list) {
      const full = await api.j(`/api/saves/${summary.id}`);
      if (!full.run) continue;
      const ir = await loadIr(game.id);
      const runtime = new LocalRuntime({ ir, irHash: game.irHash, store: app.store, deviceId: app.deviceId });
      await runtime.importLegacy(full.save, full.run);
      count++;
    }
  }
  await app.store.setMeta('legacyImported', true);
  app.syncStatus = count ? `已导入 ${count} 份旧存档到本机` : '';
  await api.post('/api/auth/logout').catch(() => null);
  app.user = null; renderAuthBar();
}

// 同步是后台副作用：失败不打断本地游戏，恢复网络后自动追平。
setInterval(() => { if (document.visibilityState === 'visible' && app.user && !app.user.guest) app.sync?.flush(); }, 60000);
addEventListener('online', () => { if (app.user && !app.user.guest) app.sync?.flush(); });

// ---- 启动：本地库与内容目录优先；账号与同步均为后台可选能力 ----
(async () => {
  try {
    if (performance.getEntriesByType('navigation')[0]?.type === 'reload') {
      sessionStorage.setItem('nu.reload.cause', sessionStorage.getItem('nu.reload.cause') ?? 'browser');
    } else sessionStorage.removeItem('nu.reload.cause');
  } catch { /* sessionStorage 不可用时静默 */ }
  try {
    app.store = await openLocalStore();
    app.deviceId = await app.store.getMeta('deviceId');
    if (!app.deviceId) {
      app.deviceId = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}`;
      await app.store.setMeta('deviceId', app.deviceId);
    }
    renderAuthBar();
    let cachedCatalog = await app.store.getMeta('catalog');
    try {
      app.catalog = await api.j('/content/catalog.json');
      await app.store.setMeta('catalog', app.catalog);
    } catch (error) {
      if (!cachedCatalog) throw error;
      app.catalog = cachedCatalog;
      app.syncStatus = '离线目录 · 仅本机';
      renderAuthBar();
    }
    app.sync = new SyncClient({
      store: app.store, deviceId: app.deviceId, games: app.catalog.map(g => g.id),
      post: (path, data) => api.post(path, data),
      onStatus: status => { app.syncStatus = status.text; renderAuthBar(); },
      onRemote: doc => {
        if (doc.id !== app.saveId) return;
        app.pendingRemote = doc.id;
        if (!stage.revealing) setTimeout(() => {
          if (app.pendingRemote !== doc.id) return;
          app.pendingRemote = null;
          loadSave(doc.id).catch(failNote);
        }, 0);
      },
    });
    const unfinished = new Map();
    for (const g of app.catalog) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center';
      const b = document.createElement('button');
      b.innerHTML = `${g.title}<span class="g-sub">${g.subtitle ?? ''}</span>${g.hook ? `<span class="g-hook">${g.hook}</span>` : ''}`;
      b.onclick = () => startGame(g.id).catch(failNote);
      row.appendChild(b);
      const saves = await app.store.listSaves(g.id);
      for (const sv of saves) if (!sv.summary?.ended) unfinished.set(sv.id, sv);
      const last = saves.find(s => !s.summary?.ended);
      if (last && !AUTO) {
        const c = document.createElement('button');
        c.innerHTML = `继续存档 ${String(last.id).slice(0, 8)}`;
        c.style.cssText = 'font-size:13px;padding:6px 12px';
        c.onclick = () => loadSave(last.id).catch(failNote);
        row.appendChild(c);
      }
      $('#gameList').appendChild(row);
    }
    if (AUTO) await startGame(app.catalog[0].id);
    if (!AUTO) {
      try {
        const cause = sessionStorage.getItem('nu.reload.cause');
        if (cause === 'browser') { sessionStorage.removeItem('nu.reload.cause'); stage.toast('页面被刷新——本地进度已保留，正在回到上次停点'); }
        else if (cause === 'server-updated') { sessionStorage.removeItem('nu.reload.cause'); stage.toast('已换到新版——本地进度保留，正在续读'); }
        else if (cause) sessionStorage.removeItem('nu.reload.cause');
      } catch { /* 静默 */ }
      await tryResume();
    }
    // 账号查询不阻塞本地 boot；旧游客存档在后台导入本机后才注销旧会话。
    api.j('/api/auth/me').then(async me => {
      app.user = me.user; renderAuthBar();
      if (app.user?.guest) await importLegacyGuest();
      else if (app.user) app.sync.init();
    }).catch(() => { app.syncStatus = '离线 · 仅本机'; renderAuthBar(); });
  } catch (e) {
    const note = document.createElement('div');
    note.style.cssText = 'text-align:center;color:var(--ink-dim);font-size:13px;line-height:2.4';
    note.textContent = `本地开卷失败：${e.message}——请使用支持本地存档的浏览器`;
    const retry = document.createElement('button');
    retry.textContent = '重新开卷'; retry.onclick = () => location.reload();
    note.appendChild(retry); $('#gameList').appendChild(note);
  }
})();
