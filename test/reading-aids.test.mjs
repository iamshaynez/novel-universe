// g01 导读：渐进披露的纯视图模型与内容配置合同。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame, validateReadingConfig } from '../tools/compile-scenario.mjs';
import { createRun, stateOf } from '../engine/state.mjs';
import { trackModel, currentTrackInfo, messageModel, evidenceModel, relationsModel, mapModel, recapModel } from '../web/reading-aids.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { ir } = compileGame(join(root, 'games/g01-jiexianyuan'), join(root, 'universe'));
const state = (flags = {}, extra = {}) => ({ flags, ...extra });

describe('导读配置：内容引用与当前场景', () => {
  it('g01 的 reading 引用全部有效，未配置游戏保持空配置', () => {
    assert.ok(ir.reading);
    assert.ok(Array.isArray(ir.reading.tracks));
    assert.ok(ir.reading.messages.t9);
    assert.ok(ir.reading.evidence.length >= 5);
    const g00 = compileGame(join(root, 'test/fixtures/games/g00-demo'), join(root, 'test/fixtures/universe')).ir;
    assert.equal(g00.reading, null);
  });

  it('无效场景引用会被编译校验明确拒绝', () => {
    const bad = structuredClone(ir.reading);
    bad.tracks[0].stops[0].scene = 'not-a-scene';
    assert.throws(() => validateReadingConfig(bad, {
      scenes: ir.scenes,
      nodes: ir.nodes,
      flags: new Set(['has_original', 'paper.drafts', 'paper.summary', 'paper.handbook', 'aid.debt', 'copy_locker', 'copy_dj', 'no_copy']),
      endings: ir.endings,
      locations: Object.fromEntries(ir.canon.locations.map(l => [l.id, l])),
    }), /reading.*场景|reading.*scene/);
  });

  it('E2/E3 的起点日期各归各的夜晚，不得继承另一支结局的未来年份', () => {
    assert.equal(ir.nodes[ir.scenes.E2].adate, '十一月九日 · 凌晨四点', 'E2 起始日期');
    assert.equal(ir.nodes[ir.scenes.E3].adate, '十一月八日', 'E3 起始日期');
  });

  it('stateOf 暴露当前 node，导读不靠正文反推场景', () => {
    const run = createRun(ir, 7);
    assert.equal(stateOf(ir, run).node, ir.entry);
  });
});

describe('轨迹与留言：只展开已经读到的信息', () => {
  it('记录、走访与终章汇流各自高亮，未到节点不展开', () => {
    const r2 = trackModel(ir, state({}, { node: 'chR2', chapter: 'ch2' }));
    assert.equal(r2.current, 'record');
    assert.equal(r2.converged, false);
    assert.ok(r2.tracks.find(t => t.id === 'record').stops.some(s => s.scene === 'chR2'));
    assert.ok(!r2.tracks.find(t => t.id === 'record').stops.some(s => s.scene === 'chR3'));
    assert.ok(r2.tracks.find(t => t.id === 'visit').stops.some(s => s.scene === 'chA1'));
    const final = trackModel(ir, state({}, { node: 'chF', chapter: 'ch5' }));
    assert.equal(final.converged, true);
  });

  it('currentTrackInfo 精确解析场景对应的双轨与汇流元数据', () => {
    const s0 = currentTrackInfo(ir, state({}, { node: 'ch0-open', chapter: 'ch1' }));
    assert.equal(s0.id, 'record');
    assert.equal(s0.symbol, '耳');
    assert.equal(s0.name, '记录');

    const sa1 = currentTrackInfo(ir, state({}, { node: 'chA1', chapter: 'ch2' }));
    assert.equal(sa1.id, 'visit');
    assert.equal(sa1.symbol, '街');
    assert.equal(sa1.name, '走访');

    const sa1Sub = currentTrackInfo(ir, state({}, { node: 'chA1-archive', chapter: 'ch2' }));
    assert.equal(sa1Sub.id, 'visit');

    const sr2 = currentTrackInfo(ir, state({}, { node: 'chR2', chapter: 'ch2' }));
    assert.equal(sr2.id, 'record');
    assert.equal(sr2.symbol, '耳');

    const sf = currentTrackInfo(ir, state({}, { node: 'chF', chapter: 'ch5' }));
    assert.equal(sf.id, 'convergence');
    assert.equal(sf.symbol, '合');
    assert.equal(sf.converged, true);
  });

  it('未转写不出现；t9 同时显示约定十点与真实 22:47', () => {
    const early = messageModel(ir, state({ 'tr.t3': true, 'tr.t4': true, 'tr.t7': true }));
    assert.equal(early.rows.length, 3);
    assert.ok(!early.rows.some(r => r.tid === 't9'));
    const late = messageModel(ir, state({ 'tr.t3': true, 'tr.t4': true, 'tr.t7': true, 'tr.t9': true }));
    const t9 = late.rows.find(r => r.tid === 't9');
    assert.equal(t9.appointment, '22:00');
    assert.equal(t9.time, '22:47');
    assert.equal(t9.late, true);
    assert.equal(t9.number, '901-7544');
  });
});

describe('证据实物桌：持有人和结局去向必须随真实分支变化', () => {
  it('原件及三晚底稿、汇总纸、手抄本按信息拍逐步解锁', () => {
    const early = evidenceModel(ir, state({ has_original: true }));
    assert.equal(early.rows.length, 1);
    assert.equal(early.rows[0].id, 'original');
    assert.equal(early.rows[0].holder, '苏晚 · 贴身');
    const full = evidenceModel(ir, state({ has_original: true, 'paper.drafts': true, 'paper.summary': true, 'paper.handbook': true, copy_locker: true }));
    assert.equal(full.rows.length, 5);
    assert.equal(full.rows.find(r => r.id === 'handbook').holder, '廖志坤');
    assert.equal(full.rows.find(r => r.id === 'copy').holder, '更衣柜');
  });

  it('R3 锁柜与 R4 贴身是原件的两个阶段，不能混写', () => {
    const r3 = evidenceModel(ir, state({ has_original: true, original_locker: true }));
    assert.equal(r3.rows.find(r => r.id === 'original').holder, '更衣柜');
    const r4 = evidenceModel(ir, state({ has_original: true, original_locker: true, original_carry: true, copy_locker: true }));
    assert.equal(r4.rows.find(r => r.id === 'original').holder, '苏晚 · 贴身');
  });

  it('杜鹃副本与无副本不是同一种展示', () => {
    const dj = evidenceModel(ir, state({ has_original: true, 'paper.drafts': true, 'paper.summary': true, 'paper.handbook': true, copy_dj: true }));
    assert.equal(dj.rows.find(r => r.id === 'copy').holder, '杜鹃饭盒');
    const none = evidenceModel(ir, state({ has_original: true, 'paper.drafts': true, 'paper.summary': true, 'paper.handbook': true, no_copy: true }));
    const copy = none.rows.find(r => r.id === 'copy');
    assert.equal(copy.empty, true);
    assert.equal(copy.holder, '未留复印件');
  });

  it('E1 留安全副本上交，E2 纸证交贺国栋，E3 苏晚收存底单、廖带手抄本去桥头', () => {
    const base = { has_original: true, 'paper.drafts': true, 'paper.summary': true, 'paper.handbook': true, copy_locker: true };
    const e1 = evidenceModel(ir, state({ ...base, evidence_submitted: true }, { endingId: 'E1' }));
    assert.equal(e1.rows.find(r => r.id === 'original').holder, '已上交');
    assert.equal(e1.rows.find(r => r.id === 'handbook').holder, '已上交');
    assert.equal(e1.rows.find(r => r.id === 'copy').holder, '安全副本 · 场外');
    const e2 = evidenceModel(ir, state({ ...base, evidence_to_father: true }, { endingId: 'E2' }));
    for (const id of ['original', 'drafts', 'summary', 'handbook']) assert.equal(e2.rows.find(r => r.id === id).holder, '贺国栋收存');
    assert.equal(e2.rows.find(r => r.id === 'copy').holder, '随原件 · 贺国栋');
    const e3 = evidenceModel(ir, state({ ...base, lzk_to_bridge: true }, { endingId: 'E3' }));
    for (const id of ['original', 'drafts', 'summary', 'copy']) assert.equal(e3.rows.find(r => r.id === id).holder, '苏晚收存');
    assert.equal(e3.rows.find(r => r.id === 'handbook').holder, '廖志坤 · 带去桥头');
  });
});

describe('关系网：中段锚点与揭晓纪律', () => {
  const FLAGS = ['tr.t1', 'tr.t2', 'tr.t3', 'tr.t4', 'tr.t7', 'tr.t9',
    'card.char.dujuan', 'card.char.qinjie', 'card.char.laojin', 'card.char.laopeng',
    'card.char.heguodong', 'card.char.suwan', 'card.char.liaozhikun',
    'card.qh.note', 'card.qh.rainboots', 'paper.drafts', 'paper.summary', 'paper.handbook',
    'aid.debt', 'card.lzk.name', 'card.lzk.oneman',
    'has_original', 'original_locker', 'original_carry', 'copy_locker', 'copy_dj', 'no_copy'];
  const validate = reading => validateReadingConfig(reading, {
    scenes: ir.scenes,
    nodes: ir.nodes,
    flags: new Set(FLAGS),
    endings: ir.endings,
    locations: Object.fromEntries(ir.canon.locations.map(l => [l.id, l])),
  });
  const ids = model => ({ nodes: model.nodes.map(n => n.id), edges: model.edges.map(e => `${e.from}>${e.to}`) });

  it('关系数据编译合法；边引用未知节点与悬空 flag 都会被拒绝', () => {
    assert.ok(ir.reading.relations.nodes.length >= 10);
    assert.ok(validateReadingConfig(ir.reading, {
      scenes: ir.scenes, nodes: ir.nodes, flags: new Set(FLAGS), endings: ir.endings,
      locations: Object.fromEntries(ir.canon.locations.map(l => [l.id, l])),
    }));
    const danglingNode = structuredClone(ir.reading);
    danglingNode.relations.edges[0].to = 'not-a-node';
    assert.throws(() => validate(danglingNode), /未知节点/);
    const danglingFlag = structuredClone(ir.reading);
    danglingFlag.relations.nodes[0].unlock = 'never.set';
    assert.throws(() => validate(danglingFlag), /未在本作置位/);
    const danglingReveal = structuredClone(ir.reading);
    danglingReveal.relations.nodes.find(n => n.id === 'lzk').reveal = 'never.set';
    assert.throws(() => validate(danglingReveal), /未在本作置位/);
  });

  it('传呼台与河音两簇随第一章落图；苏晚在揭名前只是「夜班接线员」', () => {
    assert.equal(relationsModel(ir, state()).nodes.length, 0);
    const ch1 = ids(relationsModel(ir, state({ 'card.char.dujuan': true, 'tr.t1': true, 'tr.t2': true })));
    assert.deepEqual(new Set(ch1.nodes), new Set(['dujuan', 'chuantai', 'suwan', 'heqinghe', 'heyin', 'xiaoke']));
    assert.deepEqual(new Set(ch1.edges), new Set(['suwan>chuantai', 'dujuan>chuantai', 'heqinghe>chuantai', 'heqinghe>heyin', 'xiaoke>heyin']));
    const labels = relationsModel(ir, state({ 'card.char.dujuan': true, 'tr.t1': true })).nodes.map(n => n.label);
    assert.ok(labels.includes('夜班接线员'));
    assert.ok(!labels.includes('苏晚'));
  });

  it('走访中段不泄底：两张号牌并案前，图上没有「他」，也没有债', () => {
    const mid = relationsModel(ir, state({
      'card.char.dujuan': true, 'card.char.laojin': true, 'card.char.qinjie': true,
      'card.char.heguodong': true, 'card.char.laopeng': true, 'card.qh.note': true,
      'tr.t1': true, 'tr.t2': true, 'tr.t3': true, 'tr.t4': true, 'tr.t7': true, 'tr.t9': true,
    }));
    const seen = JSON.stringify(mid);
    assert.ok(!seen.includes('lzk') && !seen.includes('他'));
    assert.ok(!seen.includes('一人两张号牌') && !seen.includes('借条') && !seen.includes('廖志坤'));
    assert.ok(mid.nodes.some(n => n.id === 'heguodong'));
    assert.ok(mid.edges.some(e => e.label === '父女'));
  });

  it('paper.summary 那一拍两张号牌并成一个人：先遮罩为「他」，揭名后才见廖志坤', () => {
    const fused = relationsModel(ir, state({ 'paper.summary': true, 'tr.t2': true }));
    const lzk = fused.nodes.find(n => n.id === 'lzk');
    assert.equal(lzk.label, '他');
    assert.equal(lzk.masked, true);
    assert.ok(fused.edges.some(e => e.label === '一人两张号牌 · 呼她的机'));
    const named = relationsModel(ir, state({ 'paper.summary': true, 'tr.t2': true, 'card.lzk.name': true }));
    assert.equal(named.nodes.find(n => n.id === 'lzk').label, '廖志坤');
    assert.equal(named.nodes.find(n => n.id === 'lzk').masked, false);
  });

  it('债务三边只在 aid.debt 后并入：签借条、签担保、折价接账', () => {
    const before = relationsModel(ir, state({ 'paper.summary': true, 'card.lzk.name': true, 'tr.t2': true, 'card.qh.note': true, 'card.char.heguodong': true }));
    assert.ok(!before.nodes.some(n => n.id === 'debt'));
    const debt = relationsModel(ir, state({
      'paper.summary': true, 'card.lzk.name': true, 'tr.t2': true, 'card.qh.note': true,
      'card.char.heguodong': true, 'aid.debt': true,
    }));
    assert.ok(debt.nodes.some(n => n.id === 'debt'));
    assert.deepEqual(debt.edges.filter(e => e.to === 'debt').map(e => e.label), ['签借条', '签担保', '折价接账 · 全额收']);
  });

  it('回读真相图全解锁并补两条真相边；真相边永不进局中图谱', () => {
    const allRead = {
      'card.char.dujuan': true, 'tr.t1': true, 'tr.t2': true, 'paper.summary': true,
      'card.lzk.name': true, 'aid.debt': true, 'card.char.heguodong': true, 'card.qh.note': true,
      'card.char.laopeng': true, 'card.char.laojin': true, 'card.char.qinjie': true, 'card.char.suwan': true,
    };
    const inPlay = relationsModel(ir, state(allRead));
    assert.ok(!inPlay.edges.some(e => e.truth));
    const full = relationsModel(ir, state(allRead), { full: true });
    assert.equal(full.nodes.length, ir.reading.relations.nodes.length);
    assert.ok(full.edges.some(e => e.truth && e.label === '她删掉了「来不来，你自己定」'));
    assert.ok(full.edges.some(e => e.truth && e.label === '他在岸边，会水，没有伸手'));
    const suwan = full.nodes.find(n => n.id === 'suwan');
    assert.equal(suwan.label, '苏晚');
    assert.equal(suwan.masked, false);
  });
});

describe('地图与回读：辅助不能抢先剧透', () => {
  it('地点示意图随剧情进度出现，并高亮当前位置', () => {
    const start = mapModel(ir, state({}, { node: 'ch0-open', view: { bg: { id: 'chuantai', params: { time: 'night' } } } }));
    assert.deepEqual(start.nodes.map(n => n.id), ['chuantai']);
    assert.equal(start.current, 'chuantai');
    const river = mapModel(ir, state({}, { node: 'chA2d', view: { bg: { id: 'funanhe-bank', params: { time: 'night' } } } }));
    assert.deepEqual(new Set(river.nodes.map(n => n.id)), new Set(['chuantai', 'heyin', 'funanhe-bank']));
    assert.equal(river.current, 'funanhe-bank');
  });

  it('首支结局前回读锁定，完成后开放三支并高亮当前支', () => {
    assert.equal(recapModel(ir, state()).unlocked, false);
    const done = recapModel(ir, state({}, { kind: 'ending', endingId: 'E2' }));
    assert.equal(done.unlocked, true);
    assert.equal(done.rows.length, 3);
    assert.equal(done.current, 'E2');
  });
});
