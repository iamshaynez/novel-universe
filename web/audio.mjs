// 浏览器音频引擎：合成原语 + 乐谱模块加载 + 角色声线 blip。
// 乐谱（assets/scores/*.mjs）通过 start(api) 合同接入，与离线渲染器共享参数。
const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

export class AudioEngine {
  constructor() {
    this.ctx = null; this.master = null; this.wet = null;
    this.current = null; this.currentId = null;
    this.scoreCache = new Map();
    this.bgmOn = true;
    this.volume = 0.55;
  }

  ensure() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1.8;
    const ir = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
    const conv = this.ctx.createConvolver();
    conv.buffer = ir;
    this.wet = this.ctx.createGain(); this.wet.gain.value = 0.4;
    conv.connect(this.wet); this.wet.connect(this.master);
    this.conv = conv;
  }

  api() {
    return {
      ctx: this.ctx, dest: this.master, wet: this.conv,
      musicbox: (...a) => this.musicbox(...a),
      padChord: (...a) => this.padChord(...a),
      pluck: (...a) => this.pluck(...a),
      noiseSource: (dur) => this.noiseSource(dur),
      mulberry32,
    };
  }

  async play(scoreId) {
    if (!this.bgmOn) return;
    this.ensure();
    if (this.currentId === scoreId) return;
    this.stopCurrent();
    if (!this.scoreCache.has(scoreId)) {
      this.scoreCache.set(scoreId, await import(`/assets/scores/${scoreId}.mjs`));
    }
    const mod = this.scoreCache.get(scoreId);
    this.current = mod.start(this.api());
    this.currentId = scoreId;
  }
  stopCurrent() {
    if (this.current) { try { this.current.stop(); } catch { /* noop */ } }
    this.current = null; this.currentId = null;
  }
  toggleBgm() {
    this.bgmOn = !this.bgmOn;
    if (!this.bgmOn) this.stopCurrent();
    return this.bgmOn;
  }

  // ---- 合成原语（与 tools/render-bgm.mjs 同源参数） ----
  musicbox(f, t, dry, wet, volAmp = 0.16, dur = 1.5) {
    const parts = [[1, volAmp], [2, volAmp * 0.35], [3, volAmp * 0.1]];
    for (const [m, v] of parts) {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / m);
      o.connect(g); g.connect(dry); g.connect(wet);
      o.start(t); o.stop(t + dur / m + 0.05);
    }
  }
  padChord(freqs, t, dur, dry, wet) {
    for (const f of freqs) for (const det of [-7, 6]) {
      const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = 0.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.035, t + dur * 0.45);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(lp); lp.connect(g); g.connect(dry); g.connect(wet);
      o.start(t); o.stop(t + dur + 0.05);
    }
  }
  pluck(f, t, dry, wet, volAmp = 0.14) {
    const N = Math.round(this.ctx.sampleRate / f);
    const buf = this.ctx.createBuffer(1, N, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    const r = mulberry32((f * 1000) | 0);
    for (let i = 0; i < N; i++) d[i] = r() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = f * 5; bp.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volAmp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(bp); bp.connect(g); g.connect(dry); g.connect(wet);
    src.start(t); src.stop(t + 2);
  }
  noiseSource(dur) {
    const len = this.ctx.sampleRate * dur;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    return src;
  }

  /** 台词声线：短促方波 blip，基频来自角色档案 voice_hz。 */
  blip(baseHz = 185) {
    if (!this.ctx || !this.bgmOn) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'square';
    o.frequency.value = baseHz * (0.92 + Math.random() * 0.16);
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.07);
  }
}
