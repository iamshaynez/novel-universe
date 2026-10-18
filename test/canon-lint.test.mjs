// canon-lint 测试：剧透纪元、资产存在性、canon 版本范围。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintGame, satisfiesRange } from '../tools/canon-lint.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function cloneGameDir() {
  const dir = mkdtempSync(join(tmpdir(), 'nu-lint-'));
  cpSync(join(root, 'games/g00-demo'), join(dir, 'game'), { recursive: true });
  cpSync(join(root, 'universe'), join(dir, 'universe'), { recursive: true });
  return dir;
}
function rewrite(file, from, to) {
  writeFileSync(file, readFileSync(file, 'utf8').replace(from, to));
}

describe('canon-lint：g00 干净通过', () => {
  it('无任何 issue', () => {
    assert.deepEqual(lintGame(join(root, 'games/g00-demo'), join(root, 'universe'), join(root, 'assets')), []);
  });
});

describe('canon-lint：越前引用被拦截', () => {
  it('事件披露于未来作品 → 报「越前引用」', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/timeline.json'), '"disclosed_in": "g00"', '"disclosed_in": "g03"');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'), join(root, 'assets'));
    assert.ok(issues.some(i => /越前引用/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('角色 first_appearance 在未来 → 报「越前登场」', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/characters/momo.json'), '"first_appearance": "g00"', '"first_appearance": "g02"');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'), join(root, 'assets'));
    assert.ok(issues.some(i => /越前登场/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('canon 版本超出声明范围 → 报版本不满足', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/canon.json'), '"version": "0.1.0"', '"version": "1.0.0"');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'), join(root, 'assets'));
    assert.ok(issues.some(i => /canon 版本不满足/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('乐谱文件缺失 → 报资产不存在', () => {
    const dir = cloneGameDir();
    const emptyAssets = join(dir, 'assets');
    mkdirSync(join(emptyAssets, 'scores'), { recursive: true });
    mkdirSync(join(emptyAssets, 'scenes'), { recursive: true });
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'), emptyAssets);
    assert.ok(issues.some(i => /乐谱不存在/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('assumes 声明可解锁前作披露物（g01 假定玩过 g00 + 外传 gXX）', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/timeline.json'), '"disclosed_in": "g00"', '"disclosed_in": "gXX"');
    rewrite(join(dir, 'game/game.json'), '"code": "g00"', '"code": "g01"');
    rewrite(join(dir, 'game/game.json'), '"assumes": []', '"assumes": ["g00", "gXX"]');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'), join(root, 'assets'));
    assert.deepEqual(issues, []);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('semver 区间', () => {
  it('satisfiesRange 基本行为', () => {
    assert.ok(satisfiesRange('0.1.0', '>=0.1 <1'));
    assert.ok(!satisfiesRange('1.2.0', '>=0.1 <1'));
    assert.ok(satisfiesRange('0.9.9', '>=0.1 <1'));
    assert.ok(satisfiesRange('2.0.0', '>=2'));
    assert.ok(!satisfiesRange('1.9.9', '>=2'));
  });
});
