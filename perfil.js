/* ═══════════════════════════════════════════════════════
   perfil.js — Módulo de Ajustes / Perfil de usuario
   Extraído de dashboard.html
═══════════════════════════════════════════════════════ */

        /* ══════════════════════════════════════════════════════════
           MÓDULO AJUSTES / PERFIL DE USUARIO — JavaScript
        ══════════════════════════════════════════════════════════ */

        let _perfil = null;
        const PERFIL_CACHE_KEY = 'azyvion_perfil_cache';
        const PAGINAS_NOMBRE = {
            overview: 'Inicio', clientes: 'Clientes', prospectos: 'Prospectos', inventario: 'Inventario',
            cotizaciones: 'Cotizaciones', encuestas: 'Encuestas', contabilidad: 'Contabilidad', usuarios: 'Usuarios'
        };

        /* ── Transforma URL de Drive a formato thumbnail (más confiable) ── */
        function _fixDriveUrl(url) {
            if (!url) return '';
            const m = url.match(/[?&]id=([^&]+)/);
            if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w300-h300';
            return url;
        }

        /* ── Avatar: genera iniciales o foto real ─────────────── */
        function avatarHtml(nombre, fotoUrl, colorSemilla) {
            if (fotoUrl) {
                const src = _fixDriveUrl(fotoUrl);
                return `<img src="${escAttr(src)}" alt="${escAttr(nombre)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"
                        onerror="this.parentElement.innerHTML='${escAttr(escHtml(initials(nombre)))}';this.parentElement.style.background='${colorSemilla || 'linear-gradient(135deg,#0A84FF,#5e5ce6)'}'">`;
            }
            return escHtml(initials(nombre));
        }

        function _aplicarAvatarSidebar() {
            const el = document.getElementById('userAvatar');
            if (!el) return;
            const fotoUrl = _perfil && _perfil.fotoUrl;
            el.innerHTML = avatarHtml(_usuario, fotoUrl);
            el.style.background = fotoUrl ? 'transparent' : 'linear-gradient(135deg, #0A84FF, #5e5ce6)';
            el.style.overflow = 'hidden';
        }

        /* ── Aplicar preferencias globalmente (tema, densidad) ── */
        function aplicarPreferencias(prefs) {
            if (!prefs) return;
            document.body.classList.toggle('theme-dark', prefs.tema === 'oscuro');
            document.body.classList.toggle('densidad-compacta', prefs.densidadTabla === 'compacta');
        }

        function _cachePrefsLocal(datos) {
            try { localStorage.setItem(PERFIL_CACHE_KEY, JSON.stringify(datos)); } catch (e) {}
        }
        function _leerPrefsCache() {
            try { return JSON.parse(localStorage.getItem(PERFIL_CACHE_KEY) || 'null'); } catch (e) { return null; }
        }

        /* ── Carga completa del perfil (para la página Ajustes) ── */
        function loadPerfil() {
            const body = document.getElementById('perfilBody');
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo cargar tu perfil', '#FF453A'); return; }
                    _perfil = Object.assign({}, r.data, { fotoUrl: r.data.fotoUrl });
                    _cachePrefsLocal({ fotoUrl: r.data.fotoUrl, preferencias: r.data.preferencias });
                    aplicarPreferencias(r.data.preferencias);
                    _aplicarAvatarSidebar();
                    renderPerfil();
                    loadOrgConfigPanel();
                })
                .withFailureHandler(function (e) { showToast('Error: ' + e.message, '#FF453A'); })
                .getPerfil();
        }

        function renderPerfil() {
            const body = document.getElementById('perfilBody');
            if (!body || !_perfil) return;
            const p = _perfil;

            const paginasDisponibles = esAdmin()
                ? Object.keys(PAGINAS_NOMBRE)
                : (_rol === 'Gerente'
                    ? Object.keys(PAGINAS_NOMBRE).filter(k => k !== 'usuarios')
                    : ['overview', 'clientes', 'prospectos', 'inventario', 'cotizaciones', 'encuestas']);

            body.innerHTML = `
<div class="ajustes-layout">
  <nav class="ajustes-nav" id="ajustesNav">
    <div class="ajustes-nav-label">Cuenta</div>
    <button class="ajustes-nav-item active" onclick="ajustesTab('perfil',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
      <span>Perfil</span>
    </button>
    <button class="ajustes-nav-item" onclick="ajustesTab('seguridad',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
      <span>Contraseña</span>
    </button>
    <div class="ajustes-nav-divider"></div>
    <div class="ajustes-nav-label">Preferencias</div>
    <button class="ajustes-nav-item" onclick="ajustesTab('apariencia',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
      <span>Apariencia</span>
    </button>
    <button class="ajustes-nav-item" onclick="ajustesTab('notificaciones',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span>Notificaciones</span>
    </button>
    ${esAdmin() ? `
    <div class="ajustes-nav-divider"></div>
    <div class="ajustes-nav-label">Organización</div>
    <button class="ajustes-nav-item" onclick="ajustesTab('empresa',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      <span>Empresa</span>
      <span class="ajustes-nav-badge">Admin</span>
    </button>
    <button class="ajustes-nav-item" onclick="ajustesTab('sucursales',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 21h18M3 7v14M21 7v14M6 21V11h4v10M14 21V11h4v10M9 3l3-2 3 2"/></svg>
      <span>Sucursales</span>
      <span class="ajustes-nav-badge">Tiendas</span>
    </button>
    <button class="ajustes-nav-item" onclick="ajustesTab('fel',this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
      <span>Facturación FEL (SAT)</span>
      <span class="ajustes-nav-badge">DTE</span>
    </button>` : ''}
  </nav>

  <div class="ajustes-content">
    <div class="ajustes-header">
      <div class="ajustes-avatar-wrap">
        <div class="perfil-avatar" id="perfilAvatarBig">${avatarHtml(p.nombre, p.fotoUrl)}</div>
        <input type="file" id="perfilFotoInput" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="onSeleccionFoto(event)"/>
        <button class="ajustes-avatar-edit" onclick="document.getElementById('perfilFotoInput').click()" title="Cambiar foto">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        </button>
      </div>
      <div class="ajustes-header-info">
        <div class="ajustes-header-nombre">${escHtml(p.nombre)}</div>
        <div class="ajustes-header-meta">
          <span class="tag ${(window._esSuperAdmin || p.rol === 'Admin') ? 'tag-danger' : p.rol === 'Gerente' ? 'tag-accent' : 'tag-gray'}">${escHtml(window._esSuperAdmin ? 'Super Admin' : p.rol)}</span>
          ${p.cargo ? `<span class="cell-sub">${escHtml(p.cargo)}</span>` : ''}
          <span class="cell-sub">@${escHtml(p.usuario)}</span>
        </div>
        ${p.fotoUrl ? `<button class="btn-danger-sm" style="margin-top:8px" onclick="eliminarFotoPerfil()">Quitar foto</button>` : ''}
      </div>
    </div>

    <div class="ajustes-section active" id="ajustes-perfil">
      <div class="ajustes-section-title">Información personal</div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Nombre completo</div><div class="ajustes-row-desc">Tu nombre visible en el CRM</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="pfNombre" value="${escAttr(p.nombre)}"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Correo electrónico</div><div class="ajustes-row-desc">Para notificaciones y copias de cotizaciones</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="pfCorreo" type="email" value="${escAttr(p.correo)}" placeholder="tucorreo@empresa.com"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Teléfono</div><div class="ajustes-row-desc">Número de contacto</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="pfTelefono" value="${escAttr(p.telefono)}" placeholder="+502 0000-0000"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Cargo / Puesto</div><div class="ajustes-row-desc">Tu rol en la empresa</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="pfCargo" value="${escAttr(p.cargo)}" placeholder="Ej. Ejecutivo de ventas"/></div>
      </div>
      <div class="ajustes-row ajustes-row-disabled">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Usuario de acceso</div><div class="ajustes-row-desc">No se puede cambiar. Contacta a un administrador.</div></div>
        <div class="ajustes-row-control"><input class="form-input" value="${escAttr(p.usuario)}" disabled style="opacity:.45;cursor:not-allowed"/></div>
      </div>
      <div class="ajustes-footer"><button class="btn-save" id="pfGuardarBtn" onclick="guardarPerfilInfo()">Guardar cambios</button></div>
    </div>

    <div class="ajustes-section" id="ajustes-apariencia">
      <div class="ajustes-section-title">Apariencia y visualización</div>
      <div class="ajustes-row ajustes-row-toggle">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Tema oscuro</div><div class="ajustes-row-desc">Cambia la apariencia de todo el CRM</div></div>
        <label class="switch${p.preferencias.tema === 'oscuro' ? ' on' : ''}" id="prefTemaSwitch"><input type="checkbox" id="prefTema" ${p.preferencias.tema === 'oscuro' ? 'checked' : ''} onchange="onTogglePref(this,'prefTemaSwitch')"/><span class="knob"></span></label>
      </div>
      <div class="ajustes-row ajustes-row-toggle">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Tablas compactas</div><div class="ajustes-row-desc">Reduce el espaciado de las filas para ver más información</div></div>
        <label class="switch${p.preferencias.densidadTabla === 'compacta' ? ' on' : ''}" id="prefDensidadSwitch"><input type="checkbox" id="prefDensidad" ${p.preferencias.densidadTabla === 'compacta' ? 'checked' : ''} onchange="onTogglePref(this,'prefDensidadSwitch')"/><span class="knob"></span></label>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Página de inicio</div><div class="ajustes-row-desc">La primera pantalla al iniciar sesión</div></div>
        <div class="ajustes-row-control" style="max-width:200px"><select class="form-select" id="prefPaginaInicio">${paginasDisponibles.map(k => `<option value="${k}"${k === p.preferencias.paginaInicio ? ' selected' : ''}>${PAGINAS_NOMBRE[k]}</option>`).join('')}</select></div>
      </div>
      <div class="ajustes-footer"><button class="btn-save" id="aparienciaGuardarBtn" onclick="guardarPreferenciasGenerales()">Guardar preferencias</button></div>
    </div>

    <div class="ajustes-section" id="ajustes-notificaciones">
      <div class="ajustes-section-title">Notificaciones por correo</div>
      ${!p.correo ? '<div class="ajustes-alert">⚠️ Agrega un correo en <b>Perfil</b> para recibir notificaciones.</div>' : ''}
      <div class="ajustes-row ajustes-row-toggle">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Copiarme mis cotizaciones</div><div class="ajustes-row-desc">Recibe una copia cuando envíes una cotización por correo</div></div>
        <label class="switch${p.preferencias.copiarmeCotizaciones ? ' on' : ''}" id="prefCopiaSwitch"><input type="checkbox" id="prefCopia" ${p.preferencias.copiarmeCotizaciones ? 'checked' : ''} onchange="onTogglePref(this,'prefCopiaSwitch')"/><span class="knob"></span></label>
      </div>
      <div class="ajustes-row ajustes-row-toggle">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Alertas de stock crítico</div><div class="ajustes-row-desc">Recibe un correo cuando un producto baje de stock mínimo</div></div>
        <label class="switch${p.preferencias.alertaStockCritico ? ' on' : ''}" id="prefStockSwitch"><input type="checkbox" id="prefStock" ${p.preferencias.alertaStockCritico ? 'checked' : ''} onchange="onTogglePref(this,'prefStockSwitch')"/><span class="knob"></span></label>
      </div>
      <div class="ajustes-footer"><button class="btn-save" id="notifsGuardarBtn" onclick="guardarPreferenciasGenerales()">Guardar notificaciones</button></div>
    </div>

    <div class="ajustes-section" id="ajustes-seguridad">
      <div class="ajustes-section-title">Cambiar contraseña</div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Contraseña actual</div><div class="ajustes-row-desc">Necesaria para confirmar el cambio</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="pwActual" type="password" autocomplete="current-password" placeholder="••••••••"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Nueva contraseña</div><div class="ajustes-row-desc">Mínimo 6 caracteres</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="pwNueva" type="password" autocomplete="new-password" placeholder="••••••••"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Confirmar nueva contraseña</div><div class="ajustes-row-desc">Escríbela de nuevo para confirmar</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="pwConfirmar" type="password" autocomplete="new-password" placeholder="••••••••"/></div>
      </div>
      <div class="ajustes-alert ajustes-alert-info">🔒 Al cambiar tu contraseña, cerraremos tus demás sesiones activas por seguridad.</div>
      <div class="ajustes-footer"><button class="btn-save" id="pwGuardarBtn" onclick="guardarNuevaContrasena()">Actualizar contraseña</button></div>
    </div>

    ${esAdmin() ? `
    <div class="ajustes-section" id="ajustes-empresa">
      <div class="ajustes-section-title">Configuración de empresa</div>
      <div class="ajustes-row" style="align-items:flex-start">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Logo de empresa</div><div class="ajustes-row-desc">Aparece en cotizaciones. PNG/JPG/WEBP, máx. 3 MB.</div></div>
        <div class="ajustes-row-control">
          <div id="orgLogoPreview" style="width:90px;height:60px;border-radius:8px;border:1.5px dashed var(--border);display:flex;align-items:center;justify-content:center;background:var(--card);overflow:hidden;margin-bottom:8px"><span id="orgLogoPlaceholder" style="font-size:11px;color:var(--text-muted);text-align:center;padding:4px">Sin logo</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <input type="file" id="orgLogoInput" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="onSeleccionLogoOrg(event)"/>
            <button class="btn-ghost" onclick="document.getElementById('orgLogoInput').click()" style="font-size:12px;padding:6px 14px">📁 Subir logo</button>
            <button id="orgLogoDeleteBtn" class="btn-danger-sm" onclick="eliminarLogoOrg()" style="display:none;font-size:12px">Quitar</button>
          </div>
        </div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Nombre de empresa</div><div class="ajustes-row-desc">Nombre legal o comercial</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgNombre" placeholder="Ej. Distribuidora Norte S.A." oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Eslogan</div><div class="ajustes-row-desc">Descripción corta o lema</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgEslogan" placeholder="Ej. Tu socio de confianza" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">NIT</div><div class="ajustes-row-desc">Número de identificación tributaria</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgNit" placeholder="Ej. 1234567-8" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Teléfono</div><div class="ajustes-row-desc">Número de contacto de la empresa</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgTelefono" placeholder="Ej. +502 2200-0000" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Correo de empresa</div><div class="ajustes-row-desc">Correo de contacto oficial</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgCorreo" type="email" placeholder="ventas@miempresa.com" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Sitio web</div><div class="ajustes-row-desc">Dirección de la página web</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgSitio" placeholder="www.miempresa.com" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Dirección</div><div class="ajustes-row-desc">Dirección física de la empresa</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgDireccion" placeholder="Ej. 5a Av. 10-50, Zona 1" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Prefijo de cotizaciones</div><div class="ajustes-row-desc">Formato correlativo (ej. COT- o COTIZ-)</div></div>
        <div class="ajustes-row-control" style="max-width:180px"><input class="form-input" id="orgPrefijoCot" placeholder="COT-" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Prefijo de tickets POS</div><div class="ajustes-row-desc">Formato correlativo para ventas POS (ej. POS- o FAC-)</div></div>
        <div class="ajustes-row-control" style="max-width:180px"><input class="form-input" id="orgPrefijoPos" placeholder="POS-" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Moneda</div><div class="ajustes-row-desc">Moneda usada en cotizaciones y POS</div></div>
        <div class="ajustes-row-control" style="max-width:220px"><select class="form-select" id="orgMoneda" onchange="actualizarMembretePreview()"><option value="Q">Q — Quetzal (GTQ)</option><option value="$">$ — Dólar (USD)</option><option value="€">€ — Euro (EUR)</option><option value="L">L — Lempira (HNL)</option><option value="C$">C$ — Córdoba (NIO)</option></select></div>
      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">País de operación</div>
          <div class="ajustes-row-desc">Configuración fiscal y regional (ajusta el IVA y moneda sugerida automáticamente)</div>
        </div>
        <div class="ajustes-row-control" style="max-width:240px">
          <select class="form-select" id="orgPaisCodigo" onchange="_onPaisChange(this); actualizarMembretePreview()">
            <option value="GT">Guatemala (GT - 12% IVA)</option>
            <option value="SV">El Salvador (SV - 13% IVA)</option>
            <option value="HN">Honduras (HN - 15% ISV)</option>
            <option value="NI">Nicaragua (NI - 15% IVA)</option>
            <option value="CR">Costa Rica (CR - 13% IVA)</option>
            <option value="PA">Panamá (PA - 7% ITBMS)</option>
            <option value="MX">México (MX - 16% IVA)</option>
            <option value="CO">Colombia (CO - 19% IVA)</option>
            <option value="US">Estados Unidos (US - Sales Tax)</option>
            <option value="OT">Internacional / Otro</option>
          </select>
        </div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Tasa de Impuesto / IVA (%)</div>
          <div class="ajustes-row-desc">Porcentaje de impuesto aplicable a las cotizaciones y ventas (ej. 12% Guatemala, 16% México, 13% El Salvador)</div>
        </div>
        <div class="ajustes-row-control" style="max-width:130px">
          <input class="form-input" id="orgIva" type="number" min="0" max="50" step="0.01" placeholder="12" oninput="actualizarMembretePreview()"/>
        </div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Modalidad de Aplicación del IVA</div>
          <div class="ajustes-row-desc">Indica cómo se calcula el impuesto en las cotizaciones y ventas</div>
        </div>
        <div class="ajustes-row-control" style="max-width:320px">
          <select class="form-select" id="orgIvaModalidad" onchange="actualizarMembretePreview()">
            <option value="incluido">Precios con IVA incluido (Predeterminado · Consumidor final)</option>
            <option value="sobre">Más IVA sobre el subtotal (+IVA al final · B2B)</option>
            <option value="exento">Exento de IVA / Sin impuesto (0%)</option>
          </select>
        </div>
      </div>
      <div class="ajustes-row" style="align-items:flex-start">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Condiciones por defecto</div><div class="ajustes-row-desc">Texto de condiciones en nuevas cotizaciones</div></div>
        <div class="ajustes-row-control"><textarea class="form-input" id="orgCondiciones" rows="3" style="resize:vertical"></textarea></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Tipo de documento fiscal</div><div class="ajustes-row-desc">Identificador tributario para clientes (NIT, RFC, RUC, Tax ID, etc.)</div></div>
        <div class="ajustes-row-control" style="max-width:160px"><input class="form-input" id="orgTipoDocFiscal" placeholder="NIT" value="NIT" /></div>
      </div>
      <div class="ajustes-row ajustes-row-toggle">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Catálogo de productos con fotos</div><div class="ajustes-row-desc">Muestra imágenes en miniatura en las tarjetas de productos del POS</div></div>
        <label class="switch on" id="orgCatalogoFotosSwitch"><input type="checkbox" id="orgCatalogoFotos" checked onchange="this.closest('label').classList.toggle('on', this.checked)"/><span class="knob"></span></label>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Webhook de envío de facturas/tickets</div><div class="ajustes-row-desc">Endpoint para enviar por correo el comprobante automático al cobrar</div></div>
        <div class="ajustes-row-control"><input class="form-input" id="orgWebhookCorreo" placeholder="https://hook.us1.make.com/..." /></div>
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Días de vigencia de cotización</div><div class="ajustes-row-desc">Número de días válida una cotización emitida (aplica automáticamente al crear una nueva)</div></div>
        <div class="ajustes-row-control" style="max-width:120px"><input class="form-input" id="orgDiasVigenciaCot" type="number" min="1" max="365" placeholder="15" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row" style="align-items:flex-start">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Pie de ticket POS</div><div class="ajustes-row-desc">Texto que aparece al final del ticket térmico (ej. mensaje de agradecimiento, política de cambios)</div></div>
        <div class="ajustes-row-control"><textarea class="form-input" id="orgPieTicket" rows="2" style="resize:vertical" placeholder="Gracias por su compra — No se aceptan cambios ni devoluciones" oninput="actualizarMembretePreview()"></textarea></div>
      </div>

      <!-- Vista previa en tiempo real de membrete y ticket -->
      <div class="ajustes-row" style="align-items:flex-start;flex-direction:column;gap:12px;border-top:1px solid var(--border);padding-top:20px;margin-top:10px">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name" style="font-size:14px;font-weight:700">Vista previa en vivo de documentos</div>
          <div class="ajustes-row-desc">Así se visualizarán las cotizaciones y tickets POS emitidos por esta empresa</div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;width:100%">
          <!-- Mini Membrete Cotización -->
          <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:16px;font-size:12px">
            <div style="font-weight:700;font-size:11px;color:var(--text-muted);text-transform:uppercase;margin-bottom:10px;display:flex;justify-content:space-between">
              <span>📄 Membrete de Cotización</span>
              <span id="prevCotNum" style="color:var(--accent);font-weight:600">COT-2026-0001</span>
            </div>
            <div style="display:flex;gap:12px;align-items:flex-start;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px">
              <div id="prevCotLogo" style="width:48px;height:48px;border-radius:6px;background:var(--card);display:flex;align-items:center;justify-content:center;border:1px solid var(--border);overflow:hidden;flex-shrink:0">
                <span style="font-size:10px;color:var(--text-muted)">Logo</span>
              </div>
              <div>
                <div id="prevCotNombre" style="font-weight:700;font-size:14px;color:var(--text-primary)">Mi Empresa</div>
                <div id="prevCotEslogan" style="color:var(--text-muted);font-style:italic;font-size:11px">Tu socio de confianza</div>
                <div id="prevCotNit" style="color:var(--text-secondary);font-size:11px">NIT: C/F</div>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;color:var(--text-secondary)">
              <div><b>Tel:</b> <span id="prevCotTel">—</span></div>
              <div><b>Correo:</b> <span id="prevCotCorreo">—</span></div>
              <div style="grid-column:1/-1"><b>Dirección:</b> <span id="prevCotDir">—</span></div>
            </div>
          </div>
          <!-- Mini Ticket POS -->
          <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;padding:16px;font-family:'Courier New',Courier,monospace;font-size:11px;color:var(--text-primary)">
            <div style="font-weight:700;font-size:11px;color:var(--text-muted);font-family:inherit;text-transform:uppercase;margin-bottom:8px;text-align:center">
              🧾 Ticket Térmico POS (80mm)
            </div>
            <div style="text-align:center;border-bottom:1px dashed var(--border);padding-bottom:8px;margin-bottom:8px">
              <div id="prevTicketNombre" style="font-weight:700;font-size:13px">MI EMPRESA</div>
              <div id="prevTicketNit">NIT: C/F</div>
              <div id="prevTicketDir" style="font-size:10px">Ciudad</div>
              <div id="prevTicketNum" style="font-weight:700;margin-top:4px">POS-2026-00001</div>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span>PRODUCTO DEMO</span>
              <span id="prevTicketTotal">Q 150.00</span>
            </div>
            <div style="display:flex;justify-content:space-between;border-top:1px dashed var(--border);margin-top:6px;padding-top:6px;font-weight:700">
              <span>TOTAL PAGADO</span>
              <span id="prevTicketTotal2">Q 150.00</span>
            </div>
            <div id="prevTicketPie" style="border-top:1px dashed var(--border);margin-top:8px;padding-top:6px;text-align:center;font-size:9px;color:var(--text-muted);white-space:pre-line">Gracias por su compra</div>
          </div>
        </div>
      </div>

      <div class="ajustes-footer"><button class="btn-save" id="orgGuardarBtn" onclick="guardarOrgConfig()">Guardar empresa</button></div>
    </div>

    <!-- SECCIÓN SUCURSALES (MULTI-TIENDA) -->
    <div class="ajustes-section" id="ajustes-sucursales">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <div class="ajustes-section-title" style="margin-bottom:4px">Sucursales y Tiendas Físicas</div>
          <div style="font-size:12.5px;color:var(--text-secondary)">Organiza tus puntos de venta, asigna personal y gestiona arqueos independientes.</div>
        </div>
        <button class="topbar-btn" onclick="abrirModalSucursal()" style="background:var(--accent);color:#fff;font-weight:700">
          <svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:#fff;fill:none;stroke-width:2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nueva Sucursal
        </button>
      </div>

      <div class="table-card" style="box-shadow:none;border:1px solid var(--border)">
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Código</th>
                <th>Dirección</th>
                <th>Teléfono</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th style="width:120px;text-align:right">Acciones</th>
              </tr>
            </thead>
            <tbody id="sucursalesAdminTbody">
              <tr><td colspan="7" class="empty-cell">Cargando sucursales…</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- SECCIÓN FACTURACIÓN FEL (SAT GUATEMALA) -->
    <div class="ajustes-section" id="ajustes-fel">
      <div class="ajustes-section-title">Facturación Electrónica en Línea (FEL · SAT Guatemala)</div>
      
      <div class="ajustes-alert ajustes-alert-info" style="margin-bottom:16px">
        🏛️ <strong>Documentos Tributarios Electrónicos (DTE) Reales:</strong><br>
        Al habilitar el módulo FEL, cada venta y cobro en el POS generará una Factura Electrónica legal con <strong>Número de Autorización (UUID SAT)</strong>, Serie, Número de DTE, y enlace directo de verificación en el portal de la SAT.
      </div>

      <div class="ajustes-row ajustes-row-toggle">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Habilitar Facturación Electrónica FEL</div>
          <div class="ajustes-row-desc">Emite facturas tributarias reales con certificación SAT en cada venta POS</div>
        </div>
        <label class="switch" id="felHabilitadoSwitch">
          <input type="checkbox" id="felHabilitado" onchange="this.closest('label').classList.toggle('on', this.checked)"/>
          <span class="knob"></span>
        </label>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">NIT del Emisor *</div>
          <div class="ajustes-row-desc">NIT registrado ante la SAT para emitir facturas</div>
        </div>
        <div class="ajustes-row-control" style="display:flex;gap:8px">
          <input class="form-input" id="felNitEmisor" placeholder="Ej. 1234567-8" />
          <button type="button" class="btn-ghost" onclick="document.getElementById('felNitEmisor').value = (document.getElementById('orgNit')||{}).value || ''" style="white-space:nowrap;font-size:11.5px">
            Copiar de Empresa
          </button>
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Nombre Comercial / Razón Social *</div>
          <div class="ajustes-row-desc">Nombre fiscal exactamente como figura en el RTU de la SAT</div>
        </div>
        <div class="ajustes-row-control">
          <input class="form-input" id="felNombreComercial" placeholder="Ej. DISTRIBUIDORA GUATEMALA, S.A." />
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Afiliación de IVA</div>
          <div class="ajustes-row-desc">Régimen tributario asignado ante la SAT</div>
        </div>
        <div class="ajustes-row-control" style="max-width:260px">
          <select class="form-select" id="felAfiliacionIva">
            <option value="General">Régimen General (12% IVA)</option>
            <option value="PequenoContribuyente">Pequeño Contribuyente (5% Factura Electrónica)</option>
            <option value="Exento">Exento de IVA</option>
          </select>
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Código de Establecimiento SAT</div>
          <div class="ajustes-row-desc">Número de establecimiento asignado en la agencia virtual SAT (usualmente 1)</div>
        </div>
        <div class="ajustes-row-control" style="max-width:140px">
          <input class="form-input" id="felCodigoEstablecimiento" value="1" placeholder="1" />
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Proveedor Certificador DTE (SAT)</div>
          <div class="ajustes-row-desc">Entidad certificadora autorizada para firmar y validar con SAT</div>
        </div>
        <div class="ajustes-row-control" style="max-width:280px">
          <select class="form-select" id="felCertificador">
            <option value="INFILE">INFILE, S.A. (Certificador SAT)</option>
            <option value="DIGIFACT">DIGIFACT (Certificador SAT)</option>
            <option value="MEGAPRINT">MEGAPRINT (Certificador SAT)</option>
            <option value="GUATEFACTURAS">GUATEFACTURAS (Certificador SAT)</option>
            <option value="SAT_DIRECTO">SAT DIRECTO / ENTORNO PRUEBAS</option>
          </select>
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Entorno de Facturación</div>
          <div class="ajustes-row-desc">Selecciona Modo Producción cuando estés listo para emitir facturas legales reales</div>
        </div>
        <div class="ajustes-row-control" style="max-width:260px">
          <select class="form-select" id="felEntorno">
            <option value="Pruebas">Certificación / Sandbox (Pruebas)</option>
            <option value="Produccion">PRODUCCIÓN (Facturas Reales SAT)</option>
          </select>
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Usuario / Llave de Certificador</div>
          <div class="ajustes-row-desc">Credencial API provista por el certificador FEL</div>
        </div>
        <div class="ajustes-row-control">
          <input class="form-input" id="felUsuarioCertificador" placeholder="Usuario o Client ID de Certificador" />
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">API Key / Token de Acceso SAT</div>
          <div class="ajustes-row-desc">Token de firma o clave de acceso para autorizaciones DTE</div>
        </div>
        <div class="ajustes-row-control">
          <input class="form-input" id="felApiKey" type="password" placeholder="••••••••••••••••••••••••••••••" />
        </div>
      </div>

      <div class="ajustes-row">
        <div class="ajustes-row-label">
          <div class="ajustes-row-name">Frase Tributaria SAT</div>
          <div class="ajustes-row-desc">Texto legal requerido por la SAT al pie de cada factura</div>
        </div>
        <div class="ajustes-row-control">
          <select class="form-select" id="felFraseSat">
            <option value="Sujeto a pagos trimestrales ISR">Sujeto a pagos trimestrales ISR</option>
            <option value="Sujeto a retención definitiva ISR">Sujeto a retención definitiva ISR</option>
            <option value="Pequeño Contribuyente no genera crédito fiscal">Pequeño Contribuyente no genera crédito fiscal</option>
            <option value="Exento de ISR e IVA">Exento de ISR e IVA</option>
          </select>
        </div>
      </div>

      <div class="ajustes-row" style="background:var(--bg-secondary);border-radius:10px;padding:12px 16px;margin-top:14px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:13px;color:var(--text-primary)">Estado de Conexión SAT</div>
          <div id="felEstadoConexionTxt" style="font-size:12px;color:var(--text-muted);margin-top:2px">Configura tus credenciales y presiona verificar conexión.</div>
        </div>
        <button type="button" class="topbar-btn" onclick="probarConexionFel()" id="btnProbarFel" style="height:34px;font-size:12px;padding:0 14px;background:var(--accent);color:#fff">
          🔌 Probar Conexión SAT
        </button>
      </div>

      <div class="ajustes-footer">
        <button class="btn-save" id="felGuardarBtn" onclick="guardarOrgConfig()">Guardar configuración FEL</button>
      </div>
    </div>
    ` : ''}

  </div>
</div>`;

            window.ajustesTab = function(tab, btn) {
                document.querySelectorAll('.ajustes-nav-item').forEach(function(b){ b.classList.remove('active'); });
                document.querySelectorAll('.ajustes-section').forEach(function(s){ s.classList.remove('active'); });
                if (btn) btn.classList.add('active');
                var sec = document.getElementById('ajustes-' + tab);
                if (sec) sec.classList.add('active');
                if (tab === 'empresa' || tab === 'fel') loadOrgConfigPanel();
                if (tab === 'sucursales') loadSucursalesAdmin();
            };
        }


        /* ── Cargar config de organización en el panel admin ──── */
        function loadOrgConfigPanel() {
            if (!esAdmin()) return;
            window.api
                .withSuccessHandler(function(r) {
                    if (!r || !r.ok) return;
                    const d = r.data || {};
                    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
                    setVal('orgNombre', d.nombre);
                    setVal('orgEslogan', d.eslogan);
                    setVal('orgNit', d.nit);
                    setVal('orgTelefono', d.telefono);
                    setVal('orgCorreo', d.correo);
                    setVal('orgSitio', d.sitio);
                    setVal('orgDireccion', d.direccion);
                    setVal('orgIva', d.iva_pct !== undefined ? d.iva_pct : 12);
                    setVal('orgIvaModalidad', d.iva_modalidad || 'incluido');
                    setVal('orgCondiciones', d.condiciones_default);
                    setVal('orgPrefijoCot', d.prefijo_cotizacion || 'COT-');
                    setVal('orgPrefijoPos', d.prefijo_ticket || 'POS-');
                    setVal('orgPaisCodigo', d.pais_codigo || 'GT');
                    setVal('orgTipoDocFiscal', d.tipo_documento_fiscal || 'NIT');
                    setVal('orgWebhookCorreo', d.webhook_correo_facturas || '');
                    setVal('orgDiasVigenciaCot', d.dias_vigencia_cotizacion !== undefined ? d.dias_vigencia_cotizacion : 15);
                    setVal('orgPieTicket', d.pie_ticket || '');
                    const chkFotos = document.getElementById('orgCatalogoFotos');
                    if (chkFotos) {
                        chkFotos.checked = d.catalogo_fotos_habilitado !== false && String(d.catalogo_fotos_habilitado) !== 'false';
                        const sw = document.getElementById('orgCatalogoFotosSwitch');
                        if (sw) sw.classList.toggle('on', chkFotos.checked);
                    }
                    const monSel = document.getElementById('orgMoneda');
                    if (monSel && d.moneda) {
                        const opt = [...monSel.options].find(o => o.value === d.moneda);
                        if (opt) opt.selected = true;
                    }

                    // Cargar configuración de Facturación FEL (SAT)
                    let localFel = {};
                    try { localFel = JSON.parse(localStorage.getItem('azyvion_fel_config') || '{}'); } catch(e) {}
                    const fel = { ...localFel, ...d };

                    const chkFel = document.getElementById('felHabilitado');
                    if (chkFel) {
                        chkFel.checked = !!(fel.fel_habilitado === true || fel.fel_habilitado === 'true');
                        const sw = document.getElementById('felHabilitadoSwitch');
                        if (sw) sw.classList.toggle('on', chkFel.checked);
                    }
                    setVal('felNitEmisor', fel.fel_nit_emisor || d.nit || '');
                    setVal('felNombreComercial', fel.fel_nombre_comercial || d.nombre || '');
                    setVal('felCodigoEstablecimiento', fel.fel_codigo_establecimiento || '1');
                    setVal('felUsuarioCertificador', fel.fel_usuario_certificador || '');
                    setVal('felApiKey', fel.fel_api_key || '');

                    const selAf = document.getElementById('felAfiliacionIva');
                    if (selAf && fel.fel_afiliacion_iva) {
                        const opt = [...selAf.options].find(o => o.value === fel.fel_afiliacion_iva);
                        if (opt) opt.selected = true;
                    }
                    const selCert = document.getElementById('felCertificador');
                    if (selCert && fel.fel_certificador) {
                        const opt = [...selCert.options].find(o => o.value === fel.fel_certificador);
                        if (opt) opt.selected = true;
                    }
                    const selEnt = document.getElementById('felEntorno');
                    if (selEnt && fel.fel_entorno) {
                        const opt = [...selEnt.options].find(o => o.value === fel.fel_entorno);
                        if (opt) opt.selected = true;
                    }
                    const selFrase = document.getElementById('felFraseSat');
                    if (selFrase && fel.fel_frase_sat) {
                        const opt = [...selFrase.options].find(o => o.value === fel.fel_frase_sat);
                        if (opt) opt.selected = true;
                    }

                    // Logo preview
                    const preview = document.getElementById('orgLogoPreview');
                    const placeholder = document.getElementById('orgLogoPlaceholder');
                    const delBtn = document.getElementById('orgLogoDeleteBtn');
                    if (preview) {
                        if (d.logo_url) {
                            preview.innerHTML = '<img src="'+escAttr(d.logo_url)+'" style="width:100%;height:100%;object-fit:contain;padding:4px" onerror="this.style.display=\'none\'">';
                            if (delBtn) delBtn.style.display = '';
                        } else {
                            preview.innerHTML = '<span id="orgLogoPlaceholder" style="font-size:12px;color:var(--text-muted,#aaa);text-align:center;padding:4px">Sin logo</span>';
                            if (delBtn) delBtn.style.display = 'none';
                        }
                    }
                    actualizarMembretePreview();
                })
                .withFailureHandler(function() {})
                .getOrgConfig({});
        }

        function actualizarMembretePreview() {
            const nom = (document.getElementById('orgNombre') || {}).value || 'Mi Empresa';
            const esl = (document.getElementById('orgEslogan') || {}).value || '';
            const nit = (document.getElementById('orgNit') || {}).value || (document.getElementById('felNitEmisor') || {}).value || 'C/F';
            const tel = (document.getElementById('orgTelefono') || {}).value || '—';
            const cor = (document.getElementById('orgCorreo') || {}).value || '—';
            const dir = (document.getElementById('orgDireccion') || {}).value || '—';
            const prefCot = (document.getElementById('orgPrefijoCot') || {}).value || 'COT-',
                  prefPos = (document.getElementById('orgPrefijoPos') || {}).value || 'POS-';
            const mon = (document.getElementById('orgMoneda') || {}).value || 'Q';

            const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
            setT('prevCotNombre', nom);
            setT('prevCotEslogan', esl);
            setT('prevCotNit', 'NIT: ' + nit);
            setT('prevCotTel', tel);
            setT('prevCotCorreo', cor);
            setT('prevCotDir', dir);
            setT('prevCotNum', prefCot + '2026-0001');

            setT('prevTicketNombre', nom.toUpperCase());
            setT('prevTicketNit', 'NIT: ' + nit);
            setT('prevTicketDir', dir !== '—' ? dir : 'Ciudad');
            setT('prevTicketNum', prefPos + '2026-00001');
            setT('prevTicketTotal', mon + ' 150.00');
            setT('prevTicketTotal2', mon + ' 150.00');

            const pieText = (document.getElementById('orgPieTicket') || {}).value || 'Gracias por su compra';
            setT('prevTicketPie', pieText);

            const diasVig = (document.getElementById('orgDiasVigenciaCot') || {}).value || '15';
            setT('prevCotVigencia', 'Vigencia: ' + diasVig + ' días');

            const prevLogo = document.getElementById('prevCotLogo');
            const orgPreview = document.getElementById('orgLogoPreview');
            if (prevLogo && orgPreview) {
                const img = orgPreview.querySelector('img');
                if (img && img.src && img.style.display !== 'none') {
                    prevLogo.innerHTML = `<img src="${escAttr(img.src)}" style="width:100%;height:100%;object-fit:contain">`;
                } else {
                    prevLogo.innerHTML = `<span style="font-size:10px;color:var(--text-muted)">Logo</span>`;
                }
            }
        }
        window.actualizarMembretePreview = actualizarMembretePreview;

        function guardarOrgConfig() {
            const btn = document.getElementById('orgGuardarBtn') || document.getElementById('felGuardarBtn');
            const nombre = (document.getElementById('orgNombre') && document.getElementById('orgNombre').value || '').trim() || (document.getElementById('felNombreComercial') && document.getElementById('felNombreComercial').value || '').trim() || 'Mi Empresa';
            if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

            const felHabilitado = !!(document.getElementById('felHabilitado') && document.getElementById('felHabilitado').checked);
            const felNit = (document.getElementById('felNitEmisor') || {}).value || v('orgNit');
            const felNom = (document.getElementById('felNombreComercial') || {}).value || nombre;
            const felAfil = (document.getElementById('felAfiliacionIva') || {}).value || 'General';
            const felEst = (document.getElementById('felCodigoEstablecimiento') || {}).value || '1';
            const felCert = (document.getElementById('felCertificador') || {}).value || 'INFILE';
            const felEnt = (document.getElementById('felEntorno') || {}).value || 'Pruebas';
            const felUser = (document.getElementById('felUsuarioCertificador') || {}).value || '';
            const felKey = (document.getElementById('felApiKey') || {}).value || '';
            const felFrase = (document.getElementById('felFraseSat') || {}).value || 'Sujeto a pagos trimestrales ISR';

            const felLocal = {
                fel_habilitado: felHabilitado,
                fel_nit_emisor: felNit,
                fel_nombre_comercial: felNom,
                fel_afiliacion_iva: felAfil,
                fel_codigo_establecimiento: felEst,
                fel_certificador: felCert,
                fel_entorno: felEnt,
                fel_usuario_certificador: felUser,
                fel_api_key: felKey,
                fel_frase_sat: felFrase
            };
            try { localStorage.setItem('azyvion_fel_config', JSON.stringify(felLocal)); } catch(e) {}

            const datos = {
                nombre: nombre,
                eslogan: v('orgEslogan'),
                nit: v('orgNit') || felNit,
                telefono: v('orgTelefono'),
                correo: v('orgCorreo'),
                sitio: v('orgSitio'),
                direccion: v('orgDireccion'),
                moneda: v('orgMoneda') || 'Q',
                iva_pct: Number(v('orgIva')) || 12,
                iva_modalidad: (document.getElementById('orgIvaModalidad') || {}).value || 'incluido',
                condiciones_default: v('orgCondiciones'),
                prefijo_cotizacion: (document.getElementById('orgPrefijoCot') || {}).value || 'COT-',
                prefijo_ticket: (document.getElementById('orgPrefijoPos') || {}).value || 'POS-',
                pais_codigo: (document.getElementById('orgPaisCodigo') || {}).value || 'GT',
                tipo_documento_fiscal: (document.getElementById('orgTipoDocFiscal') || {}).value || 'NIT',
                catalogo_fotos_habilitado: !!(document.getElementById('orgCatalogoFotos') && document.getElementById('orgCatalogoFotos').checked),
                webhook_correo_facturas: (document.getElementById('orgWebhookCorreo') || {}).value || '',
                dias_vigencia_cotizacion: Number((document.getElementById('orgDiasVigenciaCot') || {}).value) || 15,
                pie_ticket: (document.getElementById('orgPieTicket') || {}).value || '',
                ...felLocal
            };

            try {
                localStorage.setItem('azyvion_org_extra', JSON.stringify({
                    iva_pct: datos.iva_pct,
                    iva_modalidad: datos.iva_modalidad,
                    dias_vigencia_cotizacion: datos.dias_vigencia_cotizacion,
                    pie_ticket: datos.pie_ticket
                }));
            } catch(e) {}

            const resetBtns = () => {
                const b1 = document.getElementById('orgGuardarBtn');
                const b2 = document.getElementById('felGuardarBtn');
                if (b1) { b1.disabled = false; b1.textContent = 'Guardar configuración'; }
                if (b2) { b2.disabled = false; b2.textContent = 'Guardar configuración FEL'; }
            };

            window.api
                .withSuccessHandler(function(r) {
                    resetBtns();
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo guardar', '#FF453A'); return; }
                    showToast('Configuración de empresa y FEL guardada ✓', '#30D158');
                })
                .withFailureHandler(function(e) { resetBtns(); showToast('Error: ' + e.message, '#FF453A'); })
        }
        window.guardarOrgConfig = guardarOrgConfig;

        function probarConexionFel() {
            const btn = document.getElementById('btnProbarFel');
            const txt = document.getElementById('felEstadoConexionTxt');
            const nit = ((document.getElementById('felNitEmisor') || {}).value || '').trim();
            const key = ((document.getElementById('felApiKey') || {}).value || '').trim();
            const cert = ((document.getElementById('felCertificador') || {}).value || 'INFILE').trim();
            const entorno = ((document.getElementById('felEntorno') || {}).value || 'Pruebas').trim();

            if (!nit || !key) {
                showToast('Ingresa el NIT y la clave API antes de probar la conexión', '#FF9F0A');
                if (txt) {
                    txt.style.color = '#FF9F0A';
                    txt.textContent = '⚠️ Ingresa el NIT y el API Key para realizar la verificación.';
                }
                return;
            }

            if (btn) { btn.disabled = true; btn.textContent = 'Verificando…'; }
            if (txt) {
                txt.style.color = 'var(--text-secondary)';
                txt.textContent = 'Conectando con el servidor de ' + cert + ' (' + entorno + ')…';
            }

            window.api
                .withSuccessHandler(function(r) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Probar conexión'; }
                    if (!r || !r.ok) {
                        const errMsg = (r && r.error) || 'Error de conexión con el certificador';
                        if (txt) {
                            txt.style.color = 'var(--danger)';
                            txt.textContent = '❌ ' + errMsg;
                        }
                        showToast(errMsg, '#FF453A');
                        return;
                    }
                    if (txt) {
                        txt.style.color = '#30D158';
                        txt.textContent = '✅ ' + (r.mensaje || 'Conexión verificada exitosamente.');
                    }
                    showToast(r.mensaje || 'Conexión FEL verificada ✓', '#30D158');
                })
                .withFailureHandler(function(e) {
                    if (btn) { btn.disabled = false; btn.textContent = 'Probar conexión'; }
                    if (txt) {
                        txt.style.color = 'var(--danger)';
                        txt.textContent = '❌ Error de comunicación: ' + e.message;
                    }
                    showToast('Error: ' + e.message, '#FF453A');
                })
                .probarConexionFel({
                    certificador: cert,
                    nit: nit,
                    apiKey: key,
                    entorno: entorno
                });
        }
        window.probarConexionFel = probarConexionFel;

        function onSeleccionLogoOrg(event) {
            const file = event.target.files && event.target.files[0];
            if (!file) return;
            if (file.size > 3*1024*1024) { showToast('El logo no debe superar 3 MB', '#FF9F0A'); return; }
            const btn = document.querySelector('[onclick="document.getElementById(\'orgLogoInput\').click()"]');
            if (btn) { btn.disabled = true; btn.textContent = 'Subiendo…'; }
            const reader = new FileReader();
            reader.onload = function(e) {
                const base64 = e.target.result;
                window.api
                    .withSuccessHandler(function(r) {
                        if (btn) { btn.disabled = false; btn.textContent = '📁 Subir logo'; }
                        if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo subir el logo', '#FF453A'); return; }
                        showToast('Logo subido correctamente ✓', '#30D158');
                        const preview = document.getElementById('orgLogoPreview');
                        const delBtn = document.getElementById('orgLogoDeleteBtn');
                        if (preview) preview.innerHTML = '<img src="'+escAttr(r.logoUrl)+'" style="width:100%;height:100%;object-fit:contain;padding:4px">';
                        if (delBtn) delBtn.style.display = '';
                        actualizarMembretePreview();
                    })
                    .withFailureHandler(function(err) {
                        if (btn) { btn.disabled = false; btn.textContent = '📁 Subir logo'; }
                        showToast('Error al subir logo: ' + err.message, '#FF453A');
                    })
                    .uploadLogoOrg({imagenBase64: base64, mimeType: file.type});
            };
            reader.readAsDataURL(file);
        }

        function eliminarLogoOrg() {
            if (!confirm('¿Quitar el logo de empresa? Las cotizaciones mostrarán el nombre en texto.')) return;
            window.api
                .withSuccessHandler(function(r) {
                    if (!r || !r.ok) { showToast((r && r.error) || 'Error', '#FF453A'); return; }
                    showToast('Logo eliminado', '#FF9F0A');
                    const preview = document.getElementById('orgLogoPreview');
                    const delBtn = document.getElementById('orgLogoDeleteBtn');
                    if (preview) preview.innerHTML = '<span style="font-size:12px;color:var(--text-muted,#aaa);text-align:center;padding:4px">Sin logo</span>';
                    if (delBtn) delBtn.style.display = 'none';
                })
                .withFailureHandler(function(e) { showToast('Error: ' + e.message, '#FF453A'); })
                .deleteLogoOrg({});
        }

        /* ── Guardar información personal ─────────────────────── */
        function guardarPerfilInfo() {
            const btn = document.getElementById('pfGuardarBtn');
            const nombre = (v('pfNombre') || '').trim();
            if (!nombre) { showToast('El nombre es requerido', '#FF9F0A'); return; }
            btn.disabled = true; btn.textContent = 'Guardando…';
            window.api
                .withSuccessHandler(function (r) {
                    btn.disabled = false; btn.textContent = 'Guardar cambios';
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo guardar', '#FF453A'); return; }
                    showToast('Perfil actualizado', '#30D158');
                    _usuario = nombre;
                    loadPerfil();
                })
                .withFailureHandler(function (e) { btn.disabled = false; btn.textContent = 'Guardar cambios'; showToast('Error: ' + e.message, '#FF453A'); })
                .updatePerfil({ nombre: nombre, correo: v('pfCorreo'), telefono: v('pfTelefono'), cargo: v('pfCargo') });
        }

        /* ── Preferencias (switches + selects) ────────────────── */
        function onTogglePref(input, switchId) {
            const sw = document.getElementById(switchId);
            if (sw) sw.classList.toggle('on', input.checked);
        }

        function guardarPreferenciasGenerales() {
            const datos = {
                tema: document.getElementById('prefTema').checked ? 'oscuro' : 'claro',
                densidadTabla: document.getElementById('prefDensidad').checked ? 'compacta' : 'comoda',
                paginaInicio: v('prefPaginaInicio'),
                copiarmeCotizaciones: document.getElementById('prefCopia').checked ? 'true' : 'false',
                alertaStockCritico: document.getElementById('prefStock').checked ? 'true' : 'false'
            };
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo guardar', '#FF453A'); return; }
                    showToast('Preferencias guardadas', '#30D158');
                    _perfil.preferencias = r.preferencias;
                    _cachePrefsLocal({ fotoUrl: _perfil.fotoUrl, preferencias: r.preferencias });
                    aplicarPreferencias(r.preferencias);
                })
                .withFailureHandler(function (e) { showToast('Error: ' + e.message, '#FF453A'); })
                .updatePreferencias(datos);
        }

        /* ══════════════════════════════════════════════════════
           FOTO DE PERFIL — flujo con recorte
        ══════════════════════════════════════════════════════ */
        const _crop = {
            file: null, img: null, mimeType: 'image/jpeg',
            zoom: 1, baseScale: 1,
            ox: 0, oy: 0,           // offset desde centro del stage (px display)
            dragging: false, lastX: 0, lastY: 0,
            STAGE: 300, CIRCLE_R: 120  // radio del círculo en px de display
        };

        function onSeleccionFoto(ev) {
            const file = ev.target.files && ev.target.files[0];
            ev.target.value = '';
            if (!file) return;
            const tiposOk = ['image/png', 'image/jpeg', 'image/webp'];
            if (!tiposOk.includes(file.type)) { showToast('Formato no admitido. Usa PNG, JPG o WEBP.', '#FF9F0A'); return; }
            if (file.size > 2 * 1024 * 1024) { showToast('La imagen no debe superar 2 MB', '#FF9F0A'); return; }

            _crop.file = file;
            _crop.mimeType = file.type;
            _crop.zoom = 1; _crop.ox = 0; _crop.oy = 0;

            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    _crop.img = img;
                    // Escala base: la imagen llena el círculo por completo
                    _crop.baseScale = Math.max(
                        (_crop.CIRCLE_R * 2) / img.naturalWidth,
                        (_crop.CIRCLE_R * 2) / img.naturalHeight
                    );
                    _openCropModal();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }

        /* ── Abrir y cerrar modal de recorte ──────────────── */
        function _openCropModal() {
            const ov = document.getElementById('cropOverlay');
            if (!ov) return;
            ov.classList.add('open');
            _renderCropImage();
            _attachCropEvents();
            document.getElementById('cropZoom').value = 1;
        }

        function _cancelCrop() {
            const ov = document.getElementById('cropOverlay');
            if (ov) ov.classList.remove('open');
            _detachCropEvents();
        }

        /* ── Renderizar imagen dentro del stage ───────────── */
        function _renderCropImage() {
            const el = document.getElementById('cropImg');
            if (!el || !_crop.img) return;
            const s = _crop.STAGE;
            const dispW = _crop.img.naturalWidth  * _crop.baseScale * _crop.zoom;
            const dispH = _crop.img.naturalHeight * _crop.baseScale * _crop.zoom;
            // centrado + offset de arrastre
            const left = s / 2 + _crop.ox - dispW / 2;
            const top  = s / 2 + _crop.oy - dispH / 2;
            el.src   = _crop.img.src;
            el.style.width  = dispW + 'px';
            el.style.height = dispH + 'px';
            el.style.left   = left + 'px';
            el.style.top    = top  + 'px';
        }

        /* ── Clamp: la imagen no puede descubrir el círculo ─ */
        function _clampCrop() {
            const dispW = _crop.img.naturalWidth  * _crop.baseScale * _crop.zoom;
            const dispH = _crop.img.naturalHeight * _crop.baseScale * _crop.zoom;
            const r = _crop.CIRCLE_R;
            const maxOx = Math.max(0, dispW / 2 - r);
            const maxOy = Math.max(0, dispH / 2 - r);
            _crop.ox = Math.max(-maxOx, Math.min(maxOx, _crop.ox));
            _crop.oy = Math.max(-maxOy, Math.min(maxOy, _crop.oy));
        }

        /* ── Zoom slider ──────────────────────────────────── */
        function _onCropZoom(val) {
            _crop.zoom = parseFloat(val);
            _clampCrop();
            _renderCropImage();
        }

        /* ── Eventos de arrastre (mouse + touch) ──────────── */
        function _onCropPointerDown(e) {
            _crop.dragging = true;
            const pt = e.touches ? e.touches[0] : e;
            _crop.lastX = pt.clientX; _crop.lastY = pt.clientY;
        }
        function _onCropPointerMove(e) {
            if (!_crop.dragging) return;
            e.preventDefault();
            const pt = e.touches ? e.touches[0] : e;
            _crop.ox += pt.clientX - _crop.lastX;
            _crop.oy += pt.clientY - _crop.lastY;
            _crop.lastX = pt.clientX; _crop.lastY = pt.clientY;
            _clampCrop();
            _renderCropImage();
        }
        function _onCropPointerUp() { _crop.dragging = false; }

        function _attachCropEvents() {
            const stage = document.getElementById('cropStage');
            if (!stage) return;
            stage.addEventListener('mousedown',  _onCropPointerDown);
            stage.addEventListener('touchstart', _onCropPointerDown, { passive: true });
            window.addEventListener('mousemove',  _onCropPointerMove);
            window.addEventListener('touchmove',  _onCropPointerMove, { passive: false });
            window.addEventListener('mouseup',    _onCropPointerUp);
            window.addEventListener('touchend',   _onCropPointerUp);
        }
        function _detachCropEvents() {
            const stage = document.getElementById('cropStage');
            if (stage) {
                stage.removeEventListener('mousedown',  _onCropPointerDown);
                stage.removeEventListener('touchstart', _onCropPointerDown);
            }
            window.removeEventListener('mousemove',  _onCropPointerMove);
            window.removeEventListener('touchmove',  _onCropPointerMove);
            window.removeEventListener('mouseup',    _onCropPointerUp);
            window.removeEventListener('touchend',   _onCropPointerUp);
        }

        /* ── Exportar recorte y subir ─────────────────────── */
        function _confirmCropAndUpload() {
            const btn = document.getElementById('cropConfirmBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Subiendo…'; }

            const OUT = 300; // tamaño del canvas de salida
            const displayDiam = _crop.CIRCLE_R * 2; // 240px
            const ratio = OUT / displayDiam; // 300/240 = 1.25

            const canvas = document.createElement('canvas');
            canvas.width = OUT; canvas.height = OUT;
            const ctx = canvas.getContext('2d');

            // Clip circular
            ctx.beginPath();
            ctx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2);
            ctx.clip();

            // Calcular posición de la imagen en el canvas de salida
            const dispW = _crop.img.naturalWidth  * _crop.baseScale * _crop.zoom;
            const dispH = _crop.img.naturalHeight * _crop.baseScale * _crop.zoom;
            const cImgW  = dispW * ratio;
            const cImgH  = dispH * ratio;
            const cImgLeft = OUT / 2 + _crop.ox * ratio - cImgW / 2;
            const cImgTop  = OUT / 2 + _crop.oy * ratio - cImgH / 2;

            ctx.drawImage(_crop.img, cImgLeft, cImgTop, cImgW, cImgH);

            canvas.toBlob(function (blob) {
                const reader = new FileReader();
                reader.onload = function () {
                    window.api
                        .withSuccessHandler(function (r) {
                            if (btn) { btn.disabled = false; btn.textContent = 'Subir foto'; }
                            _cancelCrop();
                            if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo subir la foto', '#FF453A'); return; }
                            showToast('Foto de perfil actualizada ✓', '#30D158');
                            _perfil.fotoUrl = r.fotoUrl;
                            _cachePrefsLocal({ fotoUrl: r.fotoUrl, preferencias: _perfil.preferencias });
                            _aplicarAvatarSidebar();
                            renderPerfil();
                        })
                        .withFailureHandler(function (e) {
                            if (btn) { btn.disabled = false; btn.textContent = 'Subir foto'; }
                            _cancelCrop();
                            showToast('Error: ' + e.message, '#FF453A');
                        })
                        .uploadFotoPerfil({ imagenBase64: reader.result, mimeType: 'image/jpeg' });
                };
                reader.readAsDataURL(blob);
            }, 'image/jpeg', 0.92);
        }

        /* ── Eliminar foto ────────────────────────────────── */
        function eliminarFotoPerfil() {
            window.api
                .withSuccessHandler(function (r) {
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo eliminar la foto', '#FF453A'); return; }
                    showToast('Foto de perfil eliminada', '#30D158');
                    _perfil.fotoUrl = '';
                    _cachePrefsLocal({ fotoUrl: '', preferencias: _perfil.preferencias });
                    _aplicarAvatarSidebar();
                    renderPerfil();
                })
                .withFailureHandler(function (e) { showToast('Error: ' + e.message, '#FF453A'); })
                .deleteFotoPerfil({});
        }

        /* ── Cambio de contraseña ──────────────────────────────── */
        function guardarNuevaContrasena() {
            const actual = v('pwActual'), nueva = v('pwNueva'), confirmar = v('pwConfirmar');
            if (!actual || !nueva) { showToast('Completa la contraseña actual y la nueva', '#FF9F0A'); return; }
            if (nueva.length < 6) { showToast('La nueva contraseña debe tener al menos 6 caracteres', '#FF9F0A'); return; }
            if (nueva !== confirmar) { showToast('Las contraseñas nuevas no coinciden', '#FF9F0A'); return; }

            const btn = document.getElementById('pwGuardarBtn');
            btn.disabled = true; btn.textContent = 'Actualizando…';
            window.api
                .withSuccessHandler(function (r) {
                    btn.disabled = false; btn.textContent = 'Actualizar contraseña';
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo actualizar', '#FF453A'); return; }
                    showToast('Contraseña actualizada. Tus otras sesiones se cerraron.', '#30D158');
                    ['pwActual', 'pwNueva', 'pwConfirmar'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
                })
                .withFailureHandler(function (e) { btn.disabled = false; btn.textContent = 'Actualizar contraseña'; showToast('Error: ' + e.message, '#FF453A'); })
                .changePasswordPropio({ actual: actual, nueva: nueva });
        }

        /* ═══════════════════════════════════════════════════════════
           GESTIÓN DE SUCURSALES (MULTI-TIENDA) — ADMIN
        ═══════════════════════════════════════════════════════════ */
        let _adminSucursales = [];

        function loadSucursalesAdmin() {
            const tbody = document.getElementById('sucursalesAdminTbody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">Cargando sucursales…</td></tr>';
            window.api
                .withSuccessHandler(function(r) {
                    if (!r || !r.ok) {
                        if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell" style="color:var(--danger)">Error: ${escHtml((r && r.error) || 'No se pudieron cargar las sucursales')}</td></tr>`;
                        return;
                    }
                    _adminSucursales = r.data || [];
                    renderSucursalesAdmin();
                })
                .withFailureHandler(function(e) {
                    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="empty-cell" style="color:var(--danger)">Error de conexión: ${escHtml(e.message)}</td></tr>`;
                })
                .getSucursales();
        }
        window.loadSucursalesAdmin = loadSucursalesAdmin;

        function renderSucursalesAdmin() {
            const tbody = document.getElementById('sucursalesAdminTbody');
            if (!tbody) return;

            if (!_adminSucursales.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No hay sucursales registradas aún. Haz clic en "Nueva Sucursal" para añadir la primera.</td></tr>';
                return;
            }

            tbody.innerHTML = _adminSucursales.map(function(s) {
                const activa = s.activa !== false;
                const central = !!s.es_central;

                return `<tr>
                    <td style="font-weight:700;color:var(--text-primary)">
                        ${escHtml(s.nombre)}
                    </td>
                    <td style="font-size:12px;font-family:monospace;color:var(--text-secondary)">
                        ${escHtml(s.codigo || '—')}
                    </td>
                    <td style="font-size:12.5px;color:var(--text-secondary)">
                        ${escHtml(s.direccion || '—')}
                    </td>
                    <td style="font-size:12.5px;color:var(--text-secondary)">
                        ${escHtml(s.telefono || '—')}
                    </td>
                    <td>
                        <span class="tag ${central ? 'tag-accent' : 'tag-gray'}" style="font-size:11px">
                            ${central ? '★ Central' : 'Sucursal'}
                        </span>
                    </td>
                    <td>
                        <span class="tag ${activa ? 'tag-success' : 'tag-gray'}" style="font-size:11px">
                            ${activa ? '● Activa' : '○ Inactiva'}
                        </span>
                    </td>
                    <td style="text-align:right;white-space:nowrap">
                        <button class="btn-ghost" style="padding:4px 8px;font-size:12px;margin-right:4px" onclick="abrirModalSucursal('${escAttr(s.id)}')">
                            Editar
                        </button>
                        ${!central ? `
                        <button class="btn-ghost" style="padding:4px 8px;font-size:12px;color:var(--danger)" onclick="confirmDeleteSucursal('${escAttr(s.id)}', '${escAttr(s.nombre)}')">
                            Eliminar
                        </button>` : ''}
                    </td>
                </tr>`;
            }).join('');
        }

        function abrirModalSucursal(sucId) {
            const esEdit = !!sucId;
            const s = esEdit ? _adminSucursales.find(x => String(x.id) === String(sucId)) || {} : {};

            _modalMode = { type: 'sucursal', action: esEdit ? 'edit' : 'add', id: sucId || null };

            openModal(esEdit ? 'Editar Sucursal' : 'Nueva Sucursal', `
                <div class="form-row">
                    <div class="form-field">
                        <label class="form-label">NOMBRE DE LA SUCURSAL *</label>
                        <input class="form-input" id="mSucNombre" value="${escAttr(s.nombre || '')}" placeholder="Ej. Tienda Central Zona 10" />
                    </div>
                    <div class="form-field">
                        <label class="form-label">CÓDIGO DE IDENTIFICACIÓN</label>
                        <input class="form-input" id="mSucCodigo" value="${escAttr(s.codigo || '')}" placeholder="Ej. SUC-01" />
                    </div>
                </div>
                <div class="form-field">
                    <label class="form-label">DIRECCIÓN FÍSICA</label>
                    <input class="form-input" id="mSucDireccion" value="${escAttr(s.direccion || '')}" placeholder="Ej. 12 Calle 4-55 Zona 10, C.C. Plaza, Local 14" />
                </div>
                <div class="form-row">
                    <div class="form-field">
                        <label class="form-label">TELÉFONO DE CONTACTO</label>
                        <input class="form-input" id="mSucTelefono" value="${escAttr(s.telefono || '')}" placeholder="Ej. +502 2333-4455" />
                    </div>
                    <div class="form-field">
                        <label class="form-label">ESTADO</label>
                        <select class="form-select" id="mSucActiva">
                            <option value="true" ${s.activa !== false ? 'selected' : ''}>Activa</option>
                            <option value="false" ${s.activa === false ? 'selected' : ''}>Inactiva</option>
                        </select>
                    </div>
                </div>
                <div class="form-field" style="margin-top:8px">
                    <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
                        <input type="checkbox" id="mSucEsCentral" ${s.es_central ? 'checked' : ''} />
                        <span>Establecer como Sucursal Principal / Casa Central</span>
                    </label>
                </div>
            `);
        }
        window.abrirModalSucursal = abrirModalSucursal;

        function handleSaveSucursal(m, saveBtn) {
            const nom = (document.getElementById('mSucNombre') || {}).value.trim();
            if (!nom) {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
                showToast('El nombre de la sucursal es obligatorio', '#FF9F0A');
                return;
            }

            const data = {
                nombre: nom,
                codigo: (document.getElementById('mSucCodigo') || {}).value.trim(),
                direccion: (document.getElementById('mSucDireccion') || {}).value.trim(),
                telefono: (document.getElementById('mSucTelefono') || {}).value.trim(),
                activa: (document.getElementById('mSucActiva') || {}).value === 'true',
                es_central: !!(document.getElementById('mSucEsCentral') && document.getElementById('mSucEsCentral').checked)
            };

            const cbDone = function(r) {
                if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Guardar'; }
                if (!r || !r.ok) {
                    showToast('Error: ' + ((r && r.error) || 'No se pudo guardar la sucursal'), '#FF453A');
                    return;
                }
                closeModal();
                showToast(m.action === 'add' ? 'Sucursal creada exitosamente ✓' : 'Sucursal actualizada ✓', '#30D158');
                window._sucursalesCache = null; // invalidar cache
                loadSucursalesAdmin();
            };

            if (m.action === 'add') {
                window.api.withSuccessHandler(cbDone).addSucursal(data);
            } else {
                window.api.withSuccessHandler(cbDone).updateSucursal(m.id, data);
            }
        }
        window.handleSaveSucursal = handleSaveSucursal;

        function confirmDeleteSucursal(sucId, nombre) {
            if (!confirm(`¿Estás seguro de eliminar la sucursal "${nombre}"?`)) return;
            window.api
                .withSuccessHandler(function(r) {
                    if (!r || !r.ok) {
                        showToast('Error al eliminar: ' + ((r && r.error) || 'Desconocido'), '#FF453A');
                        return;
                    }
                    showToast('Sucursal eliminada ✓', '#30D158');
                    window._sucursalesCache = null;
                    loadSucursalesAdmin();
                })
                .deleteSucursal(sucId);
        }
        window.confirmDeleteSucursal = confirmDeleteSucursal;

        function _onPaisChange(sel) {
            if (!sel || !sel.value) return;
            const pais = sel.value;
            const ivaInp = document.getElementById('orgIva');
            const modSel = document.getElementById('orgIvaModalidad');
            const monSel = document.getElementById('orgMoneda');
            const nitInp = document.getElementById('orgTipoDocFiscal');

            const configPorPais = {
                'GT': { iva: 12, mod: 'incluido', moneda: 'Q', doc: 'NIT' },
                'SV': { iva: 13, mod: 'incluido', moneda: '$', doc: 'NIT' },
                'HN': { iva: 15, mod: 'sobre',    moneda: 'L', doc: 'RTN' },
                'NI': { iva: 15, mod: 'sobre',    moneda: 'C$', doc: 'RUC' },
                'CR': { iva: 13, mod: 'incluido', moneda: '$', doc: 'Cédula Jurídica' },
                'PA': { iva: 7,  mod: 'sobre',    moneda: '$', doc: 'RUC' },
                'MX': { iva: 16, mod: 'incluido', moneda: '$', doc: 'RFC' },
                'CO': { iva: 19, mod: 'sobre',    moneda: '$', doc: 'NIT' },
                'US': { iva: 0,  mod: 'sobre',    moneda: '$', doc: 'Tax ID' },
                'OT': { iva: 0,  mod: 'incluido', moneda: '$', doc: 'NIT' }
            };

            const c = configPorPais[pais];
            if (c) {
                if (ivaInp) ivaInp.value = c.iva;
                if (modSel) modSel.value = c.mod;
                if (monSel && c.moneda) {
                    const opt = [...monSel.options].find(o => o.value === c.moneda);
                    if (opt) opt.selected = true;
                }
                if (nitInp) nitInp.value = c.doc;
                showToast('Parámetros fiscales sugeridos para ' + pais + ' aplicados', '#0A84FF');
            }
        }
        window._onPaisChange = _onPaisChange;
