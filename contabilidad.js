/* ═══════════════════════════════════════════════════════
   contabilidad.js — Módulo Contabilidad
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

/* Dependencias globales:
   _modalMode, openModal, closeModal, showToast, escHtml, escAttr,
   v, valOf, descargarCSV, fechaCorta, _onApiError, esAdmin,
   _rol, _currentOrgId, window.api
*/

        /* ══════════════════════════════════════════════════
           MÓDULO CONTABILIDAD — JavaScript
        ══════════════════════════════════════════════════ */
        /* ═══════════════════════════════════════════════════════════
           ESTADO CONTABILIDAD
        ═══════════════════════════════════════════════════════════ */
        let _cuentasBancarias  = [];
        let _planCuentas       = [];
        let _transacciones     = [];
        let _libroDiario       = [];
        let _estadoResultados  = null;
        let _filtroTrxActual   = 'Todos';
        let _filtroPlanActual  = 'Todos';
        let _drawerCuentaId    = null;
        let _contTabActual     = 'cuentas';
        
        /* ── Mostrar módulo solo a Admin y Gerente ── */
        function _initContabilidad() {
            const esContAccess = (_rol === 'Admin' || _rol === 'Gerente');
            const navSec  = document.getElementById('nav-section-contabilidad');
            const navItem = document.getElementById('nav-contabilidad');
            if (navSec)  navSec.style.display  = esContAccess ? '' : 'none';
            if (navItem) navItem.style.display = esContAccess ? 'flex' : 'none';
            if (esContAccess) {
                loadResumenContable();
                loadCuentasBancarias();
                loadPlanCuentas();
                loadTransacciones();
            }
        }
        
        /* ── Tabs ── */
        function switchContTab(tab, el) {
            _contTabActual = tab;
            document.querySelectorAll('.cont-tab').forEach(t => t.classList.remove('active'));
            if (el) el.classList.add('active');
            document.querySelectorAll('.cont-panel').forEach(p => p.classList.remove('active'));
            const panel = document.getElementById('contPanel-' + tab);
            if (panel) panel.classList.add('active');
            if (tab === 'diario') loadLibroDiario();
            if (tab === 'pnl') loadEstadoResultados();
        }
        
        /* ═══════════════════════════════════════════════════════════
           CARGA DE DATOS
        ═══════════════════════════════════════════════════════════ */
        function loadResumenContable() {
            window.api
                .withSuccessHandler(function(r) {
                    if (!r.ok) return;
                    const fQ = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});
                    document.getElementById('cont-saldo').textContent    = fQ(r.saldoTotal);
                    document.getElementById('cont-saldo-d').innerHTML    = `<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg> ${r.cuentasActivas} de ${r.totalCuentas} activas`;
                    document.getElementById('cont-ing-mes').textContent  = fQ(r.ingresosMes);
                    document.getElementById('cont-egr-mes').textContent  = fQ(r.egresosMes);
                    document.getElementById('cont-util-mes').textContent = fQ(r.utilidadMes);
                    const utilEl = document.getElementById('cont-util-d');
                    if (r.utilidadMes >= 0) {
                        utilEl.className = 'kpi-delta up';
                        utilEl.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg> Superávit';
                    } else {
                        utilEl.className = 'kpi-delta down';
                        utilEl.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg> Déficit';
                    }
                })
                .withFailureHandler(function(e){ _onApiError('resumen contable', e); })
                .getResumenContable();
        }
        
        function loadCuentasBancarias() {
            window.api
                .withSuccessHandler(function(r) {
                    if (!r.ok) { showToast('Error cuentas bancarias: ' + (r.error||''), '#FF453A'); return; }
                    _cuentasBancarias = r.data || [];
                    renderBankGrid();
                    actualizarSelectCuentas();
                })
                .withFailureHandler(function(e){ _onApiError('cuentas bancarias', e); })
                .getCuentasBancarias();
        }
        
        function loadPlanCuentas() {
            window.api
                .withSuccessHandler(function(r) {
                    if (!r.ok) return;
                    _planCuentas = r.data || [];
                    renderPlanCuentas(_filtroPlanActual);
                    actualizarSelectPlan();
                })
                .withFailureHandler(function(e){ _onApiError('plan de cuentas', e); })
                .getPlanCuentas();
        }
        
        function loadTransacciones() {
            window.api
                .withSuccessHandler(function(r) {
                    if (!r.ok) return;
                    _transacciones = r.data || [];
                    renderTransacciones(_filtroTrxActual);
                })
                .withFailureHandler(function(e){ _onApiError('transacciones', e); })
                .getTransacciones({});
        }

        /* ─── LIBRO DIARIO ─── */
        function loadLibroDiario() {
            const tbody = document.getElementById('diarioTbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Cargando libro diario…</td></tr>';
            const d = {
                desde: (document.getElementById('diarioDesde') || {}).value || '',
                hasta: (document.getElementById('diarioHasta') || {}).value || ''
            };
            window.api
                .withSuccessHandler(function(r) {
                    if (!r || !r.ok) {
                        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell" style="color:var(--danger)">${escHtml(r && r.error || 'Error al cargar')}</td></tr>`;
                        return;
                    }
                    _libroDiario = r.data || [];
                    renderLibroDiario();
                })
                .withFailureHandler(function(e) {
                    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell" style="color:var(--danger)">Error: ${escHtml(e.message)}</td></tr>`;
                })
                .getLibroDiario(d);
        }

        function renderLibroDiario() {
            const tbody = document.getElementById('diarioTbody');
            if (!tbody) return;
            const fQ = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});
            if (!_libroDiario.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No hay partidas registradas en el período seleccionado.</td></tr>';
                const elD = document.getElementById('diarioTotalDebe');
                const elH = document.getElementById('diarioTotalHaber');
                if (elD) elD.textContent = 'Q 0.00';
                if (elH) elH.textContent = 'Q 0.00';
                return;
            }
            let totDebe = 0, totHaber = 0;
            const html = _libroDiario.map(p => {
                totDebe += Number(p.debeMonto || 0);
                totHaber += Number(p.haberMonto || 0);
                return `<tr>
                    <td style="font-weight:600">#${escHtml(p.partidaNo)}</td>
                    <td class="cell-sub">${fechaCorta(p.fecha)}</td>
                    <td>
                        <div style="font-weight:500">${escHtml(p.concepto)}</div>
                        <div class="cell-sub" style="font-size:11px">${escHtml(p.categoria || '')}</div>
                    </td>
                    <td><span class="tag" style="background:rgba(10,132,255,.1);color:#0A84FF;font-weight:500">${escHtml(p.debe)}</span></td>
                    <td class="cell-num" style="font-weight:600">${fQ(p.debeMonto)}</td>
                    <td><span class="tag" style="background:rgba(48,209,88,.1);color:#30D158;font-weight:500">${escHtml(p.haber)}</span></td>
                    <td class="cell-num" style="font-weight:600">${fQ(p.haberMonto)}</td>
                </tr>`;
            }).join('');
            tbody.innerHTML = html;

            const elDebe = document.getElementById('diarioTotalDebe');
            const elHaber = document.getElementById('diarioTotalHaber');
            if (elDebe) elDebe.textContent = fQ(totDebe);
            if (elHaber) elHaber.textContent = fQ(totHaber);

            const badge = document.getElementById('diarioBalanceBadge');
            if (badge) {
                const diff = Math.abs(totDebe - totHaber);
                if (diff < 0.01) {
                    badge.style.background = 'rgba(48,209,88,.15)';
                    badge.style.color = '#30D158';
                    badge.textContent = 'Sumas Iguales Cuadradas ✓';
                } else {
                    badge.style.background = 'rgba(255,69,58,.15)';
                    badge.style.color = '#FF453A';
                    badge.textContent = 'Descuadre: ' + fQ(diff);
                }
            }
        }

        function exportarLibroDiario() {
            if (!_libroDiario || !_libroDiario.length) {
                showToast('No hay datos en el libro diario para exportar', '#FF9F0A');
                return;
            }
            const headers = ['Partida', 'Fecha', 'Concepto', 'Categoria', 'Cuenta Debe', 'Monto Debe', 'Cuenta Haber', 'Monto Haber'];
            const rows = _libroDiario.map(p => [
                p.partidaNo,
                p.fecha,
                `"${String(p.concepto || '').replace(/"/g, '""')}"`,
                `"${String(p.categoria || '').replace(/"/g, '""')}"`,
                `"${String(p.debe || '').replace(/"/g, '""')}"`,
                p.debeMonto,
                `"${String(p.haber || '').replace(/"/g, '""')}"`,
                p.haberMonto
            ]);
            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            descargarCSV(csv, 'libro-diario-' + (new Date().toISOString().slice(0, 10)) + '.csv');
        }

        /* ─── ESTADO DE RESULTADOS (P&L) ─── */
        function loadEstadoResultados() {
            const tbody = document.getElementById('pnlTbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Calculando estado de resultados…</td></tr>';
            const d = {
                desde: (document.getElementById('pnlDesde') || {}).value || '',
                hasta: (document.getElementById('pnlHasta') || {}).value || ''
            };
            window.api
                .withSuccessHandler(function(r) {
                    if (!r || !r.ok) {
                        if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty-cell" style="color:var(--danger)">${escHtml(r && r.error || 'Error al calcular')}</td></tr>`;
                        return;
                    }
                    _estadoResultados = r;
                    renderEstadoResultados();
                })
                .withFailureHandler(function(e) {
                    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="empty-cell" style="color:var(--danger)">Error: ${escHtml(e.message)}</td></tr>`;
                })
                .getEstadoResultados(d);
        }

        function renderEstadoResultados() {
            if (!_estadoResultados) return;
            const r = _estadoResultados;
            const fQ = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});

            const ingEl = document.getElementById('pnl-ingresos');
            const egrEl = document.getElementById('pnl-egresos');
            const utilEl = document.getElementById('pnl-utilidad');
            const utilDelta = document.getElementById('pnl-utilidad-delta');
            const marEl = document.getElementById('pnl-margen');

            if (ingEl) ingEl.textContent = fQ(r.ingresos);
            if (egrEl) egrEl.textContent = fQ(r.egresos);
            if (utilEl) utilEl.textContent = fQ(r.utilidadNeta);
            if (marEl) marEl.textContent = (r.margenPct || 0) + '%';

            if (utilDelta) {
                if (r.utilidadNeta >= 0) {
                    utilDelta.className = 'kpi-delta up';
                    utilDelta.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg> Superávit Neto';
                } else {
                    utilDelta.className = 'kpi-delta down';
                    utilDelta.innerHTML = '<svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg> Pérdida / Déficit';
                }
            }

            const tbody = document.getElementById('pnlTbody');
            if (!tbody) return;
            const cats = Object.entries(r.porCategoria || {});
            if (!cats.length) {
                tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No se registraron transacciones para el período seleccionado.</td></tr>';
                return;
            }

            const maxAbs = Math.max(...cats.map(([, m]) => Math.abs(m)), 1);

            const html = cats.map(([cat, monto]) => {
                const esIngreso = monto >= 0;
                const pct = Math.min(100, Math.round((Math.abs(monto) / maxAbs) * 100));
                const colorBar = esIngreso ? '#30D158' : '#FF453A';
                return `<tr>
                    <td style="font-weight:600">${escHtml(cat)}</td>
                    <td>
                        <span class="tag" style="background:${esIngreso ? 'rgba(48,209,88,.15)' : 'rgba(255,69,58,.15)'};color:${colorBar}">
                            ${esIngreso ? 'Ingreso Operativo' : 'Costo / Gasto'}
                        </span>
                    </td>
                    <td class="cell-num" style="font-weight:600;color:${colorBar}">${fQ(monto)}</td>
                    <td>
                        <div style="display:flex;align-items:center;gap:8px">
                            <div style="flex:1;background:var(--border);height:6px;border-radius:3px;overflow:hidden">
                                <div style="background:${colorBar};height:100%;width:${pct}%;border-radius:3px"></div>
                            </div>
                            <span class="cell-sub" style="font-size:11px;width:35px;text-align:right">${pct}%</span>
                        </div>
                    </td>
                </tr>`;
            }).join('');

            tbody.innerHTML = html;
        }

        function exportarEstadoResultados() {
            if (!_estadoResultados || !_estadoResultados.porCategoria) {
                showToast('No hay datos en el Estado de Resultados para exportar', '#FF9F0A');
                return;
            }
            const r = _estadoResultados;
            const lines = [
                'ESTADO DE RESULTADOS (P&L)',
                'Fecha de Generación,' + new Date().toISOString(),
                'Total Ingresos,' + r.ingresos,
                'Total Egresos,' + r.egresos,
                'Utilidad Neta,' + r.utilidadNeta,
                'Margen Neto %,' + r.margenPct + '%',
                '',
                'Categoria,Naturaleza,Monto'
            ];
            Object.entries(r.porCategoria).forEach(([c, m]) => {
                lines.push(`"${c.replace(/"/g, '""')}",${m >= 0 ? 'Ingreso' : 'Egreso'},${m}`);
            });
            descargarCSV(lines.join('\n'), 'estado-resultados-' + (new Date().toISOString().slice(0, 10)) + '.csv');
        }
        
        /* ═══════════════════════════════════════════════════════════
           RENDER — CUENTAS BANCARIAS
        ═══════════════════════════════════════════════════════════ */
        const LOGO_INITIALS = {Industrial:'BI', Banrural:'BR', BAC:'BAC', Promerica:'PRO', Azteca:'AZ'};
        
        function renderBankGrid() {
            const grid = document.getElementById('bankGrid');
            if (!grid) return;
        
            let html = _cuentasBancarias.map(c => {
                const saldo  = Number(c.saldo || 0);
                const activa = c.activa === true || c.activa === 'true';
                const saldoCls = saldo >= 0 ? 'positivo' : 'negativo';
                const fQ = n => 'Q ' + Number(n).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});
                return `
                <div class="bank-card" onclick="openBankDrawer('${c.id}')">
                    <div class="bank-card-top">
                        <div class="bank-logo-wrap bank-logo-${escHtml(c.logo)}" title="${escHtml(c.banco)}">
                            <img src="logo-banco-${escHtml(c.logo).toLowerCase()}.png" alt="${escHtml(c.banco)}"
                                 style="width:100%;height:100%;object-fit:contain;border-radius:inherit;display:block;"
                                 onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                            <span class="bank-logo-text" style="display:none;">${LOGO_INITIALS[c.logo] || c.logo.substring(0,2)}</span>
                        </div>
                        <span class="bank-card-badge${activa?'':' inactiva'}">${activa?'Activa':'Inactiva'}</span>
                    </div>
                    <div class="bank-card-name">${escHtml(c.nombre)}</div>
                    <div class="bank-card-bank">${escHtml(c.banco)}</div>
                    <div class="bank-card-num">•••• ${String(c.numeroCuenta).slice(-4)}</div>
                    <div class="bank-card-saldo-label">Saldo disponible</div>
                    <div class="bank-card-saldo ${saldoCls}">${fQ(saldo)}</div>
                    <div class="bank-card-cta">
                        <button class="section-action" onclick="event.stopPropagation();openBankDrawer('${c.id}')">Ver detalle</button>
                        <button class="section-action" onclick="event.stopPropagation();editCuentaBancaria('${c.id}')">Editar</button>
                    </div>
                </div>`;
            }).join('');
        
            // Botón agregar nueva cuenta
            html += `<button class="bank-add-card" onclick="openNuevaCuentaBancaria()">
                <svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/></svg>
                Agregar cuenta bancaria
            </button>`;
        
            grid.innerHTML = html;
        }
        
        /* ═══════════════════════════════════════════════════════════
           DRAWER — Detalle de cuenta bancaria
        ═══════════════════════════════════════════════════════════ */
        function openBankDrawer(cuentaId) {
            const c = _cuentasBancarias.find(x => String(x.id) === String(cuentaId));
            if (!c) return;
            _drawerCuentaId = cuentaId;
        
            const fQ = n => 'Q ' + Number(n||0).toLocaleString('es-GT', {minimumFractionDigits:2, maximumFractionDigits:2});
            const saldo = Number(c.saldo || 0);
        
            document.getElementById('drawerBankName').textContent = c.nombre;
            document.getElementById('drawerBankInfo').textContent =
                c.banco + ' • ' + c.aNombreDe + ' • ' + String(c.numeroCuenta);
            document.getElementById('drawerSaldo').textContent = fQ(saldo);
            document.getElementById('drawerSaldo').style.color = saldo >= 0 ? 'var(--success)' : 'var(--danger)';
        
            // Cuenta contable asociada
            const cc = _planCuentas.find(p => String(p.id) === String(c.cuentaContable));
            document.getElementById('drawerCuentaContable').textContent =
                cc ? cc.codigo + ' — ' + cc.nombre : (c.rubro || '');
        
            // Filtrar transacciones de esta cuenta
            const trxCuenta = _transacciones.filter(t => String(t.cuentaBancariaId) === String(cuentaId));
            const ingresos  = trxCuenta.filter(t => t.tipo==='Ingreso').reduce((s,t)=>s+Number(t.monto||0),0);
            const egresos   = trxCuenta.filter(t => t.tipo==='Egreso').reduce((s,t)=>s+Number(t.monto||0),0);
        
            document.getElementById('drawerIngresos').textContent  = fQ(ingresos);
            document.getElementById('drawerEgresos').textContent   = fQ(egresos);
            document.getElementById('drawerSaldoIni').textContent  = fQ(Number(c.saldoInicial||0));
            document.getElementById('drawerNumTrx').textContent    = trxCuenta.length;
        
            // Historial
            const listEl = document.getElementById('drawerTrxList');
            const TIPO_ICON = {
                Ingreso:       '<polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/>',
                Egreso:        '<polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/>',
                Transferencia: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>',
                Ajuste:        '<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'
            };
            const TIPO_BG   = {Ingreso:'#E3FAE9',Egreso:'#FFE9E8',Transferencia:'#E3F0FF',Ajuste:'#FFF4E0'};
            const TIPO_STR  = {Ingreso:'var(--success)',Egreso:'var(--danger)',Transferencia:'var(--accent)',Ajuste:'var(--warning)'};
            const TIPO_CLS  = {Ingreso:'ing',Egreso:'egr',Transferencia:'tra',Ajuste:'adj'};
            const SIGN      = {Ingreso:'+',Egreso:'-',Transferencia:'+',Ajuste:'±'};
        
            if (!trxCuenta.length) {
                listEl.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">Sin movimientos aún</div>';
            } else {
                listEl.innerHTML = trxCuenta.slice(0, 30).map(t => `
                <div class="drawer-trx-item">
                    <div class="drawer-trx-icon" style="background:${TIPO_BG[t.tipo]||'#f2f2f7'}">
                        <svg viewBox="0 0 24 24" style="stroke:${TIPO_STR[t.tipo]||'#8E8E93'}">${TIPO_ICON[t.tipo]||''}</svg>
                    </div>
                    <div style="flex:1;min-width:0">
                        <div class="drawer-trx-concept">${escHtml(t.concepto)}</div>
                        <div class="drawer-trx-date">${fechaCorta(t.fecha)}${t.referencia?' · Ref: '+escHtml(t.referencia):''}</div>
                    </div>
                    <div>
                        <div class="drawer-trx-amount ${TIPO_CLS[t.tipo]||''}">${SIGN[t.tipo]||''}Q ${Number(t.monto||0).toLocaleString('es-GT',{minimumFractionDigits:2})}</div>
                        ${esAdmin()?`<button class="btn-danger-sm" style="margin-top:3px;font-size:10px" onclick="confirmDeleteTrx('${t.id}','${escAttr(t.concepto)}')">Eliminar</button>`:''}
                    </div>
                </div>`).join('');
            }
        
            // Permisos
            const admin = esAdmin();
            const footer = document.getElementById('bankDrawerFooter');
            if (footer) {
                document.getElementById('drawerDeleteBtn').style.display = admin ? '' : 'none';
            }
        
            document.getElementById('bankDrawerOverlay').classList.add('open');
            document.getElementById('bankDrawer').classList.add('open');
        }
        
        function closeBankDrawer() {
            document.getElementById('bankDrawerOverlay').classList.remove('open');
            document.getElementById('bankDrawer').classList.remove('open');
            _drawerCuentaId = null;
        }
        
        /* ═══════════════════════════════════════════════════════════
           RENDER — PLAN DE CUENTAS
        ═══════════════════════════════════════════════════════════ */
        const PLAN_TAG_CLS = {Activo:'tag-activo', Pasivo:'tag-pasivo', Capital:'tag-capital', Ingreso:'tag-ingreso-c', Egreso:'tag-egreso'};
        
        function filtrarPlan(filtro, el) {
            if (el) { el.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); }
            _filtroPlanActual = filtro;
            renderPlanCuentas(filtro);
        }
        
        function renderPlanCuentas(filtro) {
            let data = filtro === 'Todos' ? _planCuentas.slice() : _planCuentas.filter(c => c.tipo === filtro);
            const admin = esAdmin();
            const gerente = (_rol === 'Gerente');
            document.getElementById('planTbody').innerHTML = data.length
                ? data.map(c => {
                    const activa = c.activa === true || c.activa === 'true';
                    return `<tr>
                    <td><span style="font-family:monospace;font-size:12px;font-weight:600">${escHtml(c.codigo)}</span></td>
                    <td style="font-weight:500">${escHtml(c.nombre)}</td>
                    <td><span class="tag ${PLAN_TAG_CLS[c.tipo]||'tag-gray'}">${escHtml(c.tipo)}</span></td>
                    <td>${escHtml(c.rubro)||'—'}</td>
                    <td style="color:var(--text-secondary);max-width:200px" title="${escHtml(c.descripcion)}">${escHtml(c.descripcion)||'—'}</td>
                    <td><span class="tag ${activa?'tag-success':'tag-danger'}">${activa?'Activa':'Inactiva'}</span></td>
                    <td>
                        <div class="row-actions">
                            ${(admin||gerente)?`<button class="section-action" onclick="editCuentaContable('${c.id}')">Editar</button>`:''}
                            ${admin?`<button class="btn-danger-sm" onclick="confirmDeleteCuentaContable('${c.id}','${escAttr(c.nombre)}')">Eliminar</button>`:''}
                        </div>
                    </td>
                    </tr>`;
                }).join('')
                : '<tr><td colspan="7" class="empty-cell">Sin cuentas contables</td></tr>';
        }
        
        /* ═══════════════════════════════════════════════════════════
           RENDER — TRANSACCIONES
        ═══════════════════════════════════════════════════════════ */
        function filtrarTrx(filtro, el) {
            if (el) { el.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active')); el.classList.add('active'); }
            _filtroTrxActual = filtro;
            renderTransacciones(filtro);
        }
        
        function renderTransacciones(filtro) {
            let data = filtro === 'Todos' ? _transacciones.slice() : _transacciones.filter(t => t.tipo === filtro);
        
            const cbId = (document.getElementById('trxFiltroCuenta')||{}).value;
            if (cbId) data = data.filter(t => String(t.cuentaBancariaId) === cbId);
        
            const desde = (document.getElementById('trxDesde')||{}).value;
            const hasta = (document.getElementById('trxHasta')||{}).value;
            if (desde) data = data.filter(t => new Date(t.fecha) >= new Date(desde));
            if (hasta) data = data.filter(t => new Date(t.fecha) <= new Date(hasta + 'T23:59:59'));
        
            const admin = esAdmin();
            const fQ = n => 'Q ' + Number(n||0).toLocaleString('es-GT',{minimumFractionDigits:2});
        
            document.getElementById('trxTbody').innerHTML = data.length
                ? data.map(t => {
                    const cb = _cuentasBancarias.find(c => String(c.id) === String(t.cuentaBancariaId));
                    const cc = _planCuentas.find(c => String(c.id) === String(t.cuentaContableId));
                    const sign = {Ingreso:'+',Egreso:'-',Transferencia:'±',Ajuste:'~'}[t.tipo]||'';
                    const amtCls = {Ingreso:'tag-trx-Ingreso',Egreso:'tag-trx-Egreso',Transferencia:'tag-trx-Transferencia',Ajuste:'tag-trx-Ajuste'}[t.tipo]||'';
                    return `<tr>
                    <td>${fechaCorta(t.fecha)}</td>
                    <td><span class="tag ${amtCls}">${escHtml(t.tipo)}</span></td>
                    <td>
                        <div style="font-weight:500">${escHtml(t.concepto)}</div>
                        ${t.descripcion?`<div class="cell-sub">${escHtml(t.descripcion)}</div>`:''}
                    </td>
                    <td>${cb?escHtml(cb.nombre):'—'}</td>
                    <td>${cc?`<span style="font-family:monospace;font-size:11px">${escHtml(cc.codigo)}</span> ${escHtml(cc.nombre)}`:'—'}</td>
                    <td>${t.referencia?escHtml(t.referencia):'—'}</td>
                    <td class="cell-num" style="font-weight:700;color:${t.tipo==='Egreso'?'var(--danger)':'var(--success)'}">${sign}${fQ(t.monto)}</td>
                    <td>${admin?`<button class="btn-danger-sm" onclick="confirmDeleteTrx('${t.id}','${escAttr(t.concepto)}')">Eliminar</button>`:''}</td>
                    </tr>`;
                }).join('')
                : '<tr><td colspan="8" class="empty-cell">Sin transacciones con estos filtros</td></tr>';
        
            const total = data.reduce((s,t)=>{
                if(t.tipo==='Ingreso'||t.tipo==='Transferencia') return s+Number(t.monto||0);
                if(t.tipo==='Egreso') return s-Number(t.monto||0);
                return s;
            },0);
            const foot = document.getElementById('trxFoot');
            if (foot) foot.innerHTML = `<span><strong>${data.length}</strong> transacciones</span><span>Balance filtrado: <strong style="color:${total>=0?'var(--success)':'var(--danger)'}">${total>=0?'+':''}${fQ(total)}</strong></span>`;
        }
        
        function actualizarSelectCuentas() {
            const sel = document.getElementById('trxFiltroCuenta');
            if (!sel) return;
            const prev = sel.value;
            sel.innerHTML = '<option value="">Todas las cuentas</option>' +
                _cuentasBancarias.map(c => `<option value="${c.id}">${escHtml(c.nombre)}</option>`).join('');
            if (prev) sel.value = prev;
        }
        
        function actualizarSelectPlan() {
            // usada en los modales de transacción para elegir cuenta contable
        }
        
        function exportarTransacciones() {
            const filas = _transacciones.map(t => {
                const cb = _cuentasBancarias.find(c=>String(c.id)===String(t.cuentaBancariaId));
                const cc = _planCuentas.find(c=>String(c.id)===String(t.cuentaContableId));
                return {
                    ID:t.id, Fecha:fechaCorta(t.fecha), Tipo:t.tipo, Concepto:t.concepto,
                    Monto:t.monto, CuentaBancaria:cb?cb.nombre:'', CuentaContable:cc?cc.codigo+'-'+cc.nombre:'',
                    Referencia:t.referencia, Descripcion:t.descripcion, Creado:t.creadoPor
                };
            });
            descargarCSV(filas, 'transacciones');
        }
        
        /* ═══════════════════════════════════════════════════════════
           MODALES — CUENTA BANCARIA
        ═══════════════════════════════════════════════════════════ */
        const LOGOS_BANCO = ['Industrial','Banrural','BAC','Promerica','Azteca'];
        const LOGO_DESC   = {Industrial:'Banco Industrial',Banrural:'Banrural',BAC:'BAC Credomatic',Promerica:'Banco Promerica',Azteca:'Banco Azteca'};
        
        function openNuevaCuentaBancaria() {
            _modalMode = {type:'cuentaBancaria', action:'add'};
            openModal('Nueva cuenta bancaria', _formCuentaBancaria(null));
        }
        
        function editCuentaBancaria(id) {
            const c = _cuentasBancarias.find(x=>String(x.id)===String(id));
            if (!c) return;
            _modalMode = {type:'cuentaBancaria', action:'edit', id};
            openModal('Editar cuenta bancaria', _formCuentaBancaria(c));
        }
        
        function _formCuentaBancaria(c) {
            const v = (f,d) => c ? escHtml(c[f]||d||'') : (d||'');
            return `
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">NOMBRE DE LA CUENTA</label>
                    <input class="form-input" id="cbNombre" value="${v('nombre')}" placeholder="Ej. Cuenta Principal Operaciones"/>
                </div>
                <div class="form-field">
                    <label class="form-label">BANCO</label>
                    <input class="form-input" id="cbBanco" value="${v('banco')}" placeholder="Nombre del banco"/>
                </div>
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">NÚMERO DE CUENTA</label>
                    <input class="form-input" id="cbNumero" value="${v('numeroCuenta')}" placeholder="0000-0000-0000"/>
                </div>
                <div class="form-field">
                    <label class="form-label">A NOMBRE DE</label>
                    <input class="form-input" id="cbNombreDe" value="${v('aNombreDe')}" placeholder="Razón social o persona"/>
                </div>
            </div>
            <div class="form-field">
                <label class="form-label">LOGO DEL BANCO</label>
                <div id="logoSelector" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:6px">
                    ${LOGOS_BANCO.map(logo => `
                    <label style="cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:5px">
                        <input type="radio" name="cbLogo" value="${logo}" style="display:none"
                            ${(c&&c.logo===logo)||(!c&&logo==='Industrial')?'checked':''}>
                        <div class="bank-logo-wrap bank-logo-${logo} logo-radio-wrap" style="width:50px;height:50px;border-radius:12px;border:2px solid transparent;font-size:13px"
                             onclick="selectLogo('${logo}')">
                            <img src="logo-banco-${logo.toLowerCase()}.png" alt="${logo}"
                                 style="width:100%;height:100%;object-fit:contain;border-radius:inherit;display:block;"
                                 onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
                            <span class="bank-logo-text" style="display:none;">${LOGO_INITIALS[logo]||logo.substring(0,2)}</span>
                        </div>
                        <span style="font-size:10px;color:var(--text-secondary)">${logo}</span>
                    </label>`).join('')}
                </div>
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">CUENTA CONTABLE ASOCIADA</label>
                    <select class="form-select" id="cbCuentaContable">
                        <option value="">— Sin asignar —</option>
                        ${_planCuentas.filter(p=>p.tipo==='Activo').map(p=>
                            `<option value="${p.id}"${c&&String(c.cuentaContable)===String(p.id)?' selected':''}>${escHtml(p.codigo)} — ${escHtml(p.nombre)}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-field">
                    <label class="form-label">RUBRO</label>
                    <input class="form-input" id="cbRubro" value="${v('rubro')}" placeholder="Ej. Activo Corriente"/>
                </div>
            </div>
            ${!c ? `<div class="form-field">
                <label class="form-label">SALDO INICIAL (Q)</label>
                <input class="form-input" id="cbSaldoInicial" type="number" min="0" step="0.01" value="0" placeholder="0.00"/>
            </div>` : ''}
            ${c ? `<div class="form-field">
                <label class="form-label">ESTADO</label>
                <select class="form-select" id="cbActiva">
                    <option value="true"${c.activa===true||c.activa==='true'?' selected':''}>Activa</option>
                    <option value="false"${c.activa===false||c.activa==='false'?' selected':''}>Inactiva</option>
                </select>
            </div>` : ''}
            `;
        }
        
        function selectLogo(logo) {
            document.querySelectorAll('input[name="cbLogo"]').forEach(r => {
                const wrap = r.closest('label').querySelector('.logo-radio-wrap');
                if (r.value === logo) { r.checked = true; wrap.style.border = '2px solid var(--accent)'; }
                else { r.checked = false; wrap.style.border = '2px solid transparent'; }
            });
        }
        
        // Init logos: marcar el seleccionado inicialmente
        setTimeout(function(){
            const checked = document.querySelector('input[name="cbLogo"]:checked');
            if (checked) selectLogo(checked.value);
        }, 100);
        
        function confirmDeleteCuentaBancaria(id, nombre) {
            if (!esAdmin()) return;
            _modalMode = {type:'cuentaBancaria', action:'delete', id};
            openModal('Eliminar cuenta bancaria', `<div style="text-align:center;padding:10px 0">
                <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none;display:block;margin:0 auto 12px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar cuenta bancaria?</div>
                <div style="font-size:13px;color:var(--text-secondary)">Se eliminará <strong>${escHtml(nombre)}</strong>.<br>Solo es posible si no tiene transacciones asociadas.</div>
            </div>`);
            document.getElementById('modalSaveBtn').textContent = 'Eliminar';
            document.getElementById('modalSaveBtn').style.background = 'var(--danger)';
        }
        
        /* ═══════════════════════════════════════════════════════════
           MODALES — CUENTA CONTABLE
        ═══════════════════════════════════════════════════════════ */
        const TIPOS_CONT = ['Activo','Pasivo','Capital','Ingreso','Egreso'];
        const RUBROS_POR_TIPO = {
            Activo:  ['Activo Corriente','Activo No Corriente'],
            Pasivo:  ['Pasivo Corriente','Pasivo No Corriente'],
            Capital: ['Patrimonio'],
            Ingreso: ['Ingreso Operacional','Ingreso No Operacional'],
            Egreso:  ['Costo','Gasto Administrativo','Gasto Operativo','Gasto Financiero','Gasto Fiscal']
        };
        
        function openNuevaCuentaContable() {
            _modalMode = {type:'cuentaContable', action:'add'};
            openModal('Nueva cuenta contable', _formCuentaContable(null));
        }
        
        function editCuentaContable(id) {
            const c = _planCuentas.find(x=>String(x.id)===String(id));
            if (!c) return;
            _modalMode = {type:'cuentaContable', action:'edit', id};
            openModal('Editar cuenta contable', _formCuentaContable(c));
        }
        
        function _formCuentaContable(c) {
            const tipo = c ? c.tipo : 'Activo';
            const rubros = RUBROS_POR_TIPO[tipo] || [];
            return `
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">CÓDIGO CONTABLE</label>
                    <input class="form-input" id="ccCodigo" value="${c?escHtml(c.codigo):''}" placeholder="Ej. 1-05, 5-03"/>
                </div>
                <div class="form-field">
                    <label class="form-label">TIPO</label>
                    <select class="form-select" id="ccTipo" onchange="actualizarRubrosSelect(this.value)">
                        ${TIPOS_CONT.map(t=>`<option${t===tipo?' selected':''}>${t}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-field">
                <label class="form-label">NOMBRE DE LA CUENTA</label>
                <input class="form-input" id="ccNombre" value="${c?escHtml(c.nombre):''}" placeholder="Ej. Sueldos y Salarios"/>
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">RUBRO</label>
                    <select class="form-select" id="ccRubro">
                        ${rubros.map(r=>`<option${c&&c.rubro===r?' selected':''}>${r}</option>`).join('')}
                    </select>
                </div>
                ${c?`<div class="form-field">
                    <label class="form-label">ESTADO</label>
                    <select class="form-select" id="ccActiva">
                        <option value="true"${c.activa===true||c.activa==='true'?' selected':''}>Activa</option>
                        <option value="false"${c.activa===false||c.activa==='false'?' selected':''}>Inactiva</option>
                    </select>
                </div>`:''}
            </div>
            <div class="form-field">
                <label class="form-label">DESCRIPCIÓN</label>
                <textarea class="form-textarea" id="ccDescripcion" rows="2" placeholder="Descripción opcional de la cuenta">${c?escHtml(c.descripcion):''}</textarea>
            </div>`;
        }
        
        function actualizarRubrosSelect(tipo) {
            const sel = document.getElementById('ccRubro');
            if (!sel) return;
            const rubros = RUBROS_POR_TIPO[tipo] || [];
            sel.innerHTML = rubros.map(r=>`<option>${r}</option>`).join('');
        }
        
        function confirmDeleteCuentaContable(id, nombre) {
            if (!esAdmin()) return;
            _modalMode = {type:'cuentaContable', action:'delete', id};
            openModal('Eliminar cuenta contable', `<div style="text-align:center;padding:10px 0">
                <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none;display:block;margin:0 auto 12px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar cuenta contable?</div>
                <div style="font-size:13px;color:var(--text-secondary)">Se eliminará <strong>${escHtml(nombre)}</strong>.<br>Solo posible si no tiene transacciones asociadas.</div>
            </div>`);
            document.getElementById('modalSaveBtn').textContent = 'Eliminar';
            document.getElementById('modalSaveBtn').style.background = 'var(--danger)';
        }
        
        /* ═══════════════════════════════════════════════════════════
           MODALES — TRANSACCIONES
        ═══════════════════════════════════════════════════════════ */
        function openNuevaTrx(tipoPreset) {
            const tipo = tipoPreset || 'Ingreso';
            _modalMode = {type:'transaccion', action:'add'};
            const hoy = new Date().toISOString().slice(0,10);
            openModal('Nueva transacción', `
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">TIPO</label>
                    <select class="form-select" id="trxTipo">
                        ${['Ingreso','Egreso','Transferencia','Ajuste'].map(t=>`<option${t===tipo?' selected':''}>${t}</option>`).join('')}
                    </select>
                </div>
                <div class="form-field">
                    <label class="form-label">FECHA</label>
                    <input class="form-input" id="trxFecha" type="date" value="${hoy}"/>
                </div>
            </div>
            <div class="form-field">
                <label class="form-label">CONCEPTO</label>
                <input class="form-input" id="trxConcepto" placeholder="Descripción breve del movimiento"/>
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">MONTO (Q)</label>
                    <input class="form-input" id="trxMonto" type="number" min="0.01" step="0.01" placeholder="0.00"/>
                </div>
                <div class="form-field">
                    <label class="form-label">REFERENCIA / NO. DOCUMENTO</label>
                    <input class="form-input" id="trxReferencia" placeholder="Factura, cheque, etc."/>
                </div>
            </div>
            <div class="form-row">
                <div class="form-field">
                    <label class="form-label">CUENTA BANCARIA</label>
                    <select class="form-select" id="trxCuentaBancaria">
                        <option value="">— Seleccionar —</option>
                        ${_cuentasBancarias.filter(c=>c.activa===true||c.activa==='true').map(c=>
                            `<option value="${c.id}"${_drawerCuentaId&&String(c.id)===String(_drawerCuentaId)?' selected':''}>${escHtml(c.nombre)} (${escHtml(c.banco)})</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-field">
                    <label class="form-label">CUENTA CONTABLE</label>
                    <select class="form-select" id="trxCuentaContable">
                        <option value="">— Sin asignar —</option>
                        ${_planCuentas.map(p=>`<option value="${p.id}">${escHtml(p.codigo)} — ${escHtml(p.nombre)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-field">
                <label class="form-label">DESCRIPCIÓN ADICIONAL</label>
                <textarea class="form-textarea" id="trxDescripcion" rows="2" placeholder="Detalle, proveedor, empleado, etc."></textarea>
            </div>
            `);
        }
        
        function confirmDeleteTrx(id, concepto) {
            if (!esAdmin()) return;
            _modalMode = {type:'transaccion', action:'delete', id};
            openModal('Eliminar transacción', `<div style="text-align:center;padding:10px 0">
                <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none;display:block;margin:0 auto 12px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar transacción?</div>
                <div style="font-size:13px;color:var(--text-secondary)">Se revertirá el efecto de <strong>${escHtml(concepto)}</strong> en el saldo de la cuenta.<br>Esta acción no se puede deshacer.</div>
            </div>`);
            document.getElementById('modalSaveBtn').textContent = 'Eliminar';
            document.getElementById('modalSaveBtn').style.background = 'var(--danger)';
        }
        
        /* ═══════════════════════════════════════════════════════════
           MODAL SAVE — extender la función modalSave() del dashboard
           Agregar dentro del switch/if de modalSave() existente:
        ═══════════════════════════════════════════════════════════ */
        function _handleModalSaveContabilidad(m, saveBtn) {
            function _btnOk()  { if(saveBtn){saveBtn.disabled=false; saveBtn.textContent='Guardar'; saveBtn.style.background='';} }
            function _btnDel() { if(saveBtn){saveBtn.disabled=false; saveBtn.textContent='Eliminar'; saveBtn.style.background='var(--danger)';} }

            // ── Cuenta bancaria ──
            if (m.type === 'cuentaBancaria') {
                if (m.action === 'delete') {
                    window.api
                        .withSuccessHandler(function(r) {
                            _btnDel();
                            if (!r.ok) { showToast(r.error||'Error al eliminar', '#FF453A'); return; }
                            closeModal();
                            showToast('Cuenta bancaria eliminada', '#FF453A');
                            closeBankDrawer();
                            loadCuentasBancarias(); loadResumenContable();
                        })
                        .withFailureHandler(function(e){ _btnDel(); showToast('Error: '+e.message,'#FF453A'); })
                        .deleteCuentaBancaria({id: m.id});
                    return true;
                }
                const logoRad = document.querySelector('input[name="cbLogo"]:checked');
                const d = {
                    nombre:        (document.getElementById('cbNombre')||{}).value||'',
                    banco:         (document.getElementById('cbBanco')||{}).value||'',
                    numeroCuenta:  (document.getElementById('cbNumero')||{}).value||'',
                    aNombreDe:     (document.getElementById('cbNombreDe')||{}).value||'',
                    logo:          logoRad ? logoRad.value : 'Industrial',
                    cuentaContable:(document.getElementById('cbCuentaContable')||{}).value||'',
                    rubro:         (document.getElementById('cbRubro')||{}).value||'',
                };
                if (!d.nombre||!d.banco||!d.numeroCuenta||!d.aNombreDe) {
                    _btnOk(); showToast('Completa todos los campos requeridos', '#FF9F0A'); return true;
                }
                if (m.action === 'add') {
                    d.saldoInicial = (document.getElementById('cbSaldoInicial')||{}).value||'0';
                    window.api
                        .withSuccessHandler(function(r) {
                            _btnOk();
                            if (!r.ok) { showToast(r.error||'Error', '#FF453A'); return; }
                            closeModal();
                            showToast('Cuenta bancaria creada', '#30D158');
                            loadCuentasBancarias(); loadResumenContable();
                        })
                        .withFailureHandler(function(e){ _btnOk(); showToast('Error: '+e.message,'#FF453A'); })
                        .addCuentaBancaria(d);
                } else {
                    d.id = m.id;
                    d.activa = (document.getElementById('cbActiva')||{}).value||'true';
                    window.api
                        .withSuccessHandler(function(r) {
                            _btnOk();
                            if (!r.ok) { showToast(r.error||'Error', '#FF453A'); return; }
                            closeModal();
                            showToast('Cuenta actualizada', '#30D158');
                            loadCuentasBancarias(); loadResumenContable();
                            if (_drawerCuentaId) openBankDrawer(_drawerCuentaId);
                        })
                        .withFailureHandler(function(e){ _btnOk(); showToast('Error: '+e.message,'#FF453A'); })
                        .updateCuentaBancaria(d);
                }
                return true;
            }
        
            // ── Cuenta contable ──
            if (m.type === 'cuentaContable') {
                if (m.action === 'delete') {
                    window.api
                        .withSuccessHandler(function(r) {
                            _btnDel();
                            if (!r.ok) { showToast(r.error||'Error al eliminar', '#FF453A'); return; }
                            closeModal();
                            showToast('Cuenta contable eliminada', '#FF453A');
                            loadPlanCuentas();
                        })
                        .withFailureHandler(function(e){ _btnDel(); showToast('Error: '+e.message,'#FF453A'); })
                        .deleteCuentaContable({id: m.id});
                    return true;
                }
                const d = {
                    codigo:      (document.getElementById('ccCodigo')||{}).value||'',
                    nombre:      (document.getElementById('ccNombre')||{}).value||'',
                    tipo:        (document.getElementById('ccTipo')||{}).value||'',
                    rubro:       (document.getElementById('ccRubro')||{}).value||'',
                    descripcion: (document.getElementById('ccDescripcion')||{}).value||'',
                };
                if (!d.codigo||!d.nombre) { _btnOk(); showToast('Código y nombre son requeridos','#FF9F0A'); return true; }
                if (m.action === 'add') {
                    window.api
                        .withSuccessHandler(function(r) {
                            _btnOk();
                            if (!r.ok) { showToast(r.error||'Error','#FF453A'); return; }
                            closeModal();
                            showToast('Cuenta contable creada','#30D158');
                            loadPlanCuentas();
                        })
                        .withFailureHandler(function(e){ _btnOk(); showToast('Error: '+e.message,'#FF453A'); })
                        .addCuentaContable(d);
                } else {
                    d.id = m.id;
                    d.activa = (document.getElementById('ccActiva')||{}).value||'true';
                    window.api
                        .withSuccessHandler(function(r) {
                            _btnOk();
                            if (!r.ok) { showToast(r.error||'Error','#FF453A'); return; }
                            closeModal();
                            showToast('Cuenta contable actualizada','#30D158');
                            loadPlanCuentas();
                        })
                        .withFailureHandler(function(e){ _btnOk(); showToast('Error: '+e.message,'#FF453A'); })
                        .updateCuentaContable(d);
                }
                return true;
            }
        
            // ── Transacción ──
            if (m.type === 'transaccion') {
                if (m.action === 'delete') {
                    window.api
                        .withSuccessHandler(function(r) {
                            _btnDel();
                            if (!r.ok) { showToast(r.error||'Error al eliminar', '#FF453A'); return; }
                            closeModal();
                            showToast('Transacción eliminada y saldo revertido', '#FF9F0A');
                            loadTransacciones(); loadCuentasBancarias(); loadResumenContable();
                            if (_drawerCuentaId) setTimeout(function(){ openBankDrawer(_drawerCuentaId); }, 300);
                        })
                        .withFailureHandler(function(e){ _btnDel(); showToast('Error: '+e.message,'#FF453A'); })
                        .deleteTransaccion({id: m.id});
                    return true;
                }
                const d = {
                    tipo:            (document.getElementById('trxTipo')||{}).value||'',
                    fecha:           (document.getElementById('trxFecha')||{}).value||'',
                    concepto:        (document.getElementById('trxConcepto')||{}).value||'',
                    monto:           (document.getElementById('trxMonto')||{}).value||'',
                    cuentaBancariaId:(document.getElementById('trxCuentaBancaria')||{}).value||'',
                    cuentaContableId:(document.getElementById('trxCuentaContable')||{}).value||'',
                    referencia:      (document.getElementById('trxReferencia')||{}).value||'',
                    descripcion:     (document.getElementById('trxDescripcion')||{}).value||'',
                };
                if (!d.concepto||!d.monto||!d.cuentaBancariaId||!d.fecha) {
                    _btnOk(); showToast('Completa concepto, monto, cuenta y fecha','#FF9F0A'); return true;
                }
                if (isNaN(Number(d.monto)) || Number(d.monto) <= 0) {
                    _btnOk(); showToast('El monto debe ser un número mayor a 0','#FF9F0A'); return true;
                }
                window.api
                    .withSuccessHandler(function(r) {
                        _btnOk();
                        if (!r.ok) { showToast(r.error||'Error', '#FF453A'); return; }
                        closeModal();
                        showToast('Transacción registrada', '#30D158');
                        loadTransacciones(); loadCuentasBancarias(); loadResumenContable();
                        if (_drawerCuentaId) setTimeout(function(){ openBankDrawer(_drawerCuentaId); }, 300);
                    })
                    .withFailureHandler(function(e){ _btnOk(); showToast('Error: '+e.message,'#FF453A'); })
                    .addTransaccion(d);
                return true;
            }
            return false; // no era contabilidad, dejar que maneje el resto
        }
