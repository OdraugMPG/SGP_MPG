const XLSX = require('xlsx');
const { diaDeSemana, semanaISO, resolverJefeTurno, determinarTipoTurno, construirRotacionBasePorClave, sumarDias } = require('./importar');

// Sigla que se muestra en el Dashboard para los días posteriores a la fecha
// de término, mientras el trabajador sigue "activo" por procesamiento del
// mes en curso (ver empleados.motivo_termino).
const CODIGO_MOTIVO_TERMINO = { R: 'Rnv', Des: 'Dsv', Des160: 'D160', CcTo: 'CcTo' };

function etiquetaTurno(tipoTurno) {
  if (tipoTurno === 'NOCHE') return 'Noche';
  if (tipoTurno === 'PLANO') return 'Plano';
  if (tipoTurno === 'AM' || tipoTurno === 'PM') return 'Rotativo';
  return 'Sin asignar';
}

async function calcularMatrizAsistencia(pool, filtros) {
  const { desde, hasta, area, cds } = filtros; // cds: null (todos) o arreglo de CDs permitidos/solicitados

  const dIni = new Date(desde + 'T00:00:00');
  const dFin = new Date(hasta + 'T00:00:00');
  const dias = Math.round((dFin - dIni) / 86400000) + 1;
  if (dias < 1 || dias > 62) throw new Error('El rango debe ser de 1 a 62 días');

  const fechas = [];
  for (let i = 0; i < dias; i++) {
    const d = new Date(dIni);
    d.setDate(d.getDate() + i);
    fechas.push(d.toISOString().slice(0, 10));
  }

  let sqlEmp = 'SELECT rut, nombre, apellido_paterno, cargo, centro_costo, cd, motivo_termino, fecha_termino, fecha_ingreso FROM empleados WHERE activo = true';
  const paramsEmp = [];
  if (area) { paramsEmp.push(area); sqlEmp += ` AND centro_costo = $${paramsEmp.length}`; }
  if (cds) { paramsEmp.push(cds); sqlEmp += ` AND cd = ANY($${paramsEmp.length}::text[])`; }
  sqlEmp += ' ORDER BY nombre';
  const { rows: empleados } = await pool.query(sqlEmp, paramsEmp);

  const { rows: resultados } = await pool.query(
    'SELECT rut, fecha, marco_talana, marco_cencosud FROM resultado_diario WHERE fecha BETWEEN $1 AND $2',
    [desde, hasta]
  );
  const resultadoPorClave = new Map(resultados.map(r => [`${r.rut}|${r.fecha}`, r]));

  const { rows: ausencias } = await pool.query(
    'SELECT rut, fecha, tipo FROM ausencias_permisos WHERE fecha BETWEEN $1 AND $2',
    [desde, hasta]
  );
  const ausenciaPorClave = new Map(ausencias.map(a => [`${a.rut}|${a.fecha}`, a.tipo]));

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));

  const { rows: rotacionRows } = await pool.query(
    `SELECT sem, jefe_turno, rotacion_base, hora_entrada FROM rotacion_turnos`
  );
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);

  const { rows: feriadosRows } = await pool.query('SELECT fecha FROM feriados');
  const feriadosSet = new Set(feriadosRows.map(r => r.fecha));

  const hoy = new Date().toISOString().slice(0, 10);

  // Devuelve el motivo del día libre ('feriado' | 'descanso' | null) — se
  // separa de un simple true/false para poder distinguir la sigla que
  // corresponde: DL/DLT para descanso regular, DFNL/DFT para feriado.
  function motivoDiaLibre(codigoJefeTurno, fecha) {
    if (!codigoJefeTurno) return null;
    if (feriadosSet.has(fecha)) return 'feriado';
    const dia = diaDeSemana(fecha);
    if (codigoJefeTurno === 'CG' || codigoJefeTurno === 'PLANO') {
      return (dia === 'Sáb' || dia === 'Dom') ? 'descanso' : null;
    }
    const codigoResuelto = resolverJefeTurno(codigoJefeTurno);
    const sem = semanaISO(fecha);
    const rotacionBase = rotacionBasePorClave.get(`${sem}|${codigoResuelto}`);
    if (rotacionBase === 'NOCHE') {
      if (feriadosSet.has(sumarDias(fecha, 1))) return 'feriado'; // Noche descansa el día previo al feriado
      return (dia === 'Sáb' || dia === 'Dom') ? 'descanso' : null;
    }
    if (rotacionBase === 'AM' || rotacionBase === 'PM') return dia === 'Dom' ? 'descanso' : null;
    return null;
  }

  const trabajadores = empleados.map(emp => {
    const estados = {};
    const codigoJefeTurno = jefeTurnoPorRut.get(emp.rut);
    for (const fecha of fechas) {
      const clave = `${emp.rut}|${fecha}`;
      const ausencia = ausenciaPorClave.get(clave);
      if (ausencia) {
        estados[fecha] = { codigo: ausencia, categoria: 'ausencia' };
        continue;
      }
      const r = resultadoPorClave.get(clave);
      const tieneMarca = !!(r && (r.marco_talana || r.marco_cencosud));

      // Antes de la fecha de ingreso (o de reingreso, si fue reactivado) la
      // persona no tenía contrato — sin marca real ese día, no corresponde
      // mostrarlo como "Ausente" ni como día libre/feriado (no le aplica un
      // descanso de un turno al que todavía no estaba asignado), sino como
      // fuera de dotación.
      if (!tieneMarca && emp.fecha_ingreso && fecha < emp.fecha_ingreso) {
        estados[fecha] = { codigo: 'SC', categoria: 'termino' };
        continue;
      }

      const motivo = motivoDiaLibre(codigoJefeTurno, fecha);
      if (motivo === 'feriado') {
        estados[fecha] = tieneMarca
          ? { codigo: 'DFT', categoria: 'diaLibreTrabajado' }
          : { codigo: 'DFNL', categoria: 'diaLibre' };
        continue;
      }
      if (motivo === 'descanso') {
        estados[fecha] = tieneMarca
          ? { codigo: 'DLT', categoria: 'diaLibreTrabajado' }
          : { codigo: 'DL', categoria: 'diaLibre' };
        continue;
      }
      if (r && r.marco_talana && r.marco_cencosud) {
        estados[fecha] = { codigo: 'P', categoria: 'ok' };
      } else if (r && r.marco_talana && !r.marco_cencosud) {
        estados[fecha] = { codigo: 'SM_CTRL', categoria: 'inconsistencia' };
      } else if (r && !r.marco_talana && r.marco_cencosud) {
        estados[fecha] = { codigo: 'SM_TLN', categoria: 'inconsistencia' };
      } else if (!tieneMarca && emp.motivo_termino && emp.fecha_termino && fecha >= emp.fecha_termino) {
        // Ya renunció/fue desvinculado/culminó contrato, pero sigue "activo"
        // hasta fin de mes (para no perder el procesamiento del mes) — no
        // corresponde marcarlo "Ausente" en estos días, sino indicar el motivo.
        estados[fecha] = { codigo: CODIGO_MOTIVO_TERMINO[emp.motivo_termino] || 'A', categoria: 'termino' };
      } else if (fecha < hoy) {
        estados[fecha] = { codigo: 'A', categoria: 'ausente' };
      } else {
        estados[fecha] = { codigo: '', categoria: 'futuro' };
      }
    }
    return {
      rut: emp.rut,
      nombre: `${emp.nombre} ${emp.apellido_paterno || ''}`.trim(),
      cargo: emp.cargo,
      area: emp.centro_costo,
      cd: emp.cd,
      jefe_turno: codigoJefeTurno || null,
      turno: etiquetaTurno(determinarTipoTurno(codigoJefeTurno, fechas[0], rotacionBasePorClave)),
      estados,
    };
  });

  return { fechas, trabajadores };
}

async function exportarMatrizAsistenciaXlsx(pool, filtros) {
  const { fechas, trabajadores } = await calcularMatrizAsistencia(pool, filtros);

  const encabezado = ['RUT', 'Nombre', 'Cargo', 'Área', 'Jefe de Turno', 'Turno', ...fechas];
  const datos = trabajadores.map(t => [
    t.rut, t.nombre, t.cargo || '', t.area || '', t.jefe_turno || '', t.turno || '',
    ...fechas.map(f => t.estados[f]?.codigo || ''),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([encabezado, ...datos]);
  const nCols = encabezado.length;
  ws['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(nCols - 1)}${datos.length + 1}` };
  ws['!views'] = [{ state: 'frozen', ySplit: 1, xSplit: 6 }];
  ws['!cols'] = [{ wch: 13 }, { wch: 26 }, { wch: 24 }, { wch: 14 }, { wch: 13 }, { wch: 11 }, ...fechas.map(() => ({ wch: 9 }))];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dashboard Asistencia');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { calcularMatrizAsistencia, exportarMatrizAsistenciaXlsx };