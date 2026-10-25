// Service worker.
// Код приложения (маленькие файлы): сначала сеть, при отсутствии сети — кэш. Обновления подхватываются сами.
// Тяжёлые библиотеки и шрифт: из кэша (они не меняются), поэтому запуск быстрый и работает офлайн.
const CACHE = 'scanner-v6';
const BIG = [
  './lib/opencv.js', './lib/jspdf.umd.min.js', './lib/jszip.min.js', './lib/LiberationSerif-Regular.ttf'
];
const SHELL = [
  './', './index.html', './style.css', './app.js', './core.js', './export.js', './manifest.json',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

const bigPaths = new Set(BIG.map(p => new URL(p, self.location).pathname));

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll([...SHELL, ...BIG])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // тяжёлые файлы и чужие ресурсы (OCR-модели): кэш в приоритете
  if (!sameOrigin || bigPaths.has(url.pathname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok && (sameOrigin || /tesseract|jsdelivr|unpkg/.test(req.url))) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // код приложения: сеть (не дольше 4 с), иначе кэш
  e.respondWith(
    withTimeout(fetch(req.url, { cache: 'no-cache' }), 4000)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
