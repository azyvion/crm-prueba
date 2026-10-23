/* Servidor simulado en memoria para probar la interfaz del POS SIN base de datos real.
   Reproduce el contrato de auth.js (window.api.withSuccessHandler(...).metodo(args)) y las reglas
   principales del servidor (idempotencia, existencias, permisos). No sustituye las pruebas SQL
   (tests/rls/pos_ventas.sql): solo verifica el comportamiento del cliente. */
(function () {
    const M = window.__mock = {
        latency: 30,
        config: {},             // pos_config de la empresa (se mezcla con los valores por defecto en el cliente)
        sinStock: false,
        fallo: null,            // 'red-perdida' → el servidor confirma pero la respuesta se pierde; 'red-antes' → ni llega
        fallosGetVenta: 0,
        permisos: { descuento: true, editar_precio: false, anular: true, devolver: true, caja_mov: true, reimprimir: true },
        privilegiado: false, descuentoMax: 10,
        cajaAbierta: false, caja: null,
        llamadas: [],
        productos: [
            { id: 'p1', producto: 'Camisa Azul', sku: 'CAM-001', categoria: 'Ropa', tipo: 'Producto', unidades: 10, precioUnit: 100, precioPlata: 90, precioOro: 80, activo: true },
            { id: 'p2', producto: 'Pantalón Negro', sku: 'PAN-002', categoria: 'Ropa', tipo: 'Producto', unidades: 2, precioUnit: 250.5, precioPlata: 0, precioOro: 0, activo: true },
            { id: 'p3', producto: 'Servicio de ajuste', sku: 'SRV-003', categoria: 'Servicios', tipo: 'Servicio', unidades: 0, precioUnit: 30, precioPlata: 0, precioOro: 0, activo: true },
            { id: 'p4', producto: 'Gorra Agotada', sku: 'GOR-004', categoria: 'Accesorios', tipo: 'Producto', unidades: 0, precioUnit: 45, precioPlata: 0, precioOro: 0, activo: true }
        ],
        clientes: [{ id: 'c1', nombre: 'Ana López', empresa: '', nit: '1234567-8', direccion: 'Zona 10', lista_precio: 'Plata' }],
        cuentas: [{ id: 'b1', nombre: 'Banco Industrial', banco: 'BI', numeroCuenta: '001' }],
        ventas: [], devoluciones: [], seq: 0, movimientos: []
    };
    const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    const resumen = () => {
        let ve = 0, vt = 0, vtr = 0, tk = 0;
        M.ventas.filter(v => v.cajaTurnoId === (M.caja && M.caja.id)).forEach(v => { tk++; v.pagos.forEach(p => { if (p.metodo === 'Efectivo') ve += p.monto; else if (p.metodo === 'Tarjeta') vt += p.monto; else vtr += p.monto; }); });
        const ent = M.movimientos.filter(m => m.tipo === 'Entrada').reduce((s, m) => s + m.monto, 0);
        const sal = M.movimientos.filter(m => m.tipo === 'Salida').reduce((s, m) => s + m.monto, 0);
        const de = M.devoluciones.filter(d => d.metodo === 'Efectivo').reduce((s, d) => s + d.monto, 0);
        const ini = M.caja ? M.caja.montoInicial : 0;
        return { montoInicial: ini, ventasEfectivo: ve, ventasTarjeta: vt, ventasTransferencia: vtr, totalVentas: ve + vt + vtr, tickets: tk, entradas: ent, salidas: sal, devolucionesEfectivo: de, devolucionesOtros: 0, esperado: r2(ini + ve + ent - sal - de), anulaciones: 0 };
    };
    const err = m => ({ ok: false, error: m });
    const handlers = {
        getPosInit: () => ({ ok: true, productos: JSON.parse(JSON.stringify(M.productos)), clientes: M.clientes, cuentas: M.cuentas,
            permisos: { ok: true, permisos: M.permisos, privilegiado: M.privilegiado, descuentoMax: M.privilegiado ? 100 : M.descuentoMax, config: M.config, puedeVenderSinStock: !!M.sinStock }, empresa: {} }),
        getCajaStatus: () => M.cajaAbierta ? { ok: true, cajaAbierta: true, cajaId: M.caja.id, cajero: 'cajero1', montoInicial: M.caja.montoInicial, fecha: M.caja.fecha, resumen: resumen() } : { ok: true, cajaAbierta: false },
        abrirCajaPOS: p => { if (M.cajaAbierta) return err('Ya existe una caja abierta en esta sucursal. Ciérrela antes de abrir otra.'); M.cajaAbierta = true; M.caja = { id: 'CAJA-T1', montoInicial: p.montoInicial, fecha: new Date().toISOString() }; return { ok: true, cajaId: 'CAJA-T1' }; },
        cerrarCajaPOS: p => { const r = resumen(); const dif = r2(p.efectivoContado - r.esperado); if (dif !== 0 && (p.observaciones || '').length < 3) return err('Hay una diferencia de Q ' + dif + ' en el cuadre: explíquela en las observaciones.'); M.cajaAbierta = false; return Object.assign({ ok: true, cajaId: M.caja.id, cajero: 'cajero1', contado: p.efectivoContado, diferencia: dif, fechaApertura: M.caja.fecha, fechaCierre: new Date().toISOString(), observaciones: p.observaciones }, r); },
        posCajaMovimiento: p => { M.movimientos.push(p); return { ok: true }; },
        registrarVentaPos: p => {
            if (M.fallo === 'red-antes') { M.fallo = null; return { ok: false, incierto: true, error: 'TypeError: Failed to fetch' }; }
            const previa = M.ventas.find(v => v.key === p.idempotency_key);
            if (previa) return { ok: true, duplicado: true, ticket: previa.ticket };
            if (!M.cajaAbierta && !p.permitir_sin_caja) return err('No hay una caja abierta. Abra la caja antes de cobrar.');
            let sub = 0; const items = [];
            for (const it of p.items) {
                const pr = M.productos.find(x => x.id === it.id);
                if (pr.tipo !== 'Servicio' && pr.unidades < it.cantidad) return err('Existencia insuficiente para "' + pr.producto + '" (disponible: ' + pr.unidades + ').');
                if (Math.abs(it.precioUnit - pr.precioUnit) > 0.005 && !M.permisos.editar_precio) return err('No tiene permiso para modificar el precio de "' + pr.producto + '".');
                sub += r2(it.cantidad * it.precioUnit); items.push({ id: pr.id, itemId: 'i' + items.length, descripcion: pr.producto, sku: pr.sku, cantidad: it.cantidad, precioUnit: it.precioUnit, total: r2(it.cantidad * it.precioUnit), cantidadDevuelta: 0 });
            }
            if (p.descuentoPct > 0 && !M.permisos.descuento) return err('No tiene permiso para aplicar descuentos.');
            const desc = r2(sub * p.descuentoPct / 100), total = r2(sub - desc);
            if (Math.abs(total - p.total) > 0.01) return err('El total cambió.');
            const ef = p.pagos.filter(x => x.metodo === 'Efectivo').reduce((s, x) => s + x.monto, 0), el = p.pagos.filter(x => x.metodo !== 'Efectivo').reduce((s, x) => s + x.monto, 0);
            if (ef < total - el) return err('Pago insuficiente');
            p.items.forEach(it => { const pr = M.productos.find(x => x.id === it.id); if (pr.tipo !== 'Servicio') pr.unidades -= it.cantidad; });
            M.seq++;
            const pagos = []; if (total - el > 0) pagos.push({ metodo: 'Efectivo', monto: r2(total - el), recibido: ef }); p.pagos.filter(x => x.metodo !== 'Efectivo').forEach(x => pagos.push({ metodo: x.metodo, monto: x.monto, recibido: x.monto, referencia: x.referencia }));
            const ticket = { ventaId: 'v' + M.seq, numero: 'POS-2026-' + String(M.seq).padStart(5, '0'), fecha: new Date().toISOString(), estado: 'Completada', cliente: p.clienteNombre, nit: p.nit,
                subtotal: sub, descuentoPct: p.descuentoPct, descuento: desc, ivaPct: 12, ivaModalidad: 'incluido', iva: r2(total - total / 1.12), total: total, montoRecibido: ef + el, cambio: r2(ef - (total - el)),
                reembolsado: 0, cajero: 'cajero1', cajaTurnoId: M.caja && M.caja.id, metodoPago: pagos.length > 1 ? 'Mixto' : pagos[0].metodo, items: items, pagos: pagos, felNoCertificado: true, empresa: { nombre: 'Empresa Demo', nit: '123456-7' } };
            M.ventas.push({ key: p.idempotency_key, ticket: ticket, cajaTurnoId: M.caja && M.caja.id, pagos: pagos });
            if (M.fallo === 'red-perdida') { M.fallo = null; return { ok: false, incierto: true, error: 'TypeError: Failed to fetch' }; }
            return { ok: true, duplicado: false, ticket: ticket };
        },
        posObtenerVenta: p => {
            if (M.fallosGetVenta > 0) { M.fallosGetVenta--; return { ok: false, incierto: true, error: 'sin conexión' }; }
            const v = p.key ? M.ventas.find(x => x.key === p.key) : M.ventas.find(x => x.ticket.ventaId === p.ventaId);
            return v ? { ok: true, encontrada: true, ticket: JSON.parse(JSON.stringify(v.ticket)) } : { ok: true, encontrada: false };
        },
        posBuscarVentas: () => ({ ok: true, data: M.ventas.map(v => ({ id: v.ticket.ventaId, numero: v.ticket.numero, created_at: v.ticket.fecha, estado: v.ticket.estado, cliente_nombre: v.ticket.cliente, nit: v.ticket.nit, total: v.ticket.total })) }),
        posDevolverVenta: p => {
            if (!M.permisos[p.anular ? 'anular' : 'devolver']) return err('No tiene permiso.');
            const v = M.ventas.find(x => x.ticket.ventaId === p.ventaId); const t = v.ticket;
            if (M.devoluciones.find(d => d.key === p.idempotency_key)) return { ok: true, duplicado: true, monto: 0, ticket: t };
            let monto = 0;
            const sel = p.anular ? t.items.map(i => ({ itemId: i.itemId, cantidad: i.cantidad - i.cantidadDevuelta })) : p.items;
            for (const s of sel) { const li = t.items.find(i => i.itemId === s.itemId); if (s.cantidad > li.cantidad - li.cantidadDevuelta) return err('No puede devolver ' + s.cantidad + ' de "' + li.descripcion + '": solo quedan ' + (li.cantidad - li.cantidadDevuelta) + ' por devolver.'); }
            sel.forEach(s => { const li = t.items.find(i => i.itemId === s.itemId); li.cantidadDevuelta += s.cantidad; monto += s.cantidad * li.precioUnit; const pr = M.productos.find(x => x.id === li.id); if (p.reingresarStock && pr.tipo !== 'Servicio') pr.unidades += s.cantidad; });
            monto = r2(monto * t.total / t.subtotal); t.reembolsado = r2(t.reembolsado + monto); t.estado = p.anular ? 'Anulada' : (t.items.every(i => i.cantidadDevuelta >= i.cantidad) ? 'Devuelta' : 'Devuelta parcial');
            M.devoluciones.push({ key: p.idempotency_key, monto: monto, metodo: p.metodoReembolso });
            return { ok: true, duplicado: false, monto: monto, estado: t.estado, ticket: t };
        },
        // ── Lote 6 (Negocio) ──
        posMisPermisos: () => ({ ok: true, permisos: Object.assign({ reportes: true, compras: true, inventario_ajuste: true, sin_stock: false }, M.permisos), privilegiado: M.privilegiado, config: M.config }),
        getSucursales: () => ({ ok: true, data: [{ id: 's1', nombre: 'Central' }, { id: 's2', nombre: 'Zona 10' }] }),
        posReporteVentas: p => ({ ok: true, desde: p.desde, hasta: p.hasta,
            kpis: { tickets: 42, tickets_anulados: 1, ventas_brutas: 12500, devoluciones: 450, ventas_netas: 12050, descuentos: 300, iva_neto: 1291.07, propinas: 0, costo: 6200, items_sin_costo: 3 },
            kpis_previo: { tickets: 35, ventas_netas: 10000, costo: 5000 }, periodo_previo: { desde: '2026-09-01', hasta: '2026-09-30' }, ingresos_sin_iva: 10758.93, ticket_promedio: 286.9, margen: 4558.93, margen_pct: 42.4,
            por_dia: Array.from({ length: 30 }, (_, i) => ({ fecha: '2026-10-' + String(i + 1).padStart(2, '0'), tickets: (i * 7) % 5, neto: 200 + ((i * 53) % 400) })),
            por_metodo: [{ metodo: 'Efectivo', monto: 7000 }, { metodo: 'Tarjeta', monto: 4000 }, { metodo: 'Transferencia', monto: 1050 }],
            por_cajero: [{ cajero: 'cajero1', tickets: 30, neto: 9000 }, { cajero: 'cajero2', tickets: 12, neto: 3050 }], por_sucursal: [{ sucursal: 'Central', tickets: 42, neto: 12050 }],
            top_productos: [{ producto: 'Camisa Azul', sku: 'CAM-001', unidades: 55, importe: 5500, costo: 2200 }, { producto: 'Pantalón Negro', sku: 'PAN-002', unidades: 20, importe: 5010, costo: 3000 }],
            sin_movimiento: [{ producto: 'Gorra Roja', sku: 'GOR-9', unidades: 12 }] }),
        posReporteCierres: () => ({ ok: true, turnos: [{ id: 'CAJA-1', sucursal: 'Central', cajero: 'cajero1', apertura: '2026-10-20T14:00:00Z', cierre: '2026-10-20T22:00:00Z', estado: 'CERRADA', fondo: 500, esperado: 1500, contado: 1490, diferencia: -10 }], totales: { turnos: 1, cerrados: 1, abiertos: 0, ventas_efectivo: 1000, ventas_tarjeta: 500, ventas_transferencia: 0, faltantes: -10, sobrantes: 0 } }),
        posReporteComisiones: () => ({ ok: true, filas: [{ cajero: 'cajero1', tickets: 30, ventas_netas: 9000, base: 8035.71, pct: 5, comision: 401.79 }], total_comisiones: 401.79, nota: 'Base = ventas netas sin IVA.' }),
        getInventario: () => ({ ok: true, data: M.productos.map(p => Object.assign({ costo_unit: 40, stock_minimo: 3, codigo_barras: '' }, p)) }),
        getCuentasBancarias: () => ({ ok: true, data: M.cuentas }),
        getProveedores: () => ({ ok: true, data: M.proveedores || (M.proveedores = [{ id: 'pv1', nombre: 'Distribuidora Uno', nit: '123-4', activo: true, telefono: '5555-0000' }]) }),
        getCompras: () => ({ ok: true, data: M.compras || (M.compras = [{ id: 'cp1', numero: 'COM-2026-00001', fecha: '2026-10-10', proveedor: { nombre: 'Distribuidora Uno' }, referencia: 'F-100', forma_pago: 'Crédito', pagada: false, estado: 'Recibida', total: 800, usuario: 'admin' }]) }),
        getCompraItems: () => ({ ok: true, data: [{ descripcion: 'Camisa Azul', cantidad: 20, costo_unit: 40, total: 800 }] }),
        compraRegistrar: p => { M.compras = M.compras || []; M.compras.unshift({ id: 'cp' + (M.compras.length + 1), numero: 'COM-2026-0000' + (M.compras.length + 1), fecha: p.fecha, proveedor: { nombre: '—' }, forma_pago: p.formaPago, pagada: p.formaPago === 'Contado', estado: 'Recibida', total: p.items.reduce((s, i) => s + i.cantidad * i.costo, 0), usuario: 'admin' }); M.llamadasCompra = (M.llamadasCompra || 0) + 1; return { ok: true, numero: M.compras[0].numero, total: M.compras[0].total }; },
        compraPagar: () => ({ ok: true }), compraAnular: () => ({ ok: true }), proveedorGuardar: () => ({ ok: true, id: 'pv2' }),
        invReposicion: () => ({ ok: true, filas: [{ id: 'p2', producto: 'Pantalón Negro', sku: 'PAN-002', unidades: 2, minimo: 5, faltante: 3, sugerido: 98, costo: 120, ultimo_proveedor: 'Distribuidora Uno' }] }),
        getConteos: () => ({ ok: true, data: [{ id: 'cn1', nombre: 'Conteo octubre', estado: 'Abierto', created_at: '2026-10-22T10:00:00Z', usuario: 'admin' }] }),
        getConteoItems: () => ({ ok: true, data: [{ producto_id: 'p1', descripcion: 'Camisa Azul', sku: 'CAM-001', sistema: 10, contado: null }, { producto_id: 'p2', descripcion: 'Pantalón Negro', sku: 'PAN-002', sistema: 2, contado: 3 }] }),
        invConteoGuardar: () => ({ ok: true, guardados: 2 }), invConteoAplicar: () => ({ ok: true, ajustados: 1 }), invConteoCrear: () => ({ ok: true, id: 'cn2', productos: 2 }),
        getKardex: () => ({ ok: true, data: [{ created_at: '2026-10-22T12:00:00Z', tipo: 'Venta', cantidad: -2, saldo: 8, referencia: 'POS-2026-00001', usuario: 'cajero1' }, { created_at: '2026-10-20T12:00:00Z', tipo: 'Compra', cantidad: 10, saldo: 10, referencia: 'COM-2026-00001', usuario: 'admin' }] }),
        invAjustar: () => ({ ok: true, antes: 10, despues: 7 }),
        seguimientoClientes: () => ({ ok: true, recompra: [{ id: 'c1', nombre: 'Ana López', telefono: '5555-1234', ultima_compra: '2026-07-01T00:00:00Z', dias: 112, compras: 4, total: 1250.5 }, { id: 'c2', nombre: 'Sin Teléfono', telefono: '', ultima_compra: '2026-06-01T00:00:00Z', dias: 140, compras: 1, total: 90 }], cumpleanos: [{ id: 'c1', nombre: 'Ana López', telefono: '5555-1234', cumple: '2026-10-28', en_dias: 5 }] }),
        posListarAuditoria: () => ({ ok: true, filas: [{ id: 1, fecha: '2026-10-22T12:00:00Z', accion: 'venta.anular', entidad: 'pos_ventas', usuario: 'admin', detalle: { numero: 'POS-2026-00001', motivo: 'error' } }] }),
        getProspectos: () => ({ ok: true, data: [
            { id: 'pr1', nombre: 'Luis Prueba Uno', empresa: 'Ferretería Demo', telefono: '5555-1111', etapa: 'Nuevo', origen: 'Facebook' },
            { id: 'pr2', nombre: 'María Prueba Dos', empresa: '', telefono: '+502 4444 2222', etapa: 'Nuevo', origen: 'Referido' },
            { id: 'pr3', nombre: 'Sin Teléfono Tres', empresa: 'X', telefono: '', etapa: 'Nuevo', origen: 'Web' },
            { id: 'pr4', nombre: 'Ya Contactado Cuatro', empresa: 'Y', telefono: '3333-4444', etapa: 'Nuevo', origen: 'Web' },
            { id: 'pr5', nombre: 'En Propuesta Cinco', empresa: 'Z', telefono: '2222-5555', etapa: 'Propuesta', origen: 'Web' }] }),
        getContactadosWhatsApp: () => ({ ok: true, data: [{ refId: 'pr4', fecha: '2026-10-20', usuario: 'admin' }].concat(M.contactados || []) }),
        addActividadCRM: p => { (M.contactados = M.contactados || []).push({ refId: p.refId, fecha: '2026-10-23' }); M.actividades = (M.actividades || []).concat([p]); return { ok: true, id: 'a' + M.actividades.length }; },
        getCierresCaja: () => ({ ok: true, data: [] }),
        posReabrirCaja: () => ({ ok: true }),
        consultarNitSat: () => ({ ok: false }),
        enviarTicketCorreo: () => ({ ok: true, mensaje: 'Enviado' })
    };
    function api(onS, onF) {
        const runner = { withSuccessHandler: fn => api(fn, onF), withFailureHandler: fn => api(onS, fn) };
        Object.keys(handlers).forEach(name => {
            runner[name] = function () {
                const args = Array.from(arguments);
                M.llamadas.push({ name: name, args: JSON.parse(JSON.stringify(args)) });
                setTimeout(() => {
                    let res;
                    try { res = handlers[name].apply(null, args); } catch (e) { if (onF) onF(e); return; }
                    if (onS) onS(JSON.parse(JSON.stringify(res)));
                }, M.latency);
            };
        });
        return runner;
    }
    window.api = api(null, null);
})();
