/* ═══════════════════════════════════════════════════════════════════
   pos.js — Módulo Punto de Venta (POS) Multitenant · Azyvion CRM
   Soporte para múltiples listas de precios (Público, Plata, Oro),
   descuento de stock en tiempo real, registro contable y ticket térmico.
═══════════════════════════════════════════════════════════════════ */

let _posProductos = [];
let _posClientes = [];
let _posCuentas = [];
let _posCarrito = [];
let _posClienteSel = null; // { id, nombre, nit, direccion, lista_precio }
let _posListaPrecioActual = 'Publico'; // 'Publico' | 'Plata' | 'Oro'
let _posFiltroCat = 'Todos';
let _posMetodoPago = 'Efectivo'; // 'Efectivo' | 'Tarjeta' | 'Transferencia'
let _posCuentaBancoId = null;
let _posViewMode = 'images'; // 'images' | 'compact'
let _posTipoFiltro = 'todos'; // 'todos' | 'codigo' | 'descripcion' | 'stock' | 'servicios'
let _posPaginaActual = 0;
const _POS_ITEMS_PER_PAGE = 50;
let _posCajaAbierta = false;
let _posCajaId = null;
let _posCajaMontoInicial = 0;

/* ──────────────────────────────────────────────────────────────────
   INICIALIZACIÓN DEL POS
────────────────────────────────────────────────────────────────── */
async function loadPos() {
    const catalogEl = document.getElementById('posProductCatalog');
    if (catalogEl) catalogEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Cargando catálogo POS…</div>';
    _posPaginaActual = 0;
    _posCajaCheckStatus();

    try {
        window.api
            .withSuccessHandler(function(res) {
                if (!res || !res.ok) {
                    showToast('Error cargando POS: ' + ((res && res.error) || 'Sin respuesta'), '#FF453A');
                    return;
                }
                _posProductos = (res.productos || []).filter(p => p.activo !== false && String(p.activo).toLowerCase() !== 'false');
                _posClientes  = res.clientes || [];
                _posCuentas   = res.cuentas || [];
                
                _initPosClientesSelect();
                _initPosCategoriasFilter();
                renderPosCatalogo();
                renderPosCarrito();
            })
            .withFailureHandler(function(err) {
                showToast('Error de conexión POS: ' + (err.message || err), '#FF453A');
            })
            .getPosInit();
    } catch (e) {
        console.error('[POS] loadPos:', e);
    }
}

function _initPosClientesSelect() {
    const sel = document.getElementById('posClienteSelect');
    if (!sel) return;
    
    let html = '<option value="__cf__">Consumidor Final (C/F)</option>';
    _posClientes.forEach(c => {
        const lp = c.lista_precio || 'Publico';
        html += `<option value="${c.id}" data-lp="${lp}" data-nit="${escAttr(c.nit || 'C/F')}" data-dir="${escAttr(c.direccion || '')}">
            ${escHtml(c.nombre)} ${c.empresa ? '(' + escHtml(c.empresa) + ')' : ''} · [${lp}]
        </option>`;
    });
    sel.innerHTML = html;
    _posClienteSel = { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad', lista_precio: 'Publico' };
}

function posOnClienteChange(sel) {
    const val = sel.value;
    if (val === '__cf__') {
        _posClienteSel = { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad', lista_precio: 'Publico' };
        posCambiarListaPrecio('Publico');
    } else {
        const c = _posClientes.find(x => String(x.id) === String(val));
        if (c) {
            _posClienteSel = {
                id: c.id,
                nombre: c.nombre,
                nit: c.nit || 'C/F',
                direccion: c.direccion || 'Ciudad',
                lista_precio: c.lista_precio || 'Publico'
            };
            posCambiarListaPrecio(c.lista_precio || 'Publico');
        }
    }
}

function posCambiarListaPrecio(lp) {
    _posListaPrecioActual = lp;
    document.querySelectorAll('.pos-lp-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lp === lp);
    });
    // Actualizar precios en carrito si ya hay items agregados
    _posCarrito.forEach(it => {
        it.precioUnit = _obtenerPrecioSegunLista(it.prodOriginal, _posListaPrecioActual);
        it.total = it.precioUnit * it.cantidad;
    });
    renderPosCatalogo();
    renderPosCarrito();
}

function _obtenerPrecioSegunLista(prod, lp) {
    if (!prod) return 0;
    const pPub = Number(prod.precioUnit || prod.precio || 0);
    const pPla = Number(prod.precioPlata || 0);
    const pOro = Number(prod.precioOro || 0);

    if (lp === 'Plata') return pPla > 0 ? pPla : pPub;
    if (lp === 'Oro')   return pOro > 0 ? pOro : (pPla > 0 ? pPla : pPub);
    return pPub;
}

function _initPosCategoriasFilter() {
    const wrap = document.getElementById('posCatFilterWrap');
    if (!wrap) return;
    const cats = ['Todos'];
    _posProductos.forEach(p => {
        if (p.categoria && !cats.includes(p.categoria)) cats.push(p.categoria);
    });

    wrap.innerHTML = cats.map(c => `
        <button class="filter-tab ${c === _posFiltroCat ? 'active' : ''}" onclick="posFiltrarCat('${escAttr(c)}', this)">
            ${escHtml(c)}
        </button>
    `).join('');
}

function posFiltrarCat(cat, btn) {
    _posFiltroCat = cat;
    if (btn) {
        btn.closest('#posCatFilterWrap').querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    renderPosCatalogo();
}

/* ──────────────────────────────────────────────────────────────────
   RENDER DEL CATÁLOGO DE PRODUCTOS (con imágenes, paginación y filtros)
────────────────────────────────────────────────────────────────── */
function renderPosCatalogo() {
    const catalogEl = document.getElementById('posProductCatalog');
    if (!catalogEl) return;

    let items = _posProductos;

    // Filtro por categoría
    if (_posFiltroCat !== 'Todos') {
        items = items.filter(p => p.categoria === _posFiltroCat);
    }

    // Búsqueda con tipo de filtro
    const q = (document.getElementById('posSearchInput')?.value || '').trim().toLowerCase();
    if (q) {
        items = items.filter(p => {
            switch (_posTipoFiltro) {
                case 'codigo':
                    return String(p.sku || '').toLowerCase().includes(q) ||
                           String(p.codigo || '').toLowerCase().includes(q) ||
                           String(p.id || '').toLowerCase().includes(q);
                case 'descripcion':
                    return String(p.producto || '').toLowerCase().includes(q) ||
                           String(p.descripcion || '').toLowerCase().includes(q);
                case 'stock':
                    return (Number(p.unidades || 0) > 0) && (
                        String(p.producto || '').toLowerCase().includes(q) ||
                        String(p.sku || '').toLowerCase().includes(q)
                    );
                case 'servicios':
                    return p.tipo === 'Servicio' && (
                        String(p.producto || '').toLowerCase().includes(q) ||
                        String(p.sku || '').toLowerCase().includes(q)
                    );
                default: // 'todos'
                    return String(p.producto || '').toLowerCase().includes(q) ||
                           String(p.sku || '').toLowerCase().includes(q) ||
                           String(p.categoria || '').toLowerCase().includes(q) ||
                           String(p.codigo || '').toLowerCase().includes(q) ||
                           String(p.descripcion || '').toLowerCase().includes(q);
            }
        });
    } else {
        // Filtro de tipo sin texto de búsqueda
        if (_posTipoFiltro === 'stock') {
            items = items.filter(p => Number(p.unidades || 0) > 0 && p.tipo !== 'Servicio');
        } else if (_posTipoFiltro === 'servicios') {
            items = items.filter(p => p.tipo === 'Servicio');
        }
    }

    if (!items.length) {
        catalogEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--text-muted)">No se encontraron productos con ese criterio.</div>';
        _posToggleLoadMore(false, 0, 0);
        return;
    }

    // Aplicar modo de vista
    const isCompact = _posViewMode === 'compact';
    catalogEl.classList.toggle('compact-view', isCompact);

    // Paginación
    const totalItems = items.length;
    const maxItems = (_posPaginaActual + 1) * _POS_ITEMS_PER_PAGE;
    const visibleItems = items.slice(0, maxItems);
    const hayMas = totalItems > maxItems;

    const showFicha = typeof esAdmin === 'function' && esAdmin();

    catalogEl.innerHTML = visibleItems.map(p => {
        const esServicio = p.tipo === 'Servicio';
        const stock = Number(p.unidades || 0);
        const precio = _obtenerPrecioSegunLista(p, _posListaPrecioActual);
        const imgUrl = p.imagenUrl || p.imagen_url || p.fotoUrl || '';
        const iniciales = (p.producto || '??').substring(0, 2).toUpperCase();
        
        let stockBadgeBg, stockBadgeColor, stockLabel;
        if (esServicio) {
            stockBadgeBg = 'rgba(10,132,255,.15)'; stockBadgeColor = 'var(--accent)'; stockLabel = '⭐ Servicio';
        } else if (stock <= 0) {
            stockBadgeBg = 'rgba(255,69,58,.15)'; stockBadgeColor = '#FF453A'; stockLabel = 'Agotado';
        } else if (stock <= 5) {
            stockBadgeBg = 'rgba(255,159,10,.15)'; stockBadgeColor = '#FF9F0A'; stockLabel = `Stock: ${stock}`;
        } else {
            stockBadgeBg = 'rgba(48,209,88,.15)'; stockBadgeColor = '#30D158'; stockLabel = `Stock: ${stock}`;
        }

        const agotado = !esServicio && stock <= 0;
        const mostrarFotos = typeof EMPRESA === 'undefined' || EMPRESA.catalogoFotosHabilitado !== false;

        const imageSection = (!isCompact && mostrarFotos) ? `
            <div class="pos-item-img-wrap">
                ${imgUrl
                    ? `<img class="pos-item-img" src="${escAttr(imgUrl)}" alt="${escAttr(p.producto)}" onerror="this.parentElement.innerHTML='<div class=\\'pos-item-placeholder\\'>${iniciales}</div>'" loading="lazy" />`
                    : `<div class="pos-item-placeholder">${iniciales}</div>`
                }
                <span class="pos-item-stock-badge" style="background:${stockBadgeBg};color:${stockBadgeColor}">${stockLabel}</span>
            </div>` : '';

        const fichaBtn = showFicha ? `
            <button class="pos-item-ficha-btn" onclick="event.stopPropagation();posVerFichaProducto('${p.id}')" title="Ver ficha de producto">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:12px;height:12px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            </button>` : '';

        return `
        <div class="pos-item-card ${agotado ? 'disabled' : ''}" onclick="${agotado ? '' : `posAgregarItem('${p.id}')`}">
            ${fichaBtn}
            ${imageSection}
            <div class="pos-item-info">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">
                    <div class="pos-item-title">${escHtml(p.producto)}</div>
                    ${isCompact ? `<span style="font-size:9px;padding:1px 5px;border-radius:4px;font-weight:700;background:${stockBadgeBg};color:${stockBadgeColor};white-space:nowrap">${stockLabel}</span>` : ''}
                </div>
                <div class="pos-item-sku">${p.sku ? 'SKU: ' + escHtml(p.sku) : (p.categoria || 'General')}</div>
                <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto">
                    <div class="pos-item-price">Q ${Number(precio).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                    <div class="pos-item-lp-tag">${_posListaPrecioActual}</div>
                </div>
            </div>
        </div>`;
    }).join('');

    _posToggleLoadMore(hayMas, visibleItems.length, totalItems);
}

/* ── Controlar botón "Cargar más" ── */
function _posToggleLoadMore(show, loaded, total) {
    const wrap = document.getElementById('posLoadMoreWrap');
    const btn = document.getElementById('posLoadMoreBtn');
    if (!wrap) return;
    if (show) {
        wrap.style.display = 'block';
        if (btn) btn.textContent = `Cargar más productos… (${loaded} de ${total})`;
    } else {
        wrap.style.display = 'none';
    }
}

function posCargarMasItems() {
    _posPaginaActual++;
    renderPosCatalogo();
}

/* ── Cambiar modo de vista (con fotos / compacto) ── */
function posToggleViewMode() {
    _posViewMode = _posViewMode === 'images' ? 'compact' : 'images';
    const btn = document.getElementById('posToggleViewBtn');
    if (btn) {
        btn.innerHTML = _posViewMode === 'images' ? '🖼️ Con fotos' : '📋 Compacto';
    }
    renderPosCatalogo();
}

/* ── Cambiar tipo de filtro de búsqueda ── */
function posSetTipoFiltro(tipo, btn) {
    _posTipoFiltro = tipo;
    _posPaginaActual = 0;
    document.querySelectorAll('#posFilterBar .pos-filter-chip').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    renderPosCatalogo();
}

/* ── Filtrar catálogo desde la barra de búsqueda ── */
function posFiltrarCatalogo() {
    _posPaginaActual = 0;
    renderPosCatalogo();
}

/* ── Ver ficha de producto (solo admin) ── */
function posVerFichaProducto(prodId) {
    if (typeof esAdmin === 'function' && !esAdmin()) {
        showToast('Solo los administradores pueden ver la ficha del producto', '#FF9F0A');
        return;
    }
    const prod = _posProductos.find(p => String(p.id) === String(prodId));
    if (!prod) return;
    
    const precio = _obtenerPrecioSegunLista(prod, 'Publico');
    const pPlata = Number(prod.precioPlata || 0);
    const pOro   = Number(prod.precioOro || 0);
    const imgUrl = prod.imagenUrl || prod.imagen_url || prod.fotoUrl || '';
    
    openModal('Ficha de Producto · ' + escHtml(prod.producto), `
        <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:flex-start">
            <div style="width:120px;height:120px;border-radius:12px;background:var(--bg-secondary);border:1px solid var(--border);overflow:hidden;display:flex;align-items:center;justify-content:center">
                ${imgUrl
                    ? `<img src="${escAttr(imgUrl)}" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'" />`
                    : `<span style="font-size:32px;font-weight:900;color:var(--accent)">${(prod.producto || '??').substring(0,2).toUpperCase()}</span>`
                }
            </div>
            <div>
                <div style="font-size:18px;font-weight:800;color:var(--text-primary)">${escHtml(prod.producto)}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${prod.sku ? 'SKU: ' + escHtml(prod.sku) : ''} ${prod.categoria ? '· ' + escHtml(prod.categoria) : ''}</div>
                <div style="display:flex;gap:12px;margin-top:10px;font-size:13px">
                    <span style="font-weight:700;color:var(--accent)">Público: Q ${Number(precio).toFixed(2)}</span>
                    ${pPlata > 0 ? `<span style="color:var(--text-secondary)">Plata: Q ${pPlata.toFixed(2)}</span>` : ''}
                    ${pOro > 0 ? `<span style="color:var(--text-secondary)">Oro: Q ${pOro.toFixed(2)}</span>` : ''}
                </div>
                <div style="margin-top:10px;font-size:12.5px;color:var(--text-secondary)">
                    <strong>Tipo:</strong> ${escHtml(prod.tipo || 'Producto')} · 
                    <strong>Stock:</strong> ${prod.tipo === 'Servicio' ? 'Servicio (ilimitado)' : Number(prod.unidades || 0)}
                </div>
                ${prod.descripcion ? `<div style="margin-top:8px;font-size:12px;color:var(--text-muted);line-height:1.4">${escHtml(prod.descripcion)}</div>` : ''}
            </div>
        </div>
    `);
    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) sBtn.style.display = 'none';
}

/* ──────────────────────────────────────────────────────────────────
   LÓGICA DEL CARRITO POS
────────────────────────────────────────────────────────────────── */
function posAgregarItem(prodId) {
    const prod = _posProductos.find(p => String(p.id) === String(prodId));
    if (!prod) return;

    const esServicio = prod.tipo === 'Servicio';
    const stockMax = Number(prod.unidades || 0);

    const exist = _posCarrito.find(it => String(it.id) === String(prodId));
    if (exist) {
        if (!esServicio && exist.cantidad >= stockMax) {
            showToast('Stock insuficiente para agregar más unidades', '#FF9F0A');
            return;
        }
        exist.cantidad += 1;
        exist.total = exist.cantidad * exist.precioUnit;
    } else {
        const precioUnit = _obtenerPrecioSegunLista(prod, _posListaPrecioActual);
        _posCarrito.push({
            id: prod.id,
            producto: prod.producto,
            tipo: prod.tipo,
            sku: prod.sku || '',
            precioUnit: precioUnit,
            cantidad: 1,
            total: precioUnit,
            stockMax: stockMax,
            prodOriginal: prod
        });
    }

    renderPosCarrito();
}

function posModificarCantidad(prodId, delta) {
    const it = _posCarrito.find(x => String(x.id) === String(prodId));
    if (!it) return;

    const esServicio = it.tipo === 'Servicio';
    const nuevaCant = it.cantidad + delta;

    if (nuevaCant <= 0) {
        posEliminarItem(prodId);
        return;
    }

    if (!esServicio && nuevaCant > it.stockMax) {
        showToast('No hay suficiente stock disponible (' + it.stockMax + ' máx.)', '#FF9F0A');
        return;
    }

    it.cantidad = nuevaCant;
    it.total = it.cantidad * it.precioUnit;
    renderPosCarrito();
}

function posEliminarItem(prodId) {
    _posCarrito = _posCarrito.filter(it => String(it.id) !== String(prodId));
    renderPosCarrito();
}

function posVaciarCarrito() {
    if (!_posCarrito.length) return;
    if (confirm('¿Vaciar la orden actual del POS?')) {
        _posCarrito = [];
        renderPosCarrito();
    }
}

function renderPosCarrito() {
    const tbody = document.getElementById('posCartTbody');
    const badge = document.getElementById('posCartCount');
    const subtotalEl = document.getElementById('posSubtotal');
    const totalEl = document.getElementById('posTotalPagar');
    const btnCobrar = document.getElementById('posBtnCobrar');
    if (!tbody) return;

    const totalItems = _posCarrito.reduce((s, it) => s + it.cantidad, 0);
    if (badge) badge.textContent = totalItems;

    if (!_posCarrito.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" style="text-align:center;padding:48px 16px;color:var(--text-muted)">
                    <svg viewBox="0 0 24 24" style="width:40px;height:40px;stroke:var(--border);stroke-width:1.5;fill:none;margin-bottom:10px;display:block;margin-inline:auto">
                        <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                    </svg>
                    El carrito está vacío.<br><small style="opacity:.8">Toca o busca un producto a la izquierda para agregarlo.</small>
                </td>
            </tr>`;
        if (subtotalEl) subtotalEl.textContent = 'Q 0.00';
        if (totalEl) totalEl.textContent = 'Q 0.00';
        if (btnCobrar) { btnCobrar.disabled = true; btnCobrar.textContent = 'GUARDAR (Q 0.00)'; }
        return;
    }

    const subtotal = _posCarrito.reduce((s, it) => s + it.total, 0);
    const descPct = Number(document.getElementById('posDescuentoPct')?.value || 0);
    const descuentoMonto = Math.round((subtotal * (descPct / 100)) * 100) / 100;
    const total = Math.max(0, subtotal - descuentoMonto);

    tbody.innerHTML = _posCarrito.map(it => `
        <tr>
            <td style="padding:10px 8px">
                <div style="font-weight:600;font-size:13px;color:var(--text-primary)">${escHtml(it.producto)}</div>
                <div style="font-size:11px;color:var(--text-muted)">Q ${Number(it.precioUnit).toFixed(2)} c/u</div>
            </td>
            <td style="padding:10px 4px;text-align:center">
                <div class="pos-qty-control">
                    <button class="pos-qty-btn" onclick="posModificarCantidad('${it.id}', -1)">−</button>
                    <span class="pos-qty-num">${it.cantidad}</span>
                    <button class="pos-qty-btn" onclick="posModificarCantidad('${it.id}', 1)">+</button>
                </div>
            </td>
            <td style="padding:10px 8px;text-align:right;font-weight:700;color:var(--text-primary);font-size:13.5px">
                Q ${Number(it.total).toFixed(2)}
            </td>
            <td style="padding:10px 4px;text-align:center">
                <button class="cot-item-del" style="opacity:.7;font-size:16px" title="Quitar item" onclick="posEliminarItem('${it.id}')">&times;</button>
            </td>
        </tr>
    `).join('');

    const fQ = n => 'Q ' + Number(n).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});
    if (subtotalEl) subtotalEl.textContent = fQ(subtotal);
    if (totalEl) totalEl.textContent = fQ(total);
    if (btnCobrar) {
        btnCobrar.disabled = false;
        btnCobrar.innerHTML = `GUARDAR · ${fQ(total)}`;
    }

    // Actualizar cálculo de cambio si el modal de cobro está abierto
    posRecalcularCambio(total);
}

/* ──────────────────────────────────────────────────────────────────
   PROCESO DE COBRO Y PAGO (GUARDAR VENTA)
────────────────────────────────────────────────────────────────── */
function posAbrirModalCobro() {
    if (!_posCarrito.length) {
        showToast('Agrega productos al carrito antes de guardar la venta', '#FF9F0A');
        return;
    }
    const subtotal = _posCarrito.reduce((s, it) => s + it.total, 0);
    const descPct = Number(document.getElementById('posDescuentoPct')?.value || 0);
    const descuentoMonto = Math.round((subtotal * (descPct / 100)) * 100) / 100;
    const total = Math.max(0, subtotal - descuentoMonto);

    // Reiniciar método de pago a Efectivo para cada nueva venta
    _posMetodoPago = 'Efectivo';

    // Asegurar cliente seleccionado
    if (!_posClienteSel) {
        _posClienteSel = { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad', lista_precio: 'Publico' };
    }

    _modalMode = { type: 'pos_checkout' };

    let bankOptions = '';
    _posCuentas.forEach(b => {
        bankOptions += `<option value="${b.id}">${escHtml(b.nombre)} (${escHtml(b.banco)} - ${escHtml(b.numeroCuenta)})</option>`;
    });

    openModal('Guardar Venta POS', `
        <div style="background:linear-gradient(135deg,#0A2540,#1E4C7A);color:#fff;border-radius:12px;padding:20px;text-align:center;margin-bottom:18px">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:.8">TOTAL DE LA VENTA</div>
            <div style="font-size:32px;font-weight:900;margin-top:4px" id="posModalTotalTxt">Q ${Number(total).toFixed(2)}</div>
            <div style="font-size:12px;opacity:.85;margin-top:4px">Cliente: <strong>${escHtml(_posClienteSel.nombre)}</strong> · Tarifa: [${_posListaPrecioActual}]</div>
        </div>

        <div class="form-field" style="margin-bottom:14px">
            <label class="form-label">MÉTODO DE PAGO</label>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px" id="posMetodosPagoWrap">
                <button type="button" class="pos-pay-opt active" onclick="posSetMetodoPago('Efectivo', this)">💵 Efectivo</button>
                <button type="button" class="pos-pay-opt" onclick="posSetMetodoPago('Tarjeta', this)">💳 Tarjeta</button>
                <button type="button" class="pos-pay-opt" onclick="posSetMetodoPago('Transferencia', this)">🏦 Depósito / Transfer</button>
            </div>
        </div>

        <!-- Panel Efectivo -->
        <div id="posPanelEfectivo">
            <div class="form-field">
                <label class="form-label">MONTO RECIBIDO EN EFECTIVO (Q)</label>
                <input class="form-input" id="posMontoRecibido" type="number" step="0.01" value="${total.toFixed(2)}" oninput="posRecalcularCambio(${total})" style="font-size:18px;font-weight:700" />
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
                <button type="button" class="filter-tab" onclick="posSetBillete(20, ${total})">Q20</button>
                <button type="button" class="filter-tab" onclick="posSetBillete(50, ${total})">Q50</button>
                <button type="button" class="filter-tab" onclick="posSetBillete(100, ${total})">Q100</button>
                <button type="button" class="filter-tab" onclick="posSetBillete(200, ${total})">Q200</button>
                <button type="button" class="filter-tab" onclick="posSetBillete(${total}, ${total})">Exacto</button>
            </div>
            <div style="background:var(--card);border:1.5px dashed var(--border);border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:13px;font-weight:600;color:var(--text-muted)">CAMBIO / VUELTO:</span>
                <span style="font-size:20px;font-weight:800;color:var(--success)" id="posCambioTxt">Q 0.00</span>
            </div>
        </div>

        <!-- Panel Tarjeta -->
        <div id="posPanelTarjeta" style="display:none">
            <div class="form-field">
                <label class="form-label">NO. DE AUTORIZACIÓN / VOUCHER (Opcional)</label>
                <input class="form-input" id="posAuthTarjeta" placeholder="Ej. AUTH-88219" />
            </div>
        </div>

        <!-- Panel Transferencia -->
        <div id="posPanelTransferencia" style="display:none">
            <div class="form-field">
                <label class="form-label">CUENTA BANCARIA DESTINO</label>
                <select class="form-select" id="posCuentaBancariaSel">
                    ${bankOptions || '<option value="">Caja Principal</option>'}
                </select>
            </div>
            <div class="form-field">
                <label class="form-label">NO. DE BOLETA O TRANSACCIÓN</label>
                <input class="form-input" id="posRefTransf" placeholder="Ej. 98452104" />
            </div>
        </div>
    `);

    // Asignar función global para ejecución por botón o por submit de modal
    window.posConfirmarVentaActual = () => posConfirmarVenta(total, descuentoMonto, subtotal);

    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) {
        sBtn.textContent = 'GUARDAR';
        sBtn.style.background = '#30D158';
        sBtn.disabled = false;
        sBtn.style.display = '';
        sBtn.onclick = window.posConfirmarVentaActual;
    }
}

function posSetMetodoPago(metodo, btn) {
    _posMetodoPago = metodo;
    document.querySelectorAll('#posMetodosPagoWrap .pos-pay-opt').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    const panelEf = document.getElementById('posPanelEfectivo');
    const panelTj = document.getElementById('posPanelTarjeta');
    const panelTr = document.getElementById('posPanelTransferencia');
    if (panelEf) panelEf.style.display = metodo === 'Efectivo' ? 'block' : 'none';
    if (panelTj) panelTj.style.display = metodo === 'Tarjeta' ? 'block' : 'none';
    if (panelTr) panelTr.style.display = metodo === 'Transferencia' ? 'block' : 'none';
}

function posSetBillete(monto, total) {
    const el = document.getElementById('posMontoRecibido');
    if (el) {
        el.value = Number(monto).toFixed(2);
        posRecalcularCambio(total);
    }
}

function posRecalcularCambio(total) {
    const el = document.getElementById('posMontoRecibido');
    const cambioEl = document.getElementById('posCambioTxt');
    if (!el || !cambioEl) return;
    const rec = Number(el.value || 0);
    const cambio = Math.max(0, rec - total);
    cambioEl.textContent = 'Q ' + cambio.toFixed(2);
}

/* ──────────────────────────────────────────────────────────────────
   GUARDAR VENTA Y REGISTRAR EN EL BACKEND
────────────────────────────────────────────────────────────────── */
async function posConfirmarVenta(total, descuentoMonto, subtotal) {
    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) { sBtn.disabled = true; sBtn.textContent = 'Guardando…'; }

    // Si los parámetros no vinieron explícitos, calcular desde el carrito actual
    if (total === undefined || isNaN(total)) {
        subtotal = _posCarrito.reduce((s, it) => s + it.total, 0);
        const descPct = Number(document.getElementById('posDescuentoPct')?.value || 0);
        descuentoMonto = Math.round((subtotal * (descPct / 100)) * 100) / 100;
        total = Math.max(0, subtotal - descuentoMonto);
    }

    const recibido = Number(document.getElementById('posMontoRecibido')?.value || total);
    const cambio = Math.max(0, recibido - total);
    const rawBanco = document.getElementById('posCuentaBancariaSel')?.value;
    const cuentaBancoId = (_posMetodoPago === 'Transferencia' && rawBanco && String(rawBanco).trim() !== '') ? String(rawBanco).trim() : null;

    const clienteActual = _posClienteSel || { id: null, nombre: 'Consumidor Final (C/F)', nit: 'C/F', direccion: 'Ciudad' };

    const payload = {
        clienteNombre: clienteActual.nombre || 'Consumidor Final (C/F)',
        clienteId: clienteActual.id || null,
        nit: clienteActual.nit || 'C/F',
        direccion: clienteActual.direccion || 'Ciudad',
        metodoPago: _posMetodoPago || 'Efectivo',
        cuentaBancariaId: cuentaBancoId,
        subtotal: subtotal,
        descuento: descuentoMonto,
        total: total,
        montoRecibido: recibido,
        cambio: cambio,
        items: _posCarrito.map(it => ({
            id: it.id,
            descripcion: it.producto,
            tipo: it.tipo,
            sku: it.sku,
            cantidad: it.cantidad,
            precioUnit: it.precioUnit,
            total: it.total
        }))
    };

    try {
        window.api
            .withSuccessHandler(function(res) {
                if (!res || !res.ok) {
                    showToast('Error al guardar venta POS: ' + ((res && res.error) || 'Fallo desconocido'), '#FF453A');
                    if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'GUARDAR'; }
                    return;
                }
                closeModal();
                showToast('¡Venta guardada exitosamente! ✓', '#30D158');
                
                // Vaciar carrito y resetear estado para que la siguiente venta funcione inmediatamente
                _posCarrito = [];
                _posMetodoPago = 'Efectivo';
                _modalMode = null;
                if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'GUARDAR'; }
                
                renderPosCarrito();
                loadPos();
                if (typeof loadInventario === 'function') loadInventario();
                if (typeof loadTransacciones === 'function') loadTransacciones();

                // Si esta venta provino de una cotización, marcarla como Aprobada
                if (window._posCotizacionOrigenId) {
                    const cotId = window._posCotizacionOrigenId;
                    window._posCotizacionOrigenId = null;
                    if (window.api && typeof window.api.updateEstadoCotizacion === 'function') {
                        window.api.updateEstadoCotizacion({id: cotId, estado: 'Aprobada'});
                    }
                    if (typeof loadCotizaciones === 'function') loadCotizaciones();
                }

                // Mostrar ticket térmico modal
                posMostrarTicketTermico(res.ticket);
            })
            .withFailureHandler(function(err) {
                showToast('Error de comunicación: ' + (err.message || err), '#FF453A');
                if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'GUARDAR'; }
            })
            .registrarVentaPos(payload);
    } catch (e) {
        console.error('[POS] confirm error:', e);
        if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'GUARDAR'; }
    }
}

/* ──────────────────────────────────────────────────────────────────
   VISTA DE TICKET TÉRMICO E IMPRESIÓN (CON SOPORTE FEL SAT)
────────────────────────────────────────────────────────────────── */
function posMostrarTicketTermico(t) {
    if (!t) return;
    const em = t.empresa || {};
    const fQ = n => 'Q ' + Number(n || 0).toFixed(2);
    const fecha = new Date(t.fecha).toLocaleString('es-GT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });

    const itemsHtml = (t.items || []).map(it => `
        <tr>
            <td style="text-align:left;padding:3px 0">${escHtml(it.descripcion)}<br><small style="color:#666">${it.cantidad} x ${fQ(it.precioUnit)}</small></td>
            <td style="text-align:right;padding:3px 0;vertical-align:bottom;font-weight:600">${fQ(it.total)}</td>
        </tr>
    `).join('');

    const felHtml = t.fel ? `
        <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;margin:8px 0;padding:6px 0;font-size:10px;text-align:center;background:#fafafa">
            <div style="font-weight:900;letter-spacing:.5px;color:#0A2540">DOCUMENTO TRIBUTARIO ELECTRÓNICO (FEL)</div>
            <div style="font-weight:700;margin-top:2px">AUTORIZACIÓN / UUID SAT:</div>
            <div style="font-family:monospace;font-size:9.5px;word-break:break-all">${escHtml(t.fel.uuidSat)}</div>
            <div style="display:flex;justify-content:space-around;margin-top:4px">
                <span><strong>SERIE:</strong> ${escHtml(t.fel.serieDte)}</span>
                <span><strong>NÚMERO:</strong> ${escHtml(t.fel.numeroDte)}</span>
            </div>
            <div style="margin-top:3px;font-size:9px;color:#555">Certificador: ${escHtml(t.fel.certificador)}</div>
            <div style="margin-top:2px;font-size:9px;font-style:italic">${escHtml(t.fel.fraseSat)}</div>
            <div style="margin-top:4px;font-size:9px"><a href="${escAttr(t.fel.enlaceVerificacionSat)}" target="_blank" style="color:#0A84FF;text-decoration:underline">Verificar DTE en Portal SAT ↗</a></div>
        </div>
    ` : '';

    const ticketHtml = `
        <div id="ticketTermicoArea" style="font-family:'Courier New',Courier,monospace;max-width:320px;margin:0 auto;padding:16px;background:#fff;color:#000;border:1px dashed #ccc;line-height:1.3;font-size:12px">
            <div style="text-align:center;margin-bottom:10px">
                ${em.logoUrl ? `<img src="${escAttr(em.logoUrl)}" style="max-height:48px;max-width:180px;object-fit:contain;margin-bottom:6px"><br>` : ''}
                <div style="font-size:15px;font-weight:900;text-transform:uppercase">${escHtml(em.nombre || 'AZYVION CRM')}</div>
                ${em.eslogan ? `<div style="font-size:10.5px;color:#555">${escHtml(em.eslogan)}</div>` : ''}
                <div style="font-size:11px;margin-top:4px">NIT: ${escHtml((t.fel && t.fel.nitEmisor) || em.nit || 'C/F')}</div>
                ${em.direccion ? `<div style="font-size:10.5px">${escHtml(em.direccion)}</div>` : ''}
                ${em.telefono ? `<div style="font-size:10.5px">Tel: ${escHtml(em.telefono)}</div>` : ''}
            </div>

            <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;padding:6px 0;margin-bottom:10px;font-size:11px">
                <div><strong>COMPROBANTE:</strong> ${escHtml(t.numero)}</div>
                <div><strong>FECHA:</strong> ${fecha}</div>
                <div><strong>CAJERO:</strong> ${escHtml(t.cajero || 'Admin')}</div>
                <div><strong>CLIENTE:</strong> ${escHtml(t.cliente)}</div>
                <div><strong>NIT:</strong> ${escHtml(t.nit)}</div>
            </div>

            ${felHtml}

            <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11.5px">
                <thead>
                    <tr style="border-bottom:1px solid #000">
                        <th style="text-align:left;padding-bottom:4px">DESCRIPCIÓN</th>
                        <th style="text-align:right;padding-bottom:4px">TOTAL</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemsHtml}
                </tbody>
            </table>

            <div style="border-top:1px dashed #000;padding-top:6px;font-size:12px">
                <div style="display:flex;justify-content:space-between"><span>SUBTOTAL:</span><span>${fQ(t.subtotal)}</span></div>
                ${t.descuento > 0 ? `<div style="display:flex;justify-content:space-between;color:#a00"><span>DESCUENTO:</span><span>-${fQ(t.descuento)}</span></div>` : ''}
                <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:900;margin:6px 0;border-top:1px solid #000;padding-top:4px">
                    <span>TOTAL:</span><span>${fQ(t.total)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:11px"><span>MÉTODO DE PAGO:</span><span>${escHtml(t.metodoPago)}</span></div>
                ${t.metodoPago === 'Efectivo' ? `
                    <div style="display:flex;justify-content:space-between;font-size:11px"><span>RECIBIDO:</span><span>${fQ(t.montoRecibido)}</span></div>
                    <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:700"><span>CAMBIO:</span><span>${fQ(t.cambio)}</span></div>
                ` : ''}
            </div>

            ${(() => {
                let extraOrg = {};
                try { extraOrg = JSON.parse(localStorage.getItem('azyvion_org_extra') || '{}'); } catch(e) {}
                const pieCustom = (t.empresa && t.empresa.pieTicket) || (em && em.pieTicket) || (window.EMPRESA && window.EMPRESA.pieTicket) || extraOrg.pie_ticket;
                return pieCustom
                    ? `<div style="text-align:center;margin-top:16px;font-size:10.5px;color:#444;white-space:pre-line;border-top:1px dashed #000;padding-top:8px">${escHtml(pieCustom)}</div>`
                    : `<div style="text-align:center;margin-top:18px;font-size:10.5px;color:#444">¡Gracias por su compra!<br>Conserve este comprobante para cualquier gestión.</div>`;
            })()}
        </div>
    `;

    window._ultimoTicket = t;
    openModal('Comprobante de Venta · ' + t.numero, `
        ${ticketHtml}
        
        <!-- Enviar por correo electrónico -->
        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:14px">
            <div style="font-size:11px;font-weight:700;color:var(--text-primary);margin-bottom:6px">✉️ ENVIAR COMPROBANTE POR CORREO</div>
            <div style="display:flex;gap:6px">
                <input class="form-input" id="posTicketCorreoDestino" type="email" placeholder="correo@cliente.com" style="height:34px;font-size:12px;background:var(--card)" value="${escAttr(t.clienteEmail || '')}" />
                <button type="button" class="topbar-btn" onclick="posEnviarTicketPorCorreo()" id="posBtnEnviarCorreo" style="height:34px;padding:0 14px;font-size:11.5px;background:var(--accent);color:#fff;font-weight:600;white-space:nowrap">
                    Enviar
                </button>
            </div>
            <div id="posTicketCorreoStatus" style="font-size:11px;margin-top:6px;display:none;line-height:1.3"></div>
        </div>

        <div style="display:flex;gap:10px;margin-top:14px;justify-content:center">
            <button class="topbar-btn" style="background:var(--accent);color:#fff;padding:0 24px;height:38px;font-size:13px;font-weight:700" onclick="posImprimirTicket()">
                🖨️ Imprimir Ticket
            </button>
            <button class="topbar-btn" style="padding:0 20px;height:38px;font-size:13px" onclick="closeModal(); _modalMode = null;">
                Listo / Cerrar
            </button>
        </div>
    `);

    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) sBtn.style.display = 'none';
}

function posEnviarTicketPorCorreo() {
    const input = document.getElementById('posTicketCorreoDestino');
    const statusEl = document.getElementById('posTicketCorreoStatus');
    const btn = document.getElementById('posBtnEnviarCorreo');
    const email = (input && input.value.trim()) || '';
    if (!email || !email.includes('@')) {
        showToast('Ingresa un correo electrónico válido', '#FF9F0A');
        return;
    }
    if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Enviando comprobante…'; statusEl.style.color = 'var(--text-muted)'; }

    window.api
        .withSuccessHandler(function(res) {
            if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
            if (res && res.ok) {
                if (statusEl) {
                    statusEl.innerHTML = `<span style="color:var(--success);font-weight:600">✓ ${escHtml(res.mensaje || 'Enviado')}</span>`;
                }
                showToast('✓ Comprobante enviado a ' + email, '#30D158');
            } else {
                if (statusEl) statusEl.innerHTML = `<span style="color:#FF453A">${escHtml((res && res.error) || 'Fallo al enviar')}</span>`;
                showToast('Error enviando correo', '#FF453A');
            }
        })
        .withFailureHandler(function(err) {
            if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
            if (statusEl) statusEl.innerHTML = `<span style="color:#FF453A">Error: ${escHtml(err.message || err)}</span>`;
        })
        .enviarTicketCorreo({ correo: email, ticket: window._ultimoTicket });
}

function posImprimirTicket() {
    const area = document.getElementById('ticketTermicoArea');
    if (!area) return;
    const w = window.open('', '_blank', 'width=380,height=600');
    w.document.write(`
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Imprimir Ticket</title>
        <style>
            @page { margin: 0; size: 80mm auto; }
            body { margin: 0; padding: 10px; font-family: 'Courier New', Courier, monospace; }
        </style>
        </head><body>${area.innerHTML}</body></html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 350);
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
   APERTURA Y CIERRE DE CAJA — Control de turnos POS
   · Nomenclatura contable: Cuenta Caja (1.1.1.01)
   · Registra monto inicial, ventas, ingresos y cierre con cuadre
══════════════════════════════════════════════════════════════════ */
function _posCajaCheckStatus() {
    const bar = document.getElementById('posCajaBar');
    if (!bar) return;

    try {
        window.api
            .withSuccessHandler(function(res) {
                if (res && res.ok && res.cajaAbierta) {
                    _posCajaAbierta = true;
                    _posCajaId = res.cajaId;
                    _posCajaMontoInicial = Number(res.montoInicial || 0);
                    _renderCajaBar(bar, true, res);
                } else {
                    _posCajaAbierta = false;
                    _posCajaId = null;
                    _renderCajaBar(bar, false, null);
                }
            })
            .withFailureHandler(function() {
                // Si la función no existe aún, mostrar caja como disponible (sin bloqueo)
                _posCajaAbierta = true;
                _renderCajaBar(bar, true, { cajero: (typeof _usuario !== 'undefined' ? _usuario : 'Cajero'), montoInicial: 0, fecha: new Date().toISOString() });
            })
            .getCajaStatus();
    } catch (e) {
        // Backend no disponible — permitir operación sin bloqueo
        _posCajaAbierta = true;
        _renderCajaBar(bar, true, { cajero: 'Cajero', montoInicial: 0, fecha: new Date().toISOString() });
    }
}

function _renderCajaBar(bar, abierta, data) {
    if (!bar) return;
    const fQ = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});

    if (abierta && data) {
        const hora = data.fecha ? new Date(data.fecha).toLocaleTimeString('es-GT', {hour:'2-digit', minute:'2-digit'}) : '--:--';
        bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px">
                <span class="tag tag-success" style="font-size:11px">● Caja Abierta</span>
                <span style="font-size:12px;color:var(--text-secondary)">
                    Cajero: <strong>${escHtml(data.cajero || 'Cajero')}</strong> · 
                    Apertura: ${hora} · 
                    Fondo: <strong>${fQ(data.montoInicial)}</strong>
                </span>
                <span style="font-size:10px;color:var(--text-muted);font-family:monospace" title="Cuenta contable: Caja">📒 Cta. 1.1.1.01</span>
            </div>
            <div style="display:flex;gap:6px">
                <button class="topbar-btn" onclick="posAbrirCierreCaja()" style="height:32px;padding:0 12px;font-size:11.5px;background:var(--danger);color:#fff">
                    🔒 Cerrar Caja
                </button>
            </div>`;
    } else {
        bar.innerHTML = `
            <div style="display:flex;align-items:center;gap:10px">
                <span class="tag tag-danger" style="font-size:11px">○ Caja Cerrada</span>
                <span style="font-size:12px;color:var(--text-muted)">Abre la caja para iniciar operaciones POS</span>
            </div>
            <div style="display:flex;gap:6px">
                <button class="topbar-btn" onclick="posAbrirAperturaCaja()" style="height:32px;padding:0 12px;font-size:11.5px;background:var(--success);color:#fff">
                    🔓 Abrir Caja
                </button>
            </div>`;
    }
}

function posAbrirAperturaCaja() {
    _modalMode = { type: 'caja_apertura' };
    openModal('Apertura de Caja', `
        <div class="ajustes-alert ajustes-alert-info" style="margin-bottom:16px">
            📒 <strong>Nomenclatura contable:</strong> La apertura de caja registra un asiento en la cuenta 
            <code style="background:var(--bg-secondary);padding:2px 6px;border-radius:4px;font-size:12px">1.1.1.01 — Caja General</code>
        </div>
        <div class="form-field" style="margin-bottom:14px">
            <label class="form-label">MONTO INICIAL / FONDO DE CAJA (Q)</label>
            <input class="form-input" id="cajaMontoInicial" type="number" step="0.01" min="0" value="500.00" 
                   style="font-size:18px;font-weight:700;text-align:center" />
        </div>
        <div class="form-field" style="margin-bottom:14px">
            <label class="form-label">OBSERVACIONES (Opcional)</label>
            <input class="form-input" id="cajaObservaciones" placeholder="Ej. Turno matutino, efectivo contado" />
        </div>
        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;color:var(--text-secondary)">
            <strong>Asiento contable generado:</strong>
            <div style="display:grid;grid-template-columns:1fr auto auto;gap:4px 12px;margin-top:6px;font-family:monospace;font-size:11px">
                <span>1.1.1.01 Caja General</span><span style="color:var(--success)">DEBE</span><span id="cajaAsientoDebe">Q 500.00</span>
                <span>3.1.1.01 Capital de Trabajo</span><span style="color:var(--danger)">HABER</span><span id="cajaAsientoHaber">Q 500.00</span>
            </div>
        </div>
    `);
    // Actualizar asiento en tiempo real
    const montoInput = document.getElementById('cajaMontoInicial');
    if (montoInput) {
        montoInput.oninput = function() {
            const m = Number(this.value || 0);
            const fQ = 'Q ' + m.toFixed(2);
            const d = document.getElementById('cajaAsientoDebe');
            const h = document.getElementById('cajaAsientoHaber');
            if (d) d.textContent = fQ;
            if (h) h.textContent = fQ;
        };
    }
    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) {
        sBtn.textContent = 'GUARDAR';
        sBtn.style.background = '#30D158';
        sBtn.onclick = posConfirmarAperturaCaja;
    }
}

function posConfirmarAperturaCaja() {
    const monto = Number(document.getElementById('cajaMontoInicial')?.value || 0);
    const obs   = document.getElementById('cajaObservaciones')?.value || '';
    const sBtn  = document.getElementById('modalSaveBtn');
    if (sBtn) { sBtn.disabled = true; sBtn.textContent = 'Guardando…'; }

    try {
        window.api
            .withSuccessHandler(function(res) {
                if (res && res.ok) {
                    closeModal();
                    _modalMode = null;
                    _posCajaAbierta = true;
                    _posCajaId = res.cajaId;
                    _posCajaMontoInicial = monto;
                    showToast('✓ Caja abierta correctamente. Fondo: Q ' + monto.toFixed(2), '#30D158');
                    _posCajaCheckStatus();
                } else {
                    showToast('Error al abrir caja: ' + ((res && res.error) || 'Desconocido'), '#FF453A');
                    if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'GUARDAR'; }
                }
            })
            .withFailureHandler(function(err) {
                // Si la función del backend no existe aún, simular apertura
                closeModal();
                _modalMode = null;
                _posCajaAbierta = true;
                _posCajaMontoInicial = monto;
                showToast('✓ Caja abierta (modo local). Fondo: Q ' + monto.toFixed(2), '#30D158');
                _posCajaCheckStatus();
            })
            .abrirCajaPOS({ montoInicial: monto, observaciones: obs });
    } catch (e) {
        closeModal();
        _modalMode = null;
        _posCajaAbierta = true;
        _posCajaMontoInicial = monto;
        showToast('✓ Caja abierta (modo local)', '#30D158');
        _posCajaCheckStatus();
    }
}

function posAbrirCierreCaja() {
    _modalMode = { type: 'caja_cierre' };
    openModal('Cierre de Caja', `
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;border-radius:12px;padding:20px;text-align:center;margin-bottom:18px">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:.8">RESUMEN DE CAJA</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;text-align:center">
                <div>
                    <div style="font-size:11px;opacity:.7">Fondo Inicial</div>
                    <div style="font-size:20px;font-weight:800" id="cierreMontoInicial">Q ${_posCajaMontoInicial.toFixed(2)}</div>
                </div>
                <div>
                    <div style="font-size:11px;opacity:.7">Ventas del turno</div>
                    <div style="font-size:20px;font-weight:800;color:#30D158" id="cierreVentas">Cargando…</div>
                </div>
            </div>
        </div>

        <div class="form-field" style="margin-bottom:14px">
            <label class="form-label">EFECTIVO CONTADO EN CAJA (Q)</label>
            <input class="form-input" id="cierreEfectivoContado" type="number" step="0.01" min="0" value="${_posCajaMontoInicial.toFixed(2)}" 
                   style="font-size:18px;font-weight:700;text-align:center" oninput="posCierreCuadrar()" />
        </div>

        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <span style="color:var(--text-secondary)">Diferencia:</span>
                <span id="cierreDiferencia" style="font-weight:700;font-size:14px">Q 0.00</span>
            </div>
            <div id="cierreDifMsg" style="font-size:11px;color:var(--text-muted)">El efectivo cuadra con el esperado.</div>
        </div>

        <div class="form-field" style="margin-bottom:14px">
            <label class="form-label">OBSERVACIONES DEL CIERRE (Opcional)</label>
            <textarea class="form-input" id="cierreObservaciones" rows="2" style="resize:vertical" placeholder="Notas adicionales del turno"></textarea>
        </div>

        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:12px;color:var(--text-secondary)">
            <strong>📒 Asiento contable de cierre:</strong>
            <div style="display:grid;grid-template-columns:1fr auto auto;gap:4px 12px;margin-top:6px;font-family:monospace;font-size:11px">
                <span>4.1.1.01 Ingresos por Ventas</span><span style="color:var(--success)">DEBE</span><span id="cierreAsientoCta">—</span>
                <span>1.1.1.01 Caja General</span><span style="color:var(--danger)">HABER</span><span id="cierreAsientoCaja">—</span>
            </div>
        </div>
    `);

    // Cargar ventas del turno
    try {
        window.api
            .withSuccessHandler(function(res) {
                if (res && res.ok) {
                    const ventasTurno = Number(res.totalVentas || 0);
                    const el = document.getElementById('cierreVentas');
                    if (el) el.textContent = 'Q ' + ventasTurno.toFixed(2);
                    posCierreCuadrar();
                }
            })
            .withFailureHandler(function() { posCierreCuadrar(); })
            .getVentasTurnoCaja(_posCajaId || '');
    } catch(e) { posCierreCuadrar(); }

    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) {
        sBtn.textContent = 'GUARDAR';
        sBtn.style.background = 'var(--danger)';
        sBtn.onclick = posConfirmarCierreCaja;
    }
}

function posCierreCuadrar() {
    const contado    = Number(document.getElementById('cierreEfectivoContado')?.value || 0);
    const ventasTxt  = (document.getElementById('cierreVentas')?.textContent || '').replace(/[^\d.-]/g, '');
    const ventas     = Number(ventasTxt || 0);
    const esperado   = _posCajaMontoInicial + ventas;
    const diferencia = contado - esperado;

    const difEl  = document.getElementById('cierreDiferencia');
    const msgEl  = document.getElementById('cierreDifMsg');
    const fQ = n => 'Q ' + Math.abs(n).toFixed(2);

    if (difEl) {
        difEl.textContent = (diferencia >= 0 ? '+' : '-') + fQ(diferencia);
        difEl.style.color = diferencia === 0 ? 'var(--success)' : diferencia > 0 ? 'var(--accent)' : '#FF453A';
    }
    if (msgEl) {
        if (diferencia === 0) msgEl.textContent = '✓ El efectivo cuadra con el esperado.';
        else if (diferencia > 0) msgEl.textContent = '⬆ Sobrante en caja. Se registrará como ingreso extra.';
        else msgEl.textContent = '⬇ Faltante en caja. Se registrará como diferencia a investigar.';
    }

    const ctaEl = document.getElementById('cierreAsientoCta');
    const cajaEl = document.getElementById('cierreAsientoCaja');
    if (ctaEl) ctaEl.textContent = 'Q ' + ventas.toFixed(2);
    if (cajaEl) cajaEl.textContent = 'Q ' + contado.toFixed(2);
}

function posConfirmarCierreCaja() {
    const contado = Number(document.getElementById('cierreEfectivoContado')?.value || 0);
    const obs     = document.getElementById('cierreObservaciones')?.value || '';
    const sBtn    = document.getElementById('modalSaveBtn');
    if (sBtn) { sBtn.disabled = true; sBtn.textContent = 'Guardando…'; }

    try {
        window.api
            .withSuccessHandler(function(res) {
                if (res && res.ok) {
                    closeModal();
                    _modalMode = null;
                    _posCajaAbierta = false;
                    _posCajaId = null;
                    showToast('✓ Caja cerrada correctamente. Efectivo contado: Q ' + contado.toFixed(2), '#30D158');
                    _posCajaCheckStatus();
                    posMostrarResumenCierre(res);
                } else {
                    showToast('Error al cerrar caja: ' + ((res && res.error) || 'Desconocido'), '#FF453A');
                    if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'GUARDAR'; }
                }
            })
            .withFailureHandler(function() {
                closeModal();
                _modalMode = null;
                _posCajaAbierta = false;
                showToast('✓ Caja cerrada (modo local)', '#30D158');
                _posCajaCheckStatus();
            })
            .cerrarCajaPOS({ cajaId: _posCajaId, efectivoContado: contado, observaciones: obs });
    } catch (e) {
        closeModal();
        _modalMode = null;
        _posCajaAbierta = false;
        showToast('✓ Caja cerrada (modo local)', '#30D158');
        _posCajaCheckStatus();
    }
}

function posMostrarResumenCierre(d) {
    if (!d) return;
    window._ultimoCierreCaja = d;
    const fQ = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});
    const fFecha = iso => iso ? new Date(iso).toLocaleString('es-GT', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
    const dif = Number(d.diferencia || 0);

    openModal('Resumen de Cierre de Caja · ' + (d.cajaId || ''), `
        <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--border)">
                <div>
                    <span class="tag tag-gray">${escHtml(d.cajaId || 'TURNO')}</span>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Cajero: <strong>${escHtml(d.cajero || 'Cajero')}</strong></div>
                </div>
                <div style="text-align:right;font-size:11px;color:var(--text-secondary)">
                    <div>Apertura: ${fFecha(d.fechaApertura)}</div>
                    <div>Cierre: ${fFecha(d.fechaCierre)}</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
                <div style="background:var(--card);padding:10px 12px;border-radius:8px;border:1px solid var(--border)">
                    <div style="font-size:11px;color:var(--text-muted)">Fondo Inicial</div>
                    <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${fQ(d.montoInicial)}</div>
                </div>
                <div style="background:var(--card);padding:10px 12px;border-radius:8px;border:1px solid var(--border)">
                    <div style="font-size:11px;color:var(--text-muted)">Ventas Efectivo</div>
                    <div style="font-size:16px;font-weight:800;color:var(--success)">${fQ(d.ventasEfectivo)}</div>
                </div>
                <div style="background:var(--card);padding:10px 12px;border-radius:8px;border:1px solid var(--border)">
                    <div style="font-size:11px;color:var(--text-muted)">Ventas Electrónicas</div>
                    <div style="font-size:16px;font-weight:800;color:var(--accent)">${fQ((Number(d.ventasTarjeta || 0) + Number(d.ventasTransferencia || 0) + Number(d.ventasOtros || 0)))}</div>
                </div>
                <div style="background:var(--card);padding:10px 12px;border-radius:8px;border:1px solid var(--border)">
                    <div style="font-size:11px;color:var(--text-muted)">Total Ventas Turno</div>
                    <div style="font-size:16px;font-weight:800;color:var(--text-primary)">${fQ(d.totalVentas)}</div>
                </div>
            </div>

            <div style="background:var(--card);border:1.5px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
                    <span style="color:var(--text-secondary)">Total Esperado en Caja:</span>
                    <strong style="color:var(--text-primary)">${fQ(d.esperado)}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
                    <span style="color:var(--text-secondary)">Efectivo Físico Contado:</span>
                    <strong style="color:var(--text-primary)">${fQ(d.contado)}</strong>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;padding-top:6px;border-top:1px dashed var(--border)">
                    <span style="font-weight:700">Diferencia de Cuadre:</span>
                    <strong style="font-weight:900;color:${dif === 0 ? 'var(--success)' : dif > 0 ? 'var(--accent)' : '#FF453A'}">
                        ${dif >= 0 ? '+' : ''}${fQ(dif)}
                    </strong>
                </div>
            </div>
            ${d.observaciones ? `<div style="font-size:11.5px;color:var(--text-muted);font-style:italic">Notas: ${escHtml(d.observaciones)}</div>` : ''}
        </div>

        <div style="display:flex;gap:10px;justify-content:center">
            <button class="topbar-btn" style="background:var(--accent);color:#fff;padding:0 20px;height:38px;font-size:13px;font-weight:700" onclick="posImprimirCorteCaja()">
                🖨️ Imprimir Corte de Caja (PDF)
            </button>
            <button class="topbar-btn" style="padding:0 20px;height:38px;font-size:13px" onclick="closeModal(); _modalMode = null;">
                Cerrar
            </button>
        </div>
    `);
    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) sBtn.style.display = 'none';
}

function posImprimirCorteCaja(cierreData) {
    const d = cierreData || window._ultimoCierreCaja;
    if (!d) { showToast('No hay datos de cierre disponibles para imprimir', '#FF9F0A'); return; }
    const fQ = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});
    const fFecha = iso => iso ? new Date(iso).toLocaleString('es-GT', {day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'}) : '—';
    const em = (typeof EMPRESA !== 'undefined' ? EMPRESA : {}) || {};
    const dif = Number(d.diferencia || 0);

    const w = window.open('', '_blank', 'width=420,height=680');
    w.document.write(`
        <!DOCTYPE html><html><head><meta charset="utf-8"><title>Corte de Caja - ${escHtml(d.cajaId || '')}</title>
        <style>
            @page { margin: 8mm; size: 80mm auto; }
            body { font-family: 'Courier New', Courier, monospace; margin: 0; padding: 10px; font-size: 12px; color: #000; line-height: 1.35; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .sep { border-top: 1px dashed #000; margin: 8px 0; }
            .row { display: flex; justify-content: space-between; margin-bottom: 3px; }
            .title { font-size: 14px; font-weight: 900; text-transform: uppercase; }
            .firmas { margin-top: 36px; display: flex; justify-content: space-between; }
            .firma-box { width: 45%; text-align: center; border-top: 1px solid #000; padding-top: 4px; font-size: 10px; }
        </style>
        </head><body>
            <div class="center">
                <div class="title">${escHtml(em.nombre || 'AZYVION CRM')}</div>
                ${em.eslogan ? `<div style="font-size:10px">${escHtml(em.eslogan)}</div>` : ''}
                <div style="font-size:11px;margin-top:2px">NIT: ${escHtml(em.nit || 'C/F')}</div>
                <div class="sep"></div>
                <div class="bold" style="font-size:13px">CORTE Y CIERRE DE CAJA (ARQUEO)</div>
                <div style="font-size:10px;margin-top:2px">ID: ${escHtml(d.cajaId || '')}</div>
            </div>

            <div class="sep"></div>
            <div class="row"><span>CAJERO:</span><span class="bold">${escHtml(d.cajero || 'Cajero')}</span></div>
            <div class="row"><span>APERTURA:</span><span>${fFecha(d.fechaApertura)}</span></div>
            <div class="row"><span>CIERRE:</span><span>${fFecha(d.fechaCierre)}</span></div>
            <div class="sep"></div>

            <div class="row"><span>FONDO INICIAL:</span><span class="bold">${fQ(d.montoInicial)}</span></div>
            <div class="row"><span>VENTAS EFECTIVO:</span><span>${fQ(d.ventasEfectivo)}</span></div>
            <div class="row"><span>VENTAS TARJETA:</span><span>${fQ(d.ventasTarjeta)}</span></div>
            <div class="row"><span>VENTAS TRANSFER:</span><span>${fQ(d.ventasTransferencia)}</span></div>
            <div class="row"><span>VENTAS OTROS:</span><span>${fQ(d.ventasOtros)}</span></div>
            <div class="sep"></div>
            <div class="row bold" style="font-size:13px"><span>TOTAL VENTAS:</span><span>${fQ(d.totalVentas)}</span></div>
            <div class="sep"></div>

            <div class="row"><span>TOTAL ESPERADO:</span><span class="bold">${fQ(d.esperado)}</span></div>
            <div class="row"><span>EFECTIVO CONTADO:</span><span class="bold">${fQ(d.contado)}</span></div>
            <div class="row bold" style="font-size:13px;margin-top:4px">
                <span>DIFERENCIA:</span>
                <span>${dif >= 0 ? '+' : ''}${fQ(dif)}</span>
            </div>
            <div style="font-size:10px;text-align:right;font-style:italic">
                ${dif === 0 ? '(Efectivo cuadrado)' : dif > 0 ? '(Sobrante en caja)' : '(Faltante en caja)'}
            </div>

            ${d.observaciones ? `<div class="sep"></div><div style="font-size:10px"><strong>OBS:</strong> ${escHtml(d.observaciones)}</div>` : ''}

            <div class="firmas">
                <div class="firma-box">Firma Cajero</div>
                <div class="firma-box">Firma Supervisor</div>
            </div>

            <div class="center" style="margin-top:20px;font-size:9px;color:#666">
                Generado por Sistema POS Azyvion · ${new Date().toLocaleString('es-GT')}
            </div>
        </body></html>
    `);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 350);
}

/* ══════════════════════════════════════════════════════════════════
   PROBAR CONEXIÓN FEL — Verificar credenciales con certificador SAT
══════════════════════════════════════════════════════════════════ */
function probarConexionFel() {
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
