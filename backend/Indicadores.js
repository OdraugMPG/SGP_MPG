const { diaDeSemana, semanaISO, resolverJefeTurno } = require('./importar');
const XLSX = require('xlsx');

function horaAMinutos(horaStr) {
  if (!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

// Texto legal de referencia. Esto es SOLO informativo: no reemplaza asesoría
// legal ni constituye una recomendación automática de despido. La decisión y
// verificación final siempre debe hacerla una persona (RRHH/Legal), revisando
// caso a caso si la ausencia realmente carece de causa justificada.
const ARTICULO_160_N3 = {
  articulo: 'Artículo 160 N°3, Código del Trabajo (Chile)',
  texto: 'No concurrencia del trabajador a sus labores sin causa justificada durante dos días seguidos, '
    + 'dos lunes en el mes o un total de tres días durante igual período de tiempo.',
  nota: 'El "mes" se cuenta como mes calendario (no 30 días corridos). Esta alerta es solo informativa: '
    + 'debe verificarse con RRHH/Legal que las faltas realmente carezcan de causa justificada antes de '
    + 'invocar la causal, ya que una aplicación incorrecta genera recargo del 80% en indemnizaciones.',
};

// Detecta, dentro de los días de "Falta Injustificada" (F_In) de un trabajador,
// si se configura alguna de las 3 hipótesis del Art. 160 N°3, agrupando por
// mes calendario.
function detectarCausalInasistencia(fechasFIn) {
  // Agrupar por mes calendario 'YYYY-MM'
  const porMes = new Map();
  for (const f of fechasFIn) {
    const mes = f.slice(0, 7);
    if (!porMes.has(mes)) porMes.set(mes, []);
    porMes.get(mes).push(f);
  }

  const alertas = [];
  for (const [mes, fechas] of porMes) {
    fechas.sort();
    const fechasOrdenadas = fechas.map(f => new Date(f + 'T00:00:00'));

    // Regla 1: dos días corridos (calendario, no laborales)
    for (let i = 0; i < fechasOrdenadas.length - 1; i++) {
      const diff = (fechasOrdenadas[i + 1] - fechasOrdenadas[i]) / 86400000;
      if (diff === 1) {
        alertas.push({ mes, regla: 'Dos días seguidos', dias: [fechas[i], fechas[i + 1]] });
        break;
      }
    }

    // Regla 2: dos lunes en el mes
    const lunes = fechas.filter(f => new Date(f + 'T00:00:00').getDay() === 1);
    if (lunes.length >= 2) {
      alertas.push({ mes, regla: 'Dos lunes en el mes', dias: lunes.slice(0, 2) });
    }

    // Regla 3: total de 3 días en el mes
    if (fechas.length >= 3) {
      alertas.push({ mes, regla: 'Tres días en el mes', dias: fechas });
    }
  }
  return alertas;
}

async function calcularIndicadores(pool, filtros) {
  const { desde, hasta, area } = filtros;

  // --- Universo de trabajadores activos (filtrado por área si corresponde) ---
  let sqlEmp = 'SELECT rut, nombre, apellido_paterno, cargo, centro_costo FROM empleados WHERE activo = true';
  const paramsEmp = [];
  if (area) { paramsEmp.push(area); sqlEmp += ` AND centro_costo = $${paramsEmp.length}`; }
  const { rows: empleados } = await pool.query(sqlEmp, paramsEmp);
  const empleadoPorRut = new Map(empleados.map(e => [e.rut, e]));
  const rutsActivos = new Set(empleados.map(e => e.rut));

  // --- Resultados de asistencia en el rango ---
  const { rows: resultados } = await pool.query(
    `SELECT rut, fecha, marco_talana, marco_cencosud, minutos_atraso, hora_salida_real
     FROM resultado_diario WHERE fecha BETWEEN $1 AND $2`,
    [desde, hasta]
  );
  const resultadosFiltrados = resultados.filter(r => rutsActivos.has(r.rut));

  // --- Ausencias/permisos en el rango ---
  const { rows: ausencias } = await pool.query(
    `SELECT rut, fecha, tipo FROM ausencias_permisos WHERE fecha BETWEEN $1 AND $2`,
    [desde, hasta]
  );
  const ausenciasFiltradas = ausencias.filter(a => rutsActivos.has(a.rut));

  // --- Presentismo / Ausentismo ---
  // Se cuenta como "día evaluado" cualquier día con marca en algún sistema o
  // con ausencia/permiso registrado (evita contar días futuros o sin datos).
  const diasConDato = new Set();
  const diasPresente = new Set();
  for (const r of resultadosFiltrados) {
    const clave = `${r.rut}|${r.fecha}`;
    diasConDato.add(clave);
    if (r.marco_talana || r.marco_cencosud) diasPresente.add(clave);
  }
  for (const a of ausenciasFiltradas) {
    diasConDato.add(`${a.rut}|${a.fecha}`);
  }

  const diasEvaluados = diasConDato.size;
  const diasPresentismo = diasPresente.size;
  const presentismoPct = diasEvaluados > 0 ? Math.round((diasPresentismo / diasEvaluados) * 1000) / 10 : null;
  const ausentismoPct = presentismoPct !== null ? Math.round((100 - presentismoPct) * 10) / 10 : null;

  // --- Salidas anticipadas ---
  // Requiere el horario esperado de salida según turno asignado + rotación.
  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));
  const { rows: rotacionRows } = await pool.query(
    'SELECT sem, jefe_turno, dia, hora_salida FROM rotacion_turnos'
  );
  const rotacionMap = new Map(rotacionRows.map(r => [`${r.sem}|${r.jefe_turno}|${r.dia}`, r.hora_salida]));
  const TOLERANCIA_SALIDA_MIN = 15;

  let salidasAnticipadas = 0;
  for (const r of resultadosFiltrados) {
    if (!r.hora_salida_real) continue;
    const codigo = jefeTurnoPorRut.get(r.rut);
    if (!codigo || codigo === 'CG' || codigo === 'PLANO') continue;
    const codigoResuelto = resolverJefeTurno(codigo);
    const sem = semanaISO(r.fecha);
    const dia = diaDeSemana(r.fecha);
    const salidaEsperada = rotacionMap.get(`${sem}|${codigoResuelto}|${dia}`);
    if (!salidaEsperada) continue;
    const diffMin = horaAMinutos(salidaEsperada) - horaAMinutos(r.hora_salida_real);
    if (diffMin > TOLERANCIA_SALIDA_MIN) salidasAnticipadas++;
  }

  // --- Permisos y licencias (conteo por tipo) ---
  const conteoTipos = {};
  for (const a of ausenciasFiltradas) {
    conteoTipos[a.tipo] = (conteoTipos[a.tipo] || 0) + 1;
  }

  // --- Recurrencia: trabajadores con más eventos (F_In, A, permisos) ---
  const eventosPorRut = new Map();
  for (const a of ausenciasFiltradas) {
    if (!eventosPorRut.has(a.rut)) eventosPorRut.set(a.rut, { F_In: 0, A: 0, permisos: 0, LM: 0 });
    const acc = eventosPorRut.get(a.rut);
    if (a.tipo === 'F_In') acc.F_In++;
    else if (a.tipo === 'A') acc.A++;
    else if (a.tipo === 'LM') acc.LM++;
    else if (['PSGS', 'PCGS', 'DC'].includes(a.tipo)) acc.permisos++;
  }
  const recurrencia = [...eventosPorRut.entries()]
    .map(([rut, ev]) => ({
      rut,
      nombre: empleadoPorRut.get(rut) ? `${empleadoPorRut.get(rut).nombre} ${empleadoPorRut.get(rut).apellido_paterno || ''}`.trim() : rut,
      ...ev,
      total: ev.F_In + ev.A + ev.permisos + ev.LM,
    }))
    .filter(r => r.total >= 2)
    .sort((a, b) => b.total - a.total)
    .slice(0, 30);

  // --- Alerta legal: posible causal de desvinculación por inasistencia (Art. 160 N°3) ---
  const fInPorRut = new Map();
  for (const a of ausenciasFiltradas) {
    if (a.tipo !== 'F_In') continue;
    if (!fInPorRut.has(a.rut)) fInPorRut.set(a.rut, []);
    fInPorRut.get(a.rut).push(a.fecha);
  }
  const alertasDesvinculacion = [];
  for (const [rut, fechas] of fInPorRut) {
    const alertas = detectarCausalInasistencia(fechas);
    if (alertas.length > 0) {
      const emp = empleadoPorRut.get(rut);
      alertasDesvinculacion.push({
        rut,
        nombre: emp ? `${emp.nombre} ${emp.apellido_paterno || ''}`.trim() : rut,
        cargo: emp?.cargo || '',
        alertas,
      });
    }
  }

  // --- Cumplimiento de dotación (por cargo, usando el requerimiento vigente a "hasta") ---
  const { rows: requerimientos } = await pool.query(
    `SELECT DISTINCT ON (cargo, turno) cargo, turno, cantidad_requerida
     FROM requerimiento_dotacion WHERE vigente_desde <= $1
     ORDER BY cargo, turno, vigente_desde DESC`,
    [hasta]
  );
  const requeridoPorCargo = new Map();
  for (const r of requerimientos) {
    requeridoPorCargo.set(r.cargo, (requeridoPorCargo.get(r.cargo) || 0) + r.cantidad_requerida);
  }

  // Promedio de personas presentes por día, agrupado por cargo, en el rango.
  const presentesPorCargoFecha = new Map(); // cargo -> Set('rut|fecha')
  for (const r of resultadosFiltrados) {
    if (!(r.marco_talana || r.marco_cencosud)) continue;
    const emp = empleadoPorRut.get(r.rut);
    if (!emp || !emp.cargo) continue;
    if (!presentesPorCargoFecha.has(emp.cargo)) presentesPorCargoFecha.set(emp.cargo, new Set());
    presentesPorCargoFecha.get(emp.cargo).add(`${r.rut}|${r.fecha}`);
  }
  const fechasEnRango = new Set(resultadosFiltrados.map(r => r.fecha));
  const nDias = Math.max(1, fechasEnRango.size);

  const cumplimientoDetalle = [];
  let sumaRequerido = 0;
  let sumaPresente = 0;
  for (const [cargo, requerido] of requeridoPorCargo) {
    const presentes = presentesPorCargoFecha.get(cargo)?.size || 0;
    const promedioPresente = Math.round((presentes / nDias) * 10) / 10;
    sumaRequerido += requerido;
    sumaPresente += promedioPresente;
    cumplimientoDetalle.push({
      cargo,
      requerido,
      promedio_presente: promedioPresente,
      cumplimiento_pct: requerido > 0 ? Math.round((promedioPresente / requerido) * 1000) / 10 : null,
    });
  }
  const cumplimientoGeneralPct = sumaRequerido > 0 ? Math.round((sumaPresente / sumaRequerido) * 1000) / 10 : null;

  return {
    rango: { desde, hasta, dias_evaluados: diasEvaluados },
    presentismo_pct: presentismoPct,
    ausentismo_pct: ausentismoPct,
    salidas_anticipadas: salidasAnticipadas,
    permisos_por_tipo: conteoTipos,
    recurrencia,
    cumplimiento_dotacion: {
      general_pct: cumplimientoGeneralPct,
      detalle: cumplimientoDetalle.sort((a, b) => (a.cumplimiento_pct ?? 0) - (b.cumplimiento_pct ?? 0)),
    },
    alertas_desvinculacion: {
      articulo: ARTICULO_160_N3,
      trabajadores: alertasDesvinculacion,
    },
  };
}

async function exportarReporteDesvinculacionXlsx(pool, filtros) {
  const datos = await calcularIndicadores(pool, filtros);
  const { articulo, trabajadores } = datos.alertas_desvinculacion;

  const encabezado = ['RUT', 'Nombre', 'Cargo', 'Mes', 'Regla configurada', 'Días con falta injustificada'];
  const filas = [];
  for (const t of trabajadores) {
    for (const a of t.alertas) {
      filas.push([t.rut, t.nombre, t.cargo, a.mes, a.regla, a.dias.join(', ')]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet([
    [`Reporte de posible causal de desvinculación por inasistencia — período ${filtros.desde} a ${filtros.hasta}`],
    [],
    [articulo.articulo],
    [`"${articulo.texto}"`],
    [articulo.nota],
    [],
    encabezado,
    ...filas,
  ]);

  ws['!cols'] = [{ wch: 13 }, { wch: 28 }, { wch: 26 }, { wch: 10 }, { wch: 22 }, { wch: 32 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Causal Desvinculación');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { calcularIndicadores, exportarReporteDesvinculacionXlsx };