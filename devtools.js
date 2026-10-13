/* ═══════════════════════════════════════════════════════════════════
   devtools.js — Consola Maestra de Desarrollador Azyvion
   Acceso rápido: Ctrl + Shift + D  (o botón flotante 🛠️)
═══════════════════════════════════════════════════════════════════ */

(function () {
    'use strict';

    window.AZYVION_DEV = {
        enabled: true,
        masterPass: 'azyvion2026'
    };

    /* ── ABRIR / CERRAR PANEL DEV ───────────────────────────────── */
    window.toggleDevTools = function () {
        const el = document.getElementById('devToolsModal');
        if (!el) return;
        const isVisible = el.style.display === 'flex';
        el.style.display = isVisible ? 'none' : 'flex';
        if (!isVisible) _renderDevInfo();
    };

    /* ── DETECCIÓN DE ATAJO DE TECLADO (Ctrl + Shift + D) ───────── */
    document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
            e.preventDefault();
            window.toggleDevTools();
        }
    });

    /* ── CAMBIO INSTANTÁNEO DE PLAN ─────────────────────────────── */
    window.devSwitchPlan = function (planId) {
        try {
            const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
            u.plan_id = planId;
            if (!u.empresa) u.empresa = {};
            u.empresa.plan_id = planId;
            u.empresa.estado = 'ACTIVE';
            u.estado = 'ACTIVE';

            if (planId === 'superadmin') {
                u.rol = 'superadmin';
                u.is_superadmin = true;
                window._esSuperAdmin = true;
            }

            localStorage.setItem('crm_user', JSON.stringify(u));
            localStorage.removeItem('azyvion_trial_start');

            // Ocultar paywall si estaba visible
            const pw = document.getElementById('paywallModal');
            if (pw) pw.style.display = 'none';

            // Actualizar banner
            const b = document.getElementById('trialCountdownBanner');
            if (b) b.style.display = 'none';

            showToast('🛠️ [DEV] Plan cambiado a: ' + planId.toUpperCase(), '#38BDF8');
            _renderDevInfo();

            // Refrescar vistas si aplica
            if (typeof renderCurrentUserInfo === 'function') renderCurrentUserInfo();
        } catch (e) {
            console.error('Error cambiando plan dev:', e);
        }
    };

    /* ── BYPASS DE PAYWALL ──────────────────────────────────────── */
    window.devBypassPaywall = function () {
        const pw = document.getElementById('paywallModal');
        if (pw) pw.style.display = 'none';
        showToast('🔓 [DEV] Paywall desactivado temporalmente', '#38BDF8');
    };

    /* ── RESETEAR TRIAL A 4 DÍAS ────────────────────────────────── */
    window.devResetTrial = function () {
        try {
            const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
            u.estado = 'TRIAL';
            if (u.empresa) {
                u.empresa.estado = 'TRIAL';
                u.empresa.fecha_fin = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            }
            localStorage.setItem('crm_user', JSON.stringify(u));
            localStorage.setItem('azyvion_trial_start', Date.now());

            // Ocultar paywall
            const pw = document.getElementById('paywallModal');
            if (pw) pw.style.display = 'none';

            // Re-ejecutar check de trial
            if (typeof window.checkTrialAndPlanStatus === 'function') {
                window.checkTrialAndPlanStatus();
            }

            showToast('⏱️ [DEV] Trial reseteado a 4 días restantes', '#38BDF8');
            _renderDevInfo();
        } catch (e) {
            console.error(e);
        }
    };

    /* ── SIMULAR TRIAL VENCIDO (FORZAR PAYWALL) ─────────────────── */
    window.devExpireTrial = function () {
        try {
            const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
            u.estado = 'EXPIRED';
            if (u.empresa) {
                u.empresa.estado = 'EXPIRED';
                u.empresa.fecha_fin = '2020-01-01';
            }
            localStorage.setItem('crm_user', JSON.stringify(u));
            localStorage.setItem('azyvion_trial_start', Date.now() - (5 * 24 * 60 * 60 * 1000));

            const pw = document.getElementById('paywallModal');
            if (pw) pw.style.display = 'flex';

            showToast('🔒 [DEV] Simulación: Trial vencido (Paywall activo)', '#FF453A');
            _renderDevInfo();
        } catch (e) {
            console.error(e);
        }
    };

    /* ── SIMULAR COBRO BANCARIO EXITOSO ─────────────────────────── */
    window.devSimularCobro = function (planId, monto) {
        planId = planId || 'pro';
        monto = monto || 149;
        if (typeof window.openSubscriptionCheckout === 'function') {
            window.openSubscriptionCheckout(planId);
            setTimeout(function () {
                const inpCard = document.getElementById('chkCardNum');
                const inpExp = document.getElementById('chkCardExp');
                const inpCvv = document.getElementById('chkCardCvv');
                const inpName = document.getElementById('chkCardName');
                if (inpCard) { inpCard.value = '4242 4242 4242 4242'; window.onCardNumberInput({ target: inpCard }); }
                if (inpExp) { inpExp.value = '12/28'; window.onCardExpInput({ target: inpExp }); }
                if (inpCvv) inpCvv.value = '123';
                if (inpName) inpName.value = 'DESARROLLADOR AZYVION';
                showToast('💳 Tarjeta de prueba rellenada automáticamente. Haz clic en Confirmar Pago.', '#38BDF8');
            }, 300);
        }
    };

    /* ── LIMPIAR CACHÉ TOTAL ────────────────────────────────────── */
    window.devLimpiarCache = function () {
        localStorage.removeItem('azyvion_dash_v1');
        sessionStorage.clear();
        showToast('🧹 [DEV] Caché local eliminada. Recargando…', '#38BDF8');
        setTimeout(() => location.reload(), 600);
    };

    /* ── RENDERIZAR INFO DE DESARROLLADOR ───────────────────────── */
    function _renderDevInfo() {
        const box = document.getElementById('devInfoContent');
        if (!box) return;
        try {
            const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
            const org = u.empresa || {};
            const plan = (org.plan_id || u.plan_id || 'starter').toUpperCase();
            const estado = org.estado || u.estado || 'TRIAL';
            const orgId = org.id || u.organization_id || 'org_demo';

            box.innerHTML = `
                <div><strong>Usuario:</strong> ${u.correo || u.email || 'Admin Local'}</div>
                <div><strong>Rol:</strong> ${u.rol || 'admin'} · <strong>SuperAdmin:</strong> ${!!(u.is_superadmin || window._esSuperAdmin)}</div>
                <div><strong>Organization ID:</strong> <span style="color:#38bdf8">${orgId}</span></div>
                <div><strong>Plan Activo:</strong> <span style="color:#4ade80">${plan}</span> · <strong>Estado:</strong> ${estado}</div>
                <div><strong>Supabase Conectado:</strong> ${window._sb ? '✅ SÍ (Online)' : '⚠️ No (Modo Local)'}</div>
                <div><strong>Pasarela Banco:</strong> ${window.CONFIG_PASARELA_BANCO?.proveedor || 'DIRECTO_SANDBOX'}</div>
            `;
        } catch (e) {
            box.textContent = 'Error cargando info: ' + e.message;
        }
    }

    console.log('[Azyvion DevTools] Consola de Desarrollador activa. Presiona Ctrl + Shift + D para abrir.');
})();
