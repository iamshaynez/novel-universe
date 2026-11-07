import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = () => readFile(join(root, 'web/index.html'), 'utf8');
const player = () => readFile(join(root, 'web/player.mjs'), 'utf8');

describe('全部存档入口与游戏内选档共用一份真实数据', () => {
  it('封面常驻全部存档按钮和数量，面板明确覆盖全部作品并说明时间口径', async () => {
    const src = await html();
    assert.match(src, /id="btnAllSaves"[^>]*disabled/);
    assert.match(src, /id="saveCount"/);
    assert.match(src, /选择存档 · 全部作品/);
    assert.match(src, /class="save-note">按最后保存时间排序 · 本机时间/);
  });

  it('封面与 HUD 都打开同一面板，列表不再要求先开始游戏', async () => {
    const src = await player();
    assert.match(src, /btnAllSaves'\)\.onclick = \(\) => openSaves\(\)/);
    assert.match(src, /btnSaves'\)\.onclick = \(\) => openSaves\(\)/);
    assert.match(src, /async function listAllSaves\(\)/);
    const start = src.indexOf('async function openSaves');
    const open = src.slice(start, src.indexOf('let readReturnFocus', start));
    assert.ok(start >= 0 && open.length > 0);
    assert.doesNotMatch(open, /先开始游戏/);
  });

  it('存档行包含原生选择按钮、time 元素与独立状态；同步成功后面板和封面都会刷新', async () => {
    const src = await player();
    assert.match(src, /function renderSaveRow\(/);
    assert.match(src, /document\.createElement\('time'\)/);
    assert.match(src, /view\.progress/);
    assert.match(src, /view\.sync/);
    assert.match(src, /status\.online === true/);
    assert.match(src, /async function renderGameList\(\)/);
  });

  it('封面删除走作品对应运行时，读档阻止墓碑并完整关闭面板', async () => {
    const src = await player();
    assert.match(src, /async function removeSaveDocument\(/);
    assert.match(src, /existing\.deleted/);
    assert.match(src, /closePanels\(\)/);
  });

  it('跨作品读档先用局部运行时完成，再提交全局切换；旧请求按代次淘汰', async () => {
    const src = await player();
    const start = src.indexOf('async function loadSave');
    const load = src.slice(start, src.indexOf('let saveListEpoch', start));
    assert.match(load, /const epoch = \+\+entryEpoch/);
    assert.match(load, /const runtime = new LocalRuntime/);
    assert.match(load, /runtime\.load\(saveId\)/);
    assert.match(load, /epoch !== entryEpoch/);
    assert.ok(load.indexOf('runtime.load(saveId)') < load.indexOf('useRuntime(ir)'), '加载成功前不得改写 app.runtime/app.ir/app.gameId');
  });

  it('过期开局的已写入文档立即转为墓碑，不产生可选孤儿存档', async () => {
    const src = await player();
    const start = src.indexOf('async function startGame');
    const startBody = src.slice(start, src.indexOf('// 内容迁移话术', start));
    assert.match(startBody, /if \(epoch !== entryEpoch\) \{\s*await runtime\.remove\(r\.doc\.id\);\s*return;\s*\}/);
  });

  it('封面存档字段不经过 innerHTML，离线删除不读 IR，取数失败会撤销遮罩', async () => {
    const src = await player();
    const renderStart = src.indexOf('function renderGameCard');
    const render = src.slice(renderStart, src.indexOf('// ---- 启动', renderStart));
    assert.doesNotMatch(render, /\.innerHTML/);
    const removeStart = src.indexOf('async function removeSaveDocument');
    const remove = src.slice(removeStart, src.indexOf('function renderSaveRow', removeStart));
    assert.doesNotMatch(remove, /loadIr/);
    assert.match(remove, /ir: null/);
    const openStart = src.indexOf('async function openSaves');
    const open = src.slice(openStart, src.indexOf('let readReturnFocus', openStart));
    assert.match(open, /catch \(error\) \{\s*if \(epoch === saveListEpoch\) \{\s*closePanels\(\);/);
  });
});

describe('封面作品卡：新开与继续分开，历史可展开', () => {
  const cardSrc = async () => {
    const src = await player();
    const start = src.indexOf('function renderGameCard');
    assert.ok(start >= 0, '封面必须有 renderGameCard 作品卡渲染');
    return src.slice(start, src.indexOf('function renderCatalogRow', start));
  };

  it('每部作品卡都有两个互不吞并的动作：继续上次、开新局——不再靠一张大按钮猜语义', async () => {
    const card = await cardSrc();
    assert.match(card, /className = 'g-btn g-resume'/);
    assert.match(card, /className = 'g-btn g-new'/);
    assert.match(card, /'继续上次'/);
    assert.match(card, /'开新局'/);
    assert.match(card, /b\.onclick = \(\) => loadSave\(last\.id\)/, '继续上次直达最新未完成存档');
    assert.match(card, /c\.onclick = \(\) => startGame\(g\.id\)/, '开新局是永远独立的显式动作');
  });

  it('继续上次默认展示最新一个未完成存档：章节与最后保存时间，一眼知道接上的是哪段', async () => {
    const card = await cardSrc();
    assert.match(card, /resumeSave\(saves\)/, '续读目标必须走统一口径：最新未完成档');
    assert.match(card, /last\.summary\?\.chapterTitle/);
    assert.match(card, /formatSaveTimeShort\(last\)/);
  });

  it('冒烟模式封面保持干净：不渲染续读信息与历史展开，只留开新局', async () => {
    const card = await cardSrc();
    assert.match(card, /AUTO \? null : resumeSave\(saves\)/);
  });
});

describe('封面两架分区：十部作品也不膨胀', () => {
  const section = async (name, end) => {
    const src = await player();
    const start = src.indexOf(name);
    assert.ok(start >= 0, `封面必须有 ${name}`);
    return src.slice(start, src.indexOf(end, start));
  };

  it('有未完成档的作品上「正在追查」架并按最近活动排序，其余进「案卷总目」——灯下的卷不重复上架', async () => {
    const list = await section('async function renderGameList', '// ---- 启动');
    assert.match(list, /正在追查 · /);
    assert.match(list, /案卷总目 · /);
    assert.match(list, /resumeSave\(saves\)/, '分组口径必须与续读一致：有未完成档才上追查架');
    assert.match(list, /compareSaveDocs/, '追查架按最近活动排序');
    const before = list.slice(0, list.indexOf('案卷总目 · '));
    assert.match(before, /renderGameCard/, '追查架用富作品卡');
    assert.doesNotMatch(before, /renderCatalogRow/, '追查架不混总目行');
  });

  it('总目行：一行一卷（卷名 + 一句勾子），动作是右侧显式小钮，通关档可就地展开', async () => {
    const row = await section('function renderCatalogRow', 'function buildHistoryTray');
    assert.match(row, /'cat-title'/);
    assert.match(row, /'cat-hook'/, '勾子是未开卷作品的唯一卖点行，保持一行');
    assert.match(row, /'g-mini'/);
    assert.match(row, /'开卷'/);
    assert.match(row, /'已通关'/, '只剩通关档的卷标状态，历史档从行内展开');
    assert.match(row, /buildHistoryTray\(g, saves\)/, '历史展开与作品卡共用同一实现');
    assert.doesNotMatch(row, /'g-btn g-resume'/, '总目行没有续读——有未完成档的卷根本不进总目');
  });

  it('历史存档展开开关是作品卡与总目行共用的一份实现，展开状态跨重渲染保留', async () => {
    const tray = await section('function buildHistoryTray', 'async function renderGameList');
    assert.match(tray, /'g-more'/);
    assert.match(tray, /aria-expanded/);
    assert.match(tray, /renderSaveRow\(\{ doc, game: g \}\)/, '展开区与存档面板共用同一行渲染，行为一致');
    assert.match(tray, /expandedGames/, '展开状态必须跨重渲染保留');
    assert.match(tray, /AUTO \? 0 : saves\.length - \(resumeSave\(saves\) \? 1 : 0\)/, '冒烟模式不渲染历史展开');
  });
});
