/* ═══════════════════════════════════════════════════════
   prospectos.js — Carga, render, funnel, modales de Prospectos
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

        function loadProspectos() {
            window.api
                .withSuccessHandler(function (r) {
                    if (!r.ok) { showToast('Error prospectos: ' + (r.error || 'sin datos'), '#FF453A'); return; }
                    _prospectos = r.data || [];
                    renderProspectos(_filtroProActual);
                    renderFunnel();
                })
                .withFailureHandler(function (err) { _onApiError('prospectos', err); })
                .getProspectos();
        }


        /* ═══════════════════════════════════════════════════════
           RENDER – PROSPECTOS
        ═══════════════════════════════════════════════════════ */
        const _fQ = n => 'Q ' + Math.round(Number(n) || 0).toLocaleString();

        /* Embudo por etapa (cantidad, valor, probabilidad y ponderado), pronóstico mensual y motivos de pérdida.
           Los cálculos están en embudo-calc.js (probados en tests/unit/embudo.test.js). */
        function renderFunnel() {
            const E = window.EmbudoCalc;
            const filas = E.porEtapa(_prospectos);
            const abiertas = filas.filter(f => E.ETAPAS_ABIERTAS.indexOf(f.etapa) >= 0);
            const max = Math.max.apply(null, abiertas.map(f => f.valor).concat([1]));
            const tot = abiertas.reduce((o, f) => { o.n += f.n; o.valor += f.valor; o.pond += f.ponderado; return o; }, {n: 0, valor: 0, pond: 0});
            const fila = f => `<div class="emb-row" role="button" tabindex="0" title="Ver ${escAttr(f.etapa)}" onclick="filtrarProspectosEtapa('${escAttr(f.etapa)}')" onkeydown="if(event.key==='Enter')this.click()">
          <div class="emb-row-head">
            <span class="emb-dot" style="background:${ETAPA_COLOR[f.etapa] || '#8E8E93'}"></span>
            <span class="emb-etapa">${escHtml(f.etapa)}</span>
            <span class="emb-n">${f.n}</span>
            <span class="emb-prob" title="Probabilidad promedio">${f.probPromedio}%</span>
            <span class="emb-val">${_fQ(f.valor)}</span>
            <span class="emb-pond" title="Valor ponderado por probabilidad">${_fQ(f.ponderado)}</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${f.n ? Math.max(Math.round(f.valor / max * 100), 2) : 0}%;background:${ETAPA_COLOR[f.etapa]}"></div></div>
        </div>`;
            const ganado = filas.find(f => f.etapa === 'Ganado'), perdido = filas.find(f => f.etapa === 'Perdido');
            document.getElementById('funnelGrid').innerHTML =
                `<div class="emb-row emb-row-hdr" aria-hidden="true"><div class="emb-row-head"><span class="emb-dot"></span><span class="emb-etapa">Etapa</span><span class="emb-n">Cant.</span><span class="emb-prob">Prob.</span><span class="emb-val">Valor</span><span class="emb-pond">Ponderado</span></div></div>` +
                abiertas.map(fila).join('') +
                `<div class="emb-total"><span>Embudo abierto: <strong>${tot.n}</strong> oportunidades · <strong>${_fQ(tot.valor)}</strong></span><span>Ponderado: <strong>${_fQ(tot.pond)}</strong></span></div>
        <div class="emb-cerrados">
          <button class="emb-chip ok" onclick="filtrarProspectosEtapa('Ganado')">Ganados: <strong>${ganado.n}</strong> · ${_fQ(ganado.valor)}</button>
          <button class="emb-chip bad" onclick="filtrarProspectosEtapa('Perdido')">Perdidos: <strong>${perdido.n}</strong> · ${_fQ(perdido.valor)}</button>
        </div>`;
            _renderPronostico();
            _renderMotivos();
        }

        function _renderPronostico() {
            const el = document.getElementById('embPronostico');
            if (!el) return;
            const E = window.EmbudoCalc, hoy = new Date();
            const pr = E.pronostico(_prospectos, hoy, 6);
            const tc = E.tasaCierre(_prospectos, hoy, 90);
            document.getElementById('embTasa').textContent = tc.tasa === null
                ? 'Tasa de cierre (90 días): sin cierres aún'
                : `Tasa de cierre (90 días): ${tc.tasa}% · ${tc.ganados} ganados / ${tc.perdidos} perdidos`;
            const max = Math.max.apply(null, pr.meses.map(m => Math.max(m.valor, m.ganado)).concat([1]));
            const extra = (t, x, filtro, cls) => {
                if (!x.n) return '';
                const txt = `${t}: <strong>${x.n}</strong> · ${_fQ(x.valor)} (pond. ${_fQ(x.ponderado)})`;
                return filtro ? `<button class="emb-chip ${cls}" onclick="filtrarProspectosEtapa('${filtro}')">${txt}</button>` : `<span class="emb-chip ${cls}">${txt}</span>`;
            };
            el.innerHTML = `<div class="emb-fc">
          <div class="emb-fc-row emb-fc-hdr" aria-hidden="true"><span>Mes</span><span></span><span class="r">Ponderado</span><span class="r">Total</span><span class="r">Ganado</span></div>
          ${pr.meses.map((m, i) => `<div class="emb-fc-row${i === 0 ? ' actual' : ''}">
            <span class="emb-fc-mes">${m.etiqueta}${i === 0 ? ' <small>(este mes)</small>' : ''}</span>
            <span class="emb-fc-bars" title="${m.n} oportunidad${m.n === 1 ? '' : 'es'} con cierre estimado este mes">
              <span class="emb-fc-bar total" style="width:${m.valor / max * 100}%"></span>
              <span class="emb-fc-bar pond" style="width:${m.ponderado / max * 100}%"></span>
              ${m.ganado ? `<span class="emb-fc-bar ganado" style="width:${m.ganado / max * 100}%"></span>` : ''}
            </span>
            <span class="r strong">${_fQ(m.ponderado)}</span>
            <span class="r">${_fQ(m.valor)}</span>
            <span class="r ok">${m.ganado ? _fQ(m.ganado) : '—'}</span>
          </div>`).join('')}
        </div>
        <div class="emb-leyenda"><span><i class="pond"></i>Ponderado (valor × probabilidad)</span><span><i class="total"></i>Valor total</span><span><i class="ganado"></i>Ya ganado</span></div>
        <div class="emb-cerrados">${extra('Vencidos', pr.vencidos, 'Vencidos', 'bad')}${extra('Sin fecha de cierre', pr.sinFecha, '', 'warn')}${extra('Después de 6 meses', pr.posteriores, '', '')}</div>
        ${pr.abiertos.n && pr.sinFecha.n === pr.abiertos.n ? '<div class="cell-sub emb-hint">Ninguna oportunidad tiene fecha de cierre estimada. Agréguela al editar un prospecto para ver el pronóstico por mes.</div>' : ''}`;
        }

        function _renderMotivos() {
            const el = document.getElementById('embMotivos');
            if (!el) return;
            const mp = window.EmbudoCalc.motivosPerdida(_prospectos, new Date(), 90);
            el.innerHTML = (mp.lista.length
                ? mp.lista.map(x => `<div class="bar-group emb-motivo">
          <div class="bar-label"><span>${escHtml(x.motivo)} · ${x.n}</span><span>${x.pct}% · ${_fQ(x.valor)}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(x.pct, 2)}%;background:var(--az-danger, #FF453A)"></div></div>
        </div>`).join('')
                : '<div class="cell-sub emb-hint">Sin pérdidas con motivo en los últimos 90 días. Al marcar un prospecto como Perdido se pedirá el motivo.</div>')
                + (mp.sinMotivo ? `<div class="cell-sub emb-hint">${mp.sinMotivo.toLocaleString()} perdido${mp.sinMotivo === 1 ? '' : 's'} anterior${mp.sinMotivo === 1 ? '' : 'es'} sin motivo registrado.</div>` : '');
        }

        /* Filtra la tabla por etapa desde el embudo y activa la pestaña correspondiente */
        function filtrarProspectosEtapa(etapa) {
            const tab = Array.from(document.querySelectorAll('#page-prospectos .filter-tab'))
                .find(t => (t.getAttribute('onclick') || '').indexOf("'" + etapa + "'") >= 0);
            if (tab) filtrarProspectos(etapa, tab); else renderProspectos(etapa);
            _scrollToTable(document.querySelector('#page-prospectos .table-card:not(.funnel-card):not(.emb-card)'));
        }

        function _celdaCierre(p) {
            if (p.etapa === 'Ganado' || p.etapa === 'Perdido') {
                return p.cerrado_en ? `<span class="cell-sub" style="margin:0">Cerrado ${fechaCorta(p.cerrado_en)}</span>` : '<span class="cell-sub" style="margin:0">—</span>';
            }
            if (!p.fecha_cierre_estimada) return '<span class="cell-sub" style="margin:0">Sin fecha</span>';
            const venc = EmbudoCalc.estaVencido(p, new Date());
            return `<span class="cell-sub${venc ? ' emb-vencido' : ''}" style="margin:0"${venc ? ' title="La fecha estimada ya pasó: actualícela o cierre la oportunidad"' : ''}>${fechaCorta(p.fecha_cierre_estimada + 'T12:00:00')}${venc ? ' · vencido' : ''}</span>`;
        }

        /* Genera el HTML de una fila de prospecto (extraído para reutilizar en el render por lotes) */
        function _proRow(p, admin) {
            const prob = Math.max(0, Math.min(100, Number(p.probabilidad || 0)));
            const cls = prob >= 65 ? 'hot' : prob <= 30 ? 'cold' : '';
            return `<tr class="row-click" title="Ver ficha del prospecto" onclick="fichaRowClick(event,'Prospecto','${p.id}')">
        <td>
          <div class="client-name">
            <div class="mini-avatar" style="background:${p.color || '#8E8E93'}">${initials(p.nombre)}</div>
            <div>
              <div class="cell-main">${escHtml(p.nombre)}</div>
              <div class="cell-sub">${escHtml(p.empresa) || '—'} · ${escHtml(p.segmento)}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="cell-sub" style="margin:0">${p.correo ? `<a class="cell-link" href="mailto:${escAttr(p.correo)}">${escHtml(p.correo)}</a>` : '—'}</div>
          <div class="cell-sub cell-mono">${p.telefono ? `<a class="cell-link" href="tel:${escAttr(String(p.telefono).replace(/\s/g, ''))}">${escHtml(p.telefono)}</a>` : '—'}</div>
        </td>
        <td><div class="cell-clip" title="${escAttr(p.direccion)}">${escHtml(p.direccion) || '—'}</div></td>
        <td><span class="cell-sub" style="margin:0">${escHtml(p.origen) || '—'}</span></td>
        <td>${tagEtapa(p.etapa)}${p.etapa === 'Perdido' && p.motivo_perdida ? `<div class="cell-sub" title="${escAttr(p.motivo_perdida_detalle || '')}">${escHtml(p.motivo_perdida)}</div>` : ''}</td>
        <td>
          <div class="prob-wrap">
            <div class="prob-track"><div class="prob-fill ${cls}" style="width:${Math.max(prob, 2)}%"></div></div>
            <span class="prob-val">${prob}%</span>
          </div>
        </td>
        <td>${_celdaCierre(p)}</td>
        <td class="cell-num">Q ${Number(p.valorEstimado || 0).toLocaleString()}</td>
        <td>
          <div class="row-actions">
            ${p.etapa === 'Ganado' ? '' : `<button class="btn-success-sm" onclick="confirmConvertir('${p.id}')">Convertir</button>`}
            <button class="section-action" onclick="editProspecto('${p.id}')">Editar</button>
            ${admin ? `<button class="btn-danger-sm" onclick="confirmDeleteProspecto('${p.id}','${escAttr(p.nombre)}')">Eliminar</button>` : ''}
          </div>
        </td>
      </tr>`;
        }

        /* ══════════════════════════════════════════════════════
           UTILIDAD COMPARTIDA — paginación de tablas
           PAGE_SIZE: filas por página
           state: { page } — la página actual (0-indexed)
           renderFn(data, page): renderiza la página dada
        ══════════════════════════════════════════════════════ */
        var PAGE_SIZE = 100;

        /**
         * Construye el HTML de la barra de paginación en UNA SOLA FILA.
         * El número de páginas vecinas se adapta al ancho de pantalla:
         *   ≥ 600 px → ±2 vecinas  (hasta ~9 botones)
         *   480–599  → ±1 vecina   (hasta ~7 botones)
         *   < 480    → 0 vecinas   (hasta ~5 botones: ‹ 1 … actual … N ›)
         */
        function _buildPaginationHtml(currentPage, totalPages, onClickFn) {
            if (totalPages <= 1) return '';

            var w = window.innerWidth;
            var siblings = w >= 600 ? 2 : w >= 480 ? 1 : 0;

            var show = new Set();
            show.add(0);
            show.add(totalPages - 1);
            for (var i = Math.max(0, currentPage - siblings); i <= Math.min(totalPages - 1, currentPage + siblings); i++) {
                show.add(i);
            }
            var sorted = Array.from(show).sort(function(a, b){ return a - b; });

            var html = '';

            /* ‹ Anterior */
            html += '<button class="pg-btn pg-prev"' +
                (currentPage === 0
                    ? ' disabled'
                    : ' onclick="' + onClickFn + '(' + (currentPage - 1) + ')"') +
                ' title="Anterior">' +
                '<svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>' +
                '</button>';

            /* Números */
            var prev = -1;
            sorted.forEach(function(p) {
                if (prev !== -1 && p - prev > 1) {
                    html += '<span class="pg-ellipsis">…</span>';
                }
                html += '<button class="pg-btn' + (p === currentPage ? ' active' : '') + '"' +
                    ' onclick="' + onClickFn + '(' + p + ')">' + (p + 1) + '</button>';
                prev = p;
            });

            /* › Siguiente — naranja */
            html += '<button class="pg-btn pg-next"' +
                (currentPage === totalPages - 1
                    ? ' disabled'
                    : ' onclick="' + onClickFn + '(' + (currentPage + 1) + ')"') +
                ' title="Siguiente">' +
                '<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>' +
                '</button>';

            return html;
        }

        /** Sube el scroll de .content hasta la tabla indicada (sin saltar brusco) */
        function _scrollToTable(tableCardEl) {
            if (!tableCardEl) return;
            var content = document.querySelector('.content');
            if (!content) return;
            var top = tableCardEl.offsetTop - 12;
            content.scrollTo({ top: top, behavior: 'smooth' });
        }

        /* ── Estado de paginación ── */
        var _proPage = 0;
        var _cliPage = 0;

        /* Referencia al dataset filtrado actual (para que los botones de página funcionen) */
        var _proDataPaged = [];
        var _cliDataPaged = [];

        function goProPage(page) {
            _proPage = page;
            _renderProPagedData();
            _scrollToTable(document.querySelector('#page-prospectos .table-card:not(.funnel-card):not(.emb-card)'));
        }

        function goCliPage(page) {
            _cliPage = page;
            _renderCliPagedData();
            _scrollToTable(document.querySelector('#page-clientes .table-card'));
        }

        function _renderProPagedData() {
            var data = _proDataPaged;
            var totalPages = Math.ceil(data.length / PAGE_SIZE);
            var start = _proPage * PAGE_SIZE;
            var slice = data.slice(start, start + PAGE_SIZE);
            var admin = esAdmin();
            var tbody = document.getElementById('prospectosTbody');
            tbody.innerHTML = slice.length
                ? slice.map(function(p){ return _proRow(p, admin); }).join('')
                : '<tr><td colspan="9" class="empty-cell">Sin prospectos con estos filtros</td></tr>';
            document.getElementById('proPagination').innerHTML = _buildPaginationHtml(_proPage, totalPages, 'goProPage');
        }

        function _renderCliPagedData() {
            var data = _cliDataPaged;
            var totalPages = Math.ceil(data.length / PAGE_SIZE);
            var start = _cliPage * PAGE_SIZE;
            var slice = data.slice(start, start + PAGE_SIZE);
            var admin = esAdmin();
            var tbody = document.getElementById('clientesTbody');
            tbody.innerHTML = slice.length
                ? slice.map(function(c){
                    return `<tr class="row-click" title="Ver ficha del cliente" onclick="fichaRowClick(event,'Cliente','${c.id}')">
        <td>
          <div class="client-name">
            <div class="mini-avatar" style="background:${c.color || '#8E8E93'}">${initials(c.nombre)}</div>
            <div>
              <div class="cell-main">${escHtml(c.nombre)}</div>
              <div class="cell-sub">${escHtml(c.empresa) || '—'}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="cell-sub" style="margin:0">${c.correo ? `<a class="cell-link" href="mailto:${escHtml(c.correo)}">${escHtml(c.correo)}</a>` : '—'}</div>
          <div class="cell-sub cell-mono">${c.telefono ? `<a class="cell-link" href="tel:${escHtml(String(c.telefono).replace(/\s/g, ''))}">${escHtml(c.telefono)}</a>` : '—'}</div>
        </td>
        <td><div class="cell-clip" title="${escHtml(c.direccion)}">${escHtml(c.direccion) || '—'}</div></td>
        <td>${tagSegmento(c.segmento)}</td>
        <td>${tagEstado(c.estado)}</td>
        <td class="cell-num">Q ${Number(c.valorTotal || 0).toLocaleString()}</td>
        <td>
          <div class="row-actions">
            <button class="section-action" onclick="editCliente('${c.id}')">Editar</button>
            ${admin ? `<button class="btn-danger-sm" onclick="confirmDeleteCliente('${c.id}','${escAttr(c.nombre)}')">Eliminar</button>` : ''}
          </div>
        </td>
      </tr>`;
                }).join('')
                : '<tr><td colspan="7" class="empty-cell">Sin resultados con estos filtros</td></tr>';
            document.getElementById('cliPagination').innerHTML = _buildPaginationHtml(_cliPage, totalPages, 'goCliPage');
        }

        function renderProspectos(filtro) {
            _filtroProActual = filtro;
            const hoy = new Date();
            let data = filtro === 'Todos' ? _prospectos.slice()
                : filtro === 'Vencidos' ? _prospectos.filter(p => EmbudoCalc.estaVencido(p, hoy))
                : _prospectos.filter(p => p.etapa === filtro);

            const ori = valOf('proFiltroOrigen');
            if (ori) data = data.filter(p => p.origen === ori);

            const q = document.getElementById('searchInput').value.toLowerCase();
            if (q && _currentPage === 'prospectos') {
                data = data.filter(p => [p.nombre, p.empresa, p.correo, p.telefono, p.direccion, p.notas, p.motivo_perdida]
                    .some(f => String(f || '').toLowerCase().includes(q)));
            }

            const orden = valOf('proOrden') || 'valor';
            data.sort((a, b) => {
                if (orden === 'prob') return Number(b.probabilidad || 0) - Number(a.probabilidad || 0);
                if (orden === 'nombre') return String(a.nombre).localeCompare(String(b.nombre), 'es');
                if (orden === 'reciente') return new Date(b.fechaReg || 0) - new Date(a.fechaReg || 0);
                if (orden === 'cierre') return String(a.fecha_cierre_estimada || '9999').localeCompare(String(b.fecha_cierre_estimada || '9999'));
                return Number(b.valorEstimado || 0) - Number(a.valorEstimado || 0);
            });

            const suma = data.reduce((s, p) => s + Number(p.valorEstimado || 0), 0);
            const pond = data.reduce((s, p) => s + Number(p.valorEstimado || 0) * (Number(p.probabilidad || 0) / 100), 0);
            document.getElementById('proFoot').innerHTML =
                `<span><strong>${data.length}</strong> de ${_prospectos.length} prospectos</span>` +
                `<span>Potencial: <strong>Q ${suma.toLocaleString()}</strong></span>` +
                `<span>Ponderado: <strong>Q ${Math.round(pond).toLocaleString()}</strong></span>` +
                (esAdmin() ? '' : '<span style="color:var(--text-muted)">Eliminar requiere rol Admin</span>');

            /* Guardar dataset filtrado, resetear a página 0 y renderizar */
            _proDataPaged = data;
            _proPage = 0;
            _renderProPagedData();
        }

        function filtrarProspectos(filtro, el) {
            el.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
            el.classList.add('active');
            renderProspectos(filtro);
        }

        function exportarProspectos() {
            const filas = _prospectos.map(p => ({
                ID: p.id, Nombre: p.nombre, Empresa: p.empresa, Segmento: p.segmento,
                Correo: p.correo, Telefono: p.telefono, Direccion: p.direccion,
                Origen: p.origen, Etapa: p.etapa, ValorEstimado: p.valorEstimado,
                Probabilidad: p.probabilidad, CierreEstimado: p.fecha_cierre_estimada || '', FechaCierre: p.cerrado_en ? fechaCorta(p.cerrado_en) : '',
                MotivoPerdida: p.motivo_perdida || '', DetalleMotivo: p.motivo_perdida_detalle || '', Notas: p.notas, FechaRegistro: fechaCorta(p.fechaReg)
            }));
            descargarCSV(filas, 'prospectos');
        }

        /* ═══════════════════════════════════════════════════════
           MODAL – PROSPECTOS
        ═══════════════════════════════════════════════════════ */
        function _formProspecto(p) {
            p = p || {};
            const opt = (arr, sel) => arr.map(o => `<option${o === sel ? ' selected' : ''}>${o}</option>`).join('');
            return `
    <div class="form-field"><label class="form-label">NOMBRE COMPLETO *</label><input class="form-input" id="pNombre" value="${escAttr(p.nombre)}" placeholder="Ej. Diego Herrera" required/></div>
    <div class="form-row">
      <div class="form-field"><label class="form-label">EMPRESA *</label><input class="form-input" id="pEmpresa" value="${escAttr(p.empresa)}" placeholder="Ej. Herrera & Asociados" required/></div>
      <div class="form-field"><label class="form-label">SEGMENTO</label>
        <select class="form-select" id="pSegmento">${opt(SEGMENTOS, p.segmento || 'Estándar')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-field"><label class="form-label">CORREO</label><input class="form-input" id="pCorreo" type="email" value="${escAttr(p.correo)}" placeholder="correo@empresa.com"/></div>
      <div class="form-field"><label class="form-label">TELÉFONO *</label><input class="form-input" id="pTelefono" value="${escAttr(p.telefono)}" placeholder="+502 0000 0000" required/></div>
    </div>
    <div class="form-field"><label class="form-label">DIRECCIÓN *</label><input class="form-input" id="pDireccion" value="${escAttr(p.direccion)}" placeholder="Zona, calle, referencia" required/></div>
    <div class="form-row">
      <div class="form-field"><label class="form-label">ORIGEN *</label>
        <select class="form-select" id="pOrigen" required>${opt(ORIGENES, p.origen || 'Referido')}</select>
      </div>
      <div class="form-field"><label class="form-label">ETAPA</label>
        <select class="form-select" id="pEtapa" onchange="_onEtapaProspecto()">${opt(ETAPAS, p.etapa || 'Nuevo')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-field"><label class="form-label">VALOR ESTIMADO (Q)</label><input class="form-input" id="pValor" type="number" min="0" value="${p.valorEstimado !== undefined ? p.valorEstimado : ''}" placeholder="0"/></div>
      <div class="form-field"><label class="form-label">PROBABILIDAD (%)</label><input class="form-input" id="pProb" type="number" min="0" max="100" value="${p.probabilidad !== undefined ? p.probabilidad : EmbudoCalc.probSugerida(p.etapa || 'Nuevo')}"/></div>
    </div>
    <div class="form-field" id="pCierreWrap"><label class="form-label">FECHA DE CIERRE ESTIMADA</label><input class="form-input" id="pCierre" type="date" value="${escAttr(p.fecha_cierre_estimada || '')}"/>
      <div class="cell-sub" style="margin-top:4px">Se usa para el pronóstico mensual del embudo.</div></div>
    <div id="pMotivoWrap" ${p.etapa === 'Perdido' ? '' : 'hidden'}>
      <div class="form-field"><label class="form-label">MOTIVO DE PÉRDIDA *</label>
        <select class="form-select" id="pMotivo"><option value="">Seleccione…</option>${opt(EmbudoCalc.MOTIVOS_PERDIDA.concat(p.motivo_perdida && EmbudoCalc.MOTIVOS_PERDIDA.indexOf(p.motivo_perdida) < 0 ? [p.motivo_perdida] : []), p.motivo_perdida || '')}</select>
      </div>
      <div class="form-field"><label class="form-label">DETALLE</label><input class="form-input" id="pMotivoDet" maxlength="500" value="${escAttr(p.motivo_perdida_detalle || '')}" placeholder="Ej. eligió a otro proveedor 10% más barato"/></div>
    </div>
    <div class="form-field"><label class="form-label">NOTAS</label><textarea class="form-textarea" id="pNotas" placeholder="Contexto, próximos pasos, objeciones…">${escHtml(p.notas)}</textarea></div>
  `;
        }

        /* Al cambiar de etapa: sugiere la probabilidad de esa etapa y muestra el motivo si es «Perdido».
           En etapas cerradas la probabilidad la fija el servidor (100 / 0). */
        function _onEtapaProspecto() {
            const prob = EmbudoCalc.probSugerida(v('pEtapa'));
            if (prob !== null) document.getElementById('pProb').value = prob;
            _syncEtapaForm();
        }
        function _syncEtapaForm() {
            const etapa = v('pEtapa'), cerrada = etapa === 'Ganado' || etapa === 'Perdido';
            const prob = document.getElementById('pProb'); if (prob) prob.disabled = cerrada;
            const w = document.getElementById('pCierreWrap'); if (w) w.hidden = cerrada;
            const m = document.getElementById('pMotivoWrap'); if (m) m.hidden = etapa !== 'Perdido';
        }

        function newProspecto() {
            _modalMode = {type: 'prospecto', action: 'add', id: null};
            openModal('Nuevo prospecto', _formProspecto({}));
            _syncEtapaForm();
        }

        function editProspecto(id) {
            const p = _prospectos.find(x => String(x.id) === String(id));
            if (!p) return;
            _modalMode = {type: 'prospecto', action: 'edit', id};
            openModal('Editar prospecto', _formProspecto(p));
            _syncEtapaForm();
        }

        function confirmDeleteProspecto(id, nombre) {
            if (!esAdmin()) {showToast('Solo un administrador puede eliminar registros', '#FF9F0A'); return;}
            _modalMode = {type: 'prospecto', action: 'delete', id};
            openModal('Eliminar prospecto', `<div style="text-align:center;padding:10px 0">
    <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none;margin-bottom:12px;display:block;margin-inline:auto"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar prospecto?</div>
    <div style="font-size:13px;color:var(--text-secondary)">Se eliminará <strong>${escHtml(nombre)}</strong> permanentemente.<br>Esta acción no se puede deshacer.</div>
  </div>`);
            document.getElementById('modalSaveBtn').textContent = 'Eliminar';
            document.getElementById('modalSaveBtn').style.background = 'var(--danger)';
        }

        function confirmConvertir(id) {
            const p = _prospectos.find(x => String(x.id) === String(id));
            if (!p) return;
            _modalMode = {type: 'prospecto', action: 'convert', id};
            const opt = (arr, sel) => arr.map(o => `<option${o === sel ? ' selected' : ''}>${o}</option>`).join('');
            openModal('Convertir en cliente', `
    <div class="convert-summary">
      <div class="mini-avatar" style="background:${p.color || '#30D158'};width:38px;height:38px;font-size:13px">${initials(p.nombre)}</div>
      <div>
        <div class="cell-main">${escHtml(p.nombre)}</div>
        <div class="cell-sub">${escHtml(p.empresa) || 'Sin empresa'} · ${escHtml(p.origen)}</div>
      </div>
    </div>
    <div class="notes-box" style="margin-bottom:16px">
      Se creará el cliente con su correo, teléfono y dirección. El prospecto queda como
      <strong>Ganado</strong> en el embudo (cuenta para el pronóstico y la tasa de cierre).
    </div>
    <div class="form-row">
      <div class="form-field"><label class="form-label">SEGMENTO</label>
        <select class="form-select" id="cvSegmento">${opt(SEGMENTOS, p.segmento || 'Estándar')}</select>
      </div>
      <div class="form-field"><label class="form-label">ESTADO INICIAL</label>
        <select class="form-select" id="cvEstado">${opt(['Activo', 'Pendiente'], 'Activo')}</select>
      </div>
    </div>
    <div class="form-field"><label class="form-label">VALOR GANADO (Q)</label><input class="form-input" id="cvValor" type="number" min="0" value="${Number(p.valorEstimado || 0)}"/></div>
  `);
            document.getElementById('modalSaveBtn').textContent = 'Convertir';
            document.getElementById('modalSaveBtn').style.background = 'var(--success)';
        }

