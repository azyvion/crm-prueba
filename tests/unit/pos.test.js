// Pruebas del POS (Lote 4): cálculos del cliente, clasificación de errores de red y regresiones.
// Ejecutar: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./extract');
const P = require(path.join(ROOT, 'pos-calc.js'));

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ── Totales (mismas reglas que pos_registrar_venta) ───────────────── */
test('totales: IVA incluido no cambia el total y se desglosa', () => {
  const t = P.calcTotales([{ cantidad: 2, precioUnit: 100 }, { cantidad: 1, precioUnit: 50 }], { ivaPct: 12, ivaModalidad: 'incluido' });
  assert.equal(t.subtotal, 250); assert.equal(t.total, 250); assert.equal(t.iva, 26.79);
});
test('totales: IVA sobre subtotal se suma', () => {
  const t = P.calcTotales([{ cantidad: 1, precioUnit: 80 }], { descPct: 10, ivaPct: 12, ivaModalidad: 'sobre' });
  assert.equal(t.descuento, 8); assert.equal(t.base, 72); assert.equal(t.iva, 8.64); assert.equal(t.total, 80.64);
});
test('totales: descuento se redondea a 2 decimales y se limita a 0–100', () => {
  assert.equal(P.calcTotales([{ cantidad: 1, precioUnit: 33.33 }], { descPct: 10 }).descuento, 3.33);
  assert.equal(P.calcTotales([{ cantidad: 1, precioUnit: 10 }], { descPct: 250 }).total, 0);
  assert.equal(P.calcTotales([{ cantidad: 1, precioUnit: 10 }], { descPct: -5 }).total, 10);
});
test('totales: cantidades fraccionarias y precios con centavos', () => {
  const t = P.calcTotales([{ cantidad: 0.5, precioUnit: 19.99 }, { cantidad: 3, precioUnit: 0.1 }], { ivaPct: 12 });
  assert.equal(t.subtotal, 10.3);   // 9.995→10.00 (redondeo de línea) + 0.30
});
test('totales: IVA 0 % no se convierte en 12 %', () => {
  const t = P.calcTotales([{ cantidad: 1, precioUnit: 100 }], { ivaPct: 0, ivaModalidad: 'sobre' });
  assert.equal(t.total, 100); assert.equal(t.iva, 0);
});
test('lista de precios: Plata/Oro con respaldo igual al servidor', () => {
  const p = { precioUnit: 100, precioPlata: 90, precioOro: 0 };
  assert.equal(P.precioSegunLista(p, 'Publico'), 100);
  assert.equal(P.precioSegunLista(p, 'Plata'), 90);
  assert.equal(P.precioSegunLista(p, 'Oro'), 90);           // Oro sin precio → Plata
  assert.equal(P.precioSegunLista({ precioUnit: 100 }, 'Oro'), 100);
});

/* ── Pagos ─────────────────────────────────────────────────────────── */
test('pagos: efectivo con vuelto', () => {
  const v = P.validarPagos(250, [{ metodo: 'Efectivo', monto: 300 }]);
  assert.equal(v.ok, true); assert.equal(v.cambio, 50); assert.equal(v.efectivoAplicado, 250);
});
test('pagos: efectivo insuficiente indica lo que falta', () => {
  const v = P.validarPagos(250, [{ metodo: 'Efectivo', monto: 100 }]);
  assert.equal(v.ok, false); assert.equal(v.falta, 150); assert.match(v.error, /faltan/);
});
test('pagos: valores inválidos (vacío, negativo, texto, 3 decimales, método desconocido)', () => {
  for (const monto of ['', -5, 'abc', 0, 10.123]) {
    assert.equal(P.validarPagos(100, [{ metodo: 'Efectivo', monto }]).ok, false, String(monto));
  }
  assert.equal(P.validarPagos(100, [{ metodo: 'Bitcoin', monto: 100 }]).ok, false);
  assert.equal(P.validarPagos(100, []).ok, false);
});
test('pagos: tarjeta y transferencia exigen referencia', () => {
  assert.equal(P.validarPagos(100, [{ metodo: 'Tarjeta', monto: 100 }]).ok, false);
  assert.equal(P.validarPagos(100, [{ metodo: 'Tarjeta', monto: 100, referencia: 'AB' }]).ok, false);
  assert.equal(P.validarPagos(100, [{ metodo: 'Tarjeta', monto: 100, referencia: '884512' }]).ok, true);
  assert.equal(P.validarPagos(100, [{ metodo: 'Transferencia', monto: 100, referencia: '  ' }]).ok, false);
});
test('pagos divididos: transferencia + efectivo calcula el vuelto solo sobre el efectivo', () => {
  const v = P.validarPagos(100, [{ metodo: 'Transferencia', monto: 60, referencia: 'BOL-123' }, { metodo: 'Efectivo', monto: 50 }]);
  assert.equal(v.ok, true); assert.equal(v.efectivoAplicado, 40); assert.equal(v.cambio, 10);
});
test('pagos: electrónico mayor al total o efectivo sobrante con total cubierto se rechazan', () => {
  assert.equal(P.validarPagos(100, [{ metodo: 'Tarjeta', monto: 120, referencia: '1234' }]).ok, false);
  assert.equal(P.validarPagos(100, [{ metodo: 'Tarjeta', monto: 100, referencia: '1234' }, { metodo: 'Efectivo', monto: 5 }]).ok, false);
});

/* ── Catálogo ──────────────────────────────────────────────────────── */
const CAT = [
  { id: 1, producto: 'Camisa Azul', sku: 'CAM-001', categoria: 'Ropa', tipo: 'Producto', unidades: 5 },
  { id: 2, producto: 'Camión de juguete', sku: 'JUG-100', categoria: 'Juguetes', tipo: 'Producto', unidades: 0 },
  { id: 3, producto: 'Ajuste de ropa', sku: 'SRV-1', categoria: 'Servicios', tipo: 'Servicio', unidades: 0 },
  { id: 4, producto: 'Lápiz', sku: '7501001', codigo_barras: '7501001234567', categoria: 'Papelería', tipo: 'Producto', unidades: 9 },
];
test('búsqueda ignora acentos y mayúsculas, y prioriza SKU exacto', () => {
  assert.deepEqual(P.filtrarProductos(CAT, { q: 'camion' }).map(p => p.id), [2]);
  assert.deepEqual(P.filtrarProductos(CAT, { q: 'LAPIZ' }).map(p => p.id), [4]);
  assert.equal(P.filtrarProductos(CAT, { q: 'cam-001' })[0].id, 1);
});
test('filtros de existencia y servicios', () => {
  assert.deepEqual(P.filtrarProductos(CAT, { tipo: 'stock' }).map(p => p.id), [1, 3, 4]);   // servicios no dependen de stock
  assert.deepEqual(P.filtrarProductos(CAT, { tipo: 'servicios' }).map(p => p.id), [3]);
  assert.deepEqual(P.filtrarProductos(CAT, { cat: 'Ropa' }).map(p => p.id), [1]);
});
test('lector de código: coincidencia exacta por SKU o código de barras; ambigua = null', () => {
  assert.equal(P.buscarExacto(CAT, 'cam-001').id, 1);
  assert.equal(P.buscarExacto(CAT, '7501001234567').id, 4);
  assert.equal(P.buscarExacto(CAT, 'cam'), null);
  assert.equal(P.buscarExacto([{ id: 1, sku: 'X' }, { id: 2, sku: 'x' }], 'X'), null);
  assert.equal(P.buscarExacto(CAT, ''), null);
});
test('cantidad: positiva, ≤ 3 decimales y dentro de la existencia', () => {
  assert.equal(P.validarCantidad(2, 5).ok, true);
  assert.equal(P.validarCantidad(6, 5).ok, false);
  assert.equal(P.validarCantidad(0, 5).ok, false);
  assert.equal(P.validarCantidad(-1, null).ok, false);
  assert.equal(P.validarCantidad(1.2345, null).ok, false);
  assert.equal(P.validarCantidad(99, null).ok, true);          // servicio: sin límite
});

/* ── Idempotencia ──────────────────────────────────────────────────── */
test('clave de idempotencia: única por intento y huella estable', () => {
  const a = P.nuevaClave(), b = P.nuevaClave();
  assert.notEqual(a, b); assert.ok(a.length >= 8);
  const h1 = P.huellaCarrito([{ id: 1, cantidad: 2, precioUnit: 10 }, { id: 2, cantidad: 1, precioUnit: 5 }], { id: 'c' }, 0, 'Publico');
  const h2 = P.huellaCarrito([{ id: 2, cantidad: 1, precioUnit: 5 }, { id: 1, cantidad: 2, precioUnit: 10 }], { id: 'c' }, 0, 'Publico');
  const h3 = P.huellaCarrito([{ id: 1, cantidad: 3, precioUnit: 10 }, { id: 2, cantidad: 1, precioUnit: 5 }], { id: 'c' }, 0, 'Publico');
  assert.equal(h1, h2); assert.notEqual(h1, h3);
});

/* ── Capa de datos (auth.js) ───────────────────────────────────────── */
test('errores de RPC: sin código SQL = resultado incierto (red); con código = rechazo explícito', () => {
  const { _posRpcErr } = load('auth.js', ['_posRpcErr']);
  assert.equal(_posRpcErr({ message: 'TypeError: Failed to fetch' }).incierto, true);
  assert.equal(_posRpcErr({ message: 'Existencia insuficiente', code: 'P0001' }).incierto, false);
  assert.equal(_posRpcErr({ message: 'jwt expired', code: 'PGRST301' }).incierto, false);
});

test('POS: la venta, la caja y las devoluciones se resuelven con RPC del servidor', () => {
  const auth = code('auth.js');
  for (const fn of ['pos_registrar_venta', 'pos_devolver_venta', 'pos_abrir_caja', 'pos_cerrar_caja', 'pos_estado_caja', 'pos_caja_movimiento', 'pos_reabrir_caja', 'pos_obtener_ticket']) {
    assert.match(auth, new RegExp("_posRpc\\('" + fn + "'"), fn);
  }
});

test('POS: ya no hay caja simulada en localStorage ni numeración de ticket en el navegador', () => {
  const auth = code('auth.js'), pos = code('pos.js');
  assert.doesNotMatch(auth, /pos_ticket_seq|pos_caja_activa_|_cajaMemoria/);
  assert.doesNotMatch(pos, /modo local|simular apertura/i);
  assert.doesNotMatch(auth, /from\('Transacciones'\)\.insert[\s\S]{0,200}Venta POS/);   // la contabilidad la escribe el servidor
});

test('POS: el cobro envía clave de idempotencia y bloquea el doble envío', () => {
  const pos = code('pos.js');
  assert.match(pos, /idempotency_key:\s*_posIntento\.key/);
  assert.match(pos, /if \(_posCobrando\) return;/);
  assert.match(pos, /posObtenerVenta\(\{ key: payload\.idempotency_key \}\)/);
  assert.match(pos, /sessionStorage\.setItem\('azyvion_pos_intento'/);
});

test('POS: no se declara éxito de tarjeta sin referencia y el comprobante se marca como interno', () => {
  const pos = code('pos.js'), calc = code('pos-calc.js');
  assert.match(calc, /Ingrese la referencia/);
  assert.match(pos, /Azyvion no procesa ni confirma pagos con tarjeta/);
  assert.match(pos, /no es factura fiscal|Comprobante interno sin validez fiscal/);
  assert.doesNotMatch(pos, /uuidSat|DOCUMENTO TRIBUTARIO ELECTR/);
});

test('POS: el servidor valida permisos (regresión de NULL en pos_puede)', () => {
  const sql = read('supabase/migrations/20261023_06_pos_ventas.sql');
  const fn = sql.match(/FUNCTION public\.pos_puede[\s\S]*?\$\$;/)[0];
  assert.match(fn, /COALESCE\(jsonb_typeof/);   // sin COALESCE, `IF NOT NULL` dejaba pasar a usuarios sin permiso
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.%I FROM authenticated/);
  assert.match(sql, /trg_pos_turno_inmutable/);
});

test('POS: la migración y las pruebas SQL están registradas', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'supabase/migrations/20261023_06_rollback.sql')));
  assert.match(read('tests/rls/run_all.sh'), /pos_ventas\.sql/);
});

/* ── Lote 5: configuración del POS ─────────────────────────────────── */
test('redondeo de efectivo al múltiplo más cercano (como el servidor)', () => {
  assert.equal(P.redondearEfectivo(100.10, 0.25), 100);
  assert.equal(P.redondearEfectivo(100.13, 0.25), 100.25);
  assert.equal(P.redondearEfectivo(100.125, 0.25), 100.25);    // mitad exacta: 400.5 → 401 (como numeric)
  assert.equal(P.redondearEfectivo(0.02, 0.05), 0.02);          // por debajo del paso no se redondea
  assert.equal(P.redondearEfectivo(37.40, 0), 37.4);
  assert.equal(P.redondearEfectivo(37.46, 1), 37);
});
test('pagos con propina y redondeo: se cobra total + propina y el vuelto sale del efectivo redondeado', () => {
  const v = P.validarPagos(100.10, [{ metodo: 'Efectivo', monto: 120 }], { propina: 10, redondeo: 0.25 });
  assert.equal(v.ok, true); assert.equal(v.due, 110.1); assert.equal(v.efectivoAplicado, 110); assert.equal(v.redondeo, -0.1); assert.equal(v.cambio, 10);
  assert.equal(P.validarPagos(100, [{ metodo: 'Efectivo', monto: 100 }], { propina: 10 }).ok, false);   // la propina también se cobra
  assert.equal(P.validarPagos(100, [{ metodo: 'Efectivo', monto: 500 }], { propina: 150 }).ok, false);  // propina > total
});
test('métodos deshabilitados se rechazan en el cliente', () => {
  const v = P.validarPagos(50, [{ metodo: 'Tarjeta', monto: 50, referencia: 'AUT-1' }], { metodos: ['Efectivo'] });
  assert.equal(v.ok, false); assert.match(v.error, /no está habilitado/);
  assert.equal(P.etiquetaMetodo({ etiquetas_metodos: { Transferencia: 'Depósito' } }, 'Transferencia'), 'Depósito');
  assert.equal(P.etiquetaMetodo({}, 'Tarjeta'), 'Tarjeta');
});
test('los valores por defecto del cliente coinciden con pos_cfg_defaults() del servidor', () => {
  const sql = read('supabase/migrations/20261023_08_negocio.sql');   // la definición vigente (la 08 redefine los valores por defecto)
  const bloque = sql.match(/FUNCTION public\.pos_cfg_defaults\(\)[\s\S]*?\$\$;/)[0];
  const clavesSql = [...bloque.matchAll(/'([a-z_0-9]+)',/g)].map(m => m[1]).filter(k => k in P.CFG_DEFAULTS || /^[a-z_0-9]+$/.test(k));
  for (const k of Object.keys(P.CFG_DEFAULTS)) assert.ok(bloque.includes("'" + k + "'"), 'falta en SQL: ' + k);
  for (const k of clavesSql.filter(x => !['Efectivo', 'Tarjeta', 'Transferencia'].includes(x))) {
    if (/^[a-z_0-9]+$/.test(k) && bloque.indexOf("'" + k + "',") >= 0 && !(k in P.CFG_DEFAULTS) && !/^(no|auto|permiso|si)$/.test(k) && !/^\d+$/.test(k)) {
      assert.fail('falta en el cliente: ' + k);
    }
  }
  assert.equal(P.CFG_DEFAULTS.descuento_max_default, 10);
  assert.equal(P.CFG_DEFAULTS.vender_sin_stock, 'no');
});
test('toda opción del POS es configurable en Ajustes → Empresa', () => {
  global.document = { getElementById: () => null };
  const UI = require(path.join(ROOT, 'pos-config-ui.js'));
  const enUi = new Set(UI.GRUPOS.flatMap(g => g[1].map(f => f.k)));
  for (const k of Object.keys(P.CFG_DEFAULTS)) {
    if (k === 'etiquetas_metodos') continue;           // se edita junto con metodos_habilitados
    assert.ok(enUi.has(k), 'sin control en Ajustes: ' + k);
  }
  assert.deepEqual(UI.REDES.map(r => r[0]), ['facebook', 'instagram', 'tiktok', 'whatsapp', 'x', 'youtube']);
});
test('las redes sociales del comprobante vienen de la configuración de empresa (no del código)', () => {
  const pos = code('pos.js'), auth = code('auth.js'), perfil = code('perfil.js');
  assert.match(auth, /redes:\s*\(data\.redes_sociales/);
  assert.match(auth, /up\.redes_sociales = p\.redes_sociales/);
  assert.match(pos, /em\.redes\[k\]/);
  assert.match(perfil, /id="redesMount"/);
  assert.doesNotMatch(pos, /facebook\.com|instagram\.com|tiktok\.com/i);   // ninguna red escrita a mano (wa.me es solo el enlace de envío)
});
test('el servidor aplica la configuración (no solo la interfaz)', () => {
  const sql = read('supabase/migrations/20261023_07_pos_config.sql');
  for (const frag of ['vender_sin_stock', 'caja_obligatoria', 'redondeo_efectivo', 'cuadre_max_sin_supervisor', 'plazo_devolucion_dias',
                      'motivos_devolucion', 'nit_obligatorio_desde', 'propina_habilitada', 'metodos_habilitados', 'turno_bloquear']) {
    assert.ok(sql.includes(frag), frag);
  }
  assert.match(sql, /trg_org_pos_config/);
  assert.match(read('tests/rls/run_all.sh'), /pos_config\.sql/);
});
