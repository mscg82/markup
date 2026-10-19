// Bump CACHE when you deploy a new version so clients drop old files.
const CACHE = 'markup-v32';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/style.css', './js/markup.js', './js/colorpicker.js', './js/i18n.js', './js/diag.js',
  './locale/languages.json',
  './locale/en.json', './locale/it.json',   // add every new language file here
  './img/favicon.ico', './img/favicon.svg', './img/apple-touch-icon.png',
  './img/icon-48.png', './img/icon-96.png', './img/icon-144.png',
  './img/icon-192.png', './img/icon-512.png', './img/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Serve from cache immediately, refresh the cache from the network in the background.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      // 'no-cache' makes the background refresh revalidate with the server instead of trusting the browser's HTTP cache
      const network = fetch(req, { cache: 'no-cache' }).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    })
  );
});
