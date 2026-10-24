// 文字舞台词汇模块:排版即运镜,演出单元全部内容无关化。
// 由 IR + canon 摘要块驱动(ADR-004 舞台合同 v0);剧本零演出标注。
const $ = s => document.querySelector(s);
const reflow = el => { void el.offsetWidth; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

export class Stage {
  constructor(audio, { auto = false } = {}) {
    this.audio = audio;
    this.auto = auto;
    this.root = $('#stage');
    this.flow = $('#flow');
    this.lines = [];
    this.off = 0;
    this.revealing = false;
    this.fast = false;
    this.pendingGate = null;
    this.rngSeed = 2049;
    this._bindGesture();
  }

  // ---------- 手势:点击/空格推进;揭示中点击 = 快进本拍 ----------
  _bindGesture() {
    const act = () => {
      if (this.revealing) this.fast = true;
      else if (this.pendingGate) { const r = this.pendingGate; this.pendingGate = null; this.hint(false); r(); }
    };
    this.root.addEventListener('pointerdown', () => { this.audio.ensure(); act(); });
    addEventListener('keydown', e => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); act(); }
    });
    addEventListener('resize', () => this.relayout());
  }
  hint(on) { $('#hint').classList.toggle('on', on && !this.auto); }
  gate() {
    if (this.auto) return sleep(380);
    return new Promise(r => { this.pendingGate = r; this.hint(true); });
  }
  pause(ms) { return sleep(this.fast ? Math.min(ms, 50) : ms); }
  idle() { return !this.revealing && !this.pendingGate; }
  rush() { if (this.revealing) this.fast = true; }

  // ---------- 文字流 ----------
  relayout() {
    const last = this.lines[this.lines.length - 1]; if (!last) return;
    const anchor = this.root.clientHeight * .60;
    this.off += anchor - last.getBoundingClientRect().bottom;
    this.flow.style.transform = `translate(-50%, ${this.off}px)`;
  }
  _dim() {
    this.lines.forEach((el, i) => {
      const d = this.lines.length - 1 - i;
      el.classList.toggle('old1', d === 1 || d === 2);
      el.classList.toggle('old2', d === 3 || d === 4);
      el.classList.toggle('old3', d >= 5);
    });
  }
  _append(cls, html) {
    const el = document.createElement('div');
    el.className = 'ln ' + cls; el.innerHTML = html;
    this.flow.appendChild(el); this.lines.push(el);
    reflow(el); el.classList.add('in');
    this.relayout(); this._dim();
    return el;
  }
  static phrases(t) { return t.split(/(?<=[。,、!?…]|——)/).filter(x => x); }

  async tell(text) {
    this.revealing = true;
    for (const p of Stage.phrases(text)) {
      this._append('', p);
      this.audio.narr();
      await this.pause(/[。!?…]$/.test(p) ? 820 : (p.endsWith('——') ? 680 : 520));
    }
    this.revealing = false; this.fast = false;
  }
  async say(name, text, { theme = 'var(--accent)', hz = 185, dir = 'r' } = {}) {
    this.revealing = true;
    for (const p of Stage.phrases(text)) {
      this._append('dlg' + (dir === 'l' ? ' lslide' : ''),
        `<span class="who" style="color:${theme}">${name}</span>${p}`);
      this.audio.blip(hz);
      await this.pause(/[。!?…]/.test(p) ? 860 : 560);
    }
    this.revealing = false; this.fast = false;
  }

  async choice(stem, options) {
    if (stem) this._append('', stem);
    return new Promise(res => {
      const c = this._append('choice', '');
      options.forEach((label, i) => {
        const d = document.createElement('div');
        d.className = 'opt';
        d.innerHTML = `<span class="branch"></span><span class="txt">${label}</span>`;
        d.addEventListener('pointerdown', ev => { ev.stopPropagation(); c.innerHTML = ''; res(i); });
        c.appendChild(d);
        setTimeout(() => d.classList.add('in'), 500 + i * 400);
      });
    });
  }

  /** 转写交互（g01 原语）：呼入方报话，玩家把留言打进呼机。错两次亮出底单参照。 */
  async transcribe({ caller, target, misses = 0 }) {
    this._append('', `【转写】${caller ?? '呼入'} 报话——请把留言打进呼机。`);
    return new Promise(res => {
      const c = this._append('choice', '');
      c.innerHTML = `<div class="tr">
        <div class="tr-caller">${misses >= 1 ? `（第 ${misses + 1} 次尝试）` : ''}呼入 · ${caller ?? '未知'}</div>
        <input class="tr-in" type="text" placeholder="留言内容…" autocomplete="off">
        <button class="tr-send">发送 ↵</button>
        ${misses >= 2 ? `<div class="tr-hint">底单参照——${target}</div>` : ''}
      </div>`;
      const inp = c.querySelector('.tr-in'), btn = c.querySelector('.tr-send');
      const done = () => {
        const v = inp.value.trim();
        if (!v) return;
        c.innerHTML = `<div class="tr-done">已入机——「${v}」</div>`;
        res(v);
      };
      btn.addEventListener('pointerdown', ev => { ev.stopPropagation(); done(); });
      inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.isComposing || ev.keyCode === 229) return; if (ev.key === 'Enter') done(); });
      setTimeout(() => { inp.classList.add('in'); if (!this.auto) inp.focus(); }, 400);
      if (this.auto) setTimeout(() => { inp.value = target; done(); }, this.fast ? 50 : 1200);
    });
  }

  async wipe() {
    this.flow.style.opacity = '0';
    await sleep(this.auto ? 60 : 900);
    this.reset();
    this.flow.style.opacity = '1';
    await sleep(this.auto ? 0 : 250);
  }
  reset() {
    this.flow.innerHTML = ''; this.lines.length = 0; this.off = 0;
    this.flow.style.transform = 'translate(-50%, 0)';
  }

  // ---------- 角色锚点(分侧)与声纹卡 ----------
  setAnchor(char, side, theme) {
    const key = `anc-${side}`;
    let el = document.getElementById(key);
    if (!el) {
      el = document.createElement('div');
      el.id = key; el.className = `anchor ${side}`;
      $('#anchors').appendChild(el);
    }
    el.textContent = char; el.style.color = theme; el.classList.add('on');
  }
  clearAnchors() { document.querySelectorAll('.anchor').forEach(a => a.classList.remove('on')); }

  static voiceprint(hz, w = 180, h = 36) {
    let d = '';
    for (let x = 0; x <= w; x += 3) {
      const env = Math.pow(Math.sin(Math.PI * x / w), .7);
      const y = h / 2 + Math.sin(x * hz / 34) * env * (h / 2 - 4);
      d += (x ? 'L' : 'M') + x + ' ' + y.toFixed(1) + ' ';
    }
    return d;
  }
  async charCard({ name, hz, side, theme, bio }) {
    const card = document.createElement('div');
    card.className = `charcard ${side === 'l' ? 'l' : 'r'}`;
    card.innerHTML = `<div class="cc-name" style="color:${theme}">${name}</div>
      <svg class="cc-wave" viewBox="0 0 180 36"><path d="${Stage.voiceprint(hz)}" style="stroke:${theme}" pathLength="1000"/></svg>
      <div class="cc-bio">${bio}<br>声线 ${hz} Hz · ${side === 'l' ? '左' : '右'}侧站位</div>`;
    this.root.appendChild(card);
    reflow(card); card.classList.add('on');
    const p = card.querySelector('path');
    p.style.strokeDasharray = '1000'; p.style.strokeDashoffset = '1000'; reflow(p);
    p.style.transition = 'stroke-dashoffset 1s ease .25s'; p.style.strokeDashoffset = '0';
    this.audio.blip(hz);
    await sleep(this.auto ? 60 : 1400);
    return card;
  }
  dismissCard(card) { if (card) { card.classList.remove('on'); setTimeout(() => card.remove(), 900); } }

  // ---------- 地点:印章 + 氛围层 ----------
  async seal(name, caption) {
    const parts = name.split('·').map(s => s.trim()).filter(Boolean);
    const lines = parts.length >= 2 ? parts : [name.slice(0, 2), name.slice(2)].filter(Boolean);
    const w = document.createElement('div'); w.className = 'sealwrap';
    w.innerHTML = `<div class="seal">${lines.join('<br>')}</div><div class="seal-cap">${caption}</div>`;
    this.root.appendChild(w);
    await sleep(this.auto ? 60 : 550);
    w.querySelector('.seal').classList.add('in'); this.audio.stamp();
    await sleep(this.auto ? 60 : 650);
    w.querySelector('.seal-cap').classList.add('in');
    await this.gate();
    w.style.opacity = '0';
    await sleep(this.auto ? 60 : 800);
    w.remove();
  }

  setAmbient(locId, mood = {}, params = {}) {
    const a = $('#ambient');
    a.classList.remove('on');
    setTimeout(() => {
      a.innerHTML = AMBIENT[locId] ? AMBIENT[locId](mood, params) : ambientFallback(mood);
      a.classList.add('on');
    }, 200);
    // 雨幕 / 环境大字 / 霓虹戏中字 —— 全部由地点 mood 驱动
    $('#rainfx').classList.toggle('on', !!mood.rain);
    if (mood.rain) this.rainOn();
    const bc = $('#bc1');
    if (mood.bigchar) { bc.textContent = mood.bigchar; bc.classList.add('on'); }
    else bc.classList.remove('on');
    const neon = $('#neon');
    if (mood.sign) { neon.textContent = mood.sign; neon.classList.add('on'); }
    else neon.classList.remove('on');
    this.clearAnchors();
  }

  _rnd() { this.rngSeed = (this.rngSeed * 1664525 + 1013904223) >>> 0; return this.rngSeed / 4294967296; }
  rainOn(n = 110) {
    const box = $('#rainfx'); box.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const far = this._rnd() < .45;
      const s = document.createElement('i');
      s.className = 'drop' + (far ? ' far' : '');
      s.style.left = (this._rnd() * 100).toFixed(1) + 'vw';
      s.style.height = (far ? 10 + this._rnd() * 14 : 16 + this._rnd() * 26).toFixed(0) + 'px';
      s.style.opacity = (far ? .3 + this._rnd() * .25 : .55 + this._rnd() * .35).toFixed(2);
      const dur = far ? 1.1 + this._rnd() * .9 : .65 + this._rnd() * .55;
      s.style.animationDuration = dur.toFixed(2) + 's';
      s.style.animationDelay = (-this._rnd() * dur).toFixed(2) + 's';
      box.appendChild(s);
    }
  }

  // ---------- 时间轴带 ----------
  buildTimeline(events) {
    const tl = $('#timeline');
    const years = events.map(e => parseInt(e.date, 10)).filter(Number.isFinite);
    const min = years.length ? Math.min(...years) : 2009;
    const max = Math.max(...(years.length ? years : [2026]), min) + 1; // +1: 今夜永远在最右
    tl.innerHTML = `<span class="tl-era">${min}</span><span class="tl-track" id="tlTrack">
      <span class="tl-dot now"></span><span class="tl-tag now">今夜</span></span>
      <span class="tl-era">${max}</span>`;
    const track = tl.querySelector('#tlTrack');
    for (const ev of events) {
      const y = parseInt(ev.date, 10);
      if (!Number.isFinite(y)) continue;
      const pos = Math.min(97, (y - min) / (max - min) * 100);
      const dot = document.createElement('span');
      dot.className = 'tl-dot'; dot.id = `tl-${ev.id}`; dot.style.left = pos + '%';
      const tag = document.createElement('span');
      tag.className = 'tl-tag'; tag.id = `tlt-${ev.id}`; tag.style.left = pos + '%'; tag.textContent = ev.title;
      track.appendChild(dot); track.appendChild(tag);
    }
  }
  showTimeline() { $('#timeline').classList.add('on'); }
  lightEvent(ev) {
    const d = document.getElementById(`tl-${ev.id}`), t = document.getElementById(`tlt-${ev.id}`);
    if (d) d.classList.add('lit');
    if (t) t.classList.add('lit');
  }

  // ---------- 线索 / 章节卡 / 结局 ----------
  addClue(label) {
    const c = document.createElement('span');
    c.className = 'chip'; c.textContent = label;
    $('#clues').appendChild(c);
    raf().then(() => c.classList.add('in'));
  }
  clearClues() { $('#clues').innerHTML = ''; }
  async chapterCard(numText, title) {
    const w = document.createElement('div');
    w.className = 'sealwrap';
    w.style.transition = 'opacity 1.1s ease';
    w.innerHTML = `<div style="display:flex;align-items:center;gap:2.6em">
      <div style="width:3px;height:26vh;border-radius:2px;background:linear-gradient(#3b2560,#93407a,#e2795a,#ffd9a3)"></div>
      <div style="writing-mode:vertical-rl;font-size:clamp(34px,6vh,58px);letter-spacing:.5em;font-weight:700">${numText}</div>
      <div style="writing-mode:vertical-rl;font-size:clamp(18px,3vh,28px);letter-spacing:.6em;color:var(--ink-dim)">${title}</div></div>`;
    this.root.appendChild(w);
    await sleep(this.auto ? 60 : 400);
    w.style.opacity = '1';
    await sleep(this.auto ? 400 : 2700);
    w.style.opacity = '0';
    await sleep(this.auto ? 60 : 650);
    w.remove();
  }
  setChapterLabel(text) {
    const el = $('#chapterLabel');
    el.textContent = text; el.classList.add('on');
  }
  toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    setTimeout(() => t.classList.remove('on'), 1800);
  }
}

// ---------- 氛围配方(场景配方降级为氛围层;新增地点在此登记或走 fallback) ----------
const SKYLINE = `
  <g fill="#1c1130" opacity=".9">
    <path d="M0 548 L0 430 L64 430 L64 412 L92 412 L92 430 L120 430 L120 468 L188 468 L188 440 L262 440 L262 486 L330 486 L330 462 L392 462 L392 496 L1280 496 L1280 548 Z"/>
    <path d="M936 548 L936 448 L1002 448 L1002 470 L1080 470 L1080 442 L1160 442 L1160 474 L1280 474 L1280 548 Z"/>
  </g>
  <g fill="#ffcf96" opacity=".35">
    <rect x="20" y="452" width="6" height="8"/><rect x="140" y="480" width="6" height="8"/>
    <rect x="300" y="474" width="6" height="8"/><rect x="960" y="466" width="6" height="8"/>
    <rect x="1120" y="458" width="6" height="8"/><rect x="1230" y="486" width="6" height="8"/>
  </g>
  <g stroke="#241536" stroke-width="1.2" opacity=".5">
    <line x1="0" y1="352" x2="1280" y2="352"/><line x1="0" y1="428" x2="1280" y2="428"/>
    <line x1="90" y1="348" x2="90" y2="432"/><line x1="340" y1="348" x2="340" y2="432"/>
    <line x1="590" y1="348" x2="590" y2="432"/><line x1="840" y1="348" x2="840" y2="432"/>
    <line x1="1090" y1="348" x2="1090" y2="432"/>
  </g>
  <g fill="#ffdcae">
    <circle class="mote" cx="300" cy="200" r="2.4"/><circle class="mote" cx="520" cy="150" r="2"/>
    <circle class="mote" cx="760" cy="120" r="2.2"/><circle class="mote" cx="1000" cy="170" r="2"/>
    <circle class="mote" cx="880" cy="230" r="1.8"/><circle class="mote" cx="420" cy="260" r="2.6"/>
    <circle class="mote" cx="1120" cy="260" r="2.2"/><circle class="mote" cx="180" cy="150" r="1.8"/>
  </g>`;

const AMBIENT = {
  rooftop(mood, params) {
    const night = params.time === 'night';
    const [top, mid, low] = night ? ['#151030', '#2c2458', '#3a3570'] : ['#3b2560', '#93407a', '#e2795a'];
    const bot = night ? '#4a4484' : '#ffd9a3';
    return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${top}"/><stop offset=".38" stop-color="${mid}"/>
          <stop offset=".66" stop-color="${low}"/><stop offset="1" stop-color="${bot}"/></linearGradient>
        <linearGradient id="a-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b0810" stop-opacity=".96"/>
          <stop offset=".55" stop-color="#0b0810" stop-opacity=".6"/>
          <stop offset="1" stop-color="#0b0810" stop-opacity=".08"/></linearGradient>
      </defs>
      <rect x="0" y="330" width="1280" height="390" fill="url(#a-sky)" opacity=".5"/>
      <circle cx="960" cy="560" r="120" fill="#ffd9a0" opacity=".1"/>
      ${SKYLINE}
      <rect width="1280" height="720" fill="url(#a-fade)"/>
    </svg>`;
  },
  'night-street'() {
    return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0d0a1e"/><stop offset=".5" stop-color="#171238"/>
          <stop offset=".8" stop-color="#221d52"/><stop offset="1" stop-color="#2b2665"/></linearGradient>
        <linearGradient id="a-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0b0810" stop-opacity=".97"/>
          <stop offset=".5" stop-color="#0b0810" stop-opacity=".55"/>
          <stop offset="1" stop-color="#0b0810" stop-opacity=".05"/></linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#a-sky)"/>
      <circle cx="1050" cy="150" r="42" fill="#e8ecff" opacity=".4"/>
      <circle cx="1050" cy="150" r="90" fill="#cdd6ff" opacity=".08"/>
      <g fill="#090614" opacity=".96">
        <path d="M0 548 L0 430 L64 430 L64 412 L92 412 L92 430 L120 430 L120 468 L188 468 L188 440 L262 440 L262 486 L330 486 L330 462 L392 462 L392 496 L1280 496 L1280 548 Z"/>
        <path d="M936 548 L936 448 L1002 448 L1002 470 L1080 470 L1080 442 L1160 442 L1160 474 L1280 474 L1280 548 Z"/>
      </g>
      <g fill="#7de3ff" opacity=".3">
        <rect x="24" y="452" width="6" height="8"/><rect x="142" y="480" width="6" height="8"/>
        <rect x="306" y="474" width="6" height="8"/><rect x="962" y="464" width="6" height="8"/>
        <rect x="1124" y="458" width="6" height="8"/><rect x="1236" y="486" width="6" height="8"/>
      </g>
      <g fill="#ff9d9d" opacity=".3">
        <rect x="200" y="456" width="6" height="8"/><rect x="640" y="472" width="6" height="8"/>
      </g>
      <ellipse cx="320" cy="600" rx="150" ry="9" fill="#7de3ff" opacity=".07"/>
      <ellipse cx="820" cy="640" rx="180" ry="10" fill="#ff9d9d" opacity=".06"/>
      <ellipse cx="1100" cy="610" rx="120" ry="8" fill="#7de3ff" opacity=".06"/>
      <rect width="1280" height="720" fill="url(#a-fade)"/>
    </svg>`;
  },
};

function ambientFallback(mood = {}) {
  const p = mood.palette && mood.palette.length ? mood.palette : ['#241536', '#0b0810'];
  const stops = p.map((c, i) => `<stop offset="${i / (p.length - 1 || 1)}" stop-color="${c}"/>`).join('');
  return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>
    <rect x="0" y="380" width="1280" height="340" fill="url(#a-sky)" opacity=".45"/>
  </svg>`;
}
