// 剧本 DSL → IR 编译器。纯函数式：同输入 → 同输出（可快照测试）。
// 语法见 docs/ADR/003-剧本DSL与IR合同.md
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function loadUniverse(universeDir) {
  const chars = {};
  for (const f of readdirSync(join(universeDir, 'characters')).filter(f => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(universeDir, 'characters', f), 'utf8'));
    chars[c.id] = c;
  }
  const aliasToChar = {};
  for (const c of Object.values(chars)) for (const a of [c.name, ...(c.aliases ?? [])]) aliasToChar[a] = c.id;

  const locations = {};
  for (const f of readdirSync(join(universeDir, 'locations')).filter(f => f.endsWith('.json'))) {
    const l = JSON.parse(readFileSync(join(universeDir, 'locations', f), 'utf8'));
    locations[l.id] = l;
  }
  const events = {};
  for (const ev of JSON.parse(readFileSync(join(universeDir, 'timeline.json'), 'utf8')).events) events[ev.id] = ev;
  const canon = JSON.parse(readFileSync(join(universeDir, 'canon.json'), 'utf8'));
  return { chars, aliasToChar, locations, events, canon };
}

function parseKV(toks) {
  const params = {};
  for (const t of toks) {
    const [k, v] = t.split('=');
    if (k && v !== undefined) params[k] = v;
  }
  return params;
}

function parseChapter(text, ch) {
  const nodes = {}, order = [], scenes = {}, endings = [];
  let pendingLabels = [], pendingView = {}, pendingEnter = [];
  let prevId = null, afterChoice = false, currentScene = null, ctr = 0;
  const nid = () => `${ch.id}-n${++ctr}`;

  const attach = node => {
    node.id = nid();
    node.chapter = ch.id;
    if (pendingLabels.length) {
      for (const l of pendingLabels) {
        if (scenes[l]) throw new Error(`${ch.id}: 场景标签重复: ${l}`);
        scenes[l] = node.id;
      }
      currentScene = pendingLabels[0];
      pendingLabels = [];
    }
    node.scene = currentScene;
    if (Object.keys(pendingView).length) node.view = { ...pendingView };
    if (pendingEnter.length) node.enter = [...pendingEnter];
    pendingView = {}; pendingEnter = [];
    if (prevId) nodes[prevId].next = node.id;
    nodes[node.id] = node;
    order.push(node.id);
    prevId = node.id;
    return node;
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    if (line.startsWith('# ')) {
      const label = line.slice(2).trim();
      if (!/^[A-Za-z0-9_-]+$/.test(label)) throw new Error(`${ch.id}: 非法场景标签 "${label}"`);
      pendingLabels.push(label);
      currentScene = label;
      prevId = null;          // 标签开根：切断线性链
      afterChoice = false;
      continue;
    }

    if (line.startsWith('* ')) {
      const m = line.match(/^\* (.+?)\s*->\s*([A-Za-z0-9_-]+)(?:\s+if\s+([A-Za-z0-9_.-]+))?$/);
      if (!m) throw new Error(`${ch.id}: 选项行语法错误: ${line}`);
      const [, label, target, when] = m;
      if (!prevId || nodes[prevId].type !== 'choice') attach({ type: 'choice', options: [] });
      nodes[prevId].options.push({ label, goto: target, ...(when ? { when } : {}) });
      afterChoice = true;
      continue;
    }

    if (afterChoice) throw new Error(`${ch.id}: 选项块之后必须以 "# 标签" 开新场景（当前行: ${line}）`);

    if (line.startsWith('@')) {
      const m = line.match(/^@(\w+)\s*(.*)$/);
      if (!m) throw new Error(`${ch.id}: 指令语法错误: ${line}`);
      const [, cmd, rest] = m;
      const toks = rest.trim().split(/\s+/).filter(Boolean);
      if (cmd === 'bg') {
        if (!toks[0]) throw new Error(`${ch.id}: @bg 缺少地点`);
        pendingView.bg = { id: toks[0], params: parseKV(toks.slice(1)) };
        if (!('show' in pendingView)) pendingView.show = null; // 换景即清场
      }
      else if (cmd === 'show') { if (!toks[0]) throw new Error(`${ch.id}: @show 缺少角色`); pendingView.show = { id: toks[0], expr: toks[1] ?? 'usual' }; }
      else if (cmd === 'hide') pendingView.show = null;
      else if (cmd === 'bgm') { if (!toks[0]) throw new Error(`${ch.id}: @bgm 缺少曲目`); pendingView.bgm = toks[0]; }
      else if (cmd === 'fact') { if (!toks[0]) throw new Error(`${ch.id}: @fact 缺少事件`); pendingEnter.push({ op: 'flag', name: `fact.${toks[0]}`, value: true }); }
      else throw new Error(`${ch.id}: 未知指令 @${cmd}`);
      continue;
    }

    if (line.startsWith('-> ')) {
      attach({ type: 'jump', goto: line.slice(3).trim() });
      continue;
    }

    if (line.startsWith('== ending')) {
      const m = line.match(/^== ending ([A-Za-z0-9_]+)\s*(.*)$/);
      if (!m) throw new Error(`${ch.id}: 结局行语法错误: ${line}`);
      attach({ type: 'ending', endingId: m[1], title: m[2] || m[1] });
      endings.push({ id: m[1], title: m[2] || m[1] });
      continue;
    }

    const sm = line.match(/^([^：「」『』（）()]{1,8})：(.+)$/);
    if (sm) attach({ type: 'line', speaker: sm[1], text: sm[2] });
    else attach({ type: 'line', speaker: null, text: line });
  }

  if (pendingLabels.length) throw new Error(`${ch.id}: 标签后没有内容: ${pendingLabels.join(', ')}`);
  const tailId = prevId && nodes[prevId].type === 'line' ? prevId : null;
  return { nodes, order, scenes, endings, entry: order[0] ?? null, tailId };
}

export function compileGame(gameDir, universeDir) {
  const manifest = JSON.parse(readFileSync(join(gameDir, 'game.json'), 'utf8'));
  const U = loadUniverse(universeDir);

  const results = manifest.chapters.map(ch =>
    parseChapter(readFileSync(join(gameDir, 'chapters', ch.file), 'utf8'), ch));

  // 全局标签表（查重）+ 目标解析
  const scenes = {};
  for (const r of results) for (const [label, id] of Object.entries(r.scenes)) {
    if (label in scenes) throw new Error(`场景标签重复: ${label}`);
    scenes[label] = id;
  }
  const resolveTarget = t => {
    if (!(t in scenes)) throw new Error(`跳转目标不存在: ${t}`);
    return scenes[t];
  };

  const nodes = {}, order = [], endings = [];
  results.forEach((r, i) => {
    Object.assign(nodes, r.nodes);
    order.push(...r.order);
    endings.push(...r.endings);
    if (r.tailId) nodes[r.tailId].next = results[i + 1]?.entry ?? null;
  });
  for (const id of order) {
    const n = nodes[id];
    if (n.type === 'choice') for (const o of n.options) o.goto = resolveTarget(o.goto);
    if (n.type === 'jump') n.goto = resolveTarget(n.goto);
  }

  // 视图绝对化：沿创作（阅读）顺序滚动合并；读档幂等重渲染
  let running = {};
  for (const id of order) {
    const n = nodes[id];
    if (n.view) running = { ...running, ...n.view };
    n.aview = { ...running };
  }

  // 说话者 / 角色登记
  const speakers = {}, characters = {};
  const regChar = cid => {
    const c = U.chars[cid];
    if (!c) throw new Error(`未知角色: ${cid}（不在 universe/characters 注册）`);
    if (!characters[cid]) characters[cid] = { id: c.id, name: c.name, voice_hz: c.voice_hz, chibi: c.chibi };
    return c;
  };
  for (const id of order) {
    const n = nodes[id];
    if (n.type === 'line' && n.speaker) {
      const cid = U.aliasToChar[n.speaker];
      if (!cid) throw new Error(`未知说话者: ${n.speaker}（不在 universe/characters 注册）`);
      const c = regChar(cid);
      speakers[n.speaker] = { char: c.id, voice_hz: c.voice_hz };
    }
    const show = n.aview?.show;
    if (show && show.id) regChar(show.id);
    const bg = n.aview?.bg;
    if (bg && !U.locations[bg.id]) throw new Error(`未知地点: ${bg.id}（不在 universe/locations 注册）`);
  }

  // 结局去重登记
  const endingMap = new Map(endings.map(e => [e.id, e]));

  const ir = {
    id: manifest.id, code: manifest.code, title: manifest.title,
    subtitle: manifest.subtitle ?? '',
    chapters: manifest.chapters.map(c => ({ id: c.id, title: c.title })),
    entry: results[0].entry,
    nodes, scenes,
    endings: [...endingMap.values()],
    speakers, characters,
    player: manifest.player ?? { name: '你', voice_hz: 185 },
  };
  return { ir, manifest };
}
