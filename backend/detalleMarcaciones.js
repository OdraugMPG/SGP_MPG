const {
  sumarDias, fusionarTurnosNocturnos, determinarTipoTurno, minutosAjusteColacion,
  resolverJefeTurno, semanaISO, diaDeSemana, contratoDesdeRazonSocial, construirRotacionBasePorClave,
} = require('./importar');
const XLSX = require('xlsx');

function horaAMinutos(horaStr) {
  if (!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

// Convierte horas en formato decimal (ej: 8.5) a formato "HH:MM" (ej: "08:30").
function formatoHoras(decimalHoras) {
  if (decimalHoras === null || decimalHoras === undefined) return null;
  const signo = decimalHoras < 0 ? '-' : '';
  const totalMin = Math.round(Math.abs(decimalHoras) * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${signo}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Convierte una diferencia en minutos (puede ser negativa) a formato "HH:MM"
// o "-HH:MM".
function formatoMinutos(mins) {
  if (mins === null || mins === undefined) return null;
  const signo = mins < 0 ? '-' : '';
  const abs = Math.round(Math.abs(mins));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${signo}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizarTurnoLabel(valorCencosud, codigoJefeTurno, fecha, rotacionBasePorClave) {
  if (valorCencosud) {
    const v = valorCencosud.toString().trim().toUpperCase();
    if (v === 'NOCHE') return 'Noche';
    if (v === 'PLANO') return 'Plano';
    if (v === 'AM' || v === 'PM') return v;
    if (v !== 'SIN TURNO') return valorCencosud;
  }
  if (codigoJefeTurno === 'CG' || codigoJefeTurno === 'PLANO') return 'Plano';
  const tipo = determinarTipoTurno(codigoJefeTurno, fecha, rotacionBasePorClave);
  if (tipo === 'NOCHE') return 'Noche';
  if (tipo === 'AM' || tipo === 'PM') return tipo;
  if (tipo === 'PLANO') return 'Plano';
  return '';
}

// Calcula las horas extras a partir de los minutos trabajados DESPUÉS de la
// hora de salida esperada (no se compara la jornada completa, para no
// depender de la duración esperada — solo importa cuánto se pasó del
// horario de salida). Solo cuenta como hora extra si son 60 minutos o más.
// Tabla de redondeo para el pago de horas extras:
//  - menos de 30 min: no se paga (0)
//  - entre 30 y 45 min: se pagan 45 min
//  - más de 45 min (y menos de 60): se paga la hora completa (60 min)
//  - desde 60 min en adelante: se paga exacto (la hora y los minutos reales)
function calcularHorasExtrasDesdeMinutos(minutosExtras) {
  if (!minutosExtras || minutosExtras < 30) return 0;
  let minutosPagados;
  if (minutosExtras <= 45) minutosPagados = 45;
  else if (minutosExtras < 60) minutosPagados = 60;
  else minutosPagados = minutosExtras;
  return Math.round((minutosPagados / 60) * 100) / 100;
}

// Minutos trabajados después de la hora de salida esperada (0 si salió a la
// hora o antes).
function minutosExtraFinal(horaSalidaReal, horaSalidaEsperada) {
  if (!horaSalidaReal || !horaSalidaEsperada) return 0;
  const diff = horaAMinutos(horaSalidaReal) - horaAMinutos(horaSalidaEsperada);
  return diff > 0 ? diff : 0;
}

// Minutos que la entrada real se adelantó respecto a la hora esperada (0 si
// llegó a la hora o después).
function minutosAnticipados(horaEntradaReal, horaEntradaEsperada) {
  if (!horaEntradaReal || !horaEntradaEsperada) return 0;
  const diff = horaAMinutos(horaEntradaEsperada) - horaAMinutos(horaEntradaReal);
  return diff > 0 ? diff : 0;
}

// Calcula horas trabajadas (con colación ya aplicada) a partir de una entrada
// y salida de UN sistema en particular, más los minutos de colación según turno.
function calcularHorasTrabajadas(entrada, salida, colacionMin) {
  if (!entrada || !salida) return null;
  let mins = horaAMinutos(salida) - horaAMinutos(entrada);
  if (mins < 0) mins += 24 * 60;
  mins += colacionMin;
  return Math.round((mins / 60) * 100) / 100;
}

async function generarDetalleMarcaciones(pool, filtros, limite = 1000) {
  const { rut, desde, hasta, cds } = filtros; // cds: null (todos) o arreglo de CDs permitidos/solicitados

  // Se trae un día extra antes y después del rango para poder fusionar
  // correctamente los turnos Noche que cruzan medianoche en los bordes.
  const desdeExtendido = sumarDias(desde, -1);
  const hastaExtendido = sumarDias(hasta, 1);

  let sqlTalana = 'SELECT rut, fecha, hora, tipo FROM marcaciones_talana WHERE fecha BETWEEN $1 AND $2';
  const paramsTalana = [desdeExtendido, hastaExtendido];
  if (rut) { paramsTalana.push(rut); sqlTalana += ` AND rut = $${paramsTalana.length}`; }
  const { rows: talanaRows } = await pool.query(sqlTalana, paramsTalana);

  const talanaPorDiaCrudo = new Map();
  for (const r of talanaRows) {
    const key = `${r.rut}|${r.fecha}`;
    if (!talanaPorDiaCrudo.has(key)) talanaPorDiaCrudo.set(key, { entradas: [], salidas: [] });
    const acc = talanaPorDiaCrudo.get(key);
    const tipo = (r.tipo || '').toLowerCase();
    if (tipo === 'entrada') acc.entradas.push(r.hora);
    if (tipo === 'salida') acc.salidas.push(r.hora);
  }
  const talanaFusionado = fusionarTurnosNocturnos(talanaPorDiaCrudo);
  for (const acc of talanaFusionado.values()) {
    acc.entradas.sort();
    acc.salidas.sort();
  }

  let sqlCencosud = 'SELECT rut, fecha, hora_entrada, hora_salida, turno FROM marcaciones_cencosud WHERE fecha BETWEEN $1 AND $2';
  const paramsCencosud = [desde, hasta];
  if (rut) { paramsCencosud.push(rut); sqlCencosud += ` AND rut = $${paramsCencosud.length}`; }
  const { rows: cencosudRows } = await pool.query(sqlCencosud, paramsCencosud);
  const cencosudPorClave = new Map(cencosudRows.map(r => [`${r.rut}|${r.fecha}`, r]));

  let sqlEmp = 'SELECT rut, nombre, apellido_paterno, cargo, empresa, tipo_contrato FROM empleados WHERE 1=1';
  const paramsEmp = [];
  if (cds) { paramsEmp.push(cds); sqlEmp += ` AND cd = ANY($${paramsEmp.length}::text[])`; }
  const { rows: empleados } = await pool.query(sqlEmp, paramsEmp);
  const empleadoPorRut = new Map(empleados.map(e => [e.rut, e]));

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));

  const { rows: rotacionRows } = await pool.query(
    `SELECT sem, jefe_turno, rotacion_base, dia, hora_entrada, hora_salida FROM rotacion_turnos`
  );
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);
  const entradaEsperadaPorClave = new Map(); // sem|jefeTurno|dia -> hora_entrada esperada
  const salidaEsperadaPorClave = new Map(); // sem|jefeTurno|dia -> hora_salida esperada
  for (const r of rotacionRows) {
    if (r.hora_entrada) entradaEsperadaPorClave.set(`${r.sem}|${r.jefe_turno}|${r.dia}`, r.hora_entrada);
    if (r.hora_salida) salidaEsperadaPorClave.set(`${r.sem}|${r.jefe_turno}|${r.dia}`, r.hora_salida);
  }

  const { rows: horarioPlanoRows } = await pool.query('SELECT dia, hora_entrada, hora_salida FROM horario_plano');
  const horarioPlanoMap = new Map(horarioPlanoRows.map(r => [r.dia, r]));

  // Autorizaciones de horas extras (rut+fecha) — solo si está autorizado se
  // permite contar como hora extra el tiempo trabajado ANTES del horario de
  // entrada esperado. Sin autorización, esos minutos anticipados no se pagan.
  const { rows: autorizacionRows } = await pool.query(
    'SELECT rut, fecha FROM horas_extras_autorizacion WHERE fecha BETWEEN $1 AND $2 AND autorizado = true',
    [desdeExtendido, hastaExtendido]
  );
  const autorizadoPorClave = new Set(autorizacionRows.map(r => `${r.rut}|${r.fecha}`));

  // Jornada esperada (en minutos) para el turno Plano, según día de la semana.

  // Solo se listan las claves rut|fecha dentro del rango solicitado (el día
  // extra de antes/después solo se usó como contexto para fusionar turno noche).
  const clavesEnRango = new Set();
  for (const key of talanaFusionado.keys()) {
    const fecha = key.split('|')[1];
    if (fecha >= desde && fecha <= hasta) clavesEnRango.add(key);
  }
  for (const key of cencosudPorClave.keys()) clavesEnRango.add(key);

  const filas = [];
  for (const key of clavesEnRango) {
    const [rutFila, fecha] = key.split('|');
    const talana = talanaFusionado.get(key) || { entradas: [], salidas: [] };
    const cencosud = cencosudPorClave.get(key);
    const emp = empleadoPorRut.get(rutFila);
    if (cds && !emp) continue; // hay filtro de CD activo y este rut no calzó (quedó fuera del filtro)

    const entradaTalana = talana.entradas[0] || null;
    const salidaTalana = talana.salidas[talana.salidas.length - 1] || null;
    const entradaCencosud = cencosud?.hora_entrada || null;
    const salidaCencosud = cencosud?.hora_salida || null;

    let diferenciaEntradaMin = null;
    if (entradaTalana && entradaCencosud) {
      diferenciaEntradaMin = horaAMinutos(entradaCencosud) - horaAMinutos(entradaTalana);
    }
    let diferenciaSalidaMin = null;
    if (salidaTalana && salidaCencosud) {
      diferenciaSalidaMin = horaAMinutos(salidaTalana) - horaAMinutos(salidaCencosud);
    }

    const dia = diaDeSemana(fecha);
    const sem = semanaISO(fecha);
    const codigoAsignado = jefeTurnoPorRut.get(rutFila);
    const tipoTurno = determinarTipoTurno(codigoAsignado, fecha, rotacionBasePorClave);
    const colacionMin = minutosAjusteColacion(tipoTurno);

    const horasTrabajadasMPG = calcularHorasTrabajadas(entradaTalana, salidaTalana, colacionMin);
    const horasTrabajadasCencosud = calcularHorasTrabajadas(entradaCencosud, salidaCencosud, colacionMin);

    // Horario esperado (entrada y salida) para este trabajador ese día.
    let horaEntradaEsperada = null;
    let horaSalidaEsperada = null;
    if (codigoAsignado === 'CG' || codigoAsignado === 'PLANO') {
      horaEntradaEsperada = horarioPlanoMap.get(dia)?.hora_entrada || null;
      horaSalidaEsperada = horarioPlanoMap.get(dia)?.hora_salida || null;
    } else if (codigoAsignado) {
      const codigoResuelto = resolverJefeTurno(codigoAsignado);
      horaEntradaEsperada = entradaEsperadaPorClave.get(`${sem}|${codigoResuelto}|${dia}`) ?? null;
      horaSalidaEsperada = salidaEsperadaPorClave.get(`${sem}|${codigoResuelto}|${dia}`) ?? null;
    }

    // Horas extras = solo minutos trabajados DESPUÉS de la hora de salida
    // esperada, más los minutos "anticipados" (entrada antes de lo
    // esperado) SI están autorizados — y el anticipado solo aplica para
    // turno PM o Noche (para AM no corresponde pedir entrada anticipada).
    const anticipadoAutorizado = autorizadoPorClave.has(`${rutFila}|${fecha}`);
    const permiteAnticipado = tipoTurno === 'PM' || tipoTurno === 'NOCHE';
    const minAnticipadoMPG = (permiteAnticipado && anticipadoAutorizado) ? minutosAnticipados(entradaTalana, horaEntradaEsperada) : 0;
    const minAnticipadoCencosud = (permiteAnticipado && anticipadoAutorizado) ? minutosAnticipados(entradaCencosud, horaEntradaEsperada) : 0;

    const horasExtrasMPG = horasTrabajadasMPG !== null
      ? calcularHorasExtrasDesdeMinutos(minutosExtraFinal(salidaTalana, horaSalidaEsperada) + minAnticipadoMPG)
      : null;
    const horasExtrasCencosud = horasTrabajadasCencosud !== null
      ? calcularHorasExtrasDesdeMinutos(minutosExtraFinal(salidaCencosud, horaSalidaEsperada) + minAnticipadoCencosud)
      : null;

    const turnoLabel = normalizarTurnoLabel(cencosud?.turno, codigoAsignado, fecha, rotacionBasePorClave);
    const tipoContrato = emp?.tipo_contrato || contratoDesdeRazonSocial(emp?.empresa) || 'OUT';

    let diferenciaHorasTrabajadasMin = null;
    if (horasTrabajadasMPG !== null && horasTrabajadasCencosud !== null) {
      diferenciaHorasTrabajadasMin = Math.round((horasTrabajadasMPG - horasTrabajadasCencosud) * 60);
    }

    filas.push({
      fecha,
      rut: rutFila,
      nombre: emp ? `${emp.nombre} ${emp.apellido_paterno || ''}`.trim() : null,
      turno: turnoLabel,
      cargo: emp?.cargo || '',
      tipo_contrato: tipoContrato,
      entrada_mpg: entradaTalana,
      salida_mpg: salidaTalana,
      horas_trabajadas_mpg: formatoHoras(horasTrabajadasMPG),
      horas_extras_mpg: formatoHoras(horasExtrasMPG),
      entrada_cencosud: entradaCencosud,
      salida_cencosud: salidaCencosud,
      horas_trabajadas_cencosud: formatoHoras(horasTrabajadasCencosud),
      horas_extras_cencosud: formatoHoras(horasExtrasCencosud),
      diferencia_entrada_min: formatoMinutos(diferenciaEntradaMin),
      diferencia_salida_min: formatoMinutos(diferenciaSalidaMin),
      diferencia_horas_trabajadas: formatoMinutos(diferenciaHorasTrabajadasMin),
      hora_entrada_esperada: horaEntradaEsperada,
      minutos_anticipados: permiteAnticipado ? minutosAnticipados(entradaTalana, horaEntradaEsperada) : 0,
      anticipado_autorizado: anticipadoAutorizado,
    });
  }

  filas.sort((a, b) => (a.fecha === b.fecha ? a.rut.localeCompare(b.rut) : b.fecha.localeCompare(a.fecha)));
  return filas.slice(0, limite);
}

// Genera el Excel del Detalle de Marcaciones, con encabezados legibles,
// filtro automático (formato de tabla) y anchos de columna ajustados.
// Usa aoa_to_sheet (filas como arrays) en vez de json_to_sheet porque el
// formato pedido repite encabezados ("Horas Trabajadas", "Horas Extras")
// una vez para MPG y otra para Cencosud, lo cual no es posible con claves
// de objeto (no pueden repetirse).
async function exportarDetalleMarcacionesXlsx(pool, filtros) {
  const filas = await generarDetalleMarcaciones(pool, filtros, Infinity);

  const encabezado = [
    'Fecha', 'Rut', 'Nombre', 'Turno', 'Cargo', 'Tipo Contrato',
    'Entrada MPG', 'Salida MPG', 'Horas Trabajadas', 'Horas Extras',
    'Entrada CENCOSUD', 'Salida CENCOSUD', 'Horas Trabajadas', 'Horas Extras',
    'Entrada MPG Vs CENCOSUD', 'Salida MPG Vs CENCOSUD', 'Horas Trabajadas MPG Vs CENCOSUD',
  ];

  const datos = filas.map(f => [
    f.fecha, f.rut, f.nombre || '', f.turno || '', f.cargo || '', f.tipo_contrato || '',
    f.entrada_mpg || '', f.salida_mpg || '', f.horas_trabajadas_mpg ?? '', f.horas_extras_mpg ?? '',
    f.entrada_cencosud || '', f.salida_cencosud || '', f.horas_trabajadas_cencosud ?? '', f.horas_extras_cencosud ?? '',
    f.diferencia_entrada_min ?? '', f.diferencia_salida_min ?? '', f.diferencia_horas_trabajadas ?? '',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([encabezado, ...datos]);

  const nFilas = datos.length;
  const nCols = encabezado.length;
  const ultimaColLetra = XLSX.utils.encode_col(nCols - 1);
  ws['!autofilter'] = { ref: `A1:${ultimaColLetra}${nFilas + 1}` };
  ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

  ws['!cols'] = [
    { wch: 12 }, // Fecha
    { wch: 13 }, // Rut
    { wch: 26 }, // Nombre
    { wch: 9 },  // Turno
    { wch: 26 }, // Cargo
    { wch: 12 }, // Tipo Contrato
    { wch: 13 }, // Entrada MPG
    { wch: 13 }, // Salida MPG
    { wch: 15 }, // Horas Trabajadas MPG
    { wch: 13 }, // Horas Extras MPG
    { wch: 15 }, // Entrada CENCOSUD
    { wch: 15 }, // Salida CENCOSUD
    { wch: 15 }, // Horas Trabajadas Cencosud
    { wch: 13 }, // Horas Extras Cencosud
    { wch: 20 }, // Diferencia entrada
    { wch: 20 }, // Diferencia salida
    { wch: 26 }, // Diferencia horas trabajadas
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Detalle Marcaciones');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { generarDetalleMarcaciones, exportarDetalleMarcacionesXlsx };