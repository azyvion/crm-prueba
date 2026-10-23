// Pruebas del Lote 6 (Negocio): helpers de WhatsApp, integración de la API y de la navegación.
// Ejecutar: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Carga negocio.js en un contexto con DOM mínimo para probar sus utilidades puras
function cargarNegocio() {
  const win = { PosCalc: require(path.join(ROOT, 'pos-calc.js')) };
  const doc = { readyState: 'complete', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] };
  const ctx = vm.createContext({ window: win, document: doc, setTimeout: () => 0, console });
  vm.runInContext(read('negocio.js'), ctx);
  return win.Negocio;
}

test('WhatsApp: normaliza teléfonos (8 dígitos = Guatemala) y rechaza números inválidos', () => {
  const N = cargarNegocio();
  assert.equal(N.telWa('5555-1234'), '50255551234');
  assert.equal(N.telWa('+502 5555 1234'), '50255551234');
  assert.equal(N.telWa('+1 (305) 555-1234'), '13055551234');
  assert.equal(N.telWa('123'), '');
  assert.equal(N.telWa(''), '');
  assert.equal(N.waLink('', 'hola'), '');
  assert.match(N.waLink('5555-1234', 'Hola Ana'), /^https:\/\/wa\.me\/50255551234\?text=Hola%20Ana$/);
});
test('plantillas de mensaje: reemplaza variables conocidas y deja las demás', () => {
  const N = cargarNegocio();
  assert.equal(N.aplicar('Hola {nombre} de {empresa}', { nombre: 'Ana', empresa: 'Demo' }), 'Hola Ana de Demo');
  assert.equal(N.aplicar('Hola {nombre} {otra}', { nombre: 'Ana' }), 'Hola Ana {otra}');
});

test('auth.js expone cada método de Negocio y lo despacha', () => {
  const auth = code('auth.js');
  const metodos = ['posHistorialCliente', 'posReporteVentas', 'posReporteCierres', 'posReporteComisiones', 'posListarAuditoria', 'seguimientoClientes',
    'proveedorGuardar', 'compraRegistrar', 'compraPagar', 'compraAnular', 'invAjustar', 'invConteoCrear', 'invConteoGuardar', 'invConteoAplicar',
    'invReposicion', 'getProveedores', 'getCompras', 'getCompraItems', 'getKardex', 'getConteos', 'getConteoItems'];
  for (const m of metodos) {
    assert.ok(auth.includes("'" + m + "'"), 'falta en METHODS: ' + m);
    assert.match(auth, new RegExp("case '" + m + "':return await"), 'falta en el despacho: ' + m);
  }
  for (const fn of ['pos_historial_cliente', 'pos_reporte_ventas', 'pos_reporte_cierres', 'pos_reporte_comisiones', 'pos_listar_auditoria', 'seguimiento_clientes',
    'proveedor_guardar', 'compra_registrar', 'compra_pagar', 'compra_anular', 'inv_ajustar', 'inv_conteo_crear', 'inv_conteo_guardar', 'inv_conteo_aplicar', 'inv_reposicion']) {
    assert.match(auth, new RegExp("_posRpc\\('" + fn + "'"), fn);
  }
});
test('el dashboard integra las páginas, la navegación y negocio.js', () => {
  const h = read('dashboard.html');
  for (const id of ['reportes', 'compras', 'seguimiento', 'auditoria']) {
    assert.ok(h.includes('id="page-' + id + '"'), 'página ' + id);
    assert.ok(h.includes('id="nav-' + id + '"'), 'nav ' + id);
  }
  assert.match(h, /<script src="negocio\.js"><\/script>/);
  assert.match(h, /Negocio\.onShow\(id\)/);
  assert.match(h, /aplicarPerfilRol/);
});
test('los permisos nuevos existen en servidor y en el formulario de usuarios', () => {
  const sql = read('supabase/migrations/20261023_08_negocio.sql');
  const h = read('dashboard.html');
  for (const p of ['reportes', 'compras', 'inventario_ajuste']) {
    assert.ok(sql.includes("'" + p + "'"), 'servidor: ' + p);
    assert.ok(h.includes("id: '" + p + "'"), 'formulario: ' + p);
  }
  assert.ok(h.includes("id: 'sin_stock'"));   // lo pide el modo «vender sin existencias con permiso»
  assert.match(sql, /trg_inv_kardex/);
  assert.match(read('tests/rls/run_all.sh'), /negocio\.sql/);
});
test('el inventario ya no sobrescribe existencias con el valor cargado al abrir el formulario', () => {
  const auth = code('auth.js');
  assert.match(auth, /const unCambio = p\.unidades !== undefined/);
  assert.match(auth, /if \(!unCambio\) delete up\.unidades;/);
  assert.match(read('dashboard.html'), /unidadesOriginal:/);
});
test('la ficha del cliente muestra su historial de compras del POS', () => {
  const f = read('ficha-pro.js');
  assert.match(f, /compras:\s+_fichaComprasPro/);
  assert.match(f, /posHistorialCliente/);
});

test('Contactar prospectos: página, navegación, API y registro de cada contacto en la ficha', () => {
  const h = read('dashboard.html'), n = code('negocio.js'), a = code('auth.js');
  assert.ok(h.includes('id="page-contactar"') && h.includes('id="nav-contactar"'));
  assert.match(h, /'contactar'\]\.indexOf\(id\)/);
  assert.match(n, /titulo: 'Contactado por WhatsApp'/);          // queda anotado en la ficha del prospecto
  assert.match(n, /call\('getContactadosWhatsApp'\)/);
  assert.match(a, /case 'getContactadosWhatsApp':return await/);
  assert.doesNotMatch(n, /window\.open\([^)]*wa\.me/);            // nunca abre WhatsApp solo: lo abre el clic de la persona
});
