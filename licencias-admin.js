/* ═══════════════════════════════════════════════════════════════════
   licencias-admin.js — SaaS › Licencias (solo súper admin) · Lote 9 · Azyvion CRM
   Generar, asignar, editar, revocar y restaurar licencias. Todas las escrituras pasan por
   public.licencia_admin() (verifica el súper admin y deja auditoría en sub_auditoria).
═══════════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';

    const ESTADOS = {
        DISPONIBLE: { t: 'Disponible', c: 'tag-accent' }, ASIGNADA: { t: 'En uso', c: 'tag-success' },
        REVOCADA: { t: 'Revocada', c: 'tag-perdido' }, REEMPLAZADA: { t: 'Reemplazada', c: 'tag-gray' }
    };
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hoy = () => { const d = new Date(Date.now() - 6 * 3600 * 1000); return d.toISOString().slice(0, 10); };   // Guatemala

    /** Estado que se muestra: una licencia en uso con fecha pasada se ve como «Vencida». */
    function estadoVisible(l, hoyStr) {
        if (l.estado === 'ASIGNADA' && l.vence_en && l.vence_en < (hoyStr || hoy())) return { t: 'Vencida', c: 'tag-perdido' };
        return ESTADOS[l.estado] || { t: l.estado, c: 'tag-gray' };
    }
    function filtrar(lista, filtro, q, hoyStr) {
        q = String(q || '').trim().toLowerCase();
        return (lista || []).filter(l => {
            if (filtro === 'VENCIDA') { if (!(l.estado === 'ASIGNADA' && l.vence_en && l.vence_en < (hoyStr || hoy()))) return false; }
            else if (filtro && filtro !== 'TODAS' && l.estado !== filtro) return false;
            if (!q) return true;
            return [l.clave, l.empresa_nombre, l.organization_id, l.plan_nombre, l.notas].some(v => String(v || '').toLowerCase().indexOf(q) >= 0);
        });
    }
    function enlaceRegistro(clave, base) {
        return String(base || '').replace(/[^/]*$/, '') + 'register.html?licencia=' + encodeURIComponent(clave);
    }

    const S = { lista: [], empresas: [], planes: [], filtro: 'TODAS', q: '', el: null, nuevas: [] };
    const sb = () => root._sb;

    async function cargar() {
        const [l, e, p] = await Promise.all([
            sb().from('licencias').select('*, sub_empresas(nombre), sub_planes(nombre)').order('creada_en', { ascending: false }),
            sb().from('sub_empresas').select('id, nombre, estado').order('nombre'),
            sb().from('sub_planes').select('id, nombre, max_usuarios').order('precio')
        ]);
        if (l.error) throw l.error;
        S.lista = (l.data || []).map(x => Object.assign(x, { empresa_nombre: x.sub_empresas && x.sub_empresas.nombre, plan_nombre: x.sub_planes && x.sub_planes.nombre }));
        S.empresas = (e.data || []).filter(x => x.estado !== 'INTERNAL');
        S.planes = p.data || [];
    }

    async function accion(nombre, datos, okMsg) {
        const r = await sb().rpc('licencia_admin', { p_accion: nombre, p_datos: datos });
        if (r.error) { aviso(r.error.message, true); return null; }
        if (okMsg) aviso(okMsg);
        await refrescar();
        return r.data;
    }
    function aviso(m, error) { if (typeof showToast === 'function') showToast(m, error ? '#FF453A' : '#30D158'); }

    function copiar(txt) {
        try { navigator.clipboard.writeText(txt).then(() => aviso('Copiado')); } catch (_) { aviso(txt); }
    }

    function render() {
        const el = S.el; if (!el) return;
        const lista = filtrar(S.lista, S.filtro, S.q);
        const cuenta = f => filtrar(S.lista, f, '').length;
        const optPlan = S.planes.map(p => `<option value="${esc(p.id)}" data-max="${p.max_usuarios}">${esc(p.nombre)} · ${p.max_usuarios} usuarios</option>`).join('');
        el.innerHTML = `
<div class="card lic-adm">
  <div class="lic-adm-head"><strong>Generar licencias</strong><span class="cell-sub" style="margin:0">El cliente usa el código al registrarse o lo activa desde el CRM cuando la suya vence.</span></div>
  <form class="lic-adm-form" id="licGenForm">
    <label>Plan<select class="form-select" id="licGenPlan"><option value="">Sin plan</option>${optPlan}</select></label>
    <label>Usuarios máx.<input class="form-input" id="licGenMax" type="number" min="1" max="100000" placeholder="Según plan"></label>
    <label>Vence<input class="form-input" id="licGenVence" type="date" min="${hoy()}"><small>Vacío = sin vencimiento</small></label>
    <label>Cantidad<input class="form-input" id="licGenCant" type="number" min="1" max="50" value="1"></label>
    <label class="lic-adm-notas">Notas<input class="form-input" id="licGenNotas" maxlength="500" placeholder="Ej. Cliente Distribuidora Norte, factura 1234"></label>
    <button class="btn-primary" type="submit">Generar</button>
  </form>
  ${S.nuevas.length ? `<div class="lic-adm-nuevas"><div><strong>Licencias nuevas</strong> — envíalas al cliente:</div>${S.nuevas.map(c => `
    <div class="lic-adm-nueva"><code>${esc(c)}</code>
      <button class="section-action" onclick="LicenciasAdmin.copiar('${esc(c)}')">Copiar código</button>
      <button class="section-action" onclick="LicenciasAdmin.copiar(LicenciasAdmin.enlaceRegistro('${esc(c)}', location.href))">Copiar enlace de registro</button></div>`).join('')}</div>` : ''}
</div>
<div class="card" style="margin-top:14px">
  <div class="table-toolbar lic-adm-tool">
    <div class="filter-tabs">${[['TODAS', 'Todas'], ['DISPONIBLE', 'Disponibles'], ['ASIGNADA', 'En uso'], ['VENCIDA', 'Vencidas'], ['REVOCADA', 'Revocadas'], ['REEMPLAZADA', 'Reemplazadas']]
        .map(([k, t]) => `<button class="filter-tab${S.filtro === k ? ' active' : ''}" onclick="LicenciasAdmin.filtro('${k}')">${t} <span class="cell-sub" style="margin:0">${cuenta(k)}</span></button>`).join('')}</div>
    <input class="form-input lic-adm-q" id="licAdmQ" placeholder="Buscar clave, empresa o nota" value="${esc(S.q)}" oninput="LicenciasAdmin.buscar(this.value)">
  </div>
  <div class="table-scroll"><table class="data-table">
    <thead><tr><th>Clave</th><th>Estado</th><th>Empresa</th><th>Plan</th><th class="cell-num">Usuarios</th><th>Vence</th><th>Notas</th><th></th></tr></thead>
    <tbody>${lista.length ? lista.map(fila).join('') : '<tr><td colspan="8" class="empty-cell">Sin licencias con este filtro</td></tr>'}</tbody>
  </table></div>
</div>
<div id="licAdmDlg"></div>`;
        const f = document.getElementById('licGenForm');
        f.onsubmit = async ev => {
            ev.preventDefault();
            const btn = f.querySelector('button'); btn.disabled = true;
            const d = await accion('generar', { plan_id: v('licGenPlan'), max_usuarios: v('licGenMax'), vence_en: v('licGenVence'), cantidad: v('licGenCant') || '1', notas: v('licGenNotas') });
            btn.disabled = false;
            if (d) { S.nuevas = d.claves || []; render(); aviso(S.nuevas.length + ' licencia(s) generada(s)'); }
        };
        const q = document.getElementById('licAdmQ');
        if (S._foco) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); S._foco = false; }
    }
    const v = id => { const e = document.getElementById(id); return e ? String(e.value || '').trim() : ''; };

    function fila(l) {
        const e = estadoVisible(l);
        const venc = l.vence_en ? (typeof fechaCorta === 'function' ? fechaCorta(l.vence_en + 'T12:00:00') : l.vence_en) : 'Sin vencimiento';
        const acciones = [];
        acciones.push(`<button class="section-action" onclick="LicenciasAdmin.editar('${l.id}')">Editar</button>`);
        if (l.estado === 'DISPONIBLE') acciones.push(`<button class="section-action" onclick="LicenciasAdmin.asignar('${l.id}')">Asignar</button>`);
        if (l.estado === 'DISPONIBLE' || l.estado === 'ASIGNADA') acciones.push(`<button class="btn-danger-sm" onclick="LicenciasAdmin.revocar('${l.id}')">Revocar</button>`);
        if (l.estado === 'REVOCADA') acciones.push(`<button class="btn-success-sm" onclick="LicenciasAdmin.restaurar('${l.id}')">Restaurar</button>`);
        return `<tr>
      <td><code class="lic-adm-clave" title="Copiar" onclick="LicenciasAdmin.copiar('${esc(l.clave)}')">${esc(l.clave)}</code></td>
      <td><span class="tag ${e.c}">${e.t}</span></td>
      <td>${l.organization_id ? esc(l.empresa_nombre || l.organization_id) : '<span class="cell-sub" style="margin:0">—</span>'}</td>
      <td>${esc(l.plan_nombre || '—')}</td>
      <td class="cell-num">${l.max_usuarios}</td>
      <td>${esc(venc)}</td>
      <td><div class="cell-clip" title="${esc(l.notas)}">${esc(l.notas) || '—'}</div></td>
      <td><div class="row-actions">${acciones.join('')}</div></td></tr>`;
    }

    function dialogo(titulo, cuerpo, onOk, okTxt) {
        const d = document.getElementById('licAdmDlg');
        d.innerHTML = `<div class="lic-bloqueo" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><div class="lic-bloqueo-box">
          <div class="section-title" style="margin-bottom:12px">${esc(titulo)}</div>${cuerpo}
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
            <button class="btn-ghost" type="button" id="licDlgNo">Cancelar</button><button class="btn-primary" type="button" id="licDlgSi">${esc(okTxt || 'Guardar')}</button></div></div></div>`;
        const cerrar = () => { d.innerHTML = ''; };
        document.getElementById('licDlgNo').onclick = cerrar;
        document.getElementById('licDlgSi').onclick = async () => { const b = document.getElementById('licDlgSi'); b.disabled = true; const ok = await onOk(); if (ok !== false) cerrar(); else b.disabled = false; };
        const i = d.querySelector('input,select'); if (i) i.focus();
    }
    const porId = id => S.lista.find(x => x.id === id);

    const api = {
        ESTADOS, estadoVisible, filtrar, enlaceRegistro, copiar,
        async render(el) {
            S.el = el; if (window.Licencia) window.Licencia.estilos();
            el.innerHTML = '<div class="card" style="padding:20px">Cargando licencias…</div>';
            try { await cargar(); render(); }
            catch (e) { el.innerHTML = '<div class="card" style="padding:20px">No se pudieron cargar las licencias: ' + esc(e.message || e) + '</div>'; }
        },
        filtro(f) { S.filtro = f; render(); },
        buscar(q) { S.q = q; S._foco = true; render(); },
        editar(id) {
            const l = porId(id); if (!l) return;
            dialogo('Editar ' + l.clave, `
              <div class="form-field"><label class="form-label">USUARIOS MÁXIMOS</label><input class="form-input" id="licEdMax" type="number" min="1" value="${l.max_usuarios}"></div>
              <div class="form-field"><label class="form-label">VENCE</label><input class="form-input" id="licEdVence" type="date" value="${esc(l.vence_en || '')}"><div class="cell-sub">Vacío = sin vencimiento. Para renovar, pon una fecha futura.</div></div>
              <div class="form-field"><label class="form-label">NOTAS</label><input class="form-input" id="licEdNotas" maxlength="500" value="${esc(l.notas)}"></div>`,
                async () => !!(await accion('editar', { id, max_usuarios: v('licEdMax'), vence_en: v('licEdVence'), notas: v('licEdNotas') }, 'Licencia actualizada')));
        },
        asignar(id) {
            const l = porId(id); if (!l) return;
            dialogo('Asignar ' + l.clave, `<div class="form-field"><label class="form-label">EMPRESA</label><select class="form-select" id="licAsEmp"><option value="">Seleccione…</option>${S.empresas.map(e => `<option value="${esc(e.id)}">${esc(e.nombre)} (${esc(e.id)})</option>`).join('')}</select></div>
              <div class="cell-sub">Si la empresa ya tiene una licencia en uso, esa queda como «Reemplazada».</div>`,
                async () => { if (!v('licAsEmp')) { aviso('Elija la empresa', true); return false; } return !!(await accion('asignar', { id, organization_id: v('licAsEmp') }, 'Licencia asignada')); }, 'Asignar');
        },
        revocar(id) {
            const l = porId(id); if (!l) return;
            dialogo('Revocar ' + l.clave, `<div class="notes-box">${l.organization_id ? `<strong>${esc(l.empresa_nombre || l.organization_id)}</strong> perderá el acceso de inmediato (todas sus cuentas) y verá los datos de contacto de ventas.` : 'La licencia dejará de poder usarse para registrarse.'} Se puede restaurar después.</div>`,
                async () => !!(await accion('revocar', { id }, 'Licencia revocada')), 'Revocar');
        },
        async restaurar(id) { await accion('restaurar', { id }, 'Licencia restaurada'); }
    };
    async function refrescar() { try { await cargar(); render(); } catch (e) { aviso(e.message || String(e), true); } }

    root.LicenciasAdmin = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
