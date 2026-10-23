/* Azyvion CRM — aplicación web instalable con actualización automática.
   · Registra el service worker y busca versión nueva al abrir, al volver a la app y cada 30 min.
   · En la pantalla de inicio de sesión aplica la actualización al instante (no hay trabajo en curso).
   · Dentro del sistema NO recarga sola (podría perder una venta a medias): avisa con un botón. */
(function () {
  var enLogin = /\/(login|register)\.html$|\/$/.test(location.pathname) && !/dashboard/.test(location.pathname);
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // La app instalada siempre arranca en el inicio de sesión (también al cerrar sesión)
  if (standalone && /\/(index\.html)?$/.test(location.pathname)) { location.replace('login.html' + location.search); return; }

  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;

  var recargando = false;
  function aviso() {
    if (document.getElementById('az-update')) return;
    var d = document.createElement('div'); d.id = 'az-update';
    d.setAttribute('role', 'status');
    d.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99999;background:#0D1522;color:#fff;padding:12px 16px;border-radius:12px;font:600 13.5px Inter,system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.35);display:flex;gap:12px;align-items:center;max-width:92vw';
    d.innerHTML = '<span>Hay una nueva versión del sistema.</span><button style="background:#0A84FF;color:#fff;border:0;border-radius:8px;padding:7px 12px;font:inherit;cursor:pointer">Actualizar</button>';
    d.querySelector('button').onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
    function revisar() { try { reg.update(); } catch (e) {} }
    revisar();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) revisar(); });
    setInterval(revisar, 30 * 60 * 1000);
    reg.addEventListener('updatefound', function () {
      var nw = reg.installing; if (!nw) return;
      nw.addEventListener('statechange', function () {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          if (enLogin) { recargando = true; location.reload(); } else aviso();
        }
      });
    });
  }).catch(function () {});

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (recargando) return;
    if (enLogin) { recargando = true; location.reload(); } else aviso();
  });

  // Botón «Instalar aplicación» (Chrome/Edge/Android)
  var evt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); evt = e;
    var b = document.getElementById('az-install'); if (b) b.style.display = '';
  });
  window.addEventListener('appinstalled', function () { var b = document.getElementById('az-install'); if (b) b.style.display = 'none'; });
  window.azInstalar = function () { if (evt) { evt.prompt(); evt = null; } };
})();
