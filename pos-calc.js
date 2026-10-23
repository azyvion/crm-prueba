/* ═══════════════════════════════════════════════════════════════════
   pos-calc.js — Cálculos puros del POS (sin DOM ni red) · Azyvion CRM
   Mismas reglas que las funciones SQL de supabase/migrations/20261023_06_pos_ventas.sql.
   El servidor SIEMPRE recalcula; esto solo da retroalimentación inmediata al cajero.
   Se carga antes de pos.js y también se puede requerir desde Node (pruebas).
═══════════════════════════════════════════════════════════════════ */
(function (root) {
    'use strict';

    // Redondeo decimal «mitad hacia arriba» como numeric de PostgreSQL (9.995 → 10.00; 1.005 → 1.01).
    // Se opera sobre la representación decimal más corta para no arrastrar el error binario de coma flotante.
    const r2 = n => {
        const v = Number(n);
        if (!isFinite(v)) return 0;
        const str = String(Math.abs(v));
        const abs = str.indexOf('e') < 0 ? Number(Math.round(Number(str + 'e2')) + 'e-2') : Math.round((Math.abs(v) + Number.EPSILON) * 100) / 100;
        return v < 0 ? -abs : abs;
    };
    const num = n => { const v = Number(n); return isFinite(v) ? v : 0; };

    function fQ(n) {
        return 'Q ' + num(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /** Precio unitario según la lista (misma regla de respaldo que el servidor). */
    function precioSegunLista(prod, lp) {
        if (!prod) return 0;
        const pub = num(prod.precioUnit !== undefined ? prod.precioUnit : prod.precio);
        const pla = num(prod.precioPlata);
        const oro = num(prod.precioOro);
        if (lp === 'Plata') return pla > 0 ? pla : pub;
        if (lp === 'Oro') return oro > 0 ? oro : (pla > 0 ? pla : pub);
        return pub;
    }

    /**
     * Totales de la venta.
     * items: [{cantidad, precioUnit}] · opts: {descPct, ivaPct, ivaModalidad: 'incluido'|'sobre'}
     */
    function calcTotales(items, opts) {
        opts = opts || {};
        const pct = Math.min(100, Math.max(0, num(opts.descPct)));
        const ivaPct = opts.ivaPct === undefined || opts.ivaPct === null ? 12 : num(opts.ivaPct);
        const sobre = opts.ivaModalidad === 'sobre';
        let subtotal = 0;
        (items || []).forEach(it => { subtotal += r2(num(it.cantidad) * num(it.precioUnit)); });
        subtotal = r2(subtotal);
        const descuento = r2(subtotal * pct / 100);
        const base = r2(subtotal - descuento);
        let iva, total;
        if (sobre) { iva = r2(base * ivaPct / 100); total = r2(base + iva); }
        else { total = base; iva = r2(total - total / (1 + ivaPct / 100)); }
        return { subtotal, descuento, base, iva, total, ivaPct, ivaModalidad: sobre ? 'sobre' : 'incluido', descPct: pct };
    }

    /**
     * Valida y resume los pagos de una venta.
     * pagos: [{metodo:'Efectivo'|'Tarjeta'|'Transferencia', monto, referencia}]
     * (Efectivo.monto = efectivo ENTREGADO por el cliente; los demás = monto cobrado.)
     */
    function validarPagos(total, pagos) {
        const out = { ok: false, error: '', pagado: 0, falta: r2(total), cambio: 0, efectivoAplicado: 0, electronico: 0, efectivoRecibido: 0 };
        const metodos = ['Efectivo', 'Tarjeta', 'Transferencia'];
        if (!(total > 0)) { out.error = 'El total debe ser mayor a cero.'; return out; }
        if (!pagos || !pagos.length) { out.error = 'Indique al menos un método de pago.'; return out; }
        let efectivo = 0, electronico = 0;
        for (const p of pagos) {
            if (metodos.indexOf(p.metodo) < 0) { out.error = 'Método de pago no soportado.'; return out; }
            const m = Number(p.monto);
            if (p.monto === '' || p.monto === null || p.monto === undefined || !isFinite(m) || m <= 0) {
                out.error = 'Ingrese un monto válido en cada pago.'; return out;
            }
            if (Math.abs(r2(m) - m) > 1e-9) { out.error = 'Los montos admiten máximo 2 decimales.'; return out; }
            if (p.metodo === 'Efectivo') efectivo += m;
            else {
                electronico += m;
                if (String(p.referencia || '').trim().length < 3) {
                    out.error = 'Ingrese la referencia (autorización o boleta) del pago con ' + p.metodo.toLowerCase() + '.'; return out;
                }
            }
        }
        efectivo = r2(efectivo); electronico = r2(electronico);
        out.efectivoRecibido = efectivo; out.electronico = electronico;
        out.pagado = r2(efectivo + electronico);
        if (electronico > total) { out.error = 'Los pagos electrónicos superan el total.'; return out; }
        const aplicado = r2(total - electronico);
        out.efectivoAplicado = aplicado;
        if (efectivo < aplicado) { out.falta = r2(aplicado - efectivo); out.error = 'Pago insuficiente: faltan ' + fQ(out.falta) + '.'; return out; }
        if (aplicado === 0 && efectivo > 0) { out.error = 'El total ya está cubierto con pagos electrónicos; quite el efectivo.'; return out; }
        out.falta = 0;
        out.cambio = r2(efectivo - aplicado);
        out.ok = true;
        return out;
    }

    /** Clave de idempotencia (una por intento de cobro). */
    function nuevaClave() {
        try {
            if (root.crypto && root.crypto.randomUUID) return 'pos-' + root.crypto.randomUUID();
        } catch (e) { /* sin crypto */ }
        return 'pos-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
    }

    /** Huella del carrito: ata la clave de idempotencia a UNA venta concreta. */
    function huellaCarrito(items, cliente, descPct, lista) {
        const base = (items || []).map(i => [i.id, num(i.cantidad), num(i.precioUnit)].join(':')).sort().join('|');
        return [base, (cliente && (cliente.id || cliente.nit)) || 'CF', num(descPct), lista || 'Publico'].join('#');
    }

    const norm = s => String(s === undefined || s === null ? '' : s).toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');

    /** Filtro y orden del catálogo: nombre, SKU, código de barras (si existe), categoría, descripción. */
    function filtrarProductos(productos, f) {
        f = f || {};
        const q = norm(f.q).trim();
        let list = (productos || []).filter(p => {
            if (f.cat && f.cat !== 'Todos' && p.categoria !== f.cat) return false;
            if (f.tipo === 'stock' && !(p.tipo === 'Servicio' || num(p.unidades) > 0)) return false;
            if (f.tipo === 'servicios' && p.tipo !== 'Servicio') return false;
            if (!q) return true;
            return [p.producto, p.sku, p.codigo, p.codigo_barras, p.codigoBarras, p.barcode, p.categoria, p.descripcion]
                .some(v => norm(v).indexOf(q) >= 0);
        });
        if (q) {
            const score = p => {
                const sku = norm(p.sku), nom = norm(p.producto);
                const cb = norm(p.codigo_barras || p.codigoBarras || p.barcode || p.codigo);
                if (sku === q || cb === q) return 0;
                if (nom.indexOf(q) === 0 || sku.indexOf(q) === 0) return 1;
                return 2;
            };
            list = list.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => a.s - b.s || a.i - b.i).map(x => x.p);
        }
        return list;
    }

    /** Coincidencia exacta por SKU / código de barras (lector de códigos: escribe y pulsa Enter). */
    function buscarExacto(productos, texto) {
        const q = norm(texto).trim();
        if (!q) return null;
        const hits = (productos || []).filter(p =>
            [p.sku, p.codigo, p.codigo_barras, p.codigoBarras, p.barcode].some(v => v !== '' && v !== null && v !== undefined && norm(v) === q));
        return hits.length === 1 ? hits[0] : null;
    }

    /** Cantidad válida para una línea; stock null = sin límite (servicios). */
    function validarCantidad(valor, stock) {
        const c = Number(valor);
        if (!isFinite(c) || c <= 0) return { ok: false, error: 'La cantidad debe ser mayor a cero.' };
        if (Math.abs(Math.round(c * 1000) / 1000 - c) > 1e-9) return { ok: false, error: 'Máximo 3 decimales.' };
        if (stock !== null && stock !== undefined && c > stock) return { ok: false, error: 'Solo hay ' + stock + ' en existencia.' };
        return { ok: true, cantidad: c };
    }

    /** Devuelve (reembolso) proporcional de una línea, igual que el servidor. */
    function factorReembolso(venta) {
        return num(venta.subtotal) > 0 ? num(venta.total) / num(venta.subtotal) : 1;
    }

    const api = { r2, fQ, precioSegunLista, calcTotales, validarPagos, nuevaClave, huellaCarrito, filtrarProductos, buscarExacto, validarCantidad, factorReembolso };
    root.PosCalc = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
