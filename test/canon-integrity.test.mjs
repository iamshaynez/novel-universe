// 正典完整性：宇宙变大后的引用网守卫。
// 地理坐标存在且在成都框内；atlas/map 的地点引用可解析；refs 都指向真实事件；
// 时间轴 id 唯一、日期合法、阶段标记一致。数据层任何一条断链，这里变红。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uni = join(root, 'universe');
const read = p => JSON.parse(readFileSync(p, 'utf8'));

// 成都市区包围框（街区级坐标的合理域）
const CD = { latMin: 30.50, latMax: 30.80, lngMin: 103.90, lngMax: 104.25 };
const inChengdu = (lat, lng) =>
  lat >= CD.latMin && lat <= CD.latMax && lng >= CD.lngMin && lng <= CD.lngMax;

const locationFiles = readdirSync(join(uni, 'locations')).filter(f => f.endsWith('.json'));
const locations = Object.fromEntries(locationFiles.map(f => {
  const l = read(join(uni, 'locations', f));
  return [l.id, l];
}));
const orgFiles = readdirSync(join(uni, 'orgs')).filter(f => f.endsWith('.json'));
const orgs = orgFiles.map(f => read(join(uni, 'orgs', f)));
const timeline = read(join(uni, 'timeline.json'));
const atlas = read(join(uni, 'atlas.json'));
const eventIds = new Set(timeline.events.map(e => e.id));
const locationIds = new Set(Object.keys(locations));

describe('正典完整性：地点坐标', () => {
  it('每个地点都有 geo{lat,lng}，且落在成都市区框内', () => {
    for (const l of Object.values(locations)) {
      assert.ok(l.geo && typeof l.geo.lat === 'number' && typeof l.geo.lng === 'number',
        `${l.id} 缺 geo 坐标`);
      assert.ok(inChengdu(l.geo.lat, l.geo.lng), `${l.id} 坐标 ${l.geo.lat},${l.geo.lng} 不在成都框内`);
    }
  });
});

describe('正典完整性：引用网', () => {
  it('atlas 片区的 anchors 都能解析到已注册地点', () => {
    for (const d of atlas.districts) {
      for (const a of d.anchors) {
        assert.ok(locationIds.has(a), `${d.id} 的锚点 ${a} 未在 universe/locations 注册`);
      }
    }
  });

  it('地点/机构/atlas 的 refs 都指向真实事件', () => {
    const bad = [];
    for (const l of Object.values(locations))
      for (const r of l.refs ?? []) if (!eventIds.has(r)) bad.push(`${l.id}→${r}`);
    for (const o of orgs)
      for (const r of o.refs ?? []) if (!eventIds.has(r)) bad.push(`${o.id}→${r}`);
    for (const d of atlas.districts)
      for (const c of d.changes ?? [])
        for (const r of c.refs ?? []) if (!eventIds.has(r)) bad.push(`${d.id}变更→${r}`);
    for (const w of atlas.water)
      for (const r of w.refs ?? []) if (!eventIds.has(r)) bad.push(`${w.id}→${r}`);
    assert.deepEqual(bad, []);
  });

  it('map.json 快照的 diffs 都指向已注册地点，且快照阶段与时间轴阶段一一对应', () => {
    const map = read(join(uni, 'map.json'));
    const phases = new Set(timeline.phases.map(p => p.id));
    const snapPhases = map.snapshots.map(s => s.phase);
    for (const p of phases) assert.ok(snapPhases.includes(p), `map 缺少阶段 ${p} 的快照`);
    for (const s of map.snapshots) {
      assert.ok(phases.has(s.phase), `快照 ${s.era} 的 phase ${s.phase} 不在 timeline.phases`);
      for (const d of s.diffs ?? []) {
        assert.ok(locationIds.has(d.id), `快照 ${s.era} 的 ${d.id} 未在 universe/locations 注册`);
      }
    }
  });
});

describe('正典完整性：时间轴', () => {
  it('事件 id 唯一、日期合法、phase 注册', () => {
    const seen = new Set();
    const phases = new Set(timeline.phases.map(p => p.id));
    for (const e of timeline.events) {
      assert.ok(!seen.has(e.id), `事件 id 重复: ${e.id}`);
      seen.add(e.id);
      assert.match(e.date, /^\d{4}(-\d{2}(-\d{2})?)?$/, `${e.id} 日期格式非法: ${e.date}`);
      if (e.phase) assert.ok(phases.has(e.phase), `${e.id} 的 phase ${e.phase} 未注册`);
      if (e.window === 'prequel') assert.equal(e.phase, 'prequel', `${e.id} window=prequel 但 phase 不是 prequel`);
    }
  });
});
