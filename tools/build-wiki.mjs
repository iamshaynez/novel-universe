// build-wiki：universe 正典 → docs/canon.html 创作内部设定集（静态、零依赖、确定性构建）。
// 地点图案 = 文字舞台演出词汇（ADR-004）：氛围层调色板 + 印章 + 大字 + 雨意。
// 运行：npm run build:wiki（产物提交入库；漂移守卫见 test/build-wiki.test.mjs）。
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 情感核心锚点（宪法 §4），排在设定集最前
const EMOTION_CORE = ['paotongshu-primary', 'shishi-middle'];

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uniDirChars = d => join(d, 'characters');

export function buildWikiHtml(universeDir) {
  const tokens = JSON.parse(readFileSync(join(universeDir, 'tokens.json'), 'utf8')).stage;
  const canon = JSON.parse(readFileSync(join(universeDir, 'canon.json'), 'utf8'));
  const timeline = JSON.parse(readFileSync(join(universeDir, 'timeline.json'), 'utf8'));

  const locations = readdirSync(join(universeDir, 'locations'))
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(universeDir, 'locations', f), 'utf8')));
  const byEmotion = l => (EMOTION_CORE.includes(l.id) ? 0 : l.layer === 'public' ? 1 : 2);
  locations.sort((a, b) => byEmotion(a) - byEmotion(b) || a.id.localeCompare(b.id));

  const chars = readdirSync(join(uniDirChars(universeDir)))
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(universeDir, 'characters', f), 'utf8')));
  chars.sort((a, b) => a.id.localeCompare(b.id));

  const phaseCount = new Map(timeline.phases.map(p => [p.id, 0]));
  for (const e of timeline.events) if (phaseCount.has(e.phase)) phaseCount.set(e.phase, phaseCount.get(e.phase) + 1);

  const css = `
  :root{--bg:${tokens.bg};--ink:${tokens.ink};--dim:${tokens.ink_dim};--paper:${tokens.paper};--p-ink:${tokens.paper_ink};--accent:${tokens.accent};--cold:${tokens.accent_cold};--blood:${tokens.blood};
    --kai:"Kaiti SC","STKaiti","KaiTi","Songti SC","Noto Serif SC",serif}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:"Songti SC","Noto Serif SC",serif;line-height:1.75}
  body::before{content:"";position:fixed;inset:0;z-index:99;pointer-events:none;opacity:.06;mix-blend-mode:soft-light;
    background:repeating-linear-gradient(93deg,transparent 0 3px,#fff 3px 4px,transparent 4px 11px),repeating-linear-gradient(2deg,#000 0 1px,transparent 1px 5px)}
  .wrap{max-width:980px;margin:0 auto;padding:28px 20px 60px}
  header{position:relative;padding:22px 26px;border:1px solid #a8946a;box-shadow:inset 0 0 0 4px rgba(23,19,13,.1);
    background:linear-gradient(150deg,#e9dcbd,#ddd0a9);color:#2e2818}
  header::before{content:"档";position:absolute;top:16px;right:18px;display:flex;align-items:center;justify-content:center;
    width:44px;height:58px;border:2px solid var(--blood);border-radius:4px;color:var(--blood);
    font:26px var(--kai);transform:rotate(-6deg);opacity:.85;box-shadow:inset 0 0 0 1px rgba(158,58,43,.3)}
  header h1{margin:0;font-size:26px;letter-spacing:8px;font-family:var(--kai)}
  header .sub{color:#7c704f;font-size:13px;margin:8px 0 0}
  .phases{display:flex;gap:6px;flex-wrap:wrap;margin:20px 0 26px}
  .phases span{flex:1;min-width:120px;text-align:center;font-size:12px;padding:7px 4px;border:1px solid #6d5d3b;color:var(--dim)}
  .phases b{color:var(--ink);font-weight:400}
  .loc{border:1px solid #a8946a;margin-bottom:28px;background:linear-gradient(150deg,#e9dcbd,#ddd0a9);
    box-shadow:inset 0 0 0 4px rgba(23,19,13,.1),0 10px 30px rgba(0,0,0,.35);overflow:hidden;color:#2e2818}
  .stage{position:relative;height:150px;background:linear-gradient(155deg,var(--p0) 0%,var(--p1) 55%,var(--p2) 135%);
    border-bottom:1px solid #a8946a}
  .bigchar{position:absolute;left:12px;bottom:-16px;font-size:92px;line-height:1;font-weight:900;font-family:var(--kai);color:var(--p2);opacity:.9;text-shadow:0 2px 18px rgba(0,0,0,.45)}
  .seal{position:absolute;top:10px;right:10px;writing-mode:vertical-rl;background:var(--blood);color:#e9dcbd;font-size:13px;letter-spacing:3px;padding:8px 4px;border-radius:2px;box-shadow:0 1px 6px rgba(0,0,0,.5)}
  .rain{position:absolute;inset:0;background-image:repeating-linear-gradient(75deg,rgba(232,220,189,.14) 0 1px,transparent 1px 13px)}
  .rain::after{content:"雨";position:absolute;top:8px;left:10px;font-size:12px;color:rgba(233,220,189,.75);letter-spacing:2px}
  .badge{position:absolute;top:10px;left:10px;background:var(--bg);color:var(--accent);font-size:12px;padding:2px 10px;letter-spacing:2px;border:1px solid #6d5d3b}
  .badge.private{background:var(--bg);color:var(--dim);top:44px}
  .char{border:1px solid #a8946a;border-left:4px solid var(--c);margin-bottom:22px;padding:14px 16px;
    background:linear-gradient(150deg,#e9dcbd,#ddd0a9);box-shadow:inset 0 0 0 4px rgba(23,19,13,.1);color:#2e2818}
  .char h3{margin:0 0 2px;font-size:19px;letter-spacing:2px;font-family:var(--kai)}
  .char .aka{color:#7c704f;font-size:13px}
  .char .role{font-size:13px;color:var(--blood);margin:6px 0 2px;letter-spacing:1px}
  .char .anchors{margin:8px 0}
  .char .anchors span{display:inline-block;border:1px solid #a8946a;color:#4a4232;font-size:12px;padding:1px 9px;margin:0 4px 6px 0;background:rgba(255,252,242,.4)}
  .char dl{display:grid;grid-template-columns:88px 1fr;gap:7px 10px;margin:8px 0}
  .char .secret{color:var(--blood);font-size:13px}
  .char .stages{color:#6e6549;font-size:13px}
  .char .stages b{color:#2e2818;font-weight:400}
  h2.sec{display:flex;align-items:center;gap:14px;font-size:21px;letter-spacing:6px;font-family:var(--kai);color:var(--accent);margin:44px 0 18px}
  h2.sec::before,h2.sec::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,#6d5d3b)}
  h2.sec::after{background:linear-gradient(90deg,#6d5d3b,transparent)}
  .heart{border:1px solid #a8946a;margin-bottom:18px;padding:12px 16px;background:linear-gradient(150deg,#e9dcbd,#ddd0a9);
    box-shadow:inset 0 0 0 4px rgba(23,19,13,.1);color:#2e2818}
  .heart.primary{border-left:4px solid var(--blood)}
  .heart h3{margin:0 0 2px;font-size:17px;font-family:var(--kai);letter-spacing:2px}
  .heart .status{font-size:12px;color:var(--blood);letter-spacing:1px}
  .heart .cycle{color:#6e6549;font-size:13px;margin:4px 0}
  .heart .cf{display:inline-block;border:1px solid #a8946a;color:#4a4232;font-size:12px;padding:1px 9px;margin:4px 4px 0 0;background:rgba(255,252,242,.4)}
  .char .sample{color:#4a4232;font-size:13px;font-family:var(--kai);margin-top:4px}
  .seed{border:1px solid #a8946a;border-left:4px solid var(--cold);margin-bottom:18px;padding:12px 16px;background:linear-gradient(150deg,#e9dcbd,#ddd0a9);
    box-shadow:inset 0 0 0 4px rgba(23,19,13,.1);color:#2e2818}
  .seed.paid{border-left-color:#6e6549;opacity:.75}
  .seed h3{margin:0 0 2px;font-size:17px;font-family:var(--kai);letter-spacing:2px}
  .seed .status{font-size:12px;color:var(--cold);letter-spacing:1px}
  .seed .cycle{color:#6e6549;font-size:13px;margin:4px 0}
  .seed .cf{display:inline-block;border:1px solid #a8946a;color:#4a4232;font-size:12px;padding:1px 9px;margin:4px 4px 0 0;background:rgba(255,252,242,.4)}
  .seed dl{margin:8px 0 0}
  .seed .secret{color:var(--blood)}
  .body h2{margin:14px 16px 2px;font-size:20px;letter-spacing:2px;font-family:var(--kai)}
  .meta{color:#7c704f;font-size:13px;margin:0 16px}
  .chips{margin:8px 16px 0}
  .chips span{display:inline-block;border:1px solid #a8946a;color:#4a4232;font-size:12px;padding:1px 9px;margin:0 4px 6px 0;background:rgba(255,252,242,.4)}
  dl{display:grid;grid-template-columns:88px 1fr;gap:7px 10px;margin:10px 16px}
  dt{color:var(--blood);font-size:13px;white-space:nowrap;letter-spacing:2px;font-family:var(--kai)}
  dd{margin:0;font-size:14px;color:#332e21}
  .hook{margin:6px 16px 18px;padding:9px 14px;border-left:3px solid var(--blood);background:rgba(158,58,43,.06);font-size:14px;color:#4a4232}
  footer{color:var(--dim);font-size:12px;margin-top:34px;border-top:1px solid #6d5d3b;padding-top:14px}
  @media print{.loc,.char,.heart,header{break-inside:avoid}}`;

  const locHtml = l => {
    const m = l.mood ?? {};
    const p = m.palette ?? ['transparent', 'transparent', 'transparent'];
    const card = l.card ?? {};
    const field = (dt, dd) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`;
    const chips = (l.era_notes ?? []).map(e => `<span>${esc(e.era)} · ${esc(e.note)}</span>`).join('');
    const eraProps = (card.era_props ?? []).map(ep =>
      `<div>${esc(ep.era)}：${esc(ep.props.join('／'))}</div>`).join('');
    return `
  <section class="loc" id="${esc(l.id)}">
    <div class="stage" style="--p0:${p[0]};--p1:${p[1]};--p2:${p[2]}">
      ${EMOTION_CORE.includes(l.id) ? '<span class="badge">情感核心</span>' : ''}
      ${m.rain ? '<div class="rain"></div>' : ''}
      ${m.bigchar ? `<span class="bigchar">${esc(m.bigchar)}</span>` : ''}
      ${m.sign ? `<span class="seal">${esc(m.sign)}</span>` : ''}
      ${l.layer === 'public' ? '' : `<span class="badge private">私有 · ${esc(l.first_appearance ?? '')} 出道</span>`}
    </div>
    <div class="body">
      <h2>${esc(l.name)}</h2>
      <p class="meta">${esc(l.address ?? '')} · ${l.geo ? `${l.geo.lat}, ${l.geo.lng}` : ''}</p>
      ${chips ? `<div class="chips">${chips}</div>` : ''}
      <dl>
        ${field('门面', esc(card.facade ?? ''))}
        ${field('走进去', esc(card.inside ?? ''))}
        ${field('标志物件', esc((card.objects ?? []).join(' · ')))}
        ${field('声音', esc((card.sounds ?? []).join(' · ')))}
        ${field('气味', esc((card.smells ?? []).join(' · ')))}
        ${field('光线', esc(card.light ?? ''))}
        ${field('人群', esc(card.people ?? ''))}
        ${field('年代道具', eraProps)}
      </dl>
      <blockquote class="hook">${esc(card.hook ?? '')}</blockquote>
    </div>
  </section>`;
  };

  const phaseHtml = timeline.phases.map(p =>
    `<span>${esc(p.name)}<br><b>${phaseCount.get(p.id)} 锚点</b></span>`).join('');

  const hearts = JSON.parse(readFileSync(join(universeDir, 'hearts.json'), 'utf8')).hearts;
  const heartHtml = h => `
  <section class="heart${h.status.includes('主心脏') ? ' primary' : ''}">
    <h3>${esc(h.name)} <span class="status">${esc(h.status)}</span></h3>
    <p class="cycle">${esc(h.cycle)}</p>
    <p style="font-size:14px;margin:4px 0">${esc(h.consensus)}</p>
    <div>${(h.choice_fields ?? []).map(c => `<span class="cf">${esc(c)}</span>`).join('')}</div>
    <p style="font-size:12px;color:var(--dim);margin:6px 0 0">${esc(h.or_rule ?? '')}</p>
  </section>`;

  const charHtml = c => {
    const field = (dt, dd) => `<div><dt>${esc(dt)}</dt><dd>${dd}</dd></div>`;
    const anchors = (c.persona_anchors ?? []).map(a => `<span>${esc(a)}</span>`).join('');
    const stages = (c.stages ?? []).map(s => `<div><b>${esc(s.era)}</b> — ${esc(s.note)}</div>`).join('');
    const hooks = (c.timeline_hooks ?? []).map(h => `<span>${esc(h)}</span>`).join('');
    const secrets = (c.bio_secret ?? []).map(s =>
      `<div class="secret">${s.big ? '★ 大秘密 · ' : '⊘ '}${esc(s.fact)}${s.big ? '' : '（披露作品未指派）'}</div>`).join('');
    // 扩展档案（背景/动机/性格/语气/故事线）：创作内部的人物五要素，不进 IR
    const p = c.profile ?? {};
    const speech = p.speech
      ? `<div>${esc(p.speech.register ?? '')}</div><div class="anchors">${(p.speech.tics ?? []).map(t => `<span>${esc(t)}</span>`).join('')}</div><div class="sample">「${esc(p.speech.sample ?? '')}」</div>`
      : '';
    return `
  <section class="char" style="--c:${c.stage?.theme ?? 'var(--dim)'}">
    <h3>${esc(c.name)} <span class="aka">${esc((c.aliases ?? []).join(' · '))}</span></h3>
    <p class="role">${esc(c.universe_role ?? '')}</p>
    <div class="anchors">${anchors}</div>
    <dl>
      ${field('生年', `${c.birth_year}（1997 年 ${1997 - c.birth_year} 岁 / 2023 年 ${2023 - c.birth_year} 岁）`)}
      ${field('声线', `${c.voice_hz} Hz · ${c.stage?.side === 'left' ? '左侧站位' : '右侧站位'}`)}
      ${field('公开人设', esc(c.bio_public ?? ''))}
      ${field('背景', esc(p.background ?? ''))}
      ${field('动机', esc(p.motive ?? ''))}
      ${field('性格', esc(p.temperament ?? ''))}
      ${field('语气', speech)}
      ${field('故事线', esc(p.arc ?? ''))}
      ${stages ? field('年代阶段', `<div class="stages">${stages}</div>`) : ''}
      ${hooks ? field('事件织入', `<div class="anchors">${hooks}</div>`) : ''}
      ${field('秘密档案', secrets || '<span style="color:#7c704f">（无）</span>')}
    </dl>
  </section>`;
  };

  // 引子登记簿：已发行作品埋下、尚未兑付的叙事线头（可缺省：脚手架宇宙不一定有）
  const seedsFile = join(universeDir, 'seeds.json');
  const seeds = existsSync(seedsFile) ? JSON.parse(readFileSync(seedsFile, 'utf8')).seeds : [];
  const seedHtml = s => {
    const refs = [
      ...(s.points_to?.characters ?? []).map(r => `人物 ${r}`),
      ...(s.points_to?.locations ?? []).map(r => `地点 ${r}`),
      ...(s.points_to?.events ?? []).map(r => `事件 ${r}`),
    ].map(r => `<span class="cf">${esc(r)}</span>`).join('');
    return `
  <section class="seed${s.status === 'paid' ? ' paid' : ''}">
    <h3>${esc(s.name)} <span class="status">埋于 ${esc(s.planted_in)} · ${s.status === 'paid' ? `已兑付于 ${esc(s.paid_in ?? '')}` : '未兑付'}${s.or_ending ? ` · 仅 ${esc(s.or_ending)} 为真` : ''}</span></h3>
    <p class="cycle">${esc(s.where)}</p>
    <dl>
      <div><dt>玩家所见</dt><dd>${esc(s.shown)}</dd></div>
      <div><dt>宇宙定论</dt><dd class="secret">${esc(s.truth)}</dd></div>
      <div><dt>指向</dt><dd>${refs}</dd></div>
      <div><dt>引用约束</dt><dd>${esc(s.constraints)}</dd></div>
    </dl>
  </section>`;
  };

  const universeChars = chars.filter(c => c.class === 'universe');
  const castChars = chars.filter(c => c.class !== 'universe');
  const conv = canon.conventions ?? {};
  const orEndings = Object.entries(conv.or_endings ?? {});

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(canon.name)} · 地点设定集</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(canon.name)} · 地点</h1>
    <p class="sub">canon ${esc(canon.version)} · 主窗 ${esc(canon.era.main.join('–'))} · ${locations.length} 个锚点地点（${locations.filter(l => l.layer !== 'public').length} 个私有）· ${universeChars.length} 位宇宙级隐藏人物 + ${castChars.length} 位剧集人物 · ${seeds.length} 条引子 · 图案为文字舞台演出词汇（ADR-004）</p>
  </header>
  <nav class="phases">${phaseHtml}</nav>
  <h2 class="sec">心脏事件（或然结局载体 · 历史不动，人心分支）</h2>
  ${hearts.map(heartHtml).join('\n')}
  <h2 class="sec">地点</h2>
  ${locations.map(locHtml).join('\n')}
  <h2 class="sec">宇宙级隐藏人物（永不主角）</h2>
  ${universeChars.map(charHtml).join('\n')}
  <h2 class="sec">剧集人物（class: cast · 随出道作登场）</h2>
  ${castChars.map(charHtml).join('\n')}
  <h2 class="sec">引子登记簿（已发行作品埋下的线头 · 引用前先查）</h2>
  ${seeds.map(seedHtml).join('\n')}
  ${orEndings.length ? `<h2 class="sec">或然结局政策</h2>${orEndings.map(([g, p]) => `
  <section class="seed">
    <h3>${esc(g)} <span class="status">${esc(p.status ?? '')}</span></h3>
    <p style="font-size:14px;margin:4px 0">${esc(p.rule ?? '')}</p>
    <dl>${Object.entries(p).filter(([k]) => /^E\d+$/.test(k)).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
  </section>`).join('\n')}` : ''}
  <footer>数据源 universe/（内容即数据）· 构建：npm run build:wiki · 印章与氛围层由 tokens.json 舞台令牌对齐 · 人物卡片含秘密档案与引子定论，仅限创作内部使用</footer>
</div>
</body>
</html>
`;
}

// 直接运行：写 docs/canon.html 并输出校验和（创作内部产物，不进入公网 web/）
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
  const html = buildWikiHtml(join(root, 'universe'));
  writeFileSync(join(root, 'docs/canon.html'), html);
  const md5 = createHash('md5').update(html).digest('hex');
  console.log(`docs/canon.html  ${(html.length / 1024).toFixed(1)} KB  md5 ${md5}`);
}
