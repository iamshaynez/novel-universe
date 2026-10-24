// canon-lint：剧透纪元（地点 / 说话者台词 / 事件）/ canon 版本范围校验。
import { compileGame, loadUniverse } from './compile-scenario.mjs';

function parseVer(v) {
  const p = String(v).split('.').map(Number);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0];
}
function cmpVer(a, b) {
  const [x, y] = [parseVer(a), parseVer(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
export function satisfiesRange(version, range) {
  return String(range).trim().split(/\s+/).every(tok => {
    const m = tok.match(/^(>=|<=|>|<)?([\d.]+)$/);
    if (!m) return false;
    const [, op, v] = m;
    const c = cmpVer(version, v);
    if (!op) return c === 0;
    if (op === '>=') return c >= 0;
    if (op === '<=') return c <= 0;
    if (op === '>') return c > 0;
    return c < 0;
  });
}

export function lintGame(gameDir, universeDir) {
  const { ir, manifest } = compileGame(gameDir, universeDir);
  const U = loadUniverse(universeDir);
  const issues = [];
  const allowed = new Set([...(manifest.assumes ?? []), manifest.code]);

  if (!satisfiesRange(U.canon.version, manifest.canon)) {
    issues.push(`canon 版本不满足: 需要 ${manifest.canon}，当前 ${U.canon.version}`);
  }

  const checkedSpeakers = new Set();
  for (const n of Object.values(ir.nodes)) {
    const v = n.aview ?? {};
    if (v.bg) {
      const loc = U.locations[v.bg.id];
      // 公共地点（真实城市锚点）免纪元；虚构地点须 first_appearance 解锁
      if (!loc) issues.push(`${n.id}: 未知地点 ${v.bg.id}`);
      else if (loc.layer !== 'public' && !allowed.has(loc.first_appearance)) issues.push(`${n.id}: 地点 ${v.bg.id} 披露于 ${loc.first_appearance}，越前引用（本作 ${manifest.code}，assumes=[${manifest.assumes}]）`);
    }
    if (n.type === 'line' && n.speaker && !checkedSpeakers.has(n.speaker)) {
      checkedSpeakers.add(n.speaker);
      const cid = U.aliasToChar[n.speaker];
      const c = cid && U.chars[cid];
      if (!c) issues.push(`${n.id}: 未知说话者 ${n.speaker}`);
      else if (!allowed.has(c.first_appearance)) issues.push(`${n.id}: 说话者 ${n.speaker} 披露于 ${c.first_appearance}，越前登场（本作 ${manifest.code}）`);
    }
    for (const op of n.enter ?? []) {
      if (op.op === 'flag' && op.name.startsWith('fact.')) {
        const ev = U.events[op.name.slice(5)];
        if (!ev) issues.push(`${n.id}: 正典事件不存在 ${op.name.slice(5)}`);
        // 公共背景事件（真实历史）是全宇宙公共知识，免剧透纪元；私有事件须 disclosed_in 解锁
        else if (ev.layer !== 'public' && !allowed.has(ev.disclosed_in)) issues.push(`${n.id}: 事件 ${ev.id} 披露于 ${ev.disclosed_in}，越前引用`);
      }
    }
  }
  return issues;
}
