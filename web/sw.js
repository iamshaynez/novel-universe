// 离线壳：由服务端在 /sw.js 响应中注入 bundle 与完整预缓存清单。
// 壳、引擎、内容包缓存优先；API 永不缓存。安装失败不阻塞线上使用，下一次更新会重试。
const BUNDLE = "/*__NU_BUNDLE__*/";
const PRECACHE = /*__NU_PRECACHE__*/[];
const CACHE = `jinjiang-offline-${BUNDLE}`;
const SHELL = new Set(PRECACHE.map(entry => entry.url));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const entry of PRECACHE) {
      const response = await fetch(entry.url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`离线包下载失败 ${entry.url}`);
      const data = await response.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', data);
      const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (actual !== entry.sha256) throw new Error(`离线包校验失败 ${entry.url}`);
      await cache.put(entry.url, new Response(data, { status: 200, headers: response.headers }));
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type === 'NU_ACTIVATE') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('jinjiang-offline-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const { pathname, origin } = new URL(request.url);
  if (origin !== self.location.origin || pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then(cached => cached || fetch(request).catch(() => caches.match('/offline.html'))),
    );
    return;
  }

  if (!SHELL.has(pathname) && !pathname.startsWith('/content/') && !pathname.startsWith('/engine/')) return;
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    })),
  );
});
