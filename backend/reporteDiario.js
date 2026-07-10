const XLSX = require('xlsx');
const { contratoDesdeRazonSocial, diaDeSemana, semanaISO, resolverJefeTurno, sumarDias, fusionarTurnosNocturnos } = require('./importar');

const TOLERANCIA_MIN = 20;

// Horario Plano (para los códigos 'CG': Jefe de Operaciones / Supervisor Senior)
const TURNO_PLANO_HORARIO = {
  Lun: { entrada: '08:00:00', salida: '17:30:00' },
  Mar: { entrada: '08:00:00', salida: '17:30:00' },
  Mié: { entrada: '08:00:00', salida: '17:30:00' },
  Jue: { entrada: '08:00:00', salida: '16:00:00' },
  Vie: { entrada: '08:00:00', salida: '16:00:00' },
};

function horaAMinutos(horaStr) {
  if (!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

function minutosAHora(mins) {
  const m = ((mins % 1440) + 1440) % 1440; // normaliza por si cruza medianoche
  const h = Math.floor(m / 60);
  const min = Math.round(m % 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

// Detecta doble marcación de un mismo tipo (2+ "Entrada" sin ninguna "Salida",
// o al revés) y la reinterpreta: la marca más temprana queda como entrada real
// y la más tardía como salida real (la persona probablemente marcó el botón
// equivocado la segunda vez). Devuelve las entradas/salidas corregidas y,
// si hubo corrección, un registro para el log de errores.
function corregirMarcasDuplicadas(talana) {
  const entradas = [...talana.entradas];
  const salidas = [...talana.salidas];

  if (entradas.length > 1 && salidas.length === 0) {
    const entradaReal = entradas[0];
    const salidaReasignada = entradas[entradas.length - 1];
    return {
      entradas: [entradaReal],
      salidas: [salidaReasignada],
      log: {
        tipo_error: 'doble_entrada',
        detalle: `Marcó "Entrada" ${entradas.length} veces (${entradas.join(', ')}) y ninguna "Salida". Se tomó ${entradaReal} como entrada y ${salidaReasignada} como salida.`,
      },
    };
  }

  if (salidas.length > 1 && entradas.length === 0) {
    const entradaReasignada = salidas[0];
    const salidaReal = salidas[salidas.length - 1];
    return {
      entradas: [entradaReasignada],
      salidas: [salidaReal],
      log: {
        tipo_error: 'doble_salida',
        detalle: `Marcó "Salida" ${salidas.length} veces (${salidas.join(', ')}) y ninguna "Entrada". Se tomó ${entradaReasignada} como entrada y ${salidaReal} como salida.`,
      },
    };
  }

  return { entradas, salidas, log: null };
}

// Elige, entre varios candidatos de Talana, el más cercano a la hora de referencia de Cencosud,
// solo si cae dentro de la tolerancia. Si ninguno califica, se usa la hora de Cencosud directamente.
// Si tampoco hay Cencosud, se recurre al primero/último candidato de Talana disponible.
function resolverHora(candidatosTalana, horaReferenciaCencosud, preferirPrimero) {
  const refMin = horaAMinutos(horaReferenciaCencosud);

  if (candidatosTalana.length === 1) {
    return candidatosTalana[0];
  }

  if (refMin !== null) {
    let mejor = null;
    let mejorDiff = Infinity;
    for (const c of candidatosTalana) {
      const diff = Math.abs(horaAMinutos(c) - refMin);
      if (diff <= TOLERANCIA_MIN && diff < mejorDiff) {
        mejor = c;
        mejorDiff = diff;
      }
    }
    if (mejor) return mejor;
    return horaReferenciaCencosud;
  }

  if (candidatosTalana.length > 0) {
    return preferirPrimero ? candidatosTalana[0] : candidatosTalana[candidatosTalana.length - 1];
  }
  return null;
}

function normalizarTurno(valorCencosud, codigoJefeTurno) {
  if (valorCencosud) {
    const v = valorCencosud.toString().trim().toUpperCase();
    if (v === 'NOCHE') return 'Noche';
    if (v === 'PLANO') return 'Plano';
    if (v === 'AM' || v === 'PM') return v;
    if (v !== 'SIN TURNO') return valorCencosud;
  }
  if (codigoJefeTurno === 'CG' || codigoJefeTurno === 'PLANO') return 'Plano';
  return '';
}

// Horario programado (según DB_Rotacion o Plano) para un código de jefe de turno y fecha dada.
// Se usa solo como respaldo cuando no existe ninguna marca real en Talana ni Cencosud.
function horarioProgramado(rotacionMap, codigoJefeTurno, fecha) {
  if (!codigoJefeTurno) return { entrada: null, salida: null };

  const dia = diaDeSemana(fecha);

  if (codigoJefeTurno === 'CG' || codigoJefeTurno === 'PLANO') {
    const h = TURNO_PLANO_HORARIO[dia];
    return h ? { entrada: h.entrada, salida: h.salida } : { entrada: null, salida: null };
  }

  const sem = semanaISO(fecha);
  const codigoResuelto = resolverJefeTurno(codigoJefeTurno);
  const rot = rotacionMap.get(`${sem}|${codigoResuelto}|${dia}`);
  return rot ? { entrada: rot.hora_entrada, salida: rot.hora_salida } : { entrada: null, salida: null };
}

async function generarReporteDiario(pool, fecha) {
  const { rows: empleados } = await pool.query('SELECT * FROM empleados');

  // Se consultan también el día anterior y siguiente porque el turno Noche
  // cruza medianoche: la entrada puede estar el día anterior o la salida al
  // día siguiente respecto a la fecha que se está reportando.
  const fechaAnterior = sumarDias(fecha, -1);
  const fechaSiguiente = sumarDias(fecha, 1);
  const { rows: talanaRows } = await pool.query(
    'SELECT rut, fecha, hora, tipo FROM marcaciones_talana WHERE fecha IN ($1,$2,$3)',
    [fechaAnterior, fecha, fechaSiguiente]
  );
  const talanaPorDiaCrudo = new Map(); // key rut|fecha -> {entradas, salidas}
  for (const r of talanaRows) {
    const key = `${r.rut}|${r.fecha}`;
    if (!talanaPorDiaCrudo.has(key)) talanaPorDiaCrudo.set(key, { entradas: [], salidas: [] });
    const acc = talanaPorDiaCrudo.get(key);
    const tipo = (r.tipo || '').toLowerCase();
    if (tipo === 'entrada') acc.entradas.push(r.hora);
    else if (tipo === 'salida') acc.salidas.push(r.hora);
  }
  const talanaFusionado = fusionarTurnosNocturnos(talanaPorDiaCrudo);
  for (const acc of talanaFusionado.values()) {
    acc.entradas.sort();
    acc.salidas.sort();
  }

  const { rows: cencosudRows } = await pool.query(
    'SELECT rut, hora_entrada, hora_salida, turno FROM marcaciones_cencosud WHERE fecha = $1', [fecha]
  );
  const cencosudPorRut = new Map(cencosudRows.map(r => [r.rut, r]));

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));

  const { rows: rotacionRows } = await pool.query(
    'SELECT sem, jefe_turno, dia, hora_entrada, hora_salida FROM rotacion_turnos'
  );
  const rotacionMap = new Map();
  for (const r of rotacionRows) rotacionMap.set(`${r.sem}|${r.jefe_turno}|${r.dia}`, r);

  const { rows: contratoRows } = await pool.query('SELECT rut, razon_social FROM contrato_rut');
  const razonSocialPorRut = new Map(contratoRows.map(c => [c.rut, c.razon_social]));

  const { rows: ausenciaRows } = await pool.query(
    'SELECT rut, tipo FROM ausencias_permisos WHERE fecha = $1', [fecha]
  );
  const ausenciaPorRut = new Map(ausenciaRows.map(a => [a.rut, a.tipo]));

  const filas = [];
  const logsGenerados = [];

  for (const emp of empleados) {
    const nombreCompleto = `${emp.nombre} ${emp.apellido_paterno || ''}`.trim();
    const codigoJefeTurno = jefeTurnoPorRut.get(emp.rut);
    const cencosud = cencosudPorRut.get(emp.rut);
    const contrato = contratoDesdeRazonSocial(razonSocialPorRut.get(emp.rut)) || 'OUT';

    // Si hay una ausencia/permiso asignado para este día, se muestra la sigla
    // en vez de calcular horas desde Talana/Cencosud.
    const ausencia = ausenciaPorRut.get(emp.rut);
    if (ausencia) {
      filas.push({
        'N°': 0,
        EMPRESA: 'MANPOWER',
        NOMBRE: nombreCompleto,
        RUT: emp.rut,
        CARGO: emp.cargo || '',
        TURNO: normalizarTurno(cencosud?.turno, codigoJefeTurno),
        FECHA: fecha,
        'HORA (ENTRADA)': ausencia,
        'HORA (SALIDA)': ausencia,
        CONTRATO: contrato,
        entrada_estimada: false,
        salida_estimada: false,
        salida_sancion: false,
        ausencia: true,
      });
      continue;
    }

    const talanaCruda = talanaFusionado.get(`${emp.rut}|${fecha}`) || { entradas: [], salidas: [] };

    // 1) Corrige doble marcación del mismo tipo (ej: 2 "Entrada" sin ninguna "Salida")
    const { entradas, salidas, log: logDuplicado } = corregirMarcasDuplicadas(talanaCruda);
    if (logDuplicado) {
      logsGenerados.push({ rut: emp.rut, nombre: nombreCompleto, fecha, ...logDuplicado });
    }

    // 2) Resuelve entrada normalmente (Talana real, o Cencosud si Talana no tiene)
    let horaEntrada = resolverHora(entradas, cencosud?.hora_entrada || null, true);

    // 3) Resuelve salida: si Talana SÍ tiene una marca (ya corregida), se usa esa
    //    (con el cruce de tolerancia contra Cencosud de siempre). Si Talana NO
    //    tiene ninguna marca de salida, se aplica la sanción de 4 horas desde la
    //    entrada real — sin importar si Cencosud sí registra una salida — para
    //    no incentivar dejar de marcar en Talana.
    let horaSalida = null;
    let salidaSancion = false;
    if (salidas.length > 0) {
      horaSalida = resolverHora(salidas, cencosud?.hora_salida || null, false);
    } else if (horaEntrada) {
      horaSalida = minutosAHora(horaAMinutos(horaEntrada) + 240);
      salidaSancion = true;
      logsGenerados.push({
        rut: emp.rut, nombre: nombreCompleto, fecha,
        tipo_error: 'sin_marca_salida_talana',
        detalle: `Entrada real ${horaEntrada}${cencosud?.hora_salida ? ` (Cencosud sí registra salida ${cencosud.hora_salida}, pero no se usa)` : ''}. Sin marca de salida en Talana: se asignó ${horaSalida} (entrada + 4 horas) como sanción.`,
      });
    }

    if (!horaEntrada && !horaSalida && !cencosud) continue; // sin ningún dato ese día: se omite

    let entradaEstimada = false;
    let salidaEstimada = salidaSancion;
    if (!horaEntrada || !horaSalida) {
      const programado = horarioProgramado(rotacionMap, codigoJefeTurno, fecha);
      if (!horaEntrada && programado.entrada) { horaEntrada = programado.entrada; entradaEstimada = true; }
      if (!horaSalida && programado.salida) { horaSalida = programado.salida; salidaEstimada = true; }
    }

    filas.push({
      'N°': 0,
      EMPRESA: 'MANPOWER',
      NOMBRE: nombreCompleto,
      RUT: emp.rut,
      CARGO: emp.cargo || '',
      TURNO: normalizarTurno(cencosud?.turno, codigoJefeTurno),
      FECHA: fecha,
      'HORA (ENTRADA)': horaEntrada || '00:00:00',
      'HORA (SALIDA)': horaSalida || '00:00:00',
      CONTRATO: contrato,
      entrada_estimada: entradaEstimada,
      salida_estimada: salidaEstimada,
      salida_sancion: salidaSancion,
    });
  }

  // Guarda el log de errores de marcación para esta fecha (se reemplaza si el
  // reporte se vuelve a generar, para no acumular duplicados).
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM log_marcacion WHERE fecha = $1', [fecha]);
    for (const l of logsGenerados) {
      await client.query(
        `INSERT INTO log_marcacion (rut, nombre, fecha, tipo_error, detalle) VALUES ($1,$2,$3,$4,$5)`,
        [l.rut, l.nombre, l.fecha, l.tipo_error, l.detalle]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  filas.sort((a, b) => a.RUT.localeCompare(b.RUT));
  filas.forEach((f, i) => { f['N°'] = i + 1; });

  return filas;
}

async function obtenerLogMarcacion(pool, fecha) {
  const { rows } = await pool.query(
    `SELECT rut, nombre, fecha, tipo_error, detalle, creado_en
     FROM log_marcacion WHERE fecha = $1 ORDER BY rut`,
    [fecha]
  );
  return rows;
}

async function exportarReporteDiarioXlsx(pool, fecha) {
  const filas = await generarReporteDiario(pool, fecha);
  const ws = XLSX.utils.json_to_sheet(filas);

  const filaNota = filas.length + 3;
  XLSX.utils.sheet_add_aoa(ws, [
    ['* Hora estimada según el horario programado del turno (no corresponde a una marcación real en Talana ni Cencosud).'],
    ['** Salida asignada como sanción (entrada + 4 horas) por no registrar marca de salida en Talana.'],
  ], { origin: `A${filaNota}` });

  const wb = XLSX.utils.book_new();
  const nombreHoja = fecha.slice(5).split('-').reverse().join('-');
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja);

  // Segunda hoja: log de errores de marcación, para informar al trabajador
  const log = await obtenerLogMarcacion(pool, fecha);
  const wsLog = XLSX.utils.json_to_sheet(
    log.map(l => ({
      RUT: l.rut,
      NOMBRE: l.nombre,
      FECHA: l.fecha,
      'TIPO DE ERROR': l.tipo_error,
      DETALLE: l.detalle,
    }))
  );
  XLSX.utils.book_append_sheet(wb, wsLog, 'Log de Errores');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generarReporteDiario, exportarReporteDiarioXlsx, obtenerLogMarcacion, TOLERANCIA_MIN };