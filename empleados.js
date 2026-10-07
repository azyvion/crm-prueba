/* ═══════════════════════════════════════════════════════════════════
   empleados.js — Módulo Empleados · Azyvion CRM (Supabase edition)
   Requiere globales: _sb, escHtml(), showToast(), window._getEffectiveOrgId,
                      window._currentOrgId, window._esSuperAdmin
═══════════════════════════════════════════════════════════════════ */

/* ── HELPERS INTERNOS ─────────────────────────────────────────── */
function _empSb()       { return window._sb; }
function _empOrgId()    {
    return (typeof window._getEffectiveOrgId === 'function' ? window._getEffectiveOrgId() : null) || window._currentOrgId || null;
}
function _empEsc(s)     { return typeof escHtml === 'function' ? escHtml(s) : String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function _empSet(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

/* ── ESTADO DEL MÓDULO ────────────────────────────────────────── */
let _empleados       = [];
let _filtroEmpActual = 'Todos';
let _empPagActual    = 1;
const _EMP_POR_PAG   = 20;

/* ── TAG DE ESTADO ────────────────────────────────────────────── */
function _empTagEstado(e) {
    const map = {
        'Activo':     'tag-success',
        'Inactivo':   'tag-danger',
        'Vacaciones': 'tag-accent',
        'Licencia':   'tag-warning',
        'Baja':       'tag-gray'
    };
    return `<span class="tag ${map[e] || 'tag-gray'}">${_empEsc(e) || '—'}</span>`;
}

/* ── INICIALES AVATAR ─────────────────────────────────────────── */
function _empIniciales(nombre, apellido) {
    return ((nombre||'').charAt(0) + (apellido||'').charAt(0)).toUpperCase() || '?';
}

/* ══════════════════════════════════════════════════════════════
   CARGA DESDE SUPABASE
══════════════════════════════════════════════════════════════ */
async function loadEmpleados() {
    const tbody = document.getElementById('empleadosTbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Cargando empleados…</td></tr>';

    try {
        const orgId = _empOrgId();
        let q = _empSb().from('empleados').select('*').order('apellido', { ascending: true });
        if (orgId && !window._esSuperAdmin) {
            q = q.eq('organization_id', orgId);
        }

        const { data, error } = await q;
        if (error) throw error;

        _empleados = data || [];
        _empPagActual = 1;
        _empActualizarKPIs();
        renderEmpleados(_filtroEmpActual);

    } catch (err) {
        console.error('Error cargando empleados:', err);
        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell" style="color:var(--danger)">Error: ${_empEsc(err.message)}</td></tr>`;
    }
}

/* ── KPIs ─────────────────────────────────────────────────────── */
function _empActualizarKPIs() {
    const total     = _empleados.length;
    const activos   = _empleados.filter(e => e.estado === 'Activo').length;
    const vacaciones= _empleados.filter(e => e.estado === 'Vacaciones').length;
    const inactivos = _empleados.filter(e => e.estado === 'Inactivo' || e.estado === 'Baja').length;

    _empSet('emp-total',     total);
    _empSet('emp-activos',   activos);
    _empSet('emp-vacaciones',vacaciones);
    _empSet('emp-inactivos', inactivos);
}

/* ══════════════════════════════════════════════════════════════
   RENDER TABLA
══════════════════════════════════════════════════════════════ */
function renderEmpleados(filtro) {
    _filtroEmpActual = filtro || 'Todos';

    /* Filtro por estado */
    let lista = _filtroEmpActual === 'Todos'
        ? _empleados
        : _empleados.filter(e => e.estado === _filtroEmpActual);

    /* Búsqueda global */
    const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
    if (q) {
        lista = lista.filter(e =>
            (e.nombre + ' ' + e.apellido).toLowerCase().includes(q) ||
            (e.puesto || '').toLowerCase().includes(q) ||
            (e.departamento || '').toLowerCase().includes(q) ||
            (e.email_corporativo || '').toLowerCase().includes(q) ||
            (e.codigo_empleado || '').toLowerCase().includes(q)
        );
    }

    /* Filtro departamento */
    const depto = document.getElementById('empFiltroDepto')?.value || '';
    if (depto) lista = lista.filter(e => e.departamento === depto);

    /* Paginación */
    const total  = lista.length;
    const paginas = Math.max(1, Math.ceil(total / _EMP_POR_PAG));
    if (_empPagActual > paginas) _empPagActual = paginas;
    const ini = (_empPagActual - 1) * _EMP_POR_PAG;
    const pag = lista.slice(ini, ini + _EMP_POR_PAG);

    const tbody = document.getElementById('empleadosTbody');
    if (!tbody) return;

    if (!pag.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Sin empleados encontrados</td></tr>';
        _empSet('empFoot', '');
        _empRenderPaginacion(0, 0);
        return;
    }

    tbody.innerHTML = pag.map(e => {
        const nombre  = _empEsc(e.nombre);
        const apellido= _empEsc(e.apellido);
        const ini     = _empIniciales(e.nombre, e.apellido);
        const puesto  = _empEsc(e.puesto || '—');
        const depto   = _empEsc(e.departamento || '—');
        const email   = _empEsc(e.email_corporativo || e.email_personal || '—');
        const tel     = _empEsc(e.telefono || '—');
        const ingreso = e.fecha_ingreso ? new Date(e.fecha_ingreso).toLocaleDateString('es-GT') : '—';

        return `<tr onclick="_empVerDetalle('${e.id}')" style="cursor:pointer">
            <td>
                <div class="client-name">
                    <div class="mini-avatar" style="background:var(--accent-bg);color:var(--accent);font-weight:700;font-size:11px">${ini}</div>
                    <div>
                        <div style="font-weight:600">${apellido}, ${nombre}</div>
                        <div style="font-size:11px;color:var(--text-muted)">${e.codigo_empleado ? '#'+_empEsc(e.codigo_empleado) : ''}</div>
                    </div>
                </div>
            </td>
            <td>
                <div style="font-size:13px">${puesto}</div>
                <div style="font-size:11px;color:var(--text-muted)">${depto}</div>
            </td>
            <td>
                <div style="font-size:12px">${email}</div>
                <div style="font-size:11px;color:var(--text-muted)">${tel}</div>
            </td>
            <td style="font-size:12px">${_empEsc(e.tipo_contrato || '—')}</td>
            <td style="font-size:12px">${ingreso}</td>
            <td>${_empTagEstado(e.estado)}</td>
            <td class="actions-cell" onclick="event.stopPropagation()">
                <button class="btn-icon" title="Ver detalle" onclick="_empVerDetalle('${e.id}')">
                    <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </button>
                <button class="btn-icon" title="Editar" onclick="_empEditar('${e.id}')">
                    <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-icon" title="Eliminar" style="color:var(--danger)" onclick="_empEliminar('${e.id}','${_empEsc(e.nombre)} ${_empEsc(e.apellido)}')">
                    <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                </button>
            </td>
        </tr>`;
    }).join('');

    _empSet('empFoot', `${total} empleado${total !== 1 ? 's' : ''}`);
    _empRenderPaginacion(total, paginas);
}

/* ── PAGINACIÓN ───────────────────────────────────────────────── */
function _empRenderPaginacion(total, paginas) {
    const wrap = document.getElementById('empPaginacion');
    if (!wrap) return;
    if (paginas <= 1) { wrap.innerHTML = ''; return; }

    let html = '';
    for (let i = 1; i <= paginas; i++) {
        html += `<button class="page-btn${i === _empPagActual ? ' active' : ''}" onclick="_empIrPag(${i})">${i}</button>`;
    }
    wrap.innerHTML = html;
}

function _empIrPag(n) {
    _empPagActual = n;
    renderEmpleados(_filtroEmpActual);
}

/* ── FILTROS ──────────────────────────────────────────────────── */
function filtrarEmpleados(estado, el) {
    document.querySelectorAll('#page-empleados .filter-tab').forEach(b => b.classList.remove('open'));
    if (el) el.classList.add('active');
    _empPagActual = 1;
    renderEmpleados(estado);
}

/* ── POBLAR SELECT DEPARTAMENTOS ──────────────────────────────── */
function _empPoblarDeptos() {
    const sel = document.getElementById('empFiltroDepto');
    if (!sel) return;
    const deptos = [...new Set(_empleados.map(e => e.departamento).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todos los dptos.</option>' +
        deptos.map(d => `<option value="${_empEsc(d)}">${_empEsc(d)}</option>`).join('');
}

/* ══════════════════════════════════════════════════════════════
   MODAL NUEVO / EDITAR
══════════════════════════════════════════════════════════════ */
function newEmpleado() { _empAbrirModal(null); }

function _empEditar(id) {
    const emp = _empleados.find(e => e.id === id);
    if (emp) _empAbrirModal(emp);
}

function _empAbrirModal(emp) {
    const esEdicion = !!emp;
    const titulo    = esEdicion ? 'Editar empleado' : 'Nuevo empleado';

    const val = k => _empEsc(emp?.[k] || '');
    const sel = (k, v) => emp?.[k] === v ? 'selected' : '';

    const body = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">

        <!-- SECCIÓN: Datos personales -->
        <div style="grid-column:1/-1;font-weight:700;font-size:12px;text-transform:uppercase;color:var(--accent);letter-spacing:.06em;margin-top:4px;padding-bottom:6px;border-bottom:1px solid var(--border)">
            Datos personales
        </div>

        <div class="form-group">
            <label>Nombre *</label>
            <input class="form-input" id="empNombre" value="${val('nombre')}" placeholder="Ej. María">
        </div>
        <div class="form-group">
            <label>Apellido *</label>
            <input class="form-input" id="empApellido" value="${val('apellido')}" placeholder="Ej. García">
        </div>
        <div class="form-group">
            <label>Fecha de nacimiento</label>
            <input class="form-input" id="empFechaNac" type="date" value="${emp?.fecha_nacimiento?.slice(0,10) || ''}">
        </div>
        <div class="form-group">
            <label>Género</label>
            <select class="form-input" id="empGenero">
                <option value="">— Seleccionar —</option>
                <option ${sel('genero','Masculino')}>Masculino</option>
                <option ${sel('genero','Femenino')}>Femenino</option>
                <option ${sel('genero','Otro')}>Otro</option>
                <option ${sel('genero','Prefiero no decir')}>Prefiero no decir</option>
            </select>
        </div>
        <div class="form-group">
            <label>Estado civil</label>
            <select class="form-input" id="empEstadoCivil">
                <option value="">— Seleccionar —</option>
                <option ${sel('estado_civil','Soltero/a')}>Soltero/a</option>
                <option ${sel('estado_civil','Casado/a')}>Casado/a</option>
                <option ${sel('estado_civil','Divorciado/a')}>Divorciado/a</option>
                <option ${sel('estado_civil','Viudo/a')}>Viudo/a</option>
                <option ${sel('estado_civil','Unión libre')}>Unión libre</option>
            </select>
        </div>
        <div class="form-group">
            <label>Nacionalidad</label>
            <input class="form-input" id="empNacionalidad" value="${val('nacionalidad')}" placeholder="Ej. Guatemalteca">
        </div>

        <!-- SECCIÓN: Contacto -->
        <div style="grid-column:1/-1;font-weight:700;font-size:12px;text-transform:uppercase;color:var(--accent);letter-spacing:.06em;margin-top:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
            Contacto
        </div>

        <div class="form-group">
            <label>Teléfono personal</label>
            <input class="form-input" id="empTelefono" value="${val('telefono')}" placeholder="Ej. +502 5555-1234">
        </div>
        <div class="form-group">
            <label>Email personal</label>
            <input class="form-input" id="empEmailPersonal" type="email" value="${val('email_personal')}" placeholder="correo@personal.com">
        </div>
        <div class="form-group">
            <label>Email corporativo</label>
            <input class="form-input" id="empEmailCorp" type="email" value="${val('email_corporativo')}" placeholder="nombre@empresa.com">
        </div>
        <div class="form-group">
            <label>Extensión</label>
            <input class="form-input" id="empExtension" value="${val('extension')}" placeholder="Ej. 205">
        </div>
        <div class="form-group">
            <label>Contacto de emergencia</label>
            <input class="form-input" id="empContactoEmerg" value="${val('contacto_emergencia')}" placeholder="Nombre del contacto">
        </div>
        <div class="form-group">
            <label>Tel. emergencia</label>
            <input class="form-input" id="empTelEmerg" value="${val('telefono_emergencia')}" placeholder="+502 5555-9999">
        </div>

        <!-- SECCIÓN: Dirección -->
        <div style="grid-column:1/-1;font-weight:700;font-size:12px;text-transform:uppercase;color:var(--accent);letter-spacing:.06em;margin-top:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
            Dirección
        </div>

        <div class="form-group" style="grid-column:1/-1">
            <label>Dirección</label>
            <input class="form-input" id="empDireccion" value="${val('direccion')}" placeholder="Calle, colonia, zona...">
        </div>
        <div class="form-group">
            <label>Ciudad</label>
            <input class="form-input" id="empCiudad" value="${val('ciudad')}" placeholder="Ej. Ciudad de Guatemala">
        </div>
        <div class="form-group">
            <label>País</label>
            <input class="form-input" id="empPais" value="${val('pais') || 'Guatemala'}" placeholder="Guatemala">
        </div>

        <!-- SECCIÓN: Datos laborales -->
        <div style="grid-column:1/-1;font-weight:700;font-size:12px;text-transform:uppercase;color:var(--accent);letter-spacing:.06em;margin-top:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
            Datos laborales
        </div>

        <div class="form-group">
            <label>Código de empleado</label>
            <input class="form-input" id="empCodigo" value="${val('codigo_empleado')}" placeholder="Ej. EMP-0042">
        </div>
        <div class="form-group">
            <label>Puesto *</label>
            <input class="form-input" id="empPuesto" value="${val('puesto')}" placeholder="Ej. Analista de ventas">
        </div>
        <div class="form-group">
            <label>Departamento</label>
            <input class="form-input" id="empDepartamento" value="${val('departamento')}" placeholder="Ej. Comercial">
        </div>
        <div class="form-group">
            <label>Tipo de contrato</label>
            <select class="form-input" id="empTipoContrato">
                <option value="">— Seleccionar —</option>
                <option ${sel('tipo_contrato','Tiempo completo')}>Tiempo completo</option>
                <option ${sel('tipo_contrato','Medio tiempo')}>Medio tiempo</option>
                <option ${sel('tipo_contrato','Por proyecto')}>Por proyecto</option>
                <option ${sel('tipo_contrato','Temporal')}>Temporal</option>
                <option ${sel('tipo_contrato','Prácticas')}>Prácticas</option>
            </select>
        </div>
        <div class="form-group">
            <label>Fecha de ingreso</label>
            <input class="form-input" id="empFechaIngreso" type="date" value="${emp?.fecha_ingreso?.slice(0,10) || ''}">
        </div>
        <div class="form-group">
            <label>Fecha de egreso</label>
            <input class="form-input" id="empFechaEgreso" type="date" value="${emp?.fecha_egreso?.slice(0,10) || ''}">
        </div>
        <div class="form-group">
            <label>Salario</label>
            <input class="form-input" id="empSalario" type="number" step="0.01" value="${emp?.salario || ''}" placeholder="0.00">
        </div>
        <div class="form-group">
            <label>Moneda</label>
            <select class="form-input" id="empMoneda">
                <option ${sel('moneda','GTQ')||(!emp?.moneda?'selected':'')}>GTQ</option>
                <option ${sel('moneda','USD')}>USD</option>
                <option ${sel('moneda','EUR')}>EUR</option>
            </select>
        </div>
        <div class="form-group">
            <label>Modalidad</label>
            <select class="form-input" id="empModalidad">
                <option value="">— Seleccionar —</option>
                <option ${sel('modalidad','Presencial')}>Presencial</option>
                <option ${sel('modalidad','Remoto')}>Remoto</option>
                <option ${sel('modalidad','Híbrido')}>Híbrido</option>
            </select>
        </div>
        <div class="form-group">
            <label>Jornada</label>
            <select class="form-input" id="empJornada">
                <option value="">— Seleccionar —</option>
                <option ${sel('jornada','Diurna')}>Diurna</option>
                <option ${sel('jornada','Mixta')}>Mixta</option>
                <option ${sel('jornada','Nocturna')}>Nocturna</option>
                <option ${sel('jornada','Flexible')}>Flexible</option>
            </select>
        </div>

        <!-- SECCIÓN: Documentos -->
        <div style="grid-column:1/-1;font-weight:700;font-size:12px;text-transform:uppercase;color:var(--accent);letter-spacing:.06em;margin-top:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
            Documentos e identidad
        </div>

        <div class="form-group">
            <label>DPI / Cédula</label>
            <input class="form-input" id="empDpi" value="${val('dpi')}" placeholder="Número de DPI">
        </div>
        <div class="form-group">
            <label>NIT</label>
            <input class="form-input" id="empNit" value="${val('nit')}" placeholder="NIT del empleado">
        </div>
        <div class="form-group">
            <label>No. IGSS</label>
            <input class="form-input" id="empIgss" value="${val('igss')}" placeholder="No. afiliación IGSS">
        </div>
        <div class="form-group">
            <label>Banco</label>
            <input class="form-input" id="empBanco" value="${val('banco')}" placeholder="Ej. Banrural">
        </div>
        <div class="form-group" style="grid-column:1/-1">
            <label>Cuenta bancaria</label>
            <input class="form-input" id="empCuenta" value="${val('cuenta_bancaria')}" placeholder="Número de cuenta">
        </div>

        <!-- SECCIÓN: Estado y notas -->
        <div style="grid-column:1/-1;font-weight:700;font-size:12px;text-transform:uppercase;color:var(--accent);letter-spacing:.06em;margin-top:8px;padding-bottom:6px;border-bottom:1px solid var(--border)">
            Estado y notas
        </div>

        <div class="form-group">
            <label>Estado</label>
            <select class="form-input" id="empEstado">
                <option ${sel('estado','Activo')||(!esEdicion?'selected':'')}>Activo</option>
                <option ${sel('estado','Inactivo')}>Inactivo</option>
                <option ${sel('estado','Vacaciones')}>Vacaciones</option>
                <option ${sel('estado','Licencia')}>Licencia</option>
                <option ${sel('estado','Baja')}>Baja</option>
            </select>
        </div>
        <div class="form-group" style="grid-column:1/-1">
            <label>Notas internas</label>
            <textarea class="form-input" id="empNotas" rows="3" placeholder="Observaciones, historial, etc.">${_empEsc(emp?.notas || '')}</textarea>
        </div>
    </div>`;

    /* Usar el modal global */
    if (typeof openModal === 'function') {
        openModal(titulo, body);
        document.getElementById('modalSaveBtn').onclick = () => _empGuardar(esEdicion ? emp.id : null);
    } else {
        document.getElementById('modalTitle').textContent = titulo;
        document.getElementById('modalBody').innerHTML    = body;
        document.getElementById('modalSaveBtn').onclick   = () => _empGuardar(esEdicion ? emp.id : null);
        document.getElementById('modal').classList.add('open');
    }
}

/* ══════════════════════════════════════════════════════════════
   GUARDAR (INSERT / UPDATE)
══════════════════════════════════════════════════════════════ */
async function _empGuardar(id) {
    const g = s => document.getElementById(s)?.value?.trim() || null;

    const nombre   = g('empNombre');
    const apellido = g('empApellido');
    const puesto   = g('empPuesto');

    if (!nombre || !apellido || !puesto) {
        showToast('Nombre, apellido y puesto son obligatorios', '#FF9F0A');
        return;
    }

    const salarioVal = parseFloat(g('empSalario'));
    const orgId = _empOrgId();

    const payload = {
        nombre, apellido, puesto,
        fecha_nacimiento:    g('empFechaNac')     || null,
        genero:              g('empGenero')        || null,
        estado_civil:        g('empEstadoCivil')   || null,
        nacionalidad:        g('empNacionalidad'),
        telefono:            g('empTelefono'),
        email_personal:      g('empEmailPersonal'),
        email_corporativo:   g('empEmailCorp'),
        extension:           g('empExtension'),
        contacto_emergencia: g('empContactoEmerg'),
        telefono_emergencia: g('empTelEmerg'),
        direccion:           g('empDireccion'),
        ciudad:              g('empCiudad'),
        pais:                g('empPais') || 'Guatemala',
        codigo_empleado:     g('empCodigo'),
        departamento:        g('empDepartamento'),
        tipo_contrato:       g('empTipoContrato')  || null,
        fecha_ingreso:       g('empFechaIngreso')  || null,
        fecha_egreso:        g('empFechaEgreso')   || null,
        salario:             isNaN(salarioVal) ? null : salarioVal,
        moneda:              g('empMoneda') || 'GTQ',
        modalidad:           g('empModalidad')     || null,
        jornada:             g('empJornada')       || null,
        dpi:                 g('empDpi'),
        nit:                 g('empNit'),
        igss:                g('empIgss'),
        banco:               g('empBanco'),
        cuenta_bancaria:     g('empCuenta'),
        estado:              g('empEstado') || 'Activo',
        notas:               g('empNotas'),
    };

    /* Deshabilitar botón durante guardado */
    const btn = document.getElementById('modalSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
        let error;
        if (id) {
            ({ error } = await _empSb().from('empleados').update(payload).eq('id', id));
        } else {
            if (orgId) payload.organization_id = orgId;
            ({ error } = await _empSb().from('empleados').insert(payload));
        }

        // Si falla por columna ciudad inexistente en el esquema de la BD (PGRST204)
        if (error && (error.code === 'PGRST204' || (error.message && error.message.toLowerCase().includes('ciudad')))) {
            console.warn('[Empleados] Columna "ciudad" no encontrada en Supabase. Reintentando guardado sin "ciudad" mientras se aplica la migración SQL...', error);
            const fallbackPayload = { ...payload };
            delete fallbackPayload.ciudad;
            if (id) {
                ({ error } = await _empSb().from('empleados').update(fallbackPayload).eq('id', id));
            } else {
                ({ error } = await _empSb().from('empleados').insert(fallbackPayload));
            }
        }

        if (error) {
            console.error('[Empleados] Error guardando empleado:', error);
            throw error;
        }

        document.getElementById('modal').classList.remove('open');
        showToast(id ? 'Empleado actualizado correctamente' : 'Empleado registrado correctamente', '#30D158');
        await loadEmpleados();

    } catch (err) {
        console.error('[Empleados] Error en guardarEmpleado:', err);
        showToast('Error al guardar empleado: ' + (err.message || 'Error de conexión'), '#FF453A');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Guardar'; }
    }
}

/* ══════════════════════════════════════════════════════════════
   VER DETALLE (panel lateral / modal)
══════════════════════════════════════════════════════════════ */
function _empVerDetalle(id) {
    const e = _empleados.find(x => x.id === id);
    if (!e) return;

    const ini     = _empIniciales(e.nombre, e.apellido);
    const fmtDate = d => d ? new Date(d).toLocaleDateString('es-GT') : '—';
    const fmtMon  = (v, m) => v ? Number(v).toLocaleString('es-GT', {style:'currency', currency: m || 'GTQ'}) : '—';

    const row = (label, value) => value && value !== '—'
        ? `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
                <span style="color:var(--text-secondary)">${label}</span>
                <span style="font-weight:500;text-align:right;max-width:60%">${value}</span>
           </div>`
        : '';

    const section = (title) =>
        `<div style="font-weight:700;font-size:11px;text-transform:uppercase;color:var(--accent);letter-spacing:.06em;margin:16px 0 4px">${title}</div>`;

    const body = `
        <div style="text-align:center;padding:20px 0 12px">
            <div style="width:64px;height:64px;border-radius:50%;background:var(--accent-bg);color:var(--accent);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;margin:0 auto 10px">${ini}</div>
            <div style="font-size:18px;font-weight:700">${_empEsc(e.nombre)} ${_empEsc(e.apellido)}</div>
            <div style="color:var(--text-secondary);font-size:13px;margin-top:2px">${_empEsc(e.puesto || '')}${e.departamento ? ' · '+_empEsc(e.departamento) : ''}</div>
            <div style="margin-top:8px">${_empTagEstado(e.estado)}</div>
        </div>

        ${section('Datos personales')}
        ${row('Fecha de nacimiento', fmtDate(e.fecha_nacimiento))}
        ${row('Género', e.genero)}
        ${row('Estado civil', e.estado_civil)}
        ${row('Nacionalidad', e.nacionalidad)}

        ${section('Contacto')}
        ${row('Teléfono', e.telefono)}
        ${row('Email personal', e.email_personal)}
        ${row('Email corporativo', e.email_corporativo)}
        ${row('Extensión', e.extension)}
        ${row('Contacto emergencia', e.contacto_emergencia)}
        ${row('Tel. emergencia', e.telefono_emergencia)}

        ${section('Dirección')}
        ${row('Dirección', e.direccion)}
        ${row('Ciudad', e.ciudad)}
        ${row('País', e.pais)}

        ${section('Datos laborales')}
        ${row('Código', e.codigo_empleado)}
        ${row('Tipo de contrato', e.tipo_contrato)}
        ${row('Modalidad', e.modalidad)}
        ${row('Jornada', e.jornada)}
        ${row('Fecha de ingreso', fmtDate(e.fecha_ingreso))}
        ${row('Fecha de egreso', fmtDate(e.fecha_egreso))}
        ${row('Salario', fmtMon(e.salario, e.moneda))}

        ${section('Documentos')}
        ${row('DPI / Cédula', e.dpi)}
        ${row('NIT', e.nit)}
        ${row('No. IGSS', e.igss)}
        ${row('Banco', e.banco)}
        ${row('Cuenta bancaria', e.cuenta_bancaria)}

        ${e.notas ? section('Notas') + `<div style="font-size:13px;color:var(--text-secondary);padding:8px 0">${_empEsc(e.notas)}</div>` : ''}
    `;

    if (typeof openModal === 'function') {
        openModal('Detalle del empleado', body);
    } else {
        document.getElementById('modalTitle').textContent = 'Detalle del empleado';
        document.getElementById('modalBody').innerHTML    = body;
        document.getElementById('modal').classList.add('open');
    }
    document.getElementById('modalSaveBtn').textContent = 'Editar';
    document.getElementById('modalSaveBtn').onclick   = () => {
        closeModal();
        _empEditar(id);
    };
}

/* ══════════════════════════════════════════════════════════════
   ELIMINAR
══════════════════════════════════════════════════════════════ */
async function _empEliminar(id, nombre) {
    if (!confirm(`¿Eliminar al empleado "${nombre}"?\nEsta acción no se puede deshacer.`)) return;
    try {
        const { error } = await _empSb().from('empleados').delete().eq('id', id);
        if (error) throw error;
        showToast('Empleado eliminado', '#FF453A');
        await loadEmpleados();
    } catch (err) {
        showToast('Error: ' + err.message, '#FF453A');
    }
}

/* ══════════════════════════════════════════════════════════════
   EXPORTAR CSV
══════════════════════════════════════════════════════════════ */
function exportarEmpleados() {
    if (!_empleados.length) { showToast('No hay empleados para exportar', '#FF9F0A'); return; }
    const cols = ['nombre','apellido','puesto','departamento','tipo_contrato','fecha_ingreso','estado','email_corporativo','telefono','dpi','nit','igss','salario','moneda','modalidad'];
    const header = cols.join(',');
    const rows = _empleados.map(e => cols.map(c => `"${String(e[c]||'').replace(/"/g,'""')}"`).join(','));
    const csv = [header, ...rows].join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = 'empleados_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    showToast(`${_empleados.length} empleados exportados`, '#30D158');
}
