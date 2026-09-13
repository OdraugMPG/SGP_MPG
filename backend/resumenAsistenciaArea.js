const { determinarTipoTurno, construirRotacionBasePorClave, sumarDias } = require('./importar');
const { generarDetalleMarcaciones } = require('./detalleMarcaciones');

// Mismo criterio de "día libre según tipo de turno" que ya usan
// Indicadores.js y dashboardAsistencia.js — se duplica acá (igual que en
// esos dos archivos) para no crear una dependencia cruzada solo por esto.
function esDiaLibreTipoTurno(tipoTurno, fecha, feriadosSet) {
  if (feriadosSet.has(fecha)) return true;
  if (tipoTurno === 'NOCHE' && feriadosSet.has(sumarDias(fecha, 1))) return true;
  const dow = new Date(fecha + 'T00:00:00').getDay();
  if (tipoTurno === 'NOCHE' || tipoTurno === 'PLANO') return dow === 0 || dow === 6;
  if (tipoTurno === 'AM' || tipoTurno === 'PM') return dow === 0;
  return false;
}

// "Permiso" = ausencia autorizada con procedimiento propio (licencia,
// permisos con/sin goce, día compensatorio, fallecimiento, vacaciones).
// "Inasistencia" = no concurrió, tenga o no un registro de falta — incluye
// la falta sin ninguna marca Y las faltas (justificadas o no) registradas
// como tal, porque de todas formas no estuvo presente ese día.
const TIPOS_PERMISO = new Set(['LM', 'PSGS', 'PCGS', 'DC', 'PF', 'V']);

function horasFormatoADecimal(hhmm) {
  if (!hhmm) return 0;
  const negativo = hhmm.startsWith('-');
  const limpio = negativo ? hhmm.slice(1) : hhmm;
  const [h, m] = limpio.split(':').map(Number);
  const horas = (h || 0) + (m || 0) / 60;
  return negativo ? -horas : horas;
}

function nuevoAcumulador() {
  return { dias_analizables: 0, asistencias: 0, tardanzas: 0, inasistencias: 0, permisos: 0, horas_extra: 0 };
}

function sumarEn(acc, campo, valor = 1) {
  acc[campo] += valor;
}

// Resumen de asistencia y jornada laboral por Área (centro de costo), con
// desglose mensual para las tendencias — reutiliza exactamente la misma
// lógica de día libre por turno (Indicadores.js/dashboardAsistencia.js) y de
// horas extra (detalleMarcaciones.js) que ya usa el resto del sistema, para
// que estos números no diverjan de lo que ya se muestra en otros paneles.
async function calcularResumenAsistenciaArea(pool, filtros) {
  const { desde, hasta, cds } = filtros; // cds: null (todos) o arreglo de CDs permitidos/solicitados

  const dIni = new Date(desde + 'T00:00:00');
  const dFin = new Date(hasta + 'T00:00:00');
  const diasTotales = Math.round((dFin - dIni) / 86400000) + 1;
  if (diasTotales < 1 || diasTotales > 366) throw new Error('El rango debe ser de 1 a 366 días');

  const { rows: feriadosRows } = await pool.query('SELECT fecha FROM feriados');
  const feriadosSet = new Set(feriadosRows.map(r => r.fecha));

  let sqlEmp = `SELECT rut, centro_costo, fecha_ingreso FROM empleados WHERE activo = true AND centro_costo IS NOT NULL AND centro_costo <> ''`;
  const paramsEmp = [];
  if (cds) { paramsEmp.push(cds); sqlEmp += ` AND cd = ANY($${paramsEmp.length}::text[])`; }
  const { rows: empleados } = await pool.query(sqlEmp, paramsEmp);
  const areaPorRut = new Map(empleados.map(e => [e.rut, e.centro_costo]));
  const fechaIngresoPorRut = new Map(empleados.map(e => [e.rut, e.fecha_ingreso]));
  const ruts = [...areaPorRut.keys()];

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));
  const { rows: rotacionRows } = await pool.query('SELECT sem, jefe_turno, rotacion_base, hora_entrada FROM rotacion_turnos');
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);

  const { rows: resultados } = await pool.query(
    `SELECT rut, fecha, marco_talana, marco_cencosud, minutos_atraso
     FROM resultado_diario WHERE fecha BETWEEN $1 AND $2 AND rut = ANY($3::text[])`,
    [desde, hasta, ruts]
  );
  const resultadoPorClave = new Map(resultados.map(r => [`${r.rut}|${r.fecha}`, r]));

  const { rows: ausencias } = await pool.query(
    `SELECT rut, fecha, tipo FROM ausencias_permisos WHERE fecha BETWEEN $1 AND $2 AND rut = ANY($3::text[])`,
    [desde, hasta, ruts]
  );
  const ausenciaPorClave = new Map(ausencias.map(a => [`${a.rut}|${a.fecha}`, a.tipo]));

  // Horas extra: mismo cálculo que ya usa Reporte de Horas Extras y Cierre
  // de Nómina — se reutiliza tal cual en vez de recalcularlo distinto acá.
  const filasDetalle = await generarDetalleMarcaciones(pool, { desde, hasta }, Infinity);
  const horasExtraPorClave = new Map();
  for (const f of filasDetalle) {
    if (!areaPorRut.has(f.rut)) continue;
    horasExtraPorClave.set(`${f.rut}|${f.fecha}`, horasFormatoADecimal(f.horas_extras_mpg));
  }

  const fechas = [];
  for (let i = 0; i < diasTotales; i++) fechas.push(sumarDias(desde, i));

  const porArea = new Map(); // área -> acumulador total del período
  const porAreaMes = new Map(); // 'área|YYYY-MM' -> acumulador

  for (const rut of ruts) {
    const area = areaPorRut.get(rut);
    if (!porArea.has(area)) porArea.set(area, nuevoAcumulador());
    const codigoJefeTurno = jefeTurnoPorRut.get(rut);

    for (const fecha of fechas) {
      const mes = fecha.slice(0, 7);
      const claveMes = `${area}|${mes}`;
      if (!porAreaMes.has(claveMes)) porAreaMes.set(claveMes, nuevoAcumulador());
      const accTotal = porArea.get(area);
      const accMes = porAreaMes.get(claveMes);

      // Antes de la fecha de ingreso (o de reingreso, si fue reactivado) la
      // persona no tenía contrato — no cuenta ni como día analizable ni como
      // inasistencia, igual que en el Dashboard de Asistencia.
      const fechaIngreso = fechaIngresoPorRut.get(rut);
      if (fechaIngreso && fecha < fechaIngreso) continue;

      const claveDia = `${rut}|${fecha}`;
      const horasExtra = horasExtraPorClave.get(claveDia) || 0;
      if (horasExtra) { sumarEn(accTotal, 'horas_extra', horasExtra); sumarEn(accMes, 'horas_extra', horasExtra); }

      const tipoTurno = determinarTipoTurno(codigoJefeTurno, fecha, rotacionBasePorClave);
      if (esDiaLibreTipoTurno(tipoTurno, fecha, feriadosSet)) continue; // no es un día analizable

      sumarEn(accTotal, 'dias_analizables'); sumarEn(accMes, 'dias_analizables');

      const tipoAusencia = ausenciaPorClave.get(claveDia);
      if (tipoAusencia) {
        if (TIPOS_PERMISO.has(tipoAusencia)) {
          sumarEn(accTotal, 'permisos'); sumarEn(accMes, 'permisos');
        } else {
          sumarEn(accTotal, 'inasistencias'); sumarEn(accMes, 'inasistencias');
        }
        continue;
      }

      const r = resultadoPorClave.get(claveDia);
      const tieneMarca = !!(r && (r.marco_talana || r.marco_cencosud));
      if (tieneMarca) {
        sumarEn(accTotal, 'asistencias'); sumarEn(accMes, 'asistencias');
        if (r.minutos_atraso > 0) { sumarEn(accTotal, 'tardanzas'); sumarEn(accMes, 'tardanzas'); }
      } else {
        sumarEn(accTotal, 'inasistencias'); sumarEn(accMes, 'inasistencias');
      }
    }
  }

  function redondear(n) { return Math.round(n * 100) / 100; }
  function conPorcentaje(acc) {
    return {
      ...acc,
      horas_extra: redondear(acc.horas_extra),
      pct_asistencia: acc.dias_analizables > 0 ? redondear((acc.asistencias / acc.dias_analizables) * 100) : null,
    };
  }

  const resumenPorArea = [...porArea.entries()]
    .map(([area, acc]) => ({ area, ...conPorcentaje(acc) }))
    .sort((a, b) => a.area.localeCompare(b.area));

  const meses = [...new Set(fechas.map(f => f.slice(0, 7)))].sort();
  const resumenPorMes = meses.map(mes => {
    const acc = nuevoAcumulador();
    for (const area of porArea.keys()) {
      const m = porAreaMes.get(`${area}|${mes}`);
      if (!m) continue;
      for (const campo of Object.keys(acc)) acc[campo] += m[campo];
    }
    return { mes, ...conPorcentaje(acc), por_area: [...porArea.keys()].map(area => ({
      area, horas_extra: redondear((porAreaMes.get(`${area}|${mes}`) || nuevoAcumulador()).horas_extra),
    })) };
  });

  const totalGeneral = resumenPorArea.reduce((acc, a) => {
    acc.dias_analizables += a.dias_analizables; acc.asistencias += a.asistencias;
    acc.tardanzas += a.tardanzas; acc.inasistencias += a.inasistencias;
    acc.permisos += a.permisos; acc.horas_extra += a.horas_extra;
    return acc;
  }, nuevoAcumulador());

  const kpis = {
    trabajadores_activos: ruts.length,
    ...conPorcentaje(totalGeneral),
  };

  return { por_area: resumenPorArea, por_mes: resumenPorMes, kpis };
}

module.exports = { calcularResumenAsistenciaArea };
