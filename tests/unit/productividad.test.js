// Pruebas del Lote 7 (Productividad): lector CSV, mapeo de columnas, plantillas, WhatsApp
// e integración de la API, la navegación y los pendientes del POS.
// Ejecutar: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Carga productividad.js en un contexto con DOM mínimo para probar sus utilidades puras
function cargar(sesion) {
  const store = { azyvion_session: JSON.stringify(sesion || { usuario: 'ana', nombre: 'Ana Pérez', token: 'x' }) };
  const win = { EMPRESA: { nombre: 'Comercial Demo' } };
  const doc = { readyState: 'loading', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] };
  const ctx = vm.createContext({ window: win, document: doc, setTimeout: () => 0, setInterval: () => 0, console,
    localStorage: { getItem: k => store[k] || null }, EMPRESA: win.EMPRESA });
  vm.runInContext(read('productividad.js'), ctx);
  return win.Prod;
}

test('CSV: comillas, separador «;» de Excel en español, BOM, saltos de línea y filas vacías', () => {
  const P = cargar();
  const filas = P._parseCSV('﻿Nombre;Correo;Notas\r\n"López; Ana";ana@x.com;"dijo ""hola""\nsegunda línea"\r\n\r\nBeto;;\r\n');
  assert.equal(filas.length, 3);
  assert.deepEqual(Array.from(filas[0]), ['Nombre', 'Correo', 'Notas']);
  assert.deepEqual(Array.from(filas[1]), ['López; Ana', 'ana@x.com', 'dijo "hola"\nsegunda línea']);
  assert.deepEqual(Array.from(filas[2]), ['Beto', '', '']);
});
test('CSV: separador «,» y última fila sin salto de línea', () => {
  const P = cargar();
  const filas = P._parseCSV('producto,precio\n"Café, 1 lb",45.50');
  assert.deepEqual(Array.from(filas[1]), ['Café, 1 lb', '45.50']);
});
test('mapeo automático de encabezados (acentos, mayúsculas y sinónimos)', () => {
  const P = cargar();
  const m = P._autoMapa(['NOMBRE', 'Teléfono', 'E-mail', 'NIT', 'Fecha de nacimiento', 'Columna rara'], 'clientes');
  assert.equal(m.nombre, 0); assert.equal(m.telefono, 1); assert.equal(m.correo, 2); assert.equal(m.nit, 3); assert.equal(m.fecha_nacimiento, 4);
  assert.equal(Object.keys(m).length, 5);
  const mp = P._autoMapa(['Artículo', 'Código', 'Precio de venta', 'Stock', 'Stock mínimo'], 'productos');
  assert.equal(mp.producto, 0); assert.equal(mp.sku, 1); assert.equal(mp.precioUnit, 2); assert.equal(mp.unidades, 3); assert.equal(mp.stock_minimo, 4);
});
test('plantillas: rellena variables del contacto, del usuario y de la empresa; no toca las desconocidas', () => {
  const P = cargar();
  const t = P._rellenar('Hola {nombre} de {empresa}, soy {mi_nombre} de {mi_empresa}. {otra}', { nombre: 'Luis', empresa: 'ACME' });
  assert.equal(t, 'Hola Luis de ACME, soy Ana Pérez de Comercial Demo. {otra}');
  assert.equal(P._rellenar('Hola {nombre}', {}), 'Hola ');
});
test('WhatsApp: normaliza teléfonos de Guatemala y rechaza números cortos', () => {
  const P = cargar();
  assert.equal(P._telWa('5555-1234'), '50255551234');
  assert.equal(P._telWa('+502 5555 1234'), '50255551234');
  assert.equal(P._telWa('123'), '');
});

test('auth.js expone y despacha cada método del Lote 7', () => {
  const auth = code('auth.js');
  const metodos = ['crmTareas', 'addTarea', 'updateTarea', 'getPlantillas', 'savePlantilla', 'deletePlantilla', 'registrarMensaje', 'crmImportar',
    'crmListarAuditoria', 'crmMetasProgreso', 'crmMetaGuardar', 'posPendientes', 'posPendienteGuardar', 'posPendienteEliminar'];
  const lista = auth.match(/const METHODS=\[([^\]]+)\]/)[1];
  metodos.forEach(m => {
    assert.ok(lista.includes("'" + m + "'"), m + ' falta en METHODS');
    assert.ok(new RegExp("case '" + m + "':return await _" + m + '\\(').test(auth), m + ' falta en _dispatch');
  });
});
test('actividad sin seguimiento envía null (no cadena vacía) a la columna de fecha', () => {
  const auth = code('auth.js');
  const f = auth.match(/async function _addActividadCRM[\s\S]*?\n/)[0];
  assert.ok(f.includes('fechaSeguimiento:p.fechaSeguimiento||null'));
  assert.ok(!f.includes("fechaSeguimiento:p.fechaSeguimiento||''"));
});
test('dashboard: páginas, menú, script y enganche de showPage del Lote 7', () => {
  const d = read('dashboard.html');
  ['page-tareas', 'page-plantillas', 'page-importar', 'nav-tareas', 'nav-plantillas', 'nav-importar', 'navTareasBadge'].forEach(id => assert.ok(d.includes('id="' + id + '"'), id));
  assert.ok(d.includes('<script src="productividad.js"></script>'));
  assert.ok(d.includes('href="./productividad.css"'));
  assert.match(d, /if \(window\.Prod && \['tareas', 'plantillas', 'importar'\]\.indexOf\(id\) >= 0\) Prod\.onShow\(id\);/);
  assert.match(d, /id !== 'perfil' && id !== 'tareas'/);
});
test('POS: las ventas pendientes se guardan en el servidor y se reclaman antes de retomarlas', () => {
  const pos = code('pos.js');
  assert.ok(pos.includes("_posApi('posPendienteGuardar'"));
  const ret = pos.match(/async function posRetomarPendiente[\s\S]*?\n}\n/)[0];
  const iElim = ret.indexOf("_posApi('posPendienteEliminar'"), iCarga = ret.indexOf('_posCarrito.push');
  assert.ok(iElim > 0 && iElim < iCarga, 'debe eliminarse en el servidor antes de cargar el carrito');
  assert.ok(ret.includes('if (!r.ok)'), 'si otro equipo ya la tomó, no se carga');
});
test('migración 09: funciones INVOKER no llaman a pos_ctx/pos_puede (no ejecutables por clientes)', () => {
  const sql = read('supabase/migrations/20261023_09_crm_productividad.sql');
  const invoker = sql.split(/CREATE OR REPLACE FUNCTION/).filter(b => /SECURITY INVOKER/.test(b.split('AS $$')[0]));
  assert.ok(invoker.length >= 3);
  invoker.forEach(b => { const cuerpo = b.split('AS $$')[1] || ''; assert.ok(!/pos_ctx\(|pos_puede\(/.test(cuerpo), 'INVOKER usa pos_ctx: ' + b.slice(0, 60)); });
});
