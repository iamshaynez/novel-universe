// 文字舞台播放器:API 驱动循环 + 状态差分渲染。
// 舞台合同 v0(ADR-004):chapter 变→章节卡;bg 变→氛围+印章;新说话者→声纹卡+锚点;
// fact.* 新增→时间轴点亮+线索;台词→呼吸节奏;选择→分支;结局→收集。
import { StageAudio } from '/audio.mjs';
import { Stage, callerHz } from '/stage.mjs';
import { renderReadingPanel } from '/reading-view.mjs';
import { codeOf, sentinelAction, updatePlan, resumePlan, manualUpdatePlan } from '/resilience.mjs';
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
  post(path, data, options = {}) {
    return api.j(path, { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data ?? {}) });
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
  if (!sp) return null;
  // 演示字段以正典块为准（ADR-005）：ir.characters 是瘦身索引，没有 bio_public
  return { ...app.ir.characters[sp.char], bio_public: canonChar(sp.char)?.bio_public ?? '' };
};

/** 峰值拍数据行：按 tid 从 IR 取转写节点（证物拍/并轨拍的呈堂材料，不依赖存档）。 */
function peakRows(tids) {
  return tids.map(tid => app.trByTid?.get(tid)).filter(Boolean).map(n => ({
    caller: n.caller,
    target: n.target,
    hz: n.callerChar ? (app.ir.characters[n.callerChar]?.voice_hz ?? callerHz(n.caller)) : callerHz(n.caller),
  }));
}

function closeDialog(selector) {
  const dialog = $(selector);
  dialog.classList.remove('on', 'settle');
  if (dialog.open) dialog.close();
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
  let healed = false;
  try {
    let s = s0;
    while (s) {
      if (gen !== app.gen) break;
      app.current = s;
      if ($('#readPanel').classList.contains('on')) renderRead();
      if (app.forceUpdate && !stage.revealing) { reloadForUpdate(); return; }
      if (app.pendingRemote && app.pendingRemote === app.saveId && !stage.revealing) {
        const remoteId = app.pendingRemote; app.pendingRemote = null;
        stage.toast('另一台设备已更新此存档——在停点跟进');
        await loadSave(remoteId).catch(failNote);
        return;
      }
      try {
        s = await renderBeat(s);
        if (!healed) {
          // 首拍走通即撤销坏档记账：这档活着，下次开卷可以照常自动续进
          healed = true;
          app.store.setMeta('brokenLastPlay', null).catch(() => {});
        }
      } catch (e) {
        if (gen !== app.gen) break;
        s = null;
        await showFatal(`本地存档出了岔子：${e.message}——进度未被覆盖`);
      }
    }
  } finally {
    if (gen === app.gen) app.running = false;
  }
}

// 致命错误逃生舱：本地档推不动时给出常驻出路（重新对位 / 回封面），
// 不再只剩一条会消失的 toast——那会把玩家逼向「重新开始」，进度看似丢失。
async function showFatal(text) {
  $('#fatalText').textContent = text;
  $('#fatalBar').classList.add('on');
  if (!$('#fatalBar').open) $('#fatalBar').showModal();
  await app.store.setMeta('brokenLastPlay', app.saveId).catch(() => {}); // 下次开卷不自动续进这档
}
$('#btnRealign').onclick = async () => {
  closeDialog('#fatalBar');
  try {
    await loadSave(app.saveId); // 读档即自愈：锚点对位 + 断链校验会把档落到推得动的停点
  } catch (e) {
    await showFatal(`重新对位失败：${e.message}`);
  }
};
$('#btnFatalTitle').onclick = () => {
  closeDialog('#fatalBar');
  clearLastPlay();
  sessionStorage.setItem('nu.reload.cause', 'fatalTitle');
  location.reload();
};
for (const selector of ['#endcard', '#fatalBar']) {
  $(selector).addEventListener('cancel', event => event.preventDefault());
}

async function showEnding(s) {
  const collection = await app.store.getCollection(app.gameId).catch(() => ({ endings: [] }));
  const seen = collection.endings.map(ending_id => ({ ending_id }));
  const names = seen.map(e => app.ir.endings.find(x => x.id === e.ending_id)?.title ?? e.ending_id);
  $('#endTitle').textContent = s.title;
  $('#endError').textContent = '';
  $('#btnReadEnd').hidden = !app.ir.reading;
  $('#endCollected').innerHTML = `已收集结局 ${seen.length}/${app.ir.endings.length}` +
    (names.length ? `<br>${names.join(' · ')}` : '');
  const card = $('#endcard');
  card.classList.add('on', 'settle'); // 安静期：整局养成的连点惯性不得当场命中「回到封面」
  if (!card.open) card.showModal();
  setTimeout(() => card.classList.remove('settle'), 1200);
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
  app.pendingRemote = null; // 主动开新局：不追任何远端跟进
  if (!AUTO) markLastPlay(r.doc.id);
  for (const k of Object.keys(r.state.flags ?? {})) if (k.startsWith('card.')) app.cards.add(k);
  $('#title').style.display = 'none';
  closeDialog('#endcard');
  $('#savesPanel').classList.remove('on');
  $('#worldLabel').textContent = `${app.ir.canon.world}悬疑宇宙 · ${app.ir.code}`;
  resetRun();
  queueSync();
  runLoop(r.state);
}

// 内容迁移话术：位置发生了什么，玩家必须知道——静默挪位等于进度无故蒸发
const MIGRATE_NOTE = {
  same: '作品内容有更新，进度已按原位续上',
  legacy: '作品内容有更新，进度已按原位续上',
  'same-id': '作品内容有修订，进度位置保留',
  scene: '作品内容有更新，已对位到同一拍继续',
  global: '作品内容有更新，已对位到同一拍继续',
  'scene-start': '作品内容有更新，原位置已不可达——从本场景开头继续，原进度已备份为分支存档',
  'chapter-start': '作品内容有更新，原位置已不可达——从本章开头继续，原进度已备份为分支存档',
  entry: '作品内容有更新，原位置已不可达——从卷首继续，原进度已备份为分支存档',
};

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
  closeDialog('#endcard');
  $('#worldLabel').textContent = `${app.ir.canon.world}悬疑宇宙 · ${app.ir.code}`;
  resetRun();
  app.resume = true;
  queueSync();
  if (r.level) stage.toast(MIGRATE_NOTE[r.level] ?? '作品内容有更新，进度已重新对位');
  runLoop(r.state);
}

async function openSaves(refresh = false) {
  if (!app.gameId) { stage.toast('先开始游戏'); return; }
  // 只认字面 true 的刷新态：onclick 直挂时传进来的是事件对象，必须走完整开面板流程
  if (refresh !== true && !requestPanel('#savesPanel')) return;
  const list = await app.store.listSaves(app.gameId);
  $('#savesList').innerHTML = list.length ? '' : '<div style="color:var(--ink-dim);font-size:12px">暂无本地存档</div>';
  for (const sv of list) {
    const div = document.createElement('div');
    div.className = 'save';
    const label = sv.summary?.chapterTitle ? `${sv.summary.chapterTitle} · ` : '';
    const prefix = sv.note ?? (sv.forkOf ? '分支 · ' : '');
    div.innerHTML = `<span>${prefix}${label}存档 ${String(sv.id).slice(0, 8)}</span><span style="color:var(--ink-dim)">${sv.summary?.ended ? `已通关(${sv.summary.ended})` : (sv.dirty ? '仅本机 · 待同步' : '已同步')}</span>`;
    div.onclick = () => loadSave(sv.id).catch(failNote);
    const del = document.createElement('button');
    del.className = 'save-del';
    del.type = 'button';
    del.textContent = '删';
    del.addEventListener('pointerdown', e => e.stopPropagation()); // 不得冒泡成「读取该档」
    armConfirm(del, async () => {
      if (sv.id === app.saveId) { stage.toast('正在进行的这一局不能删——回到封面后再来'); return; }
      try {
        await app.runtime.remove(sv.id);
        queueSync(); // 墓碑随同步推到远端与其他设备
        stage.toast('已删除——远端与其他设备将同步移除');
        openSaves(true); // 原地刷新列表，不关面板
      } catch (e) { failNote(e); }
    });
    div.appendChild(del);
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

// ---- 侧面板统一合同：互斥开关 + 遮罩（点外关闭的可视化）+ 关闭钮 + 点外关闭（该拍不推进）+ ESC/空格冻结 ----
const SIDE_PANELS = ['#savesPanel', '#sheetPanel', '#endsPanel', '#codexPanel', '#readPanel'];
const panelOpen = () => SIDE_PANELS.find(sel => $(sel).classList.contains('on')) ?? null;
let pendingPanel = null;
function closePanels() {
  const restoreReadFocus = $('#readPanel').classList.contains('on');
  pendingPanel = null;
  $('#panelVeil').classList.remove('on');
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
  $('#panelVeil').classList.add('on');
  $(sel).classList.add('on');
  stage.hint(false); // 面板在场时「点击·空格——继续」是误导
}
/** 异步面板：点击时先声明占位（关别人 + 压暗舞台），取数完成后落位——期间用户改点别的即作废。 */
function requestPanel(sel) {
  if ($(sel).classList.contains('on')) return closePanels(), false;
  closePanels();
  pendingPanel = sel;
  $('#panelVeil').classList.add('on');
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
$('#btnSaves').onclick = () => openSaves(); // 箭头包裹：不得把事件对象漏进 openSaves 的 refresh 参数（b8d32c8 回归）
$('#btnRead').onclick = () => openRead();
$('#btnReadEnd').onclick = () => { closeDialog('#endcard'); openRead('recap'); };
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
$('#btnEnds2').onclick = () => { closeDialog('#endcard'); openEnds(); };

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
  btn.onclick = e => {
    e?.stopPropagation?.(); // 确认钮不得把点击冒泡给宿主行/卡片的默认动作
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
$('#btnAgain').onclick = async () => {
  const button = $('#btnAgain');
  button.disabled = true;
  $('#endError').textContent = '';
  try { await startGame(app.gameId); }
  catch (error) {
    if ($('#endcard').open) $('#endError').textContent = `重开失败：${error.message}——可重试或回到封面`;
    else failNote(error);
  } finally { button.disabled = false; }
};
armConfirm($('#btnBackTitle'), () => { clearLastPlay(); sessionStorage.setItem('nu.reload.cause', 'btnBackTitle'); location.reload(); }); // 回到封面=重载：二次确认
$('#btnMute').onclick = e => {
  audio.muted = !audio.muted;
  e.currentTarget.textContent = audio.muted ? '♪ 已静' : '♪ 音效';
};
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// ---- 账籍：本机进度为默认；注册/登录只负责把本机进度同步到远端 ----
const authMode = { now: 'register' }; // register | login
let authBusy = false;
let authReturnFocus = null;
let authAttempt = 0;
let authController = null;
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
function renderAuthBar() {
  const bar = $('#authBar');
  const syncText = app.syncStatus ? ` · ${escapeHtml(app.syncStatus)}` : '';
  if (!app.user) {
    bar.innerHTML = `<span>本机进度 · 可离线游玩${syncText}</span><button id="btnAuth" type="button">注册/登录同步</button>`;
    $('#btnAuth').onclick = () => openAuth('register');
    return;
  }
  if (app.user.guest) {
    bar.innerHTML = `<span>本机进度 · 可离线游玩${syncText}</span><button id="btnAuth" type="button">注册留存</button>`;
    $('#btnAuth').onclick = () => openAuth('register');
    return;
  }
  const reauth = app.sync?.paused ? '<button id="btnReauth" type="button">重新登录</button>' : '';
  bar.innerHTML = `<span>档案 · ${escapeHtml(app.user.username)}${syncText}</span>${reauth}<button id="btnLogout" type="button">退出</button>`;
  if ($('#btnReauth')) $('#btnReauth').onclick = () => openAuth('login');
  $('#btnLogout').onclick = async () => {
    const synced = await app.sync?.flush();
    const dirty = await app.store.listDirty();
    if (dirty.length && !synced) { stage.toast('还有未同步进度，暂不退档；联网同步后再试'); return; }
    await api.post('/api/auth/logout').catch(() => null);
    await app.store.clearAll(); // 共享设备默认清除本机账号数据
    clearLastPlay(); sessionStorage.setItem('nu.reload.cause', 'btnLogout'); location.reload();
  };
}
function clearAuthError() {
  $('#apErr').textContent = '';
  for (const input of [$('#apUser'), $('#apPass')]) input.setAttribute('aria-invalid', 'false');
}
function setAuthBusy(busy) {
  authBusy = busy;
  $('#apSubmit').disabled = busy;
  $('#apSwitch').disabled = busy;
  $('#apUser').readOnly = busy;
  $('#apPass').readOnly = busy;
  $('#apSubmit').textContent = busy ? '正在核验…' : (authMode.now === 'register' ? '立档' : '登录');
}
function openAuth(mode) {
  if (authBusy) return;
  const dialog = $('#authPanel');
  const wasOpen = dialog.open;
  if (!wasOpen) authReturnFocus = document.activeElement;
  authMode.now = mode;
  $('#apTitle').textContent = mode === 'register' ? '注册 · 留存进度' : '登录 · 调取档案';
  $('#apSubmit').textContent = mode === 'register' ? '立档' : '登录';
  $('#apSwitch').textContent = mode === 'register' ? '已有档案？直接登录' : '还没有档案？注册一个';
  $('#apPass').setAttribute('autocomplete', mode === 'register' ? 'new-password' : 'current-password');
  clearAuthError();
  $('#apPass').value = '';
  if (!wasOpen) dialog.showModal();
  if (matchMedia?.('(pointer:fine)')?.matches) $('#apUser').focus({ preventScroll: true });
  else if (!wasOpen) dialog.focus({ preventScroll: true }); // 触屏由玩家点输入框，不主动掀键盘
}
function closeAuth() {
  if (authBusy) {
    authAttempt++;
    authController?.abort();
    authController = null;
    setAuthBusy(false);
  }
  if ($('#authPanel').open) $('#authPanel').close();
}
$('#apClose').onclick = closeAuth;
$('#authPanel').addEventListener('click', event => { if (event.target === $('#authPanel')) closeAuth(); });
$('#authPanel').addEventListener('cancel', event => { event.preventDefault(); closeAuth(); });
$('#authPanel').addEventListener('close', () => {
  clearAuthError();
  const target = authReturnFocus;
  authReturnFocus = null;
  const fallback = $('#btnReauth') ?? $('#btnAuth') ?? $('#btnLogout');
  const focus = target?.isConnected ? target : fallback;
  focus?.focus({ preventScroll: true });
});
$('#apSwitch').onclick = () => openAuth(authMode.now === 'register' ? 'login' : 'register');
$('#authForm').addEventListener('input', event => { if (event.target.classList.contains('ap-in')) clearAuthError(); });
$('#authForm').addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
  if (!event.target.classList.contains('ap-in')) return;
  event.preventDefault();
  if (!authBusy) $('#authForm').requestSubmit($('#apSubmit'));
});
$('#authForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (authBusy) return;
  clearAuthError();
  const mode = authMode.now;
  const attempt = ++authAttempt;
  const controller = new AbortController();
  authController = controller;
  setAuthBusy(true);
  let notice = '';
  try {
    const r = await api.post(`/api/auth/${mode}`, {
      username: $('#apUser').value.trim(), password: $('#apPass').value,
    }, { signal: controller.signal });
    if (attempt !== authAttempt) return;
    app.user = r.user;
    if (app.sync) { app.sync.paused = false; app.sync.init(); }
    notice = mode === 'register' ? `已立档：${r.user.username}，本机进度将同步到远端` : `档案调取：${r.user.username}，正在合并本机与远端进度`;
  } catch (error) {
    if (attempt === authAttempt && error.name !== 'AbortError') {
      $('#apErr').textContent = error.message;
      for (const input of [$('#apUser'), $('#apPass')]) input.setAttribute('aria-invalid', 'true');
    }
  } finally {
    if (attempt === authAttempt) {
      authController = null;
      setAuthBusy(false);
    }
  }
  if (notice && attempt === authAttempt) {
    renderAuthBar();
    closeAuth();
    stage.toast(notice);
  }
});

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
  if (window.nuActivateUpdate) {
    // SW 通道激活（waiting/installing → skipWaiting → controllerchange 重载）；
    // 没有可激活的新壳（sw.js 尚未就绪）兜底硬刷——防环记账在 armForceUpdate 里。
    window.nuActivateUpdate().then(ok => { if (!ok) location.reload(); }).catch(() => location.reload());
    return;
  }
  location.reload();
}
/** 手动「检查并更新」：版本指纹页脚即按钮。用户主动点击 → 即时强制换壳，
 *  不受停点保护与防环记账约束（连点是重试不是环）；进度全在本地 IndexedDB，重载零丢失。 */
async function checkUpdate() {
  stage.toast('正在检查新版…');
  const v = await api.j('/api/version').catch(() => null);
  const plan = manualUpdatePlan({ pageCode: fpBase && codeOf(fpBase), serverCode: v && codeOf(v), swReady: !!window.nuActivateUpdate });
  if (plan.act === 'offline') { stage.toast('检查失败：服务器不可达——稍后再点'); return; }
  if (plan.act === 'current') { stage.toast(`已是最新 · v${v.version} 壳 ${String(v.shell ?? v.sha).slice(0, 6)}`); return; }
  try { sessionStorage.setItem('nu.reload.cause', 'server-updated'); } catch { /* 静默 */ }
  if (plan.act === 'reload') { location.reload(); return; }
  stage.toast('有新版——正在载入');
  const ok = await window.nuActivateUpdate().catch(() => false);
  if (!ok) stage.toast('新壳还在路上——稍等几秒再点一次');
}
function armForceUpdate(fpNew) {
  if (AUTO) return; // 冒烟不自戕
  const arm = () => {
    try {
      if (sessionStorage.getItem(FP_RELOADED) === fpNew) return; // 此版已换过：防环
      sessionStorage.setItem(FP_RELOADED, fpNew);
    } catch { /* 静默 */ }
    const plan = updatePlan({
      running: app.running,
      endcard: $('#endcard').classList.contains('on'),
      pageAgeMs: performance.now(),
    });
    if (plan.act === 'defer') { // 刚落地的局（章节卡/开场演出）：稍后重评，不打断
      setTimeout(arm, 15000 - performance.now() + 100);
      return;
    }
    stage.toast('服务器已更新——即将自动载入新版');
    if (plan.act === 'reload-now') { setTimeout(reloadForUpdate, 800); return; }
    app.forceUpdate = true; // 局内：runLoop 在拍间隙（自然停点）换版，不与揭示竞速
  };
  arm();
}
async function tickVtag() {
  const v = await api.j('/api/version').catch(() => null);
  if (!v) { $('#vtag').textContent = 'v? · /api/version 不可达'; return; }
  $('#vtag').textContent = `v${v.version} · 壳 ${String(v.shell ?? v.sha).slice(0, 6)} · 起 ${fmtClock(v.boot)} · 服务器 ${fmtClock(v.now)}`;
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
// 版本指纹页脚即换版按钮：点击/回车/空格 = 检查并强制载入最新版
$('#vtag').addEventListener('click', checkUpdate);
$('#vtag').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.code === 'Space') { e.preventDefault(); e.stopPropagation(); checkUpdate(); }
});

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
/** 开卷续档：只有 PWA 独立窗口重开且标记新鲜才直进（防「每次开页被劫持进局」）；
 *  普通浏览器访问落封面，由封面续读入口显式进入；坏档不自动进，防死循环。
 *  网络与账号状态完全不参与。 */
const isStandalonePWA = () => matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;
async function tryResume() {
  let marker = null;
  try { marker = JSON.parse(localStorage.getItem(LASTPLAY) ?? 'null'); } catch { clearLastPlay(); return; }
  if (!marker?.saveId || AUTO) return;
  const brokenId = await app.store.getMeta('brokenLastPlay');
  const plan = resumePlan({ marker, brokenId, nowMs: Date.now(), standalone: isStandalonePWA() });
  if (plan.act !== 'resume') return; // 标记保留：封面续读入口仍在，只是不再不问自进
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
        // 只标记，不热切：runLoop 在拍间隙（自然停点）跟进，绝不在演出或等待拍中间换档。
        if (doc.id !== app.saveId) return;
        app.pendingRemote = doc.id;
      },
      onFork: fork => {
        // 冲突分叉：主线槽位按协议换血，但活动局跟着本机谱系走分叉——绝不读到被顶替的主线。
        if (fork.forkOf !== app.saveId) return;
        app.saveId = fork.id;
        markLastPlay(fork.id);
        stage.toast('检测到另一设备的同名进度——本机进度已另存为分支，当前进行继续');
      },
    });
    const unfinished = new Map();
    for (const g of app.catalog) {
      const row = document.createElement('div');
      row.className = 'game-row';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'game-main';
      const saves = await app.store.listSaves(g.id);
      const last = saves.find(s => !s.summary?.ended);
      // 续读意图显式化：卡片直接告诉玩家「点这里是从哪续」，选择权在开卷那一刻
      const resumeHint = last && !AUTO ? `<span class="g-sub">续读 · ${last.summary?.chapterTitle ?? '进行中'} · 存档 ${String(last.id).slice(0, 8)}</span>` : '';
      b.innerHTML = `${g.title}<span class="g-sub">${g.subtitle ?? ''}</span>${g.hook ? `<span class="g-hook">${g.hook}</span>` : ''}${resumeHint}`;
      b.onclick = () => (last && !AUTO) ? loadSave(last.id).catch(failNote) : startGame(g.id).catch(failNote);
      row.appendChild(b);
      for (const sv of saves) if (!sv.summary?.ended) unfinished.set(sv.id, sv);
      if (last && !AUTO) {
        // 存档不膨胀：卡片点击优先续读未完成档；开新局必须是显式动作。
        const c = document.createElement('button');
        c.type = 'button';
        c.className = 'game-new';
        c.textContent = '开新局';
        c.onclick = () => startGame(g.id).catch(failNote);
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
        else if (cause === 'fatalTitle') { sessionStorage.removeItem('nu.reload.cause'); stage.toast('已回到封面——本地进度未被删除，可从存档面板或重新对位进入'); }
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
