// 文字舞台词汇模块:排版即运镜,演出单元全部内容无关化。
// 由 IR + canon 摘要块驱动(ADR-004 舞台合同 v0);剧本零演出标注。
// 行内实体签名(人物/地点/组织/关键信息/引语朱批)由 markup.mjs 从 canon 块自动推导(ADR-005)。
import { buildLexicon, segment, markupText } from './markup.mjs';
const $ = s => document.querySelector(s);
const reflow = el => { void el.offsetWidth; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

// 纸上墨化:人物主题色为暗底亮色(正典 stage.theme),印到案卷纸上时向浓墨收敛保证可读。
// 与 tokens.json 的 paper_ink(#332e21)保持同步。
const INK_RGB = [51, 46, 33];
function inkify(color, amt = .62) {
  if (!color || !color.startsWith('#')) return color;
  if (color.startsWith('var(')) return color.includes('accent') ? '#7d6226' : color;
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const out = m[1].match(/../g).map((h, i) => {
    const v = parseInt(h, 16);
    return Math.round(v * (1 - amt) + INK_RGB[i] * amt);
  });
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('');
}

/** 未登典呼入者的伪声纹：名字确定性哈希 → 80–400Hz。同名恒同形（可比对），无随机。
 *  已登典呼入者（caller_char 绑定）用正典 voice_hz——「陈先生/刘先生/他」同为 96Hz 同形，
 *  是播种层埋下的公平线索：波形可比对，数字不标（回报拍才亮数字）。 */
export function callerHz(name) {
  let h = 0;
  for (const ch of String(name ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return 80 + (h % 321);
}

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
    this.lex = buildLexicon({}); // 空词典兜底：IR 加载前只标数字与引语
    this._bindGesture();
  }

  // 行内签名词典：随 IR 重建（纪元过滤已在编译期完成，这里拿到什么就能标什么）
  setLexicon(ir) { this.lex = buildLexicon(ir ?? {}); }
  mark(t) { return markupText(t, this.lex); }

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
  static phrases(t) { return segment(t).map(p => p.text); }
  /** 呼吸停顿档：句末长歇，逗顿短歇，破折号悬一口气。闭引号先剥掉再判尾标点。 */
  static pauseOf(p, dlg) {
    const tail = p.replace(/[」』）)]+$/, '').slice(-1);
    if (/[。！？…]/.test(tail)) return dlg ? 860 : 820;
    if (/[，、,;]/.test(tail)) return dlg ? 470 : 440;
    if (p.endsWith('——')) return 680;
    return dlg ? 560 : 520;
  }

  async tell(text) {
    this.revealing = true;
    const segs = segment(text);
    for (let i = 0; i < segs.length; i++) {
      const p = segs[i];
      // 首拍 = 段落导语（杂志排版：略放大加重，给出节奏头）；引语块拍带 qb
      this._append((i === 0 ? 'lead' : '') + (p.q ? ' qb' : ''), this.mark(p.text));
      this.audio.narr((this._rnd() - .5) * .06);
      await this.pause(Stage.pauseOf(p.text, false));
    }
    this.revealing = false; this.fast = false;
  }
  async say(name, text, { theme = 'var(--accent)', hz = 218, dir = 'r' } = {}) {
    this.revealing = true;
    const who = inkify(theme);
    const chip = `<span class="who" style="color:${who}">${name}</span>`;
    // 台词文本以「」整体包裹（frame）：外框不算引语，框内逗号照常断拍
    for (const p of segment(text, { frame: true })) {
      this._append('dlg' + (dir === 'l' ? ' lslide' : '') + (p.q ? ' qb' : ''),
        chip + this.mark(p.text));
      this.audio.blip(hz);
      await this.pause(Stage.pauseOf(p.text, true));
    }
    this.revealing = false; this.fast = false;
  }

  async choice(stem, options) {
    if (stem) this._append('', this.mark(stem));
    return new Promise(res => {
      const c = this._append('choice', '');
      options.forEach((label, i) => {
        const d = document.createElement('div');
        d.className = 'opt';
        d.innerHTML = `<span class="branch"></span><span class="txt">${this.mark(label)}</span>`;
        d.addEventListener('pointerdown', ev => { ev.stopPropagation(); c.innerHTML = ''; res(i); });
        c.appendChild(d);
        setTimeout(() => d.classList.add('in'), 500 + i * 400);
      });
    });
  }

  /** 转写交互（g01 原语）：呼入方报话，玩家把留言打进呼机。
   *  判定在服务端（可多打不漏字）；错一次即亮底单参照，点参照可直接抄录。
   *  hz：呼入者声纹频率（登典者用正典 voice_hz，未登典用确定性伪声纹）——形状即线索，不标数字。 */
  async transcribe({ caller, target, misses = 0, hz = null }) {
    this._append('', this.mark(`【转写】${caller ?? '呼入'} 报话——请把留言打进呼机。`));
    return new Promise(res => {
      const c = this._append('choice', '');
      c.innerHTML = `<div class="tr">
        <div class="tr-caller">${misses >= 1 ? `（第 ${misses + 1} 次尝试）` : ''}呼入 · ${this.mark(caller ?? '未知')}${hz ? Stage.waveChip(hz) : ''}</div>
        <input class="tr-in" type="text" placeholder="照呼入的话打——可以多打，不能漏" autocomplete="off">
        <button class="tr-send">发送 ↵</button>
        ${misses >= 1 ? `<div class="tr-hint">底单参照（点击抄录）——${this.mark(target)}</div>` : ''}
      </div>`;
      const inp = c.querySelector('.tr-in'), btn = c.querySelector('.tr-send');
      const hint = c.querySelector('.tr-hint');
      if (hint) hint.addEventListener('pointerdown', ev => { ev.stopPropagation(); inp.value = target; inp.focus(); });
      const done = () => {
        const v = inp.value.trim();
        if (!v) return;
        c.innerHTML = `<div class="tr-done">已入机——${this.mark(`「${v}」`)}</div>`;
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
    // 瞬态舞台层（印章/声纹卡/章节卡）挂在 #stage 根上，换幕必须一并清场——
    // 否则印章等点击时切存档/重开，旧印章残留画面叠成一层红
    this.root.querySelectorAll('.sealwrap,.charcard,.chcard').forEach(el => el.remove());
    this.pendingGate = null; this.revealing = false; this.fast = false;
    this.hint(false);
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
  /** 呼入者迷你声纹：中性墨小波形，随呼入方名并排（转写卡 / 底单回看共用）。 */
  static waveChip(hz) {
    return `<svg class="tr-wave" viewBox="0 0 96 20" aria-hidden="true"><path d="${Stage.voiceprint(hz, 96, 20)}"/></svg>`;
  }
  async charCard({ name, hz, side, theme, bio }) {
    const ink = inkify(theme);
    const card = document.createElement('div');
    card.className = `charcard ${side === 'l' ? 'l' : 'r'}`;
    card.innerHTML = `<div class="cc-kicker">人物档案 · 声纹登记</div>
      <div class="cc-name" style="color:${ink}">${name}</div>
      <svg class="cc-wave" viewBox="0 0 180 36"><path d="${Stage.voiceprint(hz)}" style="stroke:${ink}" pathLength="1000"/></svg>
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
    // 同屏只允许一枚印章：切换中的残留一律先撤
    this.root.querySelectorAll('.sealwrap').forEach(w => w.remove());
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
  /** 本作事件轴：只摆本作私有事件（宇宙编年史归 canon.html），月粒度定位；
   *  标签仅点亮后可见，同位事件错行。今夜金点永远在最右。 */
  buildTimeline(events) {
    const tl = $('#timeline');
    const ts = events.map(e => Date.parse(e.date)).filter(Number.isFinite);
    if (!ts.length) return;
    const min = Math.min(...ts), max = Math.max(...ts);
    const pad = Math.max((max - min) * .35, 75 * 86400000);
    const lo = min - pad * .4, hi = max + pad;
    const posOf = t => Math.min(97, Math.max(3, (t - lo) / (hi - lo) * 100));
    const fmt = t => { const d = new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`; };
    tl.innerHTML = `<span class="tl-era">${fmt(min)}</span><span class="tl-track" id="tlTrack">
      <span class="tl-dot now"></span></span>
      <span class="tl-era">今夜</span>`;
    const track = tl.querySelector('#tlTrack');
    events.forEach((ev, i) => {
      const t = Date.parse(ev.date);
      if (!Number.isFinite(t)) return;
      const pos = posOf(t);
      const dot = document.createElement('span');
      dot.className = 'tl-dot'; dot.id = `tl-${ev.id}`; dot.style.left = pos + '%';
      const tag = document.createElement('span');
      tag.className = 'tl-tag'; tag.id = `tlt-${ev.id}`; tag.style.left = pos + '%';
      tag.style.top = (i % 2 ? 22 : 11) + 'px';
      tag.textContent = ev.title;
      track.appendChild(dot); track.appendChild(tag);
    });
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
    w.className = 'chcard';
    w.innerHTML = `<div class="ch-num">${numText}</div><div class="ch-bar"></div>
      <div class="ch-title">${title}</div><div class="ch-seal">章</div>`;
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
// 案卷画风:窗外夜色印在档案室墙上 —— 剪影为暖墨,灯火为金/朱,全部低饱和。
const SKYLINE = `
  <g fill="#191410" opacity=".9">
    <path d="M0 548 L0 430 L64 430 L64 412 L92 412 L92 430 L120 430 L120 468 L188 468 L188 440 L262 440 L262 486 L330 486 L330 462 L392 462 L392 496 L1280 496 L1280 548 Z"/>
    <path d="M936 548 L936 448 L1002 448 L1002 470 L1080 470 L1080 442 L1160 442 L1160 474 L1280 474 L1280 548 Z"/>
  </g>
  <g fill="#d8b878" opacity=".32">
    <rect x="20" y="452" width="6" height="8"/><rect x="140" y="480" width="6" height="8"/>
    <rect x="300" y="474" width="6" height="8"/><rect x="960" y="466" width="6" height="8"/>
    <rect x="1120" y="458" width="6" height="8"/><rect x="1230" y="486" width="6" height="8"/>
  </g>
  <g stroke="#211a12" stroke-width="1.2" opacity=".5">
    <line x1="0" y1="352" x2="1280" y2="352"/><line x1="0" y1="428" x2="1280" y2="428"/>
    <line x1="90" y1="348" x2="90" y2="432"/><line x1="340" y1="348" x2="340" y2="432"/>
    <line x1="590" y1="348" x2="590" y2="432"/><line x1="840" y1="348" x2="840" y2="432"/>
    <line x1="1090" y1="348" x2="1090" y2="432"/>
  </g>
  <g fill="#d9c290">
    <circle class="mote" cx="300" cy="200" r="2.4"/><circle class="mote" cx="520" cy="150" r="2"/>
    <circle class="mote" cx="760" cy="120" r="2.2"/><circle class="mote" cx="1000" cy="170" r="2"/>
    <circle class="mote" cx="880" cy="230" r="1.8"/><circle class="mote" cx="420" cy="260" r="2.6"/>
    <circle class="mote" cx="1120" cy="260" r="2.2"/><circle class="mote" cx="180" cy="150" r="1.8"/>
  </g>`;

const AMBIENT = {
  rooftop(mood, params) {
    const night = params.time === 'night';
    const [top, mid, low] = night ? ['#151210', '#2a241b', '#3a3226'] : ['#332417', '#5e3b26', '#96603a'];
    const bot = night ? '#3e3626' : '#d8a869';
    return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${top}"/><stop offset=".38" stop-color="${mid}"/>
          <stop offset=".66" stop-color="${low}"/><stop offset="1" stop-color="${bot}"/></linearGradient>
        <linearGradient id="a-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#17130d" stop-opacity=".96"/>
          <stop offset=".55" stop-color="#17130d" stop-opacity=".6"/>
          <stop offset="1" stop-color="#17130d" stop-opacity=".08"/></linearGradient>
      </defs>
      <rect x="0" y="330" width="1280" height="390" fill="url(#a-sky)" opacity=".5"/>
      <circle cx="960" cy="560" r="120" fill="#e8c890" opacity=".1"/>
      ${SKYLINE}
      <rect width="1280" height="720" fill="url(#a-fade)"/>
    </svg>`;
  },
  'night-street'() {
    return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#141110"/><stop offset=".5" stop-color="#1d1914"/>
          <stop offset=".8" stop-color="#282218"/><stop offset="1" stop-color="#322a1d"/></linearGradient>
        <linearGradient id="a-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#17130d" stop-opacity=".97"/>
          <stop offset=".5" stop-color="#17130d" stop-opacity=".55"/>
          <stop offset="1" stop-color="#17130d" stop-opacity=".05"/></linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#a-sky)"/>
      <circle cx="1050" cy="150" r="42" fill="#ddd6c2" opacity=".38"/>
      <circle cx="1050" cy="150" r="90" fill="#c8c2ae" opacity=".08"/>
      <g fill="#0d0b08" opacity=".96">
        <path d="M0 548 L0 430 L64 430 L64 412 L92 412 L92 430 L120 430 L120 468 L188 468 L188 440 L262 440 L262 486 L330 486 L330 462 L392 462 L392 496 L1280 496 L1280 548 Z"/>
        <path d="M936 548 L936 448 L1002 448 L1002 470 L1080 470 L1080 442 L1160 442 L1160 474 L1280 474 L1280 548 Z"/>
      </g>
      <g fill="#8fb4ba" opacity=".26">
        <rect x="24" y="452" width="6" height="8"/><rect x="142" y="480" width="6" height="8"/>
        <rect x="306" y="474" width="6" height="8"/><rect x="962" y="464" width="6" height="8"/>
        <rect x="1124" y="458" width="6" height="8"/><rect x="1236" y="486" width="6" height="8"/>
      </g>
      <g fill="#c98a72" opacity=".26">
        <rect x="200" y="456" width="6" height="8"/><rect x="640" y="472" width="6" height="8"/>
      </g>
      <ellipse cx="320" cy="600" rx="150" ry="9" fill="#8fb4ba" opacity=".06"/>
      <ellipse cx="820" cy="640" rx="180" ry="10" fill="#c98a72" opacity=".05"/>
      <ellipse cx="1100" cy="610" rx="120" ry="8" fill="#8fb4ba" opacity=".05"/>
      <rect width="1280" height="720" fill="url(#a-fade)"/>
    </svg>`;
  },
  // g01 三地点：太升南路的灯箱街 / 河音的磁带墙 / 府南河的黑对岸（案卷调墨）
  chuantai(mood, params) {
    const night = params.time !== 'day';
    const [top, mid, low] = night ? ['#101722', '#1f2c3c', '#33505e'] : ['#3a3226', '#6a5a40', '#a08657'];
    const box = (x, y, f) => `<rect x="${x}" y="${y}" width="16" height="26" fill="${f}" opacity="${night ? .42 : .16}"/>`;
    const boxes = [[118, 466, '#8fb4a0'], [172, 446, '#c98a72'], [230, 460, '#8fb4a0'], [286, 434, '#c98a72'],
      [344, 456, '#8fb4a0'], [408, 442, '#c98a72'], [978, 450, '#8fb4a0'], [1044, 436, '#c98a72']].map(b => box(...b)).join('');
    return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${top}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${low}"/>
        </linearGradient>
        <linearGradient id="a-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#17130d" stop-opacity=".97"/>
          <stop offset=".5" stop-color="#17130d" stop-opacity=".55"/>
          <stop offset="1" stop-color="#17130d" stop-opacity=".05"/>
        </linearGradient>
      </defs>
      <rect x="0" y="360" width="1280" height="360" fill="url(#a-sky)" opacity=".55"/>
      <path d="M0 548 L0 452 L150 452 L150 428 L250 428 L250 470 L420 470 L420 436 L560 436 L560 486 L880 486 L880 444 L1010 444 L1010 478 L1280 478 L1280 548 Z" fill="#191410" opacity=".92"/>
      ${boxes}
      ${night
        ? '<circle cx="1100" cy="150" r="34" fill="#ddd6c2" opacity=".3"/><circle cx="1100" cy="150" r="80" fill="#c8c2ae" opacity=".07"/>'
        : '<circle cx="1080" cy="140" r="46" fill="#e8d9a8" opacity=".4"/>'}
      <rect width="1280" height="720" fill="url(#a-fade)"/>
    </svg>`;
  },
  heyin(mood, params) {
    const tape = (x, y, fill) => `<rect x="${x}" y="${y}" width="44" height="70" rx="3" fill="${fill}" opacity=".88"/>`;
    const tapes = Array.from({ length: 16 }, (_, i) => tape(40 + i * 78, 438 - (i % 5) * 16, i % 3 ? '#241c12' : '#2e2315')).join('');
    const glints = [3, 8, 13].map(i => `<rect x="${46 + i * 78}" y="${446 - (i % 5) * 16}" width="32" height="5" fill="#cfa76e" opacity=".5"/>`).join('');
    return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#241a10"/><stop offset=".55" stop-color="#4a3620"/><stop offset="1" stop-color="#8a6a3e"/>
      </linearGradient>
      <linearGradient id="a-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#17130d" stop-opacity=".96"/>
        <stop offset=".5" stop-color="#17130d" stop-opacity=".5"/>
        <stop offset="1" stop-color="#17130d" stop-opacity=".04"/>
      </linearGradient></defs>
      <rect x="0" y="360" width="1280" height="360" fill="url(#a-sky)" opacity=".5"/>
      ${tapes}${glints}
      <ellipse cx="640" cy="540" rx="380" ry="12" fill="#cfa76e" opacity=".08"/>
      <rect width="1280" height="720" fill="url(#a-fade)"/>
    </svg>`;
  },
  'funanhe-bank'(mood, params) {
    const night = params.time !== 'day';
    const [top, mid, low] = night ? ['#0d141d', '#1a2836', '#2c4252'] : ['#4a4434', '#7a7052', '#a89a6e'];
    const willow = x => Array.from({ length: 5 }, (_, k) =>
      `<line x1="${x + k * 7}" y1="330" x2="${x + k * 9 - 8}" y2="${430 + k * 6}"/>`).join('');
    const willows = [180, 320, 460, 1010, 1150].map(x => `<g stroke="#0f1a14" stroke-width="3" opacity=".5">${willow(x)}</g>`).join('');
    return `<svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="a-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${top}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${low}"/>
      </linearGradient>
      <linearGradient id="a-fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#17130d" stop-opacity=".97"/>
        <stop offset=".5" stop-color="#17130d" stop-opacity=".55"/>
        <stop offset="1" stop-color="#17130d" stop-opacity=".05"/>
      </linearGradient></defs>
      <rect x="0" y="330" width="1280" height="390" fill="url(#a-sky)" opacity=".55"/>
      ${willows}
      <rect x="0" y="468" width="1280" height="252" fill="${night ? '#0a121a' : '#3a3a2c'}" opacity=".5"/>
      <rect x="0" y="440" width="1280" height="28" fill="#080d12" opacity=".85"/>
      ${night
        ? '<circle cx="940" cy="150" r="30" fill="#e8e2ce" opacity=".5"/><ellipse cx="940" cy="530" rx="130" ry="8" fill="#e8e2ce" opacity=".07"/><ellipse cx="380" cy="580" rx="90" ry="6" fill="#8fb4ba" opacity=".05"/>'
        : '<ellipse cx="640" cy="520" rx="300" ry="10" fill="#e8d9a8" opacity=".1"/>'}
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
