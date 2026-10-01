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
      </div>
      <div class="ajustes-row">
        <div class="ajustes-row-label"><div class="ajustes-row-name">% IVA</div><div class="ajustes-row-desc">Porcentaje de impuesto aplicado por defecto</div></div>
        <div class="ajustes-row-control" style="max-width:120px"><input class="form-input" id="orgIva" type="number" min="0" max="50" placeholder="12" oninput="actualizarMembretePreview()"/></div>
      </div>
      <div class="ajustes-row" style="align-items:flex-start">
        <div class="ajustes-row-label"><div class="ajustes-row-name">Condiciones por defecto</div><div class="ajustes-row-desc">Texto de condiciones en nuevas cotizaciones</div></div>
        <div class="ajustes-row-control"><textarea class="form-input" id="orgCondiciones" rows="3" style="resize:vertical"></textarea></div>
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
          </div>
        </div>
      </div>

      <div class="ajustes-footer"><button class="btn-save" id="orgGuardarBtn" onclick="guardarOrgConfig()">Guardar empresa</button></div>
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
                if (tab === 'empresa') loadOrgConfigPanel();
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
                    setVal('orgCondiciones', d.condiciones_default);
                    setVal('orgPrefijoCot', d.prefijo_cotizacion || 'COT-');
                    setVal('orgPrefijoPos', d.prefijo_ticket || 'POS-');
                    const monSel = document.getElementById('orgMoneda');
                    if (monSel && d.moneda) {
                        const opt = [...monSel.options].find(o => o.value === d.moneda);
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
            const nit = (document.getElementById('orgNit') || {}).value || 'C/F';
            const tel = (document.getElementById('orgTelefono') || {}).value || '—';
            const cor = (document.getElementById('orgCorreo') || {}).value || '—';
            const dir = (document.getElementById('orgDireccion') || {}).value || '—';
            const prefCot = (document.getElementById('orgPrefijoCot') || {}).value || 'COT-';
            const prefPos = (document.getElementById('orgPrefijoPos') || {}).value || 'POS-';
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
            const btn = document.getElementById('orgGuardarBtn');
            const nombre = (document.getElementById('orgNombre') && document.getElementById('orgNombre').value || '').trim();
            if (!nombre) { showToast('El nombre de empresa es requerido', '#FF9F0A'); return; }
            btn.disabled = true; btn.textContent = 'Guardando…';
            const datos = {
                nombre: nombre,
                eslogan: v('orgEslogan'),
                nit: v('orgNit'),
                telefono: v('orgTelefono'),
                correo: v('orgCorreo'),
                sitio: v('orgSitio'),
                direccion: v('orgDireccion'),
                moneda: v('orgMoneda'),
                iva_pct: Number(v('orgIva')) || 12,
                condiciones_default: v('orgCondiciones'),
                prefijo_cotizacion: (document.getElementById('orgPrefijoCot') || {}).value || 'COT-',
                prefijo_ticket: (document.getElementById('orgPrefijoPos') || {}).value || 'POS-'
            };
            window.api
                .withSuccessHandler(function(r) {
                    btn.disabled = false; btn.textContent = 'Guardar configuración';
                    if (!r || !r.ok) { showToast((r && r.error) || 'No se pudo guardar', '#FF453A'); return; }
                    showToast('Configuración de empresa guardada ✓', '#30D158');
                })
                .withFailureHandler(function(e) { btn.disabled = false; btn.textContent = 'Guardar configuración'; showToast('Error: ' + e.message, '#FF453A'); })
                .saveOrgConfig(datos);
        }

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
