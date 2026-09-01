// Analiza la rotación de personal (altas y bajas, no rotación de turnos) por
// mes, usando fecha_ingreso/fecha_termino/motivo_termino de la tabla
// empleados. motivo_termino: 'R' (Renuncia Voluntaria) o 'Des'
// (Desvinculación Art. 161), sembrado por el módulo de Perfil de Trabajador.

function rangoMes(anio, mes) {
  const ultimoDia = new Date(anio, mes, 0).getDate(); // día 0 del mes siguiente = último día de este mes
  const inicio = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const fin = `${anio}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return [inicio, fin];
}

async function calcularRotacionPersonal(pool, filtros) {
  const { mesesAtras = 6, cds } = filtros;
  const hoy = new Date();

  const meses = [];
  for (let i = 0; i < mesesAtras; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const [inicio, fin] = rangoMes(d.getFullYear(), d.getMonth() + 1);
    meses.push({ anio: d.getFullYear(), mes: d.getMonth() + 1, inicio, fin, etiqueta: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  }
  meses.reverse(); // orden cronológico ascendente

  // Universo: cualquier trabajador con fecha_ingreso conocida (activo o no,
  // porque una baja necesita seguir contando aunque hoy esté inactivo).
  let sqlEmp = `SELECT rut, nombre, apellido_paterno, cargo, cd, fecha_ingreso, fecha_termino, motivo_termino, activo
                FROM empleados WHERE fecha_ingreso IS NOT NULL AND cargo IS NOT NULL AND cd IS NOT NULL`;
  const paramsEmp = [];
  if (cds) { paramsEmp.push(cds); sqlEmp += ` AND cd = ANY($${paramsEmp.length}::text[])`; }
  const { rows: empleados } = await pool.query(sqlEmp, paramsEmp);

  function dotacionEnFecha(fecha) {
    return empleados.filter(e => e.fecha_ingreso <= fecha && (!e.fecha_termino || e.fecha_termino >= fecha)).length;
  }

  const altasPorMes = new Map(); // etiqueta -> [empleado]
  const bajasPorMes = new Map();
  for (const e of empleados) {
    if (e.fecha_ingreso) {
      const m = meses.find(mm => e.fecha_ingreso >= mm.inicio && e.fecha_ingreso <= mm.fin);
      if (m) {
        if (!altasPorMes.has(m.etiqueta)) altasPorMes.set(m.etiqueta, []);
        altasPorMes.get(m.etiqueta).push(e);
      }
    }
    if (e.fecha_termino) {
      const m = meses.find(mm => e.fecha_termino >= mm.inicio && e.fecha_termino <= mm.fin);
      if (m) {
        if (!bajasPorMes.has(m.etiqueta)) bajasPorMes.set(m.etiqueta, []);
        bajasPorMes.get(m.etiqueta).push(e);
      }
    }
  }

  const serieMensual = meses.map(m => {
    const altas = altasPorMes.get(m.etiqueta) || [];
    const bajas = bajasPorMes.get(m.etiqueta) || [];
    const dotacionInicio = dotacionEnFecha(m.inicio);
    const dotacionFin = dotacionEnFecha(m.fin);
    const dotacionPromedio = (dotacionInicio + dotacionFin) / 2;
    return {
      etiqueta: m.etiqueta, desde: m.inicio, hasta: m.fin,
      altas: altas.length, bajas: bajas.length,
      bajas_voluntarias: bajas.filter(b => b.motivo_termino === 'R').length,
      bajas_involuntarias: bajas.filter(b => b.motivo_termino === 'Des').length,
      dotacion_inicio: dotacionInicio, dotacion_fin: dotacionFin,
      tasa_rotacion_pct: dotacionPromedio > 0 ? Number(((bajas.length / dotacionPromedio) * 100).toFixed(1)) : 0,
    };
  });

  // --- Resumen por Cargo + CD, para el período completo ---
  const resumenMap = new Map(); // `${cargo}|${cd}` -> acumulador
  function acumulador(cargo, cd) {
    const clave = `${cargo}|${cd}`;
    if (!resumenMap.has(clave)) resumenMap.set(clave, { cargo, cd, altas: 0, bajas: 0, bajas_voluntarias: 0, bajas_involuntarias: 0 });
    return resumenMap.get(clave);
  }
  for (const lista of altasPorMes.values()) {
    for (const e of lista) acumulador(e.cargo, e.cd).altas++;
  }
  for (const lista of bajasPorMes.values()) {
    for (const e of lista) {
      const r = acumulador(e.cargo, e.cd);
      r.bajas++;
      if (e.motivo_termino === 'R') r.bajas_voluntarias++;
      else if (e.motivo_termino === 'Des') r.bajas_involuntarias++;
    }
  }
  const dotacionActualPorCargoCd = new Map();
  for (const e of empleados) {
    if (!e.activo) continue;
    const clave = `${e.cargo}|${e.cd}`;
    dotacionActualPorCargoCd.set(clave, (dotacionActualPorCargoCd.get(clave) || 0) + 1);
  }
  const resumenPorCargo = [...resumenMap.values()]
    .map(r => ({ ...r, dotacion_actual: dotacionActualPorCargoCd.get(`${r.cargo}|${r.cd}`) || 0 }))
    .sort((a, b) => b.bajas - a.bajas || b.altas - a.altas || a.cargo.localeCompare(b.cargo));

  const bajasDetalle = [...bajasPorMes.values()].flat()
    .map(e => ({
      rut: e.rut, nombre: `${e.nombre} ${e.apellido_paterno || ''}`.trim(), cargo: e.cargo, cd: e.cd,
      fecha_termino: e.fecha_termino, motivo_termino: e.motivo_termino,
    }))
    .sort((a, b) => b.fecha_termino.localeCompare(a.fecha_termino));

  return {
    meses_analizados: meses.map(m => ({ etiqueta: m.etiqueta, desde: m.inicio, hasta: m.fin })),
    serie_mensual: serieMensual,
    resumen_por_cargo: resumenPorCargo,
    bajas_detalle: bajasDetalle,
  };
}

module.exports = { calcularRotacionPersonal };
