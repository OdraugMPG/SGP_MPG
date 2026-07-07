const { diaDeSemana, semanaISO, resolverJefeTurno, fusionarTurnosNocturnos } = require('./importar');

const TOLERANCIA_MIN = 20;

const TURNO_PLANO_HORARIO = {
  Lun: { entrada: '08:00:00', salida: '17:30:00' },
  Mar: { entrada: '08:00:00', salida: '17:30:00' },
  Mié: { entrada: '08:00:00', salida: '17:30:00' },
  Jue: { entrada: '08:00:00', salida: '16:00:00' },
  Vie: { entrada: '08:00:00', salida: '16:00:00' },
  // Sáb y Dom: sin jornada para turno Plano
};

function horaAMinutos(horaStr) {
  if (!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

// Resuelve la hora final de entrada o salida cuando Talana puede tener 0, 1 o
// varias marcas del mismo tipo el mismo día (marcación duplicada/errada).
//
// candidatos: array de horas 'HH:MM:SS' marcadas en Talana para ese tipo (entrada o salida)
// horaCencosud: hora de referencia de Cencosud para ese mismo movimiento (o null)
// preferido: 'primera' | 'ultima' -> cuál usar por defecto cuando no hay forma de decidir
function resolverHora(candidatos, horaCencosud, preferido) {
  if (candidatos.length === 1) {
    return { hora: candidatos[0], origen: 'talana' };
  }

  if (candidatos.length === 0) {
    if (horaCencosud) return { hora: horaCencosud, origen: 'cencosud' };
    return { hora: null, origen: null };
  }

  // Hay 2+ candidatos (marcación duplicada/errada) -> desambiguar con Cencosud
  if (horaCencosud) {
    const refMin = horaAMinutos(horaCencosud);
    let mejor = null;
    let mejorDiff = Infinity;
    for (const c of candidatos) {
      const diff = Math.abs(horaAMinutos(c) - refMin);
      if (diff < mejorDiff) { mejorDiff = diff; mejor = c; }
    }
    if (mejorDiff <= TOLERANCIA_MIN) {
      return { hora: mejor, origen: 'talana_validado' };
    }
    // Ninguna marca de Talana calza dentro de tolerancia -> usar Cencosud directo
    return { hora: horaCencosud, origen: 'cencosud' };
  }

  // Sin referencia de Cencosud: usar la primera o última marca según corresponda
  const ordenadas = [...candidatos].sort();
  const elegida = preferido === 'ultima' ? ordenadas[ordenadas.length - 1] : ordenadas[0];
  return { hora: elegida, origen: 'talana_ambiguo' };
}

async function calcularResultados(pool) {
  await pool.query('DELETE FROM resultado_diario');

  // Agrupar TODAS las marcaciones Talana por rut+fecha+tipo (sin descartar duplicados)
  const { rows: talanaRows } = await pool.query(
    'SELECT rut, fecha, hora, tipo FROM marcaciones_talana ORDER BY rut, fecha, hora'
  );
  const talanaPorDiaCrudo = new Map(); // key rut|fecha -> {entradas: [...], salidas: [...]}
  for (const r of talanaRows) {
    const key = `${r.rut}|${r.fecha}`;
    if (!talanaPorDiaCrudo.has(key)) talanaPorDiaCrudo.set(key, { entradas: [], salidas: [] });
    const acc = talanaPorDiaCrudo.get(key);
    const tipo = (r.tipo || '').toLowerCase();
    if (tipo === 'entrada') acc.entradas.push(r.hora);
    if (tipo === 'salida') acc.salidas.push(r.hora);
  }
  // Turno Noche cruza medianoche: la salida del día siguiente se mueve al día
  // en que la persona entró, para que quede como un único registro de turno.
  const talanaPorDia = fusionarTurnosNocturnos(talanaPorDiaCrudo);

  const { rows: cencosudRows } = await pool.query(
    'SELECT rut, fecha, hora_entrada, hora_salida, turno FROM marcaciones_cencosud'
  );
  const cencosudPorDia = new Map();
  for (const r of cencosudRows) {
    cencosudPorDia.set(`${r.rut}|${r.fecha}`, r);
  }

  const { rows: empleados } = await pool.query('SELECT rut, nombre, apellido_paterno FROM empleados');
  const nombrePorRut = new Map(empleados.map(e => [e.rut, `${e.nombre} ${e.apellido_paterno || ''}`.trim()]));

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));

  const { rows: rotacionRows } = await pool.query(
    'SELECT sem, jefe_turno, dia, hora_entrada, hora_salida FROM rotacion_turnos'
  );
  const rotacionMap = new Map();
  for (const r of rotacionRows) {
    rotacionMap.set(`${r.sem}|${r.jefe_turno}|${r.dia}`, r);
  }

  const todasLasClaves = new Set([...talanaPorDia.keys(), ...cencosudPorDia.keys()]);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const key of todasLasClaves) {
      const [rut, fecha] = key.split('|');
      const talana = talanaPorDia.get(key);
      const cencosud = cencosudPorDia.get(key);

      const marcoTalana = !!talana && (talana.entradas.length > 0 || talana.salidas.length > 0);
      const marcoCencosud = !!cencosud;

      let inconsistencia = null;
      if (marcoTalana && !marcoCencosud) inconsistencia = 'Marcó en Talana pero no en Cencosud';
      else if (!marcoTalana && marcoCencosud) inconsistencia = 'Marcó en Cencosud pero no en Talana';

      const entradas = talana ? talana.entradas : [];
      const salidas = talana ? talana.salidas : [];
      const cencosudEntrada = cencosud ? cencosud.hora_entrada : null;
      const cencosudSalida = cencosud ? cencosud.hora_salida : null;

      const resEntrada = resolverHora(entradas, cencosudEntrada, 'primera');
      const resSalida = resolverHora(salidas, cencosudSalida, 'ultima');

      const horaEntradaReal = resEntrada.hora;
      const horaSalidaReal = resSalida.hora;

      let horasTrabajadas = null;
      if (horaEntradaReal && horaSalidaReal) {
        let mins = horaAMinutos(horaSalidaReal) - horaAMinutos(horaEntradaReal);
        if (mins < 0) mins += 24 * 60; // turno nocturno cruza medianoche
        horasTrabajadas = Math.round((mins / 60) * 100) / 100;
      }

      const dia = diaDeSemana(fecha);
      const sem = semanaISO(fecha);
      const codigoAsignado = jefeTurnoPorRut.get(rut);
      let horaEsperada = null;
      let minutosAtraso = null;

      if (codigoAsignado === 'CG') {
        const horarioPlano = TURNO_PLANO_HORARIO[dia];
        if (horarioPlano) horaEsperada = horarioPlano.entrada;
      } else if (codigoAsignado) {
        const codigoResuelto = resolverJefeTurno(codigoAsignado);
        const rot = rotacionMap.get(`${sem}|${codigoResuelto}|${dia}`);
        if (rot) horaEsperada = rot.hora_entrada;
      }

      if (horaEsperada && horaEntradaReal) {
        const diff = horaAMinutos(horaEntradaReal) - horaAMinutos(horaEsperada);
        minutosAtraso = diff > 0 ? diff : 0;
      }

      await client.query(
        `INSERT INTO resultado_diario
          (rut, fecha, nombre, marco_talana, marco_cencosud, inconsistencia,
           hora_entrada_real, hora_salida_real, hora_entrada_esperada, minutos_atraso, horas_trabajadas,
           origen_entrada, origen_salida)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          rut, fecha, nombrePorRut.get(rut) || null,
          marcoTalana ? 1 : 0, marcoCencosud ? 1 : 0, inconsistencia,
          horaEntradaReal, horaSalidaReal, horaEsperada, minutosAtraso, horasTrabajadas,
          resEntrada.origen, resSalida.origen,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { calcularResultados };