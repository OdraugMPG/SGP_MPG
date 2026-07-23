const XLSX = require('xlsx');
const { diaDeSemana, semanaISO, resolverJefeTurno, determinarTipoTurno } = require('./importar');

function etiquetaTurno(tipoTurno) {
  if (tipoTurno === 'NOCHE') return 'Noche';
  if (tipoTurno === 'PLANO') return 'Plano';
  if (tipoTurno === 'AM' || tipoTurno === 'PM') return 'Rotativo';
  return 'Sin asignar';
}

async function calcularMatrizAsistencia(pool, filtros) {
  const { desde, hasta, area } = filtros;

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

  let sqlEmp = 'SELECT rut, nombre, apellido_paterno, cargo, centro_costo FROM empleados WHERE activo = true';
  const paramsEmp = [];
  if (area) { paramsEmp.push(area); sqlEmp += ` AND centro_costo = $${paramsEmp.length}`; }
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
    `SELECT DISTINCT sem, jefe_turno, rotacion_base FROM rotacion_turnos WHERE rotacion_base IS NOT NULL`
  );
  const rotacionBasePorClave = new Map(rotacionRows.map(r => [`${r.sem}|${r.jefe_turno}`, r.rotacion_base]));

  const hoy = new Date().toISOString().slice(0, 10);

  function esDiaLibre(codigoJefeTurno, fecha) {
    if (!codigoJefeTurno) return false;
    const dia = diaDeSemana(fecha);
    if (codigoJefeTurno === 'CG' || codigoJefeTurno === 'PLANO') {
      return dia === 'Sáb' || dia === 'Dom';
    }
    const codigoResuelto = resolverJefeTurno(codigoJefeTurno);
    const sem = semanaISO(fecha);
    const rotacionBase = rotacionBasePorClave.get(`${sem}|${codigoResuelto}`);
    if (rotacionBase === 'NOCHE') return dia === 'Sáb' || dia === 'Dom';
    if (rotacionBase === 'AM' || rotacionBase === 'PM') return dia === 'Dom';
    return false;
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
      if (esDiaLibre(codigoJefeTurno, fecha)) {
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