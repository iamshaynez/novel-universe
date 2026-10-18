// 播放器：拉取游戏 IR 与状态，渲染场景/立绘/对话框/选项；服务端驱动引擎。
import { AudioEngine } from '/audio.mjs';

const $ = id => document.getElementById(id);
const els = {
  bg: $('bg'), rain: $('rain'), chibi: $('chibi'), dialog: $('dialog'),
  nameplate: $('nameplate'), text: $('text'), choices: $('choices'),
  title: $('title'), gameList: $('gameList'), ending: $('ending'), endingTitle: $('endingTitle'),
  endingsCollected: $('endingsCollected'), chapterLabel: $('chapterLabel'),
  savesPanel: $('savesPanel'), savesList: $('savesList'), toast: $('toast'),
};
const audio = new AudioEngine();

const state = { game: null, saveId: null, ir: null, typing: null, lastLine: '', instant: false };
const sceneCache = new Map(), chibiCache = new Map();

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

function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('on');
  setTimeout(() => els.toast.classList.remove('on'), 1800);
}

// ---- 演出 ----
async function applyView(view) {
  if (!view) return;
  if (view.bg) {
    const { id, params = {} } = view.bg;
    const scene = await resolveScene(id, params);
    els.bg.innerHTML = scene.svg;
    els.rain.classList.toggle('on', scene.effects.includes('rain'));
  }
  if ('show' in view) {
    if (view.show?.id) {
      const { id, expr } = view.show;
      if (!chibiCache.has(id)) chibiCache.set(id, await import(`/assets/chibi/${id}.mjs`));
      els.chibi.innerHTML = chibiCache.get(id).render(expr);
      els.chibi.classList.remove('on');
      void els.chibi.offsetWidth; // 重触发入场动画
      els.chibi.classList.add('on');
    } else {
      els.chibi.classList.remove('on');
    }
  }
  if (view.bgm) { state.lastView = view; audio.play(view.bgm).catch(() => {}); }
}

async function resolveScene(locId, params) {
  // g00 的地点 id 与场景文件名一致（universe/locations/*.scene_file）；
  // 未来由 IR 内嵌映射，此处按同名约定 + 少量特例。
  const file = { rooftop: 'rooftop', 'night-street': 'night-street' }[locId] ?? locId;
  if (!sceneCache.has(file)) sceneCache.set(file, await import(`/assets/scenes/${file}.mjs`));
  return sceneCache.get(file).render(params);
}

function typeLine(text, voiceHz) {
  clearInterval(state.typing);
  els.text.textContent = '';
  if (state.instant) { els.text.textContent = text; return; }
  let i = 0;
  state.typing = setInterval(() => {
    if (i >= text.length) { clearInterval(state.typing); state.typing = null; return; }
    els.text.textContent += text[i];
    if (i % 2 === 0 && text[i] !== ' ') audio.blip(voiceHz ?? 175);
    i++;
  }, 46);
}

async function renderState(s) {
  els.chapterLabel.textContent = `${s.chapterTitle ?? ''}`;
  await applyView(s.view);
  if (s.kind === 'line') {
    els.dialog.style.display = 'flex';
    els.choices.classList.remove('on');
    els.ending.classList.remove('on');
    const sp = s.speaker ? state.ir.speakers[s.speaker] : null;
    if (s.speaker && sp) {
      els.nameplate.style.display = 'block';
      els.nameplate.textContent = s.speaker;
    } else {
      els.nameplate.style.display = 'none';
    }
    state.lastLine = s.text;
    typeLine(s.text, sp?.voice_hz);
  } else if (s.kind === 'choice') {
    els.dialog.style.display = 'flex';
    els.text.textContent = state.lastLine; // 保留上一句作为语境
    clearInterval(state.typing);
    els.choices.innerHTML = '';
    s.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.textContent = o.label;
      b.onclick = async () => {
        try {
          const r = await api.post(`/api/saves/${state.saveId}/choose`, { index: i });
          renderState(r.state);
        } catch (e) { toast(e.message); }
      };
      els.choices.appendChild(b);
    });
    els.choices.classList.add('on');
  } else if (s.kind === 'ending') {
    clearInterval(state.typing);
    els.dialog.style.display = 'none';
    els.choices.classList.remove('on');
    els.endingTitle.textContent = s.title;
    try {
      const seen = await api.j(`/api/saves/${state.saveId}/endings`);
      const names = seen.map(e => e.ending_id).map(id => state.ir.endings.find(x => x.id === id)?.title ?? id);
      els.endingsCollected.innerHTML = `已收集结局 ${seen.length}/${state.ir.endings.length}<br>${names.join(' · ')}`;
    } catch { /* noop */ }
    els.ending.classList.add('on');
  }
}

// ---- 流程 ----
async function startGame(gameId) {
  const info = await api.j(`/api/games/${gameId}`);
  state.game = gameId; state.ir = info.ir;
  const r = await api.post(`/api/games/${gameId}/saves`, { player: '玩家' });
  state.saveId = r.saveId;
  els.title.style.display = 'none';
  els.ending.classList.remove('on');
  renderState(r.state);
}

async function loadSave(saveId) {
  const r = await api.j(`/api/saves/${saveId}`);
  const info = await api.j(`/api/games/${r.save.gameId}`);
  state.game = r.save.gameId; state.ir = info.ir; state.saveId = saveId;
  els.title.style.display = 'none';
  els.savesPanel.classList.remove('on');
  renderState(r.state);
}

async function openSaves() {
  if (!state.game) { toast('先开始游戏'); return; }
  const list = await api.j(`/api/saves?gameId=${state.game}`);
  els.savesList.innerHTML = list.length ? '' : '<div style="color:#6d5f80;font-size:12px">暂无存档</div>';
  for (const s of list) {
    const div = document.createElement('div');
    div.className = 'save';
    div.innerHTML = `<span>#${s.id} ${s.player}</span><span style="color:#6d5f80">${s.ended ? `已通关(${s.ended})` : '进行中'}</span>`;
    div.onclick = () => loadSave(s.id);
    els.savesList.appendChild(div);
  }
  els.savesPanel.classList.toggle('on');
}

// ---- 事件 ----
els.dialog.addEventListener('click', async () => {
  if (state.typing) { // 快进打字
    clearInterval(state.typing); state.typing = null;
    els.text.textContent = state.lastLine;
    return;
  }
  if (els.choices.classList.contains('on')) return;
  try {
    const r = await api.post(`/api/saves/${state.saveId}/advance`);
    if (r.state.kind === 'ending' || r.state.kind === 'line' || r.state.kind === 'choice') renderState(r.state);
  } catch (e) { toast(e.message); }
});
$('btnRestart').onclick = () => state.game && startGame(state.game);
$('btnAgain').onclick = () => startGame(state.game);
$('btnTitle').onclick = () => location.reload();
$('btnSaves').onclick = openSaves;
$('btnBgm').onclick = (e) => {
  const on = audio.toggleBgm();
  e.currentTarget.textContent = on ? '♪ BGM' : '♪ 已静';
  if (on && state.lastView?.bgm) audio.play(state.lastView.bgm);
};
document.addEventListener('pointerdown', () => audio.ensure(), { once: true });

// ---- 启动 ----
(async () => {
  const games = await api.j('/api/games');
  for (const g of games) {
    const b = document.createElement('button');
    b.innerHTML = `${g.title}<div style="font-size:.55em;color:#9a8aad;margin-top:.3em">${g.subtitle ?? ''}</div>`;
    b.onclick = () => startGame(g.id);
    els.gameList.appendChild(b);
  }
  // ?auto=1：自动开局并推进到首个选择点（冒烟截图/演示用）
  if (new URLSearchParams(location.search).has('auto')) {
    state.instant = true;
    await startGame(games[0].id);
    let guard = 0;
    let s = (await api.j(`/api/saves/${state.saveId}`)).state;
    while (s.kind !== 'choice' && guard++ < 60) {
      s = (await api.post(`/api/saves/${state.saveId}/advance`)).state;
    }
    renderState(s);
  }
})();
