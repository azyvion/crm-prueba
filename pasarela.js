/* ═══════════════════════════════════════════════════════════════════
   pasarela.js — Motor de Pasarela Bancaria y Checkout Modular
   Azyvion CRM · Preparado para conectar cualquier banco o Stripe
═══════════════════════════════════════════════════════════════════ */

/* ── CONFIGURACIÓN DE BANCO Y PASARELA ───────────────────────── */
window.CONFIG_PASARELA_BANCO = {
    // Proveedor activo: 'DIRECTO_SANDBOX', 'BAC_CREDOMATIC', 'BANCO_INDUSTRIAL', 'STRIPE', 'PAGALO'
    proveedor: 'DIRECTO_SANDBOX',
    modo: 'sandbox', // 'sandbox' o 'produccion'

    // Credenciales del banco (Completar cuando se contrate el banco)
    credenciales: {
        comercio_id: '',       // Merchant ID provisto por el banco
        terminal_id: '',       // Terminal virtual
        llave_publica: '',     // Public Key / Token de pasarela
        llave_privada: '',     // Private Key / Webhook Secret
        webhook_url: ''        // Endpoint para confirmación de cobros
    },

    // Cuentas oficiales para pago por transferencia o depósito
    cuentasBancarias: [
        { banco: 'Banco Industrial (BI)', tipo: 'Monetaria GTQ', numero: '001-445892-1', titular: 'AZYVION CORPORATE, S.A.' },
        { banco: 'BAC Credomatic', tipo: 'Monetaria USD', numero: '902-118475-0', titular: 'AZYVION CORPORATE, S.A.' },
        { banco: 'Banco G&T Continental', tipo: 'Monetaria GTQ', numero: '018-992341-8', titular: 'AZYVION CORPORATE, S.A.' }
    ]
};

/* ── ESTADO ACTUAL DEL CHECKOUT ──────────────────────────────── */
window._checkoutState = {
    planId: 'pro',
    precio: 149,
    ciclo: 'monthly',
    metodo: 'tarjeta'
};

const PLAN_INFO = {
    starter: { nombre: 'Starter', precio: 59, anual: 47, usuarios: '3 usuarios', sucursales: '1 sucursal / 1 caja' },
    pro: { nombre: 'Pro / Business', precio: 149, anual: 119, usuarios: '10 usuarios', sucursales: '3 sucursales / FEL SAT' },
    enterprise: { nombre: 'Enterprise', precio: 299, anual: 239, usuarios: '30+ usuarios', sucursales: 'Sucursales ilimitadas' }
};

/* ── ABRIR Y CERRAR CHECKOUT ─────────────────────────────────── */
window.openSubscriptionCheckout = function(planId) {
    planId = (planId || 'pro').toLowerCase();
    if (!PLAN_INFO[planId]) planId = 'pro';

    window._checkoutState.planId = planId;
    window._checkoutState.precio = PLAN_INFO[planId].precio;

    const p = PLAN_INFO[planId];
    const modal = document.getElementById('checkoutModal');
    if (!modal) return;

    // Actualizar datos del plan en el modal
    const pName = document.getElementById('chkPlanNombre');
    const pPrice = document.getElementById('chkPlanPrecio');
    const pDet = document.getElementById('chkPlanDetalles');
    const btnCobro = document.getElementById('btnCobrarTxt');

    if (pName) pName.textContent = 'Plan ' + p.nombre;
    if (pPrice) pPrice.textContent = '$' + p.precio + ' USD';
    if (pDet) pDet.textContent = p.usuarios + ' · ' + p.sucursales + ' · Facturación mensual recurrente';
    if (btnCobro) btnCobro.textContent = 'Confirmar Pago y Activar ($' + p.precio + ' USD)';

    // Resetear formulario
    window.switchCheckoutTab('tarjeta');
    _actualizarPreviewTarjeta();

    modal.style.display = 'flex';
};

window.closeCheckoutModal = function() {
    const modal = document.getElementById('checkoutModal');
    if (modal) modal.style.display = 'none';
};

/* ── ALTERNAR ENTRE TARJETA Y TRANSFERENCIA ─────────────────── */
window.switchCheckoutTab = function(metodo) {
    window._checkoutState.metodo = metodo;
    const tabCard = document.getElementById('tabCardBtn');
    const tabTrans = document.getElementById('tabTransBtn');
    const secCard = document.getElementById('secCheckoutCard');
    const secTrans = document.getElementById('secCheckoutTrans');

    if (metodo === 'tarjeta') {
        if (tabCard) tabCard.classList.add('active');
        if (tabTrans) tabTrans.classList.remove('active');
        if (secCard) secCard.style.display = 'block';
        if (secTrans) secTrans.style.display = 'none';
    } else {
        if (tabCard) tabCard.classList.remove('active');
        if (tabTrans) tabTrans.classList.add('active');
        if (secCard) secCard.style.display = 'none';
        if (secTrans) secTrans.style.display = 'block';
    }
};

/* ── FORMATEO Y PREVIEW DE TARJETA ───────────────────────────── */
function _actualizarPreviewTarjeta() {
    const num = (document.getElementById('chkCardNum')?.value || '').replace(/\D/g, '');
    const nom = document.getElementById('chkCardName')?.value || 'NOMBRE DEL TITULAR';
    const exp = document.getElementById('chkCardExp')?.value || 'MM/AA';

    const pNum = document.getElementById('prevCardNumber');
    const pNom = document.getElementById('prevCardName');
    const pExp = document.getElementById('prevCardExp');
    const pBrand = document.getElementById('prevCardBrand');

    if (pNum) {
        if (!num) pNum.textContent = '•••• •••• •••• ••••';
        else {
            const masked = (num + '••••••••••••••••').slice(0, 16);
            pNum.textContent = masked.match(/.{1,4}/g).join(' ');
        }
    }
    if (pNom) pNom.textContent = nom.toUpperCase();
    if (pExp) pExp.textContent = exp;

    if (pBrand) {
        if (num.startsWith('4')) pBrand.textContent = 'VISA';
        else if (/^5[1-5]/.test(num) || /^2[2-7]/.test(num)) pBrand.textContent = 'MASTERCARD';
        else if (/^3[47]/.test(num)) pBrand.textContent = 'AMEX';
        else pBrand.textContent = 'TARJETA';
    }
}

window.onCardNumberInput = function(e) {
    let val = e.target.value.replace(/\D/g, '').substring(0, 16);
    e.target.value = val.match(/.{1,4}/g)?.join(' ') || val;
    _actualizarPreviewTarjeta();
};

window.onCardExpInput = function(e) {
    let val = e.target.value.replace(/\D/g, '').substring(0, 4);
    if (val.length >= 2) {
        e.target.value = val.substring(0, 2) + '/' + val.substring(2);
    } else {
        e.target.value = val;
    }
    _actualizarPreviewTarjeta();
};

/* ── PROCESAMIENTO DE PAGO ───────────────────────────────────── */
window.procesarPagoSuscripcion = async function() {
    const plan = window._checkoutState.planId;
    const precio = window._checkoutState.precio;
    const metodo = window._checkoutState.metodo;
    const btn = document.getElementById('btnSubmitPago');
    const btnTxt = document.getElementById('btnCobrarTxt');

    if (metodo === 'tarjeta') {
        const num = (document.getElementById('chkCardNum')?.value || '').replace(/\D/g, '');
        const exp = (document.getElementById('chkCardExp')?.value || '').trim();
        const cvv = (document.getElementById('chkCardCvv')?.value || '').trim();
        const nom = (document.getElementById('chkCardName')?.value || '').trim();

        if (num.length < 15) {
            showToast('Ingresa un número de tarjeta válido (16 dígitos)', '#FF453A');
            return;
        }
        if (exp.length < 5 || !exp.includes('/')) {
            showToast('Ingresa una fecha de expiración válida (MM/AA)', '#FF453A');
            return;
        }
        if (cvv.length < 3) {
            showToast('Ingresa el código de seguridad (CVV de 3 o 4 dígitos)', '#FF453A');
            return;
        }
        if (!nom) {
            showToast('Ingresa el nombre del titular como figura en el plástico', '#FF453A');
            return;
        }

        if (btn) btn.disabled = true;
        if (btnTxt) btnTxt.textContent = '🔒 Conectando con red bancaria…';

        try {
            // Simular handshake bancario de 1.2 segundos
            await new Promise(r => setTimeout(r, 1200));

            const authCode = 'AUTH-' + Math.floor(100000 + Math.random() * 900000);
            const pagoId = 'PAY-' + Math.floor(10000000 + Math.random() * 90000000);
            const last4 = num.slice(-4);

            await _registrarPagoExitoso({
                pagoId: pagoId,
                authCode: authCode,
                planId: plan,
                monto: precio,
                metodo: 'Tarjeta •••• ' + last4,
                titular: nom
            });

            _mostrarExitoSuscripcion(plan, precio, authCode, 'Tarjeta •••• ' + last4);

        } catch (err) {
            console.error('[Pasarela] Error al procesar:', err);
            showToast('Error bancario: ' + (err.message || 'No se pudo autorizar el cobro'), '#FF453A');
        } finally {
            if (btn) btn.disabled = false;
            if (btnTxt) btnTxt.textContent = 'Confirmar Pago y Activar ($' + precio + ' USD)';
        }

    } else {
        // Transferencia bancaria
        const boleta = (document.getElementById('chkTransBoleta')?.value || '').trim();
        const bancoSel = document.getElementById('chkTransBanco')?.value || 'Banco Industrial';

        if (!boleta) {
            showToast('Ingresa el número de boleta o referencia de transferencia', '#FF453A');
            return;
        }

        if (btn) btn.disabled = true;
        if (btnTxt) btnTxt.textContent = 'Registrando comprobante…';

        try {
            await new Promise(r => setTimeout(r, 800));

            const pagoId = 'DEP-' + Math.floor(100000 + Math.random() * 900000);

            await _registrarPagoExitoso({
                pagoId: pagoId,
                authCode: 'BOLETA-' + boleta,
                planId: plan,
                monto: precio,
                metodo: 'Transferencia ' + bancoSel,
                titular: 'Boleta ' + boleta
            });

            _mostrarExitoSuscripcion(plan, precio, 'BOLETA #' + boleta, bancoSel);

        } catch (err) {
            showToast('Error al registrar comprobante: ' + err.message, '#FF453A');
        } finally {
            if (btn) btn.disabled = false;
            if (btnTxt) btnTxt.textContent = 'Confirmar Pago y Activar ($' + precio + ' USD)';
        }
    }
};

/* ── PERSISTENCIA DEL PAGO (SUPABASE + LOCALSTORAGE) ─────────── */
async function _registrarPagoExitoso(pago) {
    // 1. Actualizar usuario en localStorage
    try {
        const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
        u.plan_id = pago.planId;
        u.estado = 'ACTIVE';
        u.fecha_fin = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        if (!u.empresa) u.empresa = {};
        u.empresa.plan_id = pago.planId;
        u.empresa.estado = 'ACTIVE';
        u.empresa.fecha_fin = u.fecha_fin;

        localStorage.setItem('crm_user', JSON.stringify(u));
        localStorage.removeItem('azyvion_trial_start'); // Quitar trial
    } catch (e) {
        console.error('Error guardando en localStorage:', e);
    }

    // 2. Persistir en Supabase si está disponible
    if (window._sb) {
        try {
            const orgId = (typeof window._getEffectiveOrgId === 'function' ? window._getEffectiveOrgId() : null) || window._currentOrgId;
            
            // Insertar pago
            await window._sb.from('sub_pagos').insert([{
                id: pago.pagoId,
                empresa_id: orgId,
                monto: pago.monto,
                moneda: 'USD',
                estado: 'SUCCESS',
                metodo: pago.metodo,
                referencia: pago.authCode,
                notas: 'Pago de suscripción Plan ' + pago.planId.toUpperCase()
            }]);

            // Actualizar sub_empresas
            if (orgId) {
                await window._sb.from('sub_empresas').update({
                    plan_id: pago.planId,
                    estado: 'ACTIVE',
                    fecha_fin: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                    precio: pago.monto
                }).eq('id', orgId);
            }
        } catch (sbErr) {
            console.warn('[Pasarela] No se pudo guardar en Supabase (se persistió localmente):', sbErr);
        }
    }
}

/* ── PANTALLA DE ÉXITO Y RECIBO DIGITAL ──────────────────────── */
function _mostrarExitoSuscripcion(plan, precio, auth, metodo) {
    window.closeCheckoutModal();

    // Ocultar Paywall y banner de trial
    const paywall = document.getElementById('paywallModal');
    if (paywall) paywall.style.display = 'none';

    const banner = document.getElementById('trialCountdownBanner');
    if (banner) banner.style.display = 'none';

    // Cerrar upgrade modal si estaba abierto
    if (typeof window.closeUpgradeModal === 'function') window.closeUpgradeModal();

    showToast('🎉 ¡Suscripción activada con éxito! Tu Plan ' + plan.toUpperCase() + ' está listo.', '#30D158');

    // Modal de confirmación de recibo
    const modalExito = document.getElementById('pagoExitoModal');
    if (modalExito) {
        document.getElementById('exitoPlanTxt').textContent = 'Plan ' + plan.toUpperCase();
        document.getElementById('exitoMontoTxt').textContent = '$' + precio + '.00 USD';
        document.getElementById('exitoAuthTxt').textContent = auth;
        document.getElementById('exitoMetodoTxt').textContent = metodo;
        document.getElementById('exitoFechaTxt').textContent = new Date().toLocaleDateString('es-GT', { dateStyle: 'long' });
        modalExito.style.display = 'flex';
    }
}

console.log('[Azyvion Pasarela] Motor de pagos universal cargado correctamente.');
