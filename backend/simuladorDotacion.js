// Simulador de dotación mínima a contratar, considerando el requerido del
// cliente y el nivel histórico de ausentismo REAL por cargo+CD (días
// 'ausente' + 'ausencia' sobre días esperados a trabajar) — reutiliza el
// mismo motor de estados día a día que usa el Dashboard de Asistencia, para
// no duplicar la lógica de días libres / feriados / rotación de turnos.
//
// Fórmula: dotación mínima = requerido / (1 - tasa de ausentismo). Es una
// estimación de planificación (shrinkage), no un cálculo actuarial exacto.

const { calcularMatrizAsistencia } = require('./dashboardAsistencia');
const { diaDeSemana, determinarTipoTurno, construirRotacionBasePorClave } = require('./importar');

const MAX_DIAS_HISTORIA = 60; // mismo límite que calcularMatrizAsistencia (máx. 62 días por rango)
const UMBRAL_MINIMO_DIAS = 20; // muestra mínima de días-persona para confiar en la tasa propia del cargo+CD
const DIAS_LUN_SAB = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const TURNOS_DETALLE = ['AM', 'PM', 'NOCHE', 'PLANO'];

function rangoUltimosDias(dias, hasta) {
  const fin = hasta ? new Date(hasta + 'T00:00:00') : new Date();
  const inicio = new Date(fin);
  inicio.setDate(inicio.getDate() - (dias - 1));
  return [inicio.toISOString().slice(0, 10), fin.toISOString().slice(0, 10)];
}

// A qué "categoría de turno" corresponde un código de jefe_turno, para poder
// contar la dotación activa POR TURNO en vez de mezclar todo el cargo:
// - T_WP: turno Noche, fijo.
// - PLANO / CG: turno Plano, fijo (sin jefatura).
// - Cualquier otro código asignado (T_RD, T_BV, y variantes futuras como
//   T_PS): se trata como "ROTATIVO" — este mismo grupo de personas cubre AM
//   y PM alternando semana a semana, así que no corresponde partirlo entre
//   AM y PM: contar "dotación de AM" ≠ "dotación de PM", son las mismas
//   personas en semanas distintas.
function categoriaTurnoDesdeJefeTurno(jefeTurno) {
  if (!jefeTurno) return 'SIN_ASIGNAR';
  if (jefeTurno === 'T_WP') return 'NOCHE';
  if (jefeTurno === 'PLANO' || jefeTurno === 'CG') return 'PLANO';
  return 'ROTATIVO';
}

// Valor de cantidad_requerida vigente en una fecha dada, sumado entre todos
// los turnos — replica la lógica de "vigente" de /api/requerimiento-dotacion/vigente
// pero en JS, para no hacer una consulta SQL por cada día del historial.
function requeridoEnFecha(registrosDelCargo, fecha) {
  const masRecientePorTurno = new Map(); // turno -> registro
  for (const r of registrosDelCargo) {
    if (r.vigente_desde <= fecha && (!r.vigente_hasta || r.vigente_hasta >= fecha)) {
      const actual = masRecientePorTurno.get(r.turno);
      if (!actual || r.vigente_desde > actual.vigente_desde) masRecientePorTurno.set(r.turno, r);
    }
  }
  if (masRecientePorTurno.size === 0) return null;
  let total = 0;
  for (const r of masRecientePorTurno.values()) total += r.cantidad_requerida;
  return total;
}

// Turnos "reales" que puede resolver determinarTipoTurno para un día puntual
// (AM y PM SIN combinar — a diferencia de la dotación activa, la tasa de
// ausentismo de un turno sí puede variar entre AM y PM aunque sea la misma
// gente rotando).
const TURNOS_REALES = ['AM', 'PM', 'NOCHE', 'PLANO'];
// Turnos que puede elegir el usuario en el selector de la matriz: los 4
// reales + ROTATIVO (AM+PM combinados, para cuando no quiere ver la mitad
// de jornada por separado).
const TURNOS_SELECCIONABLES = ['AM', 'PM', 'ROTATIVO', 'NOCHE', 'PLANO'];

function nuevoAcumulador() {
  return { esperados: 0, ausentes: 0, presentesPorFecha: new Map() };
}

function sumarPresente(acc, fecha) {
  acc.presentesPorFecha.set(fecha, (acc.presentesPorFecha.get(fecha) || 0) + 1);
}

// Arma el resultado de UN turno (cargo ya filtrado) a partir de su
// acumulador de asistencia, sus registros de requerimiento (ya filtrados a
// ese turno), la dotación activa de ese turno, y — para el respaldo cuando
// hay poca muestra — la tasa de ausentismo del cargo completo.
function armarDatosTurno(acc, registrosDelTurno, dotacionActiva, fechas, ausentismoCargoPct) {
  const confiable = acc.esperados >= UMBRAL_MINIMO_DIAS;
  const ausentismoPct = Number((confiable ? (acc.ausentes / acc.esperados) * 100 : ausentismoCargoPct).toFixed(1));

  const fechaHoy = new Date().toISOString().slice(0, 10);
  const requeridoActual = requeridoEnFecha(registrosDelTurno, fechaHoy) || 0;

  let diasConDato = 0;
  let diasSobredotados = 0;
  for (const fecha of fechas) {
    const req = requeridoEnFecha(registrosDelTurno, fecha);
    if (req === null || req === 0) continue;
    diasConDato++;
    if ((acc.presentesPorFecha.get(fecha) || 0) > req) diasSobredotados++;
  }
  const frecuenciaSobredotacionPct = diasConDato > 0 ? Number(((diasSobredotados / diasConDato) * 100).toFixed(1)) : null;

  return {
    requerido_actual: requeridoActual,
    ausentismo_pct: ausentismoPct,
    usa_promedio_general: !confiable,
    dias_esperados_muestra: acc.esperados,
    dotacion_activa: dotacionActiva,
    frecuencia_sobredotacion_pct: frecuenciaSobredotacionPct,
    dias_con_dato_requerido: diasConDato,
  };
}

// Matriz de TODOS los cargos de un CD en una sola pasada: ausentismo
// histórico, requerido actual, dotación activa, y con qué frecuencia
// (histórica, real) la asistencia efectiva ya superó lo pedido por el
// cliente ese día — esto último es la base del "riesgo de sobre-dotación":
// si contratas hasta la dotación mínima sugerida (con backup) y algún día
// llega el 100%, ¿es algo que ya pasa seguido, o sería la primera vez?
//
// Cada fila trae, además del total del cargo (campos planos, sin cambios —
// es lo que se ve por defecto), un desglose `por_turno` con AM/PM/ROTATIVO/
// NOCHE/PLANO, para cuando la operación tiene turnos con comportamiento muy
// distinto entre sí (ej. el sábado de noche vs. la semana en AM).
async function calcularMatrizDotacion(pool, filtros) {
  const { cd, dias = MAX_DIAS_HISTORIA, hasta, cargos: cargosFiltro } = filtros;
  const diasAcotados = Math.min(dias, MAX_DIAS_HISTORIA);
  const [desde, fechaHasta] = rangoUltimosDias(diasAcotados, hasta);

  const { fechas, trabajadores } = await calcularMatrizAsistencia(pool, { desde, hasta: fechaHasta, cds: [cd] });

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));
  const { rows: rotacionRows } = await pool.query('SELECT sem, jefe_turno, rotacion_base, hora_entrada FROM rotacion_turnos');
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);

  const porCargo = new Map(); // cargo -> acumulador (total, sin distinguir turno)
  const porCargoTurno = new Map(); // cargo -> Map(turno real -> acumulador)
  let globalEsperados = 0;
  let globalAusentes = 0;

  for (const t of trabajadores) {
    if (!t.cargo) continue;
    if (!porCargo.has(t.cargo)) porCargo.set(t.cargo, nuevoAcumulador());
    if (!porCargoTurno.has(t.cargo)) porCargoTurno.set(t.cargo, new Map());
    const accCargo = porCargo.get(t.cargo);
    const mapaTurnos = porCargoTurno.get(t.cargo);
    const codigoJefeTurno = jefeTurnoPorRut.get(t.rut);

    for (const [fecha, estado] of Object.entries(t.estados)) {
      const { categoria } = estado;
      const turnoDia = determinarTipoTurno(codigoJefeTurno, fecha, rotacionBasePorClave); // AM|PM|NOCHE|PLANO|null
      if (turnoDia && !mapaTurnos.has(turnoDia)) mapaTurnos.set(turnoDia, nuevoAcumulador());
      const accTurno = turnoDia ? mapaTurnos.get(turnoDia) : null;

      if (categoria === 'ok' || categoria === 'inconsistencia') {
        accCargo.esperados++; globalEsperados++;
        sumarPresente(accCargo, fecha);
        if (accTurno) { accTurno.esperados++; sumarPresente(accTurno, fecha); }
      } else if (categoria === 'ausente' || categoria === 'ausencia') {
        accCargo.esperados++; accCargo.ausentes++; globalEsperados++; globalAusentes++;
        if (accTurno) { accTurno.esperados++; accTurno.ausentes++; }
      } else if (categoria === 'diaLibreTrabajado') {
        // Físicamente presente ese día aunque no era su día esperado — suma
        // a la asistencia real, que es justo lo que necesitamos para
        // detectar sobre-dotación.
        sumarPresente(accCargo, fecha);
        if (accTurno) sumarPresente(accTurno, fecha);
      }
    }
  }
  const ausentismoGlobalPct = globalEsperados > 0 ? (globalAusentes / globalEsperados) * 100 : 0;

  const { rows: requerimientoRows } = await pool.query(
    `SELECT cargo, turno, cantidad_requerida, vigente_desde, vigente_hasta FROM requerimiento_dotacion WHERE cd = $1`,
    [cd]
  );
  const registrosPorCargo = new Map();
  for (const r of requerimientoRows) {
    if (!registrosPorCargo.has(r.cargo)) registrosPorCargo.set(r.cargo, []);
    registrosPorCargo.get(r.cargo).push(r);
  }

  const { rows: activosConTurno } = await pool.query(
    `SELECT e.cargo, jta.jefe_turno
     FROM empleados e LEFT JOIN jefe_turno_asignacion jta ON jta.rut = e.rut
     WHERE e.activo = true AND e.cd = $1`,
    [cd]
  );
  const dotacionActivaPorCargo = new Map(); // cargo -> total
  const dotacionActivaPorCargoTurno = new Map(); // cargo -> {ROTATIVO,NOCHE,PLANO,SIN_ASIGNAR}
  for (const r of activosConTurno) {
    dotacionActivaPorCargo.set(r.cargo, (dotacionActivaPorCargo.get(r.cargo) || 0) + 1);
    if (!dotacionActivaPorCargoTurno.has(r.cargo)) dotacionActivaPorCargoTurno.set(r.cargo, { ROTATIVO: 0, NOCHE: 0, PLANO: 0, SIN_ASIGNAR: 0 });
    dotacionActivaPorCargoTurno.get(r.cargo)[categoriaTurnoDesdeJefeTurno(r.jefe_turno)]++;
  }

  let universoCargos = new Set([...porCargo.keys(), ...registrosPorCargo.keys(), ...dotacionActivaPorCargo.keys()]);
  if (cargosFiltro && cargosFiltro.length > 0) {
    universoCargos = new Set([...universoCargos].filter(c => cargosFiltro.includes(c)));
  }

  const filas = [...universoCargos].map(cargo => {
    const acc = porCargo.get(cargo) || nuevoAcumulador();
    const registrosDelCargo = registrosPorCargo.get(cargo) || [];
    const dotacionActivaPorTurno = dotacionActivaPorCargoTurno.get(cargo) || { ROTATIVO: 0, NOCHE: 0, PLANO: 0, SIN_ASIGNAR: 0 };

    // Total del cargo (campos planos, comportamiento igual que antes).
    const datosTotal = armarDatosTurno(acc, registrosDelCargo, dotacionActivaPorCargo.get(cargo) || 0, fechas, ausentismoGlobalPct);

    // Desglose por turno — respaldo en cascada: turno -> cargo completo -> global.
    const mapaTurnosCargo = porCargoTurno.get(cargo) || new Map();
    const porTurno = {};
    for (const turno of TURNOS_REALES) {
      const accTurno = mapaTurnosCargo.get(turno) || nuevoAcumulador();
      const registrosDelTurno = registrosDelCargo.filter(r => r.turno === turno);
      const dotacionTurno = turno === 'NOCHE' ? dotacionActivaPorTurno.NOCHE
        : turno === 'PLANO' ? dotacionActivaPorTurno.PLANO
        : dotacionActivaPorTurno.ROTATIVO; // AM y PM comparten el mismo pool rotativo
      porTurno[turno] = armarDatosTurno(accTurno, registrosDelTurno, dotacionTurno, fechas, datosTotal.ausentismo_pct);
    }
    // ROTATIVO = AM + PM combinados (mismas personas, se suman los días).
    const accAM = mapaTurnosCargo.get('AM') || nuevoAcumulador();
    const accPM = mapaTurnosCargo.get('PM') || nuevoAcumulador();
    const accRotativo = {
      esperados: accAM.esperados + accPM.esperados,
      ausentes: accAM.ausentes + accPM.ausentes,
      presentesPorFecha: (() => {
        const combinado = new Map(accAM.presentesPorFecha);
        for (const [fecha, n] of accPM.presentesPorFecha) combinado.set(fecha, (combinado.get(fecha) || 0) + n);
        return combinado;
      })(),
    };
    const registrosRotativo = registrosDelCargo.filter(r => r.turno === 'AM' || r.turno === 'PM');
    porTurno.ROTATIVO = armarDatosTurno(accRotativo, registrosRotativo, dotacionActivaPorTurno.ROTATIVO, fechas, datosTotal.ausentismo_pct);

    return { cargo, ...datosTotal, por_turno: porTurno };
  }).sort((a, b) => a.cargo.localeCompare(b.cargo));

  return {
    desde, hasta: fechaHasta,
    ausentismo_global_pct: Number(ausentismoGlobalPct.toFixed(1)),
    turnos_seleccionables: TURNOS_SELECCIONABLES,
    filas,
  };
}

// Detalle Lunes a Sábado × AM/PM/NOCHE/PLANO de UN cargo — a diferencia de
// calcularDotacionActivaPorTurno (que junta AM+PM en "ROTATIVO" porque es la
// misma gente), acá SÍ separamos AM de PM: lo que varía por día+turno es la
// TASA de ausentismo real de esa combinación puntual (ej. "los sábados en el
// turno AM"), no la dotación contratada.
async function calcularDetalleDiaTurno(pool, filtros) {
  const { cargo, cd, dias = MAX_DIAS_HISTORIA, hasta } = filtros;
  const diasAcotados = Math.min(dias, MAX_DIAS_HISTORIA);
  const [desde, fechaHasta] = rangoUltimosDias(diasAcotados, hasta);

  const { trabajadores } = await calcularMatrizAsistencia(pool, { desde, hasta: fechaHasta, cds: [cd] });
  const propios = trabajadores.filter(t => t.cargo === cargo);

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));
  const { rows: rotacionRows } = await pool.query('SELECT sem, jefe_turno, rotacion_base, hora_entrada FROM rotacion_turnos');
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);

  const grid = new Map(); // `${dia}|${turno}` -> { esperados, ausentes }
  function celda(dia, turno) {
    const clave = `${dia}|${turno}`;
    if (!grid.has(clave)) grid.set(clave, { esperados: 0, ausentes: 0 });
    return grid.get(clave);
  }

  for (const t of propios) {
    const codigoJefeTurno = jefeTurnoPorRut.get(t.rut);
    for (const [fecha, estado] of Object.entries(t.estados)) {
      const dia = diaDeSemana(fecha);
      if (dia === 'Dom') continue; // la matriz pedida es Lunes a Sábado
      const tipoTurno = determinarTipoTurno(codigoJefeTurno, fecha, rotacionBasePorClave);
      if (!tipoTurno) continue; // sin asignación de jefe de turno esa semana
      const { categoria } = estado;
      if (categoria === 'ok' || categoria === 'inconsistencia') {
        celda(dia, tipoTurno).esperados++;
      } else if (categoria === 'ausente' || categoria === 'ausencia') {
        const c = celda(dia, tipoTurno);
        c.esperados++; c.ausentes++;
      }
    }
  }

  const grilla = {};
  for (const dia of DIAS_LUN_SAB) {
    grilla[dia] = {};
    for (const turno of TURNOS_DETALLE) {
      const c = grid.get(`${dia}|${turno}`);
      grilla[dia][turno] = c && c.esperados > 0
        ? { ausentismo_pct: Number(((c.ausentes / c.esperados) * 100).toFixed(1)), muestra: c.esperados }
        : { ausentismo_pct: null, muestra: 0 };
    }
  }

  return { cargo, cd, desde, hasta: fechaHasta, grilla };
}

module.exports = { calcularMatrizDotacion, calcularDetalleDiaTurno };
