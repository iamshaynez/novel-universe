// g01 导读：渐进披露的纯视图模型与内容配置合同。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame, validateReadingConfig } from '../tools/compile-scenario.mjs';
import { createRun, stateOf } from '../engine/state.mjs';
import { trackModel, messageModel, evidenceModel, debtModel, mapModel, recapModel } from '../web/reading-aids.mjs';

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

  it('E2/E3 的当夜起点不得继承另一支结局的未来年份', () => {
    for (const id of ['E2', 'E3']) {
      const sceneId = ir.scenes[id];
      assert.equal(ir.nodes[sceneId].adate, '十一月八日', `${id} 起始日期`);
    }
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

  it('E1 留安全副本上交，E2 苏晚纸证烧毁，E3 全部纸证进入交易', () => {
    const base = { has_original: true, 'paper.drafts': true, 'paper.summary': true, 'paper.handbook': true, copy_locker: true };
    const e1 = evidenceModel(ir, state({ ...base, evidence_submitted: true }, { endingId: 'E1' }));
    assert.equal(e1.rows.find(r => r.id === 'original').holder, '已上交');
    assert.equal(e1.rows.find(r => r.id === 'handbook').holder, '已上交');
    assert.equal(e1.rows.find(r => r.id === 'copy').holder, '安全副本 · 场外');
    const e2 = evidenceModel(ir, state({ ...base, evidence_burned: true }, { endingId: 'E2' }));
    for (const id of ['original', 'drafts', 'summary', 'copy']) assert.equal(e2.rows.find(r => r.id === id).holder, '已烧毁');
    assert.equal(e2.rows.find(r => r.id === 'handbook').holder, '廖志坤带走');
    const e3 = evidenceModel(ir, state({ ...base, evidence_surrendered: true }, { endingId: 'E3' }));
    for (const id of ['original', 'drafts', 'summary', 'copy']) assert.equal(e3.rows.find(r => r.id === id).holder, '廖志坤');
    assert.equal(e3.rows.find(r => r.id === 'handbook').holder, '廖志坤卷走');
  });
});

describe('关系、地图与回读：辅助不能抢先剧透', () => {
  it('债务关系只在对应拍后开放', () => {
    assert.equal(debtModel(ir, state()).unlocked, false);
    const open = debtModel(ir, state({ 'aid.debt': true }));
    assert.equal(open.unlocked, true);
    assert.ok(open.rows.length >= 3);
  });

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
