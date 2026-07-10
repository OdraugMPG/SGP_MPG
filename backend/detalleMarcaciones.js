const {
  sumarDias, fusionarTurnosNocturnos, determinarTipoTurno, minutosAjusteColacion,
} = require('./importar');

function horaAMinutos(horaStr) {
  if (!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

async function generarDetalleMarcaciones(pool, filtros) {
  const { rut, desde, hasta } = filtros;

  // Se trae un día extra antes y después del rango para poder fusionar
  // correctamente los turnos Noche que cruzan medianoche en los bordes.
  const desdeExtendido = sumarDias(desde, -1);
  const hastaExtendido = sumarDias(hasta, 1);

  let sqlTalana = 'SELECT rut, fecha, hora, tipo FROM marcaciones_talana WHERE fecha BETWEEN $1 AND $2';
  const paramsTalana = [desdeExtendido, hastaExtendido];
  if (rut) { paramsTalana.push(rut); sqlTalana += ` AND rut = $${paramsTalana.length}`; }
  const { rows: talanaRows } = await pool.query(sqlTalana, paramsTalana);

  const talanaPorDiaCrudo = new Map();
  for (const r of talanaRows) {
    const key = `${r.rut}|${r.fecha}`;
    if (!talanaPorDiaCrudo.has(key)) talanaPorDiaCrudo.set(key, { entradas: [], salidas: [] });
    const acc = talanaPorDiaCrudo.get(key);
    const tipo = (r.tipo || '').toLowerCase();
    if (tipo === 'entrada') acc.entradas.push(r.hora);
    if (tipo === 'salida') acc.salidas.push(r.hora);
  }
  const talanaFusionado = fusionarTurnosNocturnos(talanaPorDiaCrudo);
  for (const acc of talanaFusionado.values()) {
    acc.entradas.sort();
    acc.salidas.sort();
  }

  let sqlCencosud = 'SELECT rut, fecha, hora_entrada, hora_salida FROM marcaciones_cencosud WHERE fecha BETWEEN $1 AND $2';
  const paramsCencosud = [desde, hasta];
  if (rut) { paramsCencosud.push(rut); sqlCencosud += ` AND rut = $${paramsCencosud.length}`; }
  const { rows: cencosudRows } = await pool.query(sqlCencosud, paramsCencosud);
  const cencosudPorClave = new Map(cencosudRows.map(r => [`${r.rut}|${r.fecha}`, r]));

  const { rows: empleados } = await pool.query('SELECT rut, nombre, apellido_paterno FROM empleados');
  const nombrePorRut = new Map(empleados.map(e => [e.rut, `${e.nombre} ${e.apellido_paterno || ''}`.trim()]));

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));

  const { rows: rotacionRows } = await pool.query(
    `SELECT DISTINCT sem, jefe_turno, rotacion_base FROM rotacion_turnos WHERE rotacion_base IS NOT NULL`
  );
  const rotacionBasePorClave = new Map(rotacionRows.map(r => [`${r.sem}|${r.jefe_turno}`, r.rotacion_base]));

  // Solo se listan las claves rut|fecha dentro del rango solicitado (el día
  // extra de antes/después solo se usó como contexto para fusionar turno noche).
  const clavesEnRango = new Set();
  for (const key of talanaFusionado.keys()) {
    const fecha = key.split('|')[1];
    if (fecha >= desde && fecha <= hasta) clavesEnRango.add(key);
  }
  for (const key of cencosudPorClave.keys()) clavesEnRango.add(key);

  const filas = [];
  for (const key of clavesEnRango) {
    const [rutFila, fecha] = key.split('|');
    const talana = talanaFusionado.get(key) || { entradas: [], salidas: [] };
    const cencosud = cencosudPorClave.get(key);

    const entradaTalana = talana.entradas[0] || null;
    const salidaTalana = talana.salidas[talana.salidas.length - 1] || null;
    const entradaCencosud = cencosud?.hora_entrada || null;
    const salidaCencosud = cencosud?.hora_salida || null;

    let diferenciaEntradaMin = null;
    if (entradaTalana && entradaCencosud) {
      diferenciaEntradaMin = horaAMinutos(entradaCencosud) - horaAMinutos(entradaTalana);
    }

    let horasTrabajadas = null;
    if (entradaTalana && salidaTalana) {
      let mins = horaAMinutos(salidaTalana) - horaAMinutos(entradaTalana);
      if (mins < 0) mins += 24 * 60;
      const codigoAsignado = jefeTurnoPorRut.get(rutFila);
      const tipoTurno = determinarTipoTurno(codigoAsignado, fecha, rotacionBasePorClave);
      mins += minutosAjusteColacion(tipoTurno);
      horasTrabajadas = Math.round((mins / 60) * 100) / 100;
    }

    filas.push({
      rut: rutFila,
      nombre: nombrePorRut.get(rutFila) || null,
      fecha,
      entrada_talana: entradaTalana,
      salida_talana: salidaTalana,
      entrada_cencosud: entradaCencosud,
      salida_cencosud: salidaCencosud,
      diferencia_entrada_min: diferenciaEntradaMin,
      horas_trabajadas: horasTrabajadas,
    });
  }

  filas.sort((a, b) => (a.fecha === b.fecha ? a.rut.localeCompare(b.rut) : b.fecha.localeCompare(a.fecha)));
  return filas.slice(0, 1000);
}

module.exports = { generarDetalleMarcaciones };