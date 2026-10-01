/* ═══════════════════════════════════════════════════════════════════
   ficha-pro.js — Ficha de Cliente Profesional · Azyvion CRM v2.0
   
   ARQUITECTURA:
   · Extiende (no reemplaza) las funciones de ficha del dashboard.html
   · Usa window._sb (Supabase) directamente para historial de cambios
   · Mantiene window.api para las operaciones existentes (actividades,
     notas, contactos, etc.)
   · Inyecta estilos CSS directamente al <head>
   · Sobreescribe: renderFicha, _fichaResumen, _fichaContactos, 
     _fichaActividad, _fichaNotas + agrega tabs: cotizaciones, historial
   · Agrega: header mejorado, breadcrumb, KPIs, avatar de iniciales
   
   DEPENDENCIAS (ya presentes en dashboard.html):
     window._sb, window.api, _ficha, _fichaRef, _fichaTab,
     _fichaOrigen, escHtml, escAttr, initials, fechaCorta,
     showToast, openModal, closeModal, recargarFicha,
     tagSegmento, tagEstado, tagEtapa, _currentOrgId, _usuario,
     _modalMode, fichaTab, renderFichaBody
════════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    /* ── Inyectar estilos ─────────────────────────────────────── */
    const CSS = `
/* ── FICHA PRO — Estilos adicionales ─────────────────────────── */
.ficha-pro-header {
    padding: 20px 20px 0;
    background: var(--card);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
}
.ficha-breadcrumb {
    font-size: 11.5px;
    color: var(--text-muted);
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 6px;
}
.ficha-breadcrumb a {
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
}
.ficha-breadcrumb a:hover { text-decoration: underline; }
.ficha-breadcrumb svg { width: 12px; height: 12px; stroke: var(--text-muted); fill: none; stroke-width: 2; }

.ficha-pro-identity {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    margin-bottom: 16px;
}
.ficha-avatar-wrap {
    flex-shrink: 0;
}
.ficha-avatar-big {
    width: 62px;
    height: 62px;
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -1px;
    user-select: none;
}

.ficha-pro-name-block { flex: 1; min-width: 0; }
.ficha-pro-empresa { font-size: 20px; font-weight: 700; letter-spacing: -.3px; line-height: 1.2; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ficha-pro-nombre { font-size: 13px; color: var(--text-secondary); margin-top: 3px; }
.ficha-pro-badges { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; align-items: center; }
.ficha-pro-dato-inline { font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
.ficha-pro-dato-inline svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
.ficha-pro-meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; }

.ficha-pro-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 14px;
    align-items: center;
}
.ficha-pro-actions .btn-ghost { height: 32px; font-size: 12.5px; padding: 0 12px; gap: 5px; }
.ficha-pro-actions .btn-ghost svg { width: 13px; height: 13px; }
.ficha-pro-more-btn {
    height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--text-secondary);
    font-size: 12.5px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
}
.ficha-pro-more-btn:hover { border-color: var(--accent); color: var(--accent); }

/* ── Head lateral (volver + max) se mueve aquí ──────────── */
.ficha-pro-header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
}
.ficha-pro-win { display: flex; gap: 6px; align-items: center; }

/* ── KPIs mejorados ──────────────────────────────────────── */
.ficha-kpi-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 10px;
}
.ficha-kpi-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 12px;
}
.ficha-kpi-card-v {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -.4px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.ficha-kpi-card-l {
    font-size: 10.5px;
    color: var(--text-muted);
    margin-top: 2px;
    text-transform: uppercase;
    letter-spacing: .3px;
    font-weight: 500;
}

/* ── Tab: Cotizaciones ───────────────────────────────────── */
.ficha-cot-estado {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 20px;
    font-size: 11px;
    font-weight: 600;
}
.ficha-cot-borrador  { background: #F2F2F5; color: #8E8E93; }
.ficha-cot-enviada   { background: #E8F4FF; color: #0A84FF; }
.ficha-cot-aprobada  { background: #E3F8ED; color: #30D158; }
.ficha-cot-rechazada { background: #FFE5E5; color: #FF453A; }
.ficha-cot-vencida   { background: #FFF3E0; color: #FF9F0A; }

/* ── Tab: Historial ──────────────────────────────────────── */
.ficha-hist-row {
    display: flex;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid #F2F2F5;
    font-size: 12.5px;
    align-items: flex-start;
}
.ficha-hist-row:last-child { border-bottom: 0; }
.ficha-hist-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    margin-top: 5px;
    flex-shrink: 0;
}
.ficha-hist-accion { font-weight: 600; color: var(--text-primary); }
.ficha-hist-campo { color: var(--text-secondary); margin-top: 2px; }
.ficha-hist-val {
    display: inline-flex;
    align-items: center;
    gap: 5px;
}
.ficha-hist-val .old { text-decoration: line-through; color: var(--text-muted); }
.ficha-hist-val .new { color: var(--text-primary); font-weight: 500; }
.ficha-hist-meta { font-size: 11px; color: var(--text-muted); margin-top: 3px; }

/* ── Contacto principal badge ────────────────────────────── */
.badge-principal {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 7px;
    border-radius: 20px;
    background: var(--accent-bg);
    color: var(--accent);
    font-size: 10.5px;
    font-weight: 600;
}
.badge-principal svg { width: 10px; height: 10px; stroke: currentColor; fill: none; stroke-width: 2.5; }

/* ── Contacto card mejorada ──────────────────────────────── */
.ficha-contact-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 14px;
    position: relative;
}
.ficha-contact-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}
.ficha-contact-link {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--accent);
    text-decoration: none;
}
.ficha-contact-link:hover { text-decoration: underline; }
.ficha-contact-link svg { width: 11px; height: 11px; stroke: currentColor; fill: none; stroke-width: 2; flex-shrink: 0; }



/* ── Responsive ──────────────────────────────────────────── */
@media (max-width: 600px) {
    .ficha-pro-empresa { font-size: 16px; }
    .ficha-kpi-grid { grid-template-columns: repeat(3, 1fr); }
}

/* ── Shell rediseñada: el header vive dentro de .ficha-shell ── */
.ficha-shell-pro .ficha-head { display: none; } /* ocultar el head original */
.ficha-shell-pro .ficha-acciones { display: none; } /* ocultar acciones originales */
`;

    function _injectCSS() {
        if (document.getElementById('az-ficha-pro-styles')) return;
        const s = document.createElement('style');
        s.id = 'az-ficha-pro-styles';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    /* ── Helpers internos ────────────────────────────────────── */
    function _sb() { return window._sb; }
    function _orgId() { return window._currentOrgId || ''; }
    function _usuarioActual() {
        try {
            const ss = JSON.parse(localStorage.getItem('azyvion_session') || 'null');
            return (ss && (ss.nombre || ss.usuario)) || window._usuario || 'Sistema';
        } catch (e) { return window._usuario || 'Sistema'; }
    }

    function _fmtMonto(v) {
        const n = parseFloat(v) || 0;
        return 'Q ' + n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }
    function _fmtFechaCorta(iso) {
        if (!iso) return '—';
        return typeof fechaCorta === 'function' ? fechaCorta(iso) : iso.slice(0, 10);
    }

    /* Icono SVG inline */
    function _icon(name) {
        const icons = {
            phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.39 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.79a16 16 0 0 0 6 6l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16z"/>',
            mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
            globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
            map: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
            user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
            chevron: '<polyline points="9 18 15 12 9 6"/>',
            edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z"/>',
            plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
            clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
            trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
            check: '<polyline points="20 6 9 17 4 12"/>',
            file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
            wa: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
        };
        return `<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round">${icons[name] || ''}</svg>`;
    }

    function _htmlAvatar(e) {
        const color = e.color || '#0A84FF';
        const initls = (typeof initials === 'function' ? initials(e.empresa || e.nombre || 'A') : (e.empresa || 'A').substring(0, 2).toUpperCase());
        return `<div class="ficha-avatar-big" style="background:${escAttr(color)}">${escHtml(initls)}</div>`;
    }

    /* ── Render principal del header ──────────────────────── */
    function _renderFichaHeader(f) {
        const e = f.entidad;
        const esProsp = f.tipo === 'Prospecto';
        const puede = f.permisos.puedeEditar;
        const shell = document.querySelector('.ficha-shell');
        if (shell) shell.classList.add('ficha-shell-pro');

        const avatarHtml = _htmlAvatar(e);

        const metaItems = [
            e.telefono ? `<span class="ficha-pro-dato-inline">${_icon('phone')}<a href="tel:${escAttr(String(e.telefono).replace(/\s/g, ''))}" class="cell-link">${escHtml(e.telefono)}</a></span>` : '',
            e.correo ? `<span class="ficha-pro-dato-inline">${_icon('mail')}<a href="mailto:${escAttr(e.correo)}" class="cell-link">${escHtml(e.correo)}</a></span>` : '',
            (e.ciudad || e.pais) ? `<span class="ficha-pro-dato-inline">${_icon('map')}${escHtml([e.ciudad, e.pais].filter(Boolean).join(', '))}</span>` : '',
            e.sitioWeb ? `<span class="ficha-pro-dato-inline">${_icon('globe')}<a href="${escAttr(e.sitioWeb)}" target="_blank" rel="noopener" class="cell-link">${escHtml(e.sitioWeb.replace(/^https?:\/\//, ''))}</a></span>` : '',
            e.nit ? `<span class="ficha-pro-dato-inline">${_icon('file')}NIT: ${escHtml(e.nit)}</span>` : '',
        ].filter(Boolean).join('');

        const breadcrumbLabel = esProsp ? 'Prospectos' : 'Clientes';
        const breadcrumbPage = esProsp ? 'prospectos' : 'clientes';

        const accionesHtml = `
        <div class="ficha-pro-actions">
            ${puede ? `<button class="btn-ghost" onclick="fichaEditarEntidad()">
                ${_icon('edit')} Editar ${esProsp ? 'prospecto' : 'cliente'}
            </button>` : ''}
            ${puede ? `<button class="btn-ghost" onclick="fichaNuevaActividad()">
                ${_icon('clock')} Registrar actividad
            </button>` : ''}
            ${!esProsp && puede ? `<button class="btn-ghost" onclick="_fichaProNuevaCotizacion()">
                ${_icon('file')} Nueva cotización
            </button>` : ''}
            ${puede ? `<button class="btn-ghost" onclick="fichaNuevoContacto()">
                ${_icon('user')} Agregar contacto
            </button>` : ''}
        </div>`;

        const headerHtml = `
<div class="ficha-pro-header" id="fichaProHeader">
    <div class="ficha-pro-header-top">
        <div class="ficha-breadcrumb">
            <a onclick="cerrarFicha()">${escHtml(breadcrumbLabel)}</a>
            <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            ${escHtml(e.empresa || e.nombre || '—')}
        </div>
        <div class="ficha-pro-win">
            <button class="btn-ghost" onclick="cerrarFicha()" style="height:30px;font-size:12px;padding:0 10px;gap:4px">
                <svg viewBox="0 0 24 24" style="width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                Volver
            </button>
            <button class="ficha-win-btn" id="fichaMaxBtn" title="Ampliar ficha" onclick="toggleFichaMax()">
                <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
            </button>
            <button class="ficha-win-btn cerrar" title="Cerrar ficha" onclick="cerrarFicha()">
                <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    </div>

    <div class="ficha-pro-identity">
        <div class="ficha-avatar-wrap">
            ${avatarHtml}
        </div>
        <div class="ficha-pro-name-block">
            <div class="ficha-pro-empresa">${escHtml(e.empresa || e.nombre || '—')}</div>
            ${e.empresa && e.nombre !== e.empresa ? `<div class="ficha-pro-nombre">${escHtml(e.nombre)}</div>` : ''}
            <div class="ficha-pro-badges">
                ${esProsp ? (typeof tagEtapa === 'function' ? tagEtapa(e.etapa) : '') : (typeof tagEstado === 'function' ? tagEstado(e.estado) : '')}
                ${typeof tagSegmento === 'function' ? tagSegmento(e.segmento || 'Estándar') : ''}
                ${e.tipoCliente ? `<span class="tag tag-gray">${escHtml(e.tipoCliente)}</span>` : ''}
            </div>
            ${metaItems ? `<div class="ficha-pro-meta">${metaItems}</div>` : ''}
        </div>
    </div>

    ${accionesHtml}
</div>`;

        // Insertar o reemplazar el header en la shell
        let existing = document.getElementById('fichaProHeader');
        if (existing) {
            existing.outerHTML = headerHtml;
        } else {
            const shell = document.querySelector('.ficha-shell');
            if (shell) {
                const tabs = document.getElementById('fichaTabs');
                if (tabs) shell.insertBefore(
                    document.createRange().createContextualFragment(headerHtml),
                    tabs
                );
            }
        }
    }

    /* ── Tab: Resumen mejorado ───────────────────────────────── */
    function _fichaResumenPro() {
        const f = window._ficha;
        const e = f.entidad;
        const r = f.resumen;
        const esProsp = f.tipo === 'Prospecto';
        const puede = f.permisos.puedeEditar;

        // KPIs
        const kpis = `<div class="card ficha-card" style="grid-column:1/-1">
            <div class="ficha-card-head"><span>Indicadores</span></div>
            <div class="ficha-card-body">
                <div class="ficha-kpi-grid">
                    <div class="ficha-kpi-card">
                        <div class="ficha-kpi-card-v">${_fmtMonto(e.valorGanado || r.montoCotizado || 0)}</div>
                        <div class="ficha-kpi-card-l">Valor ganado</div>
                    </div>
                    <div class="ficha-kpi-card">
                        <div class="ficha-kpi-card-v">${_fmtMonto(e.valorPotencial || 0)}</div>
                        <div class="ficha-kpi-card-l">Valor potencial</div>
                    </div>
                    <div class="ficha-kpi-card">
                        <div class="ficha-kpi-card-v">${r.totalCotizaciones || 0}</div>
                        <div class="ficha-kpi-card-l">Cotizaciones</div>
                    </div>
                    <div class="ficha-kpi-card">
                        <div class="ficha-kpi-card-v">${r.totalContactos || 0}</div>
                        <div class="ficha-kpi-card-l">Contactos</div>
                    </div>
                    <div class="ficha-kpi-card">
                        <div class="ficha-kpi-card-v">${r.totalActividades || 0}</div>
                        <div class="ficha-kpi-card-l">Actividades</div>
                    </div>
                    <div class="ficha-kpi-card">
                        <div class="ficha-kpi-card-v" style="font-size:12px">${r.ultimaActividad || '—'}</div>
                        <div class="ficha-kpi-card-l">Últ. actividad</div>
                    </div>
                </div>
            </div>
        </div>`;

        // Info general
        const infoRows = [
            ['Nombre comercial', escHtml(e.empresa || e.nombre)],
            e.razonSocial ? ['Razón social', escHtml(e.razonSocial)] : null,
            e.nit ? ['NIT', escHtml(e.nit)] : null,
            ['Tipo de cliente', escHtml(e.tipoCliente || '—')],
            ['Segmento', typeof tagSegmento === 'function' ? tagSegmento(e.segmento || 'Estándar') : escHtml(e.segmento || '—')],
            esProsp ? ['Etapa', typeof tagEtapa === 'function' ? tagEtapa(e.etapa) : escHtml(e.etapa)] : ['Estado', typeof tagEstado === 'function' ? tagEstado(e.estado) : escHtml(e.estado)],
            e.ejecutivo ? ['Ejecutivo', escHtml(e.ejecutivo)] : null,
            e.telefono ? ['Teléfono', `<a class="cell-link" href="tel:${escAttr(String(e.telefono).replace(/\s/g,''))}">${escHtml(e.telefono)}</a>`] : null,
            e.correo ? ['Correo', `<a class="cell-link" href="mailto:${escAttr(e.correo)}">${escHtml(e.correo)}</a>`] : null,
            e.sitioWeb ? ['Sitio web', `<a class="cell-link" href="${escAttr(e.sitioWeb)}" target="_blank" rel="noopener">${escHtml(e.sitioWeb)}</a>`] : null,
            (e.ciudad || e.pais) ? ['Ubicación', escHtml([e.ciudad, e.pais].filter(Boolean).join(', '))] : null,
            e.direccion ? ['Dirección', escHtml(e.direccion)] : null,
            ['Registrado', _fmtFechaCorta(e.fechaReg)],
            e.ultimaActividad ? ['Última actividad', _fmtFechaCorta(e.ultimaActividad)] : null,
            e.ultimaCompra ? ['Última compra', _fmtFechaCorta(e.ultimaCompra)] : null,
        ].filter(Boolean);

        const general = `<div class="card ficha-card">
            <div class="ficha-card-head">
                <span>Información general</span>
                ${puede ? `<button class="section-action" onclick="fichaEditarEntidad()">${_icon('edit')} Editar</button>` : ''}
            </div>
            <div class="ficha-card-body">
                ${infoRows.map(([l, v]) => `<div class="ficha-dato"><span class="ficha-dato-l">${l}</span><span class="ficha-dato-v">${v}</span></div>`).join('')}
            </div>
        </div>`;

        // Próximo seguimiento
        const seg = f.proximoSeguimiento;
        const seguimiento = `<div class="card ficha-card">
            <div class="ficha-card-head">
                <span>Próximo seguimiento</span>
                ${puede ? `<button class="section-action" onclick="fichaProgramarSeguimiento()">Programar</button>` : ''}
            </div>
            <div class="ficha-card-body">
                ${seg
                    ? `<div class="ficha-seg">
                        <div class="ficha-seg-fecha">${escHtml(seg.fecha)}</div>
                        <div class="ficha-seg-tit">${escHtml(seg.titulo || '')}</div>
                        <div class="cell-sub">Registrado por ${escHtml(seg.usuario || '')}</div>
                       </div>`
                    : '<div class="ficha-vacio">Sin seguimientos programados.</div>'}
            </div>
        </div>`;

        // Actividad reciente (últimas 5)
        const actReciente = `<div class="card ficha-card">
            <div class="ficha-card-head">
                <span>Actividad reciente</span>
                <button class="section-action" onclick="fichaTab('actividad')">Ver todo</button>
            </div>
            <div class="ficha-card-body">
                ${f.actividades.length
                    ? f.actividades.slice(0, 5).map(_fichaActItemPro).join('')
                    : '<div class="ficha-vacio">Sin actividad registrada.</div>'}
            </div>
        </div>`;

        // Cotizaciones recientes
        const cotHtml = f.cotizaciones.length ? `<div class="card ficha-card">
            <div class="ficha-card-head">
                <span>Cotizaciones</span>
                <button class="section-action" onclick="fichaTab('cotizaciones')">Ver todo</button>
            </div>
            <div class="ficha-card-body">
                ${f.cotizaciones.slice(0, 4).map(c => `<div class="ficha-list-row">
                    <div>
                        <div class="cell-main">${escHtml(c.numero || '—')}</div>
                        <div class="cell-sub">${escHtml(c.fecha || '—')}</div>
                    </div>
                    <div style="text-align:right">
                        <div class="cell-main">${_fmtMonto(c.total)}</div>
                        <div>${_estadoCotTag(c.estado)}</div>
                    </div>
                </div>`).join('')}
            </div>
        </div>` : '';

        // Notas recientes
        const notasHtml = `<div class="card ficha-card">
            <div class="ficha-card-head">
                <span>Notas recientes</span>
                <button class="section-action" onclick="fichaTab('notas')">Ver todo</button>
            </div>
            <div class="ficha-card-body">
                ${f.notas.length
                    ? f.notas.slice(0, 3).map(n => `<div class="ficha-nota">
                        <div class="ficha-nota-txt">${escHtml(n.contenido)}</div>
                        <div class="cell-sub">${escHtml(n.usuario || 'Sistema')} · ${_fmtFechaCorta(n.fecha)}</div>
                      </div>`).join('')
                    : '<div class="ficha-vacio">Sin notas registradas.</div>'}
            </div>
        </div>`;

        return `<div class="ficha-grid">${kpis}${general}${seguimiento}${actReciente}${cotHtml}${notasHtml}</div>`;
    }

    /* ── Tab: Contactos mejorado ─────────────────────────────── */
    function _fichaContactosPro() {
        const f = window._ficha;
        const puede = f.permisos.puedeEditar;

        const head = `<div class="ficha-tab-bar">
            <div class="cell-sub">${f.contactos.length} contacto(s) registrados para esta cuenta.</div>
            ${puede ? `<button class="btn-ghost" onclick="fichaNuevoContacto()">${_icon('plus')} Agregar contacto</button>` : ''}
        </div>`;

        if (!f.contactos.length) {
            return head + '<div class="ficha-vacio" style="padding:40px">Aún no hay contactos registrados.</div>';
        }

        const cards = f.contactos.map(c => {
            const initls = typeof initials === 'function' ? initials(c.nombre) : c.nombre.substring(0, 2).toUpperCase();
            return `<div class="ficha-contact-card">
                <div style="display:flex;gap:12px;align-items:flex-start;margin-bottom:12px">
                    <div class="ficha-contact-avatar">${escHtml(initls)}</div>
                    <div style="min-width:0;flex:1">
                        <div style="font-weight:600;font-size:14px">${escHtml(c.nombre)}</div>
                        <div class="cell-sub">${escHtml(c.cargo || 'Sin cargo')}${c.departamento ? ' · ' + escHtml(c.departamento) : ''}</div>
                        ${c.esPrincipal ? `<span class="badge-principal" style="margin-top:4px">${_icon('check')} Principal</span>` : ''}
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:7px">
                    ${c.telefono ? `<a class="ficha-contact-link" href="tel:${escAttr(String(c.telefono).replace(/\s/g,''))}">${_icon('phone')}${escHtml(c.telefono)}</a>` : ''}
                    ${c.correo ? `<a class="ficha-contact-link" href="mailto:${escAttr(c.correo)}">${_icon('mail')}${escHtml(c.correo)}</a>` : ''}
                    ${c.whatsapp ? `<a class="ficha-contact-link" href="https://wa.me/${escAttr(c.whatsapp.replace(/\D/g,''))}" target="_blank" rel="noopener">${_icon('wa')}${escHtml(c.whatsapp)}</a>` : ''}
                </div>
                ${c.notas ? `<div class="cell-sub" style="margin-top:8px;font-size:12px">${escHtml(c.notas)}</div>` : ''}
                ${puede ? `<div class="row-actions" style="margin-top:10px;border-top:1px solid var(--border);padding-top:10px">
                    <button class="section-action" onclick="fichaEditarContacto('${c.id}')">Editar</button>
                    ${f.permisos.puedeEliminar ? `<button class="btn-danger-sm" onclick="fichaEliminarContacto('${c.id}','${escAttr(c.nombre)}')">Eliminar</button>` : ''}
                </div>` : ''}
            </div>`;
        }).join('');

        return head + `<div class="ficha-grid">${cards}</div>`;
    }

    /* ── Item de actividad mejorado ──────────────────────────── */
    const CAT_COLOR = {
        'Llamada': 'var(--accent)', 'Correo': 'var(--purple)', 'Reunión': 'var(--success)',
        'WhatsApp': '#25D366', 'Visita': 'var(--warning)', 'Seguimiento': '#14B8A6',
        'Nota': '#8E8E93', 'Otro': '#8E8E93', 'Sistema': '#C7C7CC'
    };

    function _fichaActItemPro(a) {
        const color = CAT_COLOR[a.categoria] || '#8E8E93';
        const puede = window._ficha && window._ficha.permisos && window._ficha.permisos.puedeEliminar;
        return `<div class="ficha-act">
            <div class="ficha-act-dot" style="background:${color}"></div>
            <div style="flex:1;min-width:0">
                <div class="ficha-act-top">
                    <span class="cell-main">${escHtml(a.titulo || a.categoria)}</span>
                    <span class="tag tag-gray" style="font-size:10.5px">${escHtml(a.categoria)}</span>
                </div>
                ${a.descripcion ? `<div class="cell-sub" style="margin-top:3px;white-space:pre-line">${escHtml(a.descripcion)}</div>` : ''}
                <div class="cell-sub" style="margin-top:3px">${escHtml(a.fecha || '')}${a.usuario ? ' · ' + escHtml(a.usuario) : ''}${a.fechaSeguimiento ? ` · <span style="color:var(--accent)">Seguimiento: ${escHtml(a.fechaSeguimiento)}</span>` : ''}</div>
            </div>
            ${(a.origen === 'ficha' && puede)
                ? `<button class="btn-danger-sm" onclick="fichaEliminarActividad('${a.id}')">Eliminar</button>` : ''}
        </div>`;
    }

    /* ── Tab: Cotizaciones ───────────────────────────────────── */
    function _fichaCotizacionesPro() {
        const f = window._ficha;
        const puede = f.permisos.puedeEditar;
        const cots = f.cotizaciones || [];

        const head = `<div class="ficha-tab-bar">
            <div class="cell-sub">${cots.length} cotización(es) relacionadas con esta cuenta.</div>
            ${puede ? `<button class="btn-ghost" onclick="_fichaProNuevaCotizacion()">${_icon('plus')} Nueva cotización</button>` : ''}
        </div>`;

        if (!cots.length) {
            return head + '<div class="ficha-vacio" style="padding:40px">Sin cotizaciones registradas para este cliente.</div>';
        }

        return head + `<div class="table-card"><div class="table-scroll"><table>
            <thead><tr>
                <th>N°</th><th>Fecha</th><th>Estado</th><th class="cell-num">Total</th><th></th>
            </tr></thead>
            <tbody>
                ${cots.map(c => `<tr>
                    <td><div class="cell-main">${escHtml(c.numero || '—')}</div></td>
                    <td><div class="cell-sub" style="margin:0">${escHtml(c.fecha || '—')}</div></td>
                    <td>${_estadoCotTag(c.estado)}</td>
                    <td class="cell-num"><div class="cell-main">${_fmtMonto(c.total)}</div></td>
                    <td><div class="row-actions">
                        <button class="section-action" onclick="_fichaProAbrirCotizacion('${c.id}')">Ver</button>
                    </div></td>
                </tr>`).join('')}
            </tbody>
        </table></div></div>`;
    }

    function _estadoCotTag(estado) {
        const map = {
            'Borrador':  'ficha-cot-borrador',
            'Enviada':   'ficha-cot-enviada',
            'Aprobada':  'ficha-cot-aprobada',
            'Aceptada':  'ficha-cot-aprobada',
            'Ganada':    'ficha-cot-aprobada',
            'Rechazada': 'ficha-cot-rechazada',
            'Perdida':   'ficha-cot-rechazada',
            'Vencida':   'ficha-cot-vencida',
        };
        return `<span class="ficha-cot-estado ${map[estado] || 'ficha-cot-borrador'}">${escHtml(estado || 'Borrador')}</span>`;
    }

    window._fichaProNuevaCotizacion = function () {
        // Cambiar a la página de cotizaciones con el cliente preseleccionado
        const f = window._ficha;
        if (!f) return;
        // Guardar el cliente a preseleccionar para cuando cargue la página de cotizaciones
        window._cotPreselCliente = {
            id: f.entidad.id,
            nombre: f.entidad.nombre,
            empresa: f.entidad.empresa,
            correo: f.entidad.correo,
            telefono: f.entidad.telefono,
            direccion: f.entidad.direccion,
        };
        const navCot = document.getElementById('nav-cotizaciones');
        if (typeof showPage === 'function') showPage('cotizaciones', navCot);
        setTimeout(() => { if (typeof ctaAction === 'function') ctaAction(); }, 150);
    };

    window._fichaProAbrirCotizacion = function (id) {
        const navCot = document.getElementById('nav-cotizaciones');
        if (typeof showPage === 'function') showPage('cotizaciones', navCot);
        // Intentar abrir la cotización si la función existe
        setTimeout(() => {
            if (typeof abrirCotizacion === 'function') abrirCotizacion(id);
            else if (typeof verCotizacion === 'function') verCotizacion(id);
        }, 200);
    };

    /* ── Tab: Historial ──────────────────────────────────────── */
    function _fichaHistorialPro() {
        const f = window._ficha;
        if (!f) return '';
        const historial = f.historial || [];

        const head = `<div class="ficha-tab-bar">
            <div class="cell-sub">Registro de cambios importantes en este cliente.</div>
        </div>`;

        if (!historial.length) {
            return head + '<div class="ficha-vacio" style="padding:40px">Sin cambios registrados en el historial.</div>';
        }

        const rows = historial.map(h => `<div class="ficha-hist-row">
            <div class="ficha-hist-dot"></div>
            <div style="flex:1">
                <div class="ficha-hist-accion">${escHtml(h.accion || 'Cambio')}</div>
                ${h.campo ? `<div class="ficha-hist-campo">
                    ${escHtml(h.campo)}:
                    <span class="ficha-hist-val">
                        ${h.valoranterior ? `<span class="old">${escHtml(h.valoranterior)}</span> → ` : ''}
                        <span class="new">${escHtml(h.valornuevo || '—')}</span>
                    </span>
                </div>` : ''}
                <div class="ficha-hist-meta">${escHtml(h.usuario || 'Sistema')} · ${_fmtFechaCorta(h.fecha)}</div>
            </div>
        </div>`).join('');

        return head + `<div class="card ficha-card"><div class="ficha-card-body">${rows}</div></div>`;
    }

    /* ── Sobreescribir renderFicha ───────────────────────────── */
    const _originalRenderFicha = window.renderFicha;

    window.renderFicha = function () {
        // Primero ejecutar el original para que ponga títulos y tabs
        if (_originalRenderFicha) _originalRenderFicha.call(this);

        const f = window._ficha;
        if (!f) return;

        // Ampliar tabs con cotizaciones e historial
        const esProsp = f.tipo === 'Prospecto';
        const TABS_PRO = [
            { id: 'resumen', label: 'Resumen', count: null },
            { id: 'contactos', label: 'Contactos', count: (f.contactos || []).length || null },
            { id: 'actividad', label: 'Actividad', count: (f.actividades || []).length || null },
        ];
        if (!esProsp) {
            TABS_PRO.push({ id: 'cotizaciones', label: 'Cotizaciones', count: (f.cotizaciones || []).length || null });
        }
        TABS_PRO.push(
            { id: 'prospectos', label: 'Prospectos', count: (f.prospectos || []).length || null },
            { id: 'notas', label: 'Notas', count: (f.notas || []).length || null },
        );
        if (!esProsp) {
            TABS_PRO.push({ id: 'historial', label: 'Historial', count: null });
        }

        const tabsEl = document.getElementById('fichaTabs');
        if (tabsEl) {
            tabsEl.innerHTML = TABS_PRO.map(t =>
                `<button class="ficha-tab${t.id === window._fichaTab ? ' active' : ''}" data-tab="${t.id}" onclick="fichaTab('${t.id}',this)">
                    ${escHtml(t.label)}${t.count ? ` <span class="ficha-tab-count">${t.count}</span>` : ''}
                </button>`
            ).join('');
        }

        // Render del header pro
        _renderFichaHeader(f);

        // Cargar historial si es cliente
        if (!esProsp && !(f.historial)) {
            _loadHistorial(f.entidad.id).then(hist => {
                f.historial = hist;
            });
        }

        // Re-render del body
        _renderFichaBodyPro();
    };

    /* ── Sobreescribir renderFichaBody ───────────────────────── */
    const _originalRenderFichaBody = window.renderFichaBody;

    window.renderFichaBody = function () {
        _renderFichaBodyPro();
    };

    function _renderFichaBodyPro() {
        const cont = document.getElementById('fichaBody');
        if (!cont || !window._ficha) return;

        const tab = window._fichaTab || 'resumen';
        const map = {
            resumen:      _fichaResumenPro,
            contactos:    _fichaContactosPro,
            actividad:    _fichaActividadPro,
            cotizaciones: _fichaCotizacionesPro,
            prospectos:   _fichaProspectosPro,
            notas:        _fichaNotasPro,
            historial:    _fichaHistorialPro,
        };

        const fn = map[tab];
        cont.innerHTML = fn ? fn() : _fichaResumenPro();
    }

    /* ── Tab: Actividad (reutiliza existente con item mejorado) ─ */
    function _fichaActividadPro() {
        const f = window._ficha;
        const head = `<div class="ficha-tab-bar">
            <div class="cell-sub">Historial ordenado de más reciente a más antiguo.</div>
            ${f.permisos.puedeEditar ? `<button class="btn-ghost" onclick="fichaNuevaActividad()">${_icon('plus')} Registrar actividad</button>` : ''}
        </div>`;
        if (!f.actividades.length) return head + '<div class="ficha-vacio" style="padding:40px">Sin actividad registrada.</div>';
        return head + `<div class="card ficha-card"><div class="ficha-card-body">${f.actividades.map(_fichaActItemPro).join('')}</div></div>`;
    }

    /* ── Tab: Prospectos (reutiliza el original) ─────────────── */
    function _fichaProspectosPro() {
        // Reutilizar la función original si existe
        if (typeof window._fichaProspectos === 'function') {
            return window._fichaProspectos();
        }
        const f = window._ficha;
        if (!f.prospectos.length) return '<div class="ficha-vacio" style="padding:40px">Sin prospectos relacionados.</div>';
        return `<div class="table-card"><div class="table-scroll"><table>
            <thead><tr><th>Prospecto</th><th>Etapa</th><th class="cell-num">Valor</th><th></th></tr></thead>
            <tbody>${f.prospectos.map(x => `<tr>
                <td><div class="cell-main">${escHtml(x.nombre)}</div><div class="cell-sub">${escHtml(x.empresa) || '—'}</div></td>
                <td>${typeof tagEtapa === 'function' ? tagEtapa(x.etapa) : escHtml(x.etapa)}</td>
                <td class="cell-num">${_fmtMonto(x.valorEstimado)}</td>
                <td><button class="section-action" onclick="abrirFicha('Prospecto','${x.id}')">Ver ficha</button></td>
            </tr>`).join('')}</tbody>
        </table></div></div>`;
    }

    /* ── Tab: Notas (versión mejorada) ───────────────────────── */
    function _fichaNotasPro() {
        const f = window._ficha;
        const puede = f.permisos.puedeEditar;
        const nueva = puede ? `<div class="card ficha-card"><div class="ficha-card-body">
            <textarea class="form-input" id="fichaNotaRapida" rows="3" placeholder="Escribe una nota sobre este cliente…"></textarea>
            <div style="display:flex;justify-content:flex-end;margin-top:10px">
                <button class="btn-save" onclick="guardarNotaRapida()">Guardar nota</button>
            </div></div></div>` : '';

        const lista = f.notas.length
            ? f.notas.map(n => `<div class="ficha-nota-full">
                <div class="ficha-nota-txt">${escHtml(n.contenido)}</div>
                <div class="ficha-nota-pie">
                    <span class="cell-sub">${escHtml(n.usuario || 'Sistema')} · ${_fmtFechaCorta(n.fecha)}</span>
                    ${f.permisos.puedeEliminar ? `<button class="btn-danger-sm" onclick="fichaEliminarNota('${n.id}')">Eliminar</button>` : ''}
                </div></div>`).join('')
            : '<div class="ficha-vacio" style="padding:40px">Sin notas registradas.</div>';

        return nueva + `<div class="card ficha-card"><div class="ficha-card-body">${lista}</div></div>`;
    }

    /* ── Cargar historial desde AuditoriaClientes ──────────── */
    async function _loadHistorial(clienteId) {
        const sb = _sb();
        if (!sb || !clienteId) return [];
        try {
            const { data, error } = await sb
                .from('AuditoriaClientes')
                .select('id, usuario, accion, campo, valoranterior, valornuevo, fecha')
                .eq('clienteId', clienteId)
                .order('fecha', { ascending: false })
                .limit(50);
            if (error) throw error;
            return data || [];
        } catch (e) {
            console.warn('[Azyvion] No se pudo cargar historial:', e.message);
            return [];
        }
    }

    /* ── Inicializar ────────────────────────────────────────── */
    function _init() {
        _injectCSS();

        // Extender fichaTab para manejar tabs adicionales
        const _originalFichaTab = window.fichaTab;
        window.fichaTab = function (tab, el) {
            window._fichaTab = tab;
            document.querySelectorAll('#fichaTabs .ficha-tab').forEach(t => t.classList.remove('active'));
            if (el) el.classList.add('active');
            else {
                const b = document.querySelector('#fichaTabs .ficha-tab[data-tab="' + tab + '"]');
                if (b) b.classList.add('active');
            }
            // Si es historial y no está cargado, cargar
            if (tab === 'historial' && window._ficha && !window._ficha.historial) {
                _loadHistorial(window._ficha.entidad.id).then(hist => {
                    window._ficha.historial = hist;
                    _renderFichaBodyPro();
                });
            } else {
                _renderFichaBodyPro();
            }
        };

        console.log('[Azyvion] ficha-pro.js inicializado');
    }

    // Ejecutar al cargar
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }

})();
