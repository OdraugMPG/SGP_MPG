const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calcularHorasExtrasDesdeMinutos, minutosExtraFinal, minutosAnticipados,
  calcularHorasTrabajadas, formatoHoras, formatoMinutos, normalizarTurnoLabel,
} = require('../detalleMarcaciones');

// Tabla de redondeo para pago de horas extras (documentada en el código):
//  < 30 min: 0 | 30-45 min: se pagan 45 | 45-60 min: se paga la hora | >=60: exacto
test('calcularHorasExtrasDesdeMinutos: no paga nada bajo 30 minutos', () => {
  assert.equal(calcularHorasExtrasDesdeMinutos(0), 0);
  assert.equal(calcularHorasExtrasDesdeMinutos(29), 0);
  assert.equal(calcularHorasExtrasDesdeMinutos(null), 0);
});

test('calcularHorasExtrasDesdeMinutos: entre 30 y 45 minutos paga 45 minutos completos', () => {
  assert.equal(calcularHorasExtrasDesdeMinutos(30), 0.75);
  assert.equal(calcularHorasExtrasDesdeMinutos(40), 0.75);
  assert.equal(calcularHorasExtrasDesdeMinutos(45), 0.75);
});

test('calcularHorasExtrasDesdeMinutos: entre 46 y 59 minutos paga la hora completa', () => {
  assert.equal(calcularHorasExtrasDesdeMinutos(46), 1);
  assert.equal(calcularHorasExtrasDesdeMinutos(59), 1);
});

test('calcularHorasExtrasDesdeMinutos: 60 minutos o más paga el tiempo exacto', () => {
  assert.equal(calcularHorasExtrasDesdeMinutos(60), 1);
  assert.equal(calcularHorasExtrasDesdeMinutos(90), 1.5);
  assert.equal(calcularHorasExtrasDesdeMinutos(125), 2.08);
});

test('minutosExtraFinal: solo cuenta minutos DESPUÉS de la salida esperada', () => {
  assert.equal(minutosExtraFinal('18:30:00', '18:00:00'), 30);
  assert.equal(minutosExtraFinal('17:30:00', '18:00:00'), 0); // salió antes, no es extra
  assert.equal(minutosExtraFinal('18:00:00', '18:00:00'), 0);
  assert.equal(minutosExtraFinal(null, '18:00:00'), 0);
});

test('minutosAnticipados: solo cuenta minutos ANTES de la entrada esperada', () => {
  assert.equal(minutosAnticipados('13:30:00', '14:00:00'), 30);
  assert.equal(minutosAnticipados('14:30:00', '14:00:00'), 0); // llegó después, no es anticipado
  assert.equal(minutosAnticipados(null, '14:00:00'), 0);
});

test('calcularHorasTrabajadas: turno normal dentro del mismo día', () => {
  // 08:00 a 17:30 = 9.5h, +30min colación (AM/PM) = 10h
  assert.equal(calcularHorasTrabajadas('08:00:00', '17:30:00', 30), 10);
});

test('calcularHorasTrabajadas: turno Noche que cruza medianoche', () => {
  // 22:00 a 06:00 cruza medianoche = 8h brutas, -60min colación turno noche = 7h
  assert.equal(calcularHorasTrabajadas('22:00:00', '06:00:00', -60), 7);
});

test('calcularHorasTrabajadas: sin entrada o sin salida devuelve null', () => {
  assert.equal(calcularHorasTrabajadas(null, '17:30:00', 30), null);
  assert.equal(calcularHorasTrabajadas('08:00:00', null, 30), null);
});

test('formatoHoras: convierte decimal a HH:MM, incluyendo negativos', () => {
  assert.equal(formatoHoras(8.5), '08:30');
  assert.equal(formatoHoras(-1.25), '-01:15');
  assert.equal(formatoHoras(null), null);
});

test('formatoMinutos: convierte minutos a HH:MM, incluyendo negativos', () => {
  assert.equal(formatoMinutos(90), '01:30');
  assert.equal(formatoMinutos(-15), '-00:15');
  assert.equal(formatoMinutos(null), null);
});

test('normalizarTurnoLabel: prioriza el turno informado por Cencosud si viene', () => {
  assert.equal(normalizarTurnoLabel('NOCHE', 'T_BV', '2026-07-06', new Map()), 'Noche');
  assert.equal(normalizarTurnoLabel('AM', 'T_BV', '2026-07-06', new Map()), 'AM');
});

test('normalizarTurnoLabel: sin dato de Cencosud, CG/PLANO siempre es Plano', () => {
  assert.equal(normalizarTurnoLabel(null, 'CG', '2026-07-06', new Map()), 'Plano');
});

test('normalizarTurnoLabel: sin Cencosud ni código asignado devuelve vacío', () => {
  assert.equal(normalizarTurnoLabel(null, null, '2026-07-06', new Map()), '');
});
