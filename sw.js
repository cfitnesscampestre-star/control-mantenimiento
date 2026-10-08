'use strict';
/* Al subir cambios: sube VERSION aquí y el número ?v= en index.html (van juntos).
   Si agregas archivos nuevos en css/, js/ o img/, agrégalos a ARCHIVOS. */
const VERSION = 13;
const CACHE = 'cm-v' + VERSION;
const ARCHIVOS = ['./', 'index.html', 'manifest.json', 'css/main.css', 'css/glassmorphism.css', 'css/mantenimiento.css', 'css/app-mobile.css', 'css/app-desktop.css',
  'js/config.js', 'js/qrcode.js', 'js/inventario.js', 'js/app.js', 'js/informes.js', 'img/membrete.png', 'img/logo.png', 'img/textura.svg', 'img/textura-clara.svg', 'img/icon-192.png', 'img/icon-512.png', 'img/icon-maskable-512.png', 'img/apple-touch-icon.png', 'img/favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname.endsWith('firebaseio.com')) return;               // la base de datos no se guarda aquí
  const mismo = u.origin === self.location.origin;
  const libre = u.hostname === 'www.gstatic.com' || u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (!mismo && !libre) return;
  e.respondWith(caches.open(CACHE).then(c => c.match(req, { ignoreSearch: true }).then(hit => {
    const red = fetch(req).then(r => { if (r && r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || red;
  })));
});
