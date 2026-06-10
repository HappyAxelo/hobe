// Service worker: instant app shell on repeat visits + offline playback of saved videos.
const SHELL = 'hobe-shell-v1';
const VIDEOS = 'hobe-videos';
const SHELL_FILES = ['/', '/index.html', '/app.js', '/style.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('hobe-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // API: network only (money state must never be stale)
  if (url.pathname.startsWith('/api/')) return;

  // Videos saved for offline: cache first (full-body responses satisfy range requests in Chrome)
  if (url.pathname.startsWith('/videos/')) {
    e.respondWith(
      caches.open(VIDEOS).then((c) => c.match(e.request.url, { ignoreVary: true })).then((hit) => hit || fetch(e.request)),
    );
    return;
  }

  // Shell: cache first, refresh in background
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const refresh = fetch(e.request).then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    }),
  );
});
