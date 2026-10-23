// canon-lint 测试：剧透纪元（背景/说话者）、canon 版本范围。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs';
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
    assert.deepEqual(lintGame(join(root, 'games/g00-demo'), join(root, 'universe')), []);
  });
});

describe('canon-lint：越前引用被拦截', () => {
  it('事件披露于未来作品 → 报「越前引用」', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/timeline.json'), '"disclosed_in": "g00"', '"disclosed_in": "g03"');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'));
    assert.ok(issues.some(i => /越前引用/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('角色 first_appearance 在未来 → 说话者越前登场被拦（文字舞台：角色以台词登场）', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/characters/momo.json'), '"first_appearance": "g00"', '"first_appearance": "g02"');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'));
    assert.ok(issues.some(i => /越前登场/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('地点 first_appearance 在未来 → 越前引用被拦', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/locations/night-street.json'), '"first_appearance": "g00"', '"first_appearance": "g01"');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'));
    assert.ok(issues.some(i => /越前引用/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('canon 版本超出声明范围 → 报版本不满足', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/canon.json'), '"version": "0.2.0"', '"version": "1.0.0"');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'));
    assert.ok(issues.some(i => /canon 版本不满足/.test(i)), issues.join('; '));
    rmSync(dir, { recursive: true, force: true });
  });

  it('assumes 声明可解锁前作披露物（g01 假定玩过 g00 + 外传 gXX）', () => {
    const dir = cloneGameDir();
    rewrite(join(dir, 'universe/timeline.json'), '"disclosed_in": "g00"', '"disclosed_in": "gXX"');
    rewrite(join(dir, 'game/game.json'), '"code": "g00"', '"code": "g01"');
    rewrite(join(dir, 'game/game.json'), '"assumes": []', '"assumes": ["g00", "gXX"]');
    const issues = lintGame(join(dir, 'game'), join(dir, 'universe'));
    assert.deepEqual(issues, []);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('semver 区间', () => {
  it('satisfiesRange 基本行为', () => {
    assert.ok(satisfiesRange('0.2.0', '>=0.2 <1'));
    assert.ok(!satisfiesRange('1.2.0', '>=0.2 <1'));
    assert.ok(satisfiesRange('0.9.9', '>=0.2 <1'));
    assert.ok(satisfiesRange('2.0.0', '>=2'));
    assert.ok(!satisfiesRange('1.9.9', '>=2'));
  });
});
