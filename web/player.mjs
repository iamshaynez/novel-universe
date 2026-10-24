// 文字舞台播放器:API 驱动循环 + 状态差分渲染。
// 舞台合同 v0(ADR-004):chapter 变→章节卡;bg 变→氛围+印章;新说话者→声纹卡+锚点;
// fact.* 新增→时间轴点亮+线索;台词→呼吸节奏;选择→分支;结局→收集。
import { StageAudio } from '/audio.mjs';
import { Stage } from '/stage.mjs';

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
  ir: null, saveId: null, gameId: null,
  prev: { chapter: null, bgKey: null },
  met: new Set(), facts: new Set(), timelineBuilt: false, running: false,
  sheet: new Map(), // 转写底单：tid -> {caller, target}（本局回看）
};

// 代词说话者是剧本刻意匿名（g01 叙诡合同）：声纹卡/锚点只显声线，不揭名——
// 「我姓廖」那一拍之前的任何姓名都是剧透。
const MASKED_SPEAKERS = new Set(['他', '她', '它']);

const charOf = name => {
  const sp = app.ir.speakers[name];
  return sp ? app.ir.characters[sp.char] : null;
};

function resetRun() {
  app.prev = { chapter: null, bgKey: null };
  app.met = new Set(); app.facts = new Set(); app.timelineBuilt = false; app.sheet.clear();
  stage.reset(); stage.clearClues(); stage.clearAnchors();
  $('#timeline').classList.remove('on');
  $('#chapterLabel').classList.remove('on');
  $('#sheetPanel').classList.remove('on');
}

/** 渲染一个停点;返回下一停点状态(结局/选择后返回其状态),终局返回 null。 */
async function renderBeat(s) {
  // 章节切换 → 清场 + 章节卡
  if (s.chapter !== app.prev.chapter) {
    const idx = Math.max(0, app.ir.chapters.findIndex(c => c.id === s.chapter));
    const ch = app.ir.chapters[idx];
    const num = CN[idx] ?? String(idx + 1);
    await stage.wipe();
    await stage.chapterCard(`第${num}章`, ch.title);
    stage.setChapterLabel(`第${num}章 · ${ch.title}`);
    app.prev.chapter = s.chapter;
    app.prev.bgKey = null;
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
      await stage.say(s.speaker, s.text, { theme, hz, dir: side });
    } else {
      await stage.tell(s.text);
    }
    stage.dismissCard(card);
    await stage.gate();
    const r = await api.post(`/api/saves/${app.saveId}/advance`);
    if (r.state.kind === 'void') { stage.toast('剧情已到尽头'); return null; }
    return r.state;
  }

  if (s.kind === 'choice') {
    const idx = await stage.choice(null, s.options.map(o => o.label));
    const r = await api.post(`/api/saves/${app.saveId}/choose`, { index: idx });
    return r.state;
  }

  if (s.kind === 'transcribe') {
    let cur = s;
    while (cur.kind === 'transcribe') {
      const text = await stage.transcribe({ caller: cur.caller, target: cur.target, misses: cur.misses });
      const r = await api.post(`/api/saves/${app.saveId}/advance`, { text });
      if (r.state.kind === 'transcribe' && r.state.id === cur.id) { stage.toast('听岔了——再听一遍'); cur = r.state; }
      // tid 用于底单/flag 追踪；同节点判定用 id
      else { app.sheet.set(cur.tid, { caller: cur.caller, target: cur.target }); return r.state; }
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
  app.running = true;
  let s = s0;
  while (s) s = await renderBeat(s);
  app.running = false;
}

async function showEnding(s) {
  const seen = await api.j(`/api/saves/${app.saveId}/endings`).catch(() => []);
  const names = seen.map(e => app.ir.endings.find(x => x.id === e.ending_id)?.title ?? e.ending_id);
  $('#endTitle').textContent = s.title;
  $('#endCollected').innerHTML = `已收集结局 ${seen.length}/${app.ir.endings.length}` +
    (names.length ? `<br>${names.join(' · ')}` : '');
  $('#endcard').classList.add('on');
}

async function startGame(gameId) {
  const info = await api.j(`/api/games/${gameId}`);
  app.ir = info.ir; app.gameId = gameId;
  const r = await api.post(`/api/games/${gameId}/saves`, { player: '玩家' });
  app.saveId = r.saveId;
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
  $('#title').style.display = 'none';
  $('#savesPanel').classList.remove('on');
  $('#endcard').classList.remove('on');
  $('#worldLabel').textContent = `${app.ir.canon.world}悬疑宇宙 · ${app.ir.code}`;
  resetRun();
  runLoop(r.state);
}

async function openSaves() {
  if (!app.gameId) { stage.toast('先开始游戏'); return; }
  const list = await api.j(`/api/saves?gameId=${app.gameId}`);
  $('#savesList').innerHTML = list.length ? '' : '<div style="color:var(--ink-dim);font-size:12px">暂无存档</div>';
  for (const sv of list) {
    const div = document.createElement('div');
    div.className = 'save';
    div.innerHTML = `<span>#${sv.id} 存档</span><span style="color:var(--ink-dim)">${sv.ended ? `已通关(${sv.ended})` : '进行中'}</span>`;
    div.onclick = () => loadSave(sv.id);
    $('#savesList').appendChild(div);
  }
  $('#savesPanel').classList.toggle('on');
}

// ---- HUD 按钮 ----
$('#btnSaves').onclick = openSaves;
// 底单回看：本局转写记录（悬疑玩家要翻回去对时间戳与号码）
$('#btnSheet').onclick = () => {
  const panel = $('#sheetPanel'), list = $('#sheetList');
  const items = [...app.sheet.values()];
  list.innerHTML = items.length ? '' : '<div style="color:#6e6549;font-size:12px">还没有转写记录</div>';
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'tr-row';
    div.innerHTML = `<span class="tr-row-caller">${it.caller ?? '呼入'}</span><span class="tr-row-text">${it.target}</span>`;
    list.appendChild(div);
  }
  panel.classList.toggle('on');
};
// 破坏性操作二次确认：第一次点击只亮「确认？」，2.5s 内再点才执行——防误触毁档
function armConfirm(btn, fn) {
  btn.onclick = () => {
    if (btn.dataset.armed) {
      btn.dataset.armed = ''; btn.textContent = btn.dataset.label;
      fn();
    } else {
      btn.dataset.label = btn.textContent;
      btn.dataset.armed = '1'; btn.textContent = '确认？';
      setTimeout(() => {
        if (btn.dataset.armed) { btn.dataset.armed = ''; btn.textContent = btn.dataset.label; }
      }, 2500);
    }
  };
}
armConfirm($('#btnRestart'), () => app.gameId && startGame(app.gameId));
armConfirm($('#btnTitle'), () => location.reload());
$('#btnAgain').onclick = () => startGame(app.gameId);
$('#btnBackTitle').onclick = () => location.reload();
$('#btnMute').onclick = e => {
  audio.muted = !audio.muted;
  e.currentTarget.textContent = audio.muted ? '♪ 已静' : '♪ 音效';
};
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// ---- 启动:标题页游戏列表;?auto=1 冒烟 ----
(async () => {
  const games = await api.j('/api/games');
  for (const g of games) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:center';
    const b = document.createElement('button');
    b.innerHTML = `${g.title}<span class="g-sub">${g.subtitle ?? ''}</span>`;
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
})();
