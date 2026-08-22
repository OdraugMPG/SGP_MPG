const XLSX = require('xlsx');
const { generarDetalleMarcaciones } = require('./detalleMarcaciones');

// Calcula, para TODOS los trabajadores, la cantidad de días con atraso
// (marca de Talana, mismo umbral de 16+ minutos que el resto del sistema) en
// el rango de fechas, y cruza contra si ya tienen una amonestación vigente
// por causal de atraso (usando el catálogo de motivos marcados como
// "autocompletar_atrasos").
async function calcularReporteAtrasos(pool, filtros) {
  const { desde, hasta, cds } = filtros;

  const filas = await generarDetalleMarcaciones(pool, { desde, hasta, cds }, Infinity);

  const porTrabajador = new Map(); // rut -> { rut, nombre, cargo, turno, atrasos: [{fecha, esperada, real}] }
  for (const f of filas) {
    if (!f.entrada_mpg || !f.hora_entrada_esperada) continue;
    const [he, me] = f.hora_entrada_esperada.split(':').map(Number);
    const [hr, mr] = f.entrada_mpg.split(':').map(Number);
    const diffMin = (hr * 60 + mr) - (he * 60 + me);
    if (diffMin < 16) continue;

    if (!porTrabajador.has(f.rut)) {
      porTrabajador.set(f.rut, { rut: f.rut, nombre: f.nombre, cargo: f.cargo, turno: f.turno, atrasos: [] });
    }
    porTrabajador.get(f.rut).atrasos.push({
      fecha: f.fecha,
      esperada: f.hora_entrada_esperada.slice(0, 5),
      real: f.entrada_mpg.slice(0, 5),
    });
  }

  const ruts = [...porTrabajador.keys()];
  let amonestacionesPorRut = new Map();
  if (ruts.length > 0) {
    const { rows: motivosAtraso } = await pool.query(
      'SELECT motivo FROM motivos_amonestacion WHERE autocompletar_atrasos = true'
    );
    const labelsMotivo = motivosAtraso.map(m => m.motivo);
    if (labelsMotivo.length > 0) {
      const { rows: amonestacionesRows } = await pool.query(
        `SELECT rut, MAX(fecha) AS ultima_fecha
         FROM amonestaciones
         WHERE rut = ANY($1::text[]) AND motivo = ANY($2::text[])
         GROUP BY rut`,
        [ruts, labelsMotivo]
      );
      amonestacionesPorRut = new Map(amonestacionesRows.map(r => [r.rut, r.ultima_fecha]));
    }
  }

  const resultado = [...porTrabajador.values()]
    .map(t => ({
      rut: t.rut,
      nombre: t.nombre,
      cargo: t.cargo,
      turno: t.turno,
      cantidad_atrasos: t.atrasos.length,
      dias_atraso: t.atrasos.map(a => `${a.fecha} (esperada ${a.esperada}, marcó ${a.real})`).join(' · '),
      ya_amonestado: amonestacionesPorRut.has(t.rut),
      fecha_ultima_amonestacion: amonestacionesPorRut.get(t.rut) || null,
    }))
    .sort((a, b) => b.cantidad_atrasos - a.cantidad_atrasos || (a.nombre || '').localeCompare(b.nombre || ''));

  return resultado;
}

async function exportarReporteAtrasosXlsx(pool, filtros) {
  const filas = await calcularReporteAtrasos(pool, filtros);

  const encabezado = ['RUT', 'Nombre', 'Cargo', 'Turno', 'N° Atrasos', 'Detalle de días', '¿Ya amonestado por atraso?', 'Fecha última amonestación'];
  const datos = filas.map(f => [
    f.rut, f.nombre, f.cargo, f.turno || '—', f.cantidad_atrasos, f.dias_atraso,
    f.ya_amonestado ? 'Sí' : 'No', f.fecha_ultima_amonestacion || '—',
  ]);

  const ws = XLSX.utils.aoa_to_sheet([
    [`Trabajadores con Atrasos — ${filtros.desde} a ${filtros.hasta}`],
    [`${filas.length} trabajador(es) con al menos un atraso en el período`],
    [],
    encabezado,
    ...datos,
  ]);

  const nCols = encabezado.length;
  ws['!autofilter'] = { ref: `A4:${XLSX.utils.encode_col(nCols - 1)}${datos.length + 4}` };
  ws['!views'] = [{ state: 'frozen', ySplit: 4 }];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } },
  ];
  ws['!cols'] = [
    { wch: 13 }, { wch: 26 }, { wch: 24 }, { wch: 9 }, { wch: 11 }, { wch: 60 }, { wch: 14 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Atrasos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { calcularReporteAtrasos, exportarReporteAtrasosXlsx };