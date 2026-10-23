/* ═══════════════════════════════════════════════════════════════════
   pos.js — Módulo Punto de Venta (POS) Multitenant · Azyvion CRM
   Lote 4: rediseño operativo. La lógica crítica (precios, stock, permisos,
   numeración, pagos, contabilidad, caja, devoluciones) la ejecuta el servidor
   en funciones SQL transaccionales (ver supabase/migrations/20261023_06_pos_ventas.sql);
   este archivo solo captura la operación y muestra el resultado real.
   Los cálculos de apoyo están en pos-calc.js (se carga antes).
═══════════════════════════════════════════════════════════════════ */

let _posProductos = [];
let _posClientes = [];
let _posCuentas = [];
let _posCarrito = [];
let _posClienteSel = null; // { id, nombre, nit, direccion, lista_precio }
let _posListaPrecioActual = 'Publico'; // 'Publico' | 'Plata' | 'Oro'
let _posFiltroCat = 'Todos';
let _posViewMode = 'compact'; // 'images' | 'compact'
let _posTipoFiltro = 'todos'; // 'todos' | 'stock' | 'servicios'
let _posPaginaActual = 0;
const _POS_ITEMS_PER_PAGE = 48;
let _posPerm = { descuento: false, editar_precio: false, anular: false, devolver: false, caja_mov: false, reimprimir: false, descuentoMax: 0, privilegiado: false };
let _posCajaAbierta = false;     // true solo si el servidor confirmó un turno abierto
let _posCajaEstado = 'cargando'; // 'cargando' | 'abierta' | 'cerrada' | 'error'
let _posCajaId = null;
let _posCajaMontoInicial = 0;
let _posCaja = null;             // última respuesta de getCajaStatus
let _posCobrando = false;        // candado contra doble envío
let _posIntento = null;          // { key, fp } clave de idempotencia ligada a este carrito
let _posPagos = [];
let _posSelLinea = null;
let _posDlgBloqueado = false;
let _posDlgOnClose = null;
let _posHistDetalle = null;
let _posDevKey = null;
let _posInitCargado = false;
let _posPendienteVerificar = null; // payload cuya venta quedó con resultado incierto
let _posCfg = window.PosCalc.cfgEfectiva();   // configuración de la empresa (servidor: Ajustes → Empresa)
let _posVentaSinStock = false;  // la empresa permite vender sin existencias (y este usuario puede)
let _posPropina = 0;

const _POS_BASE = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/[^/]*$/, '') : '';
let _posQrEstado = 'no';   // no | cargando | listo | error
function posCargarQr() {
    if (_posQrEstado !== 'no' || window.qrcode) { if (window.qrcode) _posQrEstado = 'listo'; return; }
    _posQrEstado = 'cargando';
    const sc = document.createElement('script');
    sc.src = _POS_BASE + 'vendor/qrcode.min.js';
    sc.onload = () => { _posQrEstado = 'listo'; };
    sc.onerror = () => { _posQrEstado = 'error'; };
    document.head.appendChild(sc);
}
/** QR (SVG) del número de venta; vacío si la librería no está disponible. */
function posQrSvg(texto) {
    try {
        if (!window.qrcode) return '';
        const q = window.qrcode(0, 'M'); q.addData(String(texto)); q.make();
        return q.createSvgTag({ cellSize: 3, margin: 0, scalable: true });
    } catch (e) { return ''; }
}
const _pq = () => window.PosCalc;
const fQ = n => _pq().fQ(n);
const _posEl = id => document.getElementById(id);

function _posSesion() {
    try { return JSON.parse(localStorage.getItem('azyvion_session') || 'null') || {}; } catch (e) { return {}; }
}
function _posEsStarter() {
    return typeof window.getCurrentPlan === 'function' && window.getCurrentPlan() === 'starter';
}
function _posCfgImpuesto() {
    const e = (typeof EMPRESA !== 'undefined' && EMPRESA) || {};
    const pct = Number(e.ivaPct);
    return { ivaPct: isFinite(pct) ? pct : 12, ivaModalidad: e.ivaModalidad === 'sobre' ? 'sobre' : 'incluido' };
}
function _posPct() {
    const el = _posEl('posDescuentoPct');
    let v = Number(el ? el.value : 0);
    if (!isFinite(v) || v < 0) v = 0;
    const max = _posPerm.privilegiado ? 100 : _posPerm.descuentoMax;
    if (!_posPerm.descuento) return 0;
    return Math.min(v, max);
}
function _posTotales() {
    const c = _posCfgImpuesto();
    return _pq().calcTotales(_posCarrito, { descPct: _posPct(), ivaPct: c.ivaPct, ivaModalidad: c.ivaModalidad });
}

/* ──────────────────────────────────────────────────────────────────
   DIÁLOGOS PROPIOS DEL POS (un solo diálogo a la vez, con scroll interno)
────────────────────────────────────────────────────────────────── */
function posDlg(titulo, html, opts) {
    opts = opts || {};
    posDlgCerrar(true);
    const ov = document.createElement('div');
    ov.className = 'pos-dlg-ov';
    ov.id = 'posDlg';
    ov.innerHTML = `
        <div class="pos-dlg ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="posDlgTitle">
            <div class="pos-dlg-head">
                <h3 id="posDlgTitle">${escHtml(titulo)}</h3>
                <button type="button" class="pos-dlg-x" aria-label="Cerrar" onclick="posDlgCerrar()">&times;</button>
            </div>
            <div class="pos-dlg-body" id="posDlgBody">${html}</div>
        </div>`;
    ov.addEventListener('mousedown', e => { if (e.target === ov) posDlgCerrar(); });
    document.body.appendChild(ov);
    _posDlgOnClose = opts.onClose || null;
    const af = ov.querySelector('[data-autofocus]');
    if (af) setTimeout(() => { af.focus(); if (af.select) af.select(); }, 30);
}
function posDlgCerrar(force) {
    if (_posDlgBloqueado && !force) return;
    const ov = _posEl('posDlg');
    if (ov) ov.remove();
    const cb = _posDlgOnClose; _posDlgOnClose = null;
    if (cb && !force) { try { cb(); } catch (e) { console.error(e); } }
}
function posDlgAbierto() { return !!_posEl('posDlg'); }
function _posMsg(id, texto, tipo) {
    const el = _posEl(id);
    if (!el) return;
    if (!texto) { el.style.display = 'none'; el.textContent = ''; return; }
    el.className = 'pos-alert ' + (tipo || 'err');
    el.style.display = 'block';
    el.textContent = texto;
}

/* ──────────────────────────────────────────────────────────────────
   INICIALIZACIÓN
────────────────────────────────────────────────────────────────── */
async function loadPos() {
    const catalogEl = _posEl('posProductCatalog');
    if (catalogEl && !_posProductos.length) catalogEl.innerHTML = '<div class="pos-empty">Cargando catálogo…</div>';
    _posPaginaActual = 0;
    _posCajaCheckStatus();
    posInitAtajos();

    window.api
        .withSuccessHandler(function (res) {
            if (!res || !res.ok) {
                _posMostrarErrorCatalogo((res && res.error) || 'Sin respuesta del servidor');
                return;
            }
            _posProductos = (res.productos || []).filter(p => p.activo !== false && String(p.activo).toLowerCase() !== 'false');
            _posClientes = res.clientes || [];
            _posCuentas = res.cuentas || [];
            if (res.permisos && res.permisos.permisos) {
                _posPerm = Object.assign({ descuentoMax: 0, privilegiado: false }, res.permisos.permisos,
                    { descuentoMax: Number(res.permisos.descuentoMax) || 0, privilegiado: !!res.permisos.privilegiado });
                _posCfg = _pq().cfgEfectiva(res.permisos.config);
                _posVentaSinStock = !!res.permisos.puedeVenderSinStock;
                if (_posCfg.mostrar_qr) posCargarQr();
            }
            _posInitCargado = true;
            _initPosClientesSelect();
            _initPosCategoriasFilter();
            _posAplicarPermisosUI();
            renderPosCatalogo();
            renderPosCarrito();
            _posActualizarBadgePendientes();
        })
        .withFailureHandler(function (err) {
            _posMostrarErrorCatalogo((err && err.message) || err);
        })
        .getPosInit();
}

function _posMostrarErrorCatalogo(msg) {
    showToast('Error cargando POS: ' + msg, '#FF453A');
    const el = _posEl('posProductCatalog');
    if (el && !_posProductos.length) {
        el.innerHTML = `<div class="pos-empty">No se pudo cargar el catálogo.<br><small>${escHtml(msg)}</small><br>
            <button type="button" class="pos-btn" style="margin-top:10px" onclick="loadPos()">Reintentar</button></div>`;
    }
}

function _posAplicarPermisosUI() {
    const descRow = _posEl('posDescRow');
    if (descRow) descRow.style.display = _posPerm.descuento ? '' : 'none';
    const lp = _posEl('posListaRow');
    if (lp) lp.style.display = _posPerm.editar_precio ? '' : 'none';
    const inp = _posEl('posDescuentoPct');
    if (inp) {
        const max = _posPerm.privilegiado ? 100 : _posPerm.descuentoMax;
        inp.max = max;
        const lbl = _posEl('posDescMaxTxt');
        if (lbl) lbl.textContent = '(máx. ' + max + '%)';
    }
}

function _initPosClientesSelect() {
    const sel = _posEl('posClienteSelect');
    if (!sel) return;
    const previo = sel.value;
    let html = '<option value="__cf__">Consumidor Final (C/F)</option>';
    _posClientes.forEach(c => {
        const lp = c.lista_precio || 'Publico';
        html += `<option value="${escAttr(c.id)}" data-lp="${escAttr(lp)}">${escHtml(c.nombre)}${c.empresa ? ' (' + escHtml(c.empresa) + ')' : ''}${c.nit && c.nit !== 'C/F' ? ' · ' + escHtml(c.nit) : ''}</option>`;
    });
    sel.innerHTML = html;
    if (previo && [...sel.options].some(o => o.value === previo)) sel.value = previo;
    if (!_posClienteSel) _posClienteSel = { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad', lista_precio: 'Publico' };
}

function posOnClienteChange(sel) {
    const val = sel.value;
    if (val === '__cf__') {
        _posClienteSel = { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad', lista_precio: 'Publico' };
        posCambiarListaPrecio('Publico');
    } else {
        const c = _posClientes.find(x => String(x.id) === String(val));
        if (c) {
            _posClienteSel = { id: c.id, nombre: c.nombre, nit: c.nit || 'C/F', direccion: c.direccion || 'Ciudad', lista_precio: c.lista_precio || 'Publico' };
            posCambiarListaPrecio(c.lista_precio || 'Publico');
        }
    }
    _posResumenCliente();
}

function _posResumenCliente() {
    const el = _posEl('posClienteResumen');
    if (!el) return;
    const c = _posClienteSel;
    el.textContent = c && c.id ? ('NIT ' + (c.nit || 'C/F') + ' · Lista ' + (c.lista_precio || 'Publico')) : '';
}

function posCambiarListaPrecio(lp) {
    if (lp !== 'Publico' && _posEsStarter()) {
        if (typeof window.showUpgradeModal === 'function') window.showUpgradeModal('precios_mayorista');
        return;
    }
    _posListaPrecioActual = lp;
    document.querySelectorAll('.pos-lp-btn').forEach(b => b.classList.toggle('active', b.dataset.lp === lp));
    _posCarrito.forEach(it => {
        if (it.precioManual) return;
        it.precioUnit = _pq().precioSegunLista(it.prodOriginal, _posListaPrecioActual);
        it.total = _pq().r2(it.precioUnit * it.cantidad);
    });
    renderPosCatalogo();
    renderPosCarrito();
}

function _obtenerPrecioSegunLista(prod, lp) { return _pq().precioSegunLista(prod, lp); }

/* ──────────────────────────────────────────────────────────────────
   CATÁLOGO
────────────────────────────────────────────────────────────────── */
function _initPosCategoriasFilter() {
    const sel = _posEl('posCatSelect');
    if (!sel) return;
    const cats = ['Todos'];
    _posProductos.forEach(p => { if (p.categoria && !cats.includes(p.categoria)) cats.push(p.categoria); });
    sel.innerHTML = cats.map(c => `<option value="${escAttr(c)}" ${c === _posFiltroCat ? 'selected' : ''}>${c === 'Todos' ? 'Todas las categorías' : escHtml(c)}</option>`).join('');
}

function posFiltrarCat(cat) {
    _posFiltroCat = cat;
    _posPaginaActual = 0;
    renderPosCatalogo();
}

let _posBuscarTimer = null;
function posFiltrarCatalogo() {
    clearTimeout(_posBuscarTimer);
    _posBuscarTimer = setTimeout(() => { _posPaginaActual = 0; renderPosCatalogo(); }, 110);
}

/** Enter en el buscador: coincidencia exacta de SKU/código (lector) → agrega; si no, primer resultado único. */
function posBuscarEnter(ev) {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const inp = _posEl('posSearchInput');
    const q = inp ? inp.value : '';
    if (!q.trim()) return;
    const exacto = _pq().buscarExacto(_posProductos, q);
    let prod = exacto;
    if (!prod) {
        const lista = _pq().filtrarProductos(_posProductos, { q: q, cat: _posFiltroCat, tipo: _posTipoFiltro });
        if (lista.length === 1) prod = lista[0];
    }
    if (prod) {
        posAgregarItem(prod.id);
        inp.value = '';
        renderPosCatalogo();
    } else {
        showToast('Sin coincidencia única. Afina la búsqueda o elige un producto.', '#FF9F0A');
    }
}

function posSetTipoFiltro(tipo, btn) {
    _posTipoFiltro = tipo;
    _posPaginaActual = 0;
    document.querySelectorAll('#posFilterBar .pos-filter-chip').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderPosCatalogo();
}

function posToggleViewMode() {
    _posViewMode = _posViewMode === 'images' ? 'compact' : 'images';
    const btn = _posEl('posToggleViewBtn');
    if (btn) btn.textContent = _posViewMode === 'images' ? 'Con fotos' : 'Compacto';
    renderPosCatalogo();
}

function renderPosCatalogo() {
    const catalogEl = _posEl('posProductCatalog');
    if (!catalogEl) return;
    const q = (_posEl('posSearchInput')?.value || '');
    const items = _pq().filtrarProductos(_posProductos, { q: q, cat: _posFiltroCat, tipo: _posTipoFiltro });

    if (!items.length) {
        catalogEl.innerHTML = `<div class="pos-empty">${_posProductos.length ? 'No se encontraron productos con ese criterio.' : 'No hay productos activos en el inventario.'}</div>`;
        _posToggleLoadMore(false, 0, 0);
        return;
    }
    const isCompact = _posViewMode === 'compact';
    catalogEl.classList.toggle('compact-view', isCompact);
    const maxItems = (_posPaginaActual + 1) * _POS_ITEMS_PER_PAGE;
    const visibles = items.slice(0, maxItems);
    const showFicha = typeof esAdmin === 'function' && esAdmin();
    const mostrarFotos = typeof EMPRESA === 'undefined' || EMPRESA.catalogoFotosHabilitado !== false;

    catalogEl.innerHTML = visibles.map(p => {
        const esServicio = p.tipo === 'Servicio';
        const stock = Number(p.unidades || 0);
        const enCarrito = (_posCarrito.find(i => String(i.id) === String(p.id)) || {}).cantidad || 0;
        const disp = esServicio ? Infinity : stock - enCarrito;
        const precio = _pq().precioSegunLista(p, _posListaPrecioActual);
        const imgUrl = p.imagenUrl || p.imagen_url || p.fotoUrl || '';
        const iniciales = (p.producto || '??').substring(0, 2).toUpperCase();
        let stockCls, stockLabel;
        if (esServicio) { stockCls = 'svc'; stockLabel = 'Servicio'; }
        else if (stock <= 0) { stockCls = 'out'; stockLabel = _posPuedeSinStock() ? 'Sin stock' : 'Agotado'; }
        else if (stock <= (Number(_posCfg.stock_bajo_umbral) || 0)) { stockCls = 'low'; stockLabel = 'Quedan ' + stock; }
        else { stockCls = 'ok'; stockLabel = 'Stock ' + stock; }
        const agotado = !esServicio && disp <= 0 && !_posPuedeSinStock();
        const img = (!isCompact && mostrarFotos) ? `
            <div class="pos-item-img-wrap">
                ${imgUrl ? `<img class="pos-item-img" src="${escAttr(imgUrl)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'pos-item-placeholder',textContent:'${escAttr(iniciales)}'}))" />`
                         : `<div class="pos-item-placeholder">${escHtml(iniciales)}</div>`}
            </div>` : '';
        const ficha = showFicha ? `<button type="button" class="pos-item-ficha-btn" onclick="event.stopPropagation();posVerFichaProducto('${escAttr(p.id)}')" title="Ver ficha de producto" aria-label="Ver ficha">i</button>` : '';
        return `
        <div class="pos-item-card ${agotado ? 'disabled' : ''}" ${agotado ? 'aria-disabled="true"' : `onclick="posAgregarItem('${escAttr(p.id)}')"`} role="button" tabindex="${agotado ? -1 : 0}"
             onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
            ${ficha}${img}
            <div class="pos-item-info">
                <div class="pos-item-title">${escHtml(p.producto)}</div>
                <div class="pos-item-sku">${p.sku ? escHtml(p.sku) : escHtml(p.categoria || 'General')}</div>
                <div class="pos-item-bottom">
                    <span class="pos-item-price">${fQ(precio)}</span>
                    <span class="pos-stock ${stockCls}">${escHtml(stockLabel)}</span>
                </div>
            </div>
        </div>`;
    }).join('');
    _posToggleLoadMore(items.length > maxItems, visibles.length, items.length);
}

function _posToggleLoadMore(show, loaded, total) {
    const wrap = _posEl('posLoadMoreWrap');
    const btn = _posEl('posLoadMoreBtn');
    if (!wrap) return;
    wrap.style.display = show ? 'block' : 'none';
    if (show && btn) btn.textContent = `Mostrar más (${loaded} de ${total})`;
}
function posCargarMasItems() { _posPaginaActual++; renderPosCatalogo(); }

function posVerFichaProducto(prodId) {
    if (typeof esAdmin === 'function' && !esAdmin()) { showToast('Solo los administradores pueden ver la ficha del producto', '#FF9F0A'); return; }
    const prod = _posProductos.find(p => String(p.id) === String(prodId));
    if (!prod) return;
    const pPlata = Number(prod.precioPlata || 0), pOro = Number(prod.precioOro || 0);
    const imgUrl = prod.imagenUrl || prod.imagen_url || prod.fotoUrl || '';
    posDlg('Ficha · ' + prod.producto, `
        <div class="pos-ficha">
            <div class="pos-ficha-img">${imgUrl ? `<img src="${escAttr(imgUrl)}" alt="" onerror="this.style.display='none'" />` : `<span>${escHtml((prod.producto || '??').substring(0, 2).toUpperCase())}</span>`}</div>
            <div>
                <div class="pos-ficha-t">${escHtml(prod.producto)}</div>
                <div class="pos-muted">${prod.sku ? 'SKU: ' + escHtml(prod.sku) : ''} ${prod.categoria ? '· ' + escHtml(prod.categoria) : ''}</div>
                <div class="pos-ficha-p"><b>Público ${fQ(_pq().precioSegunLista(prod, 'Publico'))}</b>${pPlata > 0 ? ` · Plata ${fQ(pPlata)}` : ''}${pOro > 0 ? ` · Oro ${fQ(pOro)}` : ''}</div>
                <div class="pos-muted"><b>Tipo:</b> ${escHtml(prod.tipo || 'Producto')} · <b>Existencia:</b> ${prod.tipo === 'Servicio' ? 'Servicio (sin inventario)' : Number(prod.unidades || 0)}</div>
                ${prod.descripcion ? `<p class="pos-muted">${escHtml(prod.descripcion)}</p>` : ''}
            </div>
        </div>`);
}

/* ──────────────────────────────────────────────────────────────────
   CARRITO
────────────────────────────────────────────────────────────────── */
function _posNormLinea(it) {
    const prod = _posProductos.find(p => String(p.id) === String(it.id)) || it.prodOriginal || {};
    it.prodOriginal = it.prodOriginal || prod;
    it.tipo = it.tipo || prod.tipo || 'Producto';
    it.sku = it.sku !== undefined && it.sku !== '' ? it.sku : (prod.sku || '');
    it.producto = it.producto || prod.producto || 'Producto';
    // Descuento por línea heredado de una cotización → se aplica una sola vez al precio
    if (!it._norm) {
        it._norm = true;
        const d = Number(it.descuentoPct) || 0;
        if (d > 0 && d < 100) { it.precioUnit = _pq().r2(Number(it.precioUnit) * (1 - d / 100)); it.precioManual = true; }
        it.descuentoPct = 0;
    }
    const live = _posProductos.find(p => String(p.id) === String(it.id));
    it.stockMax = it.tipo === 'Servicio' ? null : (live ? Number(live.unidades || 0) : Number(it.stockMax || 0));
    it.total = _pq().r2(Number(it.cantidad) * Number(it.precioUnit));
    return it;
}

function posAgregarItem(prodId, cantidad) {
    const prod = _posProductos.find(p => String(p.id) === String(prodId));
    if (!prod) return;
    const cant = Number(cantidad) || 1;
    const esServicio = prod.tipo === 'Servicio';
    const stock = Number(prod.unidades || 0);
    const exist = _posCarrito.find(it => String(it.id) === String(prodId));
    const actual = exist ? exist.cantidad : 0;
    if (!esServicio && !_posPuedeSinStock() && actual + cant > stock) {
        showToast(stock <= 0 ? 'Producto agotado' : 'Existencia insuficiente: solo hay ' + stock, '#FF9F0A');
        return;
    }
    if (exist) {
        exist.cantidad = _pq().r2(exist.cantidad + cant);
    } else {
        const precioUnit = _pq().precioSegunLista(prod, _posListaPrecioActual);
        _posCarrito.push({ id: prod.id, producto: prod.producto, tipo: prod.tipo, sku: prod.sku || '', precioUnit: precioUnit, cantidad: cant, prodOriginal: prod, _norm: true });
    }
    _posSelLinea = String(prodId);
    const umbral = Number(_posCfg.stock_bajo_umbral) || 0;
    const restante = stock - (actual + cant);
    if (!esServicio && umbral > 0 && restante <= umbral && !(restante < 0)) showToast('Stock bajo: quedan ' + restante + ' de «' + prod.producto + '»', '#FF9F0A');
    if (!esServicio && restante < 0) showToast('Atención: se venderá sin existencias (' + restante + ')', '#FF9F0A');
    renderPosCarrito();
    renderPosCatalogo();
}

function posModificarCantidad(prodId, delta) {
    const it = _posCarrito.find(x => String(x.id) === String(prodId));
    if (!it) return;
    const nueva = _pq().r2(Number(it.cantidad) + delta);
    if (nueva <= 0) { posEliminarItem(prodId); return; }
    posSetCantidad(prodId, nueva);
}

function posSetCantidad(prodId, valor) {
    const it = _posCarrito.find(x => String(x.id) === String(prodId));
    if (!it) return;
    _posNormLinea(it);
    const v = _pq().validarCantidad(valor, (it.tipo === 'Servicio' || _posPuedeSinStock()) ? null : it.stockMax);
    if (!v.ok) {
        showToast(v.error, '#FF9F0A');
    } else {
        it.cantidad = v.cantidad;
    }
    renderPosCarrito();
    renderPosCatalogo();
}

function posSetPrecio(prodId, valor) {
    if (!_posPerm.editar_precio) { showToast('No tiene permiso para modificar precios', '#FF9F0A'); renderPosCarrito(); return; }
    const it = _posCarrito.find(x => String(x.id) === String(prodId));
    if (!it) return;
    const p = Number(valor);
    if (valor === '' || !isFinite(p) || p < 0 || Math.abs(_pq().r2(p) - p) > 1e-9) {
        showToast('Precio inválido (máximo 2 decimales, no negativo)', '#FF9F0A');
    } else {
        it.precioUnit = p;
        it.precioManual = Math.abs(p - _pq().precioSegunLista(it.prodOriginal, _posListaPrecioActual)) > 0.004;
    }
    renderPosCarrito();
}

function posEliminarItem(prodId) {
    _posCarrito = _posCarrito.filter(it => String(it.id) !== String(prodId));
    if (_posSelLinea === String(prodId)) _posSelLinea = null;
    renderPosCarrito();
    renderPosCatalogo();
}

function posVaciarCarrito() {
    if (!_posCarrito.length) return;
    if (confirm('¿Cancelar la venta actual y vaciar el carrito?')) {
        _posCarrito = [];
        _posSelLinea = null;
        _posIntento = null;
        const d = _posEl('posDescuentoPct'); if (d) d.value = 0;
        try { sessionStorage.removeItem('azyvion_pos_intento'); } catch (e) { /* sin sessionStorage */ }
        renderPosCarrito();
        renderPosCatalogo();
    }
}

function renderPosCarrito() {
    const tbody = _posEl('posCartTbody');
    if (!tbody) return;
    _posCarrito.forEach(_posNormLinea);
    const t = _posTotales();
    const totalItems = _posCarrito.reduce((s, it) => s + Number(it.cantidad), 0);
    const badge = _posEl('posCartCount');
    if (badge) badge.textContent = _pq().r2(totalItems);
    const mobTot = _posEl('posMobTotal'), mobCnt = _posEl('posMobCount');
    if (mobTot) mobTot.textContent = fQ(t.total);
    if (mobCnt) mobCnt.textContent = _pq().r2(totalItems);

    const puedePrecio = _posPerm.editar_precio;
    if (!_posCarrito.length) {
        tbody.innerHTML = `<div class="pos-cart-empty">
            <div class="pos-cart-empty-ico">🛒</div>
            <div><b>Orden vacía</b></div>
            <div class="pos-muted">Busca por nombre o SKU, o escanea un código y pulsa Enter.</div></div>`;
    } else {
        tbody.innerHTML = _posCarrito.map(it => {
            const sel = String(it.id) === String(_posSelLinea);
            const exceso = it.tipo !== 'Servicio' && !_posPuedeSinStock() && it.cantidad > it.stockMax;
            return `
            <div class="pos-line ${sel ? 'sel' : ''} ${exceso ? 'warn' : ''}" onclick="_posSelLinea='${escAttr(it.id)}';renderPosCarrito()">
                <div class="pos-line-main">
                    <div class="pos-line-name">${escHtml(it.producto)}</div>
                    <div class="pos-line-sub">
                        ${it.sku ? escHtml(it.sku) + ' · ' : ''}
                        ${puedePrecio
                            ? `<input class="pos-price-in" type="number" step="0.01" min="0" inputmode="decimal" value="${Number(it.precioUnit).toFixed(2)}" aria-label="Precio unitario"
                                    onclick="event.stopPropagation()" onchange="posSetPrecio('${escAttr(it.id)}', this.value)" onkeydown="if(event.key==='Enter')this.blur()" />`
                            : fQ(it.precioUnit)}
                        ${it.precioManual ? '<span class="pos-tag">precio editado</span>' : ''}
                        ${exceso ? `<span class="pos-tag err">solo hay ${it.stockMax}</span>` : ''}
                    </div>
                </div>
                <div class="pos-qty-control" onclick="event.stopPropagation()">
                    <button type="button" class="pos-qty-btn" aria-label="Disminuir" onclick="posModificarCantidad('${escAttr(it.id)}', -1)">−</button>
                    <input class="pos-qty-in" type="number" step="any" min="0" inputmode="decimal" value="${it.cantidad}" aria-label="Cantidad"
                           onchange="posSetCantidad('${escAttr(it.id)}', this.value)" onfocus="this.select()" onkeydown="if(event.key==='Enter')this.blur()" />
                    <button type="button" class="pos-qty-btn" aria-label="Aumentar" onclick="posModificarCantidad('${escAttr(it.id)}', 1)">+</button>
                </div>
                <div class="pos-line-total">${fQ(it.total)}</div>
                <button type="button" class="pos-line-del" title="Quitar" aria-label="Quitar" onclick="event.stopPropagation();posEliminarItem('${escAttr(it.id)}')">&times;</button>
            </div>`;
        }).join('');
    }

    const set = (id, v) => { const el = _posEl(id); if (el) el.textContent = v; };
    set('posSubtotal', fQ(t.subtotal));
    set('posDescMonto', t.descuento > 0 ? '− ' + fQ(t.descuento) : fQ(0));
    set('posIvaMonto', fQ(t.iva));
    set('posIvaLbl', t.ivaModalidad === 'sobre' ? `IVA ${t.ivaPct}% (se suma)` : `IVA ${t.ivaPct}% (incluido)`);
    set('posTotalPagar', fQ(t.total));
    const descRow = _posEl('posDescMontoRow');
    if (descRow) descRow.style.display = t.descuento > 0 ? '' : 'none';
    const btn = _posEl('posBtnCobrar');
    if (btn) {
        btn.disabled = !_posCarrito.length || t.total <= 0;
        btn.innerHTML = `<span>COBRAR</span><span class="pos-kbd">F9</span>`;
    }
    ['posBtnPendiente', 'posBtnCancelar'].forEach(id => { const b = _posEl(id); if (b) b.disabled = !_posCarrito.length; });
    _posResumenCliente();
}

function posToggleCarritoMovil(abrir) {
    const p = document.querySelector('.pos-cart-panel');
    if (!p) return;
    const open = abrir === undefined ? !p.classList.contains('open-sheet') : abrir;
    p.classList.toggle('open-sheet', open);
    document.body.classList.toggle('pos-sheet-open', open);
}

/* ──────────────────────────────────────────────────────────────────
   VENTAS PENDIENTES — [Lote 7] guardadas en el servidor (pos_ventas_pendientes): se pueden
   retomar desde cualquier equipo de la empresa. No son ventas: no mueven stock ni dinero.
   Al retomarla se elimina primero en el servidor (la «reclama»), así dos cajeros no cobran
   la misma. Sin conexión se guarda en este navegador y se sube sola al volver la conexión.
────────────────────────────────────────────────────────────────── */
function _posPendKey() {
    const s = _posSesion();
    return 'azyvion_pos_pend_' + (s.organization_id || '') + '_' + (s.usuario || s.nombre || '');
}
function _posLeerPendientes() {
    try { const a = JSON.parse(localStorage.getItem(_posPendKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function _posGuardarPendientes(arr) {
    try { localStorage.setItem(_posPendKey(), JSON.stringify(arr)); return true; } catch (e) { showToast('No se pudo guardar la venta pendiente en este navegador', '#FF453A'); return false; }
}
/** Promesa con la respuesta de window.api (nunca rechaza). */
function _posApi(nombre, arg) {
    return new Promise(resolve => {
        try {
            window.api.withSuccessHandler(r => resolve(r || { ok: false, error: 'Sin respuesta del servidor.' }))
                .withFailureHandler(e => resolve({ ok: false, error: (e && e.message) || String(e), incierto: true }))[nombre](arg);
        } catch (e) { resolve({ ok: false, error: e.message, incierto: true }); }
    });
}
let _posPendServidor = [];      // última lista leída del servidor
let _posPendSubiendo = false;
/** Sube al servidor las pendientes que quedaron solo en este navegador (versiones anteriores o sin conexión). */
async function _posSubirPendientesLocales() {
    if (_posPendSubiendo) return;
    const locales = _posLeerPendientes(); if (!locales.length) return;
    _posPendSubiendo = true;
    const quedan = [];
    for (const p of locales) {
        const r = await _posApi('posPendienteGuardar', { nota: p.nota, datos: p, sucursalId: _posSesion().sucursal_id || null });
        if (!r.ok) quedan.push(p);
    }
    _posGuardarPendientes(quedan);
    _posPendSubiendo = false;
}
async function _posActualizarBadgePendientes() {
    await _posSubirPendientesLocales();
    const r = await _posApi('posPendientes');
    if (r.ok) _posPendServidor = r.data || [];
    const n = (r.ok ? _posPendServidor.length : 0) + _posLeerPendientes().length;
    const b = _posEl('posPendBadge');
    if (b) { b.textContent = n; b.style.display = n ? '' : 'none'; }
}
async function posGuardarPendiente() {
    if (!_posCarrito.length) { showToast('No hay productos en la orden', '#FF9F0A'); return; }
    const nota = (prompt('Nombre o nota para identificar esta venta pendiente (opcional):', (_posClienteSel && _posClienteSel.id) ? _posClienteSel.nombre : '') || '').trim();
    const pend = {
        id: _pq().nuevaClave(), ts: Date.now(), nota: nota,
        cliente: _posClienteSel, lista: _posListaPrecioActual, descPct: _posPct(),
        items: _posCarrito.map(i => ({ id: i.id, cantidad: i.cantidad, precioUnit: i.precioUnit, precioManual: !!i.precioManual, producto: i.producto }))
    };
    const r = await _posApi('posPendienteGuardar', { nota: nota, datos: pend, sucursalId: _posSesion().sucursal_id || null });
    if (!r.ok) {
        if (!r.incierto && !/fetch|network|conexi/i.test(String(r.error))) { showToast('No se pudo guardar la venta pendiente: ' + r.error, '#FF453A'); return; }
        const arr = _posLeerPendientes(); arr.push(pend);            // sin conexión: queda en este navegador
        if (!_posGuardarPendientes(arr)) return;
        showToast('Sin conexión: la venta pendiente quedó en este equipo y se subirá al reconectar', '#FF9F0A');
    } else showToast('Venta guardada como pendiente ✓ (disponible en todos los equipos)', '#30D158');
    _posCarrito = []; _posSelLinea = null; _posIntento = null;
    const d = _posEl('posDescuentoPct'); if (d) d.value = 0;
    renderPosCarrito(); renderPosCatalogo(); _posActualizarBadgePendientes();
}
async function posAbrirPendientes() {
    posDlg('Ventas pendientes', '<div class="pos-empty">Cargando…</div>');
    await _posActualizarBadgePendientes();
    const yo = _posSesion().usuario || _posSesion().nombre || '';
    const lista = _posPendServidor.map(x => ({ id: x.id, srv: true, usuario: x.usuario, nota: x.nota || (x.datos && x.datos.nota), ts: x.created_at, items: (x.datos && x.datos.items) || [] }))
        .concat(_posLeerPendientes().map(x => ({ id: x.id, srv: false, usuario: yo, nota: x.nota, ts: x.ts, items: x.items || [] })));
    const filas = lista.length ? lista.map(p => {
        const tot = p.items.reduce((s, i) => s + Number(i.cantidad) * Number(i.precioUnit), 0);
        return `<div class="pos-hist-row">
            <div><b>${escHtml(p.nota || 'Sin nombre')}</b><div class="pos-muted">${new Date(p.ts).toLocaleString('es-GT')} · ${p.items.length} línea(s) · ~${fQ(tot)}${p.usuario && p.usuario !== yo ? ' · guardada por ' + escHtml(p.usuario) : ''}${p.srv ? '' : ' · <b>solo en este equipo</b>'}</div></div>
            <div class="pos-row-actions">
                <button type="button" class="pos-btn primary" onclick="posRetomarPendiente('${escAttr(p.id)}', ${p.srv})">Retomar</button>
                <button type="button" class="pos-btn danger-o" onclick="posEliminarPendiente('${escAttr(p.id)}', ${p.srv})">Descartar</button>
            </div></div>`;
    }).join('') : '<div class="pos-empty">No hay ventas pendientes.</div>';
    posDlg('Ventas pendientes', `<div class="pos-muted" style="margin-bottom:8px">Se comparten entre los equipos de la empresa. Los precios y existencias se vuelven a validar al retomarlas.</div>${filas}`);
}
async function posRetomarPendiente(id, srv) {
    if (_posCarrito.length && !confirm('La orden actual se reemplazará. ¿Continuar?')) return;
    let p;
    if (srv) {
        const fila = _posPendServidor.find(x => x.id === id);
        if (!fila) { showToast('Esa venta pendiente ya no está disponible', '#FF9F0A'); posAbrirPendientes(); return; }
        const r = await _posApi('posPendienteEliminar', { id: id });       // reclamarla antes de cargarla
        if (!r.ok) { showToast(r.error, r.yaTomada ? '#FF9F0A' : '#FF453A'); posAbrirPendientes(); return; }
        p = fila.datos || {};
    } else {
        const arr = _posLeerPendientes();
        p = arr.find(x => x.id === id);
        if (!p) return;
        _posGuardarPendientes(arr.filter(x => x.id !== id));
    }
    _posCarrito = []; let omitidos = 0;
    (p.items || []).forEach(i => {
        const prod = _posProductos.find(x => String(x.id) === String(i.id));
        if (!prod) { omitidos++; return; }
        const stock = prod.tipo === 'Servicio' ? Infinity : Number(prod.unidades || 0);
        const cant = Math.min(Number(i.cantidad), stock);
        if (!(cant > 0)) { omitidos++; return; }
        if (cant < Number(i.cantidad)) omitidos++;
        _posCarrito.push({ id: prod.id, producto: prod.producto, tipo: prod.tipo, sku: prod.sku || '', cantidad: cant, prodOriginal: prod, _norm: true,
            precioUnit: i.precioManual && _posPerm.editar_precio ? Number(i.precioUnit) : _pq().precioSegunLista(prod, p.lista || 'Publico'),
            precioManual: !!(i.precioManual && _posPerm.editar_precio) });
    });
    if (p.cliente) {
        _posClienteSel = p.cliente;
        const sel = _posEl('posClienteSelect');
        if (sel && p.cliente.id && [...sel.options].some(o => o.value === String(p.cliente.id))) sel.value = String(p.cliente.id);
    }
    _posListaPrecioActual = p.lista || 'Publico';
    document.querySelectorAll('.pos-lp-btn').forEach(b => b.classList.toggle('active', b.dataset.lp === _posListaPrecioActual));
    const d = _posEl('posDescuentoPct'); if (d) d.value = _posPerm.descuento ? (p.descPct || 0) : 0;
    _posIntento = null;
    posDlgCerrar();
    renderPosCarrito(); renderPosCatalogo(); _posActualizarBadgePendientes();
    if (omitidos) showToast(omitidos + ' línea(s) se omitieron o ajustaron por existencia/catálogo', '#FF9F0A');
}
async function posEliminarPendiente(id, srv) {
    if (!confirm('¿Descartar esta venta pendiente?')) return;
    if (srv) {
        const r = await _posApi('posPendienteEliminar', { id: id });
        if (!r.ok && !r.yaTomada) { showToast(r.error, '#FF453A'); return; }
    } else _posGuardarPendientes(_posLeerPendientes().filter(x => x.id !== id));
    posAbrirPendientes();
}


/* ──────────────────────────────────────────────────────────────────
   COBRO
────────────────────────────────────────────────────────────────── */
function _posRequiereCaja() {
    const c = _posCfg.caja_obligatoria;
    if (c === 'si') return true;
    if (c === 'no') return false;
    return !_posEsStarter();           // 'auto': los planes sin arqueo (Starter) venden sin turno
}
function _posPuedeSinStock() { return !!_posVentaSinStock; }
function _posDue() { return _pq().r2(_posTotales().total + _posPropina); }
function _posOptsPago() { return { propina: _posPropina, redondeo: _posCfg.redondeo_efectivo, metodos: _posCfg.metodos_habilitados }; }
function _posLblMetodo(m) { return _pq().etiquetaMetodo(_posCfg, m); }

function _posValidarAntesDeCobrar() {
    if (!_posCarrito.length) return 'Agrega productos a la orden antes de cobrar.';
    for (const it of _posCarrito) {
        _posNormLinea(it);
        const v = _pq().validarCantidad(it.cantidad, (it.tipo === 'Servicio' || _posPuedeSinStock()) ? null : it.stockMax);
        if (!v.ok) return `"${it.producto}": ${v.error}`;
        if (!isFinite(Number(it.precioUnit)) || Number(it.precioUnit) < 0) return `"${it.producto}": precio inválido.`;
    }
    const t = _posTotales();
    if (t.total <= 0) return 'El total a cobrar debe ser mayor a cero.';
    const nitMin = Number(_posCfg.nit_obligatorio_desde) || 0;
    const nit = String((_posClienteSel && _posClienteSel.nit) || 'C/F').toUpperCase();
    if (nitMin > 0 && t.total >= nitMin && nit === 'C/F') return 'Para ventas desde ' + fQ(nitMin) + ' se requiere el NIT del cliente (no Consumidor Final).';
    if (_posRequiereCaja() && !_posCajaAbierta) {
        return _posCajaEstado === 'error'
            ? 'No se pudo verificar el estado de la caja. Reintenta o recarga el POS.'
            : 'No hay una caja abierta. Abre la caja para poder cobrar.';
    }
    if (_posCaja && _posCaja.excedeHoras && _posCfg.turno_bloquear) return 'El turno lleva demasiado tiempo abierto. Ciérralo y abre uno nuevo para seguir cobrando.';
    return '';
}

function posAbrirModalCobro() {
    if (_posCobrando) return;
    const err = _posValidarAntesDeCobrar();
    if (err) {
        showToast(err, '#FF9F0A');
        if (!_posCajaAbierta && _posRequiereCaja() && _posCarrito.length && _posCajaEstado === 'cerrada') posAbrirAperturaCaja();
        return;
    }
    posToggleCarritoMovil(false);
    _posPendienteVerificar = null;
    _posPropina = 0;
    if (!_posClienteSel) _posClienteSel = { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad', lista_precio: 'Publico' };
    _posAbrirCobroDlg();
}

/** (Re)abre el diálogo de cobro; la clave de idempotencia queda ligada a esta venta Y a su propina. */
function _posAbrirCobroDlg() {
    const t = _posTotales();
    const fp = _pq().huellaCarrito(_posCarrito, _posClienteSel, t.descPct, _posListaPrecioActual) + '#tip' + _posPropina;
    let guardado = null;
    try { guardado = JSON.parse(sessionStorage.getItem('azyvion_pos_intento') || 'null'); } catch (e) { /* sin sessionStorage */ }
    if (guardado && guardado.fp === fp) _posIntento = guardado;
    else if (!_posIntento || _posIntento.fp !== fp) _posIntento = { key: _pq().nuevaClave(), fp: fp };
    try { sessionStorage.setItem('azyvion_pos_intento', JSON.stringify(_posIntento)); } catch (e) { /* ignorar */ }

    const habil = _posCfg.metodos_habilitados;
    const inicial = habil.indexOf('Efectivo') >= 0 ? 'Efectivo' : habil[0];
    _posPagos = [{ metodo: inicial, monto: _posDue().toFixed(2), referencia: '', cuentaBancariaId: '' }];
    const sug = _posCfg.propina_habilitada ? `
        <div class="pos-propina">
            <span class="pos-lbl">Propina</span>
            <button type="button" class="pos-chip ${_posPropina === 0 ? 'active' : ''}" onclick="posSetPropina(0)">Sin propina</button>
            ${(_posCfg.propina_sugeridas || []).map(p => `<button type="button" class="pos-chip ${_pq().r2(t.total * p / 100) === _posPropina ? 'active' : ''}" onclick="posSetPropina(${_pq().r2(t.total * p / 100)})">${p}% · ${fQ(_pq().r2(t.total * p / 100))}</button>`).join('')}
            <input class="pos-in sm" type="number" step="0.01" min="0" inputmode="decimal" id="posPropinaOtro" placeholder="Otra" aria-label="Otra propina" onchange="posSetPropina(this.value)" />
        </div>` : '';
    posDlg('Cobrar', `
        <div class="pos-cobro">
            <div class="pos-cobro-total">
                <div class="pos-cobro-lbl">${_posPropina > 0 ? 'TOTAL + PROPINA' : 'TOTAL A COBRAR'}</div>
                <div class="pos-cobro-monto" id="posCobroTotal">${fQ(_posDue())}</div>
                <div class="pos-cobro-sub">${escHtml(_posClienteSel.nombre)} · ${_posCarrito.reduce((s, i) => s + Number(i.cantidad), 0)} artículo(s)${t.descuento > 0 ? ' · desc. ' + fQ(t.descuento) : ''}${_posPropina > 0 ? ' · propina ' + fQ(_posPropina) : ''}</div>
            </div>
            ${sug}
            <div id="posPagosWrap"></div>
            ${habil.length > 1 ? '<div class="pos-cobro-add"><button type="button" class="pos-btn ghost" onclick="posAgregarPago()">＋ Dividir pago con otro método</button></div>' : ''}
            <div class="pos-cobro-res" id="posCobroRes"></div>
            <div id="posCobroNota" class="pos-muted" style="text-align:center"></div>
            <div id="posCobroMsg" class="pos-alert" style="display:none" role="alert"></div>
            <div class="pos-cobro-foot">
                <button type="button" class="pos-btn" id="posCobroCancel" onclick="posDlgCerrar()">Cancelar <span class="pos-kbd">Esc</span></button>
                <button type="button" class="pos-btn ok big" id="posCobroConfirm" onclick="posConfirmarVenta()">Confirmar cobro <span class="pos-kbd">Enter</span></button>
            </div>
            <div class="pos-muted" style="text-align:center;margin-top:6px">Se emite un comprobante interno. No es una factura fiscal (DTE/FEL) de la SAT.</div>
        </div>`);
    posRenderPagos();
}

function posSetPropina(v) {
    const n = Number(v);
    const total = _posTotales().total;
    if (!isFinite(n) || n < 0 || n > total || Math.abs(_pq().r2(n) - n) > 1e-9) { showToast('Propina inválida (0 a ' + fQ(total) + ', máximo 2 decimales)', '#FF9F0A'); return; }
    _posPropina = _pq().r2(n);
    _posAbrirCobroDlg();
}

function posRenderPagos() {
    const wrap = _posEl('posPagosWrap');
    if (!wrap) return;
    const iconos = { Efectivo: '💵', Tarjeta: '💳', Transferencia: '🏦' };
    const metodos = _posCfg.metodos_habilitados.map(m => [m, iconos[m] + ' ' + _posLblMetodo(m)]);
    wrap.innerHTML = _posPagos.map((p, i) => {
        const seg = metodos.map(m => `<button type="button" class="pos-seg-b ${p.metodo === m[0] ? 'active' : ''}" onclick="posPagoMetodo(${i},'${m[0]}')">${escHtml(m[1])}</button>`).join('');
        let extra = '';
        if (p.metodo === 'Efectivo') {
            extra = `<div class="pos-quick">
                <button type="button" class="pos-chip" onclick="posPagoRapido(${i},'exacto')">Exacto</button>
                ${[20, 50, 100, 200].map(b => `<button type="button" class="pos-chip" onclick="posPagoRapido(${i},${b})">Q${b}</button>`).join('')}
                <button type="button" class="pos-chip" onclick="posPagoRapido(${i},'redondo')">Redondear</button></div>`;
        } else {
            extra = `<div class="pos-grid2">
                ${p.metodo === 'Transferencia' ? `<div class="form-field"><label class="pos-lbl" for="posPagoCta${i}">Cuenta destino</label>
                    <select class="pos-in" id="posPagoCta${i}" onchange="posPagoCampo(${i},'cuentaBancariaId',this.value)">
                        <option value="">Sin cuenta bancaria</option>
                        ${_posCuentas.map(b => `<option value="${escAttr(b.id)}" ${String(p.cuentaBancariaId) === String(b.id) ? 'selected' : ''}>${escHtml(b.nombre)} · ${escHtml(b.banco || '')}</option>`).join('')}
                    </select></div>` : ''}
                <div class="form-field"><label class="pos-lbl" for="posPagoRef${i}">${p.metodo === 'Tarjeta' ? 'No. de autorización del voucher *' : 'No. de boleta / transacción *'}</label>
                    <input class="pos-in" id="posPagoRef${i}" value="${escAttr(p.referencia)}" placeholder="${p.metodo === 'Tarjeta' ? 'Ej. 884512' : 'Ej. 98452104'}" autocomplete="off"
                           oninput="posPagoCampo(${i},'referencia',this.value)" /></div></div>
                ${p.metodo === 'Tarjeta' ? '<div class="pos-muted">Cobre primero en su terminal de tarjetas y anote la autorización. Azyvion no procesa ni confirma pagos con tarjeta.</div>' : '<div class="pos-muted">Verifique que el depósito/transferencia esté acreditado antes de confirmar.</div>'}`;
        }
        return `<div class="pos-pay-row">
            <div class="pos-pay-head"><div class="pos-seg">${seg}</div>
                ${_posPagos.length > 1 ? `<button type="button" class="pos-line-del" title="Quitar pago" aria-label="Quitar pago" onclick="posQuitarPago(${i})">&times;</button>` : ''}</div>
            <label class="pos-lbl" for="posPagoMonto${i}">${p.metodo === 'Efectivo' ? 'Efectivo recibido (Q)' : 'Monto a cobrar (Q)'}</label>
            <input class="pos-in big" id="posPagoMonto${i}" type="number" step="0.01" min="0" inputmode="decimal" value="${escAttr(p.monto)}" ${i === 0 ? 'data-autofocus' : ''}
                   oninput="posPagoCampo(${i},'monto',this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();posConfirmarVenta()}" onfocus="this.select()" />
            ${extra}</div>`;
    }).join('');
    posPagoResumen();
    const first = _posEl('posPagoMonto0'); if (first) { first.focus(); first.select(); }
}

function posPagoMetodo(i, metodo) {
    const p = _posPagos[i]; if (!p) return;
    p.metodo = metodo; p.referencia = ''; p.cuentaBancariaId = '';
    if (_posPagos.length === 1) p.monto = _posDue().toFixed(2);
    posRenderPagos();
}
function posPagoCampo(i, campo, valor) {
    if (!_posPagos[i]) return;
    _posPagos[i][campo] = valor;
    posPagoResumen();
}
function posAgregarPago() {
    const t = _posDue();
    const usados = _posPagos.map(p => p.metodo);
    const otro = _posCfg.metodos_habilitados.find(m => usados.indexOf(m) < 0) || _posCfg.metodos_habilitados.find(m => m !== 'Efectivo') || _posCfg.metodos_habilitados[0];
    // Sugerencia: si hay un único pago en efectivo, la mitad queda en efectivo y el resto en el nuevo método
    if (_posPagos.length === 1 && _posPagos[0].metodo === 'Efectivo') _posPagos[0].monto = _pq().r2(t / 2).toFixed(2);
    const cubierto = _posPagos.reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const resto = Math.max(0, _pq().r2(t - cubierto));
    _posPagos.push({ metodo: otro, monto: resto > 0 ? resto.toFixed(2) : '', referencia: '', cuentaBancariaId: '' });
    posRenderPagos();
    const ult = _posEl('posPagoMonto' + (_posPagos.length - 1)); if (ult) { ult.focus(); ult.select(); }
}
function posQuitarPago(i) {
    _posPagos.splice(i, 1);
    if (_posPagos.length === 1) _posPagos[0].monto = _posDue().toFixed(2);
    posRenderPagos();
}
function posPagoRapido(i, valor) {
    const t = _posDue();
    const electronico = _posPagos.reduce((s, p) => p.metodo !== 'Efectivo' ? s + (Number(p.monto) || 0) : s, 0);
    const aplicado = _pq().redondearEfectivo(Math.max(0, _pq().r2(t - electronico)), _posCfg.redondeo_efectivo);
    let m;
    if (valor === 'exacto') m = aplicado;
    else if (valor === 'redondo') m = Math.ceil(aplicado / 10) * 10;
    else m = valor >= aplicado ? valor : Math.ceil(aplicado / valor) * valor;   // billete insuficiente → múltiplo mínimo que cubre
    _posPagos[i].monto = m.toFixed(2);
    const inp = _posEl('posPagoMonto' + i); if (inp) { inp.value = _posPagos[i].monto; inp.focus(); }
    posPagoResumen();
}

function posPagoResumen() {
    const t = _posTotales().total;
    const due = _posDue();
    const pagos = _posPagos.map(p => ({ metodo: p.metodo, monto: p.monto, referencia: p.referencia }));
    const v = _pq().validarPagos(t, pagos, _posOptsPago());
    const res = _posEl('posCobroRes');
    const btn = _posEl('posCobroConfirm');
    const suma = _pq().r2(_posPagos.reduce((s, p) => s + (Number(p.monto) || 0), 0));
    let linea3;
    if (v.ok) linea3 = `<div class="pos-res-c"><span>Vuelto</span><b class="vuelto">${fQ(v.cambio)}</b></div>`;
    else {
        const objetivo = (v.efectivoAplicado || v.electronico) ? _pq().r2(v.efectivoAplicado + v.electronico) : due;
        const falta = Math.max(0, _pq().r2(objetivo - suma));
        linea3 = `<div class="pos-res-c"><span>${falta > 0 ? 'Falta' : 'Vuelto'}</span><b class="${falta > 0 ? 'falta' : 'vuelto'}">${fQ(falta > 0 ? falta : 0)}</b></div>`;
    }
    if (res) res.innerHTML = `
        <div class="pos-res-c"><span>${_posPropina > 0 ? 'Total + propina' : 'Total'}</span><b>${fQ(_pq().r2(due + v.redondeo))}</b></div>
        <div class="pos-res-c"><span>Recibido</span><b>${fQ(suma)}</b></div>${linea3}`;
    const nota = _posEl('posCobroNota');
    if (nota) nota.textContent = v.redondeo ? 'Redondeo de efectivo: ' + (v.redondeo > 0 ? '+' : '−') + fQ(Math.abs(v.redondeo)) + ' (múltiplo de Q' + _posCfg.redondeo_efectivo.toFixed(2) + ')' : '';
    if (btn && !_posCobrando) btn.disabled = !v.ok;
    if (!_posCobrando) _posMsg('posCobroMsg', v.ok ? '' : v.error, v.ok ? 'ok' : 'warn');
    return v;
}

function _posArmarPayload() {
    const t = _posTotales();
    const c = _posClienteSel || { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad' };
    return {
        idempotency_key: _posIntento.key,
        items: _posCarrito.map(it => ({ id: it.id, cantidad: Number(it.cantidad), precioUnit: Number(it.precioUnit) })),
        descuentoPct: t.descPct,
        total: t.total,
        propina: _posPropina,
        listaPrecio: _posListaPrecioActual,
        clienteId: c.id || null,
        clienteNombre: c.nombre || 'Consumidor Final (C/F)',
        nit: c.nit || 'C/F',
        direccion: c.direccion || 'Ciudad',
        permitir_sin_caja: !_posRequiereCaja(),
        cotizacionId: window._posCotizacionOrigenId || null,
        pagos: _posPagos.map(p => ({
            metodo: p.metodo, monto: Number(p.monto),
            referencia: p.metodo === 'Efectivo' ? undefined : String(p.referencia || '').trim(),
            cuentaBancariaId: p.metodo === 'Transferencia' && p.cuentaBancariaId ? p.cuentaBancariaId : undefined
        }))
    };
}

function _posCobroBloquear(on, texto) {
    _posCobrando = on;
    _posDlgBloqueado = on;
    const btn = _posEl('posCobroConfirm'), can = _posEl('posCobroCancel');
    if (btn) { btn.disabled = on; if (texto) btn.innerHTML = on ? '<span class="pos-spin"></span> ' + texto : texto; }
    if (can) can.disabled = on;
    document.querySelectorAll('#posPagosWrap input, #posPagosWrap select, #posPagosWrap button').forEach(e => { e.disabled = on; });
}

function posConfirmarVenta() {
    if (_posCobrando) return;                       // doble clic / Enter repetido
    if (_posPendienteVerificar) { _posVerificarVenta(_posPendienteVerificar, 1); return; }
    const v = posPagoResumen();
    if (!v.ok) { _posMsg('posCobroMsg', v.error, 'warn'); return; }
    const err = _posValidarAntesDeCobrar();
    if (err) { _posMsg('posCobroMsg', err, 'err'); return; }
    _posCobroBloquear(true, 'Registrando venta…');
    _posMsg('posCobroMsg', '');
    const payload = _posArmarPayload();
    window.api
        .withSuccessHandler(res => _posRespuestaVenta(res, payload))
        .withFailureHandler(e => _posRespuestaVenta({ ok: false, incierto: true, error: (e && e.message) || String(e) }, payload))
        .registrarVentaPos(payload);
}

function _posRespuestaVenta(res, payload) {
    if (res && res.ok && res.ticket) { _posVentaRegistrada(res.ticket, !!res.duplicado); return; }
    const msg = (res && res.error) || 'Fallo desconocido';
    if (res && res.incierto) { _posVerificarVenta(payload, 1); return; }
    // Rechazo explícito del servidor: nada se registró; la clave sigue siendo válida solo si el carrito no cambia
    _posCobroBloquear(false, 'Confirmar cobro <span class="pos-kbd">Enter</span>');
    posPagoResumen();
    _posMsg('posCobroMsg', 'La venta NO se registró: ' + msg, 'err');
    if (/existencia|total cambi|no est[aá] disponible|Recargue/i.test(msg)) { _posIntento = null; try { sessionStorage.removeItem('azyvion_pos_intento'); } catch (e) { /* ignorar */ } loadPos(); }
}

/** Respuesta incierta (corte de red/timeout): consulta la venta por su clave antes de permitir reintento. */
function _posVerificarVenta(payload, intento) {
    _posCobroBloquear(true, 'Verificando con el servidor…');
    _posMsg('posCobroMsg', 'No se recibió respuesta del servidor. Verificando si la venta quedó registrada… NO cobre de nuevo.', 'warn');
    window.api
        .withSuccessHandler(r => {
            if (r && r.ok && r.encontrada && r.ticket) { _posVentaRegistrada(r.ticket, true); return; }
            if (r && r.ok && !r.incierto && r.encontrada === false) {
                _posPendienteVerificar = null;
                _posCobroBloquear(false, 'Reintentar cobro <span class="pos-kbd">Enter</span>');
                _posMsg('posCobroMsg', 'Se verificó en el servidor: la venta NO se registró. Puede reintentar con seguridad (no se duplicará).', 'err');
                return;
            }
            _posVerificacionFallida(payload, intento);
        })
        .withFailureHandler(() => _posVerificacionFallida(payload, intento))
        .posObtenerVenta({ key: payload.idempotency_key });
}
function _posVerificacionFallida(payload, intento) {
    if (intento < 3) { setTimeout(() => _posVerificarVenta(payload, intento + 1), 1500 * intento); return; }
    _posPendienteVerificar = payload;
    _posCobroBloquear(false, 'Verificar estado de la venta');
    const btn = _posEl('posCobroConfirm'); if (btn) btn.disabled = false;
    _posMsg('posCobroMsg', 'No se pudo confirmar si la venta se registró (sin conexión). NO cobre de nuevo: restablezca la conexión y pulse «Verificar estado de la venta». La clave de esta venta se conserva, así un reintento nunca duplica.', 'err');
}

function _posVentaRegistrada(ticket, yaExistia) {
    _posPendienteVerificar = null;
    _posCobroBloquear(false);
    _posDlgBloqueado = false;
    // Pasos de limpieza: la venta está en la base de datos
    _posCarrito = []; _posSelLinea = null; _posIntento = null; _posPagos = [];
    try { sessionStorage.removeItem('azyvion_pos_intento'); } catch (e) { /* ignorar */ }
    const d = _posEl('posDescuentoPct'); if (d) d.value = 0;
    const cotId = window._posCotizacionOrigenId;
    if (cotId) {
        window._posCotizacionOrigenId = null;
        if (window.api && typeof window.api.updateEstadoCotizacion === 'function') window.api.updateEstadoCotizacion({ id: cotId, estado: 'Aprobada' });
        if (typeof loadCotizaciones === 'function') loadCotizaciones();
    }
    renderPosCarrito();
    window._ultimoTicket = ticket;
    posMostrarExito(ticket, yaExistia);
    if (_posCfg.ticket_autoimprimir && !yaExistia) setTimeout(posImprimirTicket, 450);
    // Existencias y caja frescas desde el servidor
    loadPos();
    if (typeof loadInventario === 'function') loadInventario();
    if (typeof loadTransacciones === 'function') loadTransacciones();
}

function posMostrarExito(t, yaExistia) {
    const cambio = Number(t.cambio || 0);
    posDlg('Venta registrada', `
        <div class="pos-exito" role="status">
            <div class="pos-exito-ico" aria-hidden="true">✓</div>
            <div class="pos-exito-t">${yaExistia ? 'Venta confirmada con el servidor (no se duplicó)' : 'Venta registrada correctamente'}</div>
            <div class="pos-exito-num">${escHtml(t.numero)}</div>
            <div class="pos-exito-tot">${fQ(t.total)}</div>
            ${cambio > 0 ? `<div class="pos-exito-cambio">ENTREGUE EL VUELTO<b>${fQ(cambio)}</b></div>` : ''}
            <div class="pos-muted">${escHtml(t.metodoPago || '')} · Cajero: ${escHtml(t.cajero || '')}${t.cajaTurnoId ? ' · Turno ' + escHtml(t.cajaTurnoId) : ''}</div>
            <div class="pos-exito-btns">
                <button type="button" class="pos-btn" onclick="posImprimirTicket()">🖨 Imprimir <span class="pos-kbd">P</span></button>
                <button type="button" class="pos-btn" onclick="posMostrarTicketTermico(window._ultimoTicket)">Ver comprobante</button>
                <button type="button" class="pos-btn" onclick="posEnviarWhatsApp('comprobante')">WhatsApp</button>
                ${_posCfg.encuesta_url ? `<button type="button" class="pos-btn" onclick="posEnviarWhatsApp('encuesta')">Pedir opinión</button>` : ''}
                <button type="button" class="pos-btn ok big" data-autofocus onclick="posDlgCerrar();posFocoBuscar()">Nueva venta <span class="pos-kbd">Enter</span></button>
            </div>
        </div>`);
}
function posFocoBuscar() { const i = _posEl('posSearchInput'); if (i) { i.focus(); i.select(); } }

/* ──────────────────────────────────────────────────────────────────
   COMPROBANTE (interno) · vista previa · impresión 80 mm
────────────────────────────────────────────────────────────────── */
function posTicketHtml(t, opts) {
    opts = opts || {};
    const em = t.empresa || (typeof EMPRESA !== 'undefined' ? EMPRESA : {}) || {};
    const q = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const d = new Date(t.fecha);
    const fecha = d.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });
    const anulada = t.estado === 'Anulada', devuelta = t.estado === 'Devuelta' || t.estado === 'Devuelta parcial';
    const nItems = (t.items || []).reduce((s, i) => s + Number(i.cantidad), 0);
    const items = (t.items || []).map(it => `<tr>
            <td class="q">${Number(it.cantidad)}</td>
            <td class="d">${escHtml(it.descripcion)}<div class="s">${q(it.precioUnit)} c/u${(it.sku && _posCfg.mostrar_sku) ? ' · ' + escHtml(it.sku) : ''}${Number(it.cantidadDevuelta) > 0 ? ' · devuelto ' + Number(it.cantidadDevuelta) : ''}</div></td>
            <td class="r">${q(it.total)}</td></tr>`).join('');
    const pagos = (t.pagos || []).map(p => `<div class="row"><span>${escHtml(_posLblMetodo(p.metodo))}${p.referencia ? ' <i>#' + escHtml(p.referencia) + '</i>' : ''}</span><span>${q(p.monto)}</span></div>`).join('');
    const efectivo = (t.pagos || []).find(p => p.metodo === 'Efectivo');
    const ivaLinea = t.ivaModalidad === 'sobre' ? 'IVA ' + Number(t.ivaPct) + '%' : 'IVA incluido ' + Number(t.ivaPct) + '%';
    const pie = (em.pieTicket || '').trim();
    const contacto = [em.telefono ? 'Tel. ' + em.telefono : '', em.correo || '', em.sitio || ''].filter(Boolean).map(escHtml).join(' · ');
    const cfg = _posCfg;
    const propina = Number(t.propina) || 0, redondeo = Number(t.redondeo) || 0;
    const cobrado = _pq().r2(Number(t.total) + propina + redondeo);
    const NOMBRES = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', whatsapp: 'WhatsApp', x: 'X', youtube: 'YouTube' };
    const redes = (cfg.mostrar_redes && em.redes) ? Object.keys(NOMBRES).filter(k => em.redes[k]).map(k => `<div><b>${NOMBRES[k]}</b> ${escHtml(em.redes[k])}</div>`).join('') : '';
    const qr = cfg.mostrar_qr ? posQrSvg(t.numero) : '';
    return `
    <div class="tk w${cfg.ancho_papel === '58' ? '58' : '80'}">
        ${opts.copia ? `<div class="copy">${escHtml(opts.copia)}</div>` : ''}
        ${opts.reimpresion ? '<div class="stamp">REIMPRESIÓN</div>' : ''}
        ${anulada ? '<div class="stamp bad">VENTA ANULADA</div>' : (devuelta ? `<div class="stamp bad">${escHtml(t.estado.toUpperCase())}</div>` : '')}
        <div class="head">
            ${em.logoUrl ? `<img class="logo" src="${escAttr(em.logoUrl)}" alt="">` : ''}
            <div class="nm">${escHtml(em.nombre || 'AZYVION CRM')}</div>
            ${em.eslogan ? `<div class="s">${escHtml(em.eslogan)}</div>` : ''}
            <div class="s">NIT ${escHtml(em.nit || 'C/F')}${em.direccion ? ' · ' + escHtml(em.direccion) : ''}</div>
            ${contacto ? `<div class="s">${contacto}</div>` : ''}
            ${(cfg.ticket_encabezado || '').trim() ? `<div class="enc">${escHtml(cfg.ticket_encabezado).split(String.fromCharCode(10)).join('<br>')}</div>` : ''}
        </div>
        <div class="title">COMPROBANTE DE VENTA</div>
        <div class="num">${escHtml(t.numero)}</div>
        <div class="meta">
            <div><span>Fecha</span><b>${fecha} ${hora}</b></div>
            ${cfg.mostrar_cajero ? `<div><span>Cajero</span><b>${escHtml(t.cajero || '')}</b></div>` : ''}
            <div class="wide"><span>Cliente</span><b>${escHtml(t.cliente || 'Consumidor Final (C/F)')}</b></div>
            <div><span>NIT</span><b>${escHtml(t.nit || 'C/F')}</b></div>
            ${(t.cajaTurnoId && cfg.mostrar_turno) ? `<div><span>Turno</span><b>${escHtml(t.cajaTurnoId)}</b></div>` : ''}
        </div>
        <table><thead><tr><th class="q">Cant</th><th class="d">Descripción</th><th class="r">Importe</th></tr></thead><tbody>${items}</tbody></table>
        <div class="cnt">${nItems} artículo(s)</div>
        <div class="sums">
            <div class="row"><span>Subtotal</span><span>${q(t.subtotal)}</span></div>
            ${Number(t.descuento) > 0 ? `<div class="row"><span>Descuento${Number(t.descuentoPct) ? ' ' + Number(t.descuentoPct) + '%' : ''}</span><span>− ${q(t.descuento)}</span></div>` : ''}
            ${cfg.mostrar_iva ? `<div class="row"><span>${ivaLinea}</span><span>${q(t.iva)}</span></div>` : ''}
            ${propina > 0 ? `<div class="row"><span>Propina</span><span>${q(propina)}</span></div>` : ''}
            ${redondeo !== 0 ? `<div class="row"><span>Redondeo</span><span>${redondeo > 0 ? '+' : '−'} ${q(Math.abs(redondeo))}</span></div>` : ''}
        </div>
        <div class="total"><span>${(propina > 0 || redondeo !== 0) ? 'TOTAL A PAGAR' : 'TOTAL'}</span><span>${q(cobrado)}</span></div>
        <div class="pay">
            <div class="cap">FORMA DE PAGO</div>
            ${pagos}
            ${efectivo && Number(t.cambio) > 0 ? `<div class="row"><span>Efectivo recibido</span><span>${q(efectivo.recibido)}</span></div><div class="row b"><span>Su vuelto</span><span>${q(t.cambio)}</span></div>` : ''}
            ${Number(t.reembolsado) > 0 ? `<div class="row b"><span>Reembolsado</span><span>${q(t.reembolsado)}</span></div>` : ''}
        </div>
        ${redes ? `<div class="redes">${redes}</div>` : ''}
        ${qr ? `<div class="qr">${qr}<div class="s">${escHtml(t.numero)}</div></div>` : ''}
        <div class="thx">${pie ? escHtml(pie).replace(/\n/g, '<br>') : '¡Gracias por su compra!'}</div>
        <div class="legal">Comprobante interno sin validez fiscal.${t.felNoCertificado ? ' No es una factura electrónica (DTE/FEL).' : ''}</div>
    </div>`;
}

const _POS_TICKET_CSS = `
 .tk{font-family:'Segoe UI',Arial,Helvetica,sans-serif;font-size:12px;line-height:1.35;color:#111;background:#fff;width:100%;max-width:302px;margin:0 auto;padding:12px 10px}
 .tk *{box-sizing:border-box}
 .tk .head{text-align:center;padding-bottom:8px;border-bottom:2px solid #111}
 .tk .logo{max-height:52px;max-width:200px;object-fit:contain;margin-bottom:4px}
 .tk .nm{font-size:17px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;line-height:1.15}
 .tk .s{font-size:10.5px;color:#555}
 .tk .title{text-align:center;font-size:10.5px;font-weight:700;letter-spacing:2px;margin-top:8px;color:#444}
 .tk .num{text-align:center;font-size:19px;font-weight:800;letter-spacing:.5px;margin:1px 0 8px}
 .tk .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 8px;padding:7px 0;border-top:1px dashed #999;border-bottom:1px dashed #999;margin-bottom:6px}
 .tk .meta div{display:flex;flex-direction:column;min-width:0}.tk .meta .wide{grid-column:1/-1}
 .tk .meta span{font-size:9.5px;color:#777;text-transform:uppercase;letter-spacing:.6px}.tk .meta b{font-size:11.5px;font-weight:600;word-break:break-word}
 .tk table{width:100% !important;min-width:0 !important;table-layout:fixed;border-collapse:collapse}
 .tk th,.tk td{position:static !important;min-width:0 !important}
 .tk td,.tk th{color:#111;font-size:inherit;background:none;white-space:normal;border-left:0;border-right:0}
 .tk th{font-size:9.5px !important;text-transform:uppercase;letter-spacing:.6px;color:#777;font-weight:600;text-align:left;padding:3px 0;border-bottom:1px solid #111}
 .tk td{padding:5px 0;vertical-align:top;border-bottom:1px dotted #ccc}
 .tk th.q,.tk td.q{width:28px;text-align:left;font-weight:700}.tk th.r,.tk td.r{width:82px;text-align:right;white-space:nowrap;font-weight:600}.tk th.r{font-weight:600}
 .tk .d{padding-right:6px;overflow-wrap:anywhere}
 .tk .cnt{font-size:10px;color:#777;text-align:right;margin:3px 0 6px}
 .tk .row{display:flex;justify-content:space-between;gap:8px;padding:1.5px 0}.tk .row.b{font-weight:800}.tk .row i{font-style:normal;color:#666;font-size:10.5px}
 .tk .sums{padding-bottom:4px}
 .tk .total{display:flex;justify-content:space-between;align-items:baseline;background:#111;color:#fff;padding:8px 10px;border-radius:4px;font-size:18px;font-weight:800;margin:2px 0 10px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
 .tk .total span:first-child{font-size:12px;letter-spacing:1.5px}
 .tk .pay{border:1px solid #bbb;border-radius:4px;padding:6px 8px}.tk .cap{font-size:9.5px;letter-spacing:1px;color:#777;margin-bottom:2px}
 .tk .thx{text-align:center;font-size:13px;font-weight:700;margin:12px 0 4px}
 .tk .legal{text-align:center;font-size:9px;color:#777;border-top:1px dashed #999;padding-top:6px;margin-top:6px}
 .tk .stamp{text-align:center;font-weight:800;letter-spacing:3px;font-size:12px;border:2px solid #111;padding:3px;margin-bottom:8px}
 .tk .stamp.bad{border-color:#b00020;color:#b00020}
 .tk .total span:last-child{white-space:nowrap}.tk.w58 .total span:first-child{font-size:9.5px;letter-spacing:.3px}
 .tk.w58{max-width:210px;font-size:11px}.tk.w58 .nm{font-size:15px}.tk.w58 .num{font-size:16px}.tk.w58 .total{font-size:16px}
 .tk .enc{font-size:10.5px;margin-top:4px;color:#333}
 .tk .redes{text-align:center;font-size:10.5px;margin-top:8px;line-height:1.5}.tk .redes b{font-weight:700}
 .tk .qr{text-align:center;margin-top:8px}.tk .qr svg{width:96px;height:96px}
 .tk .copy{text-align:center;font-size:10px;letter-spacing:1.5px;font-weight:700;color:#555;margin-bottom:6px}
 .tk .c{text-align:center}.tk .b{font-weight:700}.tk .sep{border-top:1px dashed #999;margin:7px 0}
 .tk .row.tot{font-size:15px;font-weight:800;border-top:1px solid #111;margin-top:4px;padding-top:4px}`;

function posMostrarTicketTermico(t, opts) {
    if (!t) return;
    opts = opts || {};
    window._ultimoTicket = t;
    window._ultimoTicketOpts = opts;
    posDlg('Comprobante · ' + t.numero, `
        <style>${_POS_TICKET_CSS}</style>
        <div class="pos-ticket-prev" id="ticketTermicoArea">${posTicketHtml(t, opts)}</div>
        <div class="pos-mail">
            <input class="pos-in" id="posTicketCorreoDestino" type="email" placeholder="correo@cliente.com" value="${escAttr(t.clienteEmail || '')}" aria-label="Correo del cliente" />
            <button type="button" class="pos-btn" id="posBtnEnviarCorreo" onclick="posEnviarTicketPorCorreo()">✉ Enviar</button>
        </div>
        <div id="posTicketCorreoStatus" class="pos-muted" style="display:none"></div>
        <div class="pos-exito-btns">
            <button type="button" class="pos-btn primary" data-autofocus onclick="posImprimirTicket()">🖨 Imprimir <span class="pos-kbd">P</span></button>
            <button type="button" class="pos-btn" onclick="posEnviarWhatsApp('comprobante')">WhatsApp</button>
            <button type="button" class="pos-btn" onclick="posDlgCerrar()">Cerrar</button>
        </div>`);
}

function _posImprimirHtml(html, titulo) {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    const d = f.contentWindow.document;
    d.open();
    d.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(titulo)}</title>
        <style>@page{margin:0;size:${_posCfg.ancho_papel === '58' ? '58' : '80'}mm auto}html,body{margin:0;padding:0;background:#fff}${_POS_TICKET_CSS}</style></head><body>${html}</body></html>`);
    d.close();
    setTimeout(() => {
        try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { showToast('No se pudo abrir la impresión', '#FF453A'); }
        setTimeout(() => f.remove(), 2000);
    }, 250);
}

function posImprimirTicket() {
    const t = window._ultimoTicket;
    if (!t) return;
    const n = Math.min(3, Math.max(1, Number(_posCfg.ticket_copias) || 1));
    const rot = ['ORIGINAL · CLIENTE', 'COPIA · CAJA', 'COPIA ADICIONAL'];
    const base = window._ultimoTicketOpts || {};
    const html = Array.from({ length: n }, (_, i) => `<div style="page-break-after:${i < n - 1 ? 'always' : 'auto'}">${posTicketHtml(t, Object.assign({}, base, n > 1 ? { copia: rot[i] } : {}))}</div>`).join('');
    _posImprimirHtml(html, 'Comprobante ' + t.numero);
}

/* ── WhatsApp: abre el mensaje listo para enviar (sin API; el envío lo confirma la persona) ── */
function _posAplicarPlantilla(tpl, vars) {
    return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}
function posEnviarWhatsApp(tipo) {
    const t = window._ultimoTicket; if (!t) return;
    const cli = _posClientes.find(x => String(x.id) === String(t.clienteId));
    let tel = String((cli && cli.telefono) || '').replace(/\D/g, '');
    if (tel.length < 8) tel = String(prompt('Número de WhatsApp del cliente (con código de país si no es de Guatemala):', '') || '').replace(/\D/g, '');
    if (tel.length === 8) tel = '502' + tel;
    if (tel.length < 10) { showToast('Número de WhatsApp inválido', '#FF9F0A'); return; }
    const emp = (t.empresa && t.empresa.nombre) || (typeof EMPRESA !== 'undefined' && EMPRESA.nombre) || 'nuestra tienda';
    const plantilla = tipo === 'encuesta' ? _posCfg.mensaje_encuesta : _posCfg.mensaje_comprobante;
    const texto = _posAplicarPlantilla(plantilla, { nombre: t.cliente || '', empresa: emp, numero: t.numero, total: fQ(t.total), enlace: _posCfg.encuesta_url || '' });
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
}

/** Abre el comprobante de una venta registrada (p. ej. desde la ficha del cliente). */
function posAbrirTicketVenta(ventaId) {
    window.api.withSuccessHandler(r => {
        if (r && r.ok && r.ticket) posMostrarTicketTermico(r.ticket);
        else showToast((r && r.error) || 'No se encontró la venta', '#FF453A');
    }).withFailureHandler(e => showToast('Sin conexión: ' + ((e && e.message) || e), '#FF453A')).posObtenerVenta({ ventaId: ventaId });
}

function posEnviarTicketPorCorreo() {
    const input = _posEl('posTicketCorreoDestino');
    const statusEl = _posEl('posTicketCorreoStatus');
    const btn = _posEl('posBtnEnviarCorreo');
    const email = (input && input.value.trim()) || '';
    if (!email || !email.includes('@')) { showToast('Ingresa un correo electrónico válido', '#FF9F0A'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Enviando comprobante…'; }
    window.api
        .withSuccessHandler(function (res) {
            if (btn) { btn.disabled = false; btn.textContent = '✉ Enviar'; }
            if (res && res.ok) { if (statusEl) statusEl.textContent = '✓ ' + (res.mensaje || 'Enviado'); showToast('Comprobante enviado a ' + email, '#30D158'); }
            else { if (statusEl) statusEl.textContent = (res && res.error) || 'Fallo al enviar'; showToast('Error enviando correo', '#FF453A'); }
        })
        .withFailureHandler(function (err) {
            if (btn) { btn.disabled = false; btn.textContent = '✉ Enviar'; }
            if (statusEl) statusEl.textContent = 'Error: ' + ((err && err.message) || err);
        })
        .enviarTicketCorreo({ correo: email, ticket: window._ultimoTicket });
}


/* ──────────────────────────────────────────────────────────────────
   CAJA Y TURNOS (estado real del servidor; nunca se simula)
────────────────────────────────────────────────────────────────── */
function _posCajaCheckStatus() {
    if (!_posEl('posCajaBar')) return;
    window.api
        .withSuccessHandler(function (res) {
            if (!res || !res.ok) {
                _posCajaEstado = 'error'; _posCajaAbierta = false; _posCajaId = null; _posCaja = null;
                _renderCajaBar((res && res.error) || 'Sin respuesta');
                return;
            }
            if (res.cajaAbierta) {
                _posCajaEstado = 'abierta'; _posCajaAbierta = true; _posCajaId = res.cajaId;
                _posCajaMontoInicial = Number(res.montoInicial || 0); _posCaja = res;
            } else {
                _posCajaEstado = 'cerrada'; _posCajaAbierta = false; _posCajaId = null; _posCaja = null;
            }
            _renderCajaBar();
        })
        .withFailureHandler(function (err) {
            _posCajaEstado = 'error'; _posCajaAbierta = false; _posCaja = null;
            _renderCajaBar((err && err.message) || String(err));
        })
        .getCajaStatus();
}

function _renderCajaBar(errMsg) {
    const bar = _posEl('posCajaBar');
    if (!bar) return;
    const acciones = `
        <button type="button" class="pos-btn sm" onclick="posAbrirHistorial()" title="Buscar ventas, devoluciones y cierres (F6)">Ventas / Devoluciones <span class="pos-kbd">F6</span></button>
        <button type="button" class="pos-btn sm" onclick="posAbrirPendientes()" title="Ventas pendientes (F7)">Pendientes <span class="pos-badge" id="posPendBadge" style="display:none">0</span></button>
        <button type="button" class="pos-btn sm ghost" onclick="posAyuda()" title="Atajos de teclado (F1)" aria-label="Atajos de teclado">⌨</button>`;
    let estado;
    if (_posCajaEstado === 'abierta' && _posCaja) {
        const rs = _posCaja.resumen || {};
        const hora = _posCaja.fecha ? new Date(_posCaja.fecha).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' }) : '--:--';
        estado = `
            <div class="pos-caja-info">
                <span class="pos-chip-st ok">● Caja abierta</span>
                <span class="pos-muted">${escHtml(_posCaja.cajero || '')} · desde ${hora}</span>
                <span class="pos-caja-kpi"><span>Fondo</span><b>${fQ(_posCaja.montoInicial)}</b></span>
                <span class="pos-caja-kpi"><span>Ventas</span><b>${fQ(rs.totalVentas)}</b></span>
                <span class="pos-caja-kpi"><span>Efectivo esperado</span><b>${fQ(rs.esperado)}</b></span>
                ${_posCaja.alertaEfectivo ? '<span class="pos-chip-st warn" title="El efectivo en caja superó el máximo configurado">⚠ Efectivo alto: haga un retiro</span>' : ''}
                ${_posCaja.excedeHoras ? '<span class="pos-chip-st warn">⚠ Turno abierto hace ' + Number(_posCaja.horasAbierta).toFixed(1) + ' h: ciérrelo</span>' : ''}
            </div>
            <div class="pos-caja-act">
                ${_posPerm.caja_mov ? '<button type="button" class="pos-btn sm" onclick="posAbrirMovimiento()">Entrada / Salida</button>' : ''}
                <button type="button" class="pos-btn sm danger" onclick="posAbrirCierreCaja()">Cerrar caja</button>
                ${acciones}
            </div>`;
    } else if (_posCajaEstado === 'cerrada') {
        estado = `
            <div class="pos-caja-info">
                <span class="pos-chip-st off">○ Caja cerrada</span>
                <span class="pos-muted">${!_posRequiereCaja() ? 'Las ventas se registran sin turno de caja.' : 'Abre la caja para poder cobrar.'}</span>
            </div>
            <div class="pos-caja-act">
                <button type="button" class="pos-btn sm ok" onclick="posAbrirAperturaCaja()">Abrir caja</button>
                ${acciones}
            </div>`;
    } else if (_posCajaEstado === 'error') {
        estado = `
            <div class="pos-caja-info"><span class="pos-chip-st err">⚠ Caja sin verificar</span>
                <span class="pos-muted">${escHtml(errMsg || 'No se pudo consultar el estado de la caja.')}</span></div>
            <div class="pos-caja-act"><button type="button" class="pos-btn sm" onclick="_posCajaCheckStatus()">Reintentar</button>${acciones}</div>`;
    } else {
        estado = `<div class="pos-caja-info"><span class="pos-chip-st off">Verificando caja…</span></div><div class="pos-caja-act">${acciones}</div>`;
    }
    bar.innerHTML = estado;
    _posActualizarBadgePendientes();
}

function posAbrirAperturaCaja() {
    if (_posEsStarter()) { if (typeof window.showUpgradeModal === 'function') window.showUpgradeModal('arqueo'); return; }
    posDlg('Apertura de caja', `
        <div class="form-field"><label class="pos-lbl" for="cajaMontoInicial">Fondo inicial de efectivo (Q)</label>
            <input class="pos-in big" id="cajaMontoInicial" type="number" step="0.01" min="0" inputmode="decimal" value="0.00" data-autofocus onkeydown="if(event.key==='Enter')posConfirmarAperturaCaja()" /></div>
        <div class="form-field"><label class="pos-lbl" for="cajaObservaciones">Observaciones (opcional)</label>
            <input class="pos-in" id="cajaObservaciones" placeholder="Ej. Turno matutino" /></div>
        <div class="pos-muted">El fondo es efectivo para dar vuelto: no es ingreso por ventas. Quedará registrado a nombre de quien abre el turno.</div>
        <div id="cajaMsg" class="pos-alert" style="display:none" role="alert"></div>
        <div class="pos-cobro-foot">
            <button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button>
            <button type="button" class="pos-btn ok big" id="cajaBtnOk" onclick="posConfirmarAperturaCaja()">Abrir caja</button>
        </div>`);
}

function posConfirmarAperturaCaja() {
    const raw = _posEl('cajaMontoInicial')?.value;
    const monto = Number(raw);
    if (raw === '' || !isFinite(monto) || monto < 0 || Math.abs(_pq().r2(monto) - monto) > 1e-9) { _posMsg('cajaMsg', 'Ingresa un fondo válido (0 o más, máximo 2 decimales).'); return; }
    const btn = _posEl('cajaBtnOk'); if (btn) { btn.disabled = true; btn.textContent = 'Abriendo…'; }
    window.api
        .withSuccessHandler(function (res) {
            if (res && res.ok) { posDlgCerrar(); showToast('Caja abierta. Fondo: ' + fQ(monto), '#30D158'); _posCajaCheckStatus(); }
            else { _posMsg('cajaMsg', 'No se pudo abrir la caja: ' + ((res && res.error) || 'error desconocido')); if (btn) { btn.disabled = false; btn.textContent = 'Abrir caja'; } }
        })
        .withFailureHandler(function (err) {
            _posMsg('cajaMsg', 'Sin conexión: ' + ((err && err.message) || err) + '. Verifica el estado de la caja antes de reintentar.');
            if (btn) { btn.disabled = false; btn.textContent = 'Abrir caja'; }
            _posCajaCheckStatus();
        })
        .abrirCajaPOS({ montoInicial: monto, observaciones: _posEl('cajaObservaciones')?.value || '' });
}

function posAbrirMovimiento() {
    if (!_posPerm.caja_mov) { showToast('No tiene permiso para registrar movimientos de efectivo', '#FF9F0A'); return; }
    posDlg('Entrada / salida de efectivo', `
        <div class="pos-seg" role="group" aria-label="Tipo de movimiento">
            <button type="button" class="pos-seg-b active" id="movTipoE" onclick="posMovTipo('Entrada')">Entrada</button>
            <button type="button" class="pos-seg-b" id="movTipoS" onclick="posMovTipo('Salida')">Salida</button>
        </div>
        <div class="form-field"><label class="pos-lbl" for="movMonto">Monto (Q)</label>
            <input class="pos-in big" id="movMonto" type="number" step="0.01" min="0" inputmode="decimal" data-autofocus /></div>
        <div class="form-field"><label class="pos-lbl" for="movMotivo">Motivo *</label>
            <input class="pos-in" id="movMotivo" placeholder="Ej. Pago a proveedor / cambio de billetes" /></div>
        <div id="movMsg" class="pos-alert" style="display:none" role="alert"></div>
        <div class="pos-cobro-foot">
            <button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button>
            <button type="button" class="pos-btn ok big" id="movBtnOk" onclick="posConfirmarMovimiento()">Registrar</button>
        </div>`);
    window._posMovTipo = 'Entrada';
}
function posMovTipo(t) {
    window._posMovTipo = t;
    _posEl('movTipoE').classList.toggle('active', t === 'Entrada');
    _posEl('movTipoS').classList.toggle('active', t === 'Salida');
}
function posConfirmarMovimiento() {
    const monto = Number(_posEl('movMonto')?.value), motivo = (_posEl('movMotivo')?.value || '').trim();
    if (!isFinite(monto) || monto <= 0 || Math.abs(_pq().r2(monto) - monto) > 1e-9) { _posMsg('movMsg', 'Ingresa un monto válido mayor a cero (máximo 2 decimales).'); return; }
    if (motivo.length < 3) { _posMsg('movMsg', 'Indica el motivo del movimiento.'); return; }
    const btn = _posEl('movBtnOk'); if (btn) { btn.disabled = true; btn.textContent = 'Registrando…'; }
    window.api
        .withSuccessHandler(function (res) {
            if (res && res.ok) { posDlgCerrar(); showToast(window._posMovTipo + ' de efectivo registrada ✓', '#30D158'); _posCajaCheckStatus(); }
            else { _posMsg('movMsg', (res && res.error) || 'Error desconocido'); if (btn) { btn.disabled = false; btn.textContent = 'Registrar'; } }
        })
        .withFailureHandler(function (err) {
            _posMsg('movMsg', 'Sin conexión: ' + ((err && err.message) || err) + '. Revisa el estado de la caja antes de reintentar.');
            if (btn) { btn.disabled = false; btn.textContent = 'Registrar'; }
            _posCajaCheckStatus();
        })
        .posCajaMovimiento({ tipo: window._posMovTipo, monto: monto, motivo: motivo });
}

function _posFilaResumen(lbl, val, cls) { return `<div class="pos-res-r ${cls || ''}"><span>${lbl}</span><b>${val}</b></div>`; }

function posAbrirCierreCaja() {
    if (_posEsStarter()) { if (typeof window.showUpgradeModal === 'function') window.showUpgradeModal('arqueo'); return; }
    posDlg('Cierre de caja', '<div class="pos-empty">Calculando el turno…</div>');
    window.api
        .withSuccessHandler(function (res) {
            if (!res || !res.ok || !res.cajaAbierta) { posDlg('Cierre de caja', `<div class="pos-alert err" style="display:block">${escHtml((res && res.error) || 'No hay una caja abierta.')}</div>`); return; }
            const r = res.resumen || {};
            window._posCierreEsperado = Number(r.esperado || 0);
            window._posCierreConfirmando = false;
            posDlg('Cierre de caja', `
                <div class="pos-res-box">
                    ${_posFilaResumen('Fondo inicial', fQ(r.montoInicial))}
                    ${_posFilaResumen('+ Ventas en efectivo', fQ(r.ventasEfectivo))}
                    ${_posFilaResumen('+ Entradas de efectivo', fQ(r.entradas))}
                    ${_posFilaResumen('− Salidas de efectivo', fQ(r.salidas))}
                    ${_posFilaResumen('− Devoluciones en efectivo', fQ(r.devolucionesEfectivo))}
                    ${_posFilaResumen('Efectivo esperado en caja', fQ(r.esperado), 'tot')}
                </div>
                <div class="pos-muted" style="margin:6px 0 10px">Otros cobros del turno (no van en el cajón): Tarjeta ${fQ(r.ventasTarjeta)} · Transferencia ${fQ(r.ventasTransferencia)} · ${r.tickets || 0} ticket(s)${r.anulaciones ? ' · ' + r.anulaciones + ' anulación(es)' : ''}</div>
                <div class="form-field"><label class="pos-lbl" for="cierreEfectivoContado">Efectivo contado en caja (Q) *</label>
                    <input class="pos-in big" id="cierreEfectivoContado" type="number" step="0.01" min="0" inputmode="decimal" data-autofocus oninput="posCierreCuadrar()" onkeydown="if(event.key==='Enter')posConfirmarCierreCaja()" /></div>
                <div class="pos-res-box" id="cierreDif"></div>
                <div class="form-field"><label class="pos-lbl" for="cierreObservaciones" id="cierreObsLbl">Observaciones del cierre</label>
                    <textarea class="pos-in" id="cierreObservaciones" rows="2" placeholder="Explica cualquier diferencia"></textarea></div>
                <div id="cierreMsg" class="pos-alert" style="display:none" role="alert"></div>
                <div class="pos-cobro-foot">
                    <button type="button" class="pos-btn" onclick="posDlgCerrar()">Cancelar</button>
                    <button type="button" class="pos-btn danger big" id="cierreBtnOk" onclick="posConfirmarCierreCaja()">Cerrar caja</button>
                </div>`);
            posCierreCuadrar();
        })
        .withFailureHandler(function (err) { posDlg('Cierre de caja', `<div class="pos-alert err" style="display:block">Sin conexión: ${escHtml((err && err.message) || err)}</div>`); })
        .getCajaStatus();
}

function _posExigeExplicar(dif) { return Math.abs(dif) > (Number(_posCfg.tolerancia_cuadre) || 0); }
function _posExigeSupervisor(dif) { const m = Number(_posCfg.cuadre_max_sin_supervisor) || 0; return m > 0 && Math.abs(dif) > m && !_posPerm.privilegiado; }

function posCierreCuadrar() {
    const raw = _posEl('cierreEfectivoContado')?.value;
    const box = _posEl('cierreDif');
    if (!box) return;
    if (raw === '' || raw === undefined) { box.innerHTML = '<div class="pos-muted">Cuenta el efectivo y escribe el total.</div>'; return; }
    const dif = _pq().r2(Number(raw) - window._posCierreEsperado);
    const cls = dif === 0 ? 'ok' : (dif > 0 ? 'warn' : 'err');
    const txt = dif === 0 ? 'El efectivo cuadra con lo esperado.' : (dif > 0 ? 'Sobrante: hay más efectivo del esperado.' : 'Faltante: hay menos efectivo del esperado.');
    box.innerHTML = `${_posFilaResumen('Diferencia', (dif > 0 ? '+' : '') + fQ(dif), 'dif ' + cls)}<div class="pos-muted">${txt}${_posExigeExplicar(dif) ? ' Debes explicarlo en las observaciones.' : (dif !== 0 ? ' Dentro de la tolerancia: no requiere explicación.' : '')}${_posExigeSupervisor(dif) ? ' <b>La diferencia supera el límite: debe cerrar un supervisor o administrador.</b>' : ''}</div>`;
    const lbl = _posEl('cierreObsLbl'); if (lbl) lbl.textContent = _posExigeExplicar(dif) ? 'Explicación de la diferencia *' : 'Observaciones del cierre';
}

function posConfirmarCierreCaja() {
    const raw = _posEl('cierreEfectivoContado')?.value;
    const contado = Number(raw);
    const obs = (_posEl('cierreObservaciones')?.value || '').trim();
    if (raw === '' || !isFinite(contado) || contado < 0 || Math.abs(_pq().r2(contado) - contado) > 1e-9) { _posMsg('cierreMsg', 'Ingresa el efectivo contado (0 o más, máximo 2 decimales).'); return; }
    const dif = _pq().r2(contado - window._posCierreEsperado);
    if (_posExigeSupervisor(dif)) { _posMsg('cierreMsg', 'La diferencia de ' + fQ(dif) + ' supera el límite de ' + fQ(_posCfg.cuadre_max_sin_supervisor) + ': debe cerrar la caja un supervisor o administrador.'); return; }
    if (_posExigeExplicar(dif) && obs.length < 3) { _posMsg('cierreMsg', 'Hay una diferencia de ' + fQ(dif) + ': explícala en las observaciones.'); return; }
    const btn = _posEl('cierreBtnOk');
    if (!window._posCierreConfirmando) {      // segunda confirmación explícita: el cierre es definitivo
        window._posCierreConfirmando = true;
        _posMsg('cierreMsg', 'El cierre es definitivo: solo un administrador podrá reabrirlo (queda auditado). Pulsa de nuevo para confirmar.', 'warn');
        if (btn) btn.textContent = 'Sí, cerrar definitivamente';
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Cerrando…'; }
    window.api
        .withSuccessHandler(function (res) {
            if (res && res.ok) { posDlgCerrar(); showToast('Caja cerrada ✓', '#30D158'); _posCajaCheckStatus(); posMostrarResumenCierre(res); }
            else { window._posCierreConfirmando = false; _posMsg('cierreMsg', (res && res.error) || 'Error desconocido'); if (btn) { btn.disabled = false; btn.textContent = 'Cerrar caja'; } }
        })
        .withFailureHandler(function (err) {
            window._posCierreConfirmando = false;
            _posMsg('cierreMsg', 'Sin conexión: ' + ((err && err.message) || err) + '. Verifica si la caja quedó cerrada antes de reintentar.');
            if (btn) { btn.disabled = false; btn.textContent = 'Cerrar caja'; }
            _posCajaCheckStatus();
        })
        .cerrarCajaPOS({ cajaId: _posCajaId, efectivoContado: contado, observaciones: obs });
}

function posMostrarResumenCierre(d) {
    if (!d) return;
    window._ultimoCierreCaja = d;
    const fF = iso => iso ? new Date(iso).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const dif = Number(d.diferencia || 0);
    posDlg('Resumen de cierre · ' + (d.cajaId || ''), `
        <div class="pos-muted">Cajero: <b>${escHtml(d.cajero || '')}</b> · Apertura ${fF(d.fechaApertura)} · Cierre ${fF(d.fechaCierre)}</div>
        <div class="pos-res-box">
            ${_posFilaResumen('Fondo inicial', fQ(d.montoInicial))}
            ${_posFilaResumen('+ Ventas en efectivo', fQ(d.ventasEfectivo))}
            ${_posFilaResumen('+ Entradas', fQ(d.entradas))}
            ${_posFilaResumen('− Salidas', fQ(d.salidas))}
            ${_posFilaResumen('− Devoluciones en efectivo', fQ(d.devolucionesEfectivo))}
            ${_posFilaResumen('Efectivo esperado', fQ(d.esperado), 'tot')}
            ${_posFilaResumen('Efectivo contado', fQ(d.contado))}
            ${_posFilaResumen('Diferencia', (dif > 0 ? '+' : '') + fQ(dif), 'dif ' + (dif === 0 ? 'ok' : dif > 0 ? 'warn' : 'err'))}
        </div>
        <div class="pos-muted">Tarjeta ${fQ(d.ventasTarjeta)} · Transferencia ${fQ(d.ventasTransferencia)} · Total vendido ${fQ(d.totalVentas)} · ${d.tickets || 0} ticket(s)</div>
        ${d.observaciones ? `<div class="pos-muted"><b>Notas:</b> ${escHtml(d.observaciones)}</div>` : ''}
        <div class="pos-exito-btns">
            <button type="button" class="pos-btn primary" onclick="posImprimirCorteCaja()">🖨 Imprimir corte</button>
            <button type="button" class="pos-btn" onclick="posDlgCerrar()">Cerrar</button>
        </div>`);
}

function posImprimirCorteCaja(cierre) {
    const d = cierre || window._ultimoCierreCaja;
    if (!d) { showToast('No hay datos de cierre para imprimir', '#FF9F0A'); return; }
    const em = (typeof EMPRESA !== 'undefined' ? EMPRESA : {}) || {};
    const q = n => 'Q ' + Number(n || 0).toFixed(2);
    const fF = iso => iso ? new Date(iso).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const dif = Number(d.diferencia || 0);
    const fila = (a, b, c) => `<div class="row ${c || ''}"><span>${a}</span><span>${b}</span></div>`;
    _posImprimirHtml(`<div class="tk">
        <div class="c"><div class="nm">${escHtml(em.nombre || 'AZYVION CRM')}</div><div>NIT: ${escHtml(em.nit || 'C/F')}</div></div>
        <div class="sep"></div><div class="c b">CORTE Y CIERRE DE CAJA</div><div class="c s">${escHtml(d.cajaId || '')}</div>
        <div class="sep"></div>
        ${fila('Cajero', escHtml(d.cajero || ''))}${fila('Apertura', fF(d.fechaApertura))}${fila('Cierre', fF(d.fechaCierre))}
        <div class="sep"></div>
        ${fila('Fondo inicial', q(d.montoInicial))}${fila('Ventas efectivo', q(d.ventasEfectivo))}${fila('Entradas', q(d.entradas))}
        ${fila('Salidas', '-' + q(d.salidas))}${fila('Devoluc. efectivo', '-' + q(d.devolucionesEfectivo))}
        ${fila('ESPERADO', q(d.esperado), 'b')}${fila('CONTADO', q(d.contado), 'b')}
        ${fila('DIFERENCIA', (dif > 0 ? '+' : '') + q(dif), 'tot')}
        <div class="c s">${dif === 0 ? '(Efectivo cuadrado)' : dif > 0 ? '(Sobrante)' : '(Faltante)'}</div>
        <div class="sep"></div>
        ${fila('Tarjeta', q(d.ventasTarjeta))}${fila('Transferencia', q(d.ventasTransferencia))}${fila('TOTAL VENDIDO', q(d.totalVentas), 'b')}${fila('Tickets', d.tickets || 0)}
        ${d.observaciones ? `<div class="sep"></div><div class="s">Obs: ${escHtml(d.observaciones)}</div>` : ''}
        <div style="margin-top:30px;display:flex;gap:10px"><div style="flex:1;border-top:1px solid #000;text-align:center;font-size:10px">Cajero</div><div style="flex:1;border-top:1px solid #000;text-align:center;font-size:10px">Supervisor</div></div>
        <div class="c s" style="margin-top:10px">Generado ${new Date().toLocaleString('es-GT')}</div></div>`, 'Corte ' + (d.cajaId || ''));
}

/* ──────────────────────────────────────────────────────────────────
   HISTORIAL · DEVOLUCIONES · ANULACIONES · CIERRES
────────────────────────────────────────────────────────────────── */
function posAbrirHistorial(tab) {
    posDlg('Ventas, devoluciones y cierres', `
        <div class="pos-tabs" role="tablist">
            <button type="button" class="pos-tab active" id="posTabV" role="tab" onclick="posHistTab('v')">Ventas</button>
            <button type="button" class="pos-tab" id="posTabC" role="tab" onclick="posHistTab('c')">Cierres de caja</button>
        </div>
        <div id="posHistV">
            <div class="pos-hist-filtros">
                <input class="pos-in" id="posHistQ" placeholder="No. de ticket, cliente o NIT" data-autofocus onkeydown="if(event.key==='Enter')posHistBuscar()" aria-label="Buscar ventas" />
                <select class="pos-in" id="posHistEstado" aria-label="Estado"><option value="">Todos los estados</option><option>Completada</option><option>Devuelta parcial</option><option>Devuelta</option><option>Anulada</option></select>
                <input class="pos-in" type="date" id="posHistDesde" aria-label="Desde" /><input class="pos-in" type="date" id="posHistHasta" aria-label="Hasta" />
                <button type="button" class="pos-btn primary" onclick="posHistBuscar()">Buscar</button>
            </div>
            <div class="pos-hist-cols"><div id="posHistLista" class="pos-hist-lista"></div><div id="posHistDetalle" class="pos-hist-detalle"><div class="pos-empty">Selecciona una venta para ver el detalle.</div></div></div>
        </div>
        <div id="posHistC" style="display:none"></div>`, { wide: true });
    posHistBuscar();
    if (tab === 'c') posHistTab('c');
}
function posHistTab(t) {
    _posEl('posTabV').classList.toggle('active', t === 'v');
    _posEl('posTabC').classList.toggle('active', t === 'c');
    _posEl('posHistV').style.display = t === 'v' ? '' : 'none';
    _posEl('posHistC').style.display = t === 'c' ? '' : 'none';
    if (t === 'c') posHistCierres();
}

function _posBadgeEstado(e) {
    const m = { 'Completada': 'ok', 'Devuelta parcial': 'warn', 'Devuelta': 'warn', 'Anulada': 'err' };
    return `<span class="pos-chip-st ${m[e] || 'off'}">${escHtml(e)}</span>`;
}

function posHistBuscar() {
    const lista = _posEl('posHistLista');
    if (!lista) return;
    lista.innerHTML = '<div class="pos-empty">Buscando…</div>';
    window.api
        .withSuccessHandler(function (res) {
            if (!res || !res.ok) { lista.innerHTML = `<div class="pos-alert err" style="display:block">${escHtml((res && res.error) || 'Error al buscar')}</div>`; return; }
            if (!res.data.length) { lista.innerHTML = '<div class="pos-empty">No hay ventas con ese criterio.</div>'; return; }
            lista.innerHTML = res.data.map(v => `
                <button type="button" class="pos-hist-row" onclick="posHistVer('${escAttr(v.id)}')">
                    <div><b>${escHtml(v.numero)}</b> ${_posBadgeEstado(v.estado)}
                        <div class="pos-muted">${new Date(v.created_at).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${escHtml(v.cliente_nombre)}</div></div>
                    <b>${fQ(v.total)}</b></button>`).join('');
        })
        .withFailureHandler(function (e) { lista.innerHTML = `<div class="pos-alert err" style="display:block">Sin conexión: ${escHtml((e && e.message) || e)}</div>`; })
        .posBuscarVentas({
            q: _posEl('posHistQ')?.value || '', estado: _posEl('posHistEstado')?.value || '',
            desde: _posEl('posHistDesde')?.value || '', hasta: _posEl('posHistHasta')?.value || ''
        });
}

function posHistVer(id) {
    const det = _posEl('posHistDetalle');
    if (!det) return;
    det.innerHTML = '<div class="pos-empty">Cargando…</div>';
    window.api
        .withSuccessHandler(function (res) {
            if (!res || !res.ok || !res.encontrada) { det.innerHTML = `<div class="pos-alert err" style="display:block">${escHtml((res && res.error) || 'Venta no encontrada')}</div>`; return; }
            _posHistDetalle = res.ticket;
            _posDevKey = _pq().nuevaClave();
            _posRenderDetalleVenta();
        })
        .withFailureHandler(function (e) { det.innerHTML = `<div class="pos-alert err" style="display:block">Sin conexión: ${escHtml((e && e.message) || e)}</div>`; })
        .posObtenerVenta({ ventaId: id });
}

function _posRenderDetalleVenta() {
    const t = _posHistDetalle, det = _posEl('posHistDetalle');
    if (!t || !det) return;
    const activa = t.estado === 'Completada' || t.estado === 'Devuelta parcial';
    const pendiente = i => Math.round((Number(i.cantidad) - Number(i.cantidadDevuelta)) * 1000) / 1000;
    const filas = (t.items || []).map(i => `
        <tr><td>${escHtml(i.descripcion)}<div class="pos-muted">${fQ(i.precioUnit)} c/u</div></td>
            <td class="num">${Number(i.cantidad)}</td><td class="num">${Number(i.cantidadDevuelta)}</td>
            <td class="num">${activa && pendiente(i) > 0 && _posPerm.devolver
                ? `<input class="pos-in sm" type="number" min="0" max="${pendiente(i)}" step="any" value="0" id="devQ_${escAttr(i.itemId)}" oninput="posHistEstimar()" aria-label="Cantidad a devolver de ${escAttr(i.descripcion)}" />`
                : '—'}</td></tr>`).join('');
    const pagos = (t.pagos || []).map(p => `${escHtml(p.metodo)} ${fQ(p.monto)}`).join(' + ');
    const tieneEfectivo = (t.pagos || []).some(p => p.metodo === 'Efectivo');
    const habil = _posCfg.metodos_habilitados;
    const metodoInicial = (tieneEfectivo && habil.indexOf('Efectivo') >= 0) ? 'Efectivo' : (habil.find(m => m !== 'Efectivo') || habil[0]);
    const motivos = _posCfg.motivos_devolucion || [];
    const plazo = Number(_posCfg.plazo_devolucion_dias) || 0;
    const dias = Math.floor((Date.now() - new Date(t.fecha).getTime()) / 86400000);
    const plazoVencido = plazo > 0 && dias > plazo && !_posPerm.privilegiado;
    const plazoTxt = plazo > 0 ? (plazoVencido ? `Pasó el plazo de ${plazo} días para devoluciones (la venta tiene ${dias}). Solo un administrador puede autorizarla.` : `Plazo de devolución: ${plazo} días (esta venta tiene ${dias}).`) : '';
    det.innerHTML = `
        <div class="pos-det-head"><div><b>${escHtml(t.numero)}</b> ${_posBadgeEstado(t.estado)}</div><b>${fQ(t.total)}</b></div>
        <div class="pos-muted">${new Date(t.fecha).toLocaleString('es-GT')} · ${escHtml(t.cliente)} · NIT ${escHtml(t.nit)} · Cajero ${escHtml(t.cajero)}</div>
        <div class="pos-muted">Pago: ${pagos || '—'}${Number(t.reembolsado) > 0 ? ' · Reembolsado ' + fQ(t.reembolsado) : ''}${t.motivoAnulacion ? ' · Motivo: ' + escHtml(t.motivoAnulacion) : ''}</div>
        <div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>Artículo</th><th class="num">Vend.</th><th class="num">Dev.</th><th class="num">Devolver</th></tr></thead><tbody>${filas}</tbody></table></div>
        ${activa ? `
        <div class="pos-dev-form">
            ${plazoTxt ? `<div class="pos-alert ${plazoVencido ? 'err' : 'warn'}" style="display:block">${plazoTxt}</div>` : ''}
            ${motivos.length ? `<div class="form-field"><label class="pos-lbl" for="devMotivoTipo">Motivo *</label>
                <select class="pos-in" id="devMotivoTipo" onchange="posHistMotivoTipo()"><option value="">Seleccione…</option>${motivos.map(m => `<option>${escHtml(m)}</option>`).join('')}</select></div>` : ''}
            <div class="form-field"><label class="pos-lbl" for="devMotivo">${motivos.length ? 'Detalle (obligatorio si el motivo es «Otro»)' : 'Motivo * (mínimo 5 caracteres)'}</label>
                <input class="pos-in" id="devMotivo" placeholder="Ej. Producto defectuoso" ${(_posPerm.devolver || _posPerm.anular) ? '' : 'disabled'} /></div>
            <div class="pos-grid2">
                <div class="form-field"><label class="pos-lbl" for="devMetodo">Reembolsar por</label>
                    <select class="pos-in" id="devMetodo" onchange="posHistMetodo()">
                        ${habil.map(m => `<option value="${m}" ${m === metodoInicial ? 'selected' : ''}>${escHtml(_posLblMetodo(m))}${m === 'Efectivo' ? ' (sale de la caja)' : (m === 'Tarjeta' ? ' (reversa en su terminal)' : '')}</option>`).join('')}</select></div>
                <div class="form-field" id="devRefWrap" style="display:none"><label class="pos-lbl" for="devRef">Referencia del reembolso *</label><input class="pos-in" id="devRef" /></div>
            </div>
            <div class="form-field" id="devCtaWrap" style="display:none"><label class="pos-lbl" for="devCta">Cuenta bancaria</label>
                <select class="pos-in" id="devCta"><option value="">Sin cuenta bancaria</option>${_posCuentas.map(b => `<option value="${escAttr(b.id)}">${escHtml(b.nombre)}</option>`).join('')}</select></div>
            <label class="pos-check"><input type="checkbox" id="devStock" checked /> Reingresar los artículos al inventario</label>
            <div class="pos-muted" id="devEstimado"></div>
            <div id="devMsg" class="pos-alert" style="display:none" role="alert"></div>
        </div>` : ''}
        <div class="pos-exito-btns" style="justify-content:flex-start">
            ${activa ? `<button type="button" class="pos-btn primary" id="devBtn" onclick="posHistDevolver(false)" ${_posPerm.devolver ? '' : 'disabled title="No tiene permiso para registrar devoluciones"'}>Registrar devolución</button>` : ''}
            ${t.estado === 'Completada' ? `<button type="button" class="pos-btn danger" id="anuBtn" onclick="posHistDevolver(true)" ${_posPerm.anular ? '' : 'disabled title="No tiene permiso para anular ventas"'}>Anular venta completa</button>` : ''}
            <button type="button" class="pos-btn" onclick="posHistReimprimir()" ${_posPerm.reimprimir ? '' : 'disabled title="No tiene permiso para reimprimir"'}>Reimprimir comprobante</button>
        </div>`;
    posHistMetodo();
}

/** El reingreso al inventario se desmarca por defecto para los motivos configurados (p. ej. «Producto defectuoso»). */
function posHistMotivoTipo() {
    const tipo = _posEl('devMotivoTipo')?.value || '';
    const chk = _posEl('devStock');
    if (chk) chk.checked = (_posCfg.motivos_sin_reingreso || []).indexOf(tipo) < 0;
}

function posHistMetodo() {
    const m = _posEl('devMetodo')?.value;
    const r = _posEl('devRefWrap'), c = _posEl('devCtaWrap');
    if (r) r.style.display = m && m !== 'Efectivo' ? '' : 'none';
    if (c) c.style.display = m === 'Transferencia' ? '' : 'none';
}

function posHistEstimar() {
    const t = _posHistDetalle; if (!t) return;
    const f = _pq().factorReembolso(t);
    let est = 0;
    (t.items || []).forEach(i => { const q = Number(_posEl('devQ_' + i.itemId)?.value || 0); if (q > 0) est += q * Number(i.precioUnit); });
    const el = _posEl('devEstimado');
    if (el) el.textContent = est > 0 ? 'Reembolso estimado: ' + fQ(est * f) + ' (el monto final lo calcula el servidor).' : '';
}

function posHistDevolver(anular) {
    const t = _posHistDetalle; if (!t) return;
    const detalle = (_posEl('devMotivo')?.value || '').trim();
    const motivoTipo = _posEl('devMotivoTipo') ? _posEl('devMotivoTipo').value : '';
    let motivo = detalle;
    if (_posEl('devMotivoTipo')) {
        if (!motivoTipo) { _posMsg('devMsg', 'Seleccione el motivo de la devolución.'); return; }
        if (motivoTipo === 'Otro' && detalle.length < 5) { _posMsg('devMsg', 'Con el motivo «Otro» describa el detalle (mínimo 5 caracteres).'); return; }
        motivo = detalle ? motivoTipo + ' — ' + detalle : motivoTipo;
    } else if (detalle.length < 5) { _posMsg('devMsg', 'Indica el motivo (mínimo 5 caracteres).'); return; }
    const metodo = _posEl('devMetodo')?.value || 'Efectivo';
    const ref = (_posEl('devRef')?.value || '').trim();
    if (metodo !== 'Efectivo' && ref.length < 3) { _posMsg('devMsg', 'Ingresa la referencia del reembolso electrónico.'); return; }
    let items = [];
    if (!anular) {
        (t.items || []).forEach(i => {
            const q = Number(_posEl('devQ_' + i.itemId)?.value || 0);
            if (q > 0) items.push({ itemId: i.itemId, cantidad: q });
        });
        if (!items.length) { _posMsg('devMsg', 'Indica la cantidad a devolver de al menos un artículo.'); return; }
        for (const it of items) {
            const li = t.items.find(x => x.itemId === it.itemId);
            if (it.cantidad > Number(li.cantidad) - Number(li.cantidadDevuelta) + 1e-9) { _posMsg('devMsg', `No puedes devolver más de lo pendiente de "${li.descripcion}".`); return; }
        }
    }
    const q = anular ? `¿ANULAR la venta ${t.numero}? Se devolverá todo el importe (${fQ(Number(t.total) - Number(t.reembolsado))}) y se repondrá el inventario.`
                     : `¿Registrar la devolución de ${items.length} artículo(s) de la venta ${t.numero}?`;
    if (!confirm(q + '\n\nEsta operación queda registrada y no se puede borrar.')) return;
    _posMsg('devMsg', '');
    ['devBtn', 'anuBtn'].forEach(id => { const b = _posEl(id); if (b) b.disabled = true; });
    const reabrir = () => ['devBtn', 'anuBtn'].forEach(id => { const b = _posEl(id); if (b) b.disabled = false; });
    window.api
        .withSuccessHandler(function (res) {
            if (res && res.ok) {
                showToast((anular ? 'Venta anulada' : 'Devolución registrada') + ' ✓' + (metodo === 'Efectivo' ? ' · Entregue ' + fQ(res.monto) : ''), '#30D158');
                _posDevKey = _pq().nuevaClave();
                posHistVer(t.ventaId); posHistBuscar(); loadPos();
                if (typeof loadInventario === 'function') loadInventario();
                if (typeof loadTransacciones === 'function') loadTransacciones();
            } else {
                _posMsg('devMsg', (res && res.error) || 'Error desconocido'); reabrir();
            }
        })
        .withFailureHandler(function (e) {
            _posMsg('devMsg', 'Sin conexión: ' + ((e && e.message) || e) + '. Consulta la venta antes de reintentar; al reintentar se usa la misma clave y no se duplica.'); reabrir();
        })
        .posDevolverVenta({
            ventaId: t.ventaId, items: items, anular: !!anular, motivo: motivo, motivoTipo: motivoTipo || undefined, metodoReembolso: metodo,
            referencia: ref || undefined, cuentaBancariaId: _posEl('devCta')?.value || undefined,
            reingresarStock: !!_posEl('devStock')?.checked, idempotency_key: _posDevKey
        });
}

function posHistReimprimir() {
    const t = _posHistDetalle; if (!t) return;
    if (!_posPerm.reimprimir) { showToast('No tiene permiso para reimprimir comprobantes', '#FF9F0A'); return; }
    window.api
        .withSuccessHandler(function (res) {
            if (res && res.ok && res.ticket) posMostrarTicketTermico(res.ticket, { reimpresion: true });
            else showToast((res && res.error) || 'No se pudo obtener el comprobante', '#FF453A');
        })
        .withFailureHandler(function (e) { showToast('Sin conexión: ' + ((e && e.message) || e), '#FF453A'); })
        .posObtenerVenta({ ventaId: t.ventaId, reimpresion: true });
}

function posHistCierres() {
    const c = _posEl('posHistC'); if (!c) return;
    c.innerHTML = '<div class="pos-empty">Cargando cierres…</div>';
    window.api
        .withSuccessHandler(function (res) {
            const rows = (res && res.data) || [];
            if (!rows.length) { c.innerHTML = '<div class="pos-empty">Aún no hay turnos de caja.</div>'; return; }
            c.innerHTML = `<div class="pos-table-wrap"><table class="pos-table"><thead><tr><th>Turno</th><th>Cajero</th><th>Apertura</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th><th>Estado</th><th></th></tr></thead><tbody>
                ${rows.map(r => `<tr><td>${escHtml(r.id)}</td><td>${escHtml(r.cajero)}</td><td>${new Date(r.fecha_apertura).toLocaleString('es-GT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td class="num">${r.estado === 'CERRADA' ? fQ(r.total_esperado) : '—'}</td><td class="num">${r.estado === 'CERRADA' ? fQ(r.efectivo_contado) : '—'}</td>
                    <td class="num ${Number(r.diferencia) < 0 ? 'neg' : ''}">${r.estado === 'CERRADA' ? fQ(r.diferencia) : '—'}</td><td><span class="pos-chip-st ${r.estado === 'CERRADA' ? 'off' : 'ok'}">${r.estado === 'CERRADA' ? 'Cerrada' : 'Abierta'}</span></td>
                    <td>${r.estado === 'CERRADA' && _posPerm.privilegiado ? `<button type="button" class="pos-btn sm" onclick="posReabrirCaja('${escAttr(r.id)}')">Reabrir</button>` : ''}</td></tr>`).join('')}
                </tbody></table></div>`;
        })
        .withFailureHandler(function (e) { c.innerHTML = `<div class="pos-alert err" style="display:block">Sin conexión: ${escHtml((e && e.message) || e)}</div>`; })
        .getCierresCaja({});
}

function posReabrirCaja(cajaId) {
    const motivo = (prompt('Motivo de la reapertura (mínimo 5 caracteres). Quedará auditado:') || '').trim();
    if (motivo.length < 5) { if (motivo) showToast('El motivo es demasiado corto', '#FF9F0A'); return; }
    window.api
        .withSuccessHandler(function (res) {
            if (res && res.ok) { showToast('Turno reabierto y auditado ✓', '#30D158'); posHistCierres(); _posCajaCheckStatus(); }
            else showToast((res && res.error) || 'No se pudo reabrir', '#FF453A');
        })
        .withFailureHandler(function (e) { showToast('Sin conexión: ' + ((e && e.message) || e), '#FF453A'); })
        .posReabrirCaja({ cajaId: cajaId, motivo: motivo });
}

/* ──────────────────────────────────────────────────────────────────
   ATAJOS DE TECLADO
────────────────────────────────────────────────────────────────── */
let _posAtajosOk = false;
function posInitAtajos() {
    if (_posAtajosOk) return;
    _posAtajosOk = true;
    document.addEventListener('keydown', posOnKey);
}
function posAyuda() {
    const f = (k, t) => `<div class="pos-res-r"><span>${t}</span><b class="pos-kbd">${k}</b></div>`;
    posDlg('Atajos de teclado', `<div class="pos-res-box">
        ${f('F2', 'Buscar producto / escanear código')}${f('Enter', 'En el buscador: agrega la coincidencia exacta de SKU')}
        ${f('F9', 'Cobrar')}${f('F8', 'Guardar venta pendiente')}${f('F7', 'Ver ventas pendientes')}${f('F6', 'Ventas y devoluciones')}
        ${f('↑ / ↓', 'Seleccionar línea de la orden')}${f('+ / −', 'Cambiar cantidad de la línea')}${f('Supr', 'Quitar la línea seleccionada')}
        ${f('Esc', 'Cerrar ventana / limpiar búsqueda')}${f('P', 'Imprimir (en comprobante o venta registrada)')}${f('F1', 'Esta ayuda')}</div>
        <div class="pos-muted">Los lectores de código de barras funcionan como teclado: el inventario guarda el SKU, que se usa como código.</div>`);
}
function posOnKey(e) {
    if (typeof _currentPage === 'undefined' || _currentPage !== 'pos') return;
    const modalGlobal = document.getElementById('modal');
    if (modalGlobal && modalGlobal.classList.contains('open')) return;
    const tag = (e.target && e.target.tagName) || '';
    const escribiendo = /INPUT|TEXTAREA|SELECT/.test(tag);
    if (posDlgAbierto()) {
        if (e.key === 'Escape') { e.preventDefault(); posDlgCerrar(); return; }
        if (!escribiendo && (e.key === 'p' || e.key === 'P') && (_posEl('ticketTermicoArea') || document.querySelector('.pos-exito'))) { e.preventDefault(); posImprimirTicket(); return; }
        if (e.key === 'Enter' && _posEl('posCobroConfirm') && tag !== 'BUTTON' && tag !== 'TEXTAREA') { e.preventDefault(); posConfirmarVenta(); }
        return;
    }
    switch (e.key) {
        case 'F1': e.preventDefault(); posAyuda(); return;
        case 'F2': e.preventDefault(); posFocoBuscar(); return;
        case 'F6': e.preventDefault(); posAbrirHistorial(); return;
        case 'F7': e.preventDefault(); posAbrirPendientes(); return;
        case 'F8': e.preventDefault(); posGuardarPendiente(); return;
        case 'F9': e.preventDefault(); posAbrirModalCobro(); return;
        case 'Escape': {
            const i = _posEl('posSearchInput');
            if (i && i.value) { i.value = ''; renderPosCatalogo(); }
            posToggleCarritoMovil(false);
            return;
        }
    }
    if (escribiendo || !_posCarrito.length) return;
    const idx = _posCarrito.findIndex(i => String(i.id) === String(_posSelLinea));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = e.key === 'ArrowDown' ? Math.min(_posCarrito.length - 1, idx + 1) : Math.max(0, idx < 0 ? 0 : idx - 1);
        _posSelLinea = String(_posCarrito[n < 0 ? 0 : n].id); renderPosCarrito();
    } else if (idx >= 0 && (e.key === '+' || e.key === '=')) { e.preventDefault(); posModificarCantidad(_posCarrito[idx].id, 1); }
    else if (idx >= 0 && (e.key === '-' || e.key === '_')) { e.preventDefault(); posModificarCantidad(_posCarrito[idx].id, -1); }
    else if (idx >= 0 && e.key === 'Delete') { e.preventDefault(); posEliminarItem(_posCarrito[idx].id); }
}

/* ══════════════════════════════════════════════════════════════════
   BÚSQUEDA RÁPIDA POR NIT — SAT Guatemala / CRM Local
   Flujo: 1) Buscar en clientes CRM  2) Si no existe → API SAT
══════════════════════════════════════════════════════════════════ */
function posBuscarClientePorNit() {
    const inputEl = document.getElementById('posNitSearchInput');
    const msgEl   = document.getElementById('posNitResultMsg');
    const btn     = document.getElementById('posNitSearchBtn');
    if (!inputEl || !msgEl) return;

    const nit = inputEl.value.trim().toUpperCase();
    if (!nit) { showToast('Ingresa un NIT para buscar', '#FF9F0A'); return; }

    // C/F directo
    if (nit === 'C/F' || nit === 'CF') {
        const cfOpt = document.querySelector('#posClienteSelect option[value="__cf__"]');
        if (cfOpt) cfOpt.selected = true;
        _posClienteSel = { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad', lista_precio: 'Publico' };
        posCambiarListaPrecio('Publico');
        msgEl.style.display = 'block';
        msgEl.innerHTML = '<span style="color:var(--success);font-weight:600">✓ Consumidor Final (C/F) seleccionado</span>';
        return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Buscando…'; }
    msgEl.style.display = 'block';
    msgEl.innerHTML = '<span style="color:var(--text-muted)">🔄 Buscando NIT…</span>';

    // 1) Buscar en la base de datos local del CRM
    const clienteLocal = _posClientes.find(c =>
        String(c.nit || '').replace(/-/g, '').trim() === nit.replace(/-/g, '').trim()
    );

    if (clienteLocal) {
        // Seleccionar automáticamente en el dropdown
        const sel = document.getElementById('posClienteSelect');
        if (sel) {
            const opt = [...sel.options].find(o => o.value === String(clienteLocal.id));
            if (opt) { opt.selected = true; posOnClienteChange(sel); }
        }
        msgEl.innerHTML = `
            <div style="background:rgba(48,209,88,.08);border:1px solid rgba(48,209,88,.2);border-radius:6px;padding:8px 10px">
                <div style="color:var(--success);font-weight:700;font-size:12px">✓ CLIENTE ENCONTRADO EN CRM</div>
                <div style="color:var(--text-primary);font-weight:600;margin-top:2px">${escHtml(clienteLocal.nombre)}</div>
                <div style="color:var(--text-muted);font-size:10.5px">NIT: ${escHtml(clienteLocal.nit || 'C/F')} ${clienteLocal.empresa ? ' · ' + escHtml(clienteLocal.empresa) : ''}</div>
            </div>`;
        if (btn) { btn.disabled = false; btn.textContent = 'Buscar NIT'; }
        return;
    }

    // 2) Si no está en CRM → consultar validador / API
    _posConsultarNitSAT(nit, function(resultado) {
        if (btn) { btn.disabled = false; btn.textContent = 'Buscar NIT'; }

        const defaultNombre = (resultado && resultado.nombre && !resultado.noRegistrado) ? resultado.nombre : '';
        const tipoDoc = (resultado && resultado.tipo) ? resultado.tipo : 'Documento Fiscal';

        msgEl.innerHTML = `
            <div style="background:rgba(10,132,255,.06);border:1px solid rgba(10,132,255,.18);border-radius:8px;padding:10px 12px;margin-top:4px">
                <div style="color:var(--accent);font-weight:700;font-size:11.5px;margin-bottom:4px">
                    📝 CLIENTE NO REGISTRADO · ${escHtml(tipoDoc)}: ${escHtml(nit)}
                </div>
                <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
                    Ingresa los datos del cliente. Se asociará a esta venta y se guardará automáticamente en el CRM al cobrar.
                </div>
                <div style="display:flex;flex-direction:column;gap:6px">
                    <input class="form-input" id="posNitNuevoNombre" placeholder="Nombre completo o Razón Social *" style="height:32px;font-size:12px;background:var(--card)" value="${escAttr(defaultNombre)}" />
                    <input class="form-input" id="posNitNuevaDireccion" placeholder="Ciudad o Dirección (ej. Ciudad de Guatemala)" style="height:32px;font-size:12px;background:var(--card)" value="Ciudad" />
                    <button type="button" class="topbar-btn" onclick="posConfirmarClienteNuevo('${escAttr(nit)}')" 
                        style="height:30px;font-size:11.5px;background:var(--success);color:#fff;justify-content:center;font-weight:700;border-radius:6px;box-shadow:0 2px 6px rgba(48,209,88,.25)">
                        ✓ Usar y auto-registrar en CRM al cobrar
                    </button>
                </div>
            </div>`;
    });
}

function posConfirmarClienteNuevo(nit) {
    const nomEl = document.getElementById('posNitNuevoNombre');
    const dirEl = document.getElementById('posNitNuevaDireccion');
    const nombre = (nomEl && nomEl.value.trim()) || ('Cliente NIT ' + nit);
    const direccion = (dirEl && dirEl.value.trim()) || 'Ciudad';

    _posClienteSel = {
        id: null,
        nombre: nombre,
        nit: nit,
        direccion: direccion,
        lista_precio: 'Publico',
        clienteNuevo: true
    };

    const sel = document.getElementById('posClienteSelect');
    if (sel) {
        let opt = sel.querySelector('option[value="__sat_temp__"]');
        if (!opt) {
            opt = document.createElement('option');
            opt.value = '__sat_temp__';
            sel.appendChild(opt);
        }
        opt.textContent = `${nombre} (NIT: ${nit}) [Nuevo]`;
        opt.selected = true;
    }

    const msgEl = document.getElementById('posNitResultMsg');
    if (msgEl) {
        msgEl.innerHTML = `<div style="background:rgba(48,209,88,.08);border:1px solid rgba(48,209,88,.2);border-radius:6px;padding:6px 10px;color:var(--success);font-size:11.5px;font-weight:600">
            ✓ Cliente preparado: <strong>${escHtml(nombre)}</strong>. Se guardará en la base de datos al facturar.
        </div>`;
    }
    showToast('Cliente listo para facturar ✓', '#30D158');
    renderPosCarrito();
}

/* ── Consultar NIT en la API pública de SAT Guatemala ── */
function _posConsultarNitSAT(nit, callback) {
    // Usar el backend GAS como proxy para consultar el NIT
    // (Evita problemas de CORS y mantiene la vía legal)
    try {
        window.api
            .withSuccessHandler(function(res) {
                if (res && res.ok && res.data) {
                    callback(res.data);
                } else {
                    callback(null);
                }
            })
            .withFailureHandler(function() {
                // Fallback: si el backend no tiene la función, retornar null
                callback(null);
            })
            .consultarNitSat(nit);
    } catch (e) {
        console.warn('[POS] consultarNitSat no disponible:', e);
        callback(null);
    }
}

/* ── Usar datos de SAT para la venta actual sin crear cliente ── */
function posUsarDatosSat(nit, nombre) {
    _posClienteSel = {
        id: null,
        nombre: nombre,
        nit: nit,
        direccion: 'Ciudad',
        lista_precio: 'Publico'
    };
    // Actualizar visual
    const sel = document.getElementById('posClienteSelect');
    if (sel) {
        // Agregar opción temporal
        const tempOpt = document.createElement('option');
        tempOpt.value = '__sat_temp__';
        tempOpt.textContent = `${nombre} · NIT: ${nit} (SAT)`;
        tempOpt.selected = true;
        // Quitar opción SAT previa si existe
        const prev = sel.querySelector('option[value="__sat_temp__"]');
        if (prev) prev.remove();
        sel.appendChild(tempOpt);
    }
    showToast(`Cliente SAT seleccionado: ${nombre}`, '#30D158');
    renderPosCarrito();
}

function posLimpiarNitBusqueda() {
    const inputEl = document.getElementById('posNitSearchInput');
    const msgEl   = document.getElementById('posNitResultMsg');
    if (inputEl) inputEl.value = '';
    if (msgEl)   { msgEl.style.display = 'none'; msgEl.innerHTML = ''; }
    // Quitar opción temporal SAT si existe
    const sel = document.getElementById('posClienteSelect');
    if (sel) {
        const tempOpt = sel.querySelector('option[value="__sat_temp__"]');
        if (tempOpt) tempOpt.remove();
    }
}

/* ══════════════════════════════════════════════════════════════════
   PROBAR CONEXIÓN FEL — Verificar credenciales con certificador SAT
══════════════════════════════════════════════════════════════════ */
function probarConexionFel() {
    if (typeof window.getCurrentPlan === 'function' && window.getCurrentPlan() === 'starter') {
        if (typeof window.showUpgradeModal === 'function') {
            window.showUpgradeModal('fel');
        }
        return;
    }
    const btn = document.getElementById('btnProbarFel');
    const msgEl = document.getElementById('felEstadoConexionTxt');
    if (!btn || !msgEl) return;

    const cert  = document.getElementById('felCertificador')?.value || '';
    const user  = document.getElementById('felUsuarioCertificador')?.value || '';
    const key   = document.getElementById('felApiKey')?.value || '';
    const nit   = document.getElementById('felNitEmisor')?.value || '';
    const entorno = document.getElementById('felEntorno')?.value || 'Pruebas';

    if (!user || !key || !nit) {
        msgEl.innerHTML = '<span style="color:#FF453A;font-weight:600">✗ Completa usuario, API key y NIT del emisor antes de probar.</span>';
        return;
    }

    btn.disabled = true;
    btn.textContent = '🔄 Verificando…';
    msgEl.innerHTML = '<span style="color:var(--text-muted)">Conectando con ' + escHtml(cert) + '…</span>';

    try {
        window.api
            .withSuccessHandler(function(res) {
                btn.disabled = false;
                btn.textContent = '🔌 Probar Conexión SAT';
                if (res && res.ok) {
                    msgEl.innerHTML = `
                        <div style="color:var(--success);font-weight:700">✓ Conexión exitosa con ${escHtml(cert)}</div>
                        <div style="color:var(--text-muted);font-size:11px;margin-top:2px">
                            Entorno: ${escHtml(entorno)} · NIT: ${escHtml(nit)} · Certificador responde correctamente
                        </div>`;
                } else {
                    msgEl.innerHTML = `<span style="color:#FF453A;font-weight:600">✗ Error: ${escHtml((res && res.error) || 'No se pudo conectar')}</span>`;
                }
            })
            .withFailureHandler(function(err) {
                btn.disabled = false;
                btn.textContent = '🔌 Probar Conexión SAT';
                msgEl.innerHTML = `<span style="color:#FF9F0A;font-weight:600">⚠ Función no disponible en el backend aún. Configura la Edge Function de FEL.</span>`;
            })
            .probarConexionFel({ certificador: cert, usuario: user, apiKey: key, nit: nit, entorno: entorno });
    } catch (e) {
        btn.disabled = false;
        btn.textContent = '🔌 Probar Conexión SAT';
        msgEl.innerHTML = '<span style="color:#FF9F0A">⚠ La función de prueba FEL no está configurada en el backend.</span>';
    }
}

