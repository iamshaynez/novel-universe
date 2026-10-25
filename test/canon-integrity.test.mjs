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
const charFiles = readdirSync(join(uni, 'characters')).filter(f => f.endsWith('.json'));
const chars = charFiles.map(f => read(join(uni, 'characters', f)));
const timeline = read(join(uni, 'timeline.json'));
const atlas = read(join(uni, 'atlas.json'));
const hearts = read(join(uni, 'hearts.json')).hearts;
const eventIds = new Set(timeline.events.map(e => e.id));
const locationIds = new Set(Object.keys(locations));

describe('正典完整性：心脏事件池（或然结局载体）', () => {
  it('三颗心脏在典：六千点（主）/ 非典之春 / 足球纪元（储备）', () => {
    assert.ok(hearts.length >= 3, `当前仅 ${hearts.length} 颗心脏`);
    assert.ok(hearts.some(h => h.status.includes('主心脏')), '缺主心脏');
  });

  it('每颗心脏：事件引用可解析、选择面至少两组、或然规则齐备', () => {
    for (const h of hearts) {
      assert.ok(h.name && h.status, `${h.id} 缺名称/状态`);
      assert.ok((h.events ?? []).length >= 1, `${h.id} 缺事件引用`);
      for (const r of h.events ?? []) {
        assert.ok(eventIds.has(r), `${h.id} 引用了不存在的事件 ${r}`);
      }
      assert.ok((h.choice_fields ?? []).length >= 2, `${h.id} 选择面至少两组`);
      assert.ok((h.or_rule ?? '').includes('不可改写'), `${h.id} 缺「历史不可改写」的或然规则`);
    }
  });
});

describe('正典完整性：人物档案（universe 原型 / cast 剧集双层）', () => {
  const universeChars = chars.filter(c => c.class === 'universe');
  const castChars = chars.filter(c => c.class !== 'universe');

  it('六位宇宙级原型人物在典（class: universe）', () => {
    assert.ok(universeChars.length >= 6, `当前仅 ${universeChars.length} 位宇宙级人物`);
  });

  it('全员基础档案：姓名/声线/站位/出道作/公开人设/出生年', () => {
    const seen = new Set();
    for (const c of chars) {
      assert.ok(!seen.has(c.id), `人物 id 重复: ${c.id}`);
      seen.add(c.id);
      assert.ok(c.name, `${c.id} 缺姓名`);
      assert.ok(typeof c.voice_hz === 'number' && c.voice_hz >= 80 && c.voice_hz <= 400, `${c.id} 声线非法`);
      assert.ok(['left', 'right'].includes(c.stage?.side), `${c.id} 站位非法`);
      assert.ok(c.first_appearance, `${c.id} 缺 first_appearance`);
      assert.ok(typeof c.bio_public === 'string' && c.bio_public.length > 10, `${c.id} 缺公开人设`);
      assert.ok(Number.isInteger(c.birth_year) && c.birth_year >= 1930 && c.birth_year <= 2010, `${c.id} 出生年非法`);
      for (const s of c.bio_secret ?? []) {
        assert.ok(s.revealed_in === null || typeof s.revealed_in === 'string',
          `${c.id} 秘密的 revealed_in 须为作品代码或 null`);
      }
    }
  });

  it('宇宙级原型：称呼/特征锚/年代阶段/永不主角/恰一条大秘密', () => {
    for (const c of universeChars) {
      assert.ok((c.aliases ?? []).length >= 1, `${c.id} 缺称呼别名`);
      assert.ok((c.persona_anchors ?? []).length >= 2, `${c.id} 特征锚至少两条`);
      assert.ok((c.stages ?? []).length >= 2, `${c.id} 年代阶段至少两段`);
      assert.ok(c.universe_role && /永不主角|永不.{0,4}主角/.test(c.universe_role), `${c.id} 宇宙定位须声明「永不主角」`);
      const bigs = (c.bio_secret ?? []).filter(s => s.big);
      assert.equal(bigs.length, 1, `${c.id} 应恰有一条大秘密（big:true）`);
    }
  });

  it('人物 timeline_hooks 都指向真实事件', () => {
    const bad = [];
    for (const c of chars)
      for (const r of c.timeline_hooks ?? []) if (!eventIds.has(r)) bad.push(`${c.id}→${r}`);
    assert.deepEqual(bad, []);
  });
});

describe('正典完整性：地点坐标', () => {
  it('每个地点都有 geo{lat,lng}，且落在成都市区框内', () => {
    for (const l of Object.values(locations)) {
      assert.ok(l.geo && typeof l.geo.lat === 'number' && typeof l.geo.lng === 'number',
        `${l.id} 缺 geo 坐标`);
      assert.ok(inChengdu(l.geo.lat, l.geo.lng), `${l.id} 坐标 ${l.geo.lat},${l.geo.lng} 不在成都框内`);
    }
  });
});

describe('正典完整性：背景卡片', () => {
  const CARD_FIELDS = ['facade', 'inside', 'objects', 'sounds', 'smells', 'light', 'people', 'era_props', 'hook'];
  it('每个地点都有完整背景卡片（复刻真实场景的感官素材）', () => {
    for (const l of Object.values(locations)) {
      assert.ok(l.card, `${l.id} 缺背景卡片 card`);
      for (const f of CARD_FIELDS) assert.ok(l.card[f], `${l.id} 卡片缺字段 ${f}`);
      for (const f of ['objects', 'sounds', 'smells']) {
        assert.ok(Array.isArray(l.card[f]) && l.card[f].length >= 2, `${l.id} 卡片 ${f} 至少两项`);
      }
      for (const ep of l.card.era_props) {
        assert.ok(ep.era && Array.isArray(ep.props) && ep.props.length >= 1,
          `${l.id} 卡片 era_props 条目不完整`);
      }
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

describe('正典完整性：时代词条（图鉴）', () => {
  it('词条 id 唯一、必备字段齐、纪元二选一（layer=public 或 disclosed_in）', () => {
    const lex = read(join(uni, 'lexicon.json'));
    const seen = new Set();
    for (const e of lex.entries) {
      assert.ok(!seen.has(e.id), `词条 id 重复: ${e.id}`);
      seen.add(e.id);
      assert.ok(!e.id.includes('.'), `词条 id 不得含点: ${e.id}（多段键保留给案卷解锁）`);
      for (const f of ['name', 'kicker', 'body']) assert.ok(typeof e[f] === 'string' && e[f].length >= 2, `词条 ${e.id} 缺 ${f}`);
      assert.ok(e.layer === 'public' || typeof e.disclosed_in === 'string', `词条 ${e.id} 须 layer=public 或 disclosed_in`);
      for (const a of e.aliases ?? []) assert.ok(a.length >= 2, `词条 ${e.id} 别名过短: ${a}`);
    }
  });
});
