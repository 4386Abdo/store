/**
 * Service Worker: يخزّن ملفات التطبيق ليعمل بدون إنترنت.
 * الاستراتيجية: الشبكة أولا ثم النسخة المحفوظة (حتى تصلك التحديثات فور توفرها).
 * ملاحظة: بيانات المخزون نفسها محفوظة في localStorage أو Supabase وليست هنا.
 */
const CACHE_NAME = 'inventory-v3';
const STATIC_ASSETS = [
  './', './index.html', './editor.html', './owner.html',
  './css/styles.css',
  './js/config.js', './js/api.js', './js/ui.js', './js/qr.js', './js/editor.js', './js/owner.js',
  './manifest.json', './icons/icon.svg', './icons/pwa-192x192.png', './icons/pwa-512x512.png',
  './sql/schema.sql',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // نخزّن كل ملف على حدة حتى لا يفشل التثبيت كله بسبب ملف واحد
      Promise.all(STATIC_ASSETS.map((url) => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && (response.status === 200 || response.type === 'opaque')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (request.mode === 'navigate') return caches.match('./index.html');
          return new Response('المحتوى غير متوفر دون اتصال بالإنترنت', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
      )
  );
});
