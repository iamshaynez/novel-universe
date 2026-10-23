// build-wiki：正典 → 设定集页面。确定性（两次构建逐字节相同）+ 内容覆盖 + 漂移守卫
//（已提交的 web/canon.html 必须等于当前正典的构建产物——正典变了不重新构建，这里变红）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWikiHtml } from '../tools/build-wiki.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('build-wiki：设定集页面', () => {
  const html = buildWikiHtml(join(root, 'universe'));

  it('确定性：同正典两次构建完全相同', () => {
    assert.equal(html, buildWikiHtml(join(root, 'universe')));
  });

  it('每个地点都有独立图案格：名称、印章、大字全部出现', () => {
    for (const f of readdirSync(join(root, 'universe/locations')).filter(f => f.endsWith('.json'))) {
      const l = JSON.parse(readFileSync(join(root, 'universe/locations', f), 'utf8'));
      assert.ok(html.includes(l.name), `缺少地点名 ${l.name}`);
      if (l.mood?.sign) assert.ok(html.includes(l.mood.sign), `${l.id} 缺印章`);
      if (l.mood?.bigchar) assert.ok(html.includes(l.mood.bigchar), `${l.id} 缩大字`);
      assert.ok(html.includes(l.address), `${l.id} 缺地址`);
    }
  });

  it('情感核心锚点带徽标，排在最前', () => {
    assert.ok(html.includes('情感核心'));
    assert.ok(html.indexOf('泡桐树小学') < html.indexOf('鹤鸣'), '泡小应排在普通锚点前');
    assert.ok(html.indexOf('石室中学') < html.indexOf('鹤鸣'), '石室应排在普通锚点前');
  });

  it('阶段丝带：六个叙事阶段与事件计数出现', () => {
    const tl = JSON.parse(readFileSync(join(root, 'universe/timeline.json'), 'utf8'));
    for (const p of tl.phases) assert.ok(html.includes(p.name), `缺阶段 ${p.name}`);
  });

  it('人物区：六位宇宙级隐藏人物（真名+称呼）全部出现，私有地点带徽标', () => {
    for (const [name, aka] of [['向启', '老向'], ['王磊', '街机'], ['蔡峰', '菜头'], ['崔涛', '师毛'], ['潇文', '望哥'], ['王波', '院长']]) {
      assert.ok(html.includes(name), `缺人物 ${name}`);
      assert.ok(html.includes(aka), `缺称呼 ${aka}`);
    }
    assert.ok(html.includes('永不主角'));
    assert.ok(html.includes('半夜面'), '缺私有据点 半夜面');
    assert.ok(html.includes('私有 · g01 出道'), '私有地点缺出道徽标');
  });

  it('心脏事件区：三颗心脏与或然规则出现', () => {
    for (const n of ['六千点', '非典之春', '足球纪元', '主心脏', '历史不可改写']) {
      assert.ok(html.includes(n), `设定集缺心脏要素 ${n}`);
    }
  });

  it('漂移守卫：已提交的 web/canon.html 与当前正典构建一致', () => {
    const committed = readFileSync(join(root, 'web/canon.html'), 'utf8');
    assert.equal(committed, html, 'canon.html 过期：请运行 npm run build:wiki 重新构建');
  });
});
