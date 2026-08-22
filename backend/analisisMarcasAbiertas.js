const XLSX = require('xlsx');
const { generarDetalleMarcaciones } = require('./detalleMarcaciones');

const UMBRAL_RECURRENTE = 2; // 2+ veces en el período = recurrente

// Analiza, en el control del CLIENTE (Cencosud), los días donde un
// trabajador marcó entrada pero no marcó salida ("marca abierta"), agrupado
// por JEFE DE TURNO (no por turno AM/PM/Noche/Plano) — se agrupa así porque
// en los códigos rotativos (T_RD, T_BV) la misma persona es AM una semana y
// PM la siguiente, así que agrupar por turno diluiría el patrón; agrupar por
// jefe de turno mantiene siempre junto al mismo equipo/jefatura.
async function calcularMarcasAbiertas(pool, filtros) {
  const { desde, hasta, cds } = filtros;

  const filas = await generarDetalleMarcaciones(pool, { desde, hasta, cds }, Infinity);

  const porTrabajador = new Map(); // rut -> { rut, nombre, cargo, jefeTurno, marcasAbiertas: [{fecha, entrada}] }
  for (const f of filas) {
    if (!f.entrada_cencosud || f.salida_cencosud) continue; // solo entrada SIN salida
    if (!porTrabajador.has(f.rut)) {
      porTrabajador.set(f.rut, { rut: f.rut, nombre: f.nombre, cargo: f.cargo, jefeTurno: f.jefe_turno, marcasAbiertas: [] });
    }
    porTrabajador.get(f.rut).marcasAbiertas.push({ fecha: f.fecha, entrada: f.entrada_cencosud.slice(0, 5) });
  }

  const trabajadores = [...porTrabajador.values()]
    .map(t => ({
      rut: t.rut, nombre: t.nombre, cargo: t.cargo, jefe_turno: t.jefeTurno || 'Sin asignar',
      cantidad: t.marcasAbiertas.length,
      recurrente: t.marcasAbiertas.length >= UMBRAL_RECURRENTE,
      detalle: t.marcasAbiertas.sort((a, b) => a.fecha.localeCompare(b.fecha)),
    }))
    .sort((a, b) => b.cantidad - a.cantidad || (a.nombre || '').localeCompare(b.nombre || ''));

  // --- Resumen por Jefe de Turno (para el dashboard) ---
  const jefesTurnoPresentes = [...new Set(trabajadores.map(t => t.jefe_turno))].sort();
  const resumenPorJefeTurno = jefesTurnoPresentes.map(jefeTurno => {
    const deEsteJefe = trabajadores.filter(t => t.jefe_turno === jefeTurno);
    return {
      jefe_turno: jefeTurno,
      trabajadores_con_marca_abierta: deEsteJefe.length,
      total_marcas_abiertas: deEsteJefe.reduce((acc, t) => acc + t.cantidad, 0),
      trabajadores_recurrentes: deEsteJefe.filter(t => t.recurrente).length,
    };
  }).filter(r => r.trabajadores_con_marca_abierta > 0);

  return {
    resumen_por_jefe_turno: resumenPorJefeTurno,
    trabajadores_recurrentes: trabajadores.filter(t => t.recurrente),
    todos: trabajadores,
  };
}

async function exportarMarcasAbiertasXlsx(pool, filtros) {
  const { trabajadores } = { trabajadores: (await calcularMarcasAbiertas(pool, filtros)).todos };

  const encabezado = ['RUT', 'Nombre', 'Cargo', 'Jefe de Turno', 'N° Marcas Abiertas', '¿Recurrente?', 'Detalle de días (entrada marcada, sin salida)'];
  const datos = trabajadores.map(t => [
    t.rut, t.nombre, t.cargo, t.jefe_turno, t.cantidad, t.recurrente ? 'Sí' : 'No',
    t.detalle.map(d => `${d.fecha} (entrada ${d.entrada})`).join(' · '),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([
    [`Marcas Abiertas en Control del Cliente — ${filtros.desde} a ${filtros.hasta}`],
    [`${trabajadores.length} trabajador(es) con al menos una marca abierta`],
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
  ws['!cols'] = [{ wch: 13 }, { wch: 26 }, { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 60 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Marcas Abiertas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { calcularMarcasAbiertas, exportarMarcasAbiertasXlsx };