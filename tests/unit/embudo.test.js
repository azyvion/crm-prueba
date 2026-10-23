// Pruebas del Lote 8 (embudo de ventas): cálculos de embudo-calc.js y su integración con
// la capa de datos (auth.js), la página de prospectos y el guardado del formulario.
// Ejecutar: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { load, ROOT } = require('./extract');
const E = require('../../embudo-calc.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const HOY = new Date(2026, 9, 23, 10, 0); // 23-oct-2026 (local)
const P = (o) => Object.assign({ etapa: 'Propuesta', valorEstimado: 1000, probabilidad: 50 }, o);

test('probabilidad sugerida por etapa; etapas cerradas fijas', () => {
  assert.equal(E.probSugerida('Nuevo'), 10);
  assert.equal(E.probSugerida('Negociación'), 80);
  assert.equal(E.probSugerida('Ganado'), 100);
  assert.equal(E.probSugerida('Perdido'), 0);
  assert.equal(E.probSugerida('Inventada'), null);
});

test('por etapa: cantidad, valor, ponderado y probabilidad promedio', () => {
  const f = E.porEtapa([P({ valorEstimado: 1000, probabilidad: 60 }), P({ valorEstimado: 3000, probabilidad: 40 }), P({ etapa: 'Perdido', valorEstimado: 500, probabilidad: 0 })]);
  const prop = f.find((x) => x.etapa === 'Propuesta');
  assert.equal(prop.n, 2); assert.equal(prop.valor, 4000); assert.equal(prop.ponderado, 600 + 1200); assert.equal(prop.probPromedio, 50);
  assert.equal(f.find((x) => x.etapa === 'Nuevo').probPromedio, 10, 'etapa vacía muestra la sugerida');
  assert.deepEqual(f.map((x) => x.etapa), ['Nuevo', 'Contactado', 'Calificado', 'Propuesta', 'Negociación', 'Ganado', 'Perdido']);
});

test('ponderado acota la probabilidad a 0–100 y tolera valores vacíos', () => {
  assert.equal(E.ponderado({ valorEstimado: 1000, probabilidad: 150 }), 1000);
  assert.equal(E.ponderado({ valorEstimado: '', probabilidad: 'x' }), 0);
});

test('pronóstico: cada oportunidad abierta cae en un solo grupo (mes, vencida, sin fecha o posterior)', () => {
  const pros = [
    P({ fecha_cierre_estimada: '2026-10-23', valorEstimado: 1000, probabilidad: 50 }),  // hoy → este mes
    P({ fecha_cierre_estimada: '2026-10-31', valorEstimado: 2000, probabilidad: 25 }),  // este mes
    P({ fecha_cierre_estimada: '2026-11-01', valorEstimado: 4000, probabilidad: 80 }),  // noviembre (sin desfase de zona horaria)
    P({ fecha_cierre_estimada: '2027-03-31', valorEstimado: 100, probabilidad: 100 }),  // 6.º mes (mar 2027)
    P({ fecha_cierre_estimada: '2027-04-01', valorEstimado: 700 }),                     // posterior
    P({ fecha_cierre_estimada: '2026-10-22', valorEstimado: 300 }),                     // vencida (ayer)
    P({ fecha_cierre_estimada: null, valorEstimado: 900 }),                             // sin fecha
    P({ etapa: 'Perdido', fecha_cierre_estimada: '2026-10-25', valorEstimado: 5000 }), // cerrado: no cuenta
    P({ etapa: 'Ganado', valorEstimado: 1500, cerrado_en: '2026-10-05T15:00:00Z' }),
    P({ etapa: 'Ganado', valorEstimado: 999, cerrado_en: '2026-09-30T15:00:00Z' }),    // mes anterior: fuera
  ];
  const r = E.pronostico(pros, HOY, 6);
  assert.deepEqual(r.meses.map((m) => m.clave), ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
  assert.equal(r.meses[0].etiqueta, 'oct 2026');
  assert.deepEqual([r.meses[0].n, r.meses[0].valor, r.meses[0].ponderado], [2, 3000, 1000]);
  assert.deepEqual([r.meses[1].n, r.meses[1].ponderado], [1, 3200]);
  assert.equal(r.meses[5].valor, 100);
  assert.deepEqual([r.vencidos.n, r.sinFecha.n, r.posteriores.n, r.abiertos.n], [1, 1, 1, 7]);
  const enGrupos = r.meses.reduce((s, m) => s + m.n, 0) + r.vencidos.n + r.sinFecha.n + r.posteriores.n;
  assert.equal(enGrupos, r.abiertos.n, 'nada se cuenta dos veces ni se pierde');
  assert.deepEqual([r.meses[0].ganado, r.meses[0].nGanado], [1500, 1]);
});

test('pronóstico cruza el cambio de año', () => {
  const r = E.pronostico([], new Date(2026, 11, 15), 3);
  assert.deepEqual(r.meses.map((m) => m.clave), ['2026-12', '2027-01', '2027-02']);
});

test('tasa de cierre: solo cierres dentro de la ventana y con fecha', () => {
  const pros = [
    { etapa: 'Ganado', valorEstimado: 1000, cerrado_en: '2026-10-01T00:00:00Z' },
    { etapa: 'Ganado', valorEstimado: 500, cerrado_en: '2026-09-01T00:00:00Z' },
    { etapa: 'Perdido', cerrado_en: '2026-10-10T00:00:00Z' },
    { etapa: 'Perdido', cerrado_en: '2026-01-10T00:00:00Z' },   // fuera de 90 días
    { etapa: 'Perdido' },                                         // anterior al Lote 8: sin fecha
  ];
  const t = E.tasaCierre(pros, HOY, 90);
  assert.deepEqual([t.ganados, t.perdidos, t.tasa, t.valorGanado], [2, 1, 67, 1500]);
  assert.equal(E.tasaCierre([], HOY, 90).tasa, null);
});

test('motivos de pérdida: orden, porcentaje y perdidos sin motivo aparte', () => {
  const pros = [
    { etapa: 'Perdido', motivo_perdida: 'Precio', valorEstimado: 100, cerrado_en: '2026-10-01T00:00:00Z' },
    { etapa: 'Perdido', motivo_perdida: 'Precio', valorEstimado: 200, cerrado_en: '2026-10-02T00:00:00Z' },
    { etapa: 'Perdido', motivo_perdida: 'Sin respuesta', valorEstimado: 50, cerrado_en: '2026-10-03T00:00:00Z' },
    { etapa: 'Perdido', motivo_perdida: 'Precio', valorEstimado: 999, cerrado_en: '2026-01-01T00:00:00Z' }, // fuera
    { etapa: 'Perdido' }, { etapa: 'Perdido', motivo_perdida: '' },
    { etapa: 'Ganado', motivo_perdida: 'Precio', cerrado_en: '2026-10-01T00:00:00Z' },
  ];
  const m = E.motivosPerdida(pros, HOY, 90);
  assert.equal(m.total, 3); assert.equal(m.sinMotivo, 2);
  assert.deepEqual(m.lista.map((x) => [x.motivo, x.n, x.valor, x.pct]), [['Precio', 2, 300, 67], ['Sin respuesta', 1, 50, 33]]);
});

test('vencido: solo abiertos con fecha anterior a hoy', () => {
  assert.equal(E.estaVencido(P({ fecha_cierre_estimada: '2026-10-22' }), HOY), true);
  assert.equal(E.estaVencido(P({ fecha_cierre_estimada: '2026-10-23' }), HOY), false);
  assert.equal(E.estaVencido(P({ etapa: 'Perdido', fecha_cierre_estimada: '2026-01-01' }), HOY), false);
  assert.equal(E.estaVencido(P({}), HOY), false);
});

test('validar formulario (mismas reglas que el servidor)', () => {
  const ok = { etapa: 'Propuesta', probabilidad: '60', valorEstimado: '1000', fecha_cierre_estimada: '2026-11-15' };
  assert.equal(E.validar(ok), '');
  assert.match(E.validar(Object.assign({}, ok, { etapa: 'Perdido', motivo_perdida: '  ' })), /motivo/);
  assert.equal(E.validar(Object.assign({}, ok, { etapa: 'Perdido', motivo_perdida: 'Precio' })), '');
  assert.match(E.validar(Object.assign({}, ok, { probabilidad: '101' })), /probabilidad/);
  assert.match(E.validar(Object.assign({}, ok, { probabilidad: '' })), /probabilidad/);
  assert.equal(E.validar(Object.assign({}, ok, { probabilidad: '0' })), '');
  assert.match(E.validar(Object.assign({}, ok, { valorEstimado: '-5' })), /negativo/);
  assert.match(E.validar(Object.assign({}, ok, { etapa: 'Casi' })), /Etapa/);
  assert.match(E.validar(Object.assign({}, ok, { fecha_cierre_estimada: '15/11/2026' })), /Fecha/);
});

test('auth.js: probabilidad 0 se guarda como 0 (antes «||50» la volvía 50)', () => {
  const { _probProspecto, _errProspecto } = load('auth.js', ['_probProspecto', '_errProspecto']);
  assert.equal(_probProspecto({ probabilidad: '0' }), 0);
  assert.equal(_probProspecto({ probabilidad: 0 }), 0);
  assert.equal(_probProspecto({ probabilidad: '' }), 50);
  assert.equal(_probProspecto({ probabilidad: 140 }), 100);
  assert.equal(_errProspecto({ message: 'Indique el motivo de pérdida.' }), 'Indique el motivo de pérdida.');
  assert.match(_errProspecto({ message: 'new row violates check constraint "prospectos_probabilidad_chk"' }), /entre 0 y 100/);
});

test('auth.js: convertir usa la función atómica y ya no borra el prospecto', async () => {
  const llamadas = [];
  const _sb = {
    rpc: async (fn, args) => { llamadas.push([fn, args]); return { data: { ok: true, cliente_id: 'c1' }, error: null }; },
    from: () => { throw new Error('no debe tocar tablas directamente'); },
  };
  const { _convertirProspecto } = load('auth.js', ['_convertirProspecto'], { _sb });
  const r = await _convertirProspecto('p1', { segmento: 'Premium', estado: 'Activo', valorTotal: '0' });
  assert.equal(r.ok, true); assert.equal(r.clienteId, 'c1');
  assert.deepEqual(JSON.parse(JSON.stringify(llamadas)), [['crm_convertir_prospecto', { p_id: 'p1', p_segmento: 'Premium', p_estado: 'Activo', p_valor: 0 }]]);
  const fallo = load('auth.js', ['_convertirProspecto'], { _sb: { rpc: async () => ({ data: null, error: { message: 'Este prospecto ya fue convertido en cliente.' } }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(await fallo._convertirProspecto('p1', {}))), { ok: false, error: 'Este prospecto ya fue convertido en cliente.' });
});

test('integración: scripts, etapas, columnas y guardado', () => {
  const html = read('dashboard.html');
  assert.ok(html.indexOf('<script src="embudo-calc.js"></script>') < html.indexOf('<script src="prospectos.js"></script>'), 'embudo-calc.js antes de prospectos.js');
  assert.match(html, /<link rel="stylesheet" href="\.\/embudo\.css">/);
  assert.match(html, /const ETAPAS = \[[^\]]*'Ganado', 'Perdido'\]/);
  assert.match(html, /id="embPronostico"/); assert.match(html, /id="embMotivos"/);
  assert.match(html, /fecha_cierre_estimada: v\('pCierre'\), motivo_perdida: v\('pMotivo'\)/);
  assert.match(html, /EmbudoCalc\.validar\(data\)/);
  const thead = html.slice(html.indexOf('<tbody id="prospectosTbody">') - 900, html.indexOf('<tbody id="prospectosTbody">'));
  assert.equal((thead.match(/<th[\s>]/g) || []).length, 9);
  const pro = read('prospectos.js');
  assert.match(pro, /colspan="9"/);
  assert.match(pro, /_celdaCierre\(p\)/);
  // Ganado no cuenta como oportunidad abierta en ningún resumen
  for (const f of ['auth.js', 'overview.js', 'ai.js']) {
    const src = read(f);
    const abiertos = src.match(/etapa\s*!==\s*'Perdido'[^;]{0,40}/g) || [];
    abiertos.forEach((m) => assert.match(m, /Ganado/, f + ': ' + m));
  }
  assert.match(read('utils.js'), /'Ganado': 'tag-success'/);
  assert.match(read('tests/rls/run_all.sh'), /embudo\.sql/);
});
