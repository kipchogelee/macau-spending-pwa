const CACHE_VERSION = 'v7';
const CACHE_NAME = `macau-spending-rewards-${CACHE_VERSION}`;

// 所有需要預緩存的資源（確保路徑精確）
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png',
  './favicon-32.png',
  './icon.svg'
];

// ========== Install ==========
self.addEventListener('install', (event) => {
  console.log(`[SW ${CACHE_VERSION}] Installing...`);
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // 逐一緩存，某個失敗唔影響其他
      const results = await Promise.allSettled(
        PRECACHE_ASSETS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) {
              await cache.put(url, response);
              console.log(`[SW ${CACHE_VERSION}] Cached: ${url}`);
            } else {
              console.warn(`[SW ${CACHE_VERSION}] Bad response for: ${url}`, response.status);
            }
          } catch (err) {
            console.warn(`[SW ${CACHE_VERSION}] Failed to cache: ${url}`, err);
          }
        })
      );

      const successCount = results.filter(r => r.status === 'fulfilled').length;
      console.log(`[SW ${CACHE_VERSION}] Precached ${successCount}/${PRECACHE_ASSETS.length} assets`);

      // 強制立即接管，唔等舊 SW 自然退休
      await self.skipWaiting();
    })()
  );
});

// ========== Activate ==========
self.addEventListener('activate', (event) => {
  console.log(`[SW ${CACHE_VERSION}] Activating...`);
  event.waitUntil(
    (async () => {
      // 清除所有舊版本緩存
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log(`[SW ${CACHE_VERSION}] Deleting old cache: ${key}`);
            return caches.delete(key);
          })
      );

      // 立即接管所有頁面
      await self.clients.claim();
      console.log(`[SW ${CACHE_VERSION}] Activated and claimed all clients`);

      // 通知所有頁面 SW 已更新
      const allClients = await self.clients.matchAll({ type: 'window' });
      allClients.forEach(client => {
        client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
      });
    })()
  );
});

// ========== Fetch ==========
self.addEventListener('fetch', (event) => {
  // 只處理 GET 請求
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 忽略非 http/https
  if (!url.protocol.startsWith('http')) return;

  // 忽略 chrome-extension 等
  if (!url.protocol.startsWith('http')) return;

  // 導航請求（HTML 頁面）— cache-first + 網絡更新
  if (event.request.mode === 'navigate') {
    event.respondWith(handleNavigate(event.request));
    return;
  }

  // 同源靜態資源 — cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(handleSameOrigin(event.request));
    return;
  }

  // 外部資源 — network-first with cache fallback
  event.respondWith(handleExternal(event.request));
});

// 導航請求處理
async function handleNavigate(request) {
  try {
    // 先嘗試緩存
    const cached = await caches.match('./index.html') || await caches.match(request);
    if (cached) {
      // 背景更新緩存
      updateCache(request).catch(() => {});
      return cached;
    }
    // 緩存冇有，嘗試網絡
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put('./index.html', response.clone());
    }
    return response;
  } catch (err) {
    // 完全離線，返回緩存的 index.html
    const cached = await caches.match('./index.html');
    if (cached) return cached;
    // 最後 fallback
    return new Response(offlineFallback(), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

// 同源靜態資源處理
async function handleSameOrigin(request) {
  // 規範化 URL（移除 query string 以提升緩存命中率）
  const normalizedUrl = new URL(request.url);
  normalizedUrl.search = '';
  const normalizedRequest = new Request(normalizedUrl.toString(), { method: 'GET' });

  const cached = await caches.match(normalizedRequest) || await caches.match(request);

  if (cached) {
    // Stale-while-revalidate：返回緩存，背景更新
    updateCache(request, normalizedRequest).catch(() => {});
    return cached;
  }

  // 緩存冇有，從網絡取
  try {
    const response = await fetch(request);
    if (response.ok && response.status < 400) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(normalizedRequest, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Resource not available offline', { status: 503 });
  }
}

// 外部資源處理
async function handleExternal(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('External resource not available offline', { status: 503 });
  }
}

// 背景更新緩存
async function updateCache(originalRequest, storeAsRequest) {
  try {
    const response = await fetch(originalRequest);
    if (response.ok && response.status < 400) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(storeAsRequest || originalRequest, response);
    }
  } catch (err) {
    // 靜默失敗，唔影響用戶
  }
}

// 離線 fallback HTML
function offlineFallback() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>離線中 — 澳門消費獎賞</title>
<style>
  body { font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea, #764ba2); color: white; text-align: center; padding: 20px; }
  .box { max-width: 320px; }
  .emoji { font-size: 4em; margin-bottom: 16px; }
  h1 { font-size: 1.4em; margin-bottom: 8px; }
  p { opacity: 0.85; font-size: 0.9em; line-height: 1.6; }
  button { margin-top: 20px; padding: 12px 28px; border: 2px solid white; background: transparent; color: white; border-radius: 30px; font-size: 1em; cursor: pointer; }
  button:hover { background: rgba(255,255,255,0.2); }
</style>
</head>
<body>
  <div class="box">
    <div class="emoji">📡</div>
    <h1>目前冇網絡連接</h1>
    <p>請檢查網絡連接，或等待自動重連。<br>已有嘅資料仍然保存緊。</p>
    <button onclick="location.reload()">重試</button>
  </div>
</body>
</html>`;
}
