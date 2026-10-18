// 分支图测试：结构校验 + 全路径枚举（结局全可达的静态保证）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';
import { validateGraph, enumerateRoutes } from '../engine/graph.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { ir } = compileGame(join(root, 'games/g00-demo'), join(root, 'universe'));

describe('图校验：g00', () => {
  it('结构零错误', () => assert.deepEqual(validateGraph(ir), []));

  it('5 条路径、3 个结局，全部健康（无死路断路）', () => {
    const routes = enumerateRoutes(ir);
    assert.equal(routes.length, 5, '问过过去后后巷两个选项都开放：letter2条 + past3条');
    const endings = routes.map(r => r.ending);
    assert.deepEqual([...new Set(endings)].sort(), ['END_MISS', 'END_TRUTH', 'END_WAIT']);
    for (const r of routes) assert.ok(!r.ending.startsWith('__'), `死路: ${r.ending}`);
  });

  it('END_TRUTH 仅在「问过去→后巷迎上去」路径出现（守卫生效）', () => {
    const truth = enumerateRoutes(ir).filter(r => r.ending === 'END_TRUTH');
    assert.equal(truth.length, 1);
    assert.equal(truth[0].choices.join(','), '1,1,0');
    assert.equal(truth[0].flags['fact.ev-rooftop-2019'], true);
  });
});

describe('图校验：破坏性变异能被抓到', () => {
  it('删掉真结局节点 → 出现断后继/孤儿错误', () => {
    const broken = JSON.parse(JSON.stringify(ir));
    const truthId = Object.keys(broken.nodes).find(id => broken.nodes[id].endingId === 'END_TRUTH');
    delete broken.nodes[truthId];
    const errs = validateGraph(broken);
    assert.ok(errs.length > 0, '应检出错误');
    assert.ok(errs.some(e => /不存在|孤儿/.test(e)), `错误应指向断链: ${errs.join('; ')}`);
  });

  it('伪造环 → 检出「检测到环」', () => {
    const cyc = JSON.parse(JSON.stringify(ir));
    const lastLine = Object.values(cyc.nodes).filter(n => n.type === 'line').at(-1);
    lastLine.next = cyc.entry;
    assert.ok(validateGraph(cyc).some(e => /环/.test(e)));
  });

  it('断头路（去掉选项目标）→ 结局不可达', () => {
    const bad = JSON.parse(JSON.stringify(ir));
    const waitId = Object.keys(bad.nodes).find(id => bad.nodes[id].endingId === 'END_WAIT');
    delete bad.nodes[waitId];
    const routes = enumerateRoutes(bad);
    assert.ok(routes.some(r => r.ending === '__GAP__' || r.ending === '__DEAD__'));
  });
});
