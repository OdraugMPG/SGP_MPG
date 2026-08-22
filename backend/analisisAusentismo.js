// Analiza el ausentismo (solo Falta Justificada y Falta Injustificada — NO
// Licencia Médica, que no es un problema disciplinario) ocurrido en la
// ÚLTIMA SEMANA de cada mes (últimos 7 días calendario del mes), y detecta
// qué trabajadores son reincidentes (con falta en la última semana de 2 o
// más meses distintos dentro del período analizado).

const TIPOS_ANALIZADOS = ['F_Ju', 'F_In'];

function ultimaSemanaDelMes(anio, mes) {
  // mes: 1-12. Devuelve [fechaInicio, fechaFin] de los últimos 7 días
  // calendario de ese mes (fechaFin = último día del mes).
  const ultimoDia = new Date(anio, mes, 0).getDate(); // día 0 del mes siguiente = último día de este mes
  const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  const dIni = new Date(anio, mes - 1, ultimoDia - 6);
  const inicio = `${dIni.getFullYear()}-${String(dIni.getMonth() + 1).padStart(2, '0')}-${String(dIni.getDate()).padStart(2, '0')}`;
  return [inicio, fin];
}

async function calcularAusentismoUltimaSemana(pool, filtros) {
  const { mesesAtras = 6, cds } = filtros;
  const hoy = new Date();

  // Arma la lista de meses a analizar (el actual y los (mesesAtras-1)
  // anteriores), cada uno con su rango de "última semana".
  const meses = [];
  for (let i = 0; i < mesesAtras; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const [inicio, fin] = ultimaSemanaDelMes(d.getFullYear(), d.getMonth() + 1);
    meses.push({ anio: d.getFullYear(), mes: d.getMonth() + 1, inicio, fin, etiqueta: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  }
  meses.reverse(); // orden cronológico ascendente

  // --- Trabajadores activos, con su cargo y CD (universo para el dashboard) ---
  let sqlEmp = 'SELECT rut, nombre, apellido_paterno, cargo, cd FROM empleados WHERE activo = true AND cargo IS NOT NULL AND cd IS NOT NULL';
  const paramsEmp = [];
  if (cds) { paramsEmp.push(cds); sqlEmp += ` AND cd = ANY($${paramsEmp.length}::text[])`; }
  const { rows: empleados } = await pool.query(sqlEmp, paramsEmp);
  const empleadoPorRut = new Map(empleados.map(e => [e.rut, e]));

  // --- Ausencias F_Ju/F_In que caen en cualquiera de los rangos de última semana ---
  const condiciones = meses.map((m, i) => `(fecha BETWEEN $${i * 2 + 2} AND $${i * 2 + 3})`).join(' OR ');
  const params = [TIPOS_ANALIZADOS, ...meses.flatMap(m => [m.inicio, m.fin])];
  const { rows: ausencias } = await pool.query(
    `SELECT rut, fecha, tipo FROM ausencias_permisos WHERE tipo = ANY($1::text[]) AND (${condiciones})`,
    params
  );

  // Mapea cada ausencia a qué mes-última-semana corresponde.
  function mesDeFecha(fecha) {
    return meses.find(m => fecha >= m.inicio && fecha <= m.fin)?.etiqueta || null;
  }

  // --- Por trabajador: en cuántos meses distintos tuvo falta en última semana ---
  const mesesConFaltaPorRut = new Map(); // rut -> Set(etiquetaMes)
  const detalleFaltasPorRut = new Map(); // rut -> [{fecha, tipo}]
  for (const a of ausencias) {
    if (!empleadoPorRut.has(a.rut)) continue; // fuera del universo filtrado (CD/activo)
    const etiquetaMes = mesDeFecha(a.fecha);
    if (!etiquetaMes) continue;
    if (!mesesConFaltaPorRut.has(a.rut)) mesesConFaltaPorRut.set(a.rut, new Set());
    mesesConFaltaPorRut.get(a.rut).add(etiquetaMes);
    if (!detalleFaltasPorRut.has(a.rut)) detalleFaltasPorRut.set(a.rut, []);
    detalleFaltasPorRut.get(a.rut).push({ fecha: a.fecha, tipo: a.tipo });
  }

  const UMBRAL_RECURRENTE = 2; // 2+ meses distintos con falta en última semana = reincidente

  const trabajadoresRecurrentes = [...mesesConFaltaPorRut.entries()]
    .filter(([, mesesSet]) => mesesSet.size >= UMBRAL_RECURRENTE)
    .map(([rut, mesesSet]) => {
      const emp = empleadoPorRut.get(rut);
      const detalle = detalleFaltasPorRut.get(rut).sort((a, b) => a.fecha.localeCompare(b.fecha));
      return {
        rut, nombre: `${emp.nombre} ${emp.apellido_paterno || ''}`.trim(), cargo: emp.cargo, cd: emp.cd,
        meses_con_falta: mesesSet.size, total_faltas: detalle.length, detalle,
      };
    })
    .sort((a, b) => b.meses_con_falta - a.meses_con_falta || b.total_faltas - a.total_faltas);

  // --- Resumen por Cargo + CD (para el dashboard) — incluye TODOS los
  // cargos activos de cada CD, aunque tengan 0 ausencias, para dar una
  // vista completa del universo, no solo de los problemáticos. ---
  const cargoCdUniverso = new Map(); // `${cargo}|${cd}` -> { cargo, cd, dotacion_activa }
  for (const emp of empleados) {
    const clave = `${emp.cargo}|${emp.cd}`;
    if (!cargoCdUniverso.has(clave)) cargoCdUniverso.set(clave, { cargo: emp.cargo, cd: emp.cd, dotacion_activa: 0 });
    cargoCdUniverso.get(clave).dotacion_activa++;
  }
  const faltasPorCargoCd = new Map(); // clave -> { total_faltas, trabajadores: Set }
  for (const a of ausencias) {
    const emp = empleadoPorRut.get(a.rut);
    if (!emp) continue;
    const clave = `${emp.cargo}|${emp.cd}`;
    if (!faltasPorCargoCd.has(clave)) faltasPorCargoCd.set(clave, { total_faltas: 0, trabajadores: new Set() });
    faltasPorCargoCd.get(clave).total_faltas++;
    faltasPorCargoCd.get(clave).trabajadores.add(a.rut);
  }
  const recurrentesPorCargoCd = new Map(); // clave -> cantidad
  for (const t of trabajadoresRecurrentes) {
    const clave = `${t.cargo}|${t.cd}`;
    recurrentesPorCargoCd.set(clave, (recurrentesPorCargoCd.get(clave) || 0) + 1);
  }

  const resumenPorCargo = [...cargoCdUniverso.values()].map(u => {
    const clave = `${u.cargo}|${u.cd}`;
    const f = faltasPorCargoCd.get(clave);
    return {
      cargo: u.cargo,
      cd: u.cd,
      dotacion_activa: u.dotacion_activa,
      total_faltas: f?.total_faltas || 0,
      trabajadores_con_falta: f ? f.trabajadores.size : 0,
      trabajadores_recurrentes: recurrentesPorCargoCd.get(clave) || 0,
    };
  }).sort((a, b) => b.total_faltas - a.total_faltas || a.cargo.localeCompare(b.cargo));

  return {
    meses_analizados: meses.map(m => ({ etiqueta: m.etiqueta, desde: m.inicio, hasta: m.fin })),
    resumen_por_cargo: resumenPorCargo,
    trabajadores_recurrentes: trabajadoresRecurrentes,
  };
}

module.exports = { calcularAusentismoUltimaSemana };