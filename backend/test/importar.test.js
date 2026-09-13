const test = require('node:test');
const assert = require('node:assert/strict');
const {
  diaDeSemana, semanaISO, resolverJefeTurno, toFechaISO, toHoraStr,
  contratoDesdeRazonSocial, sumarDias, fusionarTurnosNocturnos, limpiarRut,
  determinarTipoTurno, minutosAjusteColacion, construirRotacionBasePorClave, tipoTurnoDesdeHoraEntrada,
} = require('../importar');

test('toFechaISO: formato chileno DD/MM/AAAA no se confunde con MM/DD (bug documentado en el código)', () => {
  // 08/07/2026 en formato chileno es 8 de julio, NO 7 de agosto.
  assert.equal(toFechaISO('08/07/2026'), '2026-07-08');
  assert.equal(toFechaISO('1/2/2026'), '2026-02-01');
});

test('toFechaISO: pasa directo un valor ya en formato ISO', () => {
  assert.equal(toFechaISO('2026-07-08'), '2026-07-08');
});

test('toFechaISO: acepta guion como separador', () => {
  assert.equal(toFechaISO('08-07-2026'), '2026-07-08');
});

test('toHoraStr: descarta placeholders sin marcación', () => {
  assert.equal(toHoraStr('--'), null);
  assert.equal(toHoraStr(''), null);
  assert.equal(toHoraStr(null), null);
});

test('toHoraStr: acepta HH:MM y HH:MM:SS', () => {
  assert.equal(toHoraStr('08:30'), '08:30');
  assert.equal(toHoraStr('08:30:15'), '08:30:15');
});

test('limpiarRut: quita puntos y espacios, agrega guion si falta', () => {
  assert.equal(limpiarRut('1.123.123-1'), '1123123-1');
  assert.equal(limpiarRut(' 11231231 '), '1123123-1');
  assert.equal(limpiarRut('11.231.231-k'), '11231231-K');
});

test('limpiarRut: valores vacíos devuelven string vacío', () => {
  assert.equal(limpiarRut(null), '');
  assert.equal(limpiarRut(undefined), '');
});

test('diaDeSemana: devuelve abreviatura en español correcta', () => {
  // 2026-07-06 es lunes
  assert.equal(diaDeSemana('2026-07-06'), 'Lun');
  assert.equal(diaDeSemana('2026-07-12'), 'Dom');
});

test('semanaISO: coincide con el número de semana ISO estándar', () => {
  assert.equal(semanaISO('2026-01-01'), 1); // jueves, semana 1
  assert.equal(semanaISO('2025-12-29'), 1); // lunes de la semana 1 de 2026
});

test('resolverJefeTurno: sin alias configurado devuelve el mismo código', () => {
  assert.equal(resolverJefeTurno('T_BV'), 'T_BV');
});

test('contratoDesdeRazonSocial: mapea razones sociales conocidas', () => {
  assert.equal(contratoDesdeRazonSocial('Manpower Servicios Integrales SpA.'), 'OUT');
  assert.equal(contratoDesdeRazonSocial('Manpower Empresa de Servicios Transitorios Ltda.'), 'SSTT');
});

test('contratoDesdeRazonSocial: razón social desconocida devuelve null', () => {
  assert.equal(contratoDesdeRazonSocial('Otra Empresa SpA.'), null);
});

test('sumarDias: suma y resta días cruzando meses', () => {
  assert.equal(sumarDias('2026-07-31', 1), '2026-08-01');
  assert.equal(sumarDias('2026-08-01', -1), '2026-07-31');
});

test('tipoTurnoDesdeHoraEntrada: clasifica AM/PM/NOCHE según hora', () => {
  assert.equal(tipoTurnoDesdeHoraEntrada('06:00:00'), 'AM');
  assert.equal(tipoTurnoDesdeHoraEntrada('14:00:00'), 'PM');
  assert.equal(tipoTurnoDesdeHoraEntrada('22:00:00'), 'NOCHE');
  assert.equal(tipoTurnoDesdeHoraEntrada('02:00:00'), 'NOCHE');
  assert.equal(tipoTurnoDesdeHoraEntrada(null), null);
});

test('minutosAjusteColacion: Noche resta 60, AM/PM/Plano suman 30, resto no ajusta', () => {
  assert.equal(minutosAjusteColacion('NOCHE'), -60);
  assert.equal(minutosAjusteColacion('AM'), 30);
  assert.equal(minutosAjusteColacion('PM'), 30);
  assert.equal(minutosAjusteColacion('PLANO'), 30);
  assert.equal(minutosAjusteColacion(null), 0);
});

test('construirRotacionBasePorClave: usa rotacion_base cuando viene informada', () => {
  const mapa = construirRotacionBasePorClave([
    { sem: 1, jefe_turno: 'T_BV', rotacion_base: 'PM', dia: 'Lun', hora_entrada: '14:00:00' },
  ]);
  assert.equal(mapa.get('1|T_BV'), 'PM');
});

test('construirRotacionBasePorClave: deriva desde hora_entrada cuando falta rotacion_base', () => {
  const mapa = construirRotacionBasePorClave([
    { sem: 1, jefe_turno: 'T_WP', rotacion_base: null, dia: 'Lun', hora_entrada: '22:00:00' },
  ]);
  assert.equal(mapa.get('1|T_WP'), 'NOCHE');
});

test('determinarTipoTurno: CG y PLANO siempre son PLANO sin mirar rotación', () => {
  const mapa = new Map();
  assert.equal(determinarTipoTurno('CG', '2026-07-06', mapa), 'PLANO');
  assert.equal(determinarTipoTurno('PLANO', '2026-07-06', mapa), 'PLANO');
});

test('determinarTipoTurno: sin código asignado devuelve null', () => {
  assert.equal(determinarTipoTurno(null, '2026-07-06', new Map()), null);
});

test('fusionarTurnosNocturnos: mueve la salida de madrugada al día en que se abrió el turno', () => {
  const talanaPorDia = new Map([
    ['11111111-1|2026-07-06', { entradas: ['22:00:00'], salidas: [] }],
    ['11111111-1|2026-07-07', { entradas: ['22:00:00'], salidas: ['06:00:00'] }],
  ]);
  const fusionado = fusionarTurnosNocturnos(talanaPorDia);

  assert.deepEqual(fusionado.get('11111111-1|2026-07-06').salidas, ['06:00:00']);
  assert.deepEqual(fusionado.get('11111111-1|2026-07-07').salidas, []);
  // La entrada de la noche del 07 sigue intacta (abre el turno que se cierra el 08).
  assert.deepEqual(fusionado.get('11111111-1|2026-07-07').entradas, ['22:00:00']);
});

test('fusionarTurnosNocturnos: turnos noche consecutivos no se arrastran más de un día atrás', () => {
  // Caso del bug real descrito en el código: varios días seguidos de turno
  // Noche, cada uno debe cerrar SOLO el turno de ayer, no arrastrar salidas
  // ya fusionadas un día más atrás.
  const talanaPorDia = new Map([
    ['11111111-1|2026-07-05', { entradas: ['22:00:00'], salidas: [] }],
    ['11111111-1|2026-07-06', { entradas: ['22:00:00'], salidas: ['06:00:00'] }],
    ['11111111-1|2026-07-07', { entradas: ['22:00:00'], salidas: ['06:00:00'] }],
    ['11111111-1|2026-07-08', { entradas: [], salidas: ['06:00:00'] }],
  ]);
  const fusionado = fusionarTurnosNocturnos(talanaPorDia);

  assert.deepEqual(fusionado.get('11111111-1|2026-07-05').salidas, ['06:00:00']);
  assert.deepEqual(fusionado.get('11111111-1|2026-07-06').salidas, ['06:00:00']);
  assert.deepEqual(fusionado.get('11111111-1|2026-07-07').salidas, ['06:00:00']);
  assert.equal(fusionado.has('11111111-1|2026-07-08'), false); // quedó vacío, se limpia
});

test('fusionarTurnosNocturnos: sin turno abierto el día anterior, no mueve la salida', () => {
  const talanaPorDia = new Map([
    ['11111111-1|2026-07-07', { entradas: [], salidas: ['06:00:00'] }],
  ]);
  const fusionado = fusionarTurnosNocturnos(talanaPorDia);
  assert.deepEqual(fusionado.get('11111111-1|2026-07-07').salidas, ['06:00:00']);
});
