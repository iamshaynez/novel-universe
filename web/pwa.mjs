// 安装入口：Chromium 原生提示 + iOS/其他浏览器的主屏幕指引。
const button = document.querySelector('#btnInstall');
const note = document.querySelector('#installNote');
const dialog = document.querySelector('#installHelp');
const steps = document.querySelector('#installSteps');
const close = document.querySelector('#installClose');
let installPrompt = null;

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function showInstalled() {
  button.textContent = '已装入主屏幕';
  note.textContent = '随时回来，灯下开卷';
  button.disabled = true;
}

function helpSteps() {
  if (isIOS()) return [
    '点浏览器底部的「分享」按钮。',
    '向下滑，选择「添加到主屏幕」。',
    '点「添加」，之后从主屏幕的「锦江卷宗」开卷。',
  ];
  if (/Android/.test(navigator.userAgent)) return [
    '打开浏览器菜单（通常是右上角 ⋮）。',
    '选择「安装应用」或「添加到主屏幕」。',
    '确认后，从主屏幕的「锦江卷宗」开卷。',
  ];
  return [
    '在地址栏右侧寻找「安装」图标，或打开浏览器菜单。',
    '选择「安装锦江悬疑宇宙」；若没有此项目，可换用 Chrome、Edge 或手机浏览器。',
  ];
}

function openHelp() {
  steps.replaceChildren(...helpSteps().map(text => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  dialog.showModal();
}

button.addEventListener('click', async () => {
  if (!installPrompt) { openHelp(); return; }
  const prompt = installPrompt;
  installPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  if (outcome === 'accepted') showInstalled();
  else note.textContent = '安装已取消，随时可以再试';
});

close.addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target === dialog) dialog.close();
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  if (standalone()) return;
  installPrompt = event;
  note.textContent = '安装到主屏幕，一键开卷';
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  showInstalled();
});

if (standalone()) showInstalled();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(registration => {
      // 更新只在播放器声明的安全点激活；controllerchange 后才重载，避免新旧壳混用。
      window.nuActivateUpdate = async () => {
        await registration.update().catch(() => null);
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'NU_ACTIVATE' });
          return;
        }
        location.reload();
      };
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (window.__nuSwReloaded) return;
        window.__nuSwReloaded = true;
        location.reload();
      });
    }).catch(error => {
      console.warn('离线安装壳注册失败', error);
      note.textContent = '仍可通过浏览器菜单添加到主屏幕';
    });
  }, { once: true });
}
