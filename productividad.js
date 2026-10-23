/* ═══════════════════════════════════════════════════════════════════
   productividad.js — Tareas, calendario, recordatorios, plantillas de mensajes e
   importación CSV · Azyvion CRM (Lote 7)
   Páginas dinámicas (#page-tareas, #page-plantillas, #page-importar).
   Permisos y validaciones viven en el servidor (20261023_09_crm_productividad.sql);
   aquí solo se capturan datos y se muestran resultados reales. Usa posDlg (pos.js).
═══════════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    const E = s => (typeof escHtml === 'function' ? escHtml(s) : String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    const A = s => E(s).replace(/'/g, '&#39;');
    const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const sumDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const fechaLarga = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-GT', { weekday: 'short', day: 'numeric', month: 'short' }) : '—';
    const hora = h => h ? String(h).slice(0, 5) : '';
    const toast = (m, c) => { if (typeof showToast === 'function') showToast(m, c); };
    const ROJO = '#FF453A', AMBAR = '#FF9F0A', VERDE = '#30D158';

    /** Llama a un método de window.api y devuelve una promesa con la respuesta (nunca rechaza). */
    function call(nombre, arg) {
        return new Promise(resolve => {
            try {
                root.api.withSuccessHandler(r => resolve(r || { ok: false, error: 'Sin respuesta del servidor.' }))
                    .withFailureHandler(e => resolve({ ok: false, error: (e && e.message) || String(e), incierto: true }))[nombre](arg);
            } catch (e) { resolve({ ok: false, error: e.message }); }
        });
    }
    const loading = txt => `<div class="pos-empty">${E(txt || 'Cargando…')}</div>`;
    const errBox = r => `<div class="pos-alert err" style="display:block">${E((r && r.error) || 'Error desconocido')}</div>`;
    const sesion = () => { try { return JSON.parse(localStorage.getItem('azyvion_session') || '{}') || {}; } catch (e) { return {}; } };
    const yo = () => { const s = sesion(); return s.usuario || s.nombre || ''; };
    function empresa() { return (typeof EMPRESA !== 'undefined' && EMPRESA) || {}; }

    /* ── Contexto: privilegio (ADMIN/GERENTE) y lista de usuarios para asignar ── */
    let CTX = null;
    function contexto() {
        if (CTX) return Promise.resolve(CTX);
        return call('posMisPermisos').then(r => {
            CTX = { privilegiado: !!(r.ok && r.privilegiado), permisos: (r.ok && r.permisos) || {}, usuarios: [] };
            if (!CTX.privilegiado) return CTX;
            return call('getUsuarios').then(u => {
                CTX.usuarios = ((u && u.data) || []).filter(x => x.activo !== false && x.usuario).map(x => ({ usuario: x.usuario, nombre: x.nombre || x.usuario }));
                return CTX;
            });
        });
    }
    function opcionesResponsable(sel) {
        const lista = (CTX && CTX.usuarios.length) ? CTX.usuarios : [{ usuario: yo(), nombre: 'Yo' }];
        if (sel && !lista.some(u => u.usuario === sel)) lista.push({ usuario: sel, nombre: sel });
        return lista.map(u => `<option value="${A(u.usuario)}" ${u.usuario === (sel || yo()) ? 'selected' : ''}>${E(u.nombre)}${u.usuario === yo() ? ' (yo)' : ''}</option>`).join('');
    }

    /* ═════════════════════ TAREAS ═════════════════════ */
    const TAR = { vista: 'lista', equipo: false, filas: [], hoy: ymd(new Date()), mes: null };
    const PRIO_COLOR = { Alta: 'var(--az-danger, #FF453A)', Normal: 'var(--az-primary, #0A84FF)', Baja: 'var(--az-text-2, #8E8E93)' };

    function renderTareas() {
        const page = $('page-tareas'); if (!page) return;
        contexto().then(() => {
            page.innerHTML = `<div class="neg-wrap">
                <div class="neg-head"><h2>Tareas y recordatorios</h2><div class="pos-muted">Llamadas, visitas y pendientes con fecha. Las actividades con fecha de seguimiento de cada ficha también aparecen aquí.</div></div>
                <div class="neg-filtros">
                    <button type="button" class="pos-btn primary" onclick="Prod.tareaForm()">+ Nueva tarea</button>
                    ${CTX.privilegiado ? `<label class="pos-lbl"><input type="checkbox" id="tarEquipo" ${TAR.equipo ? 'checked' : ''} onchange="Prod.tarEquipo(this.checked)" /> Ver todo el equipo</label>` : ''}
                    <button type="button" class="pos-btn" id="prodAvisosBtn" onclick="Prod.activarAvisos()" style="${avisosDisponibles() && Notification.permission === 'default' ? '' : 'display:none'}">🔔 Activar avisos del navegador</button>
                </div>
                <div class="pos-tabs" role="tablist">
                    ${[['lista', 'Pendientes'], ['calendario', 'Calendario'], ['completadas', 'Completadas']].map(t => `<button type="button" role="tab" class="pos-tab ${TAR.vista === t[0] ? 'active' : ''}" onclick="Prod.tarVista('${t[0]}')">${t[1]}</button>`).join('')}
                </div>
                <div id="tarMeta"></div>
                <div id="tarBody">${loading()}</div></div>`;
            tarCargar();
            miMeta();
        });
    }
    /** Tarjeta «Mi meta del mes» (solo si el usuario tiene alguna meta asignada). */
    function miMeta() {
        call('crmMetasProgreso', {}).then(r => {
            const el = $('tarMeta'); if (!el || !r.ok) return;
            const m = (r.filas || []).find(x => x.usuario === yo());
            if (!m || !(Number(m.meta_ventas) || Number(m.meta_cotizaciones) || Number(m.meta_actividades))) { el.innerHTML = ''; return; }
            const Q = n => (root.PosCalc && root.PosCalc.fQ) ? root.PosCalc.fQ(n) : 'Q ' + Number(n || 0).toFixed(2);
            const barra = (lbl, real, meta, fmt) => {
                if (!Number(meta)) return '';
                const pct = Number(real) / Number(meta) * 100;
                return `<div style="flex:1;min-width:160px"><div class="pos-muted">${lbl}: <b>${fmt(real)}</b> / ${fmt(meta)} (${Math.round(pct)}%)</div><div class="prod-barra ${pct >= 100 ? 'ok' : ''}"><span style="width:${Math.min(pct, 100)}%"></span></div></div>`;
            };
            el.innerHTML = `<div class="neg-card" style="margin-bottom:12px"><div class="neg-card-t">Mi meta del mes</div><div style="display:flex;gap:16px;flex-wrap:wrap">
                ${barra('Ventas', m.ventas, m.meta_ventas, Q)}${barra('Cotizaciones aprobadas', m.cotizaciones, m.meta_cotizaciones, Q)}${barra('Actividades', m.actividades, m.meta_actividades, v => String(v))}</div></div>`;
        });
    }
    function tarVista(v) { TAR.vista = v; renderTareas(); }
    function tarEquipo(v) { TAR.equipo = !!v; tarCargar(); }
    function rangoCalendario() {
        const m = TAR.mes || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const ini = sumDias(m, -((m.getDay() + 6) % 7));            // lunes de la primera semana
        return [ini, sumDias(ini, 41)];
    }
    async function tarCargar() {
        const b = $('tarBody'); if (!b) return;
        b.innerHTML = loading();
        const arg = { soloMias: !TAR.equipo };
        if (TAR.vista === 'calendario') { const r = rangoCalendario(); arg.desde = ymd(r[0]); arg.hasta = ymd(r[1]); arg.completadas = true; }
        if (TAR.vista === 'completadas') { arg.completadas = true; arg.desde = ymd(sumDias(new Date(), -60)); }
        const r = await call('crmTareas', arg);
        if (!r.ok) { b.innerHTML = errBox(r); return; }
        TAR.hoy = r.hoy || ymd(new Date());
        TAR.filas = r.filas || [];
        b.innerHTML = TAR.vista === 'calendario' ? vistaCalendario() : (TAR.vista === 'completadas' ? vistaCompletadas() : vistaLista());
        if (TAR.vista === 'lista') actualizarBadge(TAR.equipo ? null : TAR.filas);
    }
    function filaTarea(t) {
        const vencida = !t.completada && t.fechaSeguimiento < TAR.hoy;
        const ref = t.refId ? `<a href="#" onclick="event.preventDefault();abrirFicha('${A(t.tipo)}','${A(t.refId)}')">${E(t.refNombre || t.tipo)}</a>` : '<span class="pos-muted">General</span>';
        return `<div class="prod-tarea ${t.completada ? 'hecha' : ''} ${vencida ? 'vencida' : ''}">
            <input type="checkbox" class="prod-check" ${t.completada ? 'checked' : ''} aria-label="Marcar como hecha: ${A(t.titulo)}" onchange="Prod.tareaCompletar('${A(t.id)}', this.checked)" />
            <div class="prod-tarea-main">
                <div class="prod-tarea-t"><span class="prod-prio" style="background:${PRIO_COLOR[t.prioridad] || PRIO_COLOR.Normal}" title="Prioridad ${A(t.prioridad)}"></span>${E(t.titulo || t.categoria)}</div>
                <div class="pos-muted">${E(t.categoria || '')} · ${ref} · ${fechaLarga(t.fechaSeguimiento)}${t.hora ? ' ' + hora(t.hora) : ''}${TAR.equipo || t.responsable !== yo() ? ' · ' + E(t.responsable) : ''}${vencida ? ' · <b class="prod-venc">vencida</b>' : ''}</div>
                ${t.descripcion ? `<div class="prod-tarea-d">${E(t.descripcion)}</div>` : ''}
            </div>
            <div class="pos-row-actions">
                ${t.completada ? '' : `<button type="button" class="pos-btn sm" onclick="Prod.tareaPosponer('${A(t.id)}', 1)" title="Mover a mañana">+1 día</button>`}
                <button type="button" class="pos-btn sm" onclick="Prod.tareaForm('${A(t.id)}')">Editar</button>
            </div></div>`;
    }
    function vistaLista() {
        const pend = TAR.filas.filter(t => !t.completada);
        if (!pend.length) return `<div class="pos-empty">No hay tareas pendientes. ✓</div>`;
        const en7 = ymd(sumDias(new Date(TAR.hoy + 'T12:00:00'), 7));
        const grupos = [
            ['Vencidas', pend.filter(t => t.fechaSeguimiento < TAR.hoy)],
            ['Hoy', pend.filter(t => t.fechaSeguimiento === TAR.hoy)],
            ['Próximos 7 días', pend.filter(t => t.fechaSeguimiento > TAR.hoy && t.fechaSeguimiento <= en7)],
            ['Más adelante', pend.filter(t => t.fechaSeguimiento > en7)]
        ];
        return grupos.filter(g => g[1].length).map(g => `<div class="neg-card"><div class="neg-card-t">${g[0]} <span class="pos-muted">(${g[1].length})</span></div>${g[1].map(filaTarea).join('')}</div>`).join('');
    }
    function vistaCompletadas() {
        const hechas = TAR.filas.filter(t => t.completada).sort((a, b) => String(b.completada_en).localeCompare(String(a.completada_en)));
        return hechas.length ? `<div class="neg-card"><div class="neg-card-t">Completadas en los últimos 60 días</div>${hechas.map(filaTarea).join('')}</div>` : '<div class="pos-empty">Aún no hay tareas completadas.</div>';
    }
    function vistaCalendario() {
        const m = TAR.mes || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const ini = rangoCalendario()[0];
        const porDia = {};
        TAR.filas.forEach(t => { (porDia[t.fechaSeguimiento] = porDia[t.fechaSeguimiento] || []).push(t); });
        let celdas = '';
        for (let i = 0; i < 42; i++) {
            const d = sumDias(ini, i), k = ymd(d), lst = porDia[k] || [];
            const fuera = d.getMonth() !== m.getMonth();
            celdas += `<div class="prod-dia ${fuera ? 'fuera' : ''} ${k === TAR.hoy ? 'hoy' : ''}" onclick="Prod.tareaForm(null, '${k}')" title="Nueva tarea el ${A(fechaLarga(k))}">
                <div class="prod-dia-n">${d.getDate()}</div>
                ${lst.slice(0, 3).map(t => `<div class="prod-ev ${t.completada ? 'hecha' : ''} ${!t.completada && k < TAR.hoy ? 'vencida' : ''}" onclick="event.stopPropagation();Prod.tareaForm('${A(t.id)}')" title="${A(t.titulo)}">${t.hora ? hora(t.hora) + ' ' : ''}${E(t.titulo)}</div>`).join('')}
                ${lst.length > 3 ? `<div class="pos-muted" style="font-size:11px">+${lst.length - 3} más</div>` : ''}</div>`;
        }
        const t0 = m.toLocaleDateString('es-GT', { month: 'long', year: 'numeric' });
        const titulo = t0.charAt(0).toUpperCase() + t0.slice(1);     // «Octubre de 2026» (no «Octubre De»)
        return `<div class="neg-card"><div class="prod-cal-head">
                <button type="button" class="pos-btn sm" onclick="Prod.calMover(-1)" aria-label="Mes anterior">‹</button>
                <b>${E(titulo)}</b>
                <button type="button" class="pos-btn sm" onclick="Prod.calMover(1)" aria-label="Mes siguiente">›</button>
                <button type="button" class="pos-btn sm" onclick="Prod.calMover(0)">Hoy</button></div>
            <div class="prod-cal">${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => `<div class="prod-cal-dow">${d}</div>`).join('')}${celdas}</div>
            <div class="pos-muted" style="margin-top:6px">Toque un día para crear una tarea en esa fecha.</div></div>`;
    }
    function calMover(n) {
        const m = TAR.mes || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        TAR.mes = n === 0 ? null : new Date(m.getFullYear(), m.getMonth() + n, 1);
        tarCargar();
    }

    /** Formulario de tarea. ref = {tipo, refId, nombre} para crearla desde una ficha. */
    function tareaForm(id, fecha, ref) {
        contexto().then(() => {
            const t = id ? (TAR.filas.find(x => x.id === id) || null) : null;
            if (id && !t) { toast('No se encontró la tarea; actualice la lista', AMBAR); return; }
            const r = ref || (t && t.refId ? { tipo: t.tipo, refId: t.refId, nombre: t.refNombre } : null);
            posDlg(t ? 'Editar tarea' : 'Nueva tarea', `
                ${r ? `<div class="pos-muted" style="margin-bottom:8px">Para: <b>${E(r.nombre || r.tipo)}</b> (${E(r.tipo)})</div>` : ''}
                <label class="pos-lbl">¿Qué hay que hacer? <input class="pos-in" id="tfTitulo" maxlength="200" value="${A(t ? t.titulo : '')}" placeholder="Ej.: Llamar para confirmar el pedido" /></label>
                <div class="pos-grid2">
                    <label class="pos-lbl">Fecha <input class="pos-in" type="date" id="tfFecha" value="${A(t ? t.fechaSeguimiento : (fecha || TAR.hoy || ymd(new Date())))}" /></label>
                    <label class="pos-lbl">Hora (opcional) <input class="pos-in" type="time" id="tfHora" value="${A(t ? hora(t.hora) : '')}" /></label>
                    <label class="pos-lbl">Tipo <select class="pos-in" id="tfCat">${['Tarea', 'Llamada', 'Reunión', 'Visita', 'Seguimiento', 'Correo', 'WhatsApp', 'Otro'].map(c => `<option ${t && t.categoria === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
                    <label class="pos-lbl">Prioridad <select class="pos-in" id="tfPrio">${['Normal', 'Alta', 'Baja'].map(c => `<option ${(t ? t.prioridad : 'Normal') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
                </div>
                <label class="pos-lbl">Responsable <select class="pos-in" id="tfResp" ${CTX.privilegiado ? '' : 'disabled'}>${opcionesResponsable(t ? t.responsable : yo())}</select></label>
                <label class="pos-lbl">Notas <textarea class="pos-in" id="tfDesc" rows="3" maxlength="2000">${E(t ? t.descripcion : '')}</textarea></label>
                <div class="pos-alert err" id="tfMsg" style="display:none"></div>
                <div class="pos-cobro-foot">
                    ${t ? `<button type="button" class="pos-btn" onclick="Prod.tareaCompletar('${A(t.id)}', ${!t.completada}, true)">${t.completada ? 'Reabrir' : 'Marcar como hecha'}</button>` : ''}
                    <button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button>
                    <button type="button" class="pos-btn primary" id="tfOk" onclick="Prod.tareaGuardar(${t ? `'${A(t.id)}'` : 'null'})">Guardar</button>
                </div>`);
            TAR._ref = t ? null : r;
            setTimeout(() => { const el = $('tfTitulo'); if (el) el.focus(); }, 50);
        });
    }
    async function tareaGuardar(id) {
        const btn = $('tfOk'); if (btn) { if (btn.disabled) return; btn.disabled = true; }
        const v = k => ($(k) || {}).value || '';
        const datos = { titulo: v('tfTitulo'), fechaSeguimiento: v('tfFecha'), hora: v('tfHora'), categoria: v('tfCat'), prioridad: v('tfPrio'), responsable: v('tfResp'), descripcion: v('tfDesc') };
        let r;
        if (id) r = await call('updateTarea', Object.assign({ id: id }, datos));
        else r = await call('addTarea', Object.assign(datos, TAR._ref ? { tipo: TAR._ref.tipo, refId: TAR._ref.refId } : { tipo: 'General' }));
        if (!r.ok) { const m = $('tfMsg'); if (m) { m.textContent = r.error; m.style.display = 'block'; } if (btn) btn.disabled = false; return; }
        posDlgCerrar();
        toast(id ? 'Tarea actualizada ✓' : 'Tarea creada ✓', VERDE);
        if (TAR._ref && typeof root.renderFicha === 'function' && typeof _currentPage !== 'undefined' && _currentPage === 'ficha') { try { root.abrirFicha(TAR._ref.tipo, TAR._ref.refId, true); } catch (e) { /* la ficha se refresca al volver */ } }
        TAR._ref = null;
        if ($('tarBody')) tarCargar(); else revisarRecordatorios();
    }
    async function tareaCompletar(id, valor, desdeDialogo) {
        const r = await call('updateTarea', { id: id, completada: !!valor });
        if (!r.ok) { toast(r.error, ROJO); if ($('tarBody')) tarCargar(); return; }
        if (desdeDialogo) posDlgCerrar();
        toast(valor ? 'Tarea completada ✓' : 'Tarea reabierta', VERDE);
        if ($('tarBody')) tarCargar();
        revisarRecordatorios();
    }
    async function tareaPosponer(id, dias) {
        const t = TAR.filas.find(x => x.id === id); if (!t) return;
        const base = t.fechaSeguimiento < TAR.hoy ? TAR.hoy : t.fechaSeguimiento;
        const r = await call('updateTarea', { id: id, fechaSeguimiento: ymd(sumDias(new Date(base + 'T12:00:00'), dias)) });
        if (!r.ok) { toast(r.error, ROJO); return; }
        toast('Tarea movida ✓', VERDE);
        tarCargar();
    }

    /* ── Recordatorios: insignia en el menú, aviso al entrar y avisos del navegador ── */
    const avisosDisponibles = () => typeof Notification !== 'undefined';
    function activarAvisos() {
        if (!avisosDisponibles()) { toast('Este navegador no admite avisos', AMBAR); return; }
        Notification.requestPermission().then(p => {
            toast(p === 'granted' ? 'Avisos activados ✓' : 'Los avisos quedaron bloqueados; puede activarlos en la configuración del navegador', p === 'granted' ? VERDE : AMBAR);
            const b = $('prodAvisosBtn'); if (b) b.style.display = 'none';
        });
    }
    function actualizarBadge(filas) {
        if (!filas) return;
        const hoy = TAR.hoy || ymd(new Date());
        const n = filas.filter(t => !t.completada && t.fechaSeguimiento <= hoy).length;
        ['navTareasBadge', 'bnTareasBadge'].forEach(id => { const b = $(id); if (b) { b.textContent = n > 99 ? '99+' : n; b.style.display = n ? '' : 'none'; } });
        return n;
    }
    function yaAvisado(clave) {
        try { const k = 'azy_aviso_' + clave; if (sessionStorage.getItem(k)) return true; sessionStorage.setItem(k, '1'); } catch (e) { /* sin almacenamiento: avisar igual */ }
        return false;
    }
    let primeraRevision = true;
    async function revisarRecordatorios() {
        const s = sesion();
        if (!s.token || (typeof root.esCajero === 'function' && root.esCajero())) return;
        const hoy = ymd(new Date());
        const r = await call('crmTareas', { soloMias: true, hasta: ymd(sumDias(new Date(), 1)) });
        if (!r.ok) return;
        TAR.hoy = r.hoy || hoy;
        const filas = r.filas || [];
        const n = actualizarBadge(filas);
        if (typeof root.renderOvAlertas === 'function') { try { root.renderOvAlertas(); } catch (e) { /* el inicio aún no está montado */ } }
        const vencidas = filas.filter(t => t.fechaSeguimiento < TAR.hoy).length;
        if (primeraRevision && n && !yaAvisado('resumen_' + TAR.hoy)) {
            toast(`Tienes ${n} tarea(s) para hoy${vencidas ? ' (' + vencidas + ' vencida(s))' : ''}. Revísalas en Tareas.`, vencidas ? AMBAR : '#0A84FF');
        }
        primeraRevision = false;
        // Aviso puntual de las tareas con hora en los próximos 15 minutos.
        const ahora = new Date();
        filas.filter(t => t.fechaSeguimiento === TAR.hoy && t.hora).forEach(t => {
            const cuando = new Date(TAR.hoy + 'T' + hora(t.hora) + ':00');
            const min = (cuando - ahora) / 60000;
            if (min <= 15 && min > -5 && !yaAvisado('t_' + t.id + '_' + TAR.hoy)) {
                const txt = hora(t.hora) + ' · ' + t.titulo + (t.refNombre ? ' — ' + t.refNombre : '');
                toast('⏰ ' + txt, AMBAR);
                if (avisosDisponibles() && Notification.permission === 'granted') {
                    try { new Notification('Recordatorio · Azyvion CRM', { body: txt, tag: 'azy-' + t.id, icon: 'logo-crm.png' }); } catch (e) { /* algunos móviles exigen service worker */ }
                }
            }
        });
    }

    /* ═════════════════════ PLANTILLAS Y MENSAJES ═════════════════════ */
    const VARIABLES = ['{nombre}', '{empresa}', '{mi_nombre}', '{mi_empresa}', '{fecha}'];
    const PLANTILLAS_BASE = [
        { id: 'base-1', nombre: 'Saludo', canal: 'WhatsApp', cuerpo: 'Hola {nombre}, le saluda {mi_nombre} de {mi_empresa}. ¿En qué le podemos ayudar hoy?', base: true },
        { id: 'base-2', nombre: 'Seguimiento de cotización', canal: 'WhatsApp', cuerpo: 'Hola {nombre}, ¿pudo revisar la cotización que le enviamos? Quedo atento a cualquier duda. — {mi_nombre}, {mi_empresa}', base: true },
        { id: 'base-3', nombre: 'Agradecimiento', canal: 'WhatsApp', cuerpo: '¡Gracias por su compra, {nombre}! Para {mi_empresa} es un gusto atenderle.', base: true },
        { id: 'base-4', nombre: 'Seguimiento', canal: 'Correo', asunto: 'Seguimiento — {mi_empresa}', cuerpo: 'Estimado(a) {nombre}:\n\nLe escribo para dar seguimiento a nuestra conversación. Quedo a sus órdenes.\n\nSaludos,\n{mi_nombre}\n{mi_empresa}', base: true }
    ];
    let PLANT = null;
    function cargarPlantillas(forzar) {
        if (PLANT && !forzar) return Promise.resolve(PLANT);
        return call('getPlantillas').then(r => { PLANT = r.ok ? r.data : []; PLANT._error = r.ok ? null : r.error; return PLANT; });
    }
    function plantillasUsables(canal) {
        const propias = (PLANT || []).filter(p => p.activo !== false && p.canal === canal);
        return propias.length ? propias : PLANTILLAS_BASE.filter(p => p.canal === canal);
    }
    function rellenar(txt, d) {
        const s = sesion();
        const vals = { nombre: d.nombre || '', empresa: d.empresa || '', mi_nombre: s.nombre || s.usuario || '', mi_empresa: empresa().nombre || '', fecha: new Date().toLocaleDateString('es-GT') };
        return String(txt || '').replace(/\{(nombre|empresa|mi_nombre|mi_empresa|fecha)\}/g, (m, k) => vals[k]);
    }

    function renderPlantillas() {
        const page = $('page-plantillas'); if (!page) return;
        page.innerHTML = `<div class="neg-wrap">${loading()}</div>`;
        Promise.all([contexto(), cargarPlantillas(true)]).then(() => {
            const lista = PLANT || [];
            const fila = p => `<tr><td><b>${E(p.nombre)}</b>${p.activo === false ? ' <span class="pos-muted">(inactiva)</span>' : ''}</td><td>${E(p.canal)}</td>
                <td class="pos-muted">${E(String(p.cuerpo).slice(0, 120))}${String(p.cuerpo).length > 120 ? '…' : ''}</td>
                <td>${CTX.privilegiado ? `<div class="pos-row-actions"><button type="button" class="pos-btn sm" onclick="Prod.plantillaForm('${A(p.id)}')">Editar</button><button type="button" class="pos-btn sm danger-o" onclick="Prod.plantillaBorrar('${A(p.id)}')">Eliminar</button></div>` : ''}</td></tr>`;
            page.innerHTML = `<div class="neg-wrap">
                <div class="neg-head"><h2>Plantillas de mensajes</h2><div class="pos-muted">Textos listos para WhatsApp y correo. Variables: ${VARIABLES.map(v => `<code>${v}</code>`).join(' ')}. Se usan desde la ficha del cliente o prospecto con el botón «Enviar mensaje», y cada envío queda en su historial.</div></div>
                ${PLANT._error ? errBox({ error: PLANT._error }) : ''}
                <div class="neg-filtros">${CTX.privilegiado ? '<button type="button" class="pos-btn primary" onclick="Prod.plantillaForm()">+ Nueva plantilla</button>' : '<span class="pos-muted">Solo un administrador o gerente puede crear o editar plantillas.</span>'}</div>
                ${lista.length ? `<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>Nombre</th><th>Canal</th><th>Texto</th><th></th></tr></thead><tbody>${lista.map(fila).join('')}</tbody></table></div>`
                    : `<div class="neg-card"><div class="neg-card-t">Aún no hay plantillas propias</div><div class="pos-muted">Mientras tanto se ofrecen estas plantillas de ejemplo:</div>${PLANTILLAS_BASE.map(p => `<div style="margin-top:8px"><b>${E(p.nombre)}</b> · ${E(p.canal)}<div class="pos-muted" style="white-space:pre-wrap">${E(p.cuerpo)}</div></div>`).join('')}</div>`}
            </div>`;
        });
    }
    function plantillaForm(id) {
        const p = id ? (PLANT || []).find(x => x.id === id) : null;
        posDlg(p ? 'Editar plantilla' : 'Nueva plantilla', `
            <div class="pos-grid2">
                <label class="pos-lbl">Nombre <input class="pos-in" id="plNombre" maxlength="80" value="${A(p ? p.nombre : '')}" /></label>
                <label class="pos-lbl">Canal <select class="pos-in" id="plCanal" onchange="document.getElementById('plAsuntoW').style.display=this.value==='Correo'?'':'none'">${['WhatsApp', 'Correo'].map(c => `<option ${p && p.canal === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
            </div>
            <label class="pos-lbl" id="plAsuntoW" style="${p && p.canal === 'Correo' ? '' : 'display:none'}">Asunto <input class="pos-in" id="plAsunto" maxlength="200" value="${A(p ? p.asunto || '' : '')}" /></label>
            <label class="pos-lbl">Texto <textarea class="pos-in" id="plCuerpo" rows="6" maxlength="4000" oninput="Prod.plantillaPrev()">${E(p ? p.cuerpo : '')}</textarea></label>
            <div class="pos-muted">Variables: ${VARIABLES.map(v => `<button type="button" class="pos-chip" onclick="Prod.insertarVar('${v}')">${v}</button>`).join(' ')}</div>
            <label class="pos-lbl"><input type="checkbox" id="plActivo" ${!p || p.activo !== false ? 'checked' : ''} /> Activa</label>
            <div class="neg-card" style="margin-top:8px"><div class="neg-card-t">Vista previa (cliente «Ana López»)</div><div id="plPrev" style="white-space:pre-wrap"></div></div>
            <div class="pos-alert err" id="plMsg" style="display:none"></div>
            <div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button>
                <button type="button" class="pos-btn primary" id="plOk" onclick="Prod.plantillaGuardar(${p ? `'${A(p.id)}'` : 'null'})">Guardar</button></div>`);
        plantillaPrev();
    }
    function insertarVar(v) {
        const ta = $('plCuerpo') || $('msgTexto'); if (!ta) return;
        const i = ta.selectionStart || ta.value.length;
        ta.value = ta.value.slice(0, i) + v + ta.value.slice(ta.selectionEnd || i);
        ta.focus(); plantillaPrev();
    }
    function plantillaPrev() { const pv = $('plPrev'); if (pv) pv.textContent = rellenar(($('plCuerpo') || {}).value, { nombre: 'Ana López', empresa: 'Comercial López' }); }
    async function plantillaGuardar(id) {
        const btn = $('plOk'); if (btn.disabled) return; btn.disabled = true;
        const r = await call('savePlantilla', { id: id || undefined, nombre: $('plNombre').value, canal: $('plCanal').value, asunto: $('plAsunto').value, cuerpo: $('plCuerpo').value, activo: $('plActivo').checked });
        if (!r.ok) { const m = $('plMsg'); m.textContent = r.error; m.style.display = 'block'; btn.disabled = false; return; }
        posDlgCerrar(); toast('Plantilla guardada ✓', VERDE); renderPlantillas();
    }
    async function plantillaBorrar(id) {
        if (!confirm('¿Eliminar esta plantilla?')) return;
        const r = await call('deletePlantilla', { id: id });
        if (!r.ok) { toast(r.error, ROJO); return; }
        toast('Plantilla eliminada', VERDE); renderPlantillas();
    }

    /** Redactor de mensajes. d = {tipo:'Cliente'|'Prospecto', refId, nombre, empresa, telefono, correo}. */
    const MSG = { d: null };
    function mensaje(d) {
        MSG.d = d || {};
        cargarPlantillas().then(() => {
            const canal = MSG.d.telefono ? 'WhatsApp' : 'Correo';
            posDlg('Enviar mensaje a ' + (MSG.d.nombre || ''), `
                <div class="pos-grid2">
                    <label class="pos-lbl">Canal <select class="pos-in" id="msgCanal" onchange="Prod.msgCanal()">${['WhatsApp', 'Correo'].map(c => `<option ${c === canal ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
                    <label class="pos-lbl">Plantilla <select class="pos-in" id="msgPlant" onchange="Prod.msgPlantilla()"></select></label>
                </div>
                <div class="pos-muted" id="msgDestino"></div>
                <label class="pos-lbl" id="msgAsuntoW">Asunto <input class="pos-in" id="msgAsunto" maxlength="200" /></label>
                <label class="pos-lbl">Mensaje <textarea class="pos-in" id="msgTexto" rows="6" maxlength="2000"></textarea></label>
                <div class="pos-muted">Se abrirá ${'WhatsApp o su programa de correo'} con el texto listo para que usted lo envíe. El envío queda registrado en el historial de la ficha.</div>
                <div class="pos-alert err" id="msgErr" style="display:none"></div>
                <div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button>
                    <button type="button" class="pos-btn primary" id="msgOk" onclick="Prod.msgEnviar()">Abrir y registrar</button></div>`);
            msgCanal();
        });
    }
    function msgCanal() {
        const canal = $('msgCanal').value;
        const lista = plantillasUsables(canal);
        $('msgPlant').innerHTML = '<option value="">— Texto libre —</option>' + lista.map(p => `<option value="${A(p.id)}">${E(p.nombre)}</option>`).join('');
        if (lista.length) $('msgPlant').value = lista[0].id;
        $('msgAsuntoW').style.display = canal === 'Correo' ? '' : 'none';
        const dest = canal === 'Correo' ? MSG.d.correo : MSG.d.telefono;
        $('msgDestino').innerHTML = dest ? 'Para: <b>' + E(dest) + '</b>' : `<span style="color:var(--az-danger,#FF453A)">Este contacto no tiene ${canal === 'Correo' ? 'correo' : 'teléfono'} registrado.</span>`;
        msgPlantilla();
    }
    function msgPlantilla() {
        const canal = $('msgCanal').value, id = $('msgPlant').value;
        const p = plantillasUsables(canal).find(x => x.id === id);
        if (!p) return;
        $('msgTexto').value = rellenar(p.cuerpo, MSG.d);
        $('msgAsunto').value = rellenar(p.asunto || '', MSG.d);
    }
    const telWa = t => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 8) d = '502' + d; return d.length >= 10 ? d : ''; };
    async function msgEnviar() {
        const canal = $('msgCanal').value, texto = $('msgTexto').value.trim(), asunto = $('msgAsunto').value.trim();
        const err = m => { const e = $('msgErr'); e.textContent = m; e.style.display = 'block'; };
        if (!texto) { err('Escriba el mensaje.'); return; }
        let url;
        if (canal === 'WhatsApp') { const n = telWa(MSG.d.telefono); if (!n) { err('El teléfono no es válido para WhatsApp (8 dígitos o con código de país).'); return; } url = 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto); }
        else { if (!MSG.d.correo) { err('Este contacto no tiene correo.'); return; } url = 'mailto:' + encodeURIComponent(MSG.d.correo) + '?subject=' + encodeURIComponent(asunto) + '&body=' + encodeURIComponent(texto); }
        // Se abre primero (los navegadores bloquean ventanas abiertas después de un await).
        if (canal === 'WhatsApp') root.open(url, '_blank', 'noopener'); else root.location.href = url;
        const sel = $('msgPlant'); const nombrePl = sel && sel.value ? sel.options[sel.selectedIndex].text : '';
        if (MSG.d.refId && (MSG.d.tipo === 'Cliente' || MSG.d.tipo === 'Prospecto')) {
            const r = await call('registrarMensaje', { tipo: MSG.d.tipo, refId: MSG.d.refId, canal: canal, plantilla: nombrePl || (canal === 'Correo' ? asunto : 'mensaje'), texto: texto });
            if (!r.ok) { toast('Se abrió el mensaje, pero no se pudo registrar en el historial: ' + r.error, AMBAR); posDlgCerrar(); return; }
        }
        posDlgCerrar();
        toast('Mensaje listo y registrado en el historial ✓', VERDE);
        if (typeof _currentPage !== 'undefined' && _currentPage === 'ficha' && MSG.d.refId) { try { root.abrirFicha(MSG.d.tipo, MSG.d.refId, true); } catch (e) { /* sin refresco */ } }
    }

    /* ═════════════════════ IMPORTACIÓN CSV ═════════════════════ */
    const CAMPOS = {
        clientes: [
            ['nombre', 'Nombre', ['nombre', 'cliente', 'nombre completo', 'name']],
            ['empresa', 'Empresa', ['empresa', 'compania', 'compañia', 'company']],
            ['nit', 'NIT', ['nit', 'rfc', 'nit cliente']],
            ['razonSocial', 'Razón social', ['razon social', 'razonsocial']],
            ['correo', 'Correo', ['correo', 'email', 'e-mail', 'correo electronico']],
            ['telefono', 'Teléfono', ['telefono', 'tel', 'celular', 'movil', 'whatsapp', 'phone']],
            ['direccion', 'Dirección', ['direccion', 'domicilio', 'address']],
            ['ciudad', 'Ciudad', ['ciudad', 'municipio', 'city']],
            ['segmento', 'Segmento', ['segmento']],
            ['tipoCliente', 'Tipo de cliente', ['tipo', 'tipo cliente', 'tipocliente']],
            ['fuente', 'Fuente', ['fuente', 'origen']],
            ['fecha_nacimiento', 'Fecha de nacimiento (AAAA-MM-DD)', ['fecha nacimiento', 'fecha de nacimiento', 'cumpleanos', 'nacimiento']]
        ],
        productos: [
            ['producto', 'Producto', ['producto', 'nombre', 'descripcion corta', 'articulo']],
            ['sku', 'SKU', ['sku', 'codigo', 'código', 'codigo interno']],
            ['codigo_barras', 'Código de barras', ['codigo de barras', 'codigo barras', 'barcode', 'ean', 'upc']],
            ['categoria', 'Categoría', ['categoria', 'category']],
            ['precioUnit', 'Precio de venta', ['precio', 'precio venta', 'precio de venta', 'precio unitario', 'preciounit', 'price']],
            ['costo_unit', 'Costo', ['costo', 'costo unitario', 'cost']],
            ['unidades', 'Existencias iniciales', ['existencias', 'stock', 'unidades', 'cantidad', 'inventario']],
            ['stock_minimo', 'Stock mínimo', ['stock minimo', 'minimo', 'stock_minimo']],
            ['unidad', 'Unidad de medida', ['unidad', 'unidad de medida', 'um']],
            ['tipo', 'Tipo (Producto/Servicio)', ['tipo']],
            ['descripcion', 'Descripción', ['descripcion', 'detalle', 'description']]
        ]
    };
    const IMP = { tipo: 'clientes', filas: [], cab: [], mapa: {}, archivo: '' };
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[_\s]+/g, ' ').trim();

    /** CSV con comillas, separador , o ; detectado, BOM y saltos de línea dentro de comillas. */
    function parseCSV(txt) {
        txt = String(txt || '').replace(/^﻿/, '');
        const primera = txt.split(/\r?\n/)[0] || '';
        const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : (primera.indexOf('\t') >= 0 && primera.indexOf(',') < 0 ? '\t' : ',');
        const filas = []; let fila = [], campo = '', comillas = false;
        for (let i = 0; i < txt.length; i++) {
            const c = txt[i];
            if (comillas) {
                if (c === '"') { if (txt[i + 1] === '"') { campo += '"'; i++; } else comillas = false; }
                else campo += c;
            } else if (c === '"') comillas = true;
            else if (c === sep) { fila.push(campo); campo = ''; }
            else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; fila.push(campo); campo = ''; if (fila.some(x => x.trim() !== '')) filas.push(fila); fila = []; }
            else campo += c;
        }
        fila.push(campo); if (fila.some(x => x.trim() !== '')) filas.push(fila);
        return filas;
    }
    function autoMapa(cab, tipo) {
        const mapa = {};
        CAMPOS[tipo].forEach(c => {
            const i = cab.findIndex(h => { const n = norm(h); return n === norm(c[0]) || c[2].some(a => norm(a) === n); });
            if (i >= 0) mapa[c[0]] = i;
        });
        return mapa;
    }
    function renderImportar() {
        const page = $('page-importar'); if (!page) return;
        page.innerHTML = `<div class="neg-wrap">
            <div class="neg-head"><h2>Importar datos</h2><div class="pos-muted">Cargue clientes o productos desde un archivo CSV (Excel → Guardar como → CSV). Primero se valida sin guardar nada; luego usted confirma.</div></div>
            <div class="pos-tabs" role="tablist">${[['clientes', 'Clientes'], ['productos', 'Productos']].map(t => `<button type="button" role="tab" class="pos-tab ${IMP.tipo === t[0] ? 'active' : ''}" onclick="Prod.impTipo('${t[0]}')">${t[1]}</button>`).join('')}</div>
            <div class="neg-card">
                <div class="neg-filtros">
                    <input type="file" id="impFile" accept=".csv,text/csv,.txt" onchange="Prod.impArchivo(this)" aria-label="Archivo CSV" />
                    <button type="button" class="pos-btn" onclick="Prod.impPlantilla()">Descargar plantilla CSV</button>
                </div>
                <div class="pos-muted">${IMP.tipo === 'clientes'
                    ? 'Se reconoce un cliente existente por NIT; si no tiene, por correo; si tampoco, por nombre exacto. Obligatorio: Nombre.'
                    : 'Se reconoce un producto existente por SKU; si no tiene, por código de barras; si tampoco, por nombre exacto. Obligatorio: Producto. Las existencias solo se cargan al crear el producto (quedan en el kardex como «Importación»).'}
                    Máximo 5000 filas por archivo.</div>
            </div>
            <div id="impBody"></div></div>`;
        if (IMP.filas.length) impVista();
    }
    function impTipo(t) { IMP.tipo = t; IMP.filas = []; IMP.cab = []; IMP.mapa = {}; renderImportar(); }
    function impPlantilla() {
        const cols = CAMPOS[IMP.tipo].map(c => c[1]);
        const ej = IMP.tipo === 'clientes' ? ['Ana López', 'Comercial López', '1234567-8', 'Comercial López S.A.', 'ana@ejemplo.com', '5555-1234', 'Zona 10', 'Guatemala', 'Estándar', 'Empresa', 'Referido', '1990-05-20']
            : ['Café molido 1 lb', 'CAF-001', '7401234567890', 'Abarrotes', '45.00', '28.50', '24', '6', 'Unidad', 'Producto', 'Café de altura'];
        const esc = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
        const blob = new Blob(['﻿' + cols.map(esc).join(',') + '\n' + ej.map(esc).join(',') + '\n'], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'plantilla_' + IMP.tipo + '.csv'; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    function impArchivo(inp) {
        const f = inp.files && inp.files[0]; if (!f) return;
        if (f.size > 5 * 1024 * 1024) { toast('El archivo supera 5 MB', ROJO); inp.value = ''; return; }
        const rd = new FileReader();
        rd.onload = () => {
            let txt = String(rd.result || '');
            if (txt.indexOf('�') >= 0) {           // no era UTF-8: reintentar como Windows-1252 (Excel en español)
                const rd2 = new FileReader(); rd2.onload = () => impProcesar(String(rd2.result || ''), f.name); rd2.readAsText(f, 'windows-1252'); return;
            }
            impProcesar(txt, f.name);
        };
        rd.readAsText(f, 'utf-8');
    }
    function impProcesar(txt, nombre) {
        const filas = parseCSV(txt);
        if (filas.length < 2) { $('impBody').innerHTML = errBox({ error: 'El archivo no tiene filas de datos (la primera fila deben ser los encabezados).' }); return; }
        if (filas.length - 1 > 5000) { $('impBody').innerHTML = errBox({ error: 'El archivo tiene ' + (filas.length - 1) + ' filas; el máximo es 5000. Divídalo en varios archivos.' }); return; }
        IMP.cab = filas[0].map(h => h.trim()); IMP.filas = filas.slice(1); IMP.archivo = nombre;
        IMP.mapa = autoMapa(IMP.cab, IMP.tipo);
        impVista();
    }
    function impVista() {
        const campos = CAMPOS[IMP.tipo];
        const sel = c => `<select class="pos-in sm2" onchange="Prod.impMapa('${c[0]}', this.value)"><option value="">— no importar —</option>${IMP.cab.map((h, i) => `<option value="${i}" ${IMP.mapa[c[0]] === i ? 'selected' : ''}>${E(h || 'Columna ' + (i + 1))}</option>`).join('')}</select>`;
        const muestra = IMP.filas.slice(0, 8).map(f => `<tr>${campos.filter(c => IMP.mapa[c[0]] !== undefined).map(c => `<td>${E(f[IMP.mapa[c[0]]] || '')}</td>`).join('')}</tr>`).join('');
        $('impBody').innerHTML = `<div class="neg-card"><div class="neg-card-t">${E(IMP.archivo)} · ${IMP.filas.length} fila(s)</div>
            <div class="pos-muted" style="margin-bottom:6px">Revise a qué columna del archivo corresponde cada dato:</div>
            <div class="prod-mapa">${campos.map(c => `<label class="pos-lbl">${E(c[1])}${c[0] === (IMP.tipo === 'clientes' ? 'nombre' : 'producto') ? ' *' : ''} ${sel(c)}</label>`).join('')}</div></div>
            <div class="neg-card"><div class="neg-card-t">Vista previa (primeras 8 filas)</div>
            <div class="pos-table-wrap"><table class="pos-table"><thead><tr>${campos.filter(c => IMP.mapa[c[0]] !== undefined).map(c => `<th>${E(c[1])}</th>`).join('')}</tr></thead><tbody>${muestra}</tbody></table></div></div>
            <div class="neg-filtros"><label class="pos-lbl"><input type="checkbox" id="impAct" /> Actualizar los registros que ya existen (si no, se omiten)</label>
                <button type="button" class="pos-btn" id="impVal" onclick="Prod.impEnviar(true)">1. Validar (sin guardar)</button>
                <button type="button" class="pos-btn primary" id="impOk" onclick="Prod.impEnviar(false)" disabled>2. Importar</button></div>
            <div id="impRes"></div>`;
    }
    function impMapa(campo, v) { if (v === '') delete IMP.mapa[campo]; else IMP.mapa[campo] = Number(v); impVista(); }
    function impFilasJson() {
        return IMP.filas.map(f => { const o = {}; Object.keys(IMP.mapa).forEach(k => { o[k] = String(f[IMP.mapa[k]] === undefined ? '' : f[IMP.mapa[k]]).trim(); }); return o; });
    }
    let impUltimaValidacion = null;
    async function impEnviar(simular) {
        const clave = IMP.tipo === 'clientes' ? 'nombre' : 'producto';
        if (IMP.mapa[clave] === undefined) { toast('Indique qué columna es «' + (clave === 'nombre' ? 'Nombre' : 'Producto') + '»', AMBAR); return; }
        const act = $('impAct').checked;
        const firma = JSON.stringify([IMP.tipo, IMP.mapa, act, IMP.filas.length]);
        if (!simular && impUltimaValidacion !== firma) { toast('Valide de nuevo: cambió el archivo, las columnas o la opción de actualizar', AMBAR); $('impOk').disabled = true; return; }
        if (!simular && !confirm('¿Importar ahora? Esta acción guarda los datos en su empresa.')) return;
        const bVal = $('impVal'), bOk = $('impOk'); bVal.disabled = true; bOk.disabled = true;
        $('impRes').innerHTML = loading(simular ? 'Validando…' : 'Importando…');
        const r = await call('crmImportar', { tipo: IMP.tipo, filas: impFilasJson(), actualizar: act, simular: simular });
        bVal.disabled = false;
        if (!r.ok) { $('impRes').innerHTML = errBox(r); impUltimaValidacion = null; return; }
        const errores = (r.detalleErrores || []).map(e => `<tr><td class="num">${e.fila + 1}</td><td>${E(e.error)}</td></tr>`).join('');
        $('impRes').innerHTML = `<div class="neg-card"><div class="neg-card-t">${simular ? 'Resultado de la validación (no se guardó nada)' : 'Importación terminada ✓'}</div>
            <div class="neg-kpis">${[['Nuevos', r.nuevos], ['Actualizados', r.actualizados], ['Omitidos (ya existían)', r.omitidos], ['Con errores', r.errores]].map(k => `<div class="neg-kpi"><div class="neg-kpi-l">${k[0]}</div><div class="neg-kpi-v">${Number(k[1] || 0)}</div></div>`).join('')}</div>
            ${r.nota ? `<div class="pos-muted">${E(r.nota)}</div>` : ''}
            ${errores ? `<div class="pos-muted" style="margin-top:8px">Las filas con error no se importan${r.errores > 200 ? ' (se muestran las primeras 200)' : ''}. La fila 1 es el encabezado.</div><div class="pos-table-wrap"><table class="pos-table"><thead><tr><th class="num">Fila</th><th>Error</th></tr></thead><tbody>${errores}</tbody></table></div>` : ''}</div>`;
        if (simular) { impUltimaValidacion = firma; bOk.disabled = !(Number(r.nuevos) + Number(r.actualizados) > 0); }
        else { impUltimaValidacion = null; toast(`Importación lista: ${r.nuevos} nuevo(s), ${r.actualizados} actualizado(s)`, VERDE); IMP.filas = []; if (typeof root.refreshCurrent === 'function') { try { root.refreshCurrent(true); } catch (e) { /* se verá al recargar */ } } }
    }

    /* ── Navegación ─────────────────────────────────────────────── */
    const PAGES = { tareas: renderTareas, plantillas: renderPlantillas, importar: renderImportar };
    function onShow(id) { if (PAGES[id]) PAGES[id](); }
    function init() {
        contexto().then(c => {
            ['nav-plantillas', 'nav-importar'].forEach(id => { const el = $(id); if (el) el.style.display = c.privilegiado || (id === 'nav-importar' && (c.permisos.compras || c.permisos.inventario_ajuste)) ? '' : 'none'; });
        });
        revisarRecordatorios();
        setInterval(revisarRecordatorios, 5 * 60 * 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2200)); else setTimeout(init, 2200);

    root.Prod = {
        onShow: onShow, tarVista: tarVista, tarEquipo: tarEquipo, calMover: calMover, tareaForm: tareaForm, tareaGuardar: tareaGuardar,
        tareaCompletar: tareaCompletar, tareaPosponer: tareaPosponer, activarAvisos: activarAvisos, revisarRecordatorios: revisarRecordatorios,
        plantillaForm: plantillaForm, plantillaGuardar: plantillaGuardar, plantillaBorrar: plantillaBorrar, plantillaPrev: plantillaPrev, insertarVar: insertarVar,
        mensaje: mensaje, msgCanal: msgCanal, msgPlantilla: msgPlantilla, msgEnviar: msgEnviar,
        impTipo: impTipo, impPlantilla: impPlantilla, impArchivo: impArchivo, impMapa: impMapa, impEnviar: impEnviar,
        // expuestos para pruebas unitarias
        _parseCSV: parseCSV, _autoMapa: autoMapa, _rellenar: rellenar, _telWa: telWa
    };
})(window);
