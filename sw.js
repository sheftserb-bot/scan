// Service worker: кэш для работы офлайн
const CACHE = 'scanner-v1';
const ASSETS = [
  './', './index.html', './style.css', './app.js', './core.js', './manifest.json',
  './lib/opencv.js', './lib/jspdf.umd.min.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      // докэшируем то, что подгрузилось позже (например, языковые данные OCR)
      if (res.ok && (req.url.startsWith(self.location.origin) || /tesseract|jsdelivr|unpkg/.test(req.url))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
