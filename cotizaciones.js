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
            ${((typeof esAdmin === 'function' && esAdmin()) || ['Admin','ADMIN','SUPER_ADMIN'].includes((window._currentUserRole || window._rol || '').toUpperCase())) ? `
            <button class="section-action" onclick="editarCotizacion('${c.id}')">Editar</button>
            <button class="btn-danger-sm" onclick="confirmDeleteCot('${c.id}','${escAttr(c.numero)}')">Eliminar</button>` : ''}
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
            const _esAdminCot = (typeof esAdmin === 'function' && esAdmin()) || ['Admin','ADMIN','SUPER_ADMIN'].includes((window._currentUserRole || window._rol || '').toUpperCase());
            if (!_esAdminCot) {
                showToast('Solo los administradores pueden editar cotizaciones', '#FF9F0A');
                return;
            }
            const btn = document.getElementById('cotSaveBtn');
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo abrir la cotización', '#FF453A'); return; }
                    const c = r.data;
                    _cotEditId = c.id;
                    const cl = (_clientes || []).find(x => String(x.id) === String(c.clienteId));
                    _cotClienteListaPrecio = (cl && cl.lista_precio) ? cl.lista_precio : 'Publico';

                    _cotItems = (r.items || []).map(i => ({
                        itemId: (i.itemId && String(i.itemId).trim() !== '') ? String(i.itemId).trim() : null,
                        tipo: i.tipo || 'Producto',
                        descripcion: i.descripcion || '',
                        detalle: i.detalle || '',
                        cantidad: Number(i.cantidad) || 0,
                        precioUnit: Number(i.precioUnit) || 0,
                        descuentoPct: Number(i.descuentoPct) || 0,
                        total: Number(i.total) || cotTotalLinea(i),
                        unidadMedida: i.unidadMedida || (i.tipo === 'Servicio' ? 'Servicio' : 'Unidad')
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
                descuentoPct: 0,
                unidadMedida: i.unidad || (i.tipo === 'Servicio' ? 'Servicio' : 'Unidad')
            });
            sel.value = '';
            cotRenderItems();
        }

        function cotAgregarLibre() {
            _cotItems.push({itemId: '', tipo: 'Servicio', descripcion: '', detalle: '', cantidad: 1, precioUnit: 0, descuentoPct: 0, unidadMedida: 'Servicio'});
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
                // Si la unidad de medida es 'Unidad', forzar números enteros (no 1.5 de unidad)
                if (campo === 'cantidad') {
                    const um = (it.unidadMedida || '').toLowerCase().trim();
                    if (um === 'unidad') {
                        n = Math.round(n);
                        if (n < 1 && valor !== '' && Number(valor) > 0) n = 1;
                    }
                }
                it[campo] = n;
            } else {
                it[campo] = valor;
                if (campo === 'unidadMedida' && (valor || '').toLowerCase().trim() === 'unidad') {
                    it.cantidad = Math.max(1, Math.round(it.cantidad || 1));
                }
            }
            const tot = document.getElementById('cotRowTot-' + idx);
            if (tot) tot.textContent = cotQ(cotTotalLinea(it));
            cotRecalcular();
        }

        function cotTotalLinea(it) {
            const cant = Number(it.cantidad) || 0;
            const precio = Number(it.precioUnit) || 0;
            const desc = Math.min(Math.max(Number(it.descuentoPct) || 0, 0), 100);
            const base = cant * precio;
            return cotR2(base - (base * desc / 100));
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
                const um = it.unidadMedida || (it.tipo === 'Servicio' ? 'Servicio' : 'Unidad');
                const esUnidad = (um.toLowerCase() === 'unidad');
                const esMilesimas = (um.toLowerCase() === 'milésimas' || um.toLowerCase() === 'milesimas');
                const stepVal = esUnidad ? '1' : (esMilesimas ? '0.001' : '0.01');
                const minVal = esUnidad ? '1' : (esMilesimas ? '0.001' : '0.01');
                const esItemInventario = !!it.itemId;

                return `
        <div class="cot-item-row">
          <div>
            ${esItemInventario ? `
            <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:6px;user-select:none;cursor:not-allowed" title="Ficha de producto bloqueada">
              <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);font-weight:700;margin-bottom:2px;display:flex;align-items:center;gap:4px">
                <svg style="width:11px;height:11px;fill:none;stroke:currentColor;stroke-width:2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Ficha de Producto · Descripción bloqueada
              </div>
              <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${escHtml(it.descripcion || 'Sin descripción')}</div>
            </div>` : `
            <input class="form-input" id="cotDesc-${idx}" value="${escAttr(it.descripcion || '')}"
                   placeholder="Descripción del concepto o servicio manual…"
                   oninput="cotSet(${idx},'descripcion',this.value)"
                   style="height:36px;font-size:13px;margin-bottom:6px" />
            `}
            <textarea class="cot-item-detalle" rows="1" placeholder="Detalle opcional de entrega / especificación"
                      oninput="cotSet(${idx},'detalle',this.value)">${escHtml(it.detalle || '')}</textarea>
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:6px">
              <span class="tag ${it.tipo === 'Servicio' ? 'tag-servicio' : 'tag-producto'}">${it.tipo}</span>
              <select class="form-select mini-select" style="width:auto;height:24px;padding:1px 8px;font-size:11px;font-weight:600;border-radius:6px"
                      onchange="cotSet(${idx},'unidadMedida',this.value); cotRenderItems();" title="Unidad de medida">
                <option value="Unidad" ${um.toLowerCase()==='unidad'?'selected':''}>Unidad</option>
                <option value="Kit" ${um.toLowerCase()==='kit'?'selected':''}>Kit</option>
                <option value="Milésimas" ${esMilesimas?'selected':''}>Milésimas</option>
                ${!['unidad','kit','milésimas','milesimas'].includes(um.toLowerCase()) ? `<option value="${escAttr(um)}" selected>${escHtml(um)}</option>` : ''}
              </select>
              ${stockHtml}
            </div>
          </div>
          <input class="form-input" type="number" min="${minVal}" step="${stepVal}" style="height:34px;font-size:13px"
                 value="${it.cantidad}" oninput="cotSet(${idx},'cantidad',this.value)" title="Cantidad (Unidad: ${escAttr(um)})"/>
          <input class="form-input" type="number" min="0" step="0.01"
                 style="height:34px;font-size:13px;font-weight:600;${esItemInventario ? 'background:var(--bg-secondary);cursor:not-allowed;' : ''}"
                 value="${it.precioUnit}" ${esItemInventario ? 'readonly tabindex="-1" title="El precio unitario del inventario no es editable"' : `oninput="cotSet(${idx},'precioUnit',this.value)" title="Precio unitario"`}/>
          <input class="form-input" type="number" min="0" max="100" step="1"
                 style="height:34px;font-size:13px;font-weight:600;text-align:right"
                 value="${it.descuentoPct || 0}" oninput="cotSet(${idx},'descuentoPct',this.value)" placeholder="0%" title="Descuento %"/>
          <div class="cot-item-total" id="cotRowTot-${idx}">${cotQ(cotTotalLinea(it))}</div>
          <button class="cot-item-del" title="Quitar ítem" onclick="cotEliminarItem(${idx})">&times;</button>
        </div>`;
            }).join('');
            cotRecalcular();
        }

        function _cotEmpresaIvaConfig() {
            const emp = _cotEmpresa || (window.EMPRESA || {});
            let localExtra = {};
            try { localExtra = JSON.parse(localStorage.getItem('azyvion_org_extra') || '{}'); } catch(e){}
            const pct = emp.iva_pct !== undefined ? Number(emp.iva_pct) : (localExtra.iva_pct !== undefined ? Number(localExtra.iva_pct) : 12);
            const mod = emp.iva_modalidad || localExtra.iva_modalidad || 'incluido';
            return { pct: isNaN(pct) ? 12 : pct, mod: mod };
        }

        function cotCalcularTotales() {
            const bruto = cotR2(_cotItems.reduce((s, it) => s + cotTotalLinea(it), 0));
            const chk = document.getElementById('cotIVA');
            const aplicaIVA = !!(chk && chk.checked);
            const cfg = _cotEmpresaIvaConfig();

            let subtotal = bruto;
            let iva = 0;
            let total = bruto;

            if (!aplicaIVA || cfg.mod === 'exento' || cfg.pct === 0) {
                subtotal = bruto;
                iva = 0;
                total = bruto;
            } else if (cfg.mod === 'sobre') {
                // Precios son sin IVA, se suma sobre el subtotal
                subtotal = bruto;
                iva = cotR2(subtotal * (cfg.pct / 100));
                total = cotR2(subtotal + iva);
            } else {
                // 'incluido': Precios ya tienen IVA incluido, se desglosa
                total = bruto;
                subtotal = cotR2(total / (1 + (cfg.pct / 100)));
                iva = cotR2(total - subtotal);
            }

            return {
                subtotal,
                iva,
                aplicaIVA,
                ivaPct: cfg.pct,
                ivaMod: cfg.mod,
                total
            };
        }

        function cotRecalcular() {
            const t = cotCalcularTotales();
            const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
            set('cotSubtotal', cotQ(t.subtotal));
            const lbl = document.getElementById('cotIvaLabel');
            if (lbl) lbl.textContent = t.ivaPct + '% (' + (t.ivaMod === 'sobre' ? 'sobre subtotal' : 'incluido') + ')';
            set('cotIvaMonto', t.aplicaIVA ? cotQ(t.iva) : 'Q 0.00 (Exento)');
            set('cotTotal', cotQ(t.total));

            const descRow = document.getElementById('cotDescRowWrap');
            if (descRow) descRow.style.display = 'none';

            const info = document.getElementById('cotIvaInfo');
            if (info) {
                info.innerHTML = t.ivaMod === 'sobre'
                    ? `Configuración de empresa: <strong>+${t.ivaPct}% de IVA sobre el subtotal</strong>.`
                    : t.ivaMod === 'exento'
                    ? `Configuración de empresa: <strong>Exento de IVA (0%)</strong>.`
                    : `Configuración de empresa: <strong>IVA del ${t.ivaPct}% ya incluido en los precios</strong> (desglosado en el total).`;
            }
        }

        /* ── Vista previa de la verdadera cotización ───────────── */
        function cotAbrirVistaPrevia() {
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
                    unidadMedida: it.unidadMedida || (it.tipo === 'Servicio' ? 'Servicio' : 'Unidad')
                }))
                .filter(it => it.descripcion && it.cantidad > 0);

            if (!items.length) { showToast('Agrega al menos un ítem con cantidad válida', '#FF9F0A'); return; }

            const t = cotCalcularTotales();
            const emp = _cotEmpresa || (window.EMPRESA || {});
            const mon = 'Q';
            const _fQ = n => mon + ' ' + Number(n || 0).toLocaleString('es-GT', {minimumFractionDigits: 2, maximumFractionDigits: 2});
            const M = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
            const _fF = val => { const d = new Date(val); return isNaN(d.getTime()) ? val : d.getDate() + ' de ' + M[d.getMonth()] + ' de ' + d.getFullYear(); };
            const fechaCot = v('cotFecha') || cotHoyISO();
            const validezDias = Number(v('cotValidez')) || 15;
            const vd = new Date(fechaCot); vd.setDate(vd.getDate() + validezDias);

            const logoHtml = emp.logoUrl
                ? '<img src="' + escAttr(emp.logoUrl) + '" alt="' + escAttr(emp.nombre) + '" style="max-height:64px;max-width:200px;object-fit:contain;background:#fff;border-radius:6px;padding:4px 8px">'
                : '<div style="font-size:22px;font-weight:700;color:#fff;letter-spacing:-.5px">' + escHtml(emp.nombre || 'Azyvion CRM') + '</div>';

            const filas = items.map((it, idx) => {
                const totalLinea = cotR2(it.cantidad * it.precioUnit);
                return '<tr style="border-bottom:1px solid #f0f0f0">' +
                    '<td style="padding:10px 8px;text-align:center;color:#888;font-size:13px">' + (idx + 1) + '</td>' +
                    '<td style="padding:10px 8px"><strong style="color:#111">' + escHtml(it.descripcion) + '</strong>' +
                    (it.detalle ? '<br><small style="color:#888">' + escHtml(it.detalle) + '</small>' : '') + '</td>' +
                    '<td style="padding:10px 8px;text-align:center">' + it.cantidad + ' <small style="color:#888">' + escHtml(it.unidadMedida) + '</small></td>' +
                    '<td style="padding:10px 8px;text-align:right">' + _fQ(it.precioUnit) + '</td>' +
                    '<td style="padding:10px 8px;text-align:right;font-weight:700;color:#0A2540">' + _fQ(totalLinea) + '</td>' +
                    '</tr>';
            }).join('');

            const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vista Previa · Cotización</title>
<style>
@page { size: letter portrait; margin: 12mm 14mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; max-width: 820px; margin: 0 auto; padding: 24px; color: #2D3748; background: #fff; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print { body { padding: 0 !important; max-width: 100% !important; } .cot-print-bar { display: none !important; } }
table.items-table { width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 18px; border-radius: 8px; overflow: hidden; border: 1px solid #E2E8F0; }
table.items-table th { background: #0A2540; color: #fff; padding: 10px 12px; font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
table.items-table td { padding: 10px 12px; font-size: 12.5px; border-bottom: 1px solid #EDF2F7; vertical-align: top; }
table.items-table tr:last-child td { border-bottom: none; }
table.items-table tr:nth-child(even) td { background-color: #F8FAFC; }
.cot-print-bar { position:fixed; top:14px; right:14px; display:flex; gap:8px; z-index:99; background:rgba(0,0,0,0.85); padding:6px 10px; border-radius:10px; }
.cot-print-bar button { padding:8px 14px; border:0; border-radius:7px; font-size:12.5px; font-weight:600; cursor:pointer; font-family:inherit; }
</style>
</head><body>
<div class="cot-print-bar">
  <button onclick="window.print()" style="background:#0A84FF;color:#fff">Imprimir / Guardar PDF</button>
  <button onclick="window.close()" style="background:#fff;color:#111">Cerrar</button>
</div>
<div style="background: linear-gradient(135deg, #0A2540 0%, #1A446C 100%); color: #fff; padding: 26px 30px; border-radius: 12px; display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; box-shadow: 0 4px 12px rgba(10,37,64,0.12)">
  <div>
    ${logoHtml}
    <div style="font-size:11px;margin-top:8px;opacity:.85;line-height:1.6">
      ${emp.nit && emp.nit !== 'C/F' ? 'NIT: ' + escHtml(emp.nit) + '<br>' : ''}
      ${emp.telefono ? 'Tel: ' + escHtml(emp.telefono) + '<br>' : ''}
      ${emp.correo ? escHtml(emp.correo) : ''}
    </div>
  </div>
  <div style="text-align: right; flex-shrink: 0">
    <div style="font-size: 10.5px; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.8; margin-bottom: 2px">Documento Comercial</div>
    <h1 style="margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px">COTIZACIÓN</h1>
    <div style="font-size: 14px; font-weight: 700; background: rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 6px; margin-top: 6px; display: inline-block">VISTA PREVIA</div>
    <div style="font-size: 12px; margin-top: 10px; opacity: 0.9; line-height: 1.6">
      <strong>Fecha:</strong> ${_fF(fechaCot)}<br>
      <strong>Válida hasta:</strong> ${_fF(vd)} (${validezDias} días)<br>
      <span style="display:inline-block;margin-top:4px;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:rgba(255,255,255,0.2);color:#fff">${escHtml(v('cotEstado') || 'Borrador')}</span>
    </div>
  </div>
</div>

<div style="margin:20px 0 0;padding:16px 20px;background:#f7f9fc;border-left:4px solid #0A2540;border-radius:0 6px 6px 0">
  <div style="font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#666;margin-bottom:6px">COTIZACIÓN PARA</div>
  <div style="font-weight:700;font-size:15px;color:#0A2540">${escHtml(cliente)}</div>
  ${v('cotEmpresa') ? `<div style="color:#444;font-size:13px">${escHtml(v('cotEmpresa'))}</div>` : ''}
  ${v('cotDireccion') ? `<div style="color:#666;font-size:12px">${escHtml(v('cotDireccion'))}</div>` : ''}
  ${(v('cotTelefono') || v('cotCorreo')) ? `<div style="color:#666;font-size:12px">${escHtml(v('cotTelefono') || '')}${(v('cotTelefono') && v('cotCorreo')) ? ' · ' : ''}${escHtml(v('cotCorreo') || '')}</div>` : ''}
</div>

<table class="items-table">
  <thead>
    <tr>
      <th style="width: 38px; text-align: center">#</th>
      <th style="text-align: left">Descripción del Producto / Servicio</th>
      <th style="width: 90px; text-align: center">Cant.</th>
      <th style="width: 105px; text-align: right">Precio Unit.</th>
      <th style="width: 110px; text-align: right">Total</th>
    </tr>
  </thead>
  <tbody>${filas}</tbody>
</table>

<div style="display: flex; justify-content: flex-end; padding: 14px 0 16px">
  <table style="width: 320px; border-collapse: collapse; font-size: 13px">
    <tr><td style="padding: 6px 10px; color: #718096">Subtotal</td><td style="padding: 6px 10px; text-align: right; font-weight: 500">${_fQ(t.subtotal)}</td></tr>
    <tr><td style="padding: 6px 10px; color: #718096">IVA (${t.ivaPct}% ${t.ivaMod === 'sobre' ? 'sobre subtotal' : 'incluido'})</td><td style="padding: 6px 10px; text-align: right; font-weight: 500">${_fQ(t.iva)}</td></tr>
    <tr style="border-top: 2px solid #0A2540"><td style="padding: 10px; font-size: 16px; font-weight: 800; color: #0A2540">TOTAL</td><td style="padding: 10px; text-align: right; font-size: 17px; font-weight: 800; color: #0A2540">${_fQ(t.total)}</td></tr>
  </table>
</div>

${v('cotCondiciones') ? `
<div style="margin-top:20px;padding:14px 18px;background:#f7f9fc;border-radius:8px;border:1px solid #E2E8F0">
  <strong style="font-size:12px;text-transform:uppercase;color:#0A2540;letter-spacing:0.5px">Términos y Condiciones:</strong>
  <div style="font-size:12.5px;color:#4A5568;margin-top:6px;white-space:pre-wrap;line-height:1.6">${escHtml(v('cotCondiciones'))}</div>
</div>` : ''}

${v('cotNotas') ? `
<div style="margin-top:12px;padding:12px 18px;background:#fff8ee;border-radius:8px;border:1px solid #fed7aa;font-size:12px;color:#9a3412">
  <strong>Notas:</strong> ${escHtml(v('cotNotas'))}
</div>` : ''}

</body></html>`;

            const win = window.open('', '_blank');
            if (win) {
                win.document.open();
                win.document.write(html);
                win.document.close();
            } else {
                showToast('Permite las ventanas emergentes en tu navegador para ver la cotización.', '#FF9F0A');
            }
        }

        /* ── Guardar directamente y cerrar ─────────────────────── */
        function guardarCotizacion(forzarDirecto) {
            const cliente = (v('cotCliente') || '').trim();
            if (!cliente) { showToast('El nombre del cliente es requerido', '#FF9F0A'); return; }

            // Sincronizar todos los ítems asegurando descripción, cantidad, precio, descuento y total
            const items = _cotItems
                .map((it, idx) => {
                    const descEl = document.getElementById('cotDesc-' + idx);
                    const descVal = descEl ? descEl.value.trim() : String(it.descripcion || '').trim();
                    const cant = Number(it.cantidad) || 0;
                    const precio = Number(it.precioUnit) || 0;
                    const descPct = Math.min(Math.max(Number(it.descuentoPct) || 0, 0), 100);
                    const totLinea = cotR2((cant * precio) * (1 - descPct / 100));
                    return {
                        itemId: (it.itemId && String(it.itemId).trim() !== '') ? String(it.itemId).trim() : null,
                        tipo: it.tipo === 'Servicio' ? 'Servicio' : 'Producto',
                        descripcion: descVal,
                        detalle: String(it.detalle || '').trim(),
                        cantidad: cant,
                        precioUnit: precio,
                        descuentoPct: descPct,
                        total: totLinea,
                        unidadMedida: it.unidadMedida || (it.tipo === 'Servicio' ? 'Servicio' : 'Unidad')
                    };
                })
                .filter(it => it.descripcion && it.cantidad > 0);

            if (!items.length) { showToast('Agrega al menos un ítem con descripción y cantidad', '#FF9F0A'); return; }

            const btn = document.getElementById('cotSaveBtn');
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
                descuentoPct: 0,
                aplicaIVA:   t.aplicaIVA,
                estado:      v('cotEstado') || 'Borrador',
                items:       items
            };

            const textoOriginal = btn ? btn.textContent : 'Guardar';
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

            const done = function (r) {
                if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
                if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo guardar la cotización', '#FF453A'); return; }
                
                // 1. Cerrar formulario
                closeCotBuilder();
                showToast(_cotEditId ? 'Cotización actualizada ✓' : 'Cotización ' + (r.numero || '') + ' creada ✓', '#30D158');
                
                const savedId = r.id || _cotEditId;
                _cotEditId = null;
                loadCotizaciones();
                loadActividad();

                // 2. Mostrar la vista previa con el detalle completo
                if (savedId && typeof verCotizacion === 'function') {
                    verCotizacion(savedId);
                }
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
            const _esAdminCot = (typeof esAdmin === 'function' && esAdmin()) || ['Admin','ADMIN','SUPER_ADMIN'].includes((window._currentUserRole || window._rol || '').toUpperCase());
            if (!_esAdminCot) {
                showToast('Solo los administradores pueden eliminar cotizaciones', '#FF9F0A');
                return;
            }
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
        function _mostrarCotizacionModalPreview(html) {
            let modal = document.getElementById('cotPreviewModal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'cotPreviewModal';
                modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:999999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;';
                modal.innerHTML = `
                    <div style="background:var(--card-bg, #fff);width:100%;max-width:900px;height:90vh;max-height:850px;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,0.4);border:1px solid var(--border-color, #e5e5ea);">
                        <div style="padding:12px 18px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color,#e5e5ea);background:var(--bg-secondary,#f9f9fb);">
                            <span style="font-weight:700;font-size:15px;color:var(--text-primary,#1c1c1e)">Vista Previa de Cotización</span>
                            <div style="display:flex;gap:8px;">
                                <button type="button" id="cotModalPrintBtn" style="padding:7px 14px;border-radius:8px;background:var(--primary,#0A84FF);color:#fff;border:0;font-weight:600;font-size:13px;cursor:pointer;">Imprimir / Guardar PDF</button>
                                <button type="button" onclick="document.getElementById('cotPreviewModal').style.display='none'" style="padding:7px 14px;border-radius:8px;background:transparent;border:1px solid var(--border-color,#ccc);font-size:13px;cursor:pointer;">Cerrar</button>
                            </div>
                        </div>
                        <iframe id="cotModalIframe" style="flex:1;border:0;width:100%;background:#fff;" title="Cotizacion PDF Preview"></iframe>
                    </div>
                `;
                document.body.appendChild(modal);
            }
            modal.style.display = 'flex';
            const ifr = document.getElementById('cotModalIframe');
            if (ifr) {
                ifr.srcdoc = html;
                const pBtn = document.getElementById('cotModalPrintBtn');
                if (pBtn) {
                    pBtn.onclick = function() {
                        if (ifr.contentWindow) {
                            ifr.contentWindow.focus();
                            ifr.contentWindow.print();
                        }
                    };
                }
            }
        }

        function verCotizacion(id) {
            let win = null;
            try {
                win = window.open('', '_blank');
                if (win) {
                    win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Generando…</title></head>' +
                        '<body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;padding:40px;color:#555">' +
                        'Generando la cotización…</body></html>');
                }
            } catch (e) {
                console.warn('[Cotizaciones] Popup bloqueado o no soportado:', e);
            }

            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) {
                        if (win && !win.closed) win.close();
                        showToast((r && r.error) || 'No se pudo generar el documento', '#FF453A');
                        return;
                    }
                    const barra =
                        '<style>@media print{.cot-print-bar{display:none !important}}</style>' +
                        '<div class="cot-print-bar" style="position:fixed;top:14px;right:14px;display:flex;gap:8px;z-index:99">' +
                        '<button onclick="window.print()" style="padding:9px 16px;border:0;border-radius:8px;background:#0A84FF;' +
                        'color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">Descargar / Imprimir PDF</button>' +
                        '<button onclick="window.close()" style="padding:9px 16px;border:1px solid #d1d1d6;border-radius:8px;' +
                        'background:#fff;font-size:13px;cursor:pointer;font-family:inherit">Cerrar</button></div>';
                    const html = String(r.html).replace('</body>', barra + '</body>');

                    if (win && !win.closed) {
                        try {
                            win.document.open();
                            win.document.write(html);
                            win.document.close();
                            return;
                        } catch (e) {
                            console.warn('[Cotizaciones] Error cargando html en popup, usando modal fallback:', e);
                        }
                    }

                    _mostrarCotizacionModalPreview(html);
                })
                .withFailureHandler(function (e) {
                    if (win && !win.closed) win.close();
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

