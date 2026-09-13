const test = require('node:test');
const assert = require('node:assert/strict');
const { horaAMinutos, resolverHora } = require('../calcular');

test('horaAMinutos: convierte HH:MM:SS a minutos desde medianoche', () => {
  assert.equal(horaAMinutos('08:30:00'), 510);
  assert.equal(horaAMinutos('00:00:00'), 0);
  assert.equal(horaAMinutos(null), null);
});

test('resolverHora: un solo candidato de Talana se usa directo', () => {
  const r = resolverHora(['08:05:00'], null, 'primera');
  assert.deepEqual(r, { hora: '08:05:00', origen: 'talana' });
});

test('resolverHora: sin marca en Talana, usa Cencosud como respaldo', () => {
  const r = resolverHora([], '08:00:00', 'primera');
  assert.deepEqual(r, { hora: '08:00:00', origen: 'cencosud' });
});

test('resolverHora: sin marca en ninguno de los dos sistemas', () => {
  const r = resolverHora([], null, 'primera');
  assert.deepEqual(r, { hora: null, origen: null });
});

test('resolverHora: marcación duplicada en Talana se desambigua con Cencosud dentro de tolerancia (20min)', () => {
  const r = resolverHora(['08:05:00', '17:55:00'], '08:00:00', 'primera');
  assert.deepEqual(r, { hora: '08:05:00', origen: 'talana_validado' });
});

test('resolverHora: candidatos fuera de tolerancia respecto a Cencosud usan Cencosud directo', () => {
  const r = resolverHora(['12:00:00', '17:00:00'], '08:00:00', 'primera');
  assert.deepEqual(r, { hora: '08:00:00', origen: 'cencosud' });
});

test('resolverHora: con 2+ candidatos, exactamente en el borde de tolerancia (20min) cuenta como validado', () => {
  const r = resolverHora(['08:20:00', '17:00:00'], '08:00:00', 'primera');
  assert.deepEqual(r, { hora: '08:20:00', origen: 'talana_validado' });
});

test('resolverHora: con 2+ candidatos, 21 minutos de diferencia ya no cuenta como validado', () => {
  const r = resolverHora(['08:21:00', '17:00:00'], '08:00:00', 'primera');
  assert.deepEqual(r, { hora: '08:00:00', origen: 'cencosud' });
});

test('resolverHora: múltiples candidatos sin Cencosud usa "primera" u "ultima" según se pida', () => {
  const primera = resolverHora(['09:00:00', '08:00:00'], null, 'primera');
  assert.deepEqual(primera, { hora: '08:00:00', origen: 'talana_ambiguo' });

  const ultima = resolverHora(['09:00:00', '08:00:00'], null, 'ultima');
  assert.deepEqual(ultima, { hora: '09:00:00', origen: 'talana_ambiguo' });
});
