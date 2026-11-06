// Service Worker — Catatan Pengeluaran (PWA)
const CACHE = 'pengeluaran-v1';
const SHELL = ['/', '/dashboard', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Navigasi: coba network dulu, fallback ke cache (offline). Asset: cache-first.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // API & auth: selalu network (jangan cache data pribadi)
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/logout') return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put('/dashboard', copy));
        return res;
      }).catch(() => caches.match('/dashboard'))
    );
    return;
  }

  // asset statis: cache-first
  e.respondWith(
    caches.match(req).then(
      (cached) => cached || fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
    )
  );
});
