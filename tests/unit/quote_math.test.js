// Regresión FN-16 / FN-17: el total que ve el usuario en el constructor de
// cotizaciones debe ser exactamente el que se guarda en la base de datos.
// Ejecutar: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./extract');

function backend(empresa) {
  return load('auth.js', ['_r2', '_calcT', '_normItems'], { EMPRESA: empresa });
}

function frontend(empresa, aplicaIVA, items) {
  const ctx = {
    _cotEmpresa: empresa,
    _cotItems: items,
    window: {},
    localStorage: { getItem: () => null },
    document: { getElementById: (id) => (id === 'cotIVA' ? { checked: aplicaIVA } : null) },
  };
  return load('cotizaciones.js',
    ['cotR2', 'cotTotalLinea', '_cotEmpresaIvaConfig', 'cotCalcularTotales'], ctx);
}

const CASES = [
  [{ cantidad: 1, precioUnit: 100 }],
  [{ cantidad: 3, precioUnit: 10.005, descuentoPct: 10 }, { cantidad: 1, precioUnit: 100 }],
  [{ cantidad: 2, precioUnit: 1.005 }],
  [{ cantidad: 7, precioUnit: 19.99, descuentoPct: 15 }, { cantidad: 0.5, precioUnit: 333.33 }],
  [{ cantidad: 12, precioUnit: 0.07 }, { cantidad: 1, precioUnit: 1234.56, descuentoPct: 2.5 }],
];

for (const mod of ['incluido', 'sobre', 'exento']) {
  for (const aplicaIVA of [true, false]) {
    test(`UI total == total guardado (${mod}, IVA ${aplicaIVA ? 'sí' : 'no'})`, () => {
      const empresa = { ivaPct: 12, ivaModalidad: mod };
      for (const raw of CASES) {
        const items = raw.map((it) => ({ descripcion: 'x', ...it }));
        const ui = frontend(empresa, aplicaIVA, items).cotCalcularTotales();
        const be = backend(empresa);
        const stored = be._calcT(be._normItems(items), 0, aplicaIVA);
        assert.equal(stored.total, ui.total, JSON.stringify({ items, ui, stored }));
        assert.equal(stored.iva, ui.aplicaIVA ? ui.iva : 0);
        // invariante guardado
        assert.equal(be._r2(stored.subtotal - stored.descuento + stored.iva), stored.total);
      }
    });
  }
}

test('incluido: el total no aumenta al aplicar IVA (antes se multiplicaba × 1.12)', () => {
  const be = backend({ ivaPct: 12, ivaModalidad: 'incluido' });
  const t = be._calcT(be._normItems([{ descripcion: 'x', cantidad: 1, precioUnit: 112 }]), 0, true);
  assert.deepEqual({ ...t }, { subtotal: 100, descuento: 0, iva: 12, total: 112 });
});

test('sobre: IVA se suma al subtotal', () => {
  const be = backend({ ivaPct: 12, ivaModalidad: 'sobre' });
  const t = be._calcT(be._normItems([{ descripcion: 'x', cantidad: 1, precioUnit: 100 }]), 0, true);
  assert.deepEqual({ ...t }, { subtotal: 100, descuento: 0, iva: 12, total: 112 });
});

test('IVA 0 % no se convierte en 12 %', () => {
  const be = backend({ ivaPct: 0, ivaModalidad: 'sobre' });
  const t = be._calcT(be._normItems([{ descripcion: 'x', cantidad: 1, precioUnit: 100 }]), 0, true);
  assert.equal(t.total, 100);
  assert.equal(t.iva, 0);
});

test('descuento global se respeta y mantiene el invariante', () => {
  for (const mod of ['incluido', 'sobre']) {
    const be = backend({ ivaPct: 12, ivaModalidad: mod });
    const t = be._calcT(be._normItems([{ descripcion: 'x', cantidad: 4, precioUnit: 25 }]), 10, true);
    assert.equal(t.descuento, 10);
    assert.equal(be._r2(t.subtotal - t.descuento + t.iva), t.total);
  }
});

test('_r2 redondea como numeric de PostgreSQL', () => {
  const { _r2 } = backend({ ivaPct: 12 });
  assert.equal(_r2(1.005), 1.01);
  assert.equal(_r2(27.0135), 27.01);
  assert.equal(_r2(10.075), 10.08);
  assert.equal(_r2(0.1 + 0.2), 0.3);
  assert.equal(_r2('abc'), 0);
});

test('_normItems descarta líneas vacías o con cantidad 0 y limita el descuento', () => {
  const { _normItems } = backend({ ivaPct: 12 });
  const out = _normItems([
    { descripcion: '', cantidad: 1, precioUnit: 5 },
    { descripcion: 'cero', cantidad: 0, precioUnit: 5 },
    { descripcion: 'ok', cantidad: 2, precioUnit: 5, descuentoPct: 150 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].descuentoPct, 100);
  assert.equal(out[0].total, 0);
});
