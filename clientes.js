/* ═══════════════════════════════════════════════════════════════════
   clientes.js — Módulo CRM B2B Profesional · Azyvion v6.0
   Reemplaza al clientes.js anterior (v5.x)

   ARQUITECTURA:
   · No toca window.api ni el backend GAS existente
   · valorTotal es READ-ONLY (calculado desde cotizaciones en backend)
   · Empresa ≠ Persona: nombre = nombre comercial, empresa = razón social
   · Segmentos y estados desacoplados del HTML vía constantes configurables
   · KPIs ampliados calculados en memoria desde _clientes + _cotizaciones
   · Soft-delete: el modal de eliminar propone "Archivar" como alternativa
   · Auditoría ligera vía addActividadCRM con categoría 'sistema'
   · Paginación existente (_renderCliPagedData) preservada sin cambios

   DEPENDENCIAS (ya definidas en dashboard.html antes de cargar este script):
     window.api, _clientes, _cotizaciones, _prospectos,
     _filtroCliActual, _cliDataPaged, _cliPage, _modalMode,
     escHtml, escAttr, initials, fechaCorta, valOf, showToast,
     openModal, closeModal, esAdmin, _currentOrgId, _usuario,
     tagSegmento, tagEstado, loadClientes, loadResumen,
     recargarFicha, _currentPage, _renderCliPagedData
═══════════════════════════════════════════════════════════════════ */

/* ─── CONFIGURACIÓN CENTRALIZADA ──────────────────────────────────
   Editar aquí en lugar de buscar y reemplazar en el HTML.
   En el futuro puede venir de una llamada API (getConfigCRM).
─────────────────────────────────────────────────────────────────── */
const CRM_CONFIG = {
    segmentos: ['Estándar', 'Premium', 'Corporativo', 'Enterprise', 'Gobierno'],
    estados:   ['Activo', 'Pendiente', 'Inactivo', 'Archivado'],
    fuentes:   ['Referido', 'Sitio web', 'Llamada fría', 'Evento', 'Redes sociales', 'Partner', 'Otro'],
    paises:    ['Guatemala', 'México', 'El Salvador', 'Honduras', 'Nicaragua', 'Costa Rica', 'Panamá',
                'Colombia', 'Estados Unidos', 'España', 'Otro'],
    tiposActividad: ['Llamada', 'Correo', 'Reunión', 'WhatsApp', 'Visita', 'Nota', 'Seguimiento', 'Sistema'],
    // Número de días sin actividad para marcar cliente "en riesgo"
    diasRiesgo: 60,
    // Número de días sin actividad para marcar cliente "sin actividad"
    diasSinActividad: 30,
};

/* ─── HELPERS DE TAGS (reemplazan las funciones globales hardcoded) ─
   Usan los mismos nombres que el código existente para no romper
   las referencias en ficha.js, overview.js, etc.
─────────────────────────────────────────────────────────────────── */

/* Si tagSegmento ya está definida globalmente (utils.js) no la redefinimos */
if (typeof window.tagSegmento !== 'function') {
    window.tagSegmento = function tagSegmento(s) {
        const map = {
            'Premium':     'tag-warning',
            'Corporativo': 'tag-purple',
            'Enterprise':  'tag-accent',
            'Gobierno':    'tag-accent',
            'Estándar':    'tag-gray',
        };
        return `<span class="tag ${map[s] || 'tag-gray'}">${escHtml(s || 'Estándar')}</span>`;
    };
}

if (typeof window.tagEstado !== 'function') {
    window.tagEstado = function tagEstado(e) {
        const map = {
            'Activo':    'tag-success',
            'Pendiente': 'tag-warning',
            'Inactivo':  'tag-danger',
            'Archivado': 'tag-gray',
        };
        return `<span class="tag ${map[e] || 'tag-gray'}">${escHtml(e || '—')}</span>`;
    };
}

/* ─── KPIs AMPLIADOS ──────────────────────────────────────────────
   Se calculan desde los arrays globales que ya están en memoria.
   No requieren nuevas llamadas al backend.
─────────────────────────────────────────────────────────────────── */
function _calcCliKpis() {
    const hoy = Date.now();
    const diasMs = d => d * 86400000;

    /* Valor ganado por cliente: suma de cotizaciones Aprobadas */
    const cotPorCliente = {};
    const cotizaciones = (typeof _cotizaciones !== 'undefined' ? _cotizaciones : []);
    cotizaciones.forEach(c => {
        if (c.estado === 'Aprobada' && c.cliente_id) {
            cotPorCliente[c.cliente_id] = (cotPorCliente[c.cliente_id] || 0) + Number(c.total || 0);
        }
    });

    let total = 0, activos = 0, pendientes = 0, inactivos = 0, archivados = 0;
    let valorGanado = 0, enRiesgo = 0, sinActividad = 0, nuevosEste30 = 0;
    const hace30 = hoy - diasMs(30);
    const haceDiasRiesgo = hoy - diasMs(CRM_CONFIG.diasRiesgo);
    const haceDiasSinAct = hoy - diasMs(CRM_CONFIG.diasSinActividad);

    _clientes.forEach(c => {
        total++;
        const est = (c.estado || '').toLowerCase();
        if (est === 'activo')    activos++;
        if (est === 'pendiente') pendientes++;
        if (est === 'inactivo')  inactivos++;
        if (est === 'archivado') archivados++;

        /* Valor ganado */
        const vg = cotPorCliente[c.id] || Number(c.valorTotal || 0);
        valorGanado += vg;

        /* Clientes nuevos en últimos 30 días */
        const fechaReg = c.fechaReg ? new Date(c.fechaReg).getTime() : 0;
        if (fechaReg > hace30) nuevosEste30++;

        /* En riesgo: activos sin actividad en X días */
        const ultimaAct = c.ultimaActividad ? new Date(c.ultimaActividad).getTime() : fechaReg;
        if (est === 'activo') {
            if (ultimaAct < haceDiasRiesgo) enRiesgo++;
            else if (ultimaAct < haceDiasSinAct) sinActividad++;
        }
    });

    const valorPromedio = total > 0 ? Math.round(valorGanado / total) : 0;
    const ticketPromedio = activos > 0 ? Math.round(valorGanado / activos) : 0;

    return {
        total, activos, pendientes, inactivos, archivados,
        valorGanado, valorPromedio, ticketPromedio,
        enRiesgo, sinActividad, nuevosEste30,
    };
}

/* ─── RENDER KPIs MÓDULO CLIENTES ────────────────────────────────
   Actualiza los 4 KPIs originales + los 4 nuevos.
   Los IDs originales (cli-total, cli-activos, cli-pend, cli-valor)
   se preservan. Los nuevos se agregan en el HTML por el patch.
─────────────────────────────────────────────────────────────────── */
function _renderCliKpis() {
    const k = _calcCliKpis();
    const _st = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    const _sh = (id, v) => { const e = document.getElementById(id); if (e) e.innerHTML  = v; };

    /* KPIs originales — no cambian de posición */
    _st('cli-total',    k.total);
    _st('cli-total-d',  k.nuevosEste30 + ' nuevos este mes');
    _st('cli-activos',  k.activos);
    _st('cli-activos-d',Math.round(k.activos / Math.max(k.total, 1) * 100) + '% del total');
    _st('cli-pend',     k.pendientes);
    _st('cli-pend-d',   'En revisión');
    _st('cli-valor',    'Q ' + k.valorPromedio.toLocaleString());

    /* KPIs adicionales (IDs nuevos — se renderizan si existen en el DOM) */
    _st('cli-inactivos',  k.inactivos);
    _st('cli-en-riesgo',  k.enRiesgo);
    _st('cli-sin-act',    k.sinActividad);
    _st('cli-valor-total','Q ' + k.valorGanado.toLocaleString());
    _st('cli-ticket',     'Q ' + k.ticketPromedio.toLocaleString());
    _st('cli-archivados', k.archivados);
}

/* ─── RENDER OVERVIEW (top clientes en panel de inicio) ──────────
   Reutiliza renderOvTopClientes si existe; de lo contrario, es
   la función interna que reemplaza el antiguo renderOvClientes.
─────────────────────────────────────────────────────────────────── */
function renderOvClientes() {
    /* Top por valor */
    if (typeof renderOvTopClientes === 'function') renderOvTopClientes();

    const rows = _clientes
        .filter(c => (c.estado || 'Activo') !== 'Archivado')
        .slice(0, 4);

    const el = document.getElementById('ovClientesTbody');
    if (!el) return;

    el.innerHTML = rows.length
        ? rows.map(c => {
            const valorGanado = _getValorGanado(c);
            return `<tr>
              <td>
                <div class="client-name">
                  <div class="mini-avatar" style="background:${c.color || _colorFromStr(c.nombre)}">${initials(c.nombre)}</div>
                  <div>
                    <div class="cell-main">${escHtml(c.nombre)}</div>
                    ${c.empresa ? `<div class="cell-sub">${escHtml(c.empresa)}</div>` : ''}
                  </div>
                </div>
              </td>
              <td>${tagSegmento(c.segmento)}</td>
              <td>${tagEstado(c.estado)}</td>
              <td class="cell-num">Q ${valorGanado.toLocaleString()}</td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:20px">Sin clientes</td></tr>';
}

/* Obtiene el valor ganado de un cliente (desde cotizaciones o campo valorTotal) */
function _getValorGanado(c) {
    const cots = (typeof _cotizaciones !== 'undefined' ? _cotizaciones : []);
    const fromCot = cots
        .filter(q => q.estado === 'Aprobada' && (q.cliente_id === c.id || q.cliente_id === String(c.id)))
        .reduce((s, q) => s + Number(q.total || 0), 0);
    return fromCot > 0 ? fromCot : Number(c.valorTotal || 0);
}

/* Color determinista desde string (para clientes sin color asignado) */
function _colorFromStr(str) {
    const colors = ['#3B6EF5','#8B5CF6','#22C55E','#F59E0B','#EF4444','#14B8A6','#F97316','#06B6D4'];
    let h = 0;
    for (let i = 0; i < (str || '').length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
    return colors[Math.abs(h) % colors.length];
}

/* ─── CARGA DE CLIENTES ───────────────────────────────────────── */
function loadClientes() {
    window.api
        .withSuccessHandler(function (r) {
            if (!r.ok) {
                showToast('Error clientes: ' + (r.error || 'sin datos'), '#FF453A');
                return;
            }
            _clientes = r.data || [];
            renderClientes(_filtroCliActual);
            renderOvClientes();
            cotLlenarSelectClientes();
            _renderCliKpis();
        })
        .withFailureHandler(function (err) { _onApiError('clientes', err); })
        .getClientes();
}

/* ─── RENDER LISTA CLIENTES (lógica de filtrado mejorada) ─────── */
function renderClientes(filtro) {
    _filtroCliActual = filtro;

    let data = _clientes.slice();

    /* Filtro de estado por tab */
    if (filtro && filtro !== 'Todos') {
        data = data.filter(c => (c.estado || '') === filtro);
    }

    /* Si filtro es 'Todos' ocultamos archivados por defecto (UX limpia) */
    if (filtro === 'Todos') {
        const mostrarArchivados = _cliMostrarArchivados || false;
        if (!mostrarArchivados) {
            data = data.filter(c => (c.estado || '') !== 'Archivado');
        }
    }

    /* Filtro por segmento */
    const seg = valOf('cliFiltroSeg');
    if (seg) data = data.filter(c => c.segmento === seg);

    /* Filtro por fuente/origen */
    const fuente = valOf('cliFiltroFuente');
    if (fuente) data = data.filter(c => c.fuente === fuente);

    /* Búsqueda de texto libre */
    const q = (document.getElementById('searchInput') || {}).value || '';
    const qLow = q.toLowerCase();
    if (qLow && _currentPage === 'clientes') {
        data = data.filter(c =>
            [c.nombre, c.empresa, c.razonSocial, c.nit, c.correo, c.telefono, c.ciudad, c.pais, c.ejecutivo]
                .some(f => String(f || '').toLowerCase().includes(qLow))
        );
    }

    /* Ordenamiento */
    const orden = valOf('cliOrden') || 'nombre';
    data.sort((a, b) => {
        if (orden === 'valor')    return _getValorGanado(b) - _getValorGanado(a);
        if (orden === 'reciente') return new Date(b.fechaReg || 0) - new Date(a.fechaReg || 0);
        if (orden === 'riesgo')   return _scoredRiesgo(b) - _scoredRiesgo(a);
        return String(a.nombre).localeCompare(String(b.nombre), 'es');
    });

    /* Pie de tabla */
    const suma = data.reduce((s, c) => s + _getValorGanado(c), 0);
    const admin = esAdmin();
    const footEl = document.getElementById('cliFoot');
    if (footEl) {
        footEl.innerHTML =
            `<span><strong>${data.length}</strong> de ${_clientes.length} clientes</span>` +
            `<span>Valor ganado: <strong>Q ${suma.toLocaleString()}</strong></span>` +
            (!admin ? '<span style="color:var(--text-muted)">Eliminar requiere rol Admin</span>' : '') +
            `<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:var(--text-muted)">
               <input type="checkbox" id="cliToggleArchivados" ${_cliMostrarArchivados ? 'checked' : ''}
                 onchange="_cliMostrarArchivados=this.checked; renderClientes(_filtroCliActual);">
               Mostrar archivados
             </label>`;
    }

    /* Paginación */
    _cliDataPaged = data;
    _cliPage = 0;
    _renderCliPagedData();

    /* Actualizar KPIs */
    _renderCliKpis();
}

/* Puntúa el nivel de riesgo de un cliente (mayor = más riesgo) */
function _scoredRiesgo(c) {
    const est = (c.estado || '').toLowerCase();
    if (est !== 'activo') return 0;
    const hoy = Date.now();
    const ultimaAct = c.ultimaActividad ? new Date(c.ultimaActividad).getTime()
                    : c.fechaReg ? new Date(c.fechaReg).getTime() : 0;
    return hoy - ultimaAct; // ms desde última actividad
}

let _cliMostrarArchivados = false;

/* ─── EXPORTAR ────────────────────────────────────────────────── */
function exportarClientes() {
    const filas = _clientes.map(c => ({
        ID:              c.id,
        NombreComercial: c.nombre,
        RazonSocial:     c.empresa    || c.razonSocial || '',
        NIT:             c.nit        || '',
        Segmento:        c.segmento,
        Fuente:          c.fuente     || '',
        Correo:          c.correo,
        Telefono:        c.telefono,
        Ciudad:          c.ciudad     || '',
        Pais:            c.pais       || '',
        SitioWeb:        c.sitioWeb   || '',
        Ejecutivo:       c.ejecutivo  || '',
        CreadoPor:       c.creadoPor  || '',
        Estado:          c.estado,
        ValorGanado:     _getValorGanado(c),
        UltimaActividad: c.ultimaActividad || '',
        FechaRegistro:   fechaCorta(c.fechaReg),
    }));
    descargarCSV(filas, 'clientes');
}

/* ─── FILTRAR POR TAB ─────────────────────────────────────────── */
function filtrarClientes(filtro, el) {
    el.closest('.filter-tabs').querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    renderClientes(filtro);
}

/* ═══════════════════════════════════════════════════════════════
   MODAL — NUEVO / EDITAR CLIENTE (B2B)

   CAMBIOS vs versión anterior:
   · valorTotal ya NO es editable — el campo queda eliminado del form
   · nombre = nombre comercial de la empresa (no persona)
   · empresa = razón social (nuevo campo diferenciado)
   · Nuevos campos: NIT, fuente, ejecutivo, ciudad, país, sitio web
   · Validación: correo OR teléfono obligatorio (al menos uno)
   · segmentos y estados desde CRM_CONFIG (no hardcodeados)
═══════════════════════════════════════════════════════════════ */

function _formSelectOpts(arr, valorActual) {
    return arr.map(v => `<option value="${escAttr(v)}"${v === valorActual ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
}

function _htmlFormCliente(c = {}) {
    const segs   = _formSelectOpts(CRM_CONFIG.segmentos, c.segmento || 'Estándar');
    const ests   = _formSelectOpts(CRM_CONFIG.estados.filter(e => e !== 'Archivado'), c.estado || 'Activo');
    const fuents = `<option value="">— Sin especificar —</option>` + _formSelectOpts(CRM_CONFIG.fuentes, c.fuente || '');
    const paises = `<option value="">— Sin especificar —</option>` + _formSelectOpts(CRM_CONFIG.paises, c.pais || 'Guatemala');

    return `
<div class="crm-form-grid">

  <div class="crm-form-section">Identificación de la empresa</div>

  <div class="form-field">
    <label class="form-label">NOMBRE COMERCIAL *</label>
    <input class="form-input" id="mNombre" value="${escAttr(c.nombre || '')}" placeholder="Ej. Tecnologías ABC" required autocomplete="organization"/>
    <div class="form-hint">Nombre con el que se conoce la empresa en el mercado.</div>
  </div>

  <div class="form-row">
    <div class="form-field">
      <label class="form-label">RAZÓN SOCIAL</label>
      <input class="form-input" id="mEmpresa" value="${escAttr(c.empresa || c.razonSocial || '')}" placeholder="Ej. ABC Tecnologías, S.A."/>
    </div>
    <div class="form-field">
      <label class="form-label">NIT</label>
      <input class="form-input" id="mNit" value="${escAttr(c.nit || '')}" placeholder="Ej. 1234567-8"/>
    </div>
  </div>

  <div class="crm-form-section">Contacto</div>
  <div class="form-hint" style="margin:-4px 0 8px">Al menos uno es obligatorio: correo o teléfono.</div>

  <div class="form-row">
    <div class="form-field">
      <label class="form-label">CORREO GENERAL</label>
      <input class="form-input" id="mCorreo" type="email" value="${escAttr(c.correo || '')}" placeholder="info@empresa.com"/>
    </div>
    <div class="form-field">
      <label class="form-label">TELÉFONO GENERAL</label>
      <input class="form-input" id="mTelefono" value="${escAttr(c.telefono || '')}" placeholder="+502 0000-0000"/>
    </div>
  </div>

  <div class="form-field">
    <label class="form-label">SITIO WEB</label>
    <input class="form-input" id="mSitioWeb" type="url" value="${escAttr(c.sitioWeb || '')}" placeholder="https://empresa.com"/>
  </div>

  <div class="crm-form-section">Ubicación</div>

  <div class="form-row">
    <div class="form-field">
      <label class="form-label">DIRECCIÓN</label>
      <input class="form-input" id="mDireccion" value="${escAttr(c.direccion || '')}" placeholder="Zona, calle, referencia"/>
    </div>
    <div class="form-field">
      <label class="form-label">CIUDAD</label>
      <input class="form-input" id="mCiudad" value="${escAttr(c.ciudad || '')}" placeholder="Ciudad de Guatemala"/>
    </div>
  </div>

  <div class="form-field" style="max-width:260px">
    <label class="form-label">PAÍS</label>
    <select class="form-select" id="mPais">${paises}</select>
  </div>

  <div class="crm-form-section">Clasificación CRM</div>

  <div class="form-row">
    <div class="form-field">
      <label class="form-label">SEGMENTO</label>
      <select class="form-select" id="mSegmento">${segs}</select>
    </div>
    <div class="form-field">
      <label class="form-label">ESTADO</label>
      <select class="form-select" id="mEstado">${ests}</select>
    </div>
  </div>

  <div class="form-row">
    <div class="form-field">
      <label class="form-label">FUENTE / ORIGEN</label>
      <select class="form-select" id="mFuente">${fuents}</select>
    </div>
    <div class="form-field">
      <label class="form-label">EJECUTIVO ASIGNADO</label>
      <input class="form-input" id="mEjecutivo" value="${escAttr(c.ejecutivo || '')}" placeholder="Nombre del ejecutivo"/>
    </div>
  </div>

  <div class="form-field">
    <label class="form-label">LISTA DE PRECIOS FACTURACIÓN / POS</label>
    <select class="form-select" id="mListaPrecio">
      <option value="Publico" ${(c.lista_precio==='Publico'||!c.lista_precio)?'selected':''}>Precio Público (Base)</option>
      <option value="Plata" ${c.lista_precio==='Plata'?'selected':''}>Precio Plata (Preferencial)</option>
      <option value="Oro" ${c.lista_precio==='Oro'?'selected':''}>Precio Oro (VIP / Distribuidor)</option>
    </select>
    <div class="form-hint">Tarifa que se aplicará automáticamente en Cotizaciones y ventas del Punto de Venta (POS).</div>
  </div>

  <div class="crm-form-note">
    <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
    El <strong>valor del cliente</strong> se calcula automáticamente desde cotizaciones aprobadas
    y no puede editarse manualmente.
  </div>

</div>`;
}

function newCliente() {
    _modalMode = {type: 'cliente', action: 'add', id: null};
    openModal('Nuevo cliente', _htmlFormCliente());
}

function editCliente(id) {
    const c = _clientes.find(x => String(x.id) === String(id));
    if (!c) return;
    // VENDEDOR: solo puede editar sus propios clientes
    if (typeof esVendedor === 'function' && esVendedor()) {
        const sess = (function(){ try { return JSON.parse(localStorage.getItem('azyvion_session')||'null'); } catch(e){ return null; } })();
        const me = sess ? (sess.usuario || sess.nombre || '') : '';
        if (c.creadoPor && c.creadoPor !== me) {
            showToast('Solo puedes editar los clientes que tú creaste', '#FF9F0A');
            return;
        }
    }
    _modalMode = {type: 'cliente', action: 'edit', id};
    openModal('Editar cliente — ' + escHtml(c.nombre), _htmlFormCliente(c));
}

/* ─── ARCHIVAR (soft-delete alternativo) ─────────────────────── */
function archivarCliente(id, nombre) {
    if (!esAdmin()) {
        showToast('Solo un administrador puede archivar clientes', '#FF9F0A');
        return;
    }
    _modalMode = {type: 'cliente', action: 'edit', id};
    /* Usamos el flujo edit normal pero con estado=Archivado */
    const c = _clientes.find(x => String(x.id) === String(id)) || {};
    const dataArchivado = Object.assign({}, c, {estado: 'Archivado'});

    const saveBtn = {disabled: false, textContent: ''};
    window.api
        .withSuccessHandler(res => {
            if (res.ok) {
                showToast(`"${nombre}" archivado`, '#FF9F0A');
                _registrarAuditoriaCliente(id, nombre, 'Archivar', 'estado', c.estado || 'Activo', 'Archivado');
                loadClientes();
                loadResumen();
            } else {
                showToast('Error: ' + res.error, '#FF453A');
            }
        })
        .withFailureHandler(err => showToast('Error: ' + err.message, '#FF453A'))
        .updateCliente(id, {estado: 'Archivado'});
}

/* ─── ELIMINAR CLIENTE (con advertencia de datos relacionados) ── */
function confirmDeleteCliente(id, nombre) {
    if (!esAdmin()) {
        showToast('Solo un administrador puede eliminar registros', '#FF9F0A');
        return;
    }

    /* Contar datos relacionados */
    const cots = (typeof _cotizaciones !== 'undefined' ? _cotizaciones : []);
    const cotCount = cots.filter(q => String(q.cliente_id) === String(id)).length;
    const proCount = (typeof _prospectos !== 'undefined' ? _prospectos : [])
        .filter(p => String(p.cliente_id) === String(id)).length;

    const tieneRelaciones = cotCount > 0 || proCount > 0;

    _modalMode = {type: 'cliente', action: 'delete', id};

    openModal('Eliminar cliente', `
<div style="text-align:center;padding:12px 0">
  <svg viewBox="0 0 24 24" style="width:44px;height:44px;stroke:var(--danger);stroke-width:1.5;
    stroke-linecap:round;stroke-linejoin:round;fill:none;margin-bottom:12px;display:block;margin-inline:auto">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  </svg>
  <div style="font-size:15px;font-weight:600;margin-bottom:6px">¿Eliminar a <em>${escHtml(nombre)}</em>?</div>
  <div style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">
    Esta acción <strong>no se puede deshacer</strong>.
  </div>

  ${tieneRelaciones ? `
  <div class="crm-alert crm-alert-warning" style="text-align:left;margin-bottom:14px">
    <svg viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
    <div>
      <strong>Este cliente tiene datos relacionados:</strong>
      <ul style="margin:4px 0 0 16px;font-size:12px">
        ${cotCount > 0 ? `<li>${cotCount} cotización(es)</li>` : ''}
        ${proCount > 0 ? `<li>${proCount} prospecto(s) vinculado(s)</li>` : ''}
      </ul>
      <div style="margin-top:8px">
        Se recomienda <strong>archivar</strong> en lugar de eliminar para preservar el historial.
      </div>
    </div>
  </div>
  <div style="display:flex;gap:8px;justify-content:center;margin-bottom:6px">
    <button class="topbar-btn" onclick="closeModal();archivarCliente('${id}','${escAttr(nombre)}')"
      style="background:linear-gradient(135deg,#F59E0B,#D97706)">
      <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M21 8v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><polyline points="1 3 23 3"/><path d="M10 12l2 2 2-2"/></svg>
      Archivar en su lugar
    </button>
  </div>
  ` : ''}

  <div style="font-size:12px;color:var(--text-muted)">
    Si decides continuar, se eliminará permanentemente.
  </div>
</div>`);

    const btn = document.getElementById('modalSaveBtn');
    if (btn) {
        btn.textContent = 'Eliminar definitivamente';
        btn.style.background = 'var(--danger)';
    }
}

/* ─── AUDITORÍA LIGERA ────────────────────────────────────────── */
function _registrarAuditoriaCliente(id, nombre, accion, campo, valorAnterior, valorNuevo) {
    try {
        const desc = `[${accion}] ${campo}: "${valorAnterior}" → "${valorNuevo}"`;
        window.api
            .withSuccessHandler(function() {})
            .withFailureHandler(function() {})
            .addActividadCRM({
                tipo:        'Cliente',
                refId:       id,
                categoria:   'Sistema',
                titulo:      accion + ' — ' + nombre,
                descripcion: desc,
                fecha:       new Date().toISOString().slice(0, 10),
            });
    } catch(e) {
        console.warn('[Azyvion] auditoría fallida:', e);
    }
}

/* ─── LÓGICA DE GUARDADO (reemplaza la sección 'cliente' en modalSave) ──

   Estructura de datos enviada al backend (addCliente / updateCliente):
   {
     nombre:      string   — nombre comercial (obligatorio)
     empresa:     string   — razón social
     nit:         string
     segmento:    string
     correo:      string   \
     telefono:    string    > al menos uno
     sitioWeb:    string
     direccion:   string
     ciudad:      string
     pais:        string
     fuente:      string
     ejecutivo:   string
     estado:      string
     // valorTotal → NO incluido. El backend lo calcula.
   }

   NOTA: esta función debe ser llamada DESDE modalSave() en el HTML.
   La firma es idéntica a la original para no romper la cadena:
     if (m.type === 'cliente') { _handleModalSaveCliente(m, saveBtn); return; }
   O simplemente el modalSave existente ya cubre el caso 'cliente' con
   el flujo de addCliente/updateCliente — lo único que cambia es el
   payload de datos (sin valorTotal, con campos nuevos).
─────────────────────────────────────────────────────────────────── */

/**
 * Construye el payload del cliente desde el formulario modal.
 * Retorna null si hay errores de validación (ya muestra toast).
 */
function _clientePayloadFromForm(saveBtn) {
    const restore = () => {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
    };

    const nombre = (document.getElementById('mNombre') || {}).value?.trim() || '';
    if (!nombre) {
        restore();
        showToast('El nombre comercial es obligatorio', '#FF9F0A');
        return null;
    }

    const correo   = (document.getElementById('mCorreo')   || {}).value?.trim() || '';
    const telefono = (document.getElementById('mTelefono') || {}).value?.trim() || '';

    if (!correo && !telefono) {
        restore();
        showToast('Ingresa al menos un medio de contacto: correo o teléfono', '#FF9F0A');
        return null;
    }

    if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        restore();
        showToast('El correo no tiene un formato válido', '#FF9F0A');
        return null;
    }

    const v = id => (document.getElementById(id) || {}).value || '';

    return {
        nombre,
        empresa:   v('mEmpresa'),
        nit:       v('mNit'),
        segmento:  v('mSegmento'),
        lista_precio: v('mListaPrecio') || 'Publico',
        correo,
        telefono,
        sitioWeb:  v('mSitioWeb'),
        direccion: v('mDireccion'),
        ciudad:    v('mCiudad'),
        pais:      v('mPais'),
        fuente:    v('mFuente'),
        ejecutivo: v('mEjecutivo'),
        estado:    v('mEstado'),
        /* valorTotal intencionalmente OMITIDO */
    };
}

/* ─── TABLA CLIENTES: RENDER FILA ────────────────────────────── */

/**
 * Renderiza una fila de la tabla de clientes.
 * Se inyecta en _renderCliPagedData (que permanece en dashboard.html)
 * a través de la función _cliRowHtml que ahora se redefine aquí.
 *
 * NOTA: si _renderCliPagedData ya genera las filas inline, este helper
 * no es necesario. Se expone para posible uso futuro.
 */
function _cliRowHtml(c) {
    const valorGanado = _getValorGanado(c);
    const color       = c.color || _colorFromStr(c.nombre);
    const hoy         = Date.now();
    const ultimaAct   = c.ultimaActividad ? new Date(c.ultimaActividad).getTime() : 0;
    const diasInact   = ultimaAct > 0 ? Math.round((hoy - ultimaAct) / 86400000) : null;
    const enRiesgo    = diasInact !== null && diasInact > CRM_CONFIG.diasRiesgo && (c.estado || '') === 'Activo';

    /* Sub-línea de contacto */
    const contacto = [c.correo, c.telefono].filter(Boolean).join(' · ');

    /* Etiqueta de riesgo */
    const riesgoTag = enRiesgo
        ? `<span class="tag tag-danger" style="margin-left:4px;font-size:10px">En riesgo</span>`
        : '';

    /* Etiqueta de lista de precios */
    const lpMap = {
        'Publico': '<span class="tag tag-gray" style="font-size:10px" title="Tarifa Público">Público</span>',
        'Plata': '<span class="tag" style="background:#e0e7ff;color:#3730a3;border:1px solid #c7d2fe;font-size:10px" title="Tarifa Plata">Plata</span>',
        'Oro': '<span class="tag" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:10px" title="Tarifa Oro">Oro</span>'
    };
    const lpTag = lpMap[c.lista_precio || 'Publico'] || lpMap['Publico'];

    return `<tr onclick="abrirFicha('Cliente','${escAttr(c.id)}')" style="cursor:pointer">
      <td>
        <div class="client-name">
          <div class="mini-avatar" style="background:${color}">${initials(c.nombre)}</div>
          <div>
            <div class="cell-main">${escHtml(c.nombre)}${riesgoTag}</div>
            ${c.empresa ? `<div class="cell-sub">${escHtml(c.empresa)}</div>` : ''}
          </div>
        </div>
      </td>
      <td>
        <div class="cell-main cell-clip">${escHtml(contacto || '—')}</div>
        ${c.ciudad || c.pais ? `<div class="cell-sub">${escHtml([c.ciudad, c.pais].filter(Boolean).join(', '))}</div>` : ''}
      </td>
      <td>${escHtml((typeof esVendedor === 'function' && esVendedor()) ? (c.creadoPor || '—') : (c.ejecutivo || '—'))}</td>
      <td><div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">${tagSegmento(c.segmento)} ${lpTag}</div></td>
      <td>${tagEstado(c.estado)}</td>
      <td class="cell-num" style="font-weight:600">Q ${valorGanado.toLocaleString()}</td>
      <td>
        <div class="row-actions" onclick="event.stopPropagation()">
          <button class="section-action" onclick="abrirFicha('Cliente','${escAttr(c.id)}')">Ver</button>
          ${(function() {
              // VENDEDOR: solo puede editar clientes que él mismo creó
              const _isVend = typeof esVendedor === 'function' && esVendedor();
              const _sess = (function(){ try { return JSON.parse(localStorage.getItem('azyvion_session')||'null'); } catch(e){ return null; } })();
              const _me = _sess ? (_sess.usuario || _sess.nombre || '') : '';
              const _esMio = !_isVend || (c.creadoPor === _me);
              if (!_isVend) {
                  return esAdmin()
                    ? `<button class="section-action" onclick="editCliente('${escAttr(c.id)}')">Editar</button><button class="btn-danger-sm" onclick="confirmDeleteCliente('${escAttr(c.id)}','${escAttr(c.nombre)}')">Eliminar</button>`
                    : `<button class="section-action" onclick="editCliente('${escAttr(c.id)}')">Editar</button><button class="section-action" onclick="archivarCliente('${escAttr(c.id)}','${escAttr(c.nombre)}')">Archivar</button>`;
              }
              // Es Vendedor
              return _esMio
                ? `<button class="section-action" onclick="editCliente('${escAttr(c.id)}')">Editar</button>`
                : `<span style="font-size:11px;color:var(--text-muted)">Sin acceso</span>`;
          })()}
        </div>
      </td>
    </tr>`;
}

/* ═══════════════════════════════════════════════════════════════
   PATCH: sobreescribe _renderCliPagedData para usar la nueva
   estructura de columnas (ejecutivo + contacto unificado)
   sin romper la paginación existente.

   La función _renderCliPagedData original espera que el tbody sea
   'clientesTbody'. Aquí la redefinimos completamente para incluir
   las columnas nuevas.
═══════════════════════════════════════════════════════════════ */
window._renderCliPagedData = function() {
    const PAGE = 25;
    const data  = _cliDataPaged || [];
    const page  = _cliPage      || 0;
    const start = page * PAGE;
    const end   = Math.min(start + PAGE, data.length);
    const slice = data.slice(start, end);

    const tbody = document.getElementById('clientesTbody');
    if (!tbody) return;

    tbody.innerHTML = slice.length
        ? slice.map(_cliRowHtml).join('')
        : `<tr><td colspan="7" class="empty-cell">
             ${_filtroCliActual !== 'Todos' || (document.getElementById('searchInput') || {}).value
               ? 'Sin resultados para este filtro.'
               : 'Aún no hay clientes registrados. <button class="section-action" onclick="newCliente()">Crear el primero</button>'}
           </td></tr>`;

    /* Paginación */
    const totalPags = Math.ceil(data.length / PAGE);
    const paginEl   = document.getElementById('cliPagination');
    if (!paginEl) return;

    if (totalPags <= 1) { paginEl.innerHTML = ''; return; }

    let html = `<div class="pagination">`;
    html += `<button class="pag-btn" ${page === 0 ? 'disabled' : ''} onclick="_cliPage--; _renderCliPagedData()">‹ Anterior</button>`;
    for (let i = 0; i < totalPags; i++) {
        if (totalPags > 7 && Math.abs(i - page) > 2 && i !== 0 && i !== totalPags - 1) {
            if (i === 1 || i === totalPags - 2) html += `<span class="pag-ellipsis">…</span>`;
            continue;
        }
        html += `<button class="pag-btn ${i === page ? 'active' : ''}" onclick="_cliPage=${i}; _renderCliPagedData()">${i + 1}</button>`;
    }
    html += `<button class="pag-btn" ${page >= totalPags - 1 ? 'disabled' : ''} onclick="_cliPage++; _renderCliPagedData()">Siguiente ›</button>`;
    html += `</div>`;
    paginEl.innerHTML = html;
};

/* ═══════════════════════════════════════════════════════════════
   PATCH HTML: añade columnas nuevas a la tabla de clientes y
   los KPI cards adicionales, y los filtros extendidos.

   Se ejecuta una sola vez al cargar el script (DOMContentLoaded
   ya pasó porque este script está al final del body).
═══════════════════════════════════════════════════════════════ */
(function _patchClientesDOM() {

    /* ── 1. Cabecera de tabla: añadir columna Ejecutivo ───────── */
    const thead = document.querySelector('#page-clientes table thead tr');
    if (thead) {
        /* Reemplaza columnas con estructura enriquecida; Vendedor ve "Creado por" */
        const esVend = typeof esVendedor === 'function' && esVendedor();
        thead.innerHTML = `
          <th>Cliente</th>
          <th>Contacto / Ubicación</th>
          <th>${esVend ? 'Creado por' : 'Ejecutivo'}</th>
          <th>Segmento</th>
          <th>Estado</th>
          <th class="cell-num">Valor ganado</th>
          <th></th>`;
    }

    /* ── 2. Filtro por Fuente en la toolbar ───────────────────── */
    const toolbar = document.querySelector('#page-clientes .toolbar-right');
    if (toolbar) {
        /* Insertar select de fuente antes del select de segmento (solo si no existe ya en el HTML) */
        const segSel = toolbar.querySelector('#cliFiltroSeg');
        if (segSel) {
            const fuenSelExisting = document.getElementById('cliFiltroFuente');
            if (fuenSelExisting) {
                /* Ya está en el HTML — solo poblar las opciones dinámicas */
                fuenSelExisting.innerHTML = `<option value="">Todos los orígenes</option>` +
                    CRM_CONFIG.fuentes.map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('');
            } else {
                const fuenSel = document.createElement('select');
                fuenSel.className = 'mini-select';
                fuenSel.id = 'cliFiltroFuente';
                fuenSel.setAttribute('onchange', 'renderClientes(_filtroCliActual)');
                fuenSel.innerHTML = `<option value="">Todos los orígenes</option>` +
                    CRM_CONFIG.fuentes.map(f => `<option value="${escHtml(f)}">${escHtml(f)}</option>`).join('');
                toolbar.insertBefore(fuenSel, segSel);
            }
        }

        /* Reemplazar opciones del select de segmento con las de CRM_CONFIG */
        const segEl = toolbar.querySelector('#cliFiltroSeg');
        if (segEl) {
            segEl.innerHTML = `<option value="">Todos los segmentos</option>` +
                CRM_CONFIG.segmentos.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
        }

        /* Agregar opción de orden por riesgo */
        const ordenEl = toolbar.querySelector('#cliOrden');
        if (ordenEl && !ordenEl.querySelector('[value="riesgo"]')) {
            const opt = document.createElement('option');
            opt.value = 'riesgo';
            opt.textContent = 'Ordenar: en riesgo primero';
            ordenEl.appendChild(opt);
        }
    }

    /* ── 3. KPI cards adicionales ─────────────────────────────── */
    const kpiGrid = document.querySelector('#page-clientes .kpi-grid');
    if (kpiGrid) {
        /* Ampliar el grid a 4 columnas en desktop */
        kpiGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(160px, 1fr))';

        /* Tarjeta: Inactivos */
        const cardInact = _mkKpiCard(
            'Inactivos', 'cli-inactivos',
            'danger', 'Sin actividad comercial',
            '<polyline points="6 9 12 15 18 9"/>'
        );
        /* Tarjeta: En riesgo */
        const cardRiesgo = _mkKpiCard(
            'En riesgo', 'cli-en-riesgo',
            'danger',
            `+${CRM_CONFIG.diasRiesgo}d sin actividad`,
            '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
        );
        /* Tarjeta: Valor total ganado */
        const cardValor = _mkKpiCard(
            'Valor ganado', 'cli-valor-total',
            'success', 'De cotizaciones aprobadas',
            '<polyline points="18 15 12 9 6 15"/>'
        );
        /* Tarjeta: Ticket promedio */
        const cardTicket = _mkKpiCard(
            'Ticket promedio', 'cli-ticket',
            'accent', 'Por cliente activo',
            '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
        );

        if (!document.getElementById('cli-inactivos'))  kpiGrid.appendChild(cardInact);
        if (!document.getElementById('cli-en-riesgo'))  kpiGrid.appendChild(cardRiesgo);
        if (!document.getElementById('cli-valor-total')) kpiGrid.appendChild(cardValor);
        if (!document.getElementById('cli-ticket'))      kpiGrid.appendChild(cardTicket);
    }

    /* ── 4. Añadir tab "Archivados" a los filtros de estado ────── */
    const filterTabs = document.querySelector('#page-clientes .filter-tabs');
    if (filterTabs && !filterTabs.querySelector('[data-filtro="Archivado"]')) {
        const btn = document.createElement('button');
        btn.className = 'filter-tab';
        btn.setAttribute('data-filtro', 'Archivado');
        btn.textContent = 'Archivados';
        btn.onclick = function() { filtrarClientes('Archivado', this); };
        filterTabs.appendChild(btn);
    }

})();

/* Helper: crea una kpi-card con IDs dinámicos */
function _mkKpiCard(label, valId, color, sub, svgPath) {
    const colorMap = {
        success: 'var(--success)', danger: 'var(--danger)',
        accent: 'var(--accent)',   warning: 'var(--warning)',
    };
    const deltaClass = { success: 'up', danger: 'down', accent: 'neu', warning: 'neu' }[color] || 'neu';
    const el = document.createElement('div');
    el.className = 'kpi-card';
    el.style.borderTop = `2px solid ${colorMap[color] || 'var(--accent)'}`;
    el.innerHTML = `
      <div class="kpi-label">${label}</div>
      <div class="kpi-value" id="${valId}">—</div>
      <div class="kpi-delta ${deltaClass}">
        <svg viewBox="0 0 24 24">${svgPath}</svg>
        <span>${sub}</span>
      </div>`;
    return el;
}

/* ═══════════════════════════════════════════════════════════════
   CSS ADICIONAL — inyectado una sola vez al cargar el módulo
   Solo estilos propios del módulo clientes (no globales).
═══════════════════════════════════════════════════════════════ */
(function _injectCliCSS() {
    if (document.getElementById('az-clientes-css')) return;
    const s = document.createElement('style');
    s.id = 'az-clientes-css';
    s.textContent = `

/* ── Formulario CRM B2B ─────────────────────────────────── */
.crm-form-grid {
    display: flex;
    flex-direction: column;
    gap: 0;
}
.crm-form-section {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .7px;
    color: var(--text-muted);
    padding: 16px 0 6px;
    border-top: 1px solid var(--border);
    margin-top: 8px;
}
.crm-form-section:first-child {
    border-top: none;
    margin-top: 0;
    padding-top: 4px;
}
.form-hint {
    font-size: 11.5px;
    color: var(--text-muted);
    margin-top: 3px;
}
.crm-form-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: var(--accent-bg);
    border: 1px solid rgba(59,110,245,.2);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    margin-top: 14px;
}
.crm-form-note svg {
    width: 15px; height: 15px;
    stroke: var(--accent); fill: none;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    flex-shrink: 0; margin-top: 1px;
}
.crm-alert {
    display: flex;
    gap: 10px;
    background: var(--warning-bg);
    border: 1px solid rgba(245,158,11,.25);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 12.5px;
    color: var(--text-primary);
}
.crm-alert svg {
    width: 16px; height: 16px;
    stroke: var(--warning); fill: none;
    stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;
    flex-shrink: 0; margin-top: 2px;
}
.crm-alert-warning { background: var(--warning-bg); border-color: rgba(245,158,11,.3); }

/* ── Fila de tabla mejorada ─────────────────────────────── */
#clientesTbody tr { cursor: pointer; transition: background .1s; }
#clientesTbody tr:hover { background: var(--accent-bg) !important; }

.cell-clip {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* ── Tag de riesgo inline ─────────────────────────────── */
.tag-riesgo {
    background: var(--danger-bg);
    color: var(--danger);
    font-size: 9.5px;
    padding: 2px 6px;
    border-radius: 20px;
    font-weight: 700;
    vertical-align: middle;
    margin-left: 4px;
}

/* ── Paginación ───────────────────────────────────────── */
.pagination {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 14px;
    flex-wrap: wrap;
}
.pag-btn {
    height: 30px;
    min-width: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--card);
    color: var(--text-secondary);
    font-size: 12.5px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background .12s, color .12s;
}
.pag-btn:hover:not(:disabled) { background: var(--bg); color: var(--text-primary); }
.pag-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
}
.pag-btn:disabled { opacity: .4; cursor: default; }
.pag-ellipsis { color: var(--text-muted); padding: 0 4px; align-self: center; }

/* ── Pie de tabla toggle ──────────────────────────────── */
.table-foot {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
    padding: 10px 14px;
    font-size: 12.5px;
    color: var(--text-secondary);
    border-top: 1px solid var(--border);
    background: var(--bg);
}
.table-foot input[type="checkbox"] { accent-color: var(--accent); }

/* ── KPI grid responsive extra ─────────────────────────── */
@media (min-width: 768px) {
    #page-clientes .kpi-grid {
        grid-template-columns: repeat(4, 1fr);
    }
}
@media (min-width: 1200px) {
    #page-clientes .kpi-grid {
        grid-template-columns: repeat(8, 1fr);
    }
}

    `;
    document.head.appendChild(s);
})();

/* ─── COMPATIBILIDAD: funciones que el código antiguo puede llamar ─ */

/* renderOvStock permanece en el archivo original (clientes.js v5 lo tenía).
   Si no existe en otro lugar, lo redefinimos aquí para seguridad. */
if (typeof window.renderOvStock !== 'function') {
    window.renderOvStock = function() {
        const criticos = (_inventario || []).filter(i => i.estado === 'Crítico' || i.estado === 'Bajo').slice(0, 4);
        const el = document.getElementById('ovStockTbody');
        if (!el) return;
        el.innerHTML = criticos.length
            ? criticos.map(i => {
                const pct = Math.round(Number(i.unidades) / Math.max(Number(i.stockMax), 1) * 100);
                const cls = i.estado === 'Crítico' ? 'low' : 'mid';
                return `<tr>
                  <td>${escHtml(i.producto)}</td>
                  <td><div class="progress-wrap"><div class="progress-bar"><div class="progress-fill ${cls}" style="width:${Math.max(pct, 2)}%"></div></div><span class="progress-val">${i.unidades}</span></div></td>
                  <td>${tagEstadoInv ? tagEstadoInv(i.estado) : escHtml(i.estado)}</td>
                </tr>`;
            }).join('')
            : '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:20px">✅ Sin stock crítico</td></tr>';
    };
}

/* cotLlenarSelectClientes: ya definida en cotizaciones.js, pero si no
   existe le damos un stub seguro */
if (typeof window.cotLlenarSelectClientes !== 'function') {
    window.cotLlenarSelectClientes = function() {};
}
