const XLSX = require('xlsx');
const { limpiarRut } = require('./importar');

// Lee el Excel de solicitud de anticipos. Acepta encabezados con distintas
// mayúsculas/minúsculas; si el archivo trae la columna RUT repetida (como en
// la planilla de origen), simplemente se usa la primera coincidencia.
function parseAnticiposExcel(path) {
  const wb = XLSX.readFile(path, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows
    .map(r => ({
      rut: limpiarRut(r['RUT'] ?? r['Rut'] ?? r['rut']),
      nombre: (r['Nombre'] ?? r['NOMBRE'] ?? r['nombre'] ?? '').toString().trim(),
      cargo: (r['Cargo'] ?? r['CARGO'] ?? r['cargo'] ?? '').toString().trim(),
      monto: Number(r['Monto'] ?? r['MONTO'] ?? r['monto'] ?? 0) || 0,
    }))
    .filter(f => f.rut);
}

// Mes calendario actual (día 1 hasta hoy) — período usado para revisar
// faltas injustificadas antes de aprobar un anticipo.
function mesActualRango() {
  const hoy = new Date();
  const desde = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
  const hasta = hoy.toISOString().slice(0, 10);
  return { desde, hasta };
}

// Cruza cada fila del Excel contra las faltas injustificadas (F_In) del mes
// en curso — no se le asigna el anticipo a quien tenga al menos una.
async function validarAnticipos(pool, filas) {
  const ruts = filas.map(f => f.rut);
  const { desde, hasta } = mesActualRango();

  const { rows: ausencias } = await pool.query(
    `SELECT rut, fecha FROM ausencias_permisos
     WHERE tipo = 'F_In' AND rut = ANY($1::text[]) AND fecha BETWEEN $2 AND $3
     ORDER BY fecha`,
    [ruts, desde, hasta]
  );
  const fechasPorRut = new Map();
  for (const a of ausencias) {
    if (!fechasPorRut.has(a.rut)) fechasPorRut.set(a.rut, []);
    fechasPorRut.get(a.rut).push(a.fecha);
  }

  return filas.map(f => {
    const fechasAusencia = fechasPorRut.get(f.rut) || [];
    return {
      ...f,
      dias_ausencia: fechasAusencia.length,
      fechas_ausencia: fechasAusencia,
      aprobado: fechasAusencia.length === 0,
    };
  });
}

async function exportarAnticiposXlsx(pool, filas) {
  const validados = await validarAnticipos(pool, filas);
  const { desde, hasta } = mesActualRango();

  const encabezado = ['RUT', 'Nombre', 'Cargo', 'Monto', 'Estado', 'Días de Falta Injustificada', 'Fechas'];
  const datos = validados.map(f => [
    f.rut, f.nombre, f.cargo, f.monto, f.aprobado ? 'Aprobado' : 'No aprobado',
    f.dias_ausencia, f.fechas_ausencia.join(', '),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([
    [`Validación de Anticipos de Sueldo — Faltas injustificadas revisadas: ${desde} a ${hasta}`],
    ['Los trabajadores "No aprobado" tienen al menos una falta injustificada (F_In) registrada en el mes en curso.'],
    [],
    encabezado,
    ...datos,
  ]);

  const nFilas = datos.length;
  const nCols = encabezado.length;
  ws['!autofilter'] = { ref: `A4:${XLSX.utils.encode_col(nCols - 1)}${nFilas + 4}` };
  ws['!views'] = [{ state: 'frozen', ySplit: 4 }];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } },
  ];
  ws['!cols'] = [
    { wch: 13 }, { wch: 26 }, { wch: 24 }, { wch: 12 }, { wch: 13 }, { wch: 14 }, { wch: 45 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Anticipos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseAnticiposExcel, validarAnticipos, exportarAnticiposXlsx };
