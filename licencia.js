/* ═══════════════════════════════════════════════════════════════════
   licencia.js — Licencias del CRM (Lote 9) · Azyvion CRM
   Compartido por login.html, register.html y dashboard.html.
   La regla real vive en el servidor (supabase/migrations/20261023_11_licencias.sql):
   sin licencia vigente la base de datos no entrega datos. Este archivo solo muestra
   el estado, el contacto de ventas y permite a un administrador activar una licencia.
   Se puede requerir desde Node (pruebas).
═══════════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';

    const CONTACTO = { telefono: '+502 5145 5610', correo: 'ventas@azyvion.com' };
    const SUPABASE_URL = 'https://dwtykzporgjjvdustjfq.supabase.co';
    const AVISO_DIAS = 15;   // a partir de cuántos días antes del vencimiento se avisa

    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    /** Igual que public.licencia_normalizar(): «azv ab12-cd34 ef56» → «AZV-AB12-CD34-EF56»; null si no es válida. */
    function normalizar(v) {
        const c = String(v == null ? '' : v).toUpperCase().replace(/[^0-9A-Z]/g, '');
        return c.length === 15 && c.indexOf('AZV') === 0 ? 'AZV-' + c.slice(3, 7) + '-' + c.slice(7, 11) + '-' + c.slice(11, 15) : null;
    }

    /** Da formato mientras se escribe (AZV-XXXX-XXXX-XXXX) sin perder lo que el usuario teclea. */
    function formatear(v) {
        let c = String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        if (c && 'AZV'.indexOf(c.slice(0, 3)) !== 0 && c.indexOf('AZV') !== 0) c = 'AZV' + c;
        c = c.slice(0, 15);
        const g = [c.slice(0, 3), c.slice(3, 7), c.slice(7, 11), c.slice(11, 15)].filter(Boolean);
        return g.join('-');
    }

    function enlaces(asunto) {
        const tel = CONTACTO.telefono.replace(/[^\d+]/g, '');
        const msg = asunto || 'Hola, quiero adquirir una licencia de Azyvion CRM.';
        return {
            tel: 'tel:' + tel,
            whatsapp: 'https://wa.me/' + tel.replace('+', '') + '?text=' + encodeURIComponent(msg),
            correo: 'mailto:' + CONTACTO.correo + '?subject=' + encodeURIComponent('Licencia Azyvion CRM') + '&body=' + encodeURIComponent(msg)
        };
    }

    /** Tarjeta con los datos de contacto de ventas. */
    function contactoHtml(titulo, mensaje, asunto) {
        const e = enlaces(asunto);
        return `<div class="lic-contacto" role="alert">
  <div class="lic-contacto-t">${esc(titulo || 'Necesitas una licencia')}</div>
  <div class="lic-contacto-m">${esc(mensaje || 'Para usar Azyvion CRM tu empresa necesita una licencia vigente. Contáctanos y te ayudamos:')}</div>
  <a class="lic-contacto-l" href="${e.whatsapp}" target="_blank" rel="noopener">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
    <span><strong>${esc(CONTACTO.telefono)}</strong><small>Llamar o escribir por WhatsApp</small></span></a>
  <a class="lic-contacto-l" href="${e.correo}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="22 6 12 13 2 6"/></svg>
    <span><strong>${esc(CONTACTO.correo)}</strong><small>Escribir un correo</small></span></a>
</div>`;
    }

    /** Texto del aviso de vencimiento (null si no hay que avisar). */
    function avisoVencimiento(mi) {
        if (!mi || !mi.vigente || mi.interna || mi.dias_restantes == null) return null;
        const d = Number(mi.dias_restantes);
        if (!(d <= AVISO_DIAS)) return null;
        const cuando = d <= 0 ? 'vence hoy' : d === 1 ? 'vence mañana' : 'vence en ' + d + ' días';
        return 'Tu licencia ' + cuando + '. Renuévala con ventas: ' + CONTACTO.telefono + ' · ' + CONTACTO.correo;
    }

    function tituloBloqueo(mi) {
        return mi && mi.motivo === 'VENCIDA' ? 'Tu licencia venció' : 'Tu empresa no tiene una licencia activa';
    }

    /** Llama a una función RPC con el token del usuario (login.html no carga supabase-js). */
    async function rpc(nombre, args, token, apikey) {
        const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + nombre, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: apikey || token, Authorization: 'Bearer ' + token },
            body: JSON.stringify(args || {})
        });
        let data = null; try { data = await r.json(); } catch (_) { /* sin cuerpo */ }
        if (!r.ok) return { error: { message: (data && (data.message || data.error)) || ('Error ' + r.status) } };
        return { data };
    }

    /** Formulario para que un administrador active una licencia nueva. onActivar(clave) → Promise<{error?}> */
    function montarActivacion(cont, onActivar) {
        if (!cont) return;
        cont.innerHTML = `<form class="lic-act" novalidate>
  <label class="lic-act-l" for="licActClave">¿Ya tienes un código de licencia? Actívalo aquí</label>
  <div class="lic-act-row">
    <input id="licActClave" class="lic-act-in" autocomplete="off" spellcheck="false" inputmode="latin" placeholder="AZV-XXXX-XXXX-XXXX" maxlength="18" aria-describedby="licActMsg">
    <button type="submit" class="lic-act-btn">Activar</button>
  </div>
  <div class="lic-act-msg" id="licActMsg" aria-live="polite"></div>
</form>`;
        const f = cont.querySelector('form'), inp = cont.querySelector('input'), btn = cont.querySelector('button'), msg = cont.querySelector('.lic-act-msg');
        inp.addEventListener('input', () => { inp.value = formatear(inp.value); });
        f.addEventListener('submit', async ev => {
            ev.preventDefault();
            const clave = normalizar(inp.value);
            if (!clave) { msg.textContent = 'Escribe el código completo: AZV-XXXX-XXXX-XXXX.'; msg.className = 'lic-act-msg err'; return; }
            btn.disabled = true; btn.textContent = 'Activando…'; msg.textContent = ''; msg.className = 'lic-act-msg';
            let r;
            try { r = await onActivar(clave); } catch (e) { r = { error: { message: 'Error de conexión. Intenta de nuevo.' } }; }
            btn.disabled = false; btn.textContent = 'Activar';
            if (r && r.error) { msg.textContent = r.error.message || 'No se pudo activar la licencia.'; msg.className = 'lic-act-msg err'; return; }
            msg.textContent = 'Licencia activada. Entrando…'; msg.className = 'lic-act-msg ok';
        });
    }

    const CSS = `
.lic-contacto{border:1px solid var(--az-border,#E2E8F0);border-radius:12px;padding:16px;background:var(--az-surface,#fff);color:var(--az-text,#172B4D);text-align:left}
.lic-contacto-t{font-weight:700;font-size:15px;margin-bottom:4px}
.lic-contacto-m{font-size:13px;color:var(--az-text-2,#5B6B80);line-height:1.45;margin-bottom:12px}
.lic-contacto-l{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;border:1px solid var(--az-border,#E2E8F0);text-decoration:none;color:inherit;margin-top:8px;background:var(--az-surface-2,#F5F7FA)}
.lic-contacto-l:hover{border-color:var(--az-primary,#1F5F99)}
.lic-contacto-l svg{width:20px;height:20px;flex:none;fill:none;stroke:var(--az-primary,#1F5F99);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lic-contacto-l strong{display:block;font-size:14px}
.lic-contacto-l small{display:block;font-size:12px;color:var(--az-text-2,#5B6B80)}
.lic-act{margin-top:14px;text-align:left}
.lic-act-l{display:block;font-size:12.5px;font-weight:600;color:var(--az-text-2,#5B6B80);margin-bottom:6px}
.lic-act-row{display:flex;gap:8px}
.lic-act-in{flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--az-border,#E2E8F0);font:600 14px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;background:var(--az-surface,#fff);color:var(--az-text,#172B4D)}
.lic-act-btn{padding:10px 16px;border-radius:10px;border:0;background:var(--az-primary,#1F5F99);color:#fff;font-weight:700;cursor:pointer}
.lic-act-btn:disabled{opacity:.6;cursor:default}
.lic-act-msg{font-size:12.5px;min-height:18px;margin-top:6px}
.lic-act-msg.err{color:var(--az-danger,#C0392B)}.lic-act-msg.ok{color:var(--az-success,#16845B)}
.lic-bloqueo{position:fixed;inset:0;z-index:100000;background:var(--az-overlay,rgba(10,20,40,.72));display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
.lic-bloqueo-box{width:min(440px,100%);background:var(--az-surface,#fff);border-radius:16px;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.lic-bloqueo-box .lic-contacto{border:0;padding:0}
.lic-bloqueo-salir{margin-top:14px;width:100%;padding:10px;border-radius:10px;border:1px solid var(--az-border,#E2E8F0);background:transparent;color:var(--az-text-2,#5B6B80);font-weight:600;cursor:pointer}
.lic-aviso{display:flex;align-items:center;gap:10px;padding:9px 14px;background:var(--az-warning-soft,#FFF4E5);color:var(--az-text,#172B4D);font-size:13px;border-bottom:1px solid var(--az-border,#E2E8F0)}
.lic-aviso button{margin-left:auto;background:none;border:0;font-size:18px;line-height:1;cursor:pointer;color:inherit}
.lic-adm{padding:16px}
.lic-adm-head{display:flex;flex-direction:column;gap:2px;margin-bottom:12px}
.lic-adm-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;align-items:end}
.lic-adm-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--az-text-2,#5B6B80)}
.lic-adm-form small{font-weight:400}
.lic-adm-notas{grid-column:span 2}
.lic-adm-form .btn-primary{height:40px}
.lic-adm-nuevas{margin-top:14px;padding:12px;border-radius:10px;background:var(--az-success-soft,#E7F6EF)}
.lic-adm-nueva{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:8px}
.lic-adm-nueva code,.lic-adm-clave{font:600 13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.03em}
.lic-adm-clave{cursor:copy;white-space:nowrap}
.lic-adm-tool{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.lic-adm-q{max-width:260px}
@media(max-width:640px){.lic-adm-notas{grid-column:auto}.lic-adm-q{max-width:none;width:100%}}`;
    function estilos() {
        if (typeof document === 'undefined' || document.getElementById('licCss')) return;
        const st = document.createElement('style'); st.id = 'licCss'; st.textContent = CSS; document.head.appendChild(st);
    }

    /** Panel: pantalla de bloqueo (sin licencia) con contacto y, si es administrador, activación. */
    function mostrarBloqueo(mi, opts) {
        estilos(); opts = opts || {};
        let ov = document.getElementById('licBloqueo');
        if (!ov) { ov = document.createElement('div'); ov.id = 'licBloqueo'; ov.className = 'lic-bloqueo'; document.body.appendChild(ov); }
        ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', tituloBloqueo(mi));
        ov.innerHTML = `<div class="lic-bloqueo-box">${contactoHtml(tituloBloqueo(mi),
            mi && mi.puede_activar ? 'Para seguir usando el CRM activa una licencia nueva o contáctanos:' : 'Pide a tu administrador que active una licencia, o contáctanos:',
            'Hola, necesito renovar la licencia de Azyvion CRM.')}
          <div id="licBloqueoAct"></div>
          <button type="button" class="lic-bloqueo-salir" id="licBloqueoSalir">Cerrar sesión</button></div>`;
        if (mi && mi.puede_activar && opts.activar) montarActivacion(document.getElementById('licBloqueoAct'), opts.activar);
        document.getElementById('licBloqueoSalir').onclick = opts.salir || function () { location.href = 'login.html?logout=1'; };
        const inp = ov.querySelector('input'); (inp || ov.querySelector('a')).focus();
    }

    function mostrarAviso(texto) {
        if (!texto || typeof document === 'undefined' || document.getElementById('licAviso')) return;
        estilos();
        const d = document.createElement('div'); d.id = 'licAviso'; d.className = 'lic-aviso'; d.setAttribute('role', 'status');
        d.innerHTML = '<span>⏳</span><span>' + esc(texto) + '</span><button type="button" aria-label="Cerrar aviso">×</button>';
        d.querySelector('button').onclick = () => d.remove();
        const main = document.querySelector('.main') || document.body;
        main.insertBefore(d, main.firstChild);
    }

    /** Dashboard: consulta mi_licencia y bloquea o avisa. sb = cliente supabase-js con sesión. */
    async function verificarPanel(sb, opts) {
        if (!sb) return null;
        opts = opts || {};
        let r;
        try { r = await sb.rpc('mi_licencia'); } catch (e) { return null; }
        if (r.error || !r.data) return null;             // error de red: el servidor igual protege los datos
        const mi = r.data;
        root.LICENCIA_ACTUAL = mi;
        if (!mi.vigente) {
            mostrarBloqueo(mi, {
                salir: opts.salir,
                activar: async clave => {
                    const a = await sb.rpc('licencia_activar', { p_clave: clave });
                    if (a.error) return a;
                    setTimeout(() => location.reload(), 600);
                    return {};
                }
            });
        } else {
            mostrarAviso(avisoVencimiento(mi));
        }
        return mi;
    }

    const api = { CONTACTO, AVISO_DIAS, normalizar, formatear, enlaces, contactoHtml, avisoVencimiento, tituloBloqueo, rpc,
        montarActivacion, mostrarBloqueo, mostrarAviso, verificarPanel, estilos };
    root.Licencia = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
