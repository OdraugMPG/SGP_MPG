const { diaDeSemana, semanaISO, resolverJefeTurno, fusionarTurnosNocturnos, determinarTipoTurno, minutosAjusteColacion, construirRotacionBasePorClave } = require('./importar');

const TOLERANCIA_MIN = 20;

function horaAMinutos(horaStr) {
  if (!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

// Resuelve la hora final de entrada o salida cuando Talana puede tener 0, 1 o
// varias marcas del mismo tipo el mismo día (marcación duplicada/errada).
//
// candidatos: array de horas 'HH:MM:SS' marcadas en Talana para ese tipo (entrada o salida)
// horaCencosud: hora de referencia de Cencosud para ese mismo movimiento (o null)
// preferido: 'primera' | 'ultima' -> cuál usar por defecto cuando no hay forma de decidir
function resolverHora(candidatos, horaCencosud, preferido) {
  if (candidatos.length === 1) {
    return { hora: candidatos[0], origen: 'talana' };
  }

  if (candidatos.length === 0) {
    if (horaCencosud) return { hora: horaCencosud, origen: 'cencosud' };
    return { hora: null, origen: null };
  }

  // Hay 2+ candidatos (marcación duplicada/errada) -> desambiguar con Cencosud
  if (horaCencosud) {
    const refMin = horaAMinutos(horaCencosud);
    let mejor = null;
    let mejorDiff = Infinity;
    for (const c of candidatos) {
      const diff = Math.abs(horaAMinutos(c) - refMin);
      if (diff < mejorDiff) { mejorDiff = diff; mejor = c; }
    }
    if (mejorDiff <= TOLERANCIA_MIN) {
      return { hora: mejor, origen: 'talana_validado' };
    }
    // Ninguna marca de Talana calza dentro de tolerancia -> usar Cencosud directo
    return { hora: horaCencosud, origen: 'cencosud' };
  }

  // Sin referencia de Cencosud: usar la primera o última marca según corresponda
  const ordenadas = [...candidatos].sort();
  const elegida = preferido === 'ultima' ? ordenadas[ordenadas.length - 1] : ordenadas[0];
  return { hora: elegida, origen: 'talana_ambiguo' };
}

// Mutex: evita que calcularResultados corra varias veces en paralelo. Si
// algo (un doble clic, una petición repetida, un timeout con reintento)
// dispara varias llamadas casi al mismo tiempo, las siguientes esperan a que
// termine la que ya está corriendo, en vez de apilarse y recalcular una y
// otra vez sin parar (que es exactamente lo que puede tardar minutos u horas
// y saturar el servidor).
let calculoEnCurso = null;

async function calcularResultados(pool) {
  if (calculoEnCurso) {
    console.log('calcularResultados ya está corriendo — esperando a que termine en vez de duplicar el trabajo...');
    return calculoEnCurso;
  }
  calculoEnCurso = calcularResultadosInterno(pool).finally(() => { calculoEnCurso = null; });
  return calculoEnCurso;
}

async function calcularResultadosInterno(pool) {
  console.log('--- Iniciando calcularResultados ---');
  console.log('Leyendo marcaciones_talana...');
  const { rows: talanaRows } = await pool.query(
    'SELECT rut, fecha, hora, tipo FROM marcaciones_talana ORDER BY rut, fecha, hora'
  );
  console.log(`  ${talanaRows.length} filas de talana leídas.`);
  const talanaPorDiaCrudo = new Map(); // key rut|fecha -> {entradas: [...], salidas: [...]}
  for (const r of talanaRows) {
    const key = `${r.rut}|${r.fecha}`;
    if (!talanaPorDiaCrudo.has(key)) talanaPorDiaCrudo.set(key, { entradas: [], salidas: [] });
    const acc = talanaPorDiaCrudo.get(key);
    const tipo = (r.tipo || '').toLowerCase();
    if (tipo === 'entrada') acc.entradas.push(r.hora);
    if (tipo === 'salida') acc.salidas.push(r.hora);
  }
  // Turno Noche cruza medianoche: la salida del día siguiente se mueve al día
  // en que la persona entró, para que quede como un único registro de turno.
  const talanaPorDia = fusionarTurnosNocturnos(talanaPorDiaCrudo);
  console.log(`  ${talanaPorDia.size} días-persona en Talana (tras fusión turno noche).`);

  console.log('Leyendo marcaciones_cencosud...');
  const { rows: cencosudRows } = await pool.query(
    'SELECT rut, fecha, hora_entrada, hora_salida, turno FROM marcaciones_cencosud'
  );
  console.log(`  ${cencosudRows.length} filas de cencosud leídas.`);
  const cencosudPorDia = new Map();
  for (const r of cencosudRows) {
    cencosudPorDia.set(`${r.rut}|${r.fecha}`, r);
  }

  console.log('Leyendo empleados, asignaciones y rotación...');
  const { rows: empleados } = await pool.query('SELECT rut, nombre, apellido_paterno FROM empleados');
  const nombrePorRut = new Map(empleados.map(e => [e.rut, `${e.nombre} ${e.apellido_paterno || ''}`.trim()]));

  const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
  const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));

  const { rows: rotacionRows } = await pool.query(
    'SELECT sem, jefe_turno, rotacion_base, dia, hora_entrada, hora_salida FROM rotacion_turnos'
  );
  const rotacionMap = new Map();
  for (const r of rotacionRows) rotacionMap.set(`${r.sem}|${r.jefe_turno}|${r.dia}`, r);
  const rotacionBasePorClave = construirRotacionBasePorClave(rotacionRows);

  const { rows: horarioPlanoRows } = await pool.query('SELECT dia, hora_entrada, hora_salida FROM horario_plano');
  const horarioPlanoMap = new Map(horarioPlanoRows.map(r => [r.dia, r]));

  const todasLasClaves = new Set([...talanaPorDia.keys(), ...cencosudPorDia.keys()]);
  console.log(`Calculando ${todasLasClaves.size} filas de resultado en memoria...`);

  // Se arman todas las filas en memoria primero (rápido, sin tocar la red),
  // y recién al final se insertan todas juntas en lotes grandes.
  const filas = [];
  for (const key of todasLasClaves) {
    const [rut, fecha] = key.split('|');
    const talana = talanaPorDia.get(key);
    const cencosud = cencosudPorDia.get(key);

    const marcoTalana = !!talana && (talana.entradas.length > 0 || talana.salidas.length > 0);
    const marcoCencosud = !!cencosud;

    let inconsistencia = null;
    if (marcoTalana && !marcoCencosud) inconsistencia = 'Marcó en Talana pero no en Cencosud';
    else if (!marcoTalana && marcoCencosud) inconsistencia = 'Marcó en Cencosud pero no en Talana';

    const entradas = talana ? talana.entradas : [];
    const salidas = talana ? talana.salidas : [];
    const cencosudEntrada = cencosud ? cencosud.hora_entrada : null;
    const cencosudSalida = cencosud ? cencosud.hora_salida : null;

    const resEntrada = resolverHora(entradas, cencosudEntrada, 'primera');
    const resSalida = resolverHora(salidas, cencosudSalida, 'ultima');

    const horaEntradaReal = resEntrada.hora;
    const horaSalidaReal = resSalida.hora;

    const dia = diaDeSemana(fecha);
    const sem = semanaISO(fecha);
    const codigoAsignado = jefeTurnoPorRut.get(rut);
    const tipoTurno = determinarTipoTurno(codigoAsignado, fecha, rotacionBasePorClave);
    const colacionMin = minutosAjusteColacion(tipoTurno);

    let horasTrabajadas = null;
    if (horaEntradaReal && horaSalidaReal) {
      let mins = horaAMinutos(horaSalidaReal) - horaAMinutos(horaEntradaReal);
      if (mins < 0) mins += 24 * 60; // turno nocturno cruza medianoche
      mins += colacionMin;
      horasTrabajadas = Math.round((mins / 60) * 100) / 100;
    }

    // Entrada/salida "crudas" de cada sistema por separado (no la versión ya
    // cruzada/validada), para el módulo de Detalle de Marcaciones.
    const entradaTalanaCruda = entradas.length > 0 ? [...entradas].sort()[0] : null;
    const salidaTalanaCruda = salidas.length > 0 ? [...salidas].sort()[salidas.length - 1] : null;

    let diferenciaEntradaMin = null;
    if (entradaTalanaCruda && cencosudEntrada) {
      diferenciaEntradaMin = horaAMinutos(entradaTalanaCruda) - horaAMinutos(cencosudEntrada);
    }

    let horaEsperada = null;
    let minutosAtraso = null;

    if (codigoAsignado === 'CG' || codigoAsignado === 'PLANO') {
      const horarioPlano = horarioPlanoMap.get(dia);
      if (horarioPlano) horaEsperada = horarioPlano.hora_entrada;
    } else if (codigoAsignado) {
      const codigoResuelto = resolverJefeTurno(codigoAsignado);
      const rot = rotacionMap.get(`${sem}|${codigoResuelto}|${dia}`);
      if (rot) horaEsperada = rot.hora_entrada;
    }

    if (horaEsperada && horaEntradaReal) {
      const diff = horaAMinutos(horaEntradaReal) - horaAMinutos(horaEsperada);
      // Tolerancia de 15 minutos: de 1 a 15 minutos de diferencia no cuenta
      // como atraso. Desde el minuto 16 en adelante, se descuenta solo el
      // EXCESO sobre esos 15 minutos de tolerancia (ej: 25 min de diferencia
      // -> 10 min de atraso para efectos de descuento).
      minutosAtraso = diff >= 16 ? diff - 15 : 0;
    }

    filas.push([
      rut, fecha, nombrePorRut.get(rut) || null,
      marcoTalana ? 1 : 0, marcoCencosud ? 1 : 0, inconsistencia,
      horaEntradaReal, horaSalidaReal, horaEsperada, minutosAtraso, horasTrabajadas,
      resEntrada.origen, resSalida.origen,
      entradaTalanaCruda, salidaTalanaCruda, cencosudEntrada, cencosudSalida,
      diferenciaEntradaMin, colacionMin,
    ]);
  }

  const COLUMNAS = 19;
  const TAMANO_LOTE = 500; // filas por INSERT (bien por debajo del límite de parámetros de Postgres)
  const totalLotes = Math.ceil(filas.length / TAMANO_LOTE);

  console.log(`Guardando ${filas.length} filas en resultado_diario (${totalLotes} lotes)...`);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Bloqueo: si otro recálculo está corriendo al mismo tiempo (ej. Talana y
    // Cencosud subidos casi juntos), este query espera a que termine el
    // primero antes de seguir, evitando que ambos borren/inserten a la vez y
    // generen filas duplicadas. El bloqueo se libera solo al hacer COMMIT/ROLLBACK.
    await client.query('SELECT pg_advisory_xact_lock(741852)');

    await client.query('DELETE FROM resultado_diario');

    for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
      const numeroLote = Math.floor(i / TAMANO_LOTE) + 1;
      const lote = filas.slice(i, i + TAMANO_LOTE);
      const valoresSql = [];
      const params = [];
      lote.forEach((fila, idx) => {
        const base = idx * COLUMNAS;
        const placeholders = fila.map((_, j) => `$${base + j + 1}`).join(',');
        valoresSql.push(`(${placeholders})`);
        params.push(...fila);
      });

      const inicio = Date.now();
      await client.query(
        `INSERT INTO resultado_diario
          (rut, fecha, nombre, marco_talana, marco_cencosud, inconsistencia,
           hora_entrada_real, hora_salida_real, hora_entrada_esperada, minutos_atraso, horas_trabajadas,
           origen_entrada, origen_salida,
           entrada_talana, salida_talana, entrada_cencosud, salida_cencosud,
           diferencia_entrada_min, colacion_min)
         VALUES ${valoresSql.join(',')}`,
        params
      );
      console.log(`  [resultado_diario] lote ${numeroLote}/${totalLotes} (${lote.length} filas) en ${Date.now() - inicio}ms`);
    }

    await client.query('COMMIT');
    console.log('--- calcularResultados terminado OK ---');
  } catch (err) {
    console.log('ERROR en calcularResultados, haciendo ROLLBACK:', err.message);
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { calcularResultados };