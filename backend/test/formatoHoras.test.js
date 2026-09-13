const test = require('node:test');
const assert = require('node:assert/strict');
const cierreNomina = require('../cierreNomina');
const reporteHorasExtras = require('../reporteHorasExtras');

// horasFormatoAMinutos/minutosAFormato están duplicadas (mismo código) en
// cierreNomina.js y reporteHorasExtras.js. Se testean ambas copias por
// separado para detectar si alguna se edita sin actualizar la otra.
for (const [nombreModulo, mod] of [['cierreNomina', cierreNomina], ['reporteHorasExtras', reporteHorasExtras]]) {
  test(`${nombreModulo}.horasFormatoAMinutos: convierte "HH:MM" a minutos, incluyendo negativos`, () => {
    assert.equal(mod.horasFormatoAMinutos('01:30'), 90);
    assert.equal(mod.horasFormatoAMinutos('-01:30'), -90);
    assert.equal(mod.horasFormatoAMinutos(null), 0);
    assert.equal(mod.horasFormatoAMinutos(''), 0);
  });
}

test('cierreNomina.minutosAFormato: convierte minutos a "HH:MM", incluyendo negativos', () => {
  assert.equal(cierreNomina.minutosAFormato(90), '01:30');
  assert.equal(cierreNomina.minutosAFormato(-90), '-01:30');
  assert.equal(cierreNomina.minutosAFormato(0), '00:00');
});

test('cierreNomina: horasFormatoAMinutos y minutosAFormato son inversas entre sí', () => {
  for (const original of ['00:00', '01:30', '08:45', '-02:15']) {
    const mins = cierreNomina.horasFormatoAMinutos(original);
    assert.equal(cierreNomina.minutosAFormato(mins), original);
  }
});
