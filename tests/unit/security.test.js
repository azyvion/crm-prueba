// Pruebas de seguridad del frontend (auditoría de seguridad 2026-10-23).
// Ejecutar: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');

// Carga utils.js en un contexto con DOM mínimo y captura el contenido del CSV generado.
function descargarCSVCapturando(filas) {
  let capturado = '';
  const a = { click() {}, set href(v) {}, get href() { return ''; }, style: {}, classList: { add() {}, remove() {} } };
  const dummy = () => ({ style: {}, classList: { add() {}, remove() {} }, set innerHTML(v) {}, set textContent(v) {}, appendChild() {}, querySelector: () => null });
  const ctx = {
    document: { createElement: () => a, getElementById: dummy, querySelector: () => null, body: { appendChild() {}, removeChild() {} } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Blob: function (parts) { capturado = parts.join(''); },
    showToast() {}, setTimeout() {}, clearTimeout() {}, console,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'utils.js'), 'utf8'), ctx);
  ctx.descargarCSV(filas, 'prueba');
  return capturado;
}

test('CSV injection: las celdas que parecen fórmula se neutralizan con apóstrofo', () => {
  const csv = descargarCSVCapturando([
    { nombre: '=HYPERLINK("http://evil.com","clic")', nota: 'normal' },
    { nombre: '+1234567', nota: '-2+3' },
    { nombre: '@SUM(A1:A9)', nota: '\t=cmd' },
    { nombre: 'Juan Pérez', nota: 'a=b (no empieza con =)' },
  ]);
  // Cada payload de fórmula va precedido por apóstrofo (lo neutraliza Excel/Sheets)
  assert.ok(csv.includes(`'=HYPERLINK`), 'HYPERLINK no neutralizado');
  assert.ok(/'\+1234567/.test(csv), '+ no neutralizado');
  assert.ok(/'-2\+3/.test(csv), '- no neutralizado');
  assert.ok(csv.includes(`'@SUM`), '@ no neutralizado');
  assert.ok(csv.includes(`'\t=cmd`) || csv.includes(`"'\t=cmd"`), 'tab no neutralizado');
  // Un valor legítimo que NO empieza con carácter peligroso no se altera
  assert.ok(csv.includes('Juan Pérez'), 'alteró un valor legítimo');
  assert.ok(csv.includes('a=b (no empieza con =)'), 'alteró un valor con = interno');
});

test('CSV: el escape de comillas y separadores sigue funcionando tras el cambio', () => {
  const csv = descargarCSVCapturando([{ a: 'x,y', b: 'dijo "hola"', c: 'línea1\nlínea2' }]);
  assert.ok(csv.includes('"x,y"'), 'no entrecomilló la coma');
  assert.ok(csv.includes('"dijo ""hola"""'), 'no duplicó las comillas');
  assert.ok(csv.includes('"línea1\nlínea2"'), 'no entrecomilló el salto de línea');
});
