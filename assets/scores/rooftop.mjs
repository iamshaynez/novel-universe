// 乐谱：黄昏天台（暖 pad + 八音盒五声音阶，76 BPM，种子 7）。
// 接口合同：start(api) → { stop() }；api = { ctx, dest, wet, musicbox, padChord }。
const mulberry32 = a => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const BPM = 76;
const CHORDS = [[220, 277.18, 329.63], [185, 220, 277.18], [146.83, 185, 220], [164.81, 207.65, 246.94]];
const SCALE = [440, 493.88, 554.37, 659.25, 739.99, 880];

export function start(api) {
  const { ctx, dest, wet, musicbox, padChord } = api;
  const beat = 60 / BPM, barDur = beat * 4;
  const rng = mulberry32(7);
  let bar = 0, next = ctx.currentTime + 0.08;
  const timer = setInterval(() => {
    while (next < ctx.currentTime + 1.2) {
      padChord(CHORDS[bar % 4], next, barDur * 1.02, dest, wet);
      for (let i = 0; i < 8; i++) {
        if (rng() < 0.6) {
          const f = SCALE[(rng() * SCALE.length) | 0];
          musicbox(f, next + i * beat / 2 + (rng() < 0.2 ? beat / 4 : 0), dest, wet);
        }
      }
      next += barDur; bar++;
    }
  }, 250);
  return { stop: () => clearInterval(timer) };
}
