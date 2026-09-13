const { diaDeSemana, semanaISO, resolverJefeTurno, determinarTipoTurno, sumarDias, construirRotacionBasePorClave } = require('./importar');
const XLSX = require('xlsx');

// Cargos relevantes para los dashboards gerenciales (línea de tiempo). Se
// acotó esta lista a pedido de gerencia, para que los gráficos de línea se
// lean con claridad.
const CARGOS_DASHBOARD = [
  'ADMINISTRATIVO (A)',
  'JEFE (A) DE OPERACIONES',
  'JEFE DE TURNO SENIOR',
  'OPERADOR (A) DE MAQUINA ESPECIALIZADO',
  'OPERARIO (A) MULTIFUNCIONAL',
  'SUPERVISOR (A) SENIOR',
];

function etiquetaTurno(tipoTurno) {
  if (tipoTurno === 'NOCHE') return 'Noche';
  if (tipoTurno === 'PLANO') return 'Plano';
  if (tipoTurno === 'AM' || tipoTurno === 'PM') return 'Rotativo';
  return 'Sin asignar';
}

// Indica si, para un TIPO de turno (no una persona en particular), esa fecha
// es día de descanso: Noche y Plano libran Sábado y Domingo; AM/PM (Rotativo)
// libra solo Domingo. También considera feriados: cualquier feriado cuenta
// como día libre para todos los turnos (igual que un domingo), y el turno
// Noche además descansa el día PREVIO a cada feriado. Se usa para no exigir
// dotación en un turno que ese día nadie debería estar trabajando — de lo
// contrario, el requerido baja el promedio de cumplimiento sin que haya
// ninguna falta real.
function esDiaLibreTipoTurno(tipoTurno, fecha, feriadosSet) {
  if (feriadosSet) {
    if (feriadosSet.has(fecha)) return true;
    if (tipoTurno === 'NOCHE' && feriadosSet.has(sumarDias(fecha, 1))) return true;
  }
  const dow = new Date(fecha + 'T00:00:00').getDay(); // 0=Dom ... 6=Sáb
  if (tipoTurno === 'NOCHE' || tipoTurno === 'PLANO') return dow === 0 || dow === 6;
  if (tipoTurno === 'AM' || tipoTurno === 'PM') return dow === 0;
  return false;
}

// Devuelve las fechas de un rango, SUPRIMIENDO los domingos salvo que exista
// al menos una marca de asistencia real ese domingo (turno Noche trabajado,
// etc.) — para no ensuciar los gráficos con domingos que casi nadie trabaja.
async function fechasValidas(pool, desde, hasta) {
  const dIni = new Date(desde + 'T00:00:00');
  const dFin = new Date(hasta + 'T00:00:00');
  const dias = Math.round((dFin - dIni) / 86400000) + 1;
  const todas = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(dIni);
    d.setDate(d.getDate() + i);
    todas.push(d.toISOString().slice(0, 10));
  }

  const domingos = todas.filter(f => new Date(f + 'T00:00:00').getDay() === 0);
  let domingosConAsistencia = new Set();
  if (domingos.length > 0) {
    const { rows } = await pool.query(
      `SELECT DISTINCT fecha FROM resultado_diario WHERE fecha = ANY($1::text[]) AND (marco_talana = 1 OR marco_cencosud = 1)`,
      [domingos]
    );
    domingosConAsistencia = new Set(rows.map(r => r.fecha));
  }

  return todas.filter(f => new Date(f + 'T00:00:00').getDay() !== 0 || domingosConAsistencia.has(f));
}

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

// Dado un arreglo de registros históricos [{vigente_desde, vigente_hasta, cantidad_requerida}]
// (en cualquier orden), devuelve el valor vigente en 'fecha': el que tenga
// vigente_desde <= fecha, y (vigente_hasta es null O vigente_hasta >= fecha),
// tomando el de vigente_desde más reciente si hay varios que calzan.
function valorVigenteEnFecha(registros, fecha) {
  let mejor = null;
  for (const r of registros) {
    if (r.vigente_desde > fecha) continue;
    if (r.vigente_hasta && r.vigente_hasta < fecha) continue;
    if (!mejor || r.vigente_desde > mejor.vigente_desde) mejor = r;
  }
  return mejor ? mejor.cantidad_requerida : null;
}

async function calcularIndicadores(pool, filtros) {
  const { desde, hasta, area, cds } = filtros; // cds: null (todos) o arreglo de CDs permitidos/solicitados

  const { rows: feriadosRows } = await pool.query('SELECT fecha FROM feriados');
  const feriadosSet = new Set(feriadosRows.map(r => r.fecha));

  // --- Universo de trabajadores activos (filtrado por área y/o CD si corresponde) ---
  let sqlEmp = 'SELECT rut, nombre, apellido_paterno, cargo, centro_costo, cd FROM empleados WHERE activo = true';
  const paramsEmp = [];
  if (area) { paramsEmp.push(area); sqlEmp += ` AND centro_costo = $${paramsEmp.length}`; }
  if (cds) { paramsEmp.push(cds); sqlEmp += ` AND cd = ANY($${paramsEmp.length}::text[])`; }
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

  // --- Salidas anticipadas ---
  // Requiere el horario esperado de salida según turno asignado + rotación.
  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));
  const { rows: rotacionRows } = await pool.query(
    'SELECT sem, jefe_turno, dia, hora_entrada, hora_salida, rotacion_base FROM rotacion_turnos'
  );
  const rotacionMap = new Map(rotacionRows.map(r => [`${r.sem}|${r.jefe_turno}|${r.dia}`, r.hora_salida]));
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);
  const TOLERANCIA_SALIDA_MIN = 15;

  let salidasAnticipadas = 0;
  const salidasAnticipadasPorTurno = {};
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
    if (diffMin > TOLERANCIA_SALIDA_MIN) {
      salidasAnticipadas++;
      const tipoTurnoDia = determinarTipoTurno(codigo, r.fecha, rotacionBasePorClave);
      const etiqueta = etiquetaTurno(tipoTurnoDia);
      salidasAnticipadasPorTurno[etiqueta] = (salidasAnticipadasPorTurno[etiqueta] || 0) + 1;
    }
  }

  // --- Permisos y licencias (conteo por tipo, informativo, todos los tipos) ---
  const conteoTipos = {};
  for (const a of ausenciasFiltradas) {
    conteoTipos[a.tipo] = (conteoTipos[a.tipo] || 0) + 1;
  }

  // --- Ausentismo por tipo (curado): solo las causales que cuentan como
  // ausentismo real. Renuncia (R) y Desvinculado (Dv) NO son ausentismo —
  // son fin de la relación laboral, así que se excluyen a propósito.
  const TIPOS_AUSENTISMO = ['LM', 'PF', 'F_Ju', 'F_In', 'PSGS', 'PCGS', 'DC'];
  const ausentismoPorTipo = {};
  for (const tipo of TIPOS_AUSENTISMO) ausentismoPorTipo[tipo] = 0;
  for (const a of ausenciasFiltradas) {
    if (TIPOS_AUSENTISMO.includes(a.tipo)) ausentismoPorTipo[a.tipo]++;
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

  // --- Cumplimiento de dotación (por CARGO + CD, día por día, respetando el
  // descanso de cada turno para no exigir dotación en días que nadie de ese
  // turno debería trabajar). El requerimiento es específico de cada CD — el
  // de un CD no debe aplicarse a los trabajadores de otro. ---
  let sqlHistorialReq = `SELECT cargo, turno, cd, vigente_desde, vigente_hasta, cantidad_requerida FROM requerimiento_dotacion
     WHERE vigente_desde <= $1`;
  const paramsHistorialReq = [hasta];
  if (cds) { paramsHistorialReq.push(cds); sqlHistorialReq += ` AND cd = ANY($${paramsHistorialReq.length}::text[])`; }
  sqlHistorialReq += ' ORDER BY cargo, cd, turno, vigente_desde ASC';
  const { rows: historialReq } = await pool.query(sqlHistorialReq, paramsHistorialReq);

  const historialReqPorGrupo = new Map(); // `${cargo}|${turno}|${cd}` -> [{vigente_desde, vigente_hasta, cantidad_requerida}]
  const cargoCdConRequerimiento = new Set(); // `${cargo}|${cd}`
  for (const r of historialReq) {
    const clave = `${r.cargo}|${r.turno}|${r.cd}`;
    if (!historialReqPorGrupo.has(clave)) historialReqPorGrupo.set(clave, []);
    historialReqPorGrupo.get(clave).push(r);
    cargoCdConRequerimiento.add(`${r.cargo}|${r.cd}`);
  }
  function requeridoVigenteCargoTurnoCd(cargo, turno, cd, fecha) {
    const registros = historialReqPorGrupo.get(`${cargo}|${turno}|${cd}`) || [];
    return valorVigenteEnFecha(registros, fecha) || 0;
  }

  const fechasCumplimiento = await fechasValidas(pool, desde, hasta);

  // Presentes por día, agrupados por cargo + CD (todos los turnos juntos),
  // usando el CD propio de cada trabajador (empleados.cd).
  const presentesPorCargoCdDia = new Map(); // `${fecha}|${cargo}|${cd}` -> Set(rut)
  for (const r of resultadosFiltrados) {
    if (!(r.marco_talana || r.marco_cencosud)) continue;
    const emp = empleadoPorRut.get(r.rut);
    if (!emp || !emp.cargo || !emp.cd) continue;
    const claveCargoCd = `${emp.cargo}|${emp.cd}`;
    if (!cargoCdConRequerimiento.has(claveCargoCd)) continue;
    const clave = `${r.fecha}|${claveCargoCd}`;
    if (!presentesPorCargoCdDia.has(clave)) presentesPorCargoCdDia.set(clave, new Set());
    presentesPorCargoCdDia.get(clave).add(r.rut);
  }

  const sumaRequeridoPorCargoCdDia = {};
  const sumaPresentePorCargoCdDia = {};
  for (const claveCargoCd of cargoCdConRequerimiento) { sumaRequeridoPorCargoCdDia[claveCargoCd] = 0; sumaPresentePorCargoCdDia[claveCargoCd] = 0; }

  const NOMBRES_DIA_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const sumaRequeridoPorDiaSemana = {};
  const sumaPresentePorDiaSemana = {};
  for (const nombre of NOMBRES_DIA_SEMANA) { sumaRequeridoPorDiaSemana[nombre] = 0; sumaPresentePorDiaSemana[nombre] = 0; }

  for (const fecha of fechasCumplimiento) {
    const nombreDiaSemana = NOMBRES_DIA_SEMANA[new Date(fecha + 'T00:00:00').getDay()];
    for (const claveCargoCd of cargoCdConRequerimiento) {
      const [cargo, cd] = claveCargoCd.split('|');
      let requeridoDia = 0;
      for (const clave of historialReqPorGrupo.keys()) {
        const [c, t, cdClave] = clave.split('|');
        if (c !== cargo || cdClave !== cd) continue;
        if (esDiaLibreTipoTurno(t, fecha, feriadosSet)) continue;
        requeridoDia += requeridoVigenteCargoTurnoCd(cargo, t, cd, fecha);
      }
      const presenteDia = presentesPorCargoCdDia.get(`${fecha}|${claveCargoCd}`)?.size || 0;
      sumaRequeridoPorCargoCdDia[claveCargoCd] += requeridoDia;
      sumaPresentePorCargoCdDia[claveCargoCd] += presenteDia;
      sumaRequeridoPorDiaSemana[nombreDiaSemana] += requeridoDia;
      sumaPresentePorDiaSemana[nombreDiaSemana] += presenteDia;
    }
  }

  // --- Ausentismo por día de la semana (¿qué día falla más la dotación?) ---
  const ausentismoPorDiaSemana = NOMBRES_DIA_SEMANA
    .filter(nombre => sumaRequeridoPorDiaSemana[nombre] > 0)
    .map(nombre => {
      const requerido = sumaRequeridoPorDiaSemana[nombre];
      const presentes = sumaPresentePorDiaSemana[nombre];
      const cumplimientoPct = Math.round((presentes / requerido) * 1000) / 10;
      return {
        dia: nombre,
        requerido,
        presentes,
        cumplimiento_pct: cumplimientoPct,
        ausentismo_pct: Math.round((100 - cumplimientoPct) * 10) / 10,
      };
    })
    .sort((a, b) => b.ausentismo_pct - a.ausentismo_pct);

  // --- Recursos: contratados (activos) vs requerido vigente hoy/hasta, por CARGO + CD ---
  let sqlVigenteHoy = `SELECT DISTINCT ON (cargo, turno, cd) cargo, turno, cd, cantidad_requerida
     FROM requerimiento_dotacion WHERE vigente_desde <= $1 AND (vigente_hasta IS NULL OR vigente_hasta >= $1)`;
  const paramsVigenteHoy = [hasta];
  if (cds) { paramsVigenteHoy.push(cds); sqlVigenteHoy += ` AND cd = ANY($${paramsVigenteHoy.length}::text[])`; }
  sqlVigenteHoy += ' ORDER BY cargo, turno, cd, vigente_desde DESC';
  const { rows: requerimientoVigenteHoy } = await pool.query(sqlVigenteHoy, paramsVigenteHoy);

  const requeridoActualPorCargoCd = new Map();
  for (const r of requerimientoVigenteHoy) {
    const clave = `${r.cargo}|${r.cd}`;
    requeridoActualPorCargoCd.set(clave, (requeridoActualPorCargoCd.get(clave) || 0) + r.cantidad_requerida);
  }
  const contratadosPorCargoCd = new Map();
  for (const emp of empleados) {
    if (!emp.cargo || !emp.cd) continue;
    const clave = `${emp.cargo}|${emp.cd}`;
    contratadosPorCargoCd.set(clave, (contratadosPorCargoCd.get(clave) || 0) + 1);
  }
  const cargoCdParaBrecha = new Set([...requeridoActualPorCargoCd.keys(), ...contratadosPorCargoCd.keys()]);
  const brechaRecursos = [...cargoCdParaBrecha].map(clave => {
    const [cargo, cd] = clave.split('|');
    const requeridoActual = requeridoActualPorCargoCd.get(clave) || 0;
    const contratados = contratadosPorCargoCd.get(clave) || 0;
    return { cargo, cd, requerido_actual: requeridoActual, contratados, brecha: requeridoActual - contratados };
  }).sort((a, b) => b.brecha - a.brecha);

  const nDiasCumplimiento = Math.max(1, fechasCumplimiento.length);

  // Totales acumulados (persona-días) del período — NO promedios. Ej: si se
  // requieren 50 personas/día en 10 días, el requerido acumulado es 500.
  const cumplimientoDetalle = [];
  let requeridoTotalPeriodo = 0;
  let presentesTotalPeriodo = 0;
  for (const claveCargoCd of cargoCdConRequerimiento) {
    const [cargo, cd] = claveCargoCd.split('|');
    const requeridoTotal = sumaRequeridoPorCargoCdDia[claveCargoCd];
    const presentesTotal = sumaPresentePorCargoCdDia[claveCargoCd];
    requeridoTotalPeriodo += requeridoTotal;
    presentesTotalPeriodo += presentesTotal;
    cumplimientoDetalle.push({
      cargo,
      cd,
      requerido: requeridoTotal,
      presentes: presentesTotal,
      promedio_presente: Math.round((presentesTotal / nDiasCumplimiento) * 10) / 10,
      cumplimiento_pct: requeridoTotal > 0 ? Math.round((presentesTotal / requeridoTotal) * 1000) / 10 : null,
    });
  }
  const cumplimientoGeneralPct = requeridoTotalPeriodo > 0
    ? Math.round((presentesTotalPeriodo / requeridoTotalPeriodo) * 1000) / 10
    : null;
  const ausentismoPct = cumplimientoGeneralPct !== null ? Math.round((100 - cumplimientoGeneralPct) * 10) / 10 : null;

  return {
    rango: { desde, hasta, dias_evaluados: fechasCumplimiento.length },
    dotacion_requerida: requeridoTotalPeriodo,
    presentismo: presentesTotalPeriodo,
    cumplimiento_dotacion_pct: cumplimientoGeneralPct,
    ausentismo_pct: ausentismoPct,
    salidas_anticipadas: salidasAnticipadas,
    salidas_anticipadas_por_turno: salidasAnticipadasPorTurno,
    permisos_por_tipo: conteoTipos,
    ausentismo_por_tipo: ausentismoPorTipo,
    recurrencia,
    cumplimiento_dotacion: {
      general_pct: cumplimientoGeneralPct,
      detalle: cumplimientoDetalle.sort((a, b) => (a.cumplimiento_pct ?? 0) - (b.cumplimiento_pct ?? 0)),
    },
    ausentismo_por_dia_semana: ausentismoPorDiaSemana,
    brecha_recursos: brechaRecursos,
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

// Serie diaria de Requerido vs Presentes, en un rango de fechas — usada para
// el gráfico de cumplimiento. Cargo y Turno son opcionales: si no se
// especifican, se consolida TODO (todos los cargos y/o todos los turnos).
// El "requerido" usa el valor vigente en CADA día (no solo el de "hasta"),
// para reflejar correctamente si el requerimiento cambió durante el período.
async function calcularSerieCumplimiento(pool, filtros) {
  const { desde, hasta, cargo, jefesTurno, cds } = filtros; // cds: null (todos) o arreglo de CDs permitidos/solicitados

  const { rows: feriadosRows } = await pool.query('SELECT fecha FROM feriados');
  const feriadosSet = new Set(feriadosRows.map(r => r.fecha));

  const dIni = new Date(desde + 'T00:00:00');
  const dFin = new Date(hasta + 'T00:00:00');
  const diasTotales = Math.round((dFin - dIni) / 86400000) + 1;
  if (diasTotales < 1 || diasTotales > 92) throw new Error('El rango debe ser de 1 a 92 días');

  const fechas = await fechasValidas(pool, desde, hasta);

  const filtraJefes = Array.isArray(jefesTurno) && jefesTurno.length > 0;

  // Historial de requerimiento (filtrado por cargo y/o CD si se indicó; el
  // turno se resuelve más abajo día a día según los jefes de turno
  // seleccionados). El requerimiento es específico de cada CD.
  let sqlReq = 'SELECT cargo, turno, cd, vigente_desde, vigente_hasta, cantidad_requerida FROM requerimiento_dotacion WHERE 1=1';
  const paramsReq = [];
  if (cargo) { paramsReq.push(cargo); sqlReq += ` AND cargo = $${paramsReq.length}`; }
  if (cds) { paramsReq.push(cds); sqlReq += ` AND cd = ANY($${paramsReq.length}::text[])`; }
  sqlReq += ' ORDER BY cargo, turno, vigente_desde ASC';
  const { rows: historial } = await pool.query(sqlReq, paramsReq);

  const historialPorGrupo = new Map(); // clave `cargo|turno|cd` -> [{vigente_desde, vigente_hasta, cantidad_requerida}]
  for (const r of historial) {
    const clave = `${r.cargo}|${r.turno}|${r.cd}`;
    if (!historialPorGrupo.has(clave)) historialPorGrupo.set(clave, []);
    historialPorGrupo.get(clave).push(r);
  }

  function requeridoDeTipoEn(tipoTurno, fecha) {
    if (esDiaLibreTipoTurno(tipoTurno, fecha, feriadosSet)) return 0;
    let total = 0;
    for (const [clave, registros] of historialPorGrupo) {
      const [, t] = clave.split('|');
      if (t !== tipoTurno) continue;
      const vigente = valorVigenteEnFecha(registros, fecha);
      if (vigente !== null) total += vigente;
    }
    return total;
  }

  function requeridoTotalEn(fecha) {
    let total = 0;
    for (const [clave, registros] of historialPorGrupo) {
      const [, t] = clave.split('|');
      if (esDiaLibreTipoTurno(t, fecha, feriadosSet)) continue;
      const vigente = valorVigenteEnFecha(registros, fecha);
      if (vigente !== null) total += vigente;
    }
    return total;
  }

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));
  const { rows: rotacionRows } = await pool.query(
    'SELECT sem, jefe_turno, rotacion_base, hora_entrada FROM rotacion_turnos'
  );
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);

  // Presentes por día.
  const presentesPorFecha = new Map();
  let sqlPres = `SELECT r.rut, r.fecha
     FROM resultado_diario r
     JOIN empleados e ON e.rut = r.rut
     WHERE e.activo = true AND r.fecha BETWEEN $1 AND $2 AND (r.marco_talana = 1 OR r.marco_cencosud = 1)`;
  const paramsPres = [desde, hasta];
  if (cargo) { paramsPres.push(cargo); sqlPres += ` AND e.cargo = $${paramsPres.length}`; }
  if (cds) { paramsPres.push(cds); sqlPres += ` AND e.cd = ANY($${paramsPres.length}::text[])`; }
  const { rows: presentesRaw } = await pool.query(sqlPres, paramsPres);
  for (const p of presentesRaw) {
    if (filtraJefes) {
      const codigo = jefeTurnoPorRut.get(p.rut);
      if (!jefesTurno.includes(codigo)) continue;
    }
    presentesPorFecha.set(p.fecha, (presentesPorFecha.get(p.fecha) || 0) + 1);
  }

  const serie = fechas.map(f => {
    let requerido;
    if (filtraJefes) {
      // Suma el requerido de los TIPOS de turno (AM/PM/NOCHE/PLANO) que
      // resuelven los jefes de turno seleccionados ese día — sin duplicar si
      // dos jefes seleccionados coinciden en el mismo tipo ese día.
      const tipos = new Set();
      for (const jt of jefesTurno) {
        const t = determinarTipoTurno(jt, f, rotacionBasePorClave);
        if (t) tipos.add(t);
      }
      requerido = [...tipos].reduce((acc, t) => acc + requeridoDeTipoEn(t, f), 0);
    } else {
      requerido = requeridoTotalEn(f);
    }
    const presente = presentesPorFecha.get(f) || 0;
    return {
      fecha: f,
      requerido,
      presentes: presente,
      cumplimiento_pct: requerido > 0 ? Math.round((presente / requerido) * 1000) / 10 : null,
    };
  });

  return { cargo: cargo || 'Todos', jefes_turno: filtraJefes ? jefesTurno : ['Todos'], serie };
}

// Mismos tipos que TIPOS_AUSENTISMO (arriba): causales de ausentismo real,
// excluyendo Renuncia/Desvinculado (fin de la relación laboral, no ausentismo).
const TIPOS_AUSENTISMO_DIARIO = ['LM', 'F_Ju', 'F_In', 'PSGS', 'PCGS', 'DC', 'PF'];

// Serie diaria de ausentismo por tipo (LM, F_In, etc.), en cantidad y como
// porcentaje del requerido de dotación de ese día — mismo cálculo de
// "requerido" que calcularSerieCumplimiento, para que ambos paneles del
// Dashboard sean consistentes entre sí.
async function calcularAusentismoPorTipoDiario(pool, filtros) {
  const { desde, hasta, cds } = filtros; // cds: null (todos) o arreglo de CDs permitidos/solicitados

  const dIni = new Date(desde + 'T00:00:00');
  const dFin = new Date(hasta + 'T00:00:00');
  const diasTotales = Math.round((dFin - dIni) / 86400000) + 1;
  if (diasTotales < 1 || diasTotales > 92) throw new Error('El rango debe ser de 1 a 92 días');

  const { rows: feriadosRows } = await pool.query('SELECT fecha FROM feriados');
  const feriadosSet = new Set(feriadosRows.map(r => r.fecha));

  const fechas = await fechasValidas(pool, desde, hasta);

  let sqlReq = 'SELECT cargo, turno, cd, vigente_desde, vigente_hasta, cantidad_requerida FROM requerimiento_dotacion WHERE 1=1';
  const paramsReq = [];
  if (cds) { paramsReq.push(cds); sqlReq += ` AND cd = ANY($${paramsReq.length}::text[])`; }
  const { rows: historial } = await pool.query(sqlReq, paramsReq);

  const historialPorGrupo = new Map();
  for (const r of historial) {
    const clave = `${r.cargo}|${r.turno}|${r.cd}`;
    if (!historialPorGrupo.has(clave)) historialPorGrupo.set(clave, []);
    historialPorGrupo.get(clave).push(r);
  }

  function requeridoTotalEn(fecha) {
    let total = 0;
    for (const [clave, registros] of historialPorGrupo) {
      const [, t] = clave.split('|');
      if (esDiaLibreTipoTurno(t, fecha, feriadosSet)) continue;
      const vigente = valorVigenteEnFecha(registros, fecha);
      if (vigente !== null) total += vigente;
    }
    return total;
  }

  // Solo trabajadores activos (mismo criterio que "presentes" en
  // calcularSerieCumplimiento) — evita contar ausencias de fichas ya
  // desactivadas.
  let sqlAus = `SELECT a.fecha, a.tipo
                FROM ausencias_permisos a
                JOIN empleados e ON e.rut = a.rut
                WHERE e.activo = true AND a.fecha BETWEEN $1 AND $2 AND a.tipo = ANY($3::text[])`;
  const paramsAus = [desde, hasta, TIPOS_AUSENTISMO_DIARIO];
  if (cds) { paramsAus.push(cds); sqlAus += ` AND e.cd = ANY($${paramsAus.length}::text[])`; }
  const { rows: ausencias } = await pool.query(sqlAus, paramsAus);

  const conteoPorFecha = new Map(); // fecha -> { tipo: cantidad }
  for (const a of ausencias) {
    if (!conteoPorFecha.has(a.fecha)) conteoPorFecha.set(a.fecha, {});
    const acc = conteoPorFecha.get(a.fecha);
    acc[a.tipo] = (acc[a.tipo] || 0) + 1;
  }

  const serie = fechas.map(f => {
    const requerido = requeridoTotalEn(f);
    const crudo = conteoPorFecha.get(f) || {};
    const porTipo = {};
    let total = 0;
    for (const tipo of TIPOS_AUSENTISMO_DIARIO) {
      const cantidad = crudo[tipo] || 0;
      total += cantidad;
      porTipo[tipo] = { cantidad, pct: requerido > 0 ? Math.round((cantidad / requerido) * 1000) / 10 : null };
    }
    return {
      fecha: f,
      requerido,
      total,
      total_pct: requerido > 0 ? Math.round((total / requerido) * 1000) / 10 : null,
      por_tipo: porTipo,
    };
  });

  return { tipos: TIPOS_AUSENTISMO_DIARIO, serie };
}

// Presentismo histórico mensual, por cada uno de los cargos gerenciales fijos,
// para un set de meses (siempre 3 consecutivos: un trimestre). Filtra por
// Jefe de Turno específico, o "Todos" para ver el día completo (todos los
// grupos combinados). Cada mes se promedia usando fechasValidas (domingos
// suprimidos salvo asistencia real).
async function calcularPresentismoHistorico(pool, filtros) {
  const { meses, jefesTurno, cd } = filtros; // jefesTurno: array de códigos (opcional); cd: string (opcional)
  if (!Array.isArray(meses) || meses.length === 0) throw new Error('Debes indicar al menos un mes');
  const filtraJefes = Array.isArray(jefesTurno) && jefesTurno.length > 0;

  const { rows: feriadosRows } = await pool.query('SELECT fecha FROM feriados');
  const feriadosSet = new Set(feriadosRows.map(r => r.fecha));

  let sqlHistorial = `SELECT cargo, turno, vigente_desde, vigente_hasta, cantidad_requerida FROM requerimiento_dotacion
     WHERE cargo = ANY($1::text[])`;
  const paramsHistorial = [CARGOS_DASHBOARD];
  if (cd) { paramsHistorial.push(cd); sqlHistorial += ` AND cd = $${paramsHistorial.length}`; }
  sqlHistorial += ' ORDER BY cargo, turno, vigente_desde ASC';
  const { rows: historial } = await pool.query(sqlHistorial, paramsHistorial);
  const historialPorGrupo = new Map(); // `${cargo}|${turno}` -> [{vigente_desde, vigente_hasta, cantidad_requerida}]
  for (const r of historial) {
    const clave = `${r.cargo}|${r.turno}`;
    if (!historialPorGrupo.has(clave)) historialPorGrupo.set(clave, []);
    historialPorGrupo.get(clave).push(r);
  }
  function requeridoVigenteEn(cargo, turno, fecha) {
    const registros = historialPorGrupo.get(`${cargo}|${turno}`) || [];
    return valorVigenteEnFecha(registros, fecha) || 0;
  }

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));
  const { rows: rotacionRows } = await pool.query(
    'SELECT sem, jefe_turno, rotacion_base, hora_entrada FROM rotacion_turnos'
  );
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);

  let sqlEmpleados = 'SELECT rut, cargo FROM empleados WHERE activo = true AND cargo = ANY($1::text[])';
  const paramsEmpleados = [CARGOS_DASHBOARD];
  if (cd) { paramsEmpleados.push(cd); sqlEmpleados += ` AND cd = $${paramsEmpleados.length}`; }
  const { rows: empleados } = await pool.query(sqlEmpleados, paramsEmpleados);
  const cargoPorRut = new Map(empleados.map(e => [e.rut, e.cargo]));
  const rutsRelevantes = [...cargoPorRut.keys()];

  const resultado = {};
  for (const cargo of CARGOS_DASHBOARD) resultado[cargo] = [];

  for (const mes of meses) {
    const [anio, mesNum] = mes.split('-').map(Number);
    const desdeMes = `${mes}-01`;
    const ultimoDia = new Date(anio, mesNum, 0).getDate();
    const hastaMes = `${mes}-${String(ultimoDia).padStart(2, '0')}`;
    const fechas = rutsRelevantes.length > 0 ? await fechasValidas(pool, desdeMes, hastaMes) : [];

    const sumaRequeridoPorCargo = {};
    const sumaPresentesPorCargo = {};
    for (const cargo of CARGOS_DASHBOARD) { sumaRequeridoPorCargo[cargo] = 0; sumaPresentesPorCargo[cargo] = 0; }

    let presentesPorDiaCargo = new Map(); // `${fecha}|${cargo}` -> Set(rut)
    if (fechas.length > 0 && rutsRelevantes.length > 0) {
      const { rows: presentesRaw } = await pool.query(
        `SELECT rut, fecha FROM resultado_diario
         WHERE fecha = ANY($1::text[]) AND rut = ANY($2::text[]) AND (marco_talana = 1 OR marco_cencosud = 1)`,
        [fechas, rutsRelevantes]
      );
      for (const p of presentesRaw) {
        const cargo = cargoPorRut.get(p.rut);
        if (!cargo) continue;
        if (filtraJefes) {
          const codigo = jefeTurnoPorRut.get(p.rut);
          if (!jefesTurno.includes(codigo)) continue;
        }
        const clave = `${p.fecha}|${cargo}`;
        if (!presentesPorDiaCargo.has(clave)) presentesPorDiaCargo.set(clave, new Set());
        presentesPorDiaCargo.get(clave).add(p.rut);
      }
    }

    for (const fecha of fechas) {
      for (const cargo of CARGOS_DASHBOARD) {
        let requeridoDia = 0;
        if (filtraJefes) {
          const tipos = new Set();
          for (const jt of jefesTurno) {
            const t = determinarTipoTurno(jt, fecha, rotacionBasePorClave);
            if (t) tipos.add(t);
          }
          for (const t of tipos) {
            if (esDiaLibreTipoTurno(t, fecha, feriadosSet)) continue;
            requeridoDia += requeridoVigenteEn(cargo, t, fecha);
          }
        } else {
          for (const clave of historialPorGrupo.keys()) {
            const [c, t] = clave.split('|');
            if (c !== cargo) continue;
            if (esDiaLibreTipoTurno(t, fecha, feriadosSet)) continue;
            requeridoDia += requeridoVigenteEn(cargo, t, fecha);
          }
        }
        sumaRequeridoPorCargo[cargo] += requeridoDia;
        sumaPresentesPorCargo[cargo] += presentesPorDiaCargo.get(`${fecha}|${cargo}`)?.size || 0;
      }
    }

    const nDias = Math.max(1, fechas.length);
    for (const cargo of CARGOS_DASHBOARD) {
      const promedioRequerido = Math.round((sumaRequeridoPorCargo[cargo] / nDias) * 10) / 10;
      const promedioPresentes = Math.round((sumaPresentesPorCargo[cargo] / nDias) * 10) / 10;
      resultado[cargo].push({
        mes,
        requerido: promedioRequerido,
        presentes: promedioPresentes,
        cumplimiento_pct: promedioRequerido > 0 ? Math.round((promedioPresentes / promedioRequerido) * 1000) / 10 : null,
      });
    }
  }

  return { cargos: CARGOS_DASHBOARD, meses, jefes_turno: filtraJefes ? jefesTurno : ['Todos'], cd: cd || 'Todos', resultado };
}

module.exports = {
  calcularIndicadores, exportarReporteDesvinculacionXlsx, calcularSerieCumplimiento,
  calcularAusentismoPorTipoDiario, calcularPresentismoHistorico, CARGOS_DASHBOARD,
};