/* ══════════════════════════════════════════════════════════
   cotizaciones.js — Render, builder, envío de Cotizaciones
   Extraído de dashboard.html
══════════════════════════════════════════════════════════ */

/* Variables de estado del módulo */
let _cotizaciones    = [];
let _filtroCotActual = 'Todas';
let _cotItems        = [];
let _cotEditId       = null;
let _cotEmpresa      = null;
let _cotClienteListaPrecio = 'Publico';

        /* ══════════════════════════════════════════════════════════
           MÓDULO COTIZACIONES — JavaScript
        ══════════════════════════════════════════════════════════ */

        const COT_IVA_PCT = 12;

        function cotQ(n) {
            const v = Number(n) || 0;
            return 'Q ' + v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        }
        function cotR2(n) {
            const v = Number(n);
            return isNaN(v) ? 0 : Math.round(v * 100) / 100;
        }
        function cotHoyISO() {
            const d = new Date();
            return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
        }
        function cotTagEstado(c) {
            if (c.vencida) return '<span class="tag tag-vencida">Vencida</span>';
            const m = {
                'Borrador': 'tag-borrador', 'Enviada': 'tag-enviada', 'Aprobada': 'tag-aprobada',
                'Rechazada': 'tag-rechazada', 'Vencida': 'tag-vencida'
            };
            return `<span class="tag ${m[c.estado] || 'tag-gray'}">${escHtml(c.estado)}</span>`;
        }

        /* ── Carga ─────────────────────────────────────────────── */
        function loadCotizaciones() {
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) {
                        const tb = document.getElementById('cotTbody');
                        if (tb) tb.innerHTML = '<tr><td colspan="8" class="empty-cell">' +
                            escHtml((r && r.error) || 'No se pudieron cargar las cotizaciones') + '</td></tr>';
                        return;
                    }
                    _cotizaciones = r.data || [];
                    _cotEmpresa   = r.empresa || _cotEmpresa;
                    renderCotizaciones(_filtroCotActual);
                    renderKpisCotizaciones();
                })
                .withFailureHandler(function (err) { _onApiError('cotizaciones', err); })
                .getCotizaciones({});
        }

        function renderKpisCotizaciones() {
            const d = _cotizaciones;
            const aprobadas = d.filter(c => c.estado === 'Aprobada');
            const enviadas  = d.filter(c => c.estado === 'Enviada');
            const borrador  = d.filter(c => c.estado === 'Borrador');
            const vencidas  = d.filter(c => c.vencida);
            const montoAp   = aprobadas.reduce((s, c) => s + Number(c.total || 0), 0);
            const montoEnv  = enviadas.reduce((s, c) => s + Number(c.total || 0), 0);
            const tasa      = d.length ? Math.round(aprobadas.length / d.length * 100) : 0;

            const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
            set('cot-total', d.length);
            set('cot-total-d', borrador.length + ' en borrador · ' + vencidas.length + ' vencidas');
            set('cot-enviadas', enviadas.length);
            set('cot-enviadas-d', cotQ(montoEnv) + ' en seguimiento');
            set('cot-aprobadas', aprobadas.length);
            set('cot-aprobadas-d', tasa + '% de aprobación');
            const kQ = montoAp >= 1000 ? 'Q ' + (montoAp / 1000).toFixed(1) + 'k' : cotQ(montoAp);
            set('cot-monto', kQ);
            set('cot-monto-d', 'Total cerrado');
            const badge = document.getElementById('badgeCotizaciones');
            if (badge) badge.textContent = d.length;
        }

        /* ── Tabla ─────────────────────────────────────────────── */
        function filtrarCot(filtro, el) {
            if (el) {
                el.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                el.classList.add('active');
            }
            renderCotizaciones(filtro);
        }

        function renderCotizaciones(filtro) {
            _filtroCotActual = filtro || 'Todas';
            let data = _cotizaciones.slice();

            if (_filtroCotActual === 'Vencidas')      data = data.filter(c => c.vencida);
            else if (_filtroCotActual !== 'Todas')    data = data.filter(c => c.estado === _filtroCotActual);

            const inp = document.getElementById('searchInput');
            const q = inp ? inp.value.toLowerCase() : '';
            if (q && _currentPage === 'cotizaciones') {
                data = data.filter(c =>
                    String(c.numero || '').toLowerCase().includes(q) ||
                    String(c.cliente || '').toLowerCase().includes(q) ||
                    String(c.empresa || '').toLowerCase().includes(q));
            }

            const tb = document.getElementById('cotTbody');
            if (!tb) return;

            tb.innerHTML = data.length ? data.map(c => `<tr>
        <td><div class="cell-main">${escHtml(c.numero)}</div><div class="cell-sub">${escHtml(c.creadoPor || '')}</div></td>
        <td><div class="cell-main">${escHtml(c.cliente)}</div>${c.empresa ? `<div class="cell-sub">${escHtml(c.empresa)}</div>` : ''}</td>
        <td class="cell-mono">${escHtml(c.fecha)}</td>
        <td class="cell-mono" style="${c.vencida ? 'color:var(--danger)' : ''}">${escHtml(c.validaHasta)}</td>
        <td class="cell-num">${c.numItems}</td>
        <td class="cell-num"><strong>${cotQ(c.total)}</strong></td>
        <td>
          <select class="mini-select" style="width:118px" onchange="cambiarEstadoCot('${c.id}', this.value)">
            ${['Borrador', 'Enviada', 'Aprobada', 'Rechazada', 'Vencida']
                .map(e => `<option${e === c.estado ? ' selected' : ''}>${e}</option>`).join('')}
          </select>
          ${c.vencida ? '<div class="cell-sub" style="color:var(--danger)">Vencida</div>' : ''}
        </td>
        <td>
          <div class="row-actions" style="flex-wrap:wrap;gap:4px">
            <button class="section-action" onclick="verCotizacion('${c.id}')" title="Ver documento PDF">Ver</button>
            <button class="btn-success-sm" onclick="enviarCotizacionModal('${c.id}')" title="Enviar por correo">Correo</button>
            <button class="section-action" onclick="duplicarCotizacion('${c.id}')" title="Crear copia idéntica">Duplicar</button>
            ${c.estado !== 'Aprobada' ? `<button class="section-action" style="color:var(--accent);font-weight:600" onclick="convertirCotizacionAVenta('${c.id}')" title="Convertir a Venta / Descontar stock">Vender</button>
            <button class="section-action" style="color:var(--success);font-weight:600" onclick="cargarCotizacionEnPos('${c.id}')" title="Cargar directamente en POS para cobrar">Cobrar en POS</button>` : ''}
            <button class="section-action" onclick="editarCotizacion('${c.id}')">Editar</button>
            <button class="btn-danger-sm" onclick="confirmDeleteCot('${c.id}','${escAttr(c.numero)}')">Eliminar</button>
          </div>
        </td>
      </tr>`).join('')
                : '<tr><td colspan="8" class="empty-cell">Sin cotizaciones para este filtro</td></tr>';

            const total = data.reduce((s, c) => s + Number(c.total || 0), 0);
            const foot = document.getElementById('cotFoot');
            if (foot) foot.innerHTML = `<span><strong>${data.length}</strong> cotizaciones</span>
                <span>Monto listado: <strong>${cotQ(total)}</strong></span>`;
        }

        window.cargarCotizacionEnPos = function(id) {
            const c = _cotizaciones.find(x => String(x.id) === String(id));
            if (!c) { showToast('Cotización no encontrada', '#FF453A'); return; }

            showToast('Cargando cotización al POS…', '#0A84FF');
            window.api
                .withSuccessHandler(function(r) {
                    if (!r || !r.ok) {
                        showToast((r && r.error) || 'No se pudo cargar la cotización', '#FF453A');
                        return;
                    }
                    const cotData = r.data;
                    const items = r.items || [];
                    if (!items.length) {
                        showToast('La cotización no tiene ítems para cobrar', '#FF9F0A');
                        return;
                    }

                    if (typeof showPage === 'function') {
                        showPage('pos', document.getElementById('nav-pos'));
                    }

                    const transferir = function() {
                        if (cotData.clienteId) {
                            const selCli = document.getElementById('posClienteSelect');
                            if (selCli) {
                                selCli.value = cotData.clienteId;
                                if (typeof posOnClienteChange === 'function') posOnClienteChange(selCli);
                            }
                        } else {
                            _posClienteSel = {
                                id: null,
                                nombre: cotData.cliente || 'Consumidor Final (C/F)',
                                nit: cotData.nit || 'C/F',
                                direccion: cotData.direccion || 'Ciudad',
                                lista_precio: 'Publico'
                            };
                        }

                        _posCarrito = [];
                        items.forEach(it => {
                            const prodOrig = (_posProductos || []).find(p => String(p.id) === String(it.itemId));
                            _posCarrito.push({
                                id: it.itemId || ('cot_it_' + Date.now() + Math.random()),
                                producto: it.descripcion,
                                precioUnit: Number(it.precioUnit) || 0,
                                cantidad: Number(it.cantidad) || 1,
                                descuentoPct: Number(it.descuentoPct) || 0,
                                total: (Number(it.cantidad) || 1) * (Number(it.precioUnit) || 0) * (1 - (Number(it.descuentoPct) || 0) / 100),
                                prodOriginal: prodOrig || { id: it.itemId, producto: it.descripcion, precioUnit: it.precioUnit, tipo: it.tipo }
                            });
                        });

                        window._posCotizacionOrigenId = cotData.id;

                        if (typeof renderPosCarrito === 'function') renderPosCarrito();
                        showToast(`Cotización ${cotData.numero} lista para cobro en caja POS`, '#30D158');
                    };

                    if (!_posProductos || !_posProductos.length) {
                        if (typeof loadPos === 'function') loadPos();
                        setTimeout(transferir, 400);
                    } else {
                        transferir();
                    }
                })
                .withFailureHandler(function(e) {
                    showToast('Error: ' + e.message, '#FF453A');
                })
                .getCotizacion({id: id});
        };

        window.duplicarCotizacion = function(id) {
            if (!confirm('¿Deseas duplicar esta cotización? Se creará un nuevo borrador con los mismos ítems.')) return;
            window.api
                .withSuccessHandler(function(r) {
                    if (r.ok) {
                        showToast('Cotización duplicada con éxito: ' + (r.numero || ''), '#30D158');
                        loadCotizaciones();
                    } else {
                        showToast('Error al duplicar: ' + (r.error || ''), '#FF453A');
                    }
                })
                .withFailureHandler(function(e) { showToast('Error: ' + e.message, '#FF453A'); })
                .duplicarCotizacion({id: id});
        };

        window.convertirCotizacionAVenta = function(id) {
            if (!confirm('¿Deseas convertir esta cotización en Venta?\nSe descontará el stock de inventario y se registrará el ingreso en Contabilidad.')) return;
            window.api
                .withSuccessHandler(function(r) {
                    if (r.ok) {
                        showToast('¡Venta registrada exitosamente! Stock descontado.', '#30D158');
                        loadCotizaciones();
                        loadInventario();
                        if (typeof loadResumenContable === 'function') loadResumenContable();
                    } else {
                        showToast('Error: ' + (r.error || ''), '#FF453A');
                    }
                })
                .withFailureHandler(function(e) { showToast('Error: ' + e.message, '#FF453A'); })
                .convertirCotizacionAVenta({id: id});
        };

        function exportarCotizaciones() {
            const filas = _cotizaciones.map(c => ({
                Numero: c.numero, Cliente: c.cliente, Empresa: c.empresa, Correo: c.correo,
                Fecha: c.fecha, ValidaHasta: c.validaHasta, Items: c.numItems,
                Subtotal: c.subtotal, Descuento: c.descuento, IVA: c.iva, Total: c.total,
                Estado: c.estado, CreadoPor: c.creadoPor
            }));
            descargarCSV(filas, 'cotizaciones');
        }

        /* ── Constructor ───────────────────────────────────────── */
        function cotLlenarSelectClientes() {
            const sel = document.getElementById('cotClienteSel');
            if (!sel) return;
            const actual = sel.value;
            sel.innerHTML = '<option value="">— Escribir manualmente —</option>' +
                (_clientes || []).map(c =>
                    `<option value="${escAttr(c.id)}">${escHtml(c.nombre)}${c.empresa ? ' · ' + escHtml(c.empresa) : ''} [${c.lista_precio || 'Público'}]</option>`
                ).join('');
            if (actual) sel.value = actual;
        }

        function cotLlenarSelectItems() {
            const sel = document.getElementById('cotItemSel');
            if (!sel) return;
            const disponibles = (_inventario || []).filter(i =>
                !(i.activo === false || String(i.activo).toLowerCase() === 'false'));
            sel.innerHTML = '<option value="">Selecciona un producto o servicio del inventario…</option>' +
                disponibles.map(i => {
                    let p = Number(i.precioUnit) || 0;
                    if (_cotClienteListaPrecio === 'Plata' && i.precioPlata) p = Number(i.precioPlata);
                    if (_cotClienteListaPrecio === 'Oro' && i.precioOro) p = Number(i.precioOro);
                    const stockTxt = i.tipo === 'Servicio' ? 'Servicio' : ('Stock: ' + (i.unidades || 0));
                    return `<option value="${escAttr(i.id)}">${escHtml(i.producto)} · ${stockTxt} · ${cotQ(p)}</option>`;
                }).join('');
        }

        function cotAplicarCliente(id) {
            if (!id) {
                _cotClienteListaPrecio = 'Publico';
                cotLlenarSelectItems();
                return;
            }
            const c = (_clientes || []).find(x => String(x.id) === String(id));
            if (!c) return;
            _cotClienteListaPrecio = c.lista_precio || 'Publico';
            const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val || ''; };
            set('cotCliente', c.nombre);
            set('cotEmpresa', c.empresa);
            set('cotCorreo', c.correo);
            set('cotTelefono', c.telefono);
            set('cotDireccion', c.direccion);
            showToast('Tarifa aplicada: ' + _cotClienteListaPrecio, '#0A84FF');
            cotLlenarSelectItems();

            // Actualizar precios de ítems ya agregados según la nueva lista de precios
            if (_cotItems && _cotItems.length) {
                let actualizados = 0;
                _cotItems.forEach(it => {
                    if (it.itemId) {
                        const invItem = (_inventario || []).find(x => String(x.id) === String(it.itemId));
                        if (invItem) {
                            let p = Number(invItem.precioUnit) || 0;
                            if (_cotClienteListaPrecio === 'Plata' && invItem.precioPlata) p = Number(invItem.precioPlata);
                            if (_cotClienteListaPrecio === 'Oro' && invItem.precioOro) p = Number(invItem.precioOro);
                            if (it.precioUnit !== p) {
                                it.precioUnit = p;
                                actualizados++;
                            }
                        }
                    }
                });
                if (actualizados > 0) {
                    cotRenderItems();
                    showToast(`${actualizados} ítem(s) actualizados con tarifa ${_cotClienteListaPrecio}`, '#30D158');
                }
            }
        }

        function openCotBuilder() {
            cotLlenarSelectClientes();
            cotLlenarSelectItems();
            document.getElementById('cotOverlay').classList.add('open');
            document.getElementById('cotBuilder').classList.add('open');
        }

        function closeCotBuilder() {
            document.getElementById('cotOverlay').classList.remove('open');
            document.getElementById('cotBuilder').classList.remove('open');
        }

        function nuevaCotizacion() {
            _cotEditId = null;
            _cotItems = [];
            _cotClienteListaPrecio = 'Publico';
            const cond = (_cotEmpresa && _cotEmpresa.condicionesDefault) ||
                (window.EMPRESA && window.EMPRESA.condicionesDefault) ||
                'Precios expresados en quetzales (GTQ). Tiempo de entrega sujeto a disponibilidad. Esta cotización no constituye una factura.';
            const diasVig = (_cotEmpresa && _cotEmpresa.diasVigenciaCotizacion) ||
                (window.EMPRESA && window.EMPRESA.diasVigenciaCotizacion) || 15;

            document.getElementById('cotBuilderTitle').textContent = 'Nueva cotización';
            document.getElementById('cotBuilderSub').textContent = 'Completa los datos y agrega ítems del inventario';
            document.getElementById('cotSaveBtn').textContent = 'Guardar cotización';
            ['cotCliente', 'cotEmpresa', 'cotCorreo', 'cotTelefono', 'cotDireccion', 'cotNotas'].forEach(id => {
                const el = document.getElementById(id); if (el) el.value = '';
            });
            document.getElementById('cotClienteSel').value = '';
            document.getElementById('cotFecha').value = cotHoyISO();
            document.getElementById('cotValidez').value = diasVig;
            document.getElementById('cotEstado').value = 'Borrador';
            document.getElementById('cotDescuento').value = 0;
            document.getElementById('cotIVA').checked = false;
            document.getElementById('cotCondiciones').value = cond;
            cotRenderItems();
            openCotBuilder();
        }

        function editarCotizacion(id) {
            const btn = document.getElementById('cotSaveBtn');
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo abrir la cotización', '#FF453A'); return; }
                    const c = r.data;
                    _cotEditId = c.id;
                    const cl = (_clientes || []).find(x => String(x.id) === String(c.clienteId));
                    _cotClienteListaPrecio = (cl && cl.lista_precio) ? cl.lista_precio : 'Publico';

                    _cotItems = (r.items || []).map(i => ({
                        itemId: i.itemId, tipo: i.tipo, descripcion: i.descripcion, detalle: i.detalle,
                        cantidad: Number(i.cantidad) || 0, precioUnit: Number(i.precioUnit) || 0,
                        descuentoPct: Number(i.descuentoPct) || 0
                    }));
                    document.getElementById('cotBuilderTitle').textContent = 'Editar ' + c.numero;
                    document.getElementById('cotBuilderSub').textContent = 'Los cambios se guardan sobre la misma cotización';
                    if (btn) btn.textContent = 'Guardar cambios';
                    document.getElementById('cotClienteSel').value = c.clienteId || '';
                    document.getElementById('cotCliente').value = c.cliente || '';
                    document.getElementById('cotEmpresa').value = c.empresa || '';
                    document.getElementById('cotCorreo').value = c.correo || '';
                    document.getElementById('cotTelefono').value = c.telefono || '';
                    document.getElementById('cotDireccion').value = c.direccion || '';
                    document.getElementById('cotFecha').value = c.fecha || cotHoyISO();
                    document.getElementById('cotValidez').value = c.validezDias || 15;
                    document.getElementById('cotEstado').value = c.estado || 'Borrador';
                    document.getElementById('cotDescuento').value = c.descuentoPct || 0;
                    document.getElementById('cotIVA').checked = !!c.aplicaIVA;
                    document.getElementById('cotCondiciones').value = c.condiciones || '';
                    document.getElementById('cotNotas').value = c.notas || '';
                    cotRenderItems();
                    openCotBuilder();
                })
                .withFailureHandler(function (e) { showToast('Error: ' + e.message, '#FF453A'); })
                .getCotizacion({id: id});
        }

        /* ── Ítems ─────────────────────────────────────────────── */
        function cotAgregarDesdeInventario() {
            const sel = document.getElementById('cotItemSel');
            if (!sel || !sel.value) { showToast('Selecciona un ítem del inventario', '#FF9F0A'); return; }
            const i = (_inventario || []).find(x => String(x.id) === String(sel.value));
            if (!i) return;

            let precio = Number(i.precioUnit) || 0;
            if (_cotClienteListaPrecio === 'Plata' && i.precioPlata) precio = Number(i.precioPlata);
            if (_cotClienteListaPrecio === 'Oro' && i.precioOro) precio = Number(i.precioOro);

            _cotItems.push({
                itemId: i.id,
                tipo: i.tipo === 'Servicio' ? 'Servicio' : 'Producto',
                descripcion: i.producto,
                detalle: i.descripcion || '',
                cantidad: 1,
                precioUnit: precio,
                descuentoPct: 0
            });
            sel.value = '';
            cotRenderItems();
        }

        function cotAgregarLibre() {
            _cotItems.push({itemId: '', tipo: 'Servicio', descripcion: '', detalle: '', cantidad: 1, precioUnit: 0, descuentoPct: 0});
            cotRenderItems();
            setTimeout(function () {
                const el = document.getElementById('cotDesc-' + (_cotItems.length - 1));
                if (el) el.focus();
            }, 50);
        }

        function cotEliminarItem(idx) {
            _cotItems.splice(idx, 1);
            cotRenderItems();
        }

        function cotSet(idx, campo, valor) {
            const it = _cotItems[idx];
            if (!it) return;
            if (campo === 'cantidad' || campo === 'precioUnit' || campo === 'descuentoPct') {
                let n = Number(valor);
                if (isNaN(n) || n < 0) n = 0;
                if (campo === 'descuentoPct' && n > 100) n = 100;
                it[campo] = n;
            } else {
                it[campo] = valor;
            }
            const tot = document.getElementById('cotRowTot-' + idx);
            if (tot) tot.textContent = cotQ(cotTotalLinea(it));
            cotRecalcular();
        }

        function cotTotalLinea(it) {
            const bruto = (Number(it.cantidad) || 0) * (Number(it.precioUnit) || 0);
            return cotR2(bruto - bruto * (Number(it.descuentoPct) || 0) / 100);
        }

        function cotRenderItems() {
            const wrap = document.getElementById('cotItemsWrap');
            if (!wrap) return;
            if (!_cotItems.length) {
                wrap.innerHTML = '<div class="cot-item-empty">Aún no has agregado ítems.</div>';
                cotRecalcular();
                return;
            }
            wrap.innerHTML = _cotItems.map((it, idx) => {
                let stockHtml = '';
                if (it.tipo !== 'Servicio' && it.itemId) {
                    const invItem = (_inventario || []).find(x => String(x.id) === String(it.itemId));
                    if (invItem) {
                        const disp = Number(invItem.unidades || 0);
                        if (Number(it.cantidad || 0) > disp) {
                            stockHtml = `<span class="tag tag-danger" style="margin-top:6px;margin-left:4px;display:inline-block;font-size:10.5px">⚠️ Stock insuficiente (Disp: ${disp})</span>`;
                        } else {
                            stockHtml = `<span class="tag tag-success" style="margin-top:6px;margin-left:4px;display:inline-block;font-size:10.5px">Stock: ${disp}</span>`;
                        }
                    }
                }
                return `
        <div class="cot-item-row">
          <div>
            <input class="form-input" id="cotDesc-${idx}" style="height:34px;font-size:13px"
                   value="${escAttr(it.descripcion || '')}" placeholder="Descripción del ítem"
                   oninput="cotSet(${idx},'descripcion',this.value)"/>
            <textarea class="cot-item-detalle" rows="1" placeholder="Detalle opcional"
                      oninput="cotSet(${idx},'detalle',this.value)">${escHtml(it.detalle || '')}</textarea>
            <div style="display:flex;align-items:center;flex-wrap:wrap">
              <span class="tag ${it.tipo === 'Servicio' ? 'tag-servicio' : 'tag-producto'}" style="margin-top:6px;display:inline-block">${it.tipo}</span>
              ${stockHtml}
            </div>
          </div>
          <input class="form-input" type="number" min="0" step="0.01" style="height:34px;font-size:13px"
                 value="${it.cantidad}" oninput="cotSet(${idx},'cantidad',this.value)"/>
          <input class="form-input" type="number" min="0" step="0.01" style="height:34px;font-size:13px"
                 value="${it.precioUnit}" oninput="cotSet(${idx},'precioUnit',this.value)"/>
          <input class="form-input" type="number" min="0" max="100" step="0.01" style="height:34px;font-size:13px"
                 value="${it.descuentoPct}" oninput="cotSet(${idx},'descuentoPct',this.value)"/>
          <div class="cot-item-total" id="cotRowTot-${idx}">${cotQ(cotTotalLinea(it))}</div>
          <button class="cot-item-del" title="Quitar ítem" onclick="cotEliminarItem(${idx})">&times;</button>
        </div>`;
            }).join('');
            cotRecalcular();
        }


        function cotCalcularTotales() {
            const subtotal  = cotR2(_cotItems.reduce((s, it) => s + cotTotalLinea(it), 0));
            let descPct     = Number(v('cotDescuento')) || 0;
            if (descPct < 0) descPct = 0;
            if (descPct > 100) descPct = 100;
            const descuento = cotR2(subtotal * descPct / 100);
            const base      = cotR2(subtotal - descuento);
            const chk       = document.getElementById('cotIVA');
            const aplicaIVA = !!(chk && chk.checked);
            const iva       = aplicaIVA ? cotR2(base * COT_IVA_PCT / 100) : 0;
            return {subtotal, descPct, descuento, iva, aplicaIVA, total: cotR2(base + iva)};
        }

        function cotRecalcular() {
            const t = cotCalcularTotales();
            const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
            set('cotSubtotal', cotQ(t.subtotal));
            set('cotDescMonto', t.descuento > 0 ? '- ' + cotQ(t.descuento) : cotQ(0));
            set('cotIvaMonto', t.aplicaIVA ? cotQ(t.iva) : 'Incluido');
            set('cotTotal', cotQ(t.total));
        }

        /* ── Guardar ───────────────────────────────────────────── */
        function guardarCotizacion() {
            const btn = document.getElementById('cotSaveBtn');
            const cliente = (v('cotCliente') || '').trim();
            if (!cliente) { showToast('El nombre del cliente es requerido', '#FF9F0A'); return; }

            const items = _cotItems
                .map(it => ({
                    itemId: it.itemId || '',
                    tipo: it.tipo === 'Servicio' ? 'Servicio' : 'Producto',
                    descripcion: String(it.descripcion || '').trim(),
                    detalle: String(it.detalle || '').trim(),
                    cantidad: Number(it.cantidad) || 0,
                    precioUnit: Number(it.precioUnit) || 0,
                    descuentoPct: Number(it.descuentoPct) || 0
                }))
                .filter(it => it.descripcion && it.cantidad > 0);

            if (!items.length) { showToast('Agrega al menos un ítem con descripción y cantidad', '#FF9F0A'); return; }

            const t = cotCalcularTotales();
            const data = {
                clienteId:   v('cotClienteSel'),
                cliente:     cliente,
                empresa:     v('cotEmpresa'),
                correo:      v('cotCorreo'),
                telefono:    v('cotTelefono'),
                direccion:   v('cotDireccion'),
                fecha:       v('cotFecha') || cotHoyISO(),
                validezDias: v('cotValidez') || 15,
                condiciones: v('cotCondiciones'),
                notas:       v('cotNotas'),
                descuentoPct: t.descPct,
                aplicaIVA:   t.aplicaIVA,
                estado:      v('cotEstado') || 'Borrador',
                items:       items
            };

            const textoOriginal = btn ? btn.textContent : 'Guardar';
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

            const done = function (r) {
                if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
                if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo guardar', '#FF453A'); return; }
                closeCotBuilder();
                showToast(_cotEditId ? 'Cotización actualizada' : 'Cotización ' + (r.numero || '') + ' creada', '#30D158');
                _cotEditId = null;
                loadCotizaciones();
                loadActividad();
            };
            const fail = function (e) {
                if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
                showToast('Error: ' + e.message, '#FF453A');
            };

            if (_cotEditId) {
                data.id = _cotEditId;
                window.api.withSuccessHandler(done).withFailureHandler(fail).updateCotizacion(data);
            } else {
                window.api.withSuccessHandler(done).withFailureHandler(fail).addCotizacion(data);
            }
        }

        /* ── Estado / eliminar ─────────────────────────────────── */
        function cambiarEstadoCot(id, estado) {
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo cambiar el estado', '#FF453A'); loadCotizaciones(); return; }
                    showToast('Estado actualizado a ' + estado, '#30D158');
                    loadCotizaciones();
                })
                .withFailureHandler(function (e) { showToast('Error: ' + e.message, '#FF453A'); })
                .updateEstadoCotizacion({id: id, estado: estado});
        }

        function confirmDeleteCot(id, numero) {
            _modalMode = {type: 'cotizacion', action: 'delete', id: id};
            openModal('Eliminar cotización', `<div style="text-align:center;padding:10px 0">
    <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none;margin-bottom:12px;display:block;margin-inline:auto"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar ${escHtml(numero)}?</div>
    <div style="font-size:13px;color:var(--text-secondary)">Se eliminará la cotización y todos sus ítems.<br>Esta acción no se puede deshacer.</div>
  </div>`);
            const btn = document.getElementById('modalSaveBtn');
            btn.textContent = 'Eliminar';
            btn.style.background = 'var(--danger)';
        }

        /* ── Documento / PDF ───────────────────────────────────── */
        function verCotizacion(id) {
            const win = window.open('', '_blank');
            if (win) {
                win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Generando…</title></head>' +
                    '<body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;padding:40px;color:#555">' +
                    'Generando la cotización…</body></html>');
            }
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) {
                        if (win) win.close();
                        showToast((r && r.error) || 'No se pudo generar el documento', '#FF453A');
                        return;
                    }
                    if (!win) { showToast('Permite las ventanas emergentes para ver el PDF', '#FF9F0A'); return; }
                    const barra =
                        '<style>@media print{.cot-print-bar{display:none !important}}</style>' +
                        '<div class="cot-print-bar" style="position:fixed;top:14px;right:14px;display:flex;gap:8px;z-index:99">' +
                        '<button onclick="window.print()" style="padding:9px 16px;border:0;border-radius:8px;background:#0A84FF;' +
                        'color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Descargar / Imprimir PDF</button>' +
                        '<button onclick="window.close()" style="padding:9px 16px;border:1px solid #d1d1d6;border-radius:8px;' +
                        'background:#fff;font-size:13px;cursor:pointer;font-family:inherit">Cerrar</button></div>';
                    const html = String(r.html).replace('</body>', barra + '</body>');
                    win.document.open();
                    win.document.write(html);
                    win.document.close();
                })
                .withFailureHandler(function (e) {
                    if (win) win.close();
                    showToast('Error: ' + e.message, '#FF453A');
                })
                .getCotizacionHtml({id: id});
        }

        /* ── Envío por correo ──────────────────────────────────── */
        function enviarCotizacionModal(id) {
            const c = _cotizaciones.find(x => String(x.id) === String(id));
            if (!c) return;
            _modalMode = {type: 'cotEmail', action: 'send', id: id};
            const asunto = 'Cotización ' + c.numero + (_cotEmpresa ? ' · ' + _cotEmpresa.nombre : '');
            const mensaje = 'Estimado(a) ' + (c.cliente || '') + ',\n\n' +
                'Adjuntamos la cotización ' + c.numero + ' por un total de ' + cotQ(c.total) +
                ', válida hasta el ' + c.validaHasta + '.\n\nQuedamos atentos a cualquier consulta.';
            openModal('Enviar ' + c.numero + ' por correo', `
    <div class="form-field"><label class="form-label">PARA *</label>
      <input class="form-input" id="cePara" type="email" value="${escAttr(c.correo || '')}" placeholder="cliente@correo.com"/>
      <div style="font-size:11.5px;color:var(--text-secondary);margin-top:5px">Puedes escribir varios correos separados por coma.</div>
    </div>
    <div class="form-field"><label class="form-label">COPIA (CC)</label>
      <input class="form-input" id="ceCC" type="email" placeholder="Opcional"/></div>
    <div class="form-field"><label class="form-label">ASUNTO</label>
      <input class="form-input" id="ceAsunto" value="${escAttr(asunto)}"/></div>
    <div class="form-field"><label class="form-label">MENSAJE</label>
      <textarea class="form-input" id="ceMensaje" rows="5" style="resize:vertical">${escHtml(mensaje)}</textarea></div>
    <div style="font-size:12px;color:var(--text-secondary);background:var(--accent-bg);padding:10px 12px;border-radius:9px">
      ${window.AZ_EMAILJS && window.AZ_EMAILJS.serviceId
        ? '✅ EmailJS configurado — se enviará al correo indicado.'
        : '⚠️ EmailJS no configurado. Se abrirá la cotización en PDF para que la descargues y envíes manualmente. Para envío automático, configura <code>window.AZ_EMAILJS</code> en el código.'}
    </div>`);
            const btn = document.getElementById('modalSaveBtn');
            btn.textContent = 'Enviar';
        }

        /* ── Guardado desde el modal genérico ──────────────────── */
        function _handleModalSaveCotizaciones(m, saveBtn) {
            function restore(texto, color) {
                if (!saveBtn) return;
                saveBtn.disabled = false;
                saveBtn.textContent = texto || 'Guardar';
                saveBtn.style.background = color || '';
            }

            if (m.type === 'cotizacion' && m.action === 'delete') {
                window.api
                    .withSuccessHandler(function (r) {
                        restore('Eliminar', 'var(--danger)');
                        if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo eliminar', '#FF453A'); return; }
                        closeModal();
                        showToast('Cotización eliminada', '#FF453A');
                        loadCotizaciones();
                    })
                    .withFailureHandler(function (e) { restore('Eliminar', 'var(--danger)'); showToast('Error: ' + e.message, '#FF453A'); })
                    .deleteCotizacion({id: m.id});
                return true;
            }

            if (m.type === 'cotEmail') {
                const para = (v('cePara') || '').trim();
                if (!para) { restore('Enviar'); showToast('Escribe el correo del destinatario', '#FF9F0A'); return true; }
                if (saveBtn) saveBtn.textContent = 'Enviando…';
                window.api
                    .withSuccessHandler(function (r) {
                        restore('Enviar');
                        if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo enviar', '#FF453A'); return; }
                        closeModal();
                        showToast('Cotización enviada correctamente', '#30D158');
                        loadCotizaciones();
                        loadActividad();
                    })
                    .withFailureHandler(function (e) { restore('Enviar'); showToast('Error: ' + e.message, '#FF453A'); })
                    .enviarCotizacion({
                        id: m.id,
                        para: para,
                        cc: v('ceCC'),
                        asunto: v('ceAsunto'),
                        mensaje: v('ceMensaje')
                    });
                return true;
            }

            return false;
        }

