// Regresiones de los defectos corregidos en el frontend (Lote 1 y 2).
// Ejecutar: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./extract');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('FN-14: guardarOrgConfig llama a saveOrgConfig', () => {
  assert.match(read('perfil.js'), /\.saveOrgConfig\(datos\)/);
});

test('SEC-09: las credenciales FEL no se guardan en localStorage ni en Organizations', () => {
  const perfil = code('perfil.js');
  const felLocal = perfil.match(/const felLocal = \{[\s\S]*?\};/)[0];
  assert.doesNotMatch(felLocal, /fel_api_key|fel_usuario_certificador/);
  const auth = code('auth.js');
  assert.doesNotMatch(auth, /up\.fel_api_key\s*=/);
  assert.doesNotMatch(auth, /up\.fel_usuario_certificador\s*=/);
  assert.match(auth, /rpc\('set_fel_credentials'/);
});

test('SEC-09: _felLocalSinSecretos purga credenciales heredadas de localStorage', () => {
  const store = { azyvion_fel_config: JSON.stringify({ fel_habilitado: true, fel_api_key: 'K', fel_usuario_certificador: 'U' }) };
  const localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
  const { _felLocalSinSecretos } = load('auth.js', ['_felLocalSinSecretos'], { localStorage });
  const out = _felLocalSinSecretos();
  assert.equal(out.fel_habilitado, true);
  assert.equal(out.fel_api_key, undefined);
  assert.doesNotMatch(store.azyvion_fel_config, /fel_api_key|fel_usuario_certificador/);
});

test('FN-15: no se fabrica un DTE/UUID SAT ni una verificación FEL exitosa', () => {
  const auth = code('auth.js');
  assert.doesNotMatch(auth, /uuidSat\s*[:=]/);
  assert.doesNotMatch(auth, /fel\.sat\.gob\.gt\/consultas\/dte\/'\s*\+/);
  assert.doesNotMatch(auth, /Credenciales autorizadas/);
});

test('FN-10/FN-21: ninguna lectura o escritura a la tabla inexistente TransaccionesCRM', () => {
  for (const f of ['auth.js', 'contabilidad.js', 'pos.js']) {
    assert.doesNotMatch(code(f), /from\('TransaccionesCRM'\)/, f);
  }
});

test('FN-17/FN-19: ítems de cotización y stock POS usan RPC atómicos', () => {
  const auth = code('auth.js');
  assert.match(auth, /rpc\('replace_cotizacion_items'/);
  assert.match(auth, /rpc\('pos_mover_stock'/);
  assert.doesNotMatch(auth, /Math\.max\(0, Number\(pr\.unidades/);
});

test('FN-22: clienteId vacío se guarda como null (columna uuid)', () => {
  assert.match(code('auth.js'), /clienteId: p\.clienteId \|\| null/);
});

test('FN-23: _pgrstQuote escapa comillas y barras para filtros PostgREST', () => {
  const { _pgrstQuote } = load('auth.js', ['_pgrstQuote']);
  assert.equal(_pgrstQuote('Ferretería, S.A. (Z1)'), '"Ferretería, S.A. (Z1)"');
  assert.equal(_pgrstQuote('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(_pgrstQuote(null), '""');
  assert.doesNotMatch(code('auth.js'), /cliente\.ilike\.%'\+encodeURIComponent/);
});

test('SEC-11: encuesta.html escapa contenido de la BD', () => {
  const html = read('encuesta.html');
  assert.match(html, /function escHtml/);
  assert.match(html, /\$\{escHtml\(q\.titulo\)\}/);
  assert.match(html, /\$\{escHtml\(e\.nombre\)\}/);
});

test('FN-01/FN-02: formularios públicos usan RPC y no muestran éxito sin confirmación', () => {
  for (const f of ['encuesta.html', 'Freelancer.html']) {
    const html = read(f);
    assert.match(html, /rpc\('submit_public_survey'/, f);
    assert.match(html, /ok !== true/, f);
    assert.doesNotMatch(html, /from\('encuesta_envios'\)\s*\.insert/, f);
  }
});
