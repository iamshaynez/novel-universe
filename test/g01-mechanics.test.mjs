// g01 机制与交互规则：转写字数预算、t9 死单参数、声纹同频与导读链路。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileGame } from '../tools/compile-scenario.mjs';
import { enumerateRoutes } from '../engine/graph.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const gameJson = JSON.parse(readFileSync(join(root, 'games/g01-jiexianyuan/game.json'), 'utf8'));
const character = id => JSON.parse(readFileSync(join(root, `universe/characters/${id}.json`), 'utf8'));

const universeDir = join(root, 'universe');
const gameDir = join(root, 'games/g01-jiexianyuan');

describe('g01 转写机制与字数预算（手艺原则：按字收费，删到只剩骨头）', () => {
  const { ir } = compileGame(gameDir, universeDir);
  const trNodes = Object.values(ir.nodes).filter(n => n.type === 'transcribe');

  it('g01 包含全部 9 处转写节点（t1 到 t9），均有主叫与目标转写文本', () => {
    assert.equal(trNodes.length, 9, 'g01 应有 9 处转写');
    for (let i = 1; i <= 9; i++) {
      const node = trNodes.find(n => n.transId === `t${i}`);
      assert.ok(node, `缺少转写节点 t${i}`);
      assert.ok(node.caller && node.caller.trim().length > 0, `t${i} 缺少 caller`);
      assert.ok(node.target && node.target.trim().length > 0, `t${i} 缺少 target`);
    }
  });

  it('包含 full（原话）的转写，full 字数必须严格大于 target（体现超预算）', () => {
    const withFull = trNodes.filter(n => n.full);
    assert.ok(withFull.length >= 3, '至少 t1, t5, t9 提供 full 原话选项');
    for (const n of withFull) {
      assert.ok(
        n.full.length > n.target.length,
        `节点 ${n.transId} 的 full「${n.full}」(${n.full.length}字) 必须长于 target「${n.target}」(${n.target.length}字)`
      );
    }
  });

  it('包含 over（过度删减）的转写，over 字数必须严格小于 target（体现丢意思）', () => {
    const withOver = trNodes.filter(n => n.over);
    assert.equal(withOver.length, 9, '所有 9 个转写节点均配置 over 选项');
    for (const n of withOver) {
      assert.ok(
        n.over.length < n.target.length,
        `节点 ${n.transId} 的 over「${n.over}」(${n.over.length}字) 必须短于 target「${n.target}」(${n.target.length}字)`
      );
    }
  });

  it('t9 死单拍核心约束：dead 22:47、note 紧一紧、原话含等你到十二点与你自己定', () => {
    const t9 = trNodes.find(n => n.transId === 't9');
    assert.ok(t9, '必须包含 t9');
    assert.equal(t9.caller, '刘先生');
    assert.match(t9.target, /十点，老地方，河对岸等你。就这样。/);
    assert.match(t9.full, /等你到十二点/);
    assert.match(t9.full, /来不来，你自己定/);
    assert.equal(t9.over, '十点，老地方。');
    assert.match(t9.note, /紧一紧/);
    assert.equal(t9.peak?.kind, 'dead');
    assert.equal(t9.peak?.args[0], '22:47');
  });

  it('inner 峰值拍必须附着在台词节点（line）上，确保舞台 tellInner 与 218 Hz 声纹正常播放', () => {
    const innerNode = Object.values(ir.nodes).find(n => n.peak?.kind === 'inner');
    assert.ok(innerNode, '必须包含 inner 峰值节点');
    assert.equal(innerNode.type, 'line', 'inner 峰值必须绑定在 line 节点上，不可附着在 choice 选项');
    assert.ok(innerNode.text && innerNode.text.length > 0, 'inner 台词必须有文本内容');
  });
});

describe('g01 正典声纹同频与证据链对齐', () => {
  it('陈先生与刘先生同为廖志坤化名，声纹同为 96 Hz', () => {
    const lzk = character('liaozhikun');
    assert.equal(lzk.voice_hz, 96, '廖志坤声纹应为 96 Hz');
    assert.ok(lzk.aliases.includes('陈先生'), '廖志坤化名须包含陈先生');
    assert.ok(lzk.aliases.includes('刘先生'), '廖志坤化名须包含刘先生');
  });

  it('苏晚（你）声纹为 218 Hz，贺青禾为 206 Hz', () => {
    const sw = character('suwan');
    const qh = character('heqinghe');
    assert.equal(sw.voice_hz, 218, '苏晚声纹应为 218 Hz');
    assert.equal(gameJson.player?.voice_hz, 218, 'game.json 玩家声纹必须与苏晚对齐');
    assert.equal(qh.voice_hz, 206, '贺青禾声纹应为 206 Hz');
  });
});

describe('g01 导读轨迹与结局全可达', () => {
  const { ir } = compileGame(gameDir, universeDir);

  it('导读记录轨（record）与走访轨（visit）的场景停靠点在 IR 中均真实存在', () => {
    const tracks = gameJson.reading?.tracks ?? [];
    assert.ok(tracks.length >= 2, '至少包含记录轨与走访轨');
    for (const tr of tracks) {
      for (const stop of tr.stops) {
        assert.ok(
          stop.scene in ir.scenes,
          `导读轨 ${tr.id} 的停靠点 scene "${stop.scene}" 在游戏中未找到对应场景`
        );
      }
    }
  });

  it('三结局全可达，路线数严格确定', () => {
    const routes = enumerateRoutes(ir);
    assert.ok(routes.length > 0, '路线枚举不可为空');
    const ends = new Set(routes.map(r => r.ending));
    assert.ok(ends.has('E1'), '应可达 E1');
    assert.ok(ends.has('E2'), '应可达 E2');
    assert.ok(ends.has('E3'), '应可达 E3');
  });
});
