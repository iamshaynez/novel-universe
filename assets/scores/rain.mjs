// 乐谱：雨夜长街（雨声 + D 小调持续音 + 稀疏拨弦 + 闷雷，种子 21）。
const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const NOTES = [293.66, 329.63, 349.23, 440, 523.25];

export function start(api) {
  const { ctx, dest, wet, pluck, noiseSource } = api;
  const nodes = [];
  const mk = (type, freq, gainV, Q = 0.7) => {
    const src = noiseSource(2);
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = Q;
    const g = ctx.createGain(); g.gain.value = gainV;
    src.connect(f); f.connect(g); g.connect(dest); src.start();
    nodes.push(src); return g;
  };
  mk('bandpass', 2400, 0.045, 0.35);
  mk('lowpass', 320, 0.05);
  [73.42, 110].forEach(f => {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = ctx.createGain(); g.gain.value = 0.05;
    o.connect(lp); lp.connect(g); g.connect(dest); o.start();
    nodes.push(o);
  });
  const rng = mulberry32(21);
  let next = ctx.currentTime + 0.5, thunderAt = ctx.currentTime + 8 + rng() * 6;
  const thunder = (t) => {
    const src = noiseSource(3);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.2);
    src.connect(lp); lp.connect(g); g.connect(dest); g.connect(wet);
    src.start(t); src.stop(t + 3.4); nodes.push(src);
  };
  const timer = setInterval(() => {
    const now = ctx.currentTime;
    while (next < now + 1.5) {
      if (rng() < 0.42) pluck(NOTES[(rng() * NOTES.length) | 0], next, dest, wet, 0.1);
      next += 1.4 + rng() * 1.8;
    }
    if (now > thunderAt) { thunder(now + 0.05); thunderAt = now + 12 + rng() * 10; }
  }, 250);
  return {
    stop: () => {
      clearInterval(timer);
      nodes.forEach(n => { try { n.stop(); } catch { /* 已停止 */ } });
    },
  };
}
