// Pruebas del Lote 9 (licencias): licencia.js, licencias-admin.js y la integración con
// login, registro, panel y Edge Functions. Ejecutar: node --test tests/unit/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./extract');
const L = require('../../licencia.js');
const A = require('../../licencias-admin.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('contacto de ventas exacto', () => {
  assert.equal(L.CONTACTO.telefono, '+502 5145 5610');
  assert.equal(L.CONTACTO.correo, 'ventas@azyvion.com');
  const e = L.enlaces('hola');
  assert.equal(e.tel, 'tel:+50251455610');
  assert.equal(e.whatsapp, 'https://wa.me/50251455610?text=hola');
  assert.match(e.correo, /^mailto:ventas@azyvion\.com\?subject=/);
  const html = L.contactoHtml('T', 'M');
  assert.match(html, /\+502 5145 5610/); assert.match(html, /ventas@azyvion\.com/);
});

test('normalizar: igual que public.licencia_normalizar()', () => {
  assert.equal(L.normalizar(' azv-ab12 cd34-EF56 '), 'AZV-AB12-CD34-EF56');
  assert.equal(L.normalizar('AZVAB12CD34EF56'), 'AZV-AB12-CD34-EF56');
  assert.equal(L.normalizar('AZV-123'), null);
  assert.equal(L.normalizar('XYZ-AB12-CD34-EF56'), null);
  assert.equal(L.normalizar(null), null);
});

test('formatear mientras se escribe', () => {
  assert.equal(L.formatear('azvab12cd34ef56'), 'AZV-AB12-CD34-EF56');
  assert.equal(L.formatear('ab12cd34ef56'), 'AZV-AB12-CD34-EF56', 'agrega el prefijo si falta');
  assert.equal(L.formatear('a'), 'A', 'no estorba al empezar a escribir AZV');
  assert.equal(L.formatear('AZV-AB12-CD34-EF56-99'), 'AZV-AB12-CD34-EF56', 'no pasa del largo');
});

test('aviso de vencimiento solo en los últimos 15 días', () => {
  assert.equal(L.avisoVencimiento({ vigente: true, dias_restantes: 30 }), null);
  assert.match(L.avisoVencimiento({ vigente: true, dias_restantes: 15 }), /vence en 15 días/);
  assert.match(L.avisoVencimiento({ vigente: true, dias_restantes: 1 }), /vence mañana/);
  assert.match(L.avisoVencimiento({ vigente: true, dias_restantes: 0 }), /vence hoy.*\+502 5145 5610/);
  assert.equal(L.avisoVencimiento({ vigente: true, dias_restantes: null }), null, 'sin vencimiento');
  assert.equal(L.avisoVencimiento({ vigente: true, interna: true }), null);
  assert.equal(L.avisoVencimiento({ vigente: false, dias_restantes: -3 }), null, 'vencida: bloqueo, no aviso');
  assert.equal(L.tituloBloqueo({ motivo: 'VENCIDA' }), 'Tu licencia venció');
});

test('verificarPanel: con licencia deja pasar; un error de red no bloquea (el servidor igual protege)', async () => {
  const sbCon = (data, error) => ({ rpc: async () => ({ data, error }) });
  assert.equal(await L.verificarPanel(sbCon(null, { message: 'red' })), null);
  const mi = await L.verificarPanel(sbCon({ vigente: true, dias_restantes: 40 }));
  assert.equal(mi.vigente, true);
  assert.equal(globalThis.LICENCIA_ACTUAL.vigente, true);
  assert.equal(await L.verificarPanel(null), null);
});

test('admin: estado visible, filtros y enlace de registro', () => {
  const hoy = '2026-10-23';
  const lista = [
    { clave: 'AZV-AAAA-AAAA-AAAA', estado: 'DISPONIBLE', notas: 'factura 12' },
    { clave: 'AZV-BBBB-BBBB-BBBB', estado: 'ASIGNADA', empresa_nombre: 'Coca Cola', vence_en: '2026-10-22' },
    { clave: 'AZV-CCCC-CCCC-CCCC', estado: 'ASIGNADA', empresa_nombre: 'Concreta', vence_en: null },
    { clave: 'AZV-DDDD-DDDD-DDDD', estado: 'REVOCADA' },
  ];
  assert.equal(A.estadoVisible(lista[1], hoy).t, 'Vencida');
  assert.equal(A.estadoVisible(lista[2], hoy).t, 'En uso');
  assert.equal(A.filtrar(lista, 'TODAS', '', hoy).length, 4);
  assert.equal(A.filtrar(lista, 'ASIGNADA', '', hoy).length, 2);
  assert.deepEqual(A.filtrar(lista, 'VENCIDA', '', hoy).map((x) => x.clave), ['AZV-BBBB-BBBB-BBBB']);
  assert.deepEqual(A.filtrar(lista, 'TODAS', 'coca', hoy).map((x) => x.clave), ['AZV-BBBB-BBBB-BBBB']);
  assert.deepEqual(A.filtrar(lista, 'TODAS', 'FACTURA', hoy).map((x) => x.clave), ['AZV-AAAA-AAAA-AAAA']);
  assert.equal(A.enlaceRegistro('AZV-AAAA-AAAA-AAAA', 'https://azyvion.github.io/crm-prueba/dashboard.html?x=1'),
    'https://azyvion.github.io/crm-prueba/register.html?licencia=AZV-AAAA-AAAA-AAAA');
});

test('registro: la licencia es el primer paso y ya no hay pago simulado', () => {
  const html = read('register.html');
  assert.ok(html.indexOf('id="f_licencia"') > 0 && html.indexOf('id="f_licencia"') < html.indexOf('id="f_empresa"'), 'licencia antes que empresa');
  assert.match(html, /id="lbl1">Licencia</); assert.match(html, /id="lbl3">Cuenta</);
  assert.doesNotMatch(html, /id="f_card"|id="step4"|name="plan"/);
  assert.match(html, /accion: 'validar', licencia: clave/);
  assert.match(html, /licencia: licencia\.clave/);
  assert.match(html, /<script src="licencia\.js"><\/script>/);
});

test('login: sin licencia muestra contacto y solo guarda la sesión al activar', () => {
  const html = read('login.html');
  assert.match(html, /if \(res\.sinLicencia\) \{ mostrarSinLicencia\(res, usuario, remember\); return; \}/);
  assert.match(html, /Licencia\.rpc\('licencia_activar'/);
  const fn = html.slice(html.indexOf('function mostrarSinLicencia'), html.indexOf('function guardarYEntrar'));
  assert.doesNotMatch(fn, /localStorage\.setItem/, 'la sesión no se guarda antes de activar');
  assert.match(html, /<script src="licencia\.js"><\/script>/);
});

test('panel: verifica la licencia en el servidor y ya no usa la prueba de localStorage', () => {
  const html = read('dashboard.html');
  assert.match(html, /<script src="licencia\.js"><\/script>\s*<script src="licencias-admin\.js"><\/script>/);
  assert.doesNotMatch(html, /azyvion_trial_start/);
  assert.match(html, /window\.checkTrialAndPlanStatus = function\(\) \{ return; \};/);
  assert.match(html, /_subTab\('licencias'\)/);
  assert.match(read('auth.js'), /window\.Licencia\.verificarPanel\(window\._sb/);
});

test('Edge Functions: registro exige y reclama la licencia; login la revisa tras la contraseña', () => {
  const reg = read('supabase/functions/register-crm/index.ts');
  assert.match(reg, /\.eq\("id", lic\.id\)\.eq\("estado", "DISPONIBLE"\)/, 'reclamo condicional (atómico)');
  assert.ok(reg.indexOf('const rLic = await buscarLicencia') < reg.indexOf('sb.auth.admin.createUser'), 'valida antes de crear la cuenta');
  assert.match(reg, /estado: "DISPONIBLE", organization_id: null/, 'la reversión libera la licencia');
  assert.doesNotMatch(reg, /"free","starter","pro","enterprise"/, 'el plan ya no lo elige el navegador');
  const login = read('supabase/functions/login-crm/index.ts');
  const a = login.indexOf('signInWithPassword'), b = login.indexOf('revisarLicencia(sb, usr, signIn.session.access_token)');
  assert.ok(a > 0 && b > a, 'la licencia se revisa después de validar la contraseña');
  assert.match(login, /sb\.auth\.admin\.signOut\(accessToken\)/);
  assert.match(login, /telefono: "\+502 5145 5610", correo: "ventas@azyvion\.com"/);
  const adm = read('supabase/functions/admin-user-manager/index.ts');
  assert.match(adm, /if \(upErr\.code === "P0001"\) return err\(upErr\.message, origin, 409\)/);
});

test('migración 11: bloqueo en las 3 funciones de empresa y suite registrada', () => {
  const sql = read('supabase/migrations/20261023_11_licencias.sql');
  for (const f of ['current_user_org_id', 'get_my_org_id', 'pos_ctx']) {
    const i = sql.indexOf('FUNCTION public.' + f + '(');
    assert.ok(i > 0, f);
    assert.match(sql.slice(i, i + 900), /licencia_org_vigente\(x\.org\)/, f + ' filtra por licencia');
  }
  assert.match(read('tests/rls/run_all.sh'), /licencias\.sql/);
});
