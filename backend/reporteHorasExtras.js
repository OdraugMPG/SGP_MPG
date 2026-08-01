const XLSX = require('xlsx');
const PDFDocument = require('pdfkit');
const { generarDetalleMarcaciones } = require('./detalleMarcaciones');

const NOMBRE_DIA_POR_INDICE = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function horasFormatoAMinutos(hhmm) {
  if (!hhmm) return 0;
  const negativo = hhmm.startsWith('-');
  const limpio = negativo ? hhmm.slice(1) : hhmm;
  const [h, m] = limpio.split(':').map(Number);
  const mins = (h || 0) * 60 + (m || 0);
  return negativo ? -mins : mins;
}

// Calcula el detalle de horas extras (solo días/filas con horas extras > 0),
// en un rango de fechas, filtrando opcionalmente por días de la semana
// específicos (ej: excluir domingos) y por CD.
async function calcularReporteHorasExtras(pool, filtros) {
  const { desde, hasta, diasSemana, turnos, cds, soloAutorizadas } = filtros;
  // diasSemana: arreglo de nombres ['Lun','Mar',...] a incluir (null/vacío = todos)
  // turnos: arreglo ['AM','PM','NOCHE'] a incluir (null/vacío = todos)

  const filasDiarias = await generarDetalleMarcaciones(pool, { desde, hasta, cds }, Infinity);

  let autorizacionPorClave = new Map();
  if (soloAutorizadas) {
    const { rows } = await pool.query(
      'SELECT rut, fecha, autorizado FROM horas_extras_autorizacion WHERE fecha BETWEEN $1 AND $2',
      [desde, hasta]
    );
    autorizacionPorClave = new Map(rows.map(r => [`${r.rut}|${r.fecha}`, r.autorizado]));
  }

  const filtroDias = diasSemana && diasSemana.length > 0 ? new Set(diasSemana) : null;
  const filtroTurnos = turnos && turnos.length > 0 ? new Set(turnos.map(t => t.toUpperCase())) : null;

  const filas = [];
  for (const f of filasDiarias) {
    const minExtras = horasFormatoAMinutos(f.horas_extras_mpg);
    if (minExtras <= 0) continue;

    const diaSemana = NOMBRE_DIA_POR_INDICE[new Date(f.fecha + 'T00:00:00').getDay()];
    if (filtroDias && !filtroDias.has(diaSemana)) continue;

    if (filtroTurnos) {
      const turnoNormalizado = (f.turno || '').toUpperCase();
      if (!filtroTurnos.has(turnoNormalizado)) continue;
    }

    const autorizado = autorizacionPorClave.get(`${f.rut}|${f.fecha}`) || false;
    if (soloAutorizadas && !autorizado) continue;

    filas.push({
      fecha: f.fecha,
      dia_semana: diaSemana,
      rut: f.rut,
      nombre: f.nombre,
      cargo: f.cargo,
      turno: f.turno,
      entrada: f.entrada_mpg,
      salida: f.salida_mpg,
      horas_extras: f.horas_extras_mpg,
      autorizado: soloAutorizadas ? true : (autorizado ? 'Sí' : 'Pendiente'),
    });
  }

  filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.nombre || '').localeCompare(b.nombre || ''));
  return filas;
}

async function exportarReporteHorasExtrasXlsx(pool, filtros) {
  const filas = await calcularReporteHorasExtras(pool, filtros);

  const encabezado = ['Fecha', 'Día', 'RUT', 'Nombre', 'Cargo', 'Turno', 'Entrada', 'Salida', 'Horas Extras', 'Autorizado'];
  const datos = filas.map(f => [
    f.fecha, f.dia_semana, f.rut, f.nombre, f.cargo, f.turno, f.entrada, f.salida, f.horas_extras, f.autorizado,
  ]);

  const totalMin = filas.reduce((acc, f) => acc + horasFormatoAMinutos(f.horas_extras), 0);
  const totalH = Math.floor(totalMin / 60);
  const totalM = totalMin % 60;

  const ws = XLSX.utils.aoa_to_sheet([
    [`Reporte de Horas Extras — ${filtros.desde} a ${filtros.hasta}`],
    [`Total horas extras del período: ${String(totalH).padStart(2, '0')}:${String(totalM).padStart(2, '0')} — ${filas.length} registro(s)`],
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
    { wch: 12 }, { wch: 7 }, { wch: 13 }, { wch: 26 }, { wch: 24 }, { wch: 10 },
    { wch: 10 }, { wch: 10 }, { wch: 13 }, { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Horas Extras');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function exportarReporteHorasExtrasPdf(pool, filtros) {
  const filas = await calcularReporteHorasExtras(pool, filtros);
  const totalMin = filas.reduce((acc, f) => acc + horasFormatoAMinutos(f.horas_extras), 0);
  const totalH = Math.floor(totalMin / 60);
  const totalM = totalMin % 60;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const startX = 40;
    doc.fontSize(14).font('Helvetica-Bold').text('Reporte de Horas Extras', { align: 'center' });
    doc.moveDown(0.4);
    doc.fontSize(9).font('Helvetica');
    doc.text(`Período: ${filtros.desde} a ${filtros.hasta}`, startX);
    doc.text(`Total horas extras: ${String(totalH).padStart(2, '0')}:${String(totalM).padStart(2, '0')} — ${filas.length} registro(s)`, startX);
    doc.moveDown(0.6);

    const cols = [
      { key: 'fecha', label: 'Fecha', width: 62 },
      { key: 'dia_semana', label: 'Día', width: 34 },
      { key: 'rut', label: 'RUT', width: 68 },
      { key: 'nombre', label: 'Nombre', width: 160 },
      { key: 'cargo', label: 'Cargo', width: 150 },
      { key: 'turno', label: 'Turno', width: 55 },
      { key: 'entrada', label: 'Entrada', width: 50 },
      { key: 'salida', label: 'Salida', width: 50 },
      { key: 'horas_extras', label: 'H. Extras', width: 55 },
      { key: 'autorizado', label: 'Autorizado', width: 60 },
    ];

    function dibujarEncabezado(y) {
      let x = startX;
      doc.font('Helvetica-Bold').fontSize(8);
      for (const c of cols) { doc.text(c.label, x, y, { width: c.width }); x += c.width; }
      doc.moveTo(startX, y + 11).lineTo(x, y + 11).stroke();
      doc.font('Helvetica').fontSize(8);
      return y + 15;
    }

    let y = dibujarEncabezado(doc.y);
    for (const f of filas) {
      if (y > 520) { doc.addPage(); y = dibujarEncabezado(40); }
      let x = startX;
      for (const c of cols) {
        doc.text(String(f[c.key] ?? '—'), x, y, { width: c.width });
        x += c.width;
      }
      y += 13;
    }

    if (filas.length === 0) {
      doc.text('Sin horas extras para estos filtros en el período.', startX, y);
    }

    doc.end();
  });
}

module.exports = { calcularReporteHorasExtras, exportarReporteHorasExtrasXlsx, exportarReporteHorasExtrasPdf };