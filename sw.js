/* Markup - draw annotations over a background image, in the browser.
   Copyright (C) 2026 Giuseppe Miscione

   SPDX-License-Identifier: GPL-3.0-or-later

   This program is free software: you can redistribute it and/or modify it under
   the terms of the GNU General Public License as published by the Free Software
   Foundation, either version 3 of the License, or (at your option) any later
   version.

   This program is distributed in the hope that it will be useful, but WITHOUT ANY
   WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
   PARTICULAR PURPOSE. See the GNU General Public License for more details.

   You should have received a copy of the GNU General Public License along with
   this program (see the LICENSE file). If not, see <https://www.gnu.org/licenses/>.
*/
// Bump CACHE when you deploy a new version so clients drop old files.
const CACHE = 'markup-v36';
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
