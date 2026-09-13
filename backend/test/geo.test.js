const test = require('node:test');
const assert = require('node:assert/strict');
const { calcularDistanciaMetros } = require('../geo');

test('calcularDistanciaMetros: mismo punto da distancia 0', () => {
  assert.equal(calcularDistanciaMetros(-33.45, -70.65, -33.45, -70.65), 0);
});

test('calcularDistanciaMetros: 1 grado de latitud son aproximadamente 111.320m', () => {
  const d = calcularDistanciaMetros(-33.0, -70.0, -34.0, -70.0);
  assert.ok(Math.abs(d - 111320) < 200, `esperado ~111320m, dio ${d}`);
});

test('calcularDistanciaMetros: puntos separados por ~30m (dentro de un radio de 40m)', () => {
  // ~0.00027 grados de latitud equivalen a aprox 30m.
  const d = calcularDistanciaMetros(-33.45, -70.65, -33.45 - 0.00027, -70.65);
  assert.ok(d > 25 && d < 35, `esperado ~30m, dio ${d}`);
  assert.ok(d < 40); // dentro del radio default de cd_movil
});

test('calcularDistanciaMetros: puntos separados por ~60m (fuera de un radio de 40m)', () => {
  const d = calcularDistanciaMetros(-33.45, -70.65, -33.45 - 0.00054, -70.65);
  assert.ok(d > 40); // fuera del radio default de cd_movil
});

test('calcularDistanciaMetros: es simétrica', () => {
  const a = calcularDistanciaMetros(-33.45, -70.65, -33.40, -70.60);
  const b = calcularDistanciaMetros(-33.40, -70.60, -33.45, -70.65);
  assert.ok(Math.abs(a - b) < 0.001);
});
