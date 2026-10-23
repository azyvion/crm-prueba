/* Azyvion CRM — service worker.
   Estrategia: red primero para los archivos de la propia app (siempre la última versión publicada,
   saltándose el caché de 10 min de GitHub Pages) y caché solo como respaldo sin conexión.
   Nunca intercepta Supabase, correo ni ninguna otra API: los datos siempre van directo al servidor.
   No hace falta cambiar nada en cada publicación; subir VERSION solo limpia cachés antiguos. */
const VERSION = 'v2';
const CACHE = 'azyvion-' + VERSION;
const PRECACHE = ['login.html', 'logo-crm-192.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('azyvion-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // CDN, Supabase, etc.: no se toca
  e.respondWith(
    fetch(req, { cache: 'no-cache' })                           // revalida siempre con el servidor
      .then((res) => {
        if (res && res.ok && res.type === 'basic') { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('login.html') : Response.error())))
  );
});
