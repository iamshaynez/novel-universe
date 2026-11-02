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
    // 带 bundle 戳的注册 URL + updateViaCache:none：SW 更新检查绕开一切 HTTP 缓存，
    // CDN 改写 /sw.js 响应头也困不住旧壳（换壳必达）。
    const swUrl = window.__NU_SW_URL ?? '/sw.js';
    navigator.serviceWorker.register(swUrl, { scope: '/', updateViaCache: 'none' }).then(registration => {
      // 更新只在播放器声明的安全点激活；controllerchange 后才重载，避免新旧壳混用。
      // 手动「检查并更新」也走这里：新壳可能还在 installing（预缓存下载中）——
      // 等它装完再激活，而不是误判「没有新版」直接硬刷（旧壳导航会继续端旧资源）。
      window.nuActivateUpdate = async () => {
        await registration.update().catch(() => null);
        const activate = worker => { worker.postMessage({ type: 'NU_ACTIVATE' }); return true; };
        if (registration.waiting) return activate(registration.waiting);
        const installing = registration.installing;
        if (!installing) return false; // 没有可激活的新壳
        if (installing.state === 'installed') return activate(installing);
        return await new Promise(resolve => {
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed') resolve(activate(installing));
            else if (installing.state === 'redundant') resolve(false); // 装坏了：交给调用方决定
          });
        });
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
