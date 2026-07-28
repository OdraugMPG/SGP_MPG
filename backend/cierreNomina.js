const XLSX = require('xlsx');
const { generarDetalleMarcaciones } = require('./detalleMarcaciones');

function horasFormatoAMinutos(hhmm) {
  if (!hhmm) return 0;
  const negativo = hhmm.startsWith('-');
  const limpio = negativo ? hhmm.slice(1) : hhmm;
  const [h, m] = limpio.split(':').map(Number);
  const mins = (h || 0) * 60 + (m || 0);
  return negativo ? -mins : mins;
}

function minutosAFormato(mins) {
  const signo = mins < 0 ? '-' : '';
  const abs = Math.round(Math.abs(mins));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${signo}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Consolida, por trabajador, el total de horas trabajadas y horas extras
// (Talana/MPG, con colación ya aplicada) en un rango de fechas — reutiliza
// exactamente el mismo cálculo diario de "Detalle de Marcaciones", solo que
// sumado por persona en vez de mostrarlo día por día.
async function calcularCierreNomina(pool, filtros) {
  const { desde, hasta, cds } = filtros; // cds: null (todos) o arreglo de CDs permitidos/solicitados

  const filasDiarias = await generarDetalleMarcaciones(pool, { desde, hasta }, Infinity);

  let rutsPermitidos = null;
  if (cds) {
    const { rows } = await pool.query('SELECT rut FROM empleados WHERE cd = ANY($1::text[])', [cds]);
    rutsPermitidos = new Set(rows.map(r => r.rut));
  }

  const acumulado = new Map(); // rut -> { ...datos, minTrabajadas, minExtras, diasCompletos, diasIncompletos }
  for (const f of filasDiarias) {
    if (rutsPermitidos && !rutsPermitidos.has(f.rut)) continue;
    if (!acumulado.has(f.rut)) {
      acumulado.set(f.rut, {
        rut: f.rut, nombre: f.nombre, cargo: f.cargo, tipoContrato: f.tipo_contrato,
        minTrabajadas: 0, minExtras: 0, diasCompletos: 0, diasIncompletos: 0,
      });
    }
    const acc = acumulado.get(f.rut);
    const tieneEntrada = !!f.entrada_mpg;
    const tieneSalida = !!f.salida_mpg;

    if (tieneEntrada && tieneSalida) {
      // Jornada completa: sí aporta horas al total.
      acc.minTrabajadas += horasFormatoAMinutos(f.horas_trabajadas_mpg);
      acc.minExtras += horasFormatoAMinutos(f.horas_extras_mpg);
      acc.diasCompletos++;
    } else if (tieneEntrada || tieneSalida) {
      // Marca incompleta (falta entrada o falta salida): NO se le suman 0
      // horas silenciosamente — se cuenta aparte como incidencia a revisar,
      // para que RRHH no pague de menos por un olvido de marcación.
      acc.diasIncompletos++;
    }
  }

  const resultado = [...acumulado.values()]
    .map(a => ({
      rut: a.rut,
      nombre: a.nombre,
      cargo: a.cargo,
      tipo_contrato: a.tipoContrato,
      dias_trabajados: a.diasCompletos,
      dias_incompletos: a.diasIncompletos,
      horas_trabajadas: minutosAFormato(a.minTrabajadas),
      horas_extras: minutosAFormato(a.minExtras),
    }))
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  return resultado;
}

async function exportarCierreNominaXlsx(pool, filtros) {
  const filas = await calcularCierreNomina(pool, filtros);

  const encabezado = ['RUT', 'Nombre', 'Cargo', 'Tipo Contrato', 'Días Trabajados', 'Días con Marca Incompleta (revisar)', 'Horas Trabajadas', 'Horas Extras'];
  const datos = filas.map(f => [
    f.rut, f.nombre, f.cargo, f.tipo_contrato, f.dias_trabajados, f.dias_incompletos, f.horas_trabajadas, f.horas_extras,
  ]);

  const ws = XLSX.utils.aoa_to_sheet([
    [`Cierre de Nómina — Período ${filtros.desde} a ${filtros.hasta}`],
    ['Los "Días con Marca Incompleta" NO están incluidos en las horas trabajadas — revisar antes de pagar.'],
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
    { wch: 13 }, { wch: 28 }, { wch: 26 }, { wch: 13 }, { wch: 15 }, { wch: 24 }, { wch: 16 }, { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cierre Nómina');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { calcularCierreNomina, exportarCierreNominaXlsx };