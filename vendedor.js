/* ═══════════════════════════════════════════════════════════════════════
   vendedor.js — Restricciones de rol Vendedor · Azyvion CRM
   -----------------------------------------------------------------------
   ARQUITECTURA DE SEGURIDAD — ROL VENDEDOR
   ═══════════════════════════════════════════════════════════════════════

   CAPA 1 — Base de datos (Supabase RLS)
   ────────────────────────────────────
   Aplicar las siguientes políticas en Supabase → Authentication → Policies:

   Tabla: Clientes
     • SELECT: auth.uid() en Usuarios.auth_uid WHERE Usuarios.rol = 'Admin'
               OR (Usuarios.rol = 'Vendedor' AND clientes.creadoPor = Usuarios.usuario)
     • INSERT: Vendedor puede insertar; se fuerza creadoPor = Usuarios.usuario en backend
     • UPDATE: Vendedor solo puede actualizar filas donde creadoPor = su usuario
     • DELETE: solo Admin/Gerente

   SQL de ejemplo (ejecutar en Supabase SQL Editor):
   ──────────────────────────────────────────────────
     -- Habilitar RLS en Clientes (si no está)
     ALTER TABLE "Clientes" ENABLE ROW LEVEL SECURITY;

     -- Policy SELECT para Vendedor
     CREATE POLICY "vendedor_select_propios" ON "Clientes"
       FOR SELECT USING (
         auth.uid() IN (
           SELECT auth_uid FROM "Usuarios"
           WHERE rol IN ('Admin','Gerente','Agente')
             AND organization_id = "Clientes".organization_id
         )
         OR (
           auth.uid() IN (
             SELECT auth_uid FROM "Usuarios"
             WHERE rol = 'Vendedor'
               AND usuario = "Clientes"."creadoPor"
               AND organization_id = "Clientes".organization_id
           )
         )
       );

     -- Policy UPDATE para Vendedor (solo sus clientes)
     CREATE POLICY "vendedor_update_propios" ON "Clientes"
       FOR UPDATE USING (
         auth.uid() IN (
           SELECT auth_uid FROM "Usuarios"
           WHERE rol IN ('Admin','Gerente','Agente')
         )
         OR (
           auth.uid() IN (
             SELECT auth_uid FROM "Usuarios"
             WHERE rol = 'Vendedor' AND usuario = "Clientes"."creadoPor"
           )
         )
       );

     -- Policy DELETE: solo Admin/Gerente
     CREATE POLICY "admin_delete_clientes" ON "Clientes"
       FOR DELETE USING (
         auth.uid() IN (
           SELECT auth_uid FROM "Usuarios" WHERE rol IN ('Admin','Gerente')
         )
       );

   CAPA 2 — Backend JS (_dispatch en auth.js)
   ───────────────────────────────────────────
   • _VENDEDOR_BLOCKED: Set de operaciones completamente denegadas
   • deleteCliente: bloqueado para Vendedor
   • _getClientes(): filtra .eq('creadoPor', nombreUsuario) si VENDEDOR
   • _getResumen(): filtra clientes propios para KPIs
   • _getDashboardInit(): no carga prospectos/inventario/encuestas/cotizaciones/contabilidad

   CAPA 3 — UI/UX (este módulo + clientes.js)
   ────────────────────────────────────────────
   • Sidebar: oculta Inicio, Prospectos, Cotizaciones, Inventario,
              Encuestas, Finanzas/Contabilidad, Config/Usuarios, SaaS
   • Tabla Clientes: columna "Creado por" en lugar de "Ejecutivo"
   • Acciones fila: "Editar" solo activo si c.creadoPor === usuario logueado
   • Página de inicio forzada: Clientes
   • loadAll: no ejecuta loadProspectos/Inventario/Encuestas/Cotizaciones

   COLUMNA REQUERIDA EN BD
   ───────────────────────
   La tabla Clientes debe tener la columna `creadoPor` (TEXT).
   Si no existe, ejecutar:
     ALTER TABLE "Clientes" ADD COLUMN IF NOT EXISTS "creadoPor" TEXT DEFAULT '';
   Los nuevos clientes ya se insertan con creadoPor = usuario logueado (ver auth.js).
   Para clientes existentes sin valor, se recomienda:
     UPDATE "Clientes" SET "creadoPor" = '' WHERE "creadoPor" IS NULL;

═══════════════════════════════════════════════════════════════════════ */

(function _vendedorModule() {
    'use strict';

    /* Sólo aplica si el rol es Vendedor */
    function _isVendedor() {
        return typeof esVendedor === 'function' && esVendedor();
    }

    /* Nombre del usuario logueado */
    function _myUsername() {
        try {
            const s = JSON.parse(localStorage.getItem('azyvion_session') || 'null');
            return s ? (s.usuario || s.nombre || '') : '';
        } catch (e) { return ''; }
    }

    /* ── 1. INTERCEPTAR showPage para bloquear páginas prohibidas ──────── */
    document.addEventListener('DOMContentLoaded', function () {
        if (!_isVendedor()) return;

        const PAGINAS_BLOQUEADAS = new Set([
            'overview','prospectos','cotizaciones','inventario',
            'encuestas','contabilidad','usuarios','suscripciones'
        ]);

        const _origShowPage = window.showPage;
        if (typeof _origShowPage === 'function') {
            window.showPage = function (id, navEl) {
                if (PAGINAS_BLOQUEADAS.has(id)) {
                    showToast('Tu rol no tiene acceso a esta sección', '#FF9F0A');
                    // Redirigir a clientes en lugar de bloquear sin feedback
                    _origShowPage('clientes', document.getElementById('nav-clientes'));
                    return;
                }
                _origShowPage(id, navEl);
            };
        }

        /* ── 2. BADGE VISUAL en sidebar para rol Vendedor ────────────── */
        const roleEl = document.getElementById('userRole');
        if (roleEl) {
            roleEl.style.background = 'rgba(59,110,245,.15)';
            roleEl.style.color = 'var(--accent)';
            roleEl.style.padding = '2px 8px';
            roleEl.style.borderRadius = '20px';
            roleEl.style.fontSize = '11px';
            roleEl.style.fontWeight = '700';
        }

        /* ── 3. BANNER INFORMATIVO en página de clientes ─────────────── */
        _inyectarBannerVendedor();

        /* ── 4. OCULTAR columna "Nuevo cliente" si Vendedor lo desea ─── */
        // (los vendedores SÍ pueden crear clientes, así que no se oculta)

        /* ── 5. GUARDAR refreshCurrent para que solo refresque clientes ─ */
        const _origRefresh = window.refreshCurrent;
        window.refreshCurrent = function () {
            if (_isVendedor()) {
                loadClientes();
                loadResumen();
                showToast('Datos actualizados', '#30D158');
                return;
            }
            if (typeof _origRefresh === 'function') _origRefresh();
        };
    });

    /* ── Banner informativo para Vendedor ──────────────────────────── */
    function _inyectarBannerVendedor() {
        // Se inyecta en la página de clientes como primer hijo del section
        const section = document.getElementById('page-clientes');
        if (!section || document.getElementById('az-vendedor-banner')) return;

        const me = _myUsername();
        const banner = document.createElement('div');
        banner.id = 'az-vendedor-banner';
        banner.style.cssText = [
            'display:flex','align-items:center','gap:10px',
            'background:var(--accent-bg)','border:1px solid rgba(59,110,245,.2)',
            'border-radius:10px','padding:10px 16px','margin:0 0 14px',
            'font-size:13px','color:var(--text-secondary)'
        ].join(';');
        banner.innerHTML = `
            <svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:var(--accent);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            <span>Mostrando únicamente los clientes creados por <strong>${escHtml ? escHtml(me) : me}</strong>.
            Los KPIs y el valor ganado corresponden solo a tu cartera.</span>`;

        // Insertar como primer hijo del contenido de la página
        const firstChild = section.firstChild;
        section.insertBefore(banner, firstChild);
    }

    /* ── CSS adicional para el rol Vendedor ────────────────────────── */
    (function _vendedorCSS() {
        if (document.getElementById('az-vendedor-css')) return;
        const s = document.createElement('style');
        s.id = 'az-vendedor-css';
        s.textContent = `
/* Marcar visualmente celdas de "Creado por" */
#clientesTbody td:nth-child(3) {
    font-size: 12px;
    color: var(--accent);
    font-weight: 500;
}
/* Indicador de cliente "sin acceso" en la fila (cliente de otro vendedor)
   — no debería aparecer ya que el backend solo devuelve los propios,
   pero se deja como fallback visual */
.az-no-access {
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
}
        `;
        document.head.appendChild(s);
    })();

})();
