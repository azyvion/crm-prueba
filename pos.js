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

/* ──────────────────────────────────────────────────────────────────
   INICIALIZACIÓN DEL POS
────────────────────────────────────────────────────────────────── */
async function loadPos() {
    const catalogEl = document.getElementById('posProductCatalog');
    if (catalogEl) catalogEl.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted)">Cargando catálogo POS…</div>';

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
   RENDER DEL CATÁLOGO DE PRODUCTOS
────────────────────────────────────────────────────────────────── */
function renderPosCatalogo() {
    const catalogEl = document.getElementById('posProductCatalog');
    if (!catalogEl) return;

    let items = _posProductos;
    if (_posFiltroCat !== 'Todos') {
        items = items.filter(p => p.categoria === _posFiltroCat);
    }

    const q = (document.getElementById('posSearchInput')?.value || '').trim().toLowerCase();
    if (q) {
        items = items.filter(p => 
            String(p.producto || '').toLowerCase().includes(q) ||
            String(p.sku || '').toLowerCase().includes(q) ||
            String(p.categoria || '').toLowerCase().includes(q)
        );
    }

    if (!items.length) {
        catalogEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px 20px;color:var(--text-muted)">No se encontraron productos con ese criterio.</div>';
        return;
    }

    catalogEl.innerHTML = items.map(p => {
        const esServicio = p.tipo === 'Servicio';
        const stock = Number(p.unidades || 0);
        const precio = _obtenerPrecioSegunLista(p, _posListaPrecioActual);
        
        let stockTag = '';
        if (esServicio) {
            stockTag = '<span class="tag tag-accent" style="font-size:10.5px">Servicio</span>';
        } else if (stock <= 0) {
            stockTag = '<span class="tag tag-danger" style="font-size:10.5px">Agotado (0)</span>';
        } else if (stock <= 5) {
            stockTag = `<span class="tag tag-warning" style="font-size:10.5px">Stock bajo (${stock})</span>`;
        } else {
            stockTag = `<span class="tag tag-success" style="font-size:10.5px">Stock: ${stock}</span>`;
        }

        const agotado = !esServicio && stock <= 0;

        return `
        <div class="pos-item-card ${agotado ? 'disabled' : ''}" onclick="${agotado ? '' : `posAgregarItem('${p.id}')`}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:6px">
                <div class="pos-item-title">${escHtml(p.producto)}</div>
                ${stockTag}
            </div>
            <div class="pos-item-sku">${p.sku ? 'SKU: ' + escHtml(p.sku) : (p.categoria || 'General')}</div>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:auto">
                <div class="pos-item-price">Q ${Number(precio).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
                <div class="pos-item-lp-tag">${_posListaPrecioActual}</div>
            </div>
        </div>`;
    }).join('');
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
        if (btnCobrar) { btnCobrar.disabled = true; btnCobrar.textContent = 'COBRAR (Q 0.00)'; }
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
        btnCobrar.innerHTML = `COBRAR · ${fQ(total)}`;
    }

    // Actualizar cálculo de cambio si el modal de cobro está abierto
    posRecalcularCambio(total);
}

/* ──────────────────────────────────────────────────────────────────
   PROCESO DE COBRO Y PAGO
────────────────────────────────────────────────────────────────── */
function posAbrirModalCobro() {
    if (!_posCarrito.length) {
        showToast('Agrega productos al carrito antes de cobrar', '#FF9F0A');
        return;
    }
    const subtotal = _posCarrito.reduce((s, it) => s + it.total, 0);
    const descPct = Number(document.getElementById('posDescuentoPct')?.value || 0);
    const descuentoMonto = Math.round((subtotal * (descPct / 100)) * 100) / 100;
    const total = Math.max(0, subtotal - descuentoMonto);

    _modalMode = { type: 'pos_checkout' };

    let bankOptions = '';
    _posCuentas.forEach(b => {
        bankOptions += `<option value="${b.id}">${escHtml(b.nombre)} (${escHtml(b.banco)} - ${escHtml(b.numeroCuenta)})</option>`;
    });

    openModal('Finalizar Venta POS', `
        <div style="background:linear-gradient(135deg,#0A2540,#1E4C7A);color:#fff;border-radius:12px;padding:20px;text-align:center;margin-bottom:18px">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:1px;opacity:.8">TOTAL A PAGAR</div>
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

    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) {
        sBtn.textContent = 'CONFIRMAR Y EMITIR TICKET ✓';
        sBtn.style.background = '#30D158';
        sBtn.onclick = () => posConfirmarVenta(total, descuentoMonto, subtotal);
    }
}

function posSetMetodoPago(metodo, btn) {
    _posMetodoPago = metodo;
    document.querySelectorAll('#posMetodosPagoWrap .pos-pay-opt').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    document.getElementById('posPanelEfectivo').style.display = metodo === 'Efectivo' ? 'block' : 'none';
    document.getElementById('posPanelTarjeta').style.display = metodo === 'Tarjeta' ? 'block' : 'none';
    document.getElementById('posPanelTransferencia').style.display = metodo === 'Transferencia' ? 'block' : 'none';
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
   CONFIRMAR VENTA Y ENVIAR AL BACKEND
────────────────────────────────────────────────────────────────── */
async function posConfirmarVenta(total, descuentoMonto, subtotal) {
    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) { sBtn.disabled = true; sBtn.textContent = 'Emitiendo ticket…'; }

    const recibido = Number(document.getElementById('posMontoRecibido')?.value || total);
    const cambio = Math.max(0, recibido - total);
    const cuentaBancoId = _posMetodoPago === 'Transferencia' ? document.getElementById('posCuentaBancariaSel')?.value : null;

    const payload = {
        clienteNombre: _posClienteSel.nombre,
        clienteId: _posClienteSel.id,
        nit: _posClienteSel.nit,
        direccion: _posClienteSel.direccion,
        metodoPago: _posMetodoPago,
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
                    showToast('Error al registrar venta POS: ' + ((res && res.error) || 'Fallo desconocido'), '#FF453A');
                    if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'CONFIRMAR Y EMITIR TICKET'; }
                    return;
                }
                closeModal();
                showToast('¡Venta POS registrada con éxito! ✓', '#30D158');
                
                // Vaciar carrito y recargar inventario local
                _posCarrito = [];
                renderPosCarrito();
                loadPos();
                if (typeof loadInventario === 'function') loadInventario();
                if (typeof loadTransacciones === 'function') loadTransacciones();

                // Mostrar ticket térmico modal
                posMostrarTicketTermico(res.ticket);
            })
            .withFailureHandler(function(err) {
                showToast('Error de comunicación: ' + (err.message || err), '#FF453A');
                if (sBtn) { sBtn.disabled = false; sBtn.textContent = 'CONFIRMAR Y EMITIR TICKET'; }
            })
            .registrarVentaPos(payload);
    } catch (e) {
        console.error('[POS] confirm error:', e);
        if (sBtn) sBtn.disabled = false;
    }
}

/* ──────────────────────────────────────────────────────────────────
   VISTA DE TICKET TÉRMICO E IMPRESIÓN
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

    const ticketHtml = `
        <div id="ticketTermicoArea" style="font-family:'Courier New',Courier,monospace;max-width:320px;margin:0 auto;padding:16px;background:#fff;color:#000;border:1px dashed #ccc;line-height:1.3;font-size:12px">
            <div style="text-align:center;margin-bottom:10px">
                ${em.logoUrl ? `<img src="${escAttr(em.logoUrl)}" style="max-height:48px;max-width:180px;object-fit:contain;margin-bottom:6px"><br>` : ''}
                <div style="font-size:15px;font-weight:900;text-transform:uppercase">${escHtml(em.nombre || 'AZYVION CRM')}</div>
                ${em.eslogan ? `<div style="font-size:10.5px;color:#555">${escHtml(em.eslogan)}</div>` : ''}
                <div style="font-size:11px;margin-top:4px">NIT: ${escHtml(em.nit || 'C/F')}</div>
                ${em.direccion ? `<div style="font-size:10.5px">${escHtml(em.direccion)}</div>` : ''}
                ${em.telefono ? `<div style="font-size:10.5px">Tel: ${escHtml(em.telefono)}</div>` : ''}
            </div>

            <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;padding:6px 0;margin-bottom:10px;font-size:11px">
                <div><strong>TICKET:</strong> ${escHtml(t.numero)}</div>
                <div><strong>FECHA:</strong> ${fecha}</div>
                <div><strong>CAJERO:</strong> ${escHtml(t.cajero || 'Admin')}</div>
                <div><strong>CLIENTE:</strong> ${escHtml(t.cliente)}</div>
                <div><strong>NIT:</strong> ${escHtml(t.nit)}</div>
            </div>

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

            <div style="text-align:center;margin-top:18px;font-size:10.5px;color:#444">
                ¡Gracias por su preferencia!<br>
                Conserve este comprobante para cualquier reclamo.
            </div>
        </div>
    `;

    openModal('Comprobante de Venta · ' + t.numero, `
        ${ticketHtml}
        <div style="display:flex;gap:10px;margin-top:16px;justify-content:center">
            <button class="topbar-btn" style="background:var(--accent);color:#fff;padding:0 24px;height:38px;font-size:13px" onclick="posImprimirTicket()">
                🖨️ Imprimir Ticket
            </button>
            <button class="topbar-btn" style="padding:0 20px;height:38px;font-size:13px" onclick="closeModal()">
                Cerrar
            </button>
        </div>
    `);

    const sBtn = document.getElementById('modalSaveBtn');
    if (sBtn) sBtn.style.display = 'none';
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
