const XLSX = require('xlsx');

// --- Helpers de formato ---

// Convierte cualquier valor de fecha de Excel (Date, string) a 'YYYY-MM-DD'
// Convierte cualquier valor de fecha de Excel (Date, string) a 'YYYY-MM-DD'.
// Importante: si la fecha viene como texto, NUNCA se usa `new Date(string)`
// directamente, porque JS interpreta por defecto en formato americano
// (MM/DD/AAAA) y eso corrompe silenciosamente fechas chilenas (DD/MM/AAAA),
// por ejemplo "08/07/2026" (8 de julio) se leería como 7 de agosto.
function toFechaISO(val) {
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    const s = val.trim();

    // Ya viene en formato ISO: '2026-07-08'
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

    // Formato chileno explícito: 'DD/MM/AAAA' o 'DD-MM-AAAA'
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const [, dd, mm, yyyy] = m;
      return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }

    // Último recurso (formatos no reconocidos arriba, ej. con nombre de mes)
    const d = new Date(s);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return s;
  }
  return null;
}

// Convierte hora (Date con solo hora, string, o fracción de día tipo Excel) a 'HH:MM:SS'.
// Descarta valores placeholder como '--' o vacíos (Cencosud los usa cuando no hay marcación).
function toHoraStr(val) {
  if (val instanceof Date) {
    return val.toTimeString().slice(0, 8);
  }
  if (typeof val === 'string') {
    const limpio = val.trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(limpio)) return limpio;
    return null; // '--', '', u otro texto que no es una hora real
  }
  return null;
}

// Día de la semana en formato abreviado español, igual a DB_Rotacion: Lun, Mar, Mié, Jue, Vie, Sáb, Dom
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function diaDeSemana(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  return DIAS[d.getDay()];
}

// Número de semana ISO (lunes a domingo) - debe coincidir con la columna "Sem" de DB_Rotacion
function semanaISO(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7; // lunes=0 ... domingo=6
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

// Alias de códigos de jefe de turno (por si en algún momento vuelven a existir
// códigos antiguos que deban tratarse como el mismo grupo que uno nuevo).
// Actualmente no hay alias activos: DB_Parametros ya usa T_BV directamente.
const ALIAS_JEFE_TURNO = {};

function resolverJefeTurno(codigo) {
  return ALIAS_JEFE_TURNO[codigo] || codigo;
}

// Determina el tipo de turno (AM/PM/NOCHE/PLANO) de un código de jefe de turno
// para una fecha dada, usando el mapa de 'rotacion_base' construido a partir
// de la tabla rotacion_turnos (key 'sem|jefe_turno' -> 'AM'|'PM'|'NOCHE').
function determinarTipoTurno(codigoJefeTurno, fecha, rotacionBasePorClave) {
  if (!codigoJefeTurno) return null;
  if (codigoJefeTurno === 'CG' || codigoJefeTurno === 'PLANO') return 'PLANO';
  const codigoResuelto = resolverJefeTurno(codigoJefeTurno);
  const sem = semanaISO(fecha);
  return rotacionBasePorClave.get(`${sem}|${codigoResuelto}`) || null;
}

// Minutos de colación a aplicar sobre el total de horas trabajadas, según el
// tipo de turno. Turno Noche: la colación es a mitad de jornada (está dentro
// del rango marcado) -> se RESTA para obtener horas efectivas reales.
// Turno AM/PM/Plano: la colación es al final del turno (la persona marca
// salida antes de que termine oficialmente) -> se SUMA para completar el
// total de horas pagadas.
function minutosAjusteColacion(tipoTurno) {
  if (tipoTurno === 'NOCHE') return -60;
  if (tipoTurno === 'AM' || tipoTurno === 'PM' || tipoTurno === 'PLANO') return 30;
  return 0;
}

// Suma (o resta, con delta negativo) días a una fecha 'YYYY-MM-DD'
function sumarDias(fechaISO, delta) {
  const d = new Date(fechaISO + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function horaAMinutos(horaStr) {
  if (!horaStr) return null;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

// Umbral: una salida marcada antes de esta hora se considera el cierre del
// turno Noche que empezó el día anterior (no una salida del turno de hoy).
const UMBRAL_MADRUGADA_MIN = 12 * 60; // 12:00

// Fusiona turnos que cruzan medianoche (turno Noche): si un día tiene una
// salida de madrugada (antes de las 12:00) y el día anterior tiene una
// entrada sin cerrar, esa salida pertenece al turno que comenzó el día
// anterior — sin importar si el día actual TAMBIÉN tiene su propia entrada
// nueva (caso típico de alguien que hace turno Noche varios días seguidos:
// cada día cierra el turno de ayer en la madrugada y abre uno nuevo en la
// noche).
function fusionarTurnosNocturnos(talanaPorDia) {
  const fusionado = new Map();
  for (const [key, val] of talanaPorDia) {
    fusionado.set(key, { entradas: [...val.entradas], salidas: [...val.salidas] });
  }

  for (const key of [...fusionado.keys()]) {
    const [rut, fecha] = key.split('|');
    const val = fusionado.get(key);
    if (val.salidas.length === 0) continue;

    const salidasMadrugada = val.salidas.filter(s => horaAMinutos(s) < UMBRAL_MADRUGADA_MIN);
    if (salidasMadrugada.length === 0) continue;

    const keyAnterior = `${rut}|${sumarDias(fecha, -1)}`;
    if (!fusionado.has(keyAnterior)) continue;

    const anterior = fusionado.get(keyAnterior);
    if (anterior.entradas.length === 0) continue; // no hay turno abierto ayer para cerrar

    anterior.salidas = [...anterior.salidas, ...salidasMadrugada].sort();
    val.salidas = val.salidas.filter(s => !salidasMadrugada.includes(s));

    if (val.entradas.length === 0 && val.salidas.length === 0) {
      fusionado.delete(key);
    }
  }

  return fusionado;
}

// --- Parsers ---

function leerHojas(path) {
  return XLSX.readFile(path, { cellDates: true });
}

function parseTalana(path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows.map(r => ({
    rut: limpiarRut(r['Rut']),
    fecha: toFechaISO(r['Fecha']),
    hora: toHoraStr(r['Hora']),
    tipo: (r['Dirección'] || '').trim(), // ojo: esta columna trae 'Entrada'/'Salida'
    sucursal: r['Sucursal'] || null,
    razon_social: r['Razón Social'] || null,
  })).filter(r => r.rut && r.fecha && r.hora);
}

// Normaliza un RUT quitando puntos y espacios, dejando 'NNNNNNNN-D'.
// Acepta tanto '1.123.123-1' como '11231231' (sin guion, si acaso) y los
// deja en el mismo formato que usa el resto del sistema.
function limpiarRut(val) {
  if (!val) return '';
  let s = val.toString().trim().toUpperCase().replace(/\./g, '').replace(/\s/g, '');
  if (!s.includes('-') && s.length > 1) {
    s = `${s.slice(0, -1)}-${s.slice(-1)}`;
  }
  return s;
}

function parseCencosud(path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows.map(r => ({
    rut: limpiarRut(r['RUT']),
    fecha: toFechaISO(r['FECHA']),
    hora_entrada: toHoraStr(r['HENTRADA']),
    hora_salida: toHoraStr(r['HSALIDA']),
    turno: r['TURNO'] || null,
    local: r['LOCAL'] || null,
  })).filter(r => r.rut && r.fecha);
}

function parseMaestro(path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows.map(r => ({
    rut: limpiarRut(r['RUT']),
    nombre: r['Nombre'] || '',
    apellido_paterno: r['Apellido Paterno'] || '',
    apellido_materno: r['Apellido Materno'] || '',
    cargo: r['Cargo'] || '',
    empresa: r['Razón Social'] || '',
    centro_costo: r['Nombre Centro Costo 1'] || '',
    fecha_ingreso: toFechaISO(r['Fecha de Ingreso']),
    vigente: r['Vigente'] || null,
  })).filter(r => r.rut);
}

function parseRotacion(path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets['DB_Rotacion'];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows.map(r => ({
    sem: Number(r['Sem']),
    jefe_turno: r['Jefe Turno'],
    rotacion_base: r['Rotacion Base'] || null, // 'AM' | 'PM' | 'NOCHE'
    dia: r['Dia'],
    hora_entrada: toHoraStr(r['Entrada']),
    hora_salida: toHoraStr(r['Salida']),
    colacion: toHoraStr(r['Colación']),
    jornada: toHoraStr(r['Jornada']),
  })).filter(r => r.sem && r.jefe_turno && r.dia);
}

function parseAsignacion(path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets['Asignacion_Jt'];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows.map(r => ({
    rut: limpiarRut(r['RUT']),
    nombre: r['NOMBRE Y APELLIDO'] || '',
    cargo: r['CARGO'] || '',
    jefe_turno: r['Jefe de Turno'] || null,
    centro_costo: r['AREA'] || null,
  })).filter(r => r.rut);
}

// Mapeo de Razón Social (columna C de DB_Talana) a la sigla de contrato que va en el reporte final
const CONTRATO_POR_RAZON_SOCIAL = {
  'Manpower Servicios Integrales SpA.': 'OUT',
  'Manpower Empresa de Servicios Transitorios Ltda.': 'SSTT',
};

function contratoDesdeRazonSocial(razonSocial) {
  return CONTRATO_POR_RAZON_SOCIAL[razonSocial] || null;
}

// --- Carga a base de datos (PostgreSQL, asíncrono) ---

// Inserta 'filas' (array de arrays, mismo orden que 'columnas') en lotes grandes
// en vez de una consulta por fila, para que cargas de miles de registros tomen
// segundos en vez de minutos/horas contra una base remota.
async function insertarEnLote(client, tabla, columnas, filas, onConflictSql = '', tamanoLote = 500) {
  if (filas.length === 0) return;
  const nCols = columnas.length;
  const totalLotes = Math.ceil(filas.length / tamanoLote);

  for (let i = 0; i < filas.length; i += tamanoLote) {
    const numeroLote = Math.floor(i / tamanoLote) + 1;
    const lote = filas.slice(i, i + tamanoLote);
    const valoresSql = [];
    const params = [];
    lote.forEach((fila, idx) => {
      const base = idx * nCols;
      const placeholders = fila.map((_, j) => `$${base + j + 1}`).join(',');
      valoresSql.push(`(${placeholders})`);
      params.push(...fila);
    });

    const inicio = Date.now();
    await client.query(
      `INSERT INTO ${tabla} (${columnas.join(',')}) VALUES ${valoresSql.join(',')} ${onConflictSql}`,
      params
    );
    const ms = Date.now() - inicio;
    console.log(`  [${tabla}] lote ${numeroLote}/${totalLotes} (${lote.length} filas) en ${ms}ms`);
  }
}

async function cargarTodo(pool, paths) {
  console.log('--- Iniciando cargarTodo ---');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Borrando tablas...');
    await client.query('DELETE FROM marcaciones_talana');
    await client.query('DELETE FROM marcaciones_cencosud');
    await client.query('DELETE FROM rotacion_turnos');
    await client.query('DELETE FROM jefe_turno_asignacion');
    await client.query('DELETE FROM contrato_rut');
    console.log('Tablas borradas.');

    if (paths.maestro) {
      console.log('Cargando maestro...');
      const empleadosParseados = parseMaestro(paths.maestro);
      // El archivo puede traer el mismo RUT más de una vez (distintos contratos/CDs).
      // Nos quedamos con el último registro de cada persona para evitar que el
      // INSERT en lote falle por intentar actualizar la misma fila dos veces.
      const porRut = new Map();
      for (const e of empleadosParseados) porRut.set(e.rut, e);
      const filas = [...porRut.values()].map(e => [
        e.rut, e.nombre, e.apellido_paterno, e.apellido_materno, e.cargo, e.empresa, e.centro_costo, e.fecha_ingreso, e.vigente,
      ]);
      console.log(`Maestro: ${empleadosParseados.length} filas parseadas, ${filas.length} RUT únicos, insertando...`);
      await insertarEnLote(
        client, 'empleados',
        ['rut', 'nombre', 'apellido_paterno', 'apellido_materno', 'cargo', 'empresa', 'centro_costo', 'fecha_ingreso', 'vigente'],
        filas,
        `ON CONFLICT (rut) DO UPDATE SET
           nombre=EXCLUDED.nombre, apellido_paterno=EXCLUDED.apellido_paterno, apellido_materno=EXCLUDED.apellido_materno,
           cargo=EXCLUDED.cargo, empresa=EXCLUDED.empresa, centro_costo=EXCLUDED.centro_costo,
           fecha_ingreso=EXCLUDED.fecha_ingreso, vigente=EXCLUDED.vigente`
      );
      console.log('Maestro insertado.');
    }

    if (paths.talana) {
      console.log('Cargando talana...');
      const marcacionesTalana = parseTalana(paths.talana);
      console.log(`Talana: ${marcacionesTalana.length} filas parseadas, insertando...`);
      const filas = marcacionesTalana.map(m => [m.rut, m.fecha, m.hora, m.tipo, m.sucursal]);
      await insertarEnLote(client, 'marcaciones_talana', ['rut', 'fecha', 'hora', 'tipo', 'sucursal'], filas);
      console.log('Talana insertado.');

      const razonPorRut = new Map();
      for (const m of marcacionesTalana) if (m.razon_social) razonPorRut.set(m.rut, m.razon_social);
      const filasContrato = [...razonPorRut.entries()].map(([rut, razon_social]) => [rut, razon_social]);
      await insertarEnLote(
        client, 'contrato_rut', ['rut', 'razon_social'], filasContrato,
        `ON CONFLICT (rut) DO UPDATE SET razon_social=EXCLUDED.razon_social`
      );
      console.log('Contrato_rut insertado.');
    }

    if (paths.cencosud) {
      console.log('Cargando cencosud...');
      const filas = parseCencosud(paths.cencosud).map(m => [m.rut, m.fecha, m.hora_entrada, m.hora_salida, m.turno, m.local]);
      console.log(`Cencosud: ${filas.length} filas parseadas, insertando...`);
      await insertarEnLote(client, 'marcaciones_cencosud', ['rut', 'fecha', 'hora_entrada', 'hora_salida', 'turno', 'local'], filas);
      console.log('Cencosud insertado.');
    }

    if (paths.parametros) {
      console.log('Cargando parametros...');
      const filas = parseRotacion(paths.parametros).map(r => [r.sem, r.jefe_turno, r.rotacion_base, r.dia, r.hora_entrada, r.hora_salida, r.colacion, r.jornada]);
      await insertarEnLote(client, 'rotacion_turnos', ['sem', 'jefe_turno', 'rotacion_base', 'dia', 'hora_entrada', 'hora_salida', 'colacion', 'jornada'], filas);
      console.log('Parametros insertado.');
    }

    if (paths.asignacion) {
      console.log('Cargando asignacion...');
      const asignacionesParseadas = parseAsignacion(paths.asignacion);
      const porRut = new Map();
      for (const a of asignacionesParseadas) porRut.set(a.rut, a);
      const filas = [...porRut.values()].map(a => [a.rut, a.nombre, a.cargo, a.jefe_turno, a.centro_costo]);
      await insertarEnLote(
        client, 'jefe_turno_asignacion', ['rut', 'nombre', 'cargo', 'jefe_turno', 'centro_costo'], filas,
        `ON CONFLICT (rut) DO UPDATE SET nombre=EXCLUDED.nombre, cargo=EXCLUDED.cargo,
           jefe_turno=EXCLUDED.jefe_turno, centro_costo=EXCLUDED.centro_costo`
      );
      console.log('Asignacion insertado.');
    }

    console.log('Haciendo COMMIT...');
    await client.query('COMMIT');
    console.log('--- cargarTodo terminado OK ---');
  } catch (err) {
    console.log('ERROR, haciendo ROLLBACK:', err.message);
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Carga incremental (para actualizaciones diarias de Talana/Cencosud) ---
// Reemplaza SOLO los días que vienen en el archivo subido, sin tocar el resto
// del historial ni las otras tablas (empleados, rotación, asignación).

async function cargarTalanaIncremental(pool, path) {
  const marcaciones = parseTalana(path);
  const fechas = [...new Set(marcaciones.map(m => m.fecha))];
  if (fechas.length === 0) return { fechas: [], filas: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of fechas) {
      await client.query('DELETE FROM marcaciones_talana WHERE fecha = $1', [f]);
    }

    const filas = marcaciones.map(m => [m.rut, m.fecha, m.hora, m.tipo, m.sucursal]);
    await insertarEnLote(client, 'marcaciones_talana', ['rut', 'fecha', 'hora', 'tipo', 'sucursal'], filas);

    const razonPorRut = new Map();
    for (const m of marcaciones) if (m.razon_social) razonPorRut.set(m.rut, m.razon_social);
    const filasContrato = [...razonPorRut.entries()].map(([rut, razon_social]) => [rut, razon_social]);
    await insertarEnLote(
      client, 'contrato_rut', ['rut', 'razon_social'], filasContrato,
      `ON CONFLICT (rut) DO UPDATE SET razon_social=EXCLUDED.razon_social`
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { fechas, filas: marcaciones.length };
}

async function cargarCencosudIncremental(pool, path) {
  const marcaciones = parseCencosud(path);
  const fechas = [...new Set(marcaciones.map(m => m.fecha))];
  if (fechas.length === 0) return { fechas: [], filas: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const f of fechas) {
      await client.query('DELETE FROM marcaciones_cencosud WHERE fecha = $1', [f]);
    }

    const filas = marcaciones.map(m => [m.rut, m.fecha, m.hora_entrada, m.hora_salida, m.turno, m.local]);
    await insertarEnLote(client, 'marcaciones_cencosud', ['rut', 'fecha', 'hora_entrada', 'hora_salida', 'turno', 'local'], filas);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { fechas, filas: marcaciones.length };
}

// Marca como activos SOLO los RUTs que vienen en el archivo (una columna con
// los RUTs vigentes), y como inactivos a todos los demás. Acepta un archivo
// con encabezado 'RUT' (recomendado) o, si no lo encuentra, usa la primera
// columna de la primera hoja.
async function activarEmpleadosDesdeArchivo(pool, path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

  let ruts;
  if (rows.length > 0 && ('RUT' in rows[0] || 'Rut' in rows[0] || 'rut' in rows[0])) {
    const clave = 'RUT' in rows[0] ? 'RUT' : ('Rut' in rows[0] ? 'Rut' : 'rut');
    ruts = rows.map(r => limpiarRut(r[clave]));
  } else {
    // sin encabezado reconocible: usa la primera columna de cada fila
    ruts = rows.map(r => limpiarRut(Object.values(r)[0]));
  }
  ruts = [...new Set(ruts.filter(Boolean))];

  const { rows: resultado } = await pool.query(
    `UPDATE empleados SET activo = (rut = ANY($1::text[])) RETURNING rut, activo`,
    [ruts]
  );

  const activados = resultado.filter(r => r.activo).length;
  const desactivados = resultado.filter(r => !r.activo).length;

  return { ruts_en_archivo: ruts.length, activados, desactivados, total: resultado.length };
}

// Actualiza el área (centro de costo) de cada trabajador según un archivo con
// columnas RUT y ÁREA. Solo toca a los RUTs que vienen en el archivo; no
// afecta a nadie más. Las áreas nuevas que aparezcan se agregan automáticamente
// a la lista de áreas disponibles.
async function actualizarAreasDesdeArchivo(pool, path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });

  const pares = rows
    .map(r => {
      const rutRaw = r['RUT'] ?? r['Rut'] ?? r['rut'] ?? Object.values(r)[0];
      const areaRaw = r['AREA'] ?? r['ÁREA'] ?? r['Area'] ?? r['Área'] ?? r['area'] ?? Object.values(r)[1];
      return {
        rut: limpiarRut(rutRaw),
        area: (areaRaw || '').toString().trim().toUpperCase(),
      };
    })
    .filter(p => p.rut && p.area);

  const ruts = pares.map(p => p.rut);
  const areasValues = pares.map(p => p.area);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const areasUnicas = [...new Set(areasValues)];
    for (const area of areasUnicas) {
      await client.query('INSERT INTO areas_trabajo (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [area]);
    }

    const { rows: resultado } = await client.query(
      `UPDATE empleados e SET centro_costo = d.area
       FROM (SELECT unnest($1::text[]) AS rut, unnest($2::text[]) AS area) d
       WHERE e.rut = d.rut
       RETURNING e.rut`,
      [ruts, areasValues]
    );

    await client.query('COMMIT');
    return {
      filas_en_archivo: pares.length,
      actualizados: resultado.length,
      areas_nuevas: areasUnicas.length,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  parseTalana, parseCencosud, parseMaestro, parseRotacion, parseAsignacion,
  cargarTodo, cargarTalanaIncremental, cargarCencosudIncremental,
  diaDeSemana, semanaISO, resolverJefeTurno, toFechaISO, toHoraStr,
  contratoDesdeRazonSocial, sumarDias, fusionarTurnosNocturnos, limpiarRut,
  activarEmpleadosDesdeArchivo, actualizarAreasDesdeArchivo,
  determinarTipoTurno, minutosAjusteColacion,
};