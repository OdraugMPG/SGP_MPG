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
  if (codigoJefeTurno === 'CG') return 'Plano';
  return '';
}

// Horario programado (según DB_Rotacion o Plano) para un código de jefe de turno y fecha dada.
// Se usa solo como respaldo cuando no existe ninguna marca real en Talana ni Cencosud.
function horarioProgramado(rotacionMap, codigoJefeTurno, fecha) {
  if (!codigoJefeTurno) return { entrada: null, salida: null };

  const dia = diaDeSemana(fecha);

  if (codigoJefeTurno === 'CG') {
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

  const filas = [];
  for (const emp of empleados) {
    const talana = talanaFusionado.get(`${emp.rut}|${fecha}`) || { entradas: [], salidas: [] };
    const cencosud = cencosudPorRut.get(emp.rut);

    let horaEntrada = resolverHora(talana.entradas, cencosud?.hora_entrada || null, true);
    let horaSalida = resolverHora(talana.salidas, cencosud?.hora_salida || null, false);

    if (!horaEntrada && !horaSalida && !cencosud) continue; // sin ningún dato ese día: se omite

    let entradaEstimada = false;
    let salidaEstimada = false;
    const codigoJefeTurno = jefeTurnoPorRut.get(emp.rut);
    if (!horaEntrada || !horaSalida) {
      const programado = horarioProgramado(rotacionMap, codigoJefeTurno, fecha);
      if (!horaEntrada && programado.entrada) { horaEntrada = programado.entrada; entradaEstimada = true; }
      if (!horaSalida && programado.salida) { horaSalida = programado.salida; salidaEstimada = true; }
    }

    const contrato = contratoDesdeRazonSocial(razonSocialPorRut.get(emp.rut)) || 'OUT';

    filas.push({
      'N°': 0,
      EMPRESA: 'MANPOWER',
      NOMBRE: `${emp.nombre} ${emp.apellido_paterno || ''}`.trim(),
      RUT: emp.rut,
      CARGO: emp.cargo || '',
      TURNO: normalizarTurno(cencosud?.turno, codigoJefeTurno),
      FECHA: fecha,
      'HORA (ENTRADA)': horaEntrada || '00:00:00',
      'HORA (SALIDA)': horaSalida || '00:00:00',
      CONTRATO: contrato,
      entrada_estimada: entradaEstimada,
      salida_estimada: salidaEstimada,
    });
  }

  filas.sort((a, b) => a.RUT.localeCompare(b.RUT));
  filas.forEach((f, i) => { f['N°'] = i + 1; });

  return filas;
}

async function exportarReporteDiarioXlsx(pool, fecha) {
  const filas = await generarReporteDiario(pool, fecha);
  const ws = XLSX.utils.json_to_sheet(filas);

  const filaNota = filas.length + 3;
  XLSX.utils.sheet_add_aoa(ws, [
    ['* Hora estimada según el horario programado del turno (no corresponde a una marcación real en Talana ni Cencosud).'],
  ], { origin: `A${filaNota}` });

  const wb = XLSX.utils.book_new();
  const nombreHoja = fecha.slice(5).split('-').reverse().join('-');
  XLSX.utils.book_append_sheet(wb, ws, nombreHoja);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generarReporteDiario, exportarReporteDiarioXlsx, TOLERANCIA_MIN };