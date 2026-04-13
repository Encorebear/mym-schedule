const CACHE_NAME = 'mym-schedule-v8';
const ASSETS = [
  '/mym-schedule/',
  '/mym-schedule/index.html',
  '/mym-schedule/manifest.json',
  '/mym-schedule/icon-192.png',
  '/mym-schedule/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // 이 경로들은 절대 캐시 안 함 → 항상 최신 서버 응답
  const url = e.request.url;
  if (url.includes('script.google.com')) return;
  if (url.includes('cdnjs.cloudflare.com')) return;
  if (url.includes('version.json')) return; // 버전 체크는 항상 서버에서

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
