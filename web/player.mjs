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
  prev: { chapter: null, bgId: null },
  met: new Set(), facts: new Set(), timelineBuilt: false, running: false,
};

const charOf = name => {
  const sp = app.ir.speakers[name];
  return sp ? app.ir.characters[sp.char] : null;
};

function resetRun() {
  app.prev = { chapter: null, bgId: null };
  app.met = new Set(); app.facts = new Set(); app.timelineBuilt = false;
  stage.reset(); stage.clearClues(); stage.clearAnchors();
  $('#timeline').classList.remove('on');
  $('#chapterLabel').classList.remove('on');
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
    app.prev.bgId = null;
  }
  // 地点切换 → 氛围层 + 印章
  const bgId = s.view?.bg?.id ?? null;
  if (bgId && bgId !== app.prev.bgId) {
    const loc = app.ir.canon.locations.find(l => l.id === bgId);
    const time = ({ dusk: '黄昏', night: '夜' })[s.view.bg.params?.time];
    stage.setAmbient(bgId, loc?.mood ?? {}, s.view.bg.params ?? {});
    if (loc) await stage.seal(loc.name, app.ir.canon.world + (time ? ` · ${time}` : ''));
    app.prev.bgId = bgId;
  }
  // 正典事实差分 → 时间轴点亮 + 线索解锁
  for (const k of Object.keys(s.flags ?? {})) {
    if (!k.startsWith('fact.') || app.facts.has(k)) continue;
    app.facts.add(k);
    const ev = app.ir.canon.events.find(e => e.id === k.slice(5));
    if (!ev) continue;
    if (!app.timelineBuilt) { stage.buildTimeline(app.ir.canon.events); app.timelineBuilt = true; }
    stage.showTimeline(); stage.lightEvent(ev); stage.addClue(ev.title); audio.chime();
  }

  if (s.kind === 'line') {
    let card = null;
    if (s.speaker) {
      const c = charOf(s.speaker);
      const side = c?.stage?.side === 'l' ? 'l' : 'r';
      const theme = c?.stage?.theme ?? 'var(--accent)';
      const hz = c?.voice_hz ?? 185;
      if (c && !app.met.has(c.id)) {
        app.met.add(c.id);
        card = await stage.charCard({ name: c.name, hz, side, theme, bio: c.bio_public });
      }
      if (c) stage.setAnchor(c.name, side, theme);
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
  $('#savesList').innerHTML = list.length ? '' : '<div style="color:#6d5f80;font-size:12px">暂无存档</div>';
  for (const sv of list) {
    const div = document.createElement('div');
    div.className = 'save';
    div.innerHTML = `<span>#${sv.id} 存档</span><span style="color:#6d5f80">${sv.ended ? `已通关(${sv.ended})` : '进行中'}</span>`;
    div.onclick = () => loadSave(sv.id);
    $('#savesList').appendChild(div);
  }
  $('#savesPanel').classList.toggle('on');
}

// ---- HUD 按钮 ----
$('#btnSaves').onclick = openSaves;
$('#btnRestart').onclick = () => app.gameId && startGame(app.gameId);
$('#btnAgain').onclick = () => startGame(app.gameId);
$('#btnBackTitle').onclick = () => location.reload();
$('#btnTitle').onclick = () => location.reload();
$('#btnMute').onclick = e => {
  audio.muted = !audio.muted;
  e.currentTarget.textContent = audio.muted ? '♪ 已静' : '♪ 音效';
};
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// ---- 启动:标题页游戏列表;?auto=1 冒烟 ----
(async () => {
  const games = await api.j('/api/games');
  for (const g of games) {
    const b = document.createElement('button');
    b.innerHTML = `${g.title}<span class="g-sub">${g.subtitle ?? ''}</span>`;
    b.onclick = () => startGame(g.id);
    $('#gameList').appendChild(b);
  }
  if (AUTO) await startGame(games[0].id);
})();
