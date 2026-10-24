// 文字舞台音效:全部代码合成,零素材。voice_hz 即声线(正典 characters.voice_hz)。
export class StageAudio {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
  }
  ensure() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = .13;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) { /* 无音频环境静默 */ }
  }
  tone(hz, dur, type = 'sine', vol = .5, delay = 0) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime + delay, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = hz;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + .02);
    } catch (e) {}
  }
  blip(hz) { this.tone(hz, .07, 'sine', .5); this.tone(hz * 2, .04, 'sine', .1); }
  /** 旁白 tick；detune 为音分级微差（舞台种子驱动），去掉节拍器感。 */
  narr(detune = 0) { const hz = 165 * (1 + detune); this.tone(hz, .07, 'sine', .5); this.tone(hz * 2, .04, 'sine', .1); }
  chime() { this.tone(660, .14, 'triangle', .4); this.tone(990, .2, 'triangle', .28, .09); }
  thud() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(210, t); o.frequency.exponentialRampToValueAtTime(48, t + .38);
      g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + .42);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .45);
    } catch (e) {}
  }
  sweep() {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(280, t); o.frequency.exponentialRampToValueAtTime(920, t + .5);
      g.gain.setValueAtTime(.15, t); g.gain.exponentialRampToValueAtTime(.0001, t + .55);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + .6);
    } catch (e) {}
  }
  stamp() { this.thud(); this.tone(1250, .04, 'square', .12); }
}
