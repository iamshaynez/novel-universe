#!/usr/bin/env node
// 离线渲染程序合成 BGM → WAV（零依赖，Node 原生）
// 与 style-tests/07-audio-demo.html 使用同一份乐谱参数；种子固定 → 输出确定性一致。
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SR = 44100;
const TAU = Math.PI * 2;

const mulberry32 = (a) => () => {
  a |= 0; a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

// ---------- 合成原语（全部在单个 Float32 缓冲上叠加） ----------
function musicbox(buf, t0, f, vol = 0.16, dur = 1.5) {
  const s0 = Math.round(t0 * SR);
  const parts = [[1, vol, dur], [2, vol * 0.35, dur * 0.5], [3, vol * 0.1, dur * 0.33]];
  for (const [m, v, dd] of parts) {
    const n = Math.min(buf.length, s0 + Math.round(dd * SR));
    for (let i = s0; i < n; i++) {
      const tt = (i - s0) / SR;
      buf[i] += Math.sin(TAU * f * m * tt) * v * Math.exp(-3 * tt / dd);
    }
  }
}

function padChord(buf, t0, dur, freqs) {
  for (const f of freqs) for (const det of [-7, 6]) {
    const ff = f * Math.pow(2, det / 1200);
    const s0 = Math.round(t0 * SR), n = Math.min(buf.length, s0 + Math.round(dur * SR));
    const cLP = 1 - Math.exp(-TAU * 850 / SR);
    let lp = 0, ph = 0;
    const A = dur * 0.45;
    for (let i = s0; i < n; i++) {
      const tt = (i - s0) / SR;
      ph = (ph + ff / SR) % 1;
      const saw = 2 * ph - 1;
      lp += cLP * (saw - lp);
      const env = tt < A ? 0.035 * (tt / A) : 0.035 * (1 - (tt - A) / (dur - A));
      buf[i] += lp * env;
    }
  }
}

function pluck(buf, t0, f, rng, vol = 0.12) {
  const s0 = Math.round(t0 * SR), n = Math.min(buf.length, s0 + Math.round(1.8 * SR));
  let lp = 0;
  for (let i = s0; i < n; i++) {
    const tt = (i - s0) / SR;
    const transient = (rng() * 2 - 1) * Math.exp(-tt / 0.012);
    lp += 0.25 * (transient - lp);
    const body = Math.sin(TAU * f * tt) * Math.exp(-tt / 0.6) * 0.7
               + Math.sin(TAU * f * 2 * tt) * Math.exp(-tt / 0.35) * 0.25
               + Math.sin(TAU * f * 3 * tt) * Math.exp(-tt / 0.22) * 0.12;
    buf[i] += (lp * 0.9 + body) * vol;
  }
}

function drone(buf, f, vol, dur) {
  const n = Math.min(buf.length, Math.round(dur * SR));
  const cLP = 1 - Math.exp(-TAU * 260 / SR);
  let lp = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ff = f * (1 + 0.002 * Math.sin(TAU * 0.1 * t));
    ph = (ph + ff / SR) % 1;
    const saw = 2 * ph - 1;
    lp += cLP * (saw - lp);
    buf[i] += lp * vol;
  }
}

function rainNoise(buf, dur, rng) {
  const n = Math.min(buf.length, Math.round(dur * SR));
  const cSlow = 1 - Math.exp(-TAU * 320 / SR);
  const cFast = 1 - Math.exp(-TAU * 3800 / SR);
  let slow = 0, fast = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const w = rng() * 2 - 1;
    slow += cSlow * (w - slow);
    fast += cFast * ((w - slow) - fast);
    buf[i] += slow * 0.05 + fast * 0.045 * (0.8 + 0.2 * Math.sin(TAU * 0.13 * t));
  }
}

function thunder(buf, t0, rng, vol = 0.3) {
  const s0 = Math.round(t0 * SR), n = Math.min(buf.length, s0 + Math.round(3.2 * SR));
  const cLP = 1 - Math.exp(-TAU * 170 / SR);
  let lp = 0;
  for (let i = s0; i < n; i++) {
    const tt = (i - s0) / SR;
    const w = rng() * 2 - 1;
    lp += cLP * (w - lp);
    const env = tt < 0.08 ? vol * (tt / 0.08) : vol * Math.exp(-(tt - 0.08) / 0.9);
    buf[i] += lp * env;
  }
}

function arpNote(buf, t0, f, vol = 0.05) {
  const s0 = Math.round(t0 * SR);
  for (let k = 0; k <= 3; k++) { // 干声 + 三次回声
    const g = vol * Math.pow(0.38, k);
    const st = s0 + Math.round(k * 0.225 * SR);
    const n = Math.min(buf.length, st + Math.round(0.16 * SR));
    const cLP = 1 - Math.exp(-TAU * 1400 / SR);
    let lp = 0, ph = 0;
    for (let i = st; i < n; i++) {
      const tt = (i - st) / SR;
      ph = (ph + f / SR) % 1;
      const sq = ph < 0.5 ? 1 : -1;
      lp += cLP * (sq - lp);
      buf[i] += lp * g * Math.exp(-tt / 0.05);
    }
  }
}

function bassPulse(buf, t0, vol = 0.16) {
  const s0 = Math.round(t0 * SR), n = Math.min(buf.length, s0 + Math.round(0.55 * SR));
  let ph = 0;
  for (let i = s0; i < n; i++) {
    const tt = (i - s0) / SR;
    const f = 82.41 * Math.exp(-tt * 0.9);
    ph += f / SR;
    buf[i] += Math.sin(TAU * ph) * vol * Math.exp(-tt / 0.22);
  }
}

// ---------- 三条曲目（与浏览器版同一乐谱参数） ----------
function renderRooftop() {
  const bpm = 76, beat = 60 / bpm, barDur = beat * 4;
  const dur = barDur * 6 + 2;
  const buf = new Float32Array(Math.ceil(dur * SR));
  const chords = [[220, 277.18, 329.63], [185, 220, 277.18], [146.83, 185, 220], [164.81, 207.65, 246.94]];
  const scale = [440, 493.88, 554.37, 659.25, 739.99, 880];
  const rng = mulberry32(7);
  for (let bar = 0; bar < 6; bar++) {
    const t0 = bar * barDur;
    padChord(buf, t0, barDur * 1.02, chords[bar % 4]);
    for (let i = 0; i < 8; i++) {
      if (rng() < 0.6) {
        const f = scale[(rng() * scale.length) | 0];
        musicbox(buf, t0 + i * beat / 2 + (rng() < 0.2 ? beat / 4 : 0), f);
      }
    }
  }
  return { buf, dur };
}

function renderRain() {
  const dur = 26;
  const buf = new Float32Array(Math.ceil(dur * SR));
  const rng = mulberry32(21);
  rainNoise(buf, dur, rng);
  drone(buf, 73.42, 0.05, dur);
  drone(buf, 110, 0.05, dur);
  const notes = [293.66, 329.63, 349.23, 440, 523.25];
  let t = 0.5;
  while (t < dur - 2.5) {
    if (rng() < 0.42) pluck(buf, t, notes[(rng() * notes.length) | 0], mulberry32((t * 1000) | 0));
    t += 1.4 + rng() * 1.8;
  }
  thunder(buf, 9.2, mulberry32(991));
  thunder(buf, 21.4, mulberry32(992));
  return { buf, dur };
}

function renderTerminal() {
  const dur = 20, step = 0.15;
  const buf = new Float32Array(Math.ceil(dur * SR));
  const arp = [164.81, 196, 246.94, 329.63, 293.66, 246.94, 196, 246.94];
  const rng = mulberry32(42);
  let n = 0;
  for (let t = 0.05; t < dur - 2; t += step) {
    const f = arp[n % arp.length] * (rng() < 0.12 ? 2 : 1);
    arpNote(buf, t, f);
    if (n % 16 === 0) bassPulse(buf, t);
    n++;
  }
  return { buf, dur };
}

// ---------- WAV 输出与统计 ----------
function writeWav(path, buf) {
  const n = buf.length;
  const data = Buffer.alloc(44 + n * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + n * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, Math.tanh(buf[i] * 1.1) * 0.85));
    data.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(path, data);
}

function stats(buf) {
  let peak = 0, sum = 0;
  for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a; sum += v * v; }
  const rms = Math.sqrt(sum / buf.length);
  return { peak, rmsDb: (20 * Math.log10(rms)).toFixed(1) };
}

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../style-tests/audio-preview');
mkdirSync(outDir, { recursive: true });
for (const [name, fn, file] of [
  ['黄昏天台', renderRooftop, '01-rooftop.wav'],
  ['雨夜街道', renderRain, '02-rain.wav'],
  ['终端与AI', renderTerminal, '04-terminal.wav'],
]) {
  const { buf, dur } = fn();
  writeWav(resolve(outDir, file), buf);
  const s = stats(buf);
  console.log(`${name.padEnd(4)} → ${file}  ${dur.toFixed(1)}s  peak=${s.peak.toFixed(2)}  RMS=${s.rmsDb} dBFS`);
}
