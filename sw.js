const CACHE_NAME = 'mym-schedule-v9';

// HTML·버전파일은 절대 캐시 안 함 (GitHub Pages, Netlify 양쪽 경로 대응)
function isNeverCache(url) {
  const p = new URL(url).pathname;
  return p === '/'
    || p.endsWith('/index.html')
    || p.endsWith('/version.json')
    || p.endsWith('/sw.js');
}

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() =>
        self.clients.matchAll({ type: 'window' }).then(clients =>
          clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }))
        )
      )
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 외부 CDN·GAS는 SW가 관여 안 함
  if (url.includes('script.google.com') || url.includes('cdnjs.cloudflare.com')) return;

  // HTML·버전파일 → 항상 네트워크 (캐시 완전 우회)
  if (isNeverCache(url)) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 나머지 정적 자산 → 네트워크 우선, 실패 시 캐시
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(CACHE_NAME).then(c => c.put(e.request, res.clone()));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
