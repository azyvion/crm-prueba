/* ═══════════════════════════════════════════════════════
   inventario.js — Módulo Inventario + Categorías + Catálogos
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

/* Dependencias globales:
   _inventario, _categorias, _filtroInvActual, _currentPage,
   _modalMode, _currentOrgId, openModal, closeModal, showToast,
   escHtml, escAttr, tagCat, tagEstadoInv, v, _onApiError,
   window.api, window._sb, cotLlenarSelectItems, renderOvStock
*/

        function loadInventario() {
            window.api
                .withSuccessHandler(function (r) {
                    if (!r.ok) { showToast('Error inventario: ' + (r.error || 'sin datos'), '#FF453A'); return; }
                    _inventario = r.data || [];
                    _renderInvFilterTabs();
                    renderInventario(_filtroInvActual);
                    renderOvStock();
                    cotLlenarSelectItems();
                })
                .withFailureHandler(function (err) { _onApiError('inventario', err); })
                .getInventario();
        }

        /* ═══════════════════════════════════════════════════════
           RENDER – INVENTARIO
        ═══════════════════════════════════════════════════════ */
        function renderInventario(filtro) {
            _filtroInvActual = filtro;
            let data = _inventario;
            if (filtro === 'Crítico')        data = data.filter(i => i.estado === 'Crítico');
            else if (filtro === 'Productos') data = data.filter(i => i.tipo !== 'Servicio');
            else if (filtro === 'Servicios') data = data.filter(i => i.tipo === 'Servicio');
            else if (filtro !== 'Todos')     data = data.filter(i => i.categoria === filtro);

            const q = document.getElementById('searchInput').value.toLowerCase();
            if (q && _currentPage === 'inventario') {
                data = data.filter(i =>
                    String(i.producto || '').toLowerCase().includes(q) ||
                    String(i.categoria || '').toLowerCase().includes(q) ||
                    String(i.sku || '').toLowerCase().includes(q));
            }

            document.getElementById('inventarioTbody').innerHTML = data.length
                ? data.map(i => {
                    const esServicio = i.tipo === 'Servicio';
                    const pct = esServicio ? 0 : Math.round(Number(i.unidades) / Math.max(Number(i.stockMax), 1) * 100);
                    const cls = i.estado === 'Crítico' ? 'low' : i.estado === 'Bajo' ? 'mid' : '';
                    const inactivo = (i.activo === false || String(i.activo).toLowerCase() === 'false')
                        ? ' <span class="tag tag-gray">Inactivo</span>' : '';
                    const disp = esServicio
                        ? '<span style="color:var(--text-muted)">No aplica</span>'
                        : `<div class="progress-wrap"><div class="progress-bar"><div class="progress-fill ${cls}" style="width:${Math.max(pct, 1)}%"></div></div><span class="progress-val">${pct}%</span></div>`;
                    return `<tr>
          <td><div class="cell-main">${escHtml(i.producto)}${inactivo}</div>${_invCellSub(i)}</td>
          <td><span class="tag ${esServicio ? 'tag-servicio' : 'tag-producto'}">${esServicio ? 'Servicio' : 'Producto'}</span></td>
          <td>${tagCat(i.categoria)}</td>
          <td>${esServicio ? '—' : i.unidades}</td>
          <td>${disp}</td>
          <td>Q ${Number(i.precioUnit).toLocaleString()}</td>
          <td>${esServicio ? '<span class="tag tag-servicio">Servicio</span>' : tagEstadoInv(i.estado)}</td>
          <td style="display:flex;gap:6px">
            <button class="section-action" onclick="editInv('${i.id}')">Editar</button>
            <button class="btn-danger-sm" onclick="confirmDeleteInv('${i.id}','${escAttr(i.producto)}')">Eliminar</button>
          </td>
        </tr>`;
                }).join('')
                : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">Sin resultados</td></tr>';
        }

        function _renderInvFilterTabs() {
            const container = document.getElementById('invFilterTabs');
            if (!container) return;
            const cats = _getCategoriasInv().filter(c => c !== 'Otro' || _inventario.some(i => i.categoria === 'Otro'));
            const base = ['Todos', 'Productos', 'Servicios'];
            const extra = cats.filter(c => !['Otro'].includes(c) || _inventario.some(i => i.categoria === c));
            const allFilters = [...base, ...extra.filter(c => c !== 'Otros' && c !== 'Otro' || _inventario.some(i => i.categoria === c)), 'Crítico'];
            // Keep unique
            const seen = new Set();
            const unique = allFilters.filter(f => { if (seen.has(f)) return false; seen.add(f); return true; });
            container.innerHTML = unique.map(f =>
                `<button class="filter-tab${f === _filtroInvActual ? ' active' : ''}" onclick="filtrarInv('${f}',this)">${f}</button>`
            ).join('');
        }

        function filtrarInv(filtro, el) {
            if (el) {
                el.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
                el.classList.add('active');
            }
            renderInventario(filtro);
        }

        /* ═══════════════════════════════════════════════════════
           CATEGORÍAS DE INVENTARIO
        ═══════════════════════════════════════════════════════ */
        function loadCategorias() {
            window.api
                .withSuccessHandler(function(r) {
                    if (!r.ok) { showToast('Error cargando categorías: ' + (r.error || ''), '#FF453A'); return; }
                    _categorias = r.data || [];
                    renderCategorias();
                })
                .withFailureHandler(function(err) { _onApiError('categorias', err); })
                .getCategorias();
        }

        function renderCategorias() {
            const tbody = document.getElementById('categoriasTbody');
            if (!tbody) return;
            if (!_categorias.length) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">No hay categorías aún. Crea una para organizar tu inventario.</td></tr>';
                return;
            }
            tbody.innerHTML = _categorias.map(c => {
                const usadas = _inventario.filter(i => i.categoria === c.nombre).length;
                const estado = c.activa !== false
                    ? '<span class="tag tag-success">Activa</span>'
                    : '<span class="tag tag-gray">Inactiva</span>';
                const dot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escAttr(c.color||'#8E8E93')};margin-right:6px;vertical-align:middle"></span>`;
                return `<tr>
                    <td><div style="display:flex;align-items:center">${dot}<strong>${escHtml(c.nombre)}</strong></div></td>
                    <td style="color:var(--text-secondary)">${escHtml(c.descripcion||'—')}</td>
                    <td style="text-align:center">${usadas}</td>
                    <td>${estado}</td>
                    <td style="text-align:right">
                        <button class="btn-icon" title="Editar" onclick="editCategoria('${escAttr(c.id)}')">
                            <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button class="btn-icon btn-danger-icon" title="Eliminar" onclick="deleteCategoria('${escAttr(c.id)}','${escAttr(c.nombre)}')">
                            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                    </td>
                </tr>`;
            }).join('');
        }

        function newCategoria() {
            openModal('Nueva categoría', _formCategoria({}));
            _modalMode = {type: 'categoria', action: 'add', id: null};
        }

        function editCategoria(id) {
            const c = _categorias.find(x => x.id === id);
            if (!c) return;
            openModal('Editar categoría', _formCategoria(c));
            _modalMode = {type: 'categoria', action: 'edit', id};
        }

        function deleteCategoria(id, nombre) {
            if (!confirm('¿Eliminar la categoría "' + nombre + '"?\nSolo se puede eliminar si no tiene productos asignados.')) return;
            window.api
                .withSuccessHandler(function(r) {
                    if (r.ok) { showToast('Categoría eliminada', '#FF453A'); loadCategorias(); }
                    else showToast('No se puede eliminar: ' + r.error, '#FF9F0A');
                })
                .withFailureHandler(function(err) { showToast('Error: ' + err, '#FF453A'); })
                .deleteCategoria(id);
        }

        function _formCategoria(c) {
            const activa = c.activa === undefined ? true : c.activa !== false;
            const color = c.color || '#8E8E93';
            const colores = ['#0A84FF','#30D158','#FF9F0A','#BF5AF2','#FF453A','#5e5ce6','#32ADE6','#8E8E93'];
            const swatches = colores.map(col =>
                `<span onclick="_selColor(this,'${col}')" style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${col};cursor:pointer;border:2.5px solid ${col===color?'var(--text)':'transparent'};margin:2px" data-color="${col}"></span>`
            ).join('');
            return `
            <div class="form-field"><label class="form-label">NOMBRE *</label>
              <input class="form-input" id="mCatNombre" value="${escAttr(c.nombre||'')}" placeholder="Ej. Equipos, Servicios, Accesorios…"/></div>
            <div class="form-field"><label class="form-label">DESCRIPCIÓN</label>
              <input class="form-input" id="mCatDesc" value="${escAttr(c.descripcion||'')}" placeholder="Opcional"/></div>
            <div class="form-field"><label class="form-label">COLOR</label>
              <div style="display:flex;gap:2px;flex-wrap:wrap;margin-bottom:4px" id="mCatSwatches">${swatches}</div>
              <input type="hidden" id="mCatColor" value="${escAttr(color)}"/>
            </div>
            <div class="switch-field">
              <div><div class="sf-txt">Activa</div><div class="sf-sub">Las categorías inactivas no aparecen al crear productos.</div></div>
              <label class="switch${activa?' on':''}"><input type="checkbox" id="mCatActiva" ${activa?'checked':''} onchange="this.closest('label').classList.toggle('on',this.checked)"/><span class="knob"></span></label>
            </div>`;
        }

        function _selColor(el, color) {
            document.getElementById('mCatColor').value = color;
            el.closest('#mCatSwatches').querySelectorAll('span').forEach(s => s.style.borderColor = 'transparent');
            el.style.borderColor = 'var(--text)';
        }

        /* ═══════════════════════════════════════════════════════
           MODAL – INVENTARIO
        ═══════════════════════════════════════════════════════ */
        // Categorías dinámicas: se derivan del inventario existente + 'Otro' siempre presente
        function _getCategoriasInv() {
            // Lee de _categorias (tabla CategoriasInventario). Si aún vacío, fallback con categorías en inventario existente.
            if (_categorias && _categorias.length > 0) {
                const activas = _categorias.filter(c => c.activa !== false).map(c => c.nombre);
                if (!activas.includes('Otro')) activas.push('Otro');
                return activas.sort((a, b) => a === 'Otro' ? 1 : b === 'Otro' ? -1 : a.localeCompare(b, 'es'));
            }
            const cats = new Set(_inventario.map(i => i.categoria).filter(Boolean));
            cats.add('Otro');
            return Array.from(cats).sort((a, b) => a === 'Otro' ? 1 : b === 'Otro' ? -1 : a.localeCompare(b, 'es'));
        }

        function _formInventario(i) {
            i = i || {};
            const esServicio = i.tipo === 'Servicio';
            const cat = i.categoria || 'Otro';
            return `
    ${_invFormEmpresa(i)}
    <div class="switch-field">
      <div>
        <div class="sf-txt">Es un servicio</div>
        <div class="sf-sub">Actívalo para servicios (sin control de stock). Desactivado = producto.</div>
      </div>
      <label class="switch${esServicio ? ' on' : ''}" id="mServSwitch">
        <input type="checkbox" id="mEsServicio" ${esServicio ? 'checked' : ''} onchange="toggleServicioCampos()"/>
        <span class="knob"></span>
      </label>
    </div>
    <div class="form-field"><label class="form-label" id="mProdLabel">${esServicio ? 'NOMBRE DEL SERVICIO *' : 'NOMBRE DEL PRODUCTO *'}</label>
      <input class="form-input" id="mProd" value="${escAttr(i.producto || '')}" placeholder="Ej. Router Mikrotik RB450G" required/></div>
    <div class="form-field"><label class="form-label">CÓDIGO / SKU</label>
      <input class="form-input" id="mSku" value="${escAttr(i.sku || '')}" placeholder="Opcional"/></div>
    ${_invFormClasificacion(i)}
    <div class="form-field"><label class="form-label">CATEGORÍA</label>
      <select class="form-select" id="mCatSel" onchange="_syncCatInput(this)" style="margin-bottom:6px">
        ${_getCategoriasInv().map(c => `<option value="${c}"${c === cat ? ' selected' : ''}>${c}</option>`).join('')}
        ${cat && !_getCategoriasInv().includes(cat) ? `<option value="${escAttr(cat)}" selected>${escAttr(cat)}</option>` : ''}
        <option value="__nueva__">+ Nueva categoría…</option>
      </select>
      <input class="form-input" id="mCat" value="${escAttr(cat)}" placeholder="Escribe el nombre de la nueva categoría…"
        style="display:${(cat && !_getCategoriasInv().includes(cat)) ? 'block' : 'none'}" />
    </div>
    <div class="form-field"><label class="form-label">DESCRIPCIÓN (APARECE EN LA COTIZACIÓN)</label>
      <textarea class="form-input" id="mDesc" rows="2" style="resize:vertical" placeholder="Opcional">${escHtml(i.descripcion || '')}</textarea></div>
    <div class="form-field"><label class="form-label">UNIDAD DE MEDIDA</label>
      <input class="form-input" id="mUnidad" value="${escAttr(i.unidad || (esServicio ? 'Servicio' : 'Unidad'))}" placeholder="Unidad, Hora, Metro, Licencia…"/></div>
    <div id="mStockWrap" style="${esServicio ? 'display:none' : ''}">
      <div class="form-field"><label class="form-label">UNIDADES EN STOCK</label>
        <input class="form-input" id="mUnid" type="number" min="0" value="${i.unidades !== undefined ? i.unidades : 0}"/></div>
      <div class="form-field"><label class="form-label">STOCK MÁXIMO</label>
        <input class="form-input" id="mStockMax" type="number" min="1" value="${i.stockMax || 50}"/></div>
    </div>
    <div class="cat-section-title" style="margin-top:14px;font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);font-weight:600">Listas de Precios (Q)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
      <div class="form-field"><label class="form-label">PRECIO PÚBLICO *</label>
        <input class="form-input" id="mPrecio" type="number" min="0" step="0.01" value="${i.precioUnit !== undefined ? i.precioUnit : 0}" required/></div>
      <div class="form-field"><label class="form-label">PRECIO PLATA</label>
        <input class="form-input" id="mPrecioPlata" type="number" min="0" step="0.01" value="${i.precioPlata !== undefined && i.precioPlata !== null ? i.precioPlata : ''}" placeholder="Opcional"/></div>
      <div class="form-field"><label class="form-label">PRECIO ORO</label>
        <input class="form-input" id="mPrecioOro" type="number" min="0" step="0.01" value="${i.precioOro !== undefined && i.precioOro !== null ? i.precioOro : ''}" placeholder="Opcional"/></div>
    </div>
    <label class="cot-check" style="margin-top:4px">
      <input type="checkbox" id="mActivo" ${(i.activo === false || String(i.activo).toLowerCase() === 'false') ? '' : 'checked'}/>
      Disponible para cotizar y POS
    </label>
  `;
        }

        function toggleServicioCampos() {
            const chk = document.getElementById('mEsServicio');
            if (!chk) return;
            const on = chk.checked;
            const sw = document.getElementById('mServSwitch');
            if (sw) sw.classList.toggle('on', on);
            const wrap = document.getElementById('mStockWrap');
            if (wrap) wrap.style.display = on ? 'none' : '';
            const lbl = document.getElementById('mProdLabel');
            if (lbl) lbl.textContent = on ? 'NOMBRE DEL SERVICIO *' : 'NOMBRE DEL PRODUCTO *';
            const u = document.getElementById('mUnidad');
            if (u && (u.value === 'Unidad' || u.value === 'Servicio' || !u.value.trim())) u.value = on ? 'Servicio' : 'Unidad';
        }

        function _syncCatInput(sel) {
            const input = document.getElementById('mCat');
            if (!input) return;
            if (sel.value === '__nueva__') {
                input.style.display = 'block';
                input.value = '';
                input.focus();
            } else {
                input.style.display = 'none';
                input.value = sel.value; // keep in sync so modalSave can read it
            }
        }

        function newInv() {
            _modalMode = {type: 'inventario', action: 'add', id: null};
            openModal('Nuevo ítem de inventario', _formInventario({}));
        }

        function editInv(id) {
            const i = _inventario.find(x => String(x.id) === String(id));
            if (!i) return;
            _modalMode = {type: 'inventario', action: 'edit', id};
            openModal(i.tipo === 'Servicio' ? 'Editar servicio' : 'Editar producto', _formInventario(i));
        }

        function confirmDeleteInv(id, nombre) {
            _modalMode = {type: 'inventario', action: 'delete', id};
            openModal('Eliminar ítem', `<div style="text-align:center;padding:10px 0">
    <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none;margin-bottom:12px;display:block;margin-inline:auto"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar producto?</div>
    <div style="font-size:13px;color:var(--text-secondary)">Se eliminará <strong>${escHtml(nombre)}</strong> del inventario.<br>Esta acción no se puede deshacer.</div>
  </div>`);
            document.getElementById('modalSaveBtn').textContent = 'Eliminar';
            document.getElementById('modalSaveBtn').style.background = 'var(--danger)';
        }

/* ═══════════════════════════════════════════════════════
   CATÁLOGOS DE INVENTARIO
   Marca · Línea · Familia · Unidad de negocio · Tipo de producto
   Todo se lee/escribe directo en Supabase; RLS aísla por empresa
   (empresa principal y contratadas). El super admin ve todas.
═══════════════════════════════════════════════════════ */
const CATALOGOS = {
    marcas:   {tabla:'MarcasInventario',   page:'catalogo-marcas',   campo:'marca_id',          fid:'mMarca',      singular:'marca',              plural:'Marcas',              un:'una marca',              nueva:'Nueva marca',              editar:'Editar marca',              creado:'Marca creada',              actualizado:'Marca actualizada',              eliminado:'Marca eliminada',              ejemplo:'Ej. Mikrotik, Ubiquiti, Cisco…'},
    lineas:   {tabla:'LineasInventario',   page:'catalogo-lineas',   campo:'linea_id',          fid:'mLinea',      singular:'línea',              plural:'Líneas',              un:'una línea',              nueva:'Nueva línea',              editar:'Editar línea',              creado:'Línea creada',              actualizado:'Línea actualizada',              eliminado:'Línea eliminada',              ejemplo:'Ej. Networking, Videovigilancia, Energía…'},
    familias: {tabla:'FamiliasInventario', page:'catalogo-familias', campo:'familia_id',        fid:'mFamilia',    singular:'familia',            plural:'Familias',            un:'una familia',            nueva:'Nueva familia',            editar:'Editar familia',            creado:'Familia creada',            actualizado:'Familia actualizada',            eliminado:'Familia eliminada',            ejemplo:'Ej. Routers, Antenas, Cámaras…'},
    unidades: {tabla:'UnidadesNegocio',    page:'catalogo-unidades', campo:'unidad_negocio_id', fid:'mUnidadNeg',  singular:'unidad de negocio',  plural:'Unidades de negocio', un:'una unidad de negocio',  nueva:'Nueva unidad de negocio',  editar:'Editar unidad de negocio',  creado:'Unidad de negocio creada',  actualizado:'Unidad de negocio actualizada',  eliminado:'Unidad de negocio eliminada',  ejemplo:'Ej. Redes, Software, Consultoría…'},
    tipos:    {tabla:'TiposProducto',      page:'catalogo-tipos',    campo:'tipo_producto_id',  fid:'mTipoProd',   singular:'tipo de producto',   plural:'Tipos de producto',   un:'un tipo de producto',    nueva:'Nuevo tipo de producto',   editar:'Editar tipo de producto',   creado:'Tipo de producto creado',   actualizado:'Tipo de producto actualizado',   eliminado:'Tipo de producto eliminado',   ejemplo:'Ej. Equipo, Licencia, Accesorio…'}
};
const CATALOGO_POR_PAGE = {};
Object.keys(CATALOGOS).forEach(k => { CATALOGO_POR_PAGE[CATALOGOS[k].page] = k; });

let _catData = {marcas: [], lineas: [], familias: [], unidades: [], tipos: []};
let _catEmpresas = [];
let _catEsSA = false;
let _catEmpFiltro = '';

function catEmpresaNombre(id) { const e = _catEmpresas.find(x => x.id === id); return e ? e.nombre : (id || ''); }
function catNombre(key, id) { if (!id) return ''; const c = (_catData[key] || []).find(x => x.id === id); return c ? c.nombre : ''; }

async function catInit() {
    try { const r = await window._sb.rpc('is_super_admin'); _catEsSA = r.data === true; } catch (e) { _catEsSA = false; }
    if (_catEsSA) {
        try {
            const r = await window._sb.from('sub_empresas').select('id,nombre,estado').order('nombre');
            _catEmpresas = r.data || [];
        } catch (e) { _catEmpresas = []; }
    }
    catRenderFiltros();
    await loadCatalogos();
}

async function loadCatalogos() {
    const keys = Object.keys(CATALOGOS);
    const res = await Promise.all(keys.map(k => window._sb.from(CATALOGOS[k].tabla).select('*').order('nombre')));
    res.forEach((r, idx) => {
        if (r.error) { console.warn('[Azyvion] catálogo', keys[idx], r.error.message); return; }
        _catData[keys[idx]] = r.data || [];
    });
    keys.forEach(renderCatalogo);
    if (typeof renderInventario === 'function') renderInventario(_filtroInvActual);
}

/* ── Filtro de empresa (solo super admin) ── */
function catEmpresasOrdenadas() {
    return _catEmpresas.slice().sort((a, b) => (a.estado === 'INTERNAL' ? -1 : 0) - (b.estado === 'INTERNAL' ? -1 : 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
}
function catRenderFiltros() {
    Object.keys(CATALOGOS).forEach(k => {
        const el = document.getElementById('cat-filtro-' + k);
        if (!el) return;
        if (!_catEsSA) { el.style.display = 'none'; el.innerHTML = ''; return; }
        el.style.display = '';
        el.innerHTML = '<select class="form-select cat-filtro-sel" onchange="catFiltrarEmpresa(this.value)">' +
            '<option value="">Todas las empresas</option>' +
            catEmpresasOrdenadas().map(e => `<option value="${escAttr(e.id)}"${e.id === _catEmpFiltro ? ' selected' : ''}>${escHtml(e.nombre)}</option>`).join('') +
            '</select>';
    });
}
function catFiltrarEmpresa(val) {
    _catEmpFiltro = val || '';
    catRenderFiltros();
    Object.keys(CATALOGOS).forEach(renderCatalogo);
}

/* ── Render de cada catálogo ── */
function renderCatalogo(key) {
    const cfg = CATALOGOS[key];
    const tbody = document.getElementById('cat-tbody-' + key);
    if (!tbody) return;
    let rows = _catData[key] || [];
    if (_catEsSA && _catEmpFiltro) rows = rows.filter(r => r.organization_id === _catEmpFiltro);

    const th = document.getElementById('cat-th-emp-' + key);
    if (th) th.style.display = _catEsSA ? '' : 'none';
    const cnt = document.getElementById('cat-count-' + key);
    if (cnt) cnt.textContent = rows.length + (rows.length === 1 ? ' registro' : ' registros');

    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6"><div class="cat-empty">
            <div class="cat-empty-ico"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg></div>
            <div class="cat-empty-t">Aún no hay ${escHtml(cfg.plural.toLowerCase())}</div>
            <div class="cat-empty-s">Crea ${escHtml(cfg.un)} para poder asignarla${key === 'tipos' ? '' : ''} a tus productos.<br>${escHtml(cfg.ejemplo)}</div>
            <button class="topbar-btn" onclick="nuevoCatalogo('${key}')" style="height:34px;font-size:12.5px">${escHtml(cfg.nueva)}</button>
        </div></td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(c => {
        const usados = (_inventario || []).filter(i => i[cfg.campo] === c.id).length;
        const estado = c.activa !== false ? '<span class="tag tag-success">Activa</span>' : '<span class="tag tag-gray">Inactiva</span>';
        const ini = escHtml(String(c.nombre || '?').trim().charAt(0).toUpperCase());
        return `<tr>
            <td><div class="cat-row-name"><span class="cat-badge">${ini}</span><strong>${escHtml(c.nombre)}</strong></div></td>
            <td style="color:var(--text-secondary)">${escHtml(c.descripcion || '—')}</td>
            <td style="text-align:center">${usados}</td>
            <td style="${_catEsSA ? '' : 'display:none'}"><span class="tag tag-gray">${escHtml(catEmpresaNombre(c.organization_id))}</span></td>
            <td>${estado}</td>
            <td style="text-align:right;white-space:nowrap">
                <button class="btn-icon" title="Editar" onclick="editarCatalogo('${key}','${escAttr(c.id)}')">
                    <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-icon btn-danger-icon" title="Eliminar" onclick="confirmarEliminarCatalogo('${key}','${escAttr(c.id)}')">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
            </td>
        </tr>`;
    }).join('');
}

/* ── Formulario / modal de catálogo ── */
function _catEmpresaOpts(selected) {
    const list = catEmpresasOrdenadas();
    const sel = selected || (list[0] && list[0].id);
    return list.map(e => `<option value="${escAttr(e.id)}"${e.id === sel ? ' selected' : ''}>${escHtml(e.nombre)}${e.estado === 'INTERNAL' ? ' (principal)' : ''}</option>`).join('');
}

function _formCatalogo(key, c) {
    c = c || {};
    const cfg = CATALOGOS[key];
    const activa = c.activa === undefined ? true : c.activa !== false;
    let emp = '';
    if (_catEsSA) {
        emp = c.id
            ? `<div class="form-field"><label class="form-label">EMPRESA</label><div class="cat-readonly">${escHtml(catEmpresaNombre(c.organization_id))}</div></div>`
            : `<div class="form-field"><label class="form-label">EMPRESA *</label><select class="form-select" id="mCgEmpresa">${_catEmpresaOpts(_catEmpFiltro)}</select></div>`;
    }
    return emp + `
    <div class="form-field"><label class="form-label">NOMBRE *</label>
      <input class="form-input" id="mCgNombre" value="${escAttr(c.nombre || '')}" placeholder="${escAttr(cfg.ejemplo)}" maxlength="80"/></div>
    <div class="form-field"><label class="form-label">DESCRIPCIÓN</label>
      <input class="form-input" id="mCgDesc" value="${escAttr(c.descripcion || '')}" placeholder="Opcional"/></div>
    <div class="switch-field">
      <div><div class="sf-txt">Activa</div><div class="sf-sub">Los registros inactivos no aparecen al crear productos.</div></div>
      <label class="switch${activa ? ' on' : ''}"><input type="checkbox" id="mCgActiva" ${activa ? 'checked' : ''} onchange="this.closest('label').classList.toggle('on',this.checked)"/><span class="knob"></span></label>
    </div>`;
}

function nuevoCatalogo(key) {
    _modalMode = {type: 'catalogo', key, action: 'add', id: null};
    openModal(CATALOGOS[key].nueva, _formCatalogo(key, {}));
    setTimeout(() => { const el = document.getElementById('mCgNombre'); if (el) el.focus(); }, 60);
}
function editarCatalogo(key, id) {
    const c = (_catData[key] || []).find(x => x.id === id);
    if (!c) return;
    _modalMode = {type: 'catalogo', key, action: 'edit', id};
    openModal(CATALOGOS[key].editar, _formCatalogo(key, c));
}
function confirmarEliminarCatalogo(key, id) {
    const cfg = CATALOGOS[key];
    const c = (_catData[key] || []).find(x => x.id === id);
    if (!c) return;
    const usados = (_inventario || []).filter(i => i[cfg.campo] === id).length;
    _modalMode = {type: 'catalogo', key, action: 'delete', id};
    openModal('Eliminar ' + cfg.singular, `<div style="text-align:center;padding:10px 0">
    <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;fill:none;margin-bottom:12px;display:block;margin-inline:auto"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar ${escHtml(cfg.singular)}?</div>
    <div style="font-size:13px;color:var(--text-secondary)">Se eliminará <strong>${escHtml(c.nombre)}</strong>.${usados ? `<br>Está asignada a <strong>${usados}</strong> ítem${usados === 1 ? '' : 's'} del inventario, que quedarán sin ${escHtml(cfg.singular)}.` : ''}<br>Esta acción no se puede deshacer.</div>
  </div>`);
    const b = document.getElementById('modalSaveBtn');
    b.textContent = 'Eliminar'; b.style.background = 'var(--danger)';
}

/* Llamado desde modalSave(); devuelve true si maneja el modal */
function _handleModalSaveCatalogo(m, btn) {
    if (!m || m.type !== 'catalogo') return false;
    const cfg = CATALOGOS[m.key];
    const reset = () => { btn.disabled = false; btn.textContent = m.action === 'delete' ? 'Eliminar' : 'Guardar'; };
    (async () => {
        try {
            if (m.action === 'delete') {
                const r = await window._sb.from(cfg.tabla).delete().eq('id', m.id);
                if (r.error) throw r.error;
                closeModal(); showToast(cfg.eliminado, '#FF453A');
            } else {
                const nombre = v('mCgNombre').trim();
                if (!nombre) { reset(); showToast('El nombre es requerido', '#FF9F0A'); return; }
                const row = {nombre, descripcion: v('mCgDesc').trim(), activa: !!(document.getElementById('mCgActiva') || {}).checked};
                if (m.action === 'add') {
                    const org = _catEsSA ? v('mCgEmpresa') : _currentOrgId;
                    if (!org) { reset(); showToast('Selecciona la empresa', '#FF9F0A'); return; }
                    row.organization_id = org;
                    const r = await window._sb.from(cfg.tabla).insert(row);
                    if (r.error) throw r.error;
                    closeModal(); showToast(cfg.creado, '#30D158');
                } else {
                    const r = await window._sb.from(cfg.tabla).update(row).eq('id', m.id);
                    if (r.error) throw r.error;
                    closeModal(); showToast(cfg.actualizado, '#30D158');
                }
            }
            btn.disabled = false; btn.textContent = 'Guardar';
            await loadCatalogos();
        } catch (e) {
            reset();
            showToast(e && e.code === '23505' ? 'Ya existe ' + cfg.un + ' con ese nombre en esta empresa' : 'Error: ' + (e && e.message || e), '#FF453A');
        }
    })();
    return true;
}

/* ── Formulario de ítem: empresa + clasificación (desde la BD) ── */
function _invEmpresaActual(i) {
    if (i && i.organization_id) return i.organization_id;
    if (_catEsSA) { const l = catEmpresasOrdenadas(); return _catEmpFiltro || (l[0] && l[0].id) || ''; }
    return _currentOrgId;
}
function _catOpts(key, orgId, sel) {
    const list = (_catData[key] || []).filter(c => c.organization_id === orgId && (c.activa !== false || c.id === sel));
    return '<option value="">— Sin asignar —</option>' + list.map(c =>
        `<option value="${escAttr(c.id)}"${c.id === sel ? ' selected' : ''}>${escHtml(c.nombre)}${c.activa === false ? ' (inactiva)' : ''}</option>`).join('');
}
function _invHint(org) {
    const vac = Object.keys(CATALOGOS).filter(k => !(_catData[k] || []).some(c => c.organization_id === org && c.activa !== false));
    if (!vac.length) return '';
    return '<div class="cat-hint">Aún sin registros de: ' + vac.map(k =>
        `<a onclick="closeModal();showPage('${CATALOGOS[k].page}',document.getElementById('nav-inventario'))">${escHtml(CATALOGOS[k].plural.toLowerCase())}</a>`).join(', ') +
        '. Créalos desde el submenú de Inventario.</div>';
}
function _invFormEmpresa(i) {
    if (!_catEsSA) return '';
    i = i || {};
    if (i.id) return `<div class="form-field"><label class="form-label">EMPRESA</label><div class="cat-readonly">${escHtml(catEmpresaNombre(i.organization_id))}</div></div>`;
    return `<div class="form-field"><label class="form-label">EMPRESA *</label>
      <select class="form-select" id="mInvEmpresa" onchange="_invEmpresaChange(this)">${_catEmpresaOpts(_invEmpresaActual(i))}</select></div>`;
}
function _invFormClasificacion(i) {
    i = i || {};
    const org = _invEmpresaActual(i);
    const labels = {marcas: 'MARCA', lineas: 'LÍNEA', familias: 'FAMILIA', unidades: 'UNIDAD DE NEGOCIO', tipos: 'TIPO DE PRODUCTO'};
    const campo = (k, extra) => `<div class="form-field"${extra ? ' style="' + extra + '"' : ''}>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <label class="form-label" style="margin-bottom:0">${labels[k]}</label>
            <button type="button" onclick="nuevoCatalogoRapido('${k}')" style="font-size:11px;color:var(--accent);background:none;border:none;cursor:pointer;padding:0;font-weight:600">+ Nuevo</button>
        </div>
        <select class="form-select" id="${CATALOGOS[k].fid}">${_catOpts(k, org, i[CATALOGOS[k].campo])}</select>
    </div>`;
    return `<div class="cat-section-title" style="margin-top:14px;font-size:11.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted);font-weight:600">Clasificación Integral</div>
    <div class="form-grid-2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">${campo('tipos')}${campo('unidades')}${campo('marcas')}${campo('lineas')}${campo('familias', 'grid-column:1/-1')}</div>
    <div id="mClasHint">${_invHint(org)}</div>`;
}

window.nuevoCatalogoRapido = async function(key) {
    const cfg = CATALOGOS[key];
    const nombre = prompt('Ingresa el nombre para ' + cfg.un + ':');
    if (!nombre || !nombre.trim()) return;
    const org = _catEsSA ? (v('mInvEmpresa') || _currentOrgId) : _currentOrgId;
    try {
        const {data, error} = await window._sb.from(cfg.tabla).insert({
            nombre: nombre.trim(),
            activa: true,
            organization_id: org
        }).select().single();
        if (error) throw error;
        showToast(cfg.creado, '#30D158');
        await loadCatalogos();
        const sel = document.getElementById(cfg.fid);
        if (sel) {
            sel.innerHTML = _catOpts(key, org, data.id);
            sel.value = data.id;
        }
    } catch (e) {
        showToast('Error: ' + (e.message || e), '#FF453A');
    }
};
function _invEmpresaChange(sel) {
    const org = sel.value;
    Object.keys(CATALOGOS).forEach(k => {
        const el = document.getElementById(CATALOGOS[k].fid);
        if (el) el.innerHTML = _catOpts(k, org, '');
    });
    const h = document.getElementById('mClasHint');
    if (h) h.innerHTML = _invHint(org);
}

/* ── Sub-línea en la tabla de inventario ── */
function _invCellSub(i) {
    const l1 = [];
    if (i.sku) l1.push('SKU: ' + escHtml(i.sku));
    ['marcas', 'lineas', 'familias'].forEach(k => { const n = catNombre(k, i[CATALOGOS[k].campo]); if (n) l1.push(escHtml(n)); });
    const chips = [];
    const tp = catNombre('tipos', i.tipo_producto_id); if (tp) chips.push('<span class="cat-chip">' + escHtml(tp) + '</span>');
    const un = catNombre('unidades', i.unidad_negocio_id); if (un) chips.push('<span class="cat-chip cat-chip-alt">' + escHtml(un) + '</span>');
    if (_catEsSA && i.organization_id) chips.push('<span class="tag tag-gray" style="font-size:10px;padding:2px 7px">' + escHtml(catEmpresaNombre(i.organization_id)) + '</span>');
    return (l1.length ? `<div class="cell-sub">${l1.join(' · ')}</div>` : '') + (chips.length ? `<div class="cat-chips">${chips.join('')}</div>` : '');
}

/* ── Arranque: espera a que la sesión esté restaurada ── */
(async function catBoot() {
    for (let n = 0; n < 60; n++) {
        try {
            const r = await window._sb.auth.getSession();
            if (r && r.data && r.data.session) { await catInit(); return; }
        } catch (e) {}
        await new Promise(res => setTimeout(res, 500));
    }
})();
