/* ═══════════════════════════════════════════════════════════════════
   Azyvion Enterprise · Motor de tema (claro / oscuro / sistema)
   Se carga en <head> de forma síncrona para no mostrar un tema incorrecto.
   Preferencia local: localStorage 'azyvion_theme' = claro | oscuro | sistema.
   Si no hay preferencia local, se usa la del perfil (Usuarios.tema, que solo
   admite claro/oscuro) cacheada en 'azyvion_crm_prefs'; si tampoco, 'sistema'.
   Resultado: <html data-theme="light|dark"> + clase legacy 'theme-dark'.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
    var KEY = 'azyvion_theme';
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function write(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

    function preference() {
        var p = read(KEY);
        if (p === 'claro' || p === 'oscuro' || p === 'sistema') return p;
        try {
            var prefs = JSON.parse(read('azyvion_crm_prefs') || 'null');
            var t = prefs && prefs.preferencias && prefs.preferencias.tema;
            if (t === 'claro' || t === 'oscuro') return t;
        } catch (e) {}
        return 'sistema';
    }

    function resolve(pref) {
        if (pref === 'oscuro') return 'dark';
        if (pref === 'claro') return 'light';
        return mq && mq.matches ? 'dark' : 'light';
    }

    function apply(pref) {
        var mode = resolve(pref);
        var root = document.documentElement;
        root.setAttribute('data-theme', mode);
        root.setAttribute('data-theme-pref', pref);
        root.classList.toggle('theme-dark', mode === 'dark');
        if (document.body) document.body.classList.toggle('theme-dark', mode === 'dark');
        var meta = document.querySelector('meta[name="theme-color"]:not([media])');
        if (meta) meta.setAttribute('content', mode === 'dark' ? '#0D1522' : '#F5F7FA');
        syncSwitchers(pref);
        return mode;
    }

    function syncSwitchers(pref) {
        var btns = document.querySelectorAll('[data-az-theme]');
        for (var i = 0; i < btns.length; i++) {
            var on = btns[i].getAttribute('data-az-theme') === pref;
            btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }

    function notify(mode) {
        try { window.dispatchEvent(new CustomEvent('azyvion:themechange', { detail: { mode: mode, pref: preference() } })); } catch (e) {}
        // Las gráficas (overview.js) leen los colores al dibujar: se redibujan.
        if (typeof window.renderOverview === 'function') { try { window.renderOverview(); } catch (e) {} }
    }

    var AzTheme = {
        get: preference,
        mode: function () { return resolve(preference()); },
        /** Elección explícita del usuario (selector o switch del perfil). */
        set: function (pref) {
            if (pref !== 'claro' && pref !== 'oscuro' && pref !== 'sistema') return;
            write(KEY, pref);
            notify(apply(pref));
        },
        /** Preferencia que viene del servidor: solo aplica si no hay elección local. */
        syncFromServer: function (tema) {
            if (read(KEY)) return;
            if (tema === 'claro' || tema === 'oscuro') notify(apply(tema));
        },
        /** Inserta el selector de 3 opciones dentro de `container`. */
        mount: function (container) {
            if (!container || container.querySelector('.az-theme-switch')) return;
            var wrap = document.createElement('div');
            wrap.className = 'az-theme-switch';
            wrap.setAttribute('role', 'group');
            wrap.setAttribute('aria-label', 'Tema de la interfaz');
            var opts = [
                ['claro', 'Tema claro', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
                ['oscuro', 'Tema oscuro', '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'],
                ['sistema', 'Usar tema del sistema', '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>']
            ];
            for (var i = 0; i < opts.length; i++) {
                var b = document.createElement('button');
                b.type = 'button';
                b.setAttribute('data-az-theme', opts[i][0]);
                b.setAttribute('title', opts[i][1]);
                b.setAttribute('aria-label', opts[i][1]);
                b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + opts[i][2] + '</svg>';
                b.addEventListener('click', function () {
                    var pref = this.getAttribute('data-az-theme');
                    // En móvil solo se ve el botón activo: un toque pasa al siguiente modo.
                    if (this.getAttribute('aria-pressed') === 'true' && window.matchMedia('(max-width: 600px)').matches) {
                        var order = ['claro', 'oscuro', 'sistema'];
                        pref = order[(order.indexOf(pref) + 1) % order.length];
                    }
                    AzTheme.set(pref);
                });
                wrap.appendChild(b);
            }
            container.appendChild(wrap);
            syncSwitchers(preference());
        }
    };
    window.AzTheme = AzTheme;

    apply(preference());

    if (mq) {
        var onChange = function () { if (preference() === 'sistema') notify(apply('sistema')); };
        if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }

    document.addEventListener('DOMContentLoaded', function () {
        apply(preference());   // body ya existe: aplicar clase legacy
        var slot = document.querySelector('.topbar');
        if (slot) {
            var cta = document.getElementById('mainCta');
            var holder = document.createElement('div');
            holder.className = 'az-topbar-tools';
            if (cta) slot.insertBefore(holder, cta); else slot.appendChild(holder);
            AzTheme.mount(holder);
        }
    });
})();
