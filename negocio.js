/* ═══════════════════════════════════════════════════════════════════
   negocio.js — Reportes, Compras e inventario, Seguimiento y Auditoría · Azyvion CRM (Lote 6)
   Páginas dinámicas (#page-reportes, #page-compras, #page-seguimiento, #page-auditoria).
   Toda la lógica y los permisos viven en el servidor (20261023_08_negocio.sql); aquí solo se
   capturan datos y se muestran resultados reales. Usa los diálogos de pos.js (posDlg).
═══════════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';
    const $ = id => document.getElementById(id);
    const E = s => (typeof escHtml === 'function' ? escHtml(s) : String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    const A = s => E(s).replace(/'/g, '&#39;');
    const Q = n => root.PosCalc.fQ(n);
    const N = (n, d) => Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d || 0, maximumFractionDigits: d === undefined ? 2 : d });
    const fecha = iso => iso ? new Date(iso).toLocaleDateString('es-GT') : '—';
    const fechaHora = iso => iso ? new Date(iso).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const sumDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

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

    function imprimirHtml(titulo, html) {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
        document.body.appendChild(f);
        const d = f.contentWindow.document; d.open();
        d.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${E(titulo)}</title><style>
            body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;margin:18px}h1{font-size:18px;margin:0 0 4px}h2{font-size:14px;margin:16px 0 6px}
            .muted{color:#666;font-size:11px}table{width:100%;border-collapse:collapse;margin-bottom:8px}th{text-align:left;font-size:10.5px;text-transform:uppercase;color:#555;border-bottom:1.5px solid #111;padding:4px 6px}
            td{padding:4px 6px;border-bottom:1px solid #ddd}.num{text-align:right;font-variant-numeric:tabular-nums}.kpis{display:flex;gap:10px;flex-wrap:wrap;margin:10px 0}
            .kpi{border:1px solid #ccc;border-radius:6px;padding:6px 10px;min-width:120px}.kpi b{display:block;font-size:15px}</style></head><body>${html}</body></html>`);
        d.close();
        setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* sin impresión */ } setTimeout(() => f.remove(), 2000); }, 250);
    }
    function empresa() { return (typeof EMPRESA !== 'undefined' && EMPRESA) || {}; }
    const cabeceraImpresion = (titulo, sub) => `<h1>${E(empresa().nombre || 'Azyvion CRM')} · ${E(titulo)}</h1><div class="muted">${E(sub || '')} · Generado ${new Date().toLocaleString('es-GT')}</div>`;

    /* ── Permisos y navegación ─────────────────────────────────────── */
    let perms = null, intentos = 0;
    function init() {
        call('posMisPermisos').then(r => {
            if (!r.ok || !r.permisos) { if (++intentos < 4) setTimeout(init, 4000); return; }
            perms = Object.assign({}, r.permisos, { privilegiado: !!r.privilegiado });
            const mostrar = (id, ok) => { const el = $(id); if (el) el.style.display = ok ? '' : 'none'; };
            mostrar('nav-reportes', perms.reportes);
            mostrar('nav-seguimiento', perms.reportes);
            mostrar('nav-compras', perms.compras || perms.inventario_ajuste || perms.reportes);
            mostrar('nav-auditoria', perms.privilegiado);
            const sec = $('nav-section-negocio'); if (sec) sec.style.display = (perms.reportes || perms.compras || perms.inventario_ajuste || perms.privilegiado) ? '' : 'none';
        });
    }
    function sucursalesSelect(id, valor) {
        const el = $(id); if (!el) return;
        call('getSucursales').then(r => {
            const lista = (r && r.data) || [];
            el.innerHTML = '<option value="">Todas las sucursales</option>' + lista.map(s => `<option value="${A(s.id)}" ${s.id === valor ? 'selected' : ''}>${E(s.nombre)}</option>`).join('');
        });
    }

    /* ═════════════════════ REPORTES ═════════════════════ */
    const REP = { tab: 'ventas', desde: '', hasta: '', sucursal: '', data: null, tabla: [] };
    function presetRango(k) {
        const h = new Date();
        if (k === 'hoy') return [ymd(h), ymd(h)];
        if (k === 'ayer') { const a = sumDias(h, -1); return [ymd(a), ymd(a)]; }
        if (k === '7d') return [ymd(sumDias(h, -6)), ymd(h)];
        if (k === '30d') return [ymd(sumDias(h, -29)), ymd(h)];
        if (k === 'mes') return [ymd(new Date(h.getFullYear(), h.getMonth(), 1)), ymd(h)];
        if (k === 'mesant') return [ymd(new Date(h.getFullYear(), h.getMonth() - 1, 1)), ymd(new Date(h.getFullYear(), h.getMonth(), 0))];
        return [REP.desde, REP.hasta];
    }
    function renderReportes() {
        const page = $('page-reportes'); if (!page) return;
        if (!REP.desde) { const r = presetRango('mes'); REP.desde = r[0]; REP.hasta = r[1]; }
        page.innerHTML = `<div class="neg-wrap">
            <div class="neg-head"><h2>Reportes</h2><div class="pos-muted">Ventas netas = ventas menos devoluciones. Los períodos se calculan en hora de Guatemala.</div></div>
            <div class="neg-filtros">
                ${[['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', '7 días'], ['30d', '30 días'], ['mes', 'Este mes'], ['mesant', 'Mes anterior']].map(p => `<button type="button" class="pos-chip" onclick="Negocio.repPreset('${p[0]}')">${p[1]}</button>`).join('')}
                <input class="pos-in sm2" type="date" id="repDesde" value="${A(REP.desde)}" aria-label="Desde" /><input class="pos-in sm2" type="date" id="repHasta" value="${A(REP.hasta)}" aria-label="Hasta" />
                <select class="pos-in sm2" id="repSuc" aria-label="Sucursal"><option value="">Todas las sucursales</option></select>
                <button type="button" class="pos-btn primary" onclick="Negocio.repCargar()">Actualizar</button>
                <button type="button" class="pos-btn" onclick="Negocio.repCsv()">Exportar CSV</button>
                <button type="button" class="pos-btn" onclick="Negocio.repImprimir()">Imprimir / PDF</button>
            </div>
            <div class="pos-tabs" role="tablist">
                ${[['ventas', 'Ventas'], ['cierres', 'Cierres de caja'], ['comisiones', 'Comisiones']].map(t => `<button type="button" class="pos-tab ${REP.tab === t[0] ? 'active' : ''}" onclick="Negocio.repTab('${t[0]}')">${t[1]}</button>`).join('')}
            </div>
            <div id="repBody">${loading()}</div></div>`;
        sucursalesSelect('repSuc', REP.sucursal);
        repCargar();
    }
    function repPreset(k) { const r = presetRango(k); REP.desde = r[0]; REP.hasta = r[1]; if ($('repDesde')) { $('repDesde').value = r[0]; $('repHasta').value = r[1]; } repCargar(); }
    function repTab(t) { REP.tab = t; renderReportes(); }
    async function repCargar() {
        REP.desde = ($('repDesde') || {}).value || REP.desde; REP.hasta = ($('repHasta') || {}).value || REP.hasta; REP.sucursal = ($('repSuc') || {}).value || '';
        const body = $('repBody'); if (!body) return;
        body.innerHTML = loading('Calculando…');
        const arg = { desde: REP.desde, hasta: REP.hasta, sucursal: REP.sucursal };
        const r = await call(REP.tab === 'ventas' ? 'posReporteVentas' : (REP.tab === 'cierres' ? 'posReporteCierres' : 'posReporteComisiones'), arg);
        if (!r.ok) { body.innerHTML = errBox(r); return; }
        REP.data = r;
        body.innerHTML = REP.tab === 'ventas' ? vistaVentas(r) : (REP.tab === 'cierres' ? vistaCierres(r) : vistaComisiones(r));
    }
    const delta = (a, b) => { a = Number(a || 0); b = Number(b || 0); if (!b) return a ? '<span class="neg-d up">nuevo</span>' : ''; const p = (a - b) / Math.abs(b) * 100; return `<span class="neg-d ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${N(Math.abs(p), 1)}% vs período anterior</span>`; };
    const kpi = (lbl, val, sub) => `<div class="neg-kpi"><div class="neg-kpi-l">${lbl}</div><div class="neg-kpi-v">${val}</div><div class="neg-kpi-s">${sub || ''}</div></div>`;
    function tabla(cols, filas, vacio) {
        if (!filas.length) return `<div class="pos-empty">${E(vacio || 'Sin datos en el período.')}</div>`;
        return `<div class="pos-table-wrap"><table class="pos-table"><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${E(c.t)}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.f(f)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    function grafica(porDia) {
        if (!porDia.length) return '';
        const max = Math.max(1, ...porDia.map(d => Number(d.neto)));
        const W = 720, H = 150, bw = Math.max(2, Math.floor((W - 20) / porDia.length) - 2);
        const barras = porDia.map((d, i) => {
            const h = Math.round(Number(d.neto) / max * (H - 24));
            return `<g><title>${fecha(d.fecha + 'T12:00:00')}: ${Q(d.neto)} · ${d.tickets} ticket(s)</title><rect x="${10 + i * (bw + 2)}" y="${H - 14 - h}" width="${bw}" height="${Math.max(h, 1)}" rx="2" fill="var(--az-primary)"/></g>`;
        }).join('');
        return `<div class="neg-card"><div class="neg-card-t">Ventas netas por día <span class="pos-muted">(máx. ${Q(max)})</span></div>
            <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Ventas netas por día" style="max-height:170px">${barras}
            <text x="10" y="${H}" font-size="9" fill="var(--az-text-2)">${fecha(porDia[0].fecha + 'T12:00:00')}</text>
            <text x="${W - 10}" y="${H}" text-anchor="end" font-size="9" fill="var(--az-text-2)">${fecha(porDia[porDia.length - 1].fecha + 'T12:00:00')}</text></svg></div>`;
    }
    function vistaVentas(r) {
        const k = r.kpis, kp = r.kpis_previo;
        const aviso = Number(k.items_sin_costo) > 0 ? `<div class="pos-alert warn" style="display:block;margin-bottom:10px">${k.items_sin_costo} línea(s) vendidas no tienen costo registrado: el margen es parcial. Registre compras o el costo del producto en Inventario.</div>` : '';
        const topCols = [{ t: 'Producto', f: p => E(p.producto) + (p.sku ? `<div class="pos-muted">${E(p.sku)}</div>` : '') }, { t: 'Unidades', num: 1, f: p => N(p.unidades) }, { t: 'Importe', num: 1, f: p => Q(p.importe) },
            { t: 'Costo', num: 1, f: p => Number(p.costo) ? Q(p.costo) : '—' }];
        REP.tabla = (r.top_productos || []).map(p => ({ Producto: p.producto, SKU: p.sku || '', Unidades: p.unidades, Importe: p.importe, Costo: p.costo }));
        return aviso + `<div class="neg-kpis">
            ${kpi('Ventas netas', Q(k.ventas_netas), delta(k.ventas_netas, kp.ventas_netas))}
            ${kpi('Tickets', N(k.tickets), delta(k.tickets, kp.tickets) + (Number(k.tickets_anulados) ? `<br><span class="pos-muted">${k.tickets_anulados} anulado(s)</span>` : ''))}
            ${kpi('Ticket promedio', Q(r.ticket_promedio), '')}
            ${kpi('Margen', Number(k.costo) ? Q(r.margen) : '—', Number(k.costo) ? N(r.margen_pct, 1) + '% sobre ventas sin IVA' : 'sin costos')}
            ${kpi('Devoluciones', Q(k.devoluciones), 'Brutas ' + Q(k.ventas_brutas))}
            ${kpi('Descuentos', Q(k.descuentos), 'IVA incluido ' + Q(k.iva_neto) + (Number(k.propinas) ? ' · Propinas ' + Q(k.propinas) : ''))}</div>
            ${grafica(r.por_dia || [])}
            <div class="neg-grid2">
                <div class="neg-card"><div class="neg-card-t">Por método de cobro</div>${tabla([{ t: 'Método', f: x => E(x.metodo) }, { t: 'Neto', num: 1, f: x => Q(x.monto) }], r.por_metodo || [])}</div>
                <div class="neg-card"><div class="neg-card-t">Por cajero</div>${tabla([{ t: 'Cajero', f: x => E(x.cajero) }, { t: 'Tickets', num: 1, f: x => N(x.tickets) }, { t: 'Neto', num: 1, f: x => Q(x.neto) }], r.por_cajero || [])}</div>
            </div>
            <div class="neg-card"><div class="neg-card-t">Por sucursal</div>${tabla([{ t: 'Sucursal', f: x => E(x.sucursal) }, { t: 'Tickets', num: 1, f: x => N(x.tickets) }, { t: 'Neto', num: 1, f: x => Q(x.neto) }], r.por_sucursal || [])}</div>
            <div class="neg-card"><div class="neg-card-t">Productos más vendidos</div>${tabla(topCols, r.top_productos || [], 'Aún no hay ventas en el período.')}</div>
            <div class="neg-card"><div class="neg-card-t">Con existencias y sin ventas en el período</div>${tabla([{ t: 'Producto', f: x => E(x.producto) }, { t: 'SKU', f: x => E(x.sku || '') }, { t: 'Existencias', num: 1, f: x => N(x.unidades) }], r.sin_movimiento || [], 'Todo el inventario con existencias tuvo movimiento.')}</div>`;
    }
    function vistaCierres(r) {
        const t = r.totales || {};
        REP.tabla = (r.turnos || []).map(x => ({ Turno: x.id, Sucursal: x.sucursal, Cajero: x.cajero, Apertura: x.apertura, Cierre: x.cierre || '', Estado: x.estado, Fondo: x.fondo, VentasEfectivo: x.ventas_efectivo, Esperado: x.esperado, Contado: x.contado, Diferencia: x.diferencia }));
        return `<div class="neg-kpis">${kpi('Turnos', N(t.turnos), N(t.cerrados) + ' cerrados · ' + N(t.abiertos) + ' abiertos')}${kpi('Efectivo vendido', Q(t.ventas_efectivo), '')}
            ${kpi('Tarjeta + transferencia', Q(Number(t.ventas_tarjeta || 0) + Number(t.ventas_transferencia || 0)), '')}${kpi('Faltantes', Q(t.faltantes), '')}${kpi('Sobrantes', Q(t.sobrantes), '')}</div>` +
            `<div class="neg-card">${tabla([{ t: 'Turno', f: x => E(x.id) }, { t: 'Sucursal', f: x => E(x.sucursal) }, { t: 'Cajero', f: x => E(x.cajero) }, { t: 'Apertura', f: x => fechaHora(x.apertura) },
                { t: 'Estado', f: x => x.estado === 'CERRADA' ? 'Cerrado' : 'Abierto' }, { t: 'Esperado', num: 1, f: x => x.estado === 'CERRADA' ? Q(x.esperado) : '—' }, { t: 'Contado', num: 1, f: x => x.estado === 'CERRADA' ? Q(x.contado) : '—' },
                { t: 'Diferencia', num: 1, f: x => x.estado === 'CERRADA' ? `<span class="${Number(x.diferencia) < 0 ? 'neg-d down' : ''}">${Q(x.diferencia)}</span>` : '—' }], r.turnos || [], 'No hay turnos de caja en el período.')}</div>`;
    }
    function vistaComisiones(r) {
        REP.tabla = (r.filas || []).map(x => ({ Cajero: x.cajero, Tickets: x.tickets, VentasNetas: x.ventas_netas, BaseSinIVA: x.base, Porcentaje: x.pct, Comision: x.comision }));
        return `<div class="neg-kpis">${kpi('Total de comisiones', Q(r.total_comisiones), '')}</div><div class="pos-muted" style="margin-bottom:8px">${E(r.nota)}</div>` +
            `<div class="neg-card">${tabla([{ t: 'Cajero / vendedor', f: x => E(x.cajero) }, { t: 'Tickets', num: 1, f: x => N(x.tickets) }, { t: 'Ventas netas', num: 1, f: x => Q(x.ventas_netas) }, { t: 'Base sin IVA', num: 1, f: x => Q(x.base) },
                { t: '%', num: 1, f: x => N(x.pct, 2) }, { t: 'Comisión', num: 1, f: x => `<b>${Q(x.comision)}</b>` }], r.filas || [], 'Sin ventas en el período.')}</div>`;
    }
    function repCsv() {
        if (!REP.tabla.length) { showToast('No hay datos para exportar en esta vista', '#FF9F0A'); return; }
        descargarCSV(REP.tabla, 'reporte_' + REP.tab + '_' + REP.desde + '_' + REP.hasta);
    }
    function repImprimir() {
        const b = $('repBody'); if (!b || !REP.data) return;
        imprimirHtml('Reporte ' + REP.tab, cabeceraImpresion('Reporte de ' + REP.tab, REP.desde + ' al ' + REP.hasta) + b.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, ''));
    }

    /* ═════════════════════ COMPRAS E INVENTARIO ═════════════════════ */
    const CMP = { tab: 'compras', inv: null, provs: null, cuentas: null };
    async function cargarInv(forzar) {
        if (CMP.inv && !forzar) return CMP.inv;
        const r = await call('getInventario');
        CMP.inv = (r && r.data ? r.data : []).filter(i => i.tipo !== 'Servicio' && i.activo !== false);
        return CMP.inv;
    }
    function renderCompras() {
        const page = $('page-compras'); if (!page) return;
        const t = CMP.tab;
        const tabs = [['compras', 'Compras', perms && perms.compras], ['proveedores', 'Proveedores', perms && perms.compras], ['reposicion', 'Reposición', true], ['conteo', 'Conteo físico', perms && perms.inventario_ajuste],
            ['kardex', 'Kardex y ajustes', true], ['etiquetas', 'Etiquetas', true]].filter(x => x[2]);
        if (!tabs.some(x => x[0] === t)) CMP.tab = tabs[0] ? tabs[0][0] : 'reposicion';
        page.innerHTML = `<div class="neg-wrap"><div class="neg-head"><h2>Compras e inventario</h2><div class="pos-muted">Entradas de mercadería con costo promedio, conteos, kardex y reposición.</div></div>
            <div class="pos-tabs" role="tablist">${tabs.map(x => `<button type="button" class="pos-tab ${CMP.tab === x[0] ? 'active' : ''}" onclick="Negocio.cmpTab('${x[0]}')">${x[1]}</button>`).join('')}</div>
            <div id="cmpBody">${loading()}</div></div>`;
        ({ compras: tabCompras, proveedores: tabProveedores, reposicion: tabReposicion, conteo: tabConteo, kardex: tabKardex, etiquetas: tabEtiquetas })[CMP.tab]();
    }
    function cmpTab(t) { CMP.tab = t; renderCompras(); }

    /* — Compras — */
    async function tabCompras() {
        const body = $('cmpBody');
        const r = await call('getCompras', { limite: 150 });
        if (!r.ok) { body.innerHTML = errBox(r); return; }
        CMP.lista = r.data;
        body.innerHTML = `<div class="neg-filtros"><button type="button" class="pos-btn primary" onclick="Negocio.compraNueva()">＋ Nueva compra</button>
            <button type="button" class="pos-btn" onclick="Negocio.cmpCsv()">Exportar CSV</button></div>` +
            tabla([{ t: 'No.', f: c => `<b>${E(c.numero)}</b><div class="pos-muted">${fecha(c.fecha + 'T12:00:00')}</div>` }, { t: 'Proveedor', f: c => E((c.proveedor && c.proveedor.nombre) || '—') + (c.referencia ? `<div class="pos-muted">Fact. ${E(c.referencia)}</div>` : '') },
                { t: 'Pago', f: c => E(c.forma_pago) + (c.estado === 'Recibida' && !c.pagada ? ' <span class="pos-chip-st warn">pendiente</span>' : '') }, { t: 'Estado', f: c => c.estado === 'Anulada' ? '<span class="pos-chip-st err">Anulada</span>' : '<span class="pos-chip-st ok">Recibida</span>' },
                { t: 'Total', num: 1, f: c => Q(c.total) }, { t: '', f: c => `<button type="button" class="pos-btn sm" onclick="Negocio.compraVer('${c.id}')">Ver</button>` }], r.data, 'Aún no hay compras registradas.');
    }
    function cmpCsv() { if (CMP.lista && CMP.lista.length) descargarCSV(CMP.lista.map(c => ({ Numero: c.numero, Fecha: c.fecha, Proveedor: (c.proveedor && c.proveedor.nombre) || '', Factura: c.referencia || '', Pago: c.forma_pago, Estado: c.estado, Pagada: c.pagada ? 'Sí' : 'No', Total: c.total })), 'compras'); }
    async function compraVer(id) {
        const c = (CMP.lista || []).find(x => x.id === id); if (!c) return;
        posDlg('Compra ' + c.numero, loading(), { wide: true });
        const r = await call('getCompraItems', { compraId: id });
        const acciones = [];
        if (perms && perms.compras && c.estado === 'Recibida' && !c.pagada) acciones.push(`<button type="button" class="pos-btn primary" onclick="Negocio.compraPagar('${id}')">Registrar pago</button>`);
        if (perms && perms.compras && c.estado === 'Recibida') acciones.push(`<button type="button" class="pos-btn danger-o" onclick="Negocio.compraAnular('${id}')">Anular compra</button>`);
        $('posDlgBody').innerHTML = `<div class="pos-muted">${fecha(c.fecha + 'T12:00:00')} · ${E((c.proveedor && c.proveedor.nombre) || 'Sin proveedor')} · ${E(c.forma_pago)}${c.pagada ? ' · pagada' : ' · pendiente de pago'} · Registró ${E(c.usuario)}${c.motivo_anulacion ? ' · Anulada: ' + E(c.motivo_anulacion) : ''}</div>` +
            (r.ok ? tabla([{ t: 'Producto', f: i => E(i.descripcion) }, { t: 'Cantidad', num: 1, f: i => N(i.cantidad, 3) }, { t: 'Costo unit.', num: 1, f: i => Q(i.costo_unit) }, { t: 'Total', num: 1, f: i => Q(i.total) }], r.data) : errBox(r)) +
            `<div class="neg-total">Total ${Q(c.total)}</div><div id="cmpMsg" class="pos-alert" style="display:none"></div><div class="pos-exito-btns" style="justify-content:flex-start">${acciones.join('')}</div>`;
    }
    async function compraPagar(id) {
        const cuentas = (await call('getCuentasBancarias')).data || [];
        posDlg('Registrar pago de compra', `<div class="form-field"><label class="pos-lbl" for="cpCuenta">Cuenta bancaria (opcional)</label>
            <select class="pos-in" id="cpCuenta"><option value="">Pago en efectivo / sin cuenta</option>${cuentas.map(b => `<option value="${A(b.id)}">${E(b.nombre)}</option>`).join('')}</select></div>
            <div class="form-field"><label class="pos-lbl" for="cpRef">Referencia (cheque, boleta…)</label><input class="pos-in" id="cpRef" /></div>
            <div id="cmpMsg" class="pos-alert" style="display:none"></div>
            <div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button><button type="button" class="pos-btn ok big" id="cpOk" onclick="Negocio.compraPagarOk('${id}')">Confirmar pago</button></div>`);
    }
    async function compraPagarOk(id) {
        const b = $('cpOk'); b.disabled = true;
        const r = await call('compraPagar', { compraId: id, cuentaBancariaId: ($('cpCuenta') || {}).value || null, referencia: ($('cpRef') || {}).value || '' });
        if (!r.ok) { _posMsg('cmpMsg', r.error); b.disabled = false; return; }
        posDlgCerrar(); showToast('Pago registrado ✓', '#30D158'); renderCompras();
    }
    async function compraAnular(id) {
        const motivo = (prompt('Motivo de la anulación (mínimo 5 caracteres). Se descontará lo recibido del inventario:') || '').trim();
        if (motivo.length < 5) { if (motivo) showToast('El motivo es demasiado corto', '#FF9F0A'); return; }
        const r = await call('compraAnular', { compraId: id, motivo: motivo });
        if (!r.ok) { showToast(r.error, '#FF453A'); return; }
        posDlgCerrar(); showToast('Compra anulada ✓', '#30D158'); renderCompras();
    }
    /* Nueva compra */
    let NC = null;
    async function compraNueva(prefill) {
        if (!(perms && perms.compras)) { showToast('No tiene permiso para registrar compras', '#FF9F0A'); return; }
        posDlg('Nueva compra', loading('Cargando productos y proveedores…'), { wide: true });
        const [inv, pr, cu] = await Promise.all([cargarInv(true), call('getProveedores'), call('getCuentasBancarias')]);
        CMP.provs = (pr.data || []).filter(p => p.activo); CMP.cuentas = cu.data || [];
        NC = { key: root.PosCalc.nuevaClave(), lineas: (prefill && prefill.length ? prefill : [{}]), enviando: false };
        pintarCompra();
    }
    function pintarCompra() {
        const dl = `<datalist id="ncProductos">${CMP.inv.map(i => `<option value="${A((i.sku ? i.sku + ' · ' : '') + i.producto)}"></option>`).join('')}</datalist>`;
        $('posDlgBody').innerHTML = `${dl}
            <div class="pos-grid2">
                <div class="form-field"><label class="pos-lbl" for="ncProv">Proveedor</label><select class="pos-in" id="ncProv"><option value="">Sin proveedor</option>${CMP.provs.map(p => `<option value="${A(p.id)}" ${NC.prov === p.id ? 'selected' : ''}>${E(p.nombre)}</option>`).join('')}</select></div>
                <div class="form-field"><label class="pos-lbl" for="ncRef">Factura del proveedor</label><input class="pos-in" id="ncRef" value="${A(NC.ref || '')}" /></div>
                <div class="form-field"><label class="pos-lbl" for="ncFecha">Fecha</label><input class="pos-in" type="date" id="ncFecha" value="${A(NC.fecha || ymd(new Date()))}" /></div>
                <div class="form-field"><label class="pos-lbl" for="ncForma">Forma de pago</label><select class="pos-in" id="ncForma" onchange="Negocio.ncForma()"><option ${NC.forma !== 'Crédito' ? 'selected' : ''}>Contado</option><option ${NC.forma === 'Crédito' ? 'selected' : ''}>Crédito</option></select></div>
            </div>
            <div class="form-field" id="ncCuentaW" style="${NC.forma === 'Crédito' ? 'display:none' : ''}"><label class="pos-lbl" for="ncCuenta">Pagar desde la cuenta bancaria (opcional)</label>
                <select class="pos-in" id="ncCuenta"><option value="">Efectivo / sin cuenta</option>${CMP.cuentas.map(b => `<option value="${A(b.id)}" ${NC.cuenta === b.id ? 'selected' : ''}>${E(b.nombre)}</option>`).join('')}</select></div>
            <div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>Producto (SKU · nombre)</th><th class="num">Cantidad</th><th class="num">Costo unit. (Q)</th><th class="num">Total</th><th></th></tr></thead><tbody>
            ${NC.lineas.map((l, i) => `<tr><td><input class="pos-in" list="ncProductos" id="ncP${i}" value="${A(l.texto || '')}" placeholder="Escriba o escanee" onchange="Negocio.ncProd(${i})" autocomplete="off"/></td>
                <td class="num"><input class="pos-in sm" type="number" min="0" step="any" id="ncC${i}" value="${A(l.cantidad || '')}" oninput="Negocio.ncCalc()"/></td>
                <td class="num"><input class="pos-in sm" type="number" min="0" step="0.0001" id="ncK${i}" value="${A(l.costo !== undefined ? l.costo : '')}" oninput="Negocio.ncCalc()"/></td>
                <td class="num" id="ncT${i}">${Q((Number(l.cantidad) || 0) * (Number(l.costo) || 0))}</td>
                <td>${NC.lineas.length > 1 ? `<button type="button" class="pos-line-del" aria-label="Quitar" onclick="Negocio.ncQuitar(${i})">&times;</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
            <button type="button" class="pos-btn ghost" onclick="Negocio.ncAgregar()">＋ Agregar línea</button>
            <div class="form-field"><label class="pos-lbl" for="ncNotas">Notas</label><input class="pos-in" id="ncNotas" value="${A(NC.notas || '')}" /></div>
            <div class="neg-total" id="ncTotal">Total ${Q(0)}</div><div id="cmpMsg" class="pos-alert" style="display:none" role="alert"></div>
            <div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button><button type="button" class="pos-btn ok big" id="ncOk" onclick="Negocio.compraGuardar()">Registrar compra</button></div>`;
        ncCalc();
    }
    function ncLeer() {
        NC.prov = ($('ncProv') || {}).value || ''; NC.ref = ($('ncRef') || {}).value || ''; NC.fecha = ($('ncFecha') || {}).value; NC.forma = ($('ncForma') || {}).value || 'Contado';
        NC.cuenta = ($('ncCuenta') || {}).value || ''; NC.notas = ($('ncNotas') || {}).value || '';
        NC.lineas.forEach((l, i) => { l.texto = ($('ncP' + i) || {}).value || ''; l.cantidad = ($('ncC' + i) || {}).value; l.costo = ($('ncK' + i) || {}).value; });
    }
    const ncBuscar = txt => CMP.inv.find(i => ((i.sku ? i.sku + ' · ' : '') + i.producto) === txt) || CMP.inv.find(i => i.sku && i.sku.toLowerCase() === String(txt).trim().toLowerCase()) || CMP.inv.find(i => i.codigo_barras && i.codigo_barras === String(txt).trim());
    function ncProd(i) { ncLeer(); const p = ncBuscar(NC.lineas[i].texto); if (p) { NC.lineas[i].id = p.id; NC.lineas[i].texto = (p.sku ? p.sku + ' · ' : '') + p.producto; if (!NC.lineas[i].costo) NC.lineas[i].costo = Number(p.costo_unit) || ''; if (!NC.lineas[i].cantidad) NC.lineas[i].cantidad = 1; } else NC.lineas[i].id = null; pintarCompra(); }
    function ncCalc() { let t = 0; NC.lineas.forEach((l, i) => { const s = (Number(($('ncC' + i) || {}).value) || 0) * (Number(($('ncK' + i) || {}).value) || 0); t += s; const c = $('ncT' + i); if (c) c.textContent = Q(s); }); const e = $('ncTotal'); if (e) e.textContent = 'Total ' + Q(t); }
    function ncAgregar() { ncLeer(); NC.lineas.push({}); pintarCompra(); }
    function ncQuitar(i) { ncLeer(); NC.lineas.splice(i, 1); pintarCompra(); }
    function ncForma() { ncLeer(); pintarCompra(); }
    async function compraGuardar() {
        if (NC.enviando) return;
        ncLeer();
        const items = [];
        for (const l of NC.lineas) {
            if (!l.texto && !l.cantidad) continue;
            const p = l.id ? { id: l.id } : ncBuscar(l.texto);
            if (!p) { _posMsg('cmpMsg', 'Seleccione un producto de la lista en cada línea.'); return; }
            const cant = Number(l.cantidad), costo = Number(l.costo);
            if (!(cant > 0)) { _posMsg('cmpMsg', 'La cantidad de cada línea debe ser mayor a cero.'); return; }
            if (!isFinite(costo) || costo < 0) { _posMsg('cmpMsg', 'Indique el costo unitario de cada línea.'); return; }
            items.push({ id: p.id, cantidad: cant, costo: costo });
        }
        if (!items.length) { _posMsg('cmpMsg', 'Agregue al menos un producto.'); return; }
        NC.enviando = true; $('ncOk').disabled = true; _posMsg('cmpMsg', '');
        // Misma clave en cada reintento: si la respuesta se pierde, reintentar NO duplica la compra
        const r = await call('compraRegistrar', { idempotency_key: NC.key, proveedorId: NC.prov || null, referencia: NC.ref, fecha: NC.fecha, formaPago: NC.forma, cuentaBancariaId: NC.forma === 'Contado' ? (NC.cuenta || null) : null, notas: NC.notas, items: items });
        NC.enviando = false;
        if (!r.ok) { _posMsg('cmpMsg', (r.incierto ? 'No se recibió respuesta; puede reintentar con seguridad (no se duplicará). ' : '') + r.error); $('ncOk').disabled = false; return; }
        posDlgCerrar(); showToast('Compra ' + r.numero + ' registrada ✓ · inventario y costo actualizados', '#30D158'); CMP.inv = null; renderCompras();
    }

    /* — Proveedores — */
    async function tabProveedores() {
        const body = $('cmpBody'); const r = await call('getProveedores');
        if (!r.ok) { body.innerHTML = errBox(r); return; }
        CMP.provLista = r.data;
        body.innerHTML = `<div class="neg-filtros"><button type="button" class="pos-btn primary" onclick="Negocio.provForm()">＋ Nuevo proveedor</button></div>` +
            tabla([{ t: 'Proveedor', f: p => `<b>${E(p.nombre)}</b>${p.activo ? '' : ' <span class="pos-chip-st off">inactivo</span>'}` }, { t: 'NIT', f: p => E(p.nit || '') }, { t: 'Contacto', f: p => E([p.contacto, p.telefono, p.correo].filter(Boolean).join(' · ')) },
                { t: '', f: p => `<button type="button" class="pos-btn sm" onclick="Negocio.provForm('${p.id}')">Editar</button>` }], r.data, 'Aún no hay proveedores.');
    }
    function provForm(id) {
        const p = id ? (CMP.provLista || []).find(x => x.id === id) : {};
        const f = (k, l, t) => `<div class="form-field"><label class="pos-lbl" for="pv_${k}">${l}</label><input class="pos-in" id="pv_${k}" ${t ? 'type="' + t + '"' : ''} value="${A(p[k] || '')}" /></div>`;
        posDlg(id ? 'Editar proveedor' : 'Nuevo proveedor', `<div class="pos-grid2">${f('nombre', 'Nombre *')}${f('nit', 'NIT')}${f('contacto', 'Persona de contacto')}${f('telefono', 'Teléfono')}${f('correo', 'Correo', 'email')}${f('direccion', 'Dirección')}</div>
            ${f('notas', 'Notas')}${id ? `<label class="pos-check"><input type="checkbox" id="pv_activo" ${p.activo ? 'checked' : ''}/> Proveedor activo</label>` : ''}
            <div id="cmpMsg" class="pos-alert" style="display:none"></div><div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button><button type="button" class="pos-btn ok big" onclick="Negocio.provGuardar('${id || ''}')">Guardar</button></div>`);
    }
    async function provGuardar(id) {
        const v = k => ($('pv_' + k) || {}).value || '';
        const r = await call('proveedorGuardar', { id: id || undefined, nombre: v('nombre'), nit: v('nit'), contacto: v('contacto'), telefono: v('telefono'), correo: v('correo'), direccion: v('direccion'), notas: v('notas'), activo: id ? !!($('pv_activo') || {}).checked : undefined });
        if (!r.ok) { _posMsg('cmpMsg', r.error); return; }
        posDlgCerrar(); showToast('Proveedor guardado ✓', '#30D158'); renderCompras();
    }

    /* — Reposición — */
    async function tabReposicion() {
        const body = $('cmpBody'); const r = await call('invReposicion');
        if (!r.ok) { body.innerHTML = errBox(r); return; }
        CMP.repo = r.filas || [];
        body.innerHTML = `<div class="pos-muted" style="margin-bottom:8px">Productos con existencias en o bajo su <b>stock mínimo</b> (se define en Inventario → editar producto). Sugerido = lo necesario para llegar al máximo.</div>
            <div class="neg-filtros">${perms && perms.compras && CMP.repo.length ? '<button type="button" class="pos-btn primary" onclick="Negocio.repCompra()">Crear compra con lo sugerido</button>' : ''}<button type="button" class="pos-btn" onclick="Negocio.repCsv2()">Exportar CSV</button></div>` +
            tabla([{ t: 'Producto', f: x => E(x.producto) + (x.sku ? `<div class="pos-muted">${E(x.sku)}</div>` : '') }, { t: 'Existencias', num: 1, f: x => N(x.unidades) }, { t: 'Mínimo', num: 1, f: x => N(x.minimo) }, { t: 'Faltante', num: 1, f: x => `<b>${N(x.faltante)}</b>` },
                { t: 'Sugerido', num: 1, f: x => N(x.sugerido) }, { t: 'Costo', num: 1, f: x => Number(x.costo) ? Q(x.costo) : '—' }, { t: 'Último proveedor', f: x => E(x.ultimo_proveedor || '—') }], CMP.repo, '✓ Nada por reponer: ningún producto está bajo su mínimo.');
    }
    function repCsv2() { if (CMP.repo && CMP.repo.length) descargarCSV(CMP.repo.map(x => ({ Producto: x.producto, SKU: x.sku || '', Existencias: x.unidades, Minimo: x.minimo, Faltante: x.faltante, Sugerido: x.sugerido, Costo: x.costo, UltimoProveedor: x.ultimo_proveedor || '' })), 'reposicion'); }
    async function repCompra() {
        await cargarInv(true);
        const l = (CMP.repo || []).map(x => ({ id: x.id, texto: (x.sku ? x.sku + ' · ' : '') + x.producto, cantidad: x.sugerido, costo: Number(x.costo) || '' }));
        compraNueva(l);
    }

    /* — Conteo físico — */
    async function tabConteo() {
        const body = $('cmpBody'); const r = await call('getConteos');
        if (!r.ok) { body.innerHTML = errBox(r); return; }
        body.innerHTML = `<div class="pos-muted" style="margin-bottom:8px">Cuente físicamente, registre lo contado y aplique: el sistema ajusta las existencias y deja cada diferencia en el kardex. <b>Haga el conteo con el comercio sin vender</b> o aplique justo después, porque las ventas posteriores al inicio del conteo no se descuentan solas.</div>
            <div class="neg-filtros"><button type="button" class="pos-btn primary" onclick="Negocio.conteoNuevo()">＋ Nuevo conteo</button></div>` +
            tabla([{ t: 'Conteo', f: c => `<b>${E(c.nombre)}</b><div class="pos-muted">${fechaHora(c.created_at)} · ${E(c.usuario)}</div>` }, { t: 'Estado', f: c => c.estado === 'Aplicado' ? '<span class="pos-chip-st ok">Aplicado</span>' : '<span class="pos-chip-st warn">Abierto</span>' },
                { t: '', f: c => `<button type="button" class="pos-btn sm" onclick="Negocio.conteoAbrir('${c.id}','${A(c.estado)}','${A(c.nombre)}')">${c.estado === 'Abierto' ? 'Continuar' : 'Ver'}</button>` }], r.data, 'Aún no hay conteos.');
    }
    async function conteoNuevo() {
        const cats = [...new Set((await cargarInv(true)).map(i => i.categoria).filter(Boolean))].sort();
        posDlg('Nuevo conteo físico', `<div class="form-field"><label class="pos-lbl" for="cnNombre">Nombre *</label><input class="pos-in" id="cnNombre" value="Conteo ${new Date().toLocaleDateString('es-GT')}" data-autofocus /></div>
            <div class="form-field"><label class="pos-lbl" for="cnCat">Alcance</label><select class="pos-in" id="cnCat"><option value="">Todos los productos</option>${cats.map(c => `<option>${E(c)}</option>`).join('')}</select></div>
            <div id="cmpMsg" class="pos-alert" style="display:none"></div><div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button><button type="button" class="pos-btn ok big" onclick="Negocio.conteoCrear()">Crear conteo</button></div>`);
    }
    async function conteoCrear() {
        const r = await call('invConteoCrear', { nombre: ($('cnNombre') || {}).value, categoria: ($('cnCat') || {}).value || null });
        if (!r.ok) { _posMsg('cmpMsg', r.error); return; }
        posDlgCerrar(); renderCompras(); conteoAbrir(r.id, 'Abierto', ($('cnNombre') || {}).value || 'Conteo');
    }
    let CNT = null;
    async function conteoAbrir(id, estado, nombre) {
        posDlg('Conteo: ' + nombre, loading(), { wide: true });
        const r = await call('getConteoItems', { conteoId: id });
        if (!r.ok) { $('posDlgBody').innerHTML = errBox(r); return; }
        CNT = { id: id, estado: estado, items: r.data };
        pintarConteo();
    }
    function pintarConteo() {
        const ab = CNT.estado === 'Abierto';
        $('posDlgBody').innerHTML = `<div class="neg-filtros"><input class="pos-in sm2" id="cnFiltro" placeholder="Filtrar producto…" oninput="Negocio.conteoFiltrar()" /><span class="pos-muted" id="cnResumen"></span></div>
            <div class="pos-table-wrap" style="max-height:52dvh;overflow:auto"><table class="pos-table"><thead><tr><th>Producto</th><th class="num">Sistema</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead><tbody id="cnBody">
            ${CNT.items.map((i, k) => `<tr data-k="${k}" data-t="${A((i.descripcion + ' ' + (i.sku || '')).toLowerCase())}"><td>${E(i.descripcion)}<div class="pos-muted">${E(i.sku || '')}</div></td><td class="num">${N(i.sistema, 3)}</td>
                <td class="num">${ab ? `<input class="pos-in sm" type="number" min="0" step="any" id="cnC${k}" value="${i.contado === null ? '' : A(i.contado)}" oninput="Negocio.conteoCalc()"/>` : (i.contado === null ? '—' : N(i.contado, 3))}</td>
                <td class="num" id="cnD${k}"></td></tr>`).join('')}</tbody></table></div>
            <div id="cmpMsg" class="pos-alert" style="display:none"></div>
            ${ab ? `<div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="Negocio.conteoGuardar()">Guardar avance</button><button type="button" class="pos-btn ok big" onclick="Negocio.conteoAplicar()">Aplicar conteo</button></div>` : '<div class="pos-muted">Conteo aplicado: solo lectura.</div>'}`;
        conteoCalc();
    }
    function conteoCalc() {
        let dif = 0, cont = 0;
        CNT.items.forEach((i, k) => {
            const raw = CNT.estado === 'Abierto' ? ($('cnC' + k) || {}).value : (i.contado === null ? '' : String(i.contado));
            const c = $('cnD' + k); if (!c) return;
            if (raw === '' || raw === undefined) { c.textContent = ''; return; }
            const d = Number(raw) - Number(i.sistema); cont++; if (d !== 0) dif++;
            c.innerHTML = d === 0 ? '<span class="pos-muted">0</span>' : `<b class="${d < 0 ? 'neg-d down' : 'neg-d up'}">${d > 0 ? '+' : ''}${N(d, 3)}</b>`;
        });
        const r = $('cnResumen'); if (r) r.textContent = cont + ' contado(s) · ' + dif + ' con diferencia';
    }
    function conteoFiltrar() { const t = (($('cnFiltro') || {}).value || '').toLowerCase(); document.querySelectorAll('#cnBody tr').forEach(tr => { tr.style.display = tr.dataset.t.indexOf(t) >= 0 ? '' : 'none'; }); }
    const conteoPayload = () => CNT.items.map((i, k) => ({ producto_id: i.producto_id, contado: (($('cnC' + k) || {}).value === '' || !$('cnC' + k)) ? null : Number($('cnC' + k).value) }));
    async function conteoGuardar(silencio) {
        const r = await call('invConteoGuardar', { conteoId: CNT.id, items: conteoPayload() });
        if (!r.ok) { _posMsg('cmpMsg', r.error); return false; }
        CNT.items.forEach((i, k) => { const el = $('cnC' + k); if (el) i.contado = el.value === '' ? null : Number(el.value); });
        if (!silencio) showToast('Avance guardado ✓', '#30D158');
        return true;
    }
    async function conteoAplicar() {
        if (!(await conteoGuardar(true))) return;
        const con = CNT.items.filter(i => i.contado !== null), difs = con.filter(i => Number(i.contado) !== Number(i.sistema)).length;
        if (!con.length) { _posMsg('cmpMsg', 'Registre al menos una cantidad contada.'); return; }
        if (!confirm('Se ajustarán ' + difs + ' producto(s) de ' + con.length + ' contados. Los no contados no cambian. Esta acción queda registrada. ¿Aplicar?')) return;
        const r = await call('invConteoAplicar', { conteoId: CNT.id, motivo: 'Conteo físico' });
        if (!r.ok) { _posMsg('cmpMsg', r.error); return; }
        posDlgCerrar(); showToast('Conteo aplicado: ' + r.ajustados + ' ajuste(s) ✓', '#30D158'); CMP.inv = null; renderCompras();
    }

    /* — Kardex y ajustes — */
    async function tabKardex() {
        const body = $('cmpBody'); const inv = await cargarInv();
        body.innerHTML = `<datalist id="kxProductos">${inv.map(i => `<option value="${A((i.sku ? i.sku + ' · ' : '') + i.producto)}"></option>`).join('')}</datalist>
            <div class="neg-filtros"><input class="pos-in" style="max-width:420px" list="kxProductos" id="kxProd" placeholder="Producto (SKU · nombre)" onchange="Negocio.kardexVer()" autocomplete="off"/>
            ${perms && perms.inventario_ajuste ? '<button type="button" class="pos-btn" id="kxAjuste" onclick="Negocio.ajusteForm()" disabled>Ajustar existencias</button>' : ''}</div><div id="kxBody" class="pos-empty">Elija un producto para ver su historial de movimientos.</div>`;
    }
    let KX = null;
    async function kardexVer() {
        KX = ncBuscar(($('kxProd') || {}).value || ''); const b = $('kxBody'); if (!KX) { b.innerHTML = '<div class="pos-empty">Producto no encontrado.</div>'; return; }
        const aj = $('kxAjuste'); if (aj) aj.disabled = false;
        b.className = ''; b.innerHTML = loading();
        const r = await call('getKardex', { productoId: KX.id, limite: 200 });
        if (!r.ok) { b.innerHTML = errBox(r); return; }
        b.innerHTML = `<div class="pos-muted" style="margin-bottom:6px">Existencias actuales: <b>${N(KX.unidades, 3)}</b> · Costo promedio: <b>${Q(KX.costo_unit)}</b></div>` +
            tabla([{ t: 'Fecha', f: m => fechaHora(m.created_at) }, { t: 'Movimiento', f: m => E(m.tipo) + (m.motivo ? `<div class="pos-muted">${E(m.motivo)}</div>` : '') }, { t: 'Referencia', f: m => E(m.referencia || '') },
                { t: 'Cantidad', num: 1, f: m => `<b class="${Number(m.cantidad) < 0 ? 'neg-d down' : 'neg-d up'}">${Number(m.cantidad) > 0 ? '+' : ''}${N(m.cantidad, 3)}</b>` }, { t: 'Saldo', num: 1, f: m => N(m.saldo, 3) }, { t: 'Usuario', f: m => E(m.usuario || '') }], r.data, 'Sin movimientos registrados.');
    }
    function ajusteForm() {
        if (!KX) return;
        posDlg('Ajustar existencias · ' + KX.producto, `<div class="pos-muted">Existencias actuales: <b>${N(KX.unidades, 3)}</b>. Use este ajuste para mermas, roturas o diferencias; para entradas de mercadería use Compras.</div>
            <div class="form-field"><label class="pos-lbl" for="ajNuevo">Nueva existencia *</label><input class="pos-in big" type="number" min="0" step="any" id="ajNuevo" value="${A(KX.unidades)}" data-autofocus /></div>
            <div class="form-field"><label class="pos-lbl" for="ajMotivo">Motivo * (mínimo 5 caracteres)</label><input class="pos-in" id="ajMotivo" placeholder="Ej. Merma por rotura" /></div>
            <div id="cmpMsg" class="pos-alert" style="display:none"></div><div class="pos-cobro-foot"><button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button><button type="button" class="pos-btn ok big" onclick="Negocio.ajusteOk()">Aplicar ajuste</button></div>`);
    }
    async function ajusteOk() {
        const r = await call('invAjustar', { productoId: KX.id, nuevo: ($('ajNuevo') || {}).value, motivo: ($('ajMotivo') || {}).value });
        if (!r.ok) { _posMsg('cmpMsg', r.error); return; }
        posDlgCerrar(); showToast('Ajuste aplicado ✓ (' + r.antes + ' → ' + r.despues + ')', '#30D158'); CMP.inv = null; await cargarInv(true); KX = CMP.inv.find(i => i.id === KX.id) || KX; kardexVer();
    }

    /* — Etiquetas (QR del código de barras o SKU) — */
    async function tabEtiquetas() {
        const body = $('cmpBody'); const inv = await cargarInv();
        if (typeof posCargarQr === 'function') posCargarQr();
        body.innerHTML = `<div class="pos-muted" style="margin-bottom:8px">Imprime etiquetas con nombre, precio y un <b>código QR</b> del código de barras (o del SKU si no tiene). Marque los productos y la cantidad de etiquetas.</div>
            <div class="neg-filtros"><input class="pos-in sm2" id="etFiltro" placeholder="Filtrar…" oninput="Negocio.etFiltrar()" />
            <label class="pos-lbl">Copias por producto <input class="pos-in sm" type="number" min="1" max="50" value="1" id="etCopias" /></label>
            <select class="pos-in sm2" id="etTam"><option value="50x30">50 × 30 mm</option><option value="40x25">40 × 25 mm</option><option value="70x40">70 × 40 mm</option></select>
            <button type="button" class="pos-btn primary" onclick="Negocio.etImprimir()">Imprimir etiquetas</button></div>
            <div class="pos-table-wrap" style="max-height:55dvh;overflow:auto"><table class="pos-table"><thead><tr><th></th><th>Producto</th><th>Código</th><th class="num">Precio</th></tr></thead><tbody id="etBody">
            ${inv.map(i => `<tr data-t="${A((i.producto + ' ' + (i.sku || '') + ' ' + (i.codigo_barras || '')).toLowerCase())}"><td><input type="checkbox" class="etChk" value="${A(i.id)}" aria-label="Seleccionar ${A(i.producto)}"/></td><td>${E(i.producto)}</td><td>${E(i.codigo_barras || i.sku || '—')}</td><td class="num">${Q(i.precioUnit)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    function etFiltrar() { const t = (($('etFiltro') || {}).value || '').toLowerCase(); document.querySelectorAll('#etBody tr').forEach(tr => { tr.style.display = tr.dataset.t.indexOf(t) >= 0 ? '' : 'none'; }); }
    function etImprimir() {
        const ids = [...document.querySelectorAll('.etChk:checked')].map(c => c.value);
        if (!ids.length) { showToast('Marque al menos un producto', '#FF9F0A'); return; }
        const copias = Math.min(50, Math.max(1, Number(($('etCopias') || {}).value) || 1)), tam = ($('etTam') || {}).value || '50x30', w = tam.split('x')[0], h = tam.split('x')[1];
        if (!window.qrcode) { showToast('El generador de QR aún se está cargando; intente de nuevo en unos segundos', '#FF9F0A'); if (typeof posCargarQr === 'function') posCargarQr(); return; }
        const et = [];
        ids.forEach(id => { const p = CMP.inv.find(i => i.id === id); if (!p) return; const svg = posQrSvg(p.codigo_barras || p.sku || p.id);
            for (let c = 0; c < copias; c++) et.push(`<div class="l"><div class="q">${svg}</div><div class="t"><b>${E(p.producto)}</b><div>${E(p.sku || '')}</div><div class="p">${Q(p.precioUnit)}</div></div></div>`); });
        const f = document.createElement('iframe'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'; document.body.appendChild(f);
        const d = f.contentWindow.document; d.open();
        d.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>@page{margin:2mm}body{margin:0;font-family:Arial,sans-serif}
            .l{width:${w}mm;height:${h}mm;box-sizing:border-box;padding:1.5mm;display:flex;gap:2mm;align-items:center;page-break-inside:avoid;border:0.2mm dashed #bbb;overflow:hidden}
            .q svg{width:${Math.round(h * 0.7)}mm;height:${Math.round(h * 0.7)}mm}.t{font-size:7pt;line-height:1.15;min-width:0}.t b{display:block;font-size:8pt;overflow:hidden;max-height:2.4em}.p{font-size:10pt;font-weight:800}</style></head><body>${et.join('')}</body></html>`);
        d.close(); setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* ignorar */ } setTimeout(() => f.remove(), 2500); }, 300);
    }

    /* ═════════════════════ SEGUIMIENTO ═════════════════════ */
    const SEG = { dias: 60, cumple: 14, data: null };
    function aplicar(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)); }
    /** Número internacional solo con dígitos; 8 dígitos = Guatemala (+502). */
    function telWa(t) { let d = String(t || '').replace(/\D/g, ''); if (d.length === 8) d = '502' + d; return d.length >= 10 ? d : ''; }
    function waLink(tel, texto) { const n = telWa(tel); return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto) : ''; }
    function renderSeguimiento() {
        const page = $('page-seguimiento'); if (!page) return;
        page.innerHTML = `<div class="neg-wrap"><div class="neg-head"><h2>Seguimiento de clientes</h2><div class="pos-muted">Clientes que dejaron de comprar y cumpleaños próximos. Los mensajes se abren en WhatsApp para que usted los envíe; puede cambiar el texto en Ajustes → Empresa → Mensajes y WhatsApp.</div></div>
            <div class="neg-filtros"><label class="pos-lbl">Sin comprar hace (días) <input class="pos-in sm" type="number" min="1" id="sgDias" value="${SEG.dias}" /></label>
            <label class="pos-lbl">Cumpleaños en los próximos (días) <input class="pos-in sm" type="number" min="0" id="sgCumple" value="${SEG.cumple}" /></label>
            <button type="button" class="pos-btn primary" onclick="Negocio.segCargar()">Actualizar</button><button type="button" class="pos-btn" onclick="Negocio.segCsv()">Exportar CSV</button></div><div id="sgBody">${loading()}</div></div>`;
        segCargar();
    }
    async function segCargar() {
        SEG.dias = Number(($('sgDias') || {}).value) || 60; SEG.cumple = Number(($('sgCumple') || {}).value) || 14;
        const b = $('sgBody'); b.innerHTML = loading();
        const [r, cfgR] = await Promise.all([call('seguimientoClientes', { diasSinCompra: SEG.dias, diasCumple: SEG.cumple }), call('posMisPermisos')]);
        if (!r.ok) { b.innerHTML = errBox(r); return; }
        SEG.data = r; const cfg = root.PosCalc.cfgEfectiva(cfgR && cfgR.config);
        const emp = empresa().nombre || 'nuestra tienda';
        const btn = (tel, txt) => { const l = waLink(tel, txt); return l ? `<a class="pos-btn sm ok" href="${A(l)}" target="_blank" rel="noopener">WhatsApp</a>` : '<span class="pos-muted">sin teléfono válido</span>'; };
        b.innerHTML = `<div class="neg-card"><div class="neg-card-t">Clientes que no vuelven (${r.recompra.length})</div>${tabla([{ t: 'Cliente', f: c => `<b>${E(c.nombre)}</b><div class="pos-muted">${E(c.telefono || '')}</div>` }, { t: 'Última compra', f: c => fecha(c.ultima_compra) + `<div class="pos-muted">hace ${c.dias} días</div>` },
            { t: 'Compras', num: 1, f: c => N(c.compras) }, { t: 'Total', num: 1, f: c => Q(c.total) }, { t: '', f: c => btn(c.telefono, aplicar(cfg.mensaje_recompra, { nombre: c.nombre, empresa: emp })) }], r.recompra, 'Nadie ha dejado de comprar en ese plazo.')}</div>
            <div class="neg-card"><div class="neg-card-t">Cumpleaños próximos (${r.cumpleanos.length})</div>${tabla([{ t: 'Cliente', f: c => `<b>${E(c.nombre)}</b><div class="pos-muted">${E(c.telefono || '')}</div>` }, { t: 'Cumple', f: c => fecha(c.cumple + 'T12:00:00') }, { t: 'Faltan', num: 1, f: c => Number(c.en_dias) === 0 ? '<b>¡Hoy!</b>' : c.en_dias + ' día(s)' },
            { t: '', f: c => btn(c.telefono, aplicar(cfg.mensaje_cumple, { nombre: c.nombre, empresa: emp })) }], r.cumpleanos, 'Sin cumpleaños en el plazo. Registre la fecha de nacimiento en la ficha del cliente.')}</div>`;
    }
    function segCsv() { if (!SEG.data) return; const f = SEG.data.recompra.map(c => ({ Tipo: 'Recompra', Cliente: c.nombre, Telefono: c.telefono || '', Correo: c.correo || '', UltimaCompra: c.ultima_compra, DiasSinComprar: c.dias, Compras: c.compras, Total: c.total })).concat(SEG.data.cumpleanos.map(c => ({ Tipo: 'Cumpleaños', Cliente: c.nombre, Telefono: c.telefono || '', Correo: '', UltimaCompra: '', DiasSinComprar: '', Compras: '', Total: '' }))); if (f.length) descargarCSV(f, 'seguimiento_clientes'); }

    /* ═════════════════════ CONTACTAR PROSPECTOS (WhatsApp asistido) ═════════════════════ */
    // No hay envío automático: cada mensaje se abre en WhatsApp y lo envía la persona. Al abrirlo se registra
    // una actividad en la ficha del prospecto para no repetir contactos.
    const CT = { prosp: [], hechos: {}, etapa: 'Nuevo', origen: '', q: '', ocultar: true, cargado: false };
    const CT_MSG = 'Hola {nombre}, soy {vendedor} de {empresa}. Vi que mostró interés en nuestros productos y quería saber si puedo ayudarle con alguna cotización o duda.';
    const ctClave = () => 'azyvion_contactar_msg';
    function ctPlantilla() { try { return localStorage.getItem(ctClave()) || CT_MSG; } catch (e) { return CT_MSG; } }
    function ctVendedor() { try { const s = JSON.parse(localStorage.getItem('azyvion_session') || '{}'); return s.nombre || s.usuario || ''; } catch (e) { return ''; } }
    function ctTexto(p) {
        const primer = String(p.nombre || '').trim().split(/\s+/)[0] || 'buen día';
        return aplicar(($('ctMsg') || {}).value || ctPlantilla(), { nombre: primer, empresa: empresa().nombre || 'nuestra empresa', vendedor: ctVendedor() || 'el equipo', prospecto_empresa: p.empresa || '' });
    }
    async function renderContactar() {
        const page = $('page-contactar'); if (!page) return;
        page.innerHTML = '<div class="neg-wrap">' + loading('Cargando prospectos…') + '</div>';
        const [pr, ha] = await Promise.all([call('getProspectos'), call('getContactadosWhatsApp')]);
        if (!pr.ok) { page.innerHTML = '<div class="neg-wrap">' + errBox(pr) + '</div>'; return; }
        CT.prosp = pr.data || []; CT.hechos = {};
        ((ha && ha.data) || []).forEach(a => { if (!CT.hechos[a.refId]) CT.hechos[a.refId] = a; });
        CT.cargado = true;
        const etapas = [...new Set(CT.prosp.map(p => p.etapa).filter(Boolean))];
        if (CT.etapa !== '' && etapas.indexOf(CT.etapa) < 0 && etapas.length) CT.etapa = etapas.indexOf('Nuevo') >= 0 ? 'Nuevo' : '';
        const origenes = [...new Set(CT.prosp.map(p => p.origen).filter(Boolean))].sort();
        page.innerHTML = `<div class="neg-wrap"><div class="neg-head"><h2>Contactar prospectos por WhatsApp</h2>
            <div class="pos-muted">Cada botón abre WhatsApp con el mensaje listo; <b>usted lo envía</b>. Al abrirlo se anota en la ficha del prospecto para no repetir. Envíe pocos por día y personalice el mensaje: WhatsApp bloquea los envíos masivos a quien no los espera.</div></div>
            <div class="neg-filtros">
                <select class="pos-in sm2" id="ctEtapa" onchange="Negocio.ctFiltrar()" aria-label="Etapa"><option value="">Todas las etapas</option>${etapas.map(e => `<option ${e === CT.etapa ? 'selected' : ''}>${E(e)}</option>`).join('')}</select>
                <select class="pos-in sm2" id="ctOrigen" onchange="Negocio.ctFiltrar()" aria-label="Origen"><option value="">Todos los orígenes</option>${origenes.map(o => `<option>${E(o)}</option>`).join('')}</select>
                <input class="pos-in sm2" id="ctBuscar" placeholder="Buscar nombre o empresa…" oninput="Negocio.ctFiltrar()" />
                <label class="pos-check"><input type="checkbox" id="ctOcultar" ${CT.ocultar ? 'checked' : ''} onchange="Negocio.ctFiltrar()"/> Ocultar ya contactados</label>
            </div>
            <div class="form-field"><label class="pos-lbl" for="ctMsg">Mensaje (variables: {nombre} {empresa} {vendedor} {prospecto_empresa})</label>
                <textarea class="pos-in" id="ctMsg" rows="3" oninput="Negocio.ctGuardarMsg()">${E(ctPlantilla())}</textarea></div>
            <div class="neg-filtros"><span class="pos-muted" id="ctResumen"></span>
                <button type="button" class="pos-btn" onclick="Negocio.ctCopiar()">Copiar lista de enlaces</button>
                <button type="button" class="pos-btn" onclick="Negocio.ctCsv()">Exportar CSV con enlaces</button></div>
            <div id="ctBody"></div></div>`;
        ctFiltrar();
    }
    function ctGuardarMsg() { try { localStorage.setItem(ctClave(), ($('ctMsg') || {}).value || ''); } catch (e) { /* sin almacenamiento */ } ctPintar(); }
    function ctFiltrar() {
        CT.etapa = ($('ctEtapa') || {}).value || ''; CT.origen = ($('ctOrigen') || {}).value || ''; CT.q = (($('ctBuscar') || {}).value || '').toLowerCase(); CT.ocultar = !!($('ctOcultar') || {}).checked;
        ctPintar();
    }
    function ctLista() {
        return CT.prosp.filter(p => (!CT.etapa || p.etapa === CT.etapa) && (!CT.origen || p.origen === CT.origen) && (!CT.q || ((p.nombre || '') + ' ' + (p.empresa || '')).toLowerCase().indexOf(CT.q) >= 0)
            && !(CT.ocultar && CT.hechos[p.id]));
    }
    function ctPintar() {
        const b = $('ctBody'); if (!b) return;
        const lista = ctLista(), validos = lista.filter(p => telWa(p.telefono));
        const r = $('ctResumen'); if (r) r.textContent = lista.length + ' prospecto(s) · ' + validos.length + ' con teléfono válido · ' + Object.keys(CT.hechos).length + ' ya contactados en total' + (validos.length > 30 ? ' · muchos pendientes: envíe de a pocos por día' : '');
        b.innerHTML = tabla([{ t: 'Prospecto', f: p => '<b>' + E(p.nombre) + '</b>' + (p.empresa ? '<div class="pos-muted">' + E(p.empresa) + '</div>' : '') },
            { t: 'Teléfono', f: p => E(p.telefono || '—') }, { t: 'Etapa', f: p => E(p.etapa || '') + (p.origen ? '<div class="pos-muted">' + E(p.origen) + '</div>' : '') },
            { t: 'Estado', f: p => CT.hechos[p.id] ? '<span class="pos-chip-st ok">Contactado ' + fecha(CT.hechos[p.id].fecha + 'T12:00:00') + '</span>' : '<span class="pos-chip-st off">Sin contactar</span>' },
            { t: '', f: p => { const l = waLink(p.telefono, ctTexto(p)); return l ? '<a class="pos-btn sm ok" href="' + A(l) + '" target="_blank" rel="noopener" onclick="Negocio.ctMarcar(\'' + A(p.id) + '\')">WhatsApp</a>' : '<span class="pos-muted">sin teléfono válido</span>'; } }],
            lista, 'No hay prospectos con ese filtro.');
    }
    async function ctMarcar(id) {
        const p = CT.prosp.find(x => String(x.id) === String(id)); if (!p) return;
        const r = await call('addActividadCRM', { tipo: 'Prospecto', refId: p.id, categoria: 'Seguimiento', titulo: 'Contactado por WhatsApp', descripcion: ctTexto(p) });
        if (!r.ok) { showToast('Se abrió WhatsApp pero no se pudo anotar el contacto: ' + r.error, '#FF9F0A'); return; }
        CT.hechos[p.id] = { refId: p.id, fecha: ymd(new Date()) };
        setTimeout(ctPintar, 400);
    }
    function ctEnlaces() { return ctLista().map(p => ({ p: p, l: waLink(p.telefono, ctTexto(p)) })).filter(x => x.l); }
    function ctCopiar() {
        const t = ctEnlaces().map(x => x.p.nombre + (x.p.empresa ? ' (' + x.p.empresa + ')' : '') + ': ' + x.l).join('\n');
        if (!t) { showToast('No hay enlaces para copiar con ese filtro', '#FF9F0A'); return; }
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => showToast(ctEnlaces().length + ' enlace(s) copiados ✓', '#30D158')).catch(() => prompt('Copie la lista:', t));
    }
    function ctCsv() { const f = ctEnlaces().map(x => ({ Prospecto: x.p.nombre, Empresa: x.p.empresa || '', Telefono: x.p.telefono || '', Etapa: x.p.etapa || '', Enlace_WhatsApp: x.l })); if (f.length) descargarCSV(f, 'prospectos_whatsapp'); else showToast('No hay enlaces para exportar', '#FF9F0A'); }

    /* ═════════════════════ AUDITORÍA ═════════════════════ */
    const AUD = { data: [] };
    function renderAuditoria() {
        const page = $('page-auditoria'); if (!page) return;
        const h = new Date();
        page.innerHTML = `<div class="neg-wrap"><div class="neg-head"><h2>Auditoría del Punto de Venta</h2><div class="pos-muted">Quién hizo qué: ventas, devoluciones, anulaciones, cajas, compras y ajustes de inventario. Solo administradores.</div></div>
            <div class="neg-filtros"><input class="pos-in sm2" type="date" id="auDesde" value="${ymd(sumDias(h, -7))}" /><input class="pos-in sm2" type="date" id="auHasta" value="${ymd(h)}" />
            <select class="pos-in sm2" id="auAccion"><option value="">Todas las acciones</option>${[['venta.', 'Ventas'], ['venta.anular', 'Anulaciones'], ['venta.devolver', 'Devoluciones'], ['venta.reimprimir', 'Reimpresiones'], ['caja.', 'Cajas'], ['compra.', 'Compras'], ['inventario.', 'Ajustes de inventario'], ['conteo.', 'Conteos'], ['proveedor.', 'Proveedores']].map(a => `<option value="${A(a[0])}">${a[1]}</option>`).join('')}</select>
            <button type="button" class="pos-btn primary" onclick="Negocio.audCargar()">Buscar</button><button type="button" class="pos-btn" onclick="Negocio.audCsv()">Exportar CSV</button></div><div id="auBody">${loading()}</div></div>`;
        audCargar();
    }
    async function audCargar() {
        const b = $('auBody'); b.innerHTML = loading();
        const r = await call('posListarAuditoria', { desde: ($('auDesde') || {}).value, hasta: ($('auHasta') || {}).value, accion: ($('auAccion') || {}).value, limite: 500 });
        if (!r.ok) { b.innerHTML = errBox(r); return; }
        AUD.data = r.filas || [];
        b.innerHTML = tabla([{ t: 'Fecha', f: a => fechaHora(a.fecha) }, { t: 'Usuario', f: a => E(a.usuario || '') }, { t: 'Acción', f: a => `<b>${E(a.accion)}</b>` }, { t: 'Entidad', f: a => E(a.entidad) },
            { t: 'Detalle', f: a => `<span class="pos-muted">${E(JSON.stringify(a.detalle || {}).slice(0, 220))}</span>` }], AUD.data, 'Sin registros en el período.');
    }
    function audCsv() { if (AUD.data.length) descargarCSV(AUD.data.map(a => ({ Fecha: a.fecha, Usuario: a.usuario, Accion: a.accion, Entidad: a.entidad, Id: a.entidad_id, Detalle: JSON.stringify(a.detalle || {}) })), 'auditoria_pos'); }

    /* ── Enganche con showPage ────────────────────────────────────── */
    const PAGES = { reportes: renderReportes, compras: renderCompras, seguimiento: renderSeguimiento, auditoria: renderAuditoria, contactar: renderContactar };
    function onShow(id) {
        if (!PAGES[id]) return;
        if (!perms) { call('posMisPermisos').then(r => { if (r.ok) { perms = Object.assign({}, r.permisos, { privilegiado: !!r.privilegiado }); PAGES[id](); } else if ($('page-' + id)) $('page-' + id).innerHTML = '<div class="neg-wrap">' + errBox(r) + '</div>'; }); return; }
        PAGES[id]();
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && typeof posDlgAbierto === 'function' && posDlgAbierto() && typeof _currentPage !== 'undefined' && _currentPage !== 'pos') posDlgCerrar(); });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1800)); else setTimeout(init, 1800);

    root.Negocio = {
        onShow: onShow, init: init, repPreset: repPreset, repTab: repTab, repCargar: repCargar, repCsv: repCsv, repImprimir: repImprimir,
        cmpTab: cmpTab, cmpCsv: cmpCsv, compraVer: compraVer, compraPagar: compraPagar, compraPagarOk: compraPagarOk, compraAnular: compraAnular, compraNueva: compraNueva,
        ncProd: ncProd, ncCalc: ncCalc, ncAgregar: ncAgregar, ncQuitar: ncQuitar, ncForma: ncForma, compraGuardar: compraGuardar,
        provForm: provForm, provGuardar: provGuardar, repCsv2: repCsv2, repCompra: repCompra,
        conteoNuevo: conteoNuevo, conteoCrear: conteoCrear, conteoAbrir: conteoAbrir, conteoCalc: conteoCalc, conteoFiltrar: conteoFiltrar, conteoGuardar: conteoGuardar, conteoAplicar: conteoAplicar,
        kardexVer: kardexVer, ajusteForm: ajusteForm, ajusteOk: ajusteOk, etFiltrar: etFiltrar, etImprimir: etImprimir,
        ctFiltrar: ctFiltrar, ctGuardarMsg: ctGuardarMsg, ctMarcar: ctMarcar, ctCopiar: ctCopiar, ctCsv: ctCsv, segCargar: segCargar, segCsv: segCsv, audCargar: audCargar, audCsv: audCsv, telWa: telWa, waLink: waLink, aplicar: aplicar
    };
})(window);
