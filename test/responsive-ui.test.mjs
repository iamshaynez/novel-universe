import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = () => readFile(join(root, 'web/index.html'), 'utf8');
const player = () => readFile(join(root, 'web/player.mjs'), 'utf8');
const stage = () => readFile(join(root, 'web/stage.mjs'), 'utf8');

describe('手机、iPad 与桌面共用可靠的视口和纸卡边界', () => {
  it('视口声明允许软键盘压缩内容区，并提供动态可视高度与安全区', async () => {
    const src = await html();
    assert.match(src, /name="viewport" content="[^"]*interactive-widget=resizes-content/);
    assert.match(src, /--visual-height/);
    assert.match(src, /--safe-top:env\(safe-area-inset-top/);
    assert.match(await stage(), /visualViewport/);
  });

  it('封面、侧面板和纸卡拥有真实滚动边界，触屏目标至少 44px', async () => {
    const src = await html();
    assert.match(src, /#title\{[^}]*overflow-y:auto/);
    assert.match(src, /\.sidepanel\{[^}]*overflow-y:auto/);
    assert.match(src, /#tape\{[^}]*clip-path:inset/);
    assert.match(src, /@media \(pointer:coarse\)/);
    assert.match(src, /min-height:44px/);
  });
});

describe('登录注册是原生、可聚焦、可被密码管理器识别的表单', () => {
  it('模态层使用 dialog + form，关闭后不会留下透明输入控件', async () => {
    const src = await html();
    assert.match(src, /<dialog id="authPanel"[^>]*aria-labelledby="apTitle"/);
    assert.match(src, /<form id="authForm" class="ap-paper">/);
    assert.match(src, /<dialog id="endcard"/);
    assert.match(src, /<dialog id="fatalBar"/);
  });

  it('两个输入框都有可见 label、正确的自动填充与移动端输入语义', async () => {
    const src = await html();
    assert.match(src, /<label[^>]*for="apUser"/);
    assert.match(src, /<label[^>]*for="apPass"/);
    assert.match(src, /id="apUser"[^>]*name="username"[^>]*autocomplete="username"[^>]*autocapitalize="none"/);
    assert.match(src, /id="apPass"[^>]*name="password"[^>]*autocomplete="new-password"/);
    assert.match(src, /class="ap-err" id="apErr" role="alert"/);
    assert.match(src, /id="apSubmit" type="submit"/);
    assert.match(src, /id="apSwitch" type="button"/);
  });

  it('表单统一处理提交与重复请求，会话失效时给出重新登录入口', async () => {
    const src = await player();
    assert.match(src, /authForm'\)\.addEventListener\('submit'/);
    assert.match(src, /authForm'\)\.addEventListener\('keydown'/);
    assert.match(src, /requestSubmit\(\$\('#apSubmit'\)\)/);
    assert.match(src, /authBusy/);
    assert.match(src, /app\.sync\?\.paused/);
    assert.match(src, /重新登录/);
    assert.match(src, /openAuth\('login'\)/);
  });

  it('认证请求悬置时可取消并中止，旧请求不得覆盖新会话', async () => {
    const src = await player();
    assert.match(src, /new AbortController\(\)/);
    assert.match(src, /authAttempt/);
    assert.match(src, /authController\?\.abort\(\)/);
    assert.match(src, /api\.post\(`\/api\/auth\/\$\{mode\}`,[\s\S]*?signal: controller\.signal/);
  });

  it('结局重开失败在原生模态内报错，不把提示藏到 backdrop 后面', async () => {
    const markup = await html();
    const src = await player();
    assert.match(markup, /id="endError" class="end-err" role="alert"/);
    assert.match(src, /endError'\)\.textContent = `重开失败：/);
  });
});
