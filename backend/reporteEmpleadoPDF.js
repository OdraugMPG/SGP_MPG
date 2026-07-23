const PDFDocument = require('pdfkit');
const {
  fusionarTurnosNocturnos, diaDeSemana, semanaISO, resolverJefeTurno, sumarDias, determinarTipoTurno,
  minutosAjusteColacion,
} = require('./importar');
const { corregirMarcasDuplicadas, horarioProgramado, horaAMinutos, minutosAHora } = require('./reporteDiario');

function etiquetaTurno(tipoTurno) {
  if (tipoTurno === 'NOCHE') return 'Noche';
  if (tipoTurno === 'PLANO') return 'Plano';
  if (tipoTurno === 'AM' || tipoTurno === 'PM') return 'Rotativo';
  return 'Sin asignar';
}

function formatoHorasMin(mins) {
  if (mins === null || mins === undefined) return null;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const ETIQUETA_ERROR = {
  doble_entrada: 'Doble marca "Entrada"',
  doble_salida: 'Doble marca "Salida"',
  sin_marca_salida_talana: 'Sin marca de salida',
};

// Arma todos los datos del mes para un trabajador (solo Talana).
async function calcularDatosReporteEmpleado(pool, rut, mes) {
  const desde = `${mes}-01`;
  const [anio, mesNum] = mes.split('-').map(Number);
  const ultimoDia = new Date(anio, mesNum, 0).getDate();
  const hasta = `${mes}-${String(ultimoDia).padStart(2, '0')}`;
  const desdeExt = sumarDias(desde, -1);
  const hastaExt = sumarDias(hasta, 1);

  const { rows: empRows } = await pool.query('SELECT * FROM empleados WHERE rut = $1', [rut]);
  if (empRows.length === 0) throw new Error('Trabajador no encontrado');
  const emp = empRows[0];

  const { rows: asigRows } = await pool.query('SELECT jefe_turno FROM jefe_turno_asignacion WHERE rut = $1', [rut]);
  const codigoJefeTurno = asigRows[0]?.jefe_turno || null;

  const { rows: talanaRows } = await pool.query(
    'SELECT fecha, hora, tipo FROM marcaciones_talana WHERE rut = $1 AND fecha BETWEEN $2 AND $3',
    [rut, desdeExt, hastaExt]
  );
  const talanaPorDiaCrudo = new Map();
  for (const r of talanaRows) {
    const key = `${rut}|${r.fecha}`;
    if (!talanaPorDiaCrudo.has(key)) talanaPorDiaCrudo.set(key, { entradas: [], salidas: [] });
    const acc = talanaPorDiaCrudo.get(key);
    const tipo = (r.tipo || '').toLowerCase();
    if (tipo === 'entrada') acc.entradas.push(r.hora);
    else if (tipo === 'salida') acc.salidas.push(r.hora);
  }
  const talanaFusionado = fusionarTurnosNocturnos(talanaPorDiaCrudo);
  for (const acc of talanaFusionado.values()) { acc.entradas.sort(); acc.salidas.sort(); }

  const { rows: rotacionRows } = await pool.query('SELECT sem, jefe_turno, dia, hora_entrada, hora_salida, rotacion_base FROM rotacion_turnos');
  const rotacionMap = new Map(rotacionRows.map(r => [`${r.sem}|${r.jefe_turno}|${r.dia}`, r]));
  const rotacionBasePorClave = new Map();
  for (const r of rotacionRows) {
    if (r.rotacion_base) rotacionBasePorClave.set(`${r.sem}|${r.jefe_turno}`, r.rotacion_base);
  }

  const { rows: ausenciaRows } = await pool.query(
    'SELECT fecha, tipo FROM ausencias_permisos WHERE rut = $1 AND fecha BETWEEN $2 AND $3',
    [rut, desde, hasta]
  );
  const ausenciaPorFecha = new Map(ausenciaRows.map(a => [a.fecha, a.tipo]));

  const filas = [];
  const logs = [];
  let f = desde;
  while (f <= hasta) {
    const key = `${rut}|${f}`;
    const talanaCruda = talanaFusionado.get(key) || { entradas: [], salidas: [] };
    const { entradas, salidas, log: logDup } = corregirMarcasDuplicadas(talanaCruda);
    if (logDup) logs.push({ fecha: f, ...logDup });

    const entrada = entradas[0] || null;
    let salida = salidas[salidas.length - 1] || null;
    let salidaSancion = false;
    if (!salida && entrada) {
      salida = minutosAHora(horaAMinutos(entrada) + 240);
      salidaSancion = true;
      logs.push({
        fecha: f, tipo_error: 'sin_marca_salida_talana',
        detalle: `Entrada ${entrada}, sin marca de salida en Talana (referencia +4h: ${salida}).`,
      });
    }

    const dia = diaDeSemana(f);
    const programado = horarioProgramado(rotacionMap, codigoJefeTurno, f);
    let atrasoMin = null;
    if (programado.entrada && entrada) {
      const diff = horaAMinutos(entrada) - horaAMinutos(programado.entrada);
      atrasoMin = diff > 0 ? diff : 0;
    }

    const tipoTurnoDia = determinarTipoTurno(codigoJefeTurno, f, rotacionBasePorClave);
    const ausencia = ausenciaPorFecha.get(f) || null;

    let horasTrabajadas = null;
    if (entrada && salida && !salidaSancion) {
      let mins = horaAMinutos(salida) - horaAMinutos(entrada);
      if (mins < 0) mins += 24 * 60;
      mins += minutosAjusteColacion(tipoTurnoDia);
      horasTrabajadas = formatoHorasMin(mins);
    }

    filas.push({
      fecha: f, dia, turno: etiquetaTurno(tipoTurnoDia),
      entrada, salida, salidaSancion, horaEsperada: programado.entrada, atrasoMin, ausencia, horasTrabajadas,
    });

    f = sumarDias(f, 1);
  }

  const resumenAusencias = {};
  for (const fila of filas) {
    if (fila.ausencia) resumenAusencias[fila.ausencia] = (resumenAusencias[fila.ausencia] || 0) + 1;
  }
  const diasConAsistencia = filas.filter(f2 => f2.entrada).length;
  const diasConAtraso = filas.filter(f2 => f2.atrasoMin > 0).length;
  const minutosAtrasoTotal = filas.reduce((acc, f2) => acc + (f2.atrasoMin || 0), 0);
  const resumenErrores = {};
  for (const l of logs) resumenErrores[l.tipo_error] = (resumenErrores[l.tipo_error] || 0) + 1;

  return {
    emp, codigoJefeTurno, mes, desde, hasta, filas, logs,
    resumen: { diasConAsistencia, diasConAtraso, minutosAtrasoTotal, resumenAusencias, resumenErrores },
  };
}

// Dibuja UNA sección (un trabajador) dentro de un documento PDF ya existente.
// Si no es la primera sección, agrega una página nueva antes de dibujar.
function dibujarSeccionEmpleado(doc, datos, esPrimera) {
  if (!esPrimera) doc.addPage();

  const { emp, codigoJefeTurno, mes, filas, logs, resumen } = datos;
  const nombreCompleto = `${emp.nombre} ${emp.apellido_paterno || ''} ${emp.apellido_materno || ''}`.trim();
  const startX = 40;

  doc.x = startX;
  doc.fontSize(15).font('Helvetica-Bold').text('Reporte Mensual de Asistencia (Talana)', { align: 'center' });
  doc.moveDown(0.7);
  doc.x = startX;
  doc.fontSize(10).font('Helvetica');
  doc.text(`Trabajador: ${nombreCompleto}`, startX);
  doc.text(`RUT: ${emp.rut}`, startX);
  doc.text(`Cargo: ${emp.cargo || '-'}`, startX);
  doc.text(`Área: ${emp.centro_costo || '-'}`, startX);
  doc.text(`Jefe de Turno: ${codigoJefeTurno || 'Sin asignar'}`, startX);
  doc.text(`Período: ${mes}`, startX);
  doc.moveDown(1);

  const cols = [
    { key: 'fecha', label: 'Fecha', width: 55 },
    { key: 'dia', label: 'Día', width: 28 },
    { key: 'turno', label: 'Turno', width: 50 },
    { key: 'entrada', label: 'Entrada', width: 46 },
    { key: 'salida', label: 'Salida', width: 46 },
    { key: 'horas', label: 'Horas', width: 40 },
    { key: 'atraso', label: 'Atraso', width: 38 },
    { key: 'obs', label: 'Observación', width: 160 },
  ];

  function dibujarEncabezadoTabla(y) {
    let x = startX;
    doc.font('Helvetica-Bold').fontSize(8.5);
    for (const c of cols) { doc.text(c.label, x, y, { width: c.width }); x += c.width; }
    doc.moveTo(startX, y + 12).lineTo(x, y + 12).stroke();
    doc.font('Helvetica').fontSize(8.5);
    return y + 16;
  }

  let y = dibujarEncabezadoTabla(doc.y);

  for (const fila of filas) {
    if (y > 760) {
      doc.addPage();
      y = dibujarEncabezadoTabla(40);
    }
    let obs = '';
    if (fila.ausencia) obs = fila.ausencia;
    else if (fila.salidaSancion) obs = 'Sin marca salida (ref. +4h)';

    const valores = {
      fecha: fila.fecha,
      dia: fila.dia,
      turno: fila.turno,
      entrada: fila.entrada || '—',
      salida: (fila.salida || '—') + (fila.salidaSancion ? ' *' : ''),
      horas: fila.horasTrabajadas || '—',
      atraso: fila.atrasoMin !== null ? String(fila.atrasoMin) : '—',
      obs,
    };
    let x = startX;
    for (const c of cols) {
      doc.text(String(valores[c.key]), x, y, { width: c.width });
      x += c.width;
    }
    y += 13;
  }

  // Clave: resetear el cursor al margen izquierdo antes de seguir con texto
  // normal. Si no se hace esto, el cursor queda "pegado" en la posición X de
  // la última columna de la tabla, y todo el resumen se ve corrido/cortado
  // a la derecha (el bug que reportaste).
  doc.x = startX;
  doc.y = y + 15;

  if (doc.y > 700) { doc.addPage(); doc.x = startX; doc.y = 40; }

  doc.font('Helvetica-Bold').fontSize(11).text('Resumen del período', startX, doc.y);
  doc.font('Helvetica').fontSize(9.5);
  doc.text(`Días con asistencia registrada: ${resumen.diasConAsistencia}`, startX);
  doc.text(`Días con atraso: ${resumen.diasConAtraso}  (total ${resumen.minutosAtrasoTotal} min)`, startX);

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text('Ausencias y permisos del período:', startX);
  doc.font('Helvetica');
  const entradasAusencias = Object.entries(resumen.resumenAusencias);
  if (entradasAusencias.length === 0) {
    doc.text('  Sin registros.', startX);
  } else {
    for (const [tipo, n] of entradasAusencias) doc.text(`  ${tipo}: ${n} día(s)`, startX);
  }

  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').text('Errores de marcación detectados (Talana):', startX);
  doc.font('Helvetica');
  if (logs.length === 0) {
    doc.text('  Sin errores detectados.', startX);
  } else {
    for (const l of logs) {
      doc.text(`  ${l.fecha} — ${ETIQUETA_ERROR[l.tipo_error] || l.tipo_error}: ${l.detalle}`, startX, doc.y, { width: 500 });
    }
  }

  doc.moveDown(1);
  doc.fontSize(7.5).fillColor('#666').text('* Hora estimada de referencia (entrada + 4 horas) por no existir marca de salida en Talana ese día.', startX);
  doc.fillColor('black');
}

function crearDocumentoPDF() {
  return new PDFDocument({ margin: 40, size: 'A4' });
}

function iniciarBufferPDF(doc) {
  return new Promise((resolve, reject) => {
    const buffers = [];
    doc.on('data', b => buffers.push(b));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });
}

async function generarReporteEmpleadoPDF(pool, rut, mes) {
  const datos = await calcularDatosReporteEmpleado(pool, rut, mes);
  const doc = crearDocumentoPDF();
  const bufferPromise = iniciarBufferPDF(doc);
  dibujarSeccionEmpleado(doc, datos, true);
  doc.end();
  return bufferPromise;
}

// Genera UN solo PDF con una sección por cada trabajador activo asignado al
// jefe de turno indicado (una hoja/sección por persona).
async function generarReportePorJefeTurnoPDF(pool, jefeTurno, mes) {
  const { rows } = await pool.query(
    `SELECT a.rut FROM jefe_turno_asignacion a
     JOIN empleados e ON e.rut = a.rut
     WHERE a.jefe_turno = $1 AND e.activo = true
     ORDER BY e.nombre`,
    [jefeTurno]
  );
  if (rows.length === 0) throw new Error('No hay trabajadores activos asignados a ese Jefe de Turno');

  const doc = crearDocumentoPDF();
  const bufferPromise = iniciarBufferPDF(doc);

  let primero = true;
  for (const { rut } of rows) {
    try {
      const datos = await calcularDatosReporteEmpleado(pool, rut, mes);
      dibujarSeccionEmpleado(doc, datos, primero);
      primero = false;
    } catch (err) {
      console.error(`No se pudo generar la sección de ${rut}:`, err.message);
    }
  }
  doc.end();
  return bufferPromise;
}

module.exports = { generarReporteEmpleadoPDF, generarReportePorJefeTurnoPDF };