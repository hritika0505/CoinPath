// sw.js - caches the app so it opens with no internet.
// Keep this file in the SAME folder as index.html.
// Edit SHELL to list your real files. A wrong path here makes install fail.
const CACHE = 'coinpath-shell-v1';   // change to v2, v3... whenever you change any file

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/offlineApi.js',
  './js/offlineStore.js',
  './js/cryptoUtil.js',
  './js/transfer.js',
  './js/sync.js',
  // add Person 1's files here, e.g. './css/style.css', './js/app.js', './js/qrcode.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;                 // only cache GETs
  if (url.pathname.startsWith('/api/')) return;     // never cache backend API calls
  if (url.origin !== self.location.origin) return;  // same-origin files only

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      });
    })
  );
});
