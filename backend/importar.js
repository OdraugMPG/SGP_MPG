const XLSX = require('xlsx');

// --- Helpers de formato ---

// Convierte cualquier valor de fecha de Excel (Date, string) a 'YYYY-MM-DD'
function toFechaISO(val) {
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'string') {
    // ya viene como '2026-04-01' o similar
    const d = new Date(val);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
    return val;
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

// Suma (o resta, con delta negativo) días a una fecha 'YYYY-MM-DD'
function sumarDias(fechaISO, delta) {
  const d = new Date(fechaISO + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Fusiona turnos que cruzan medianoche (turno Noche): si un día no tiene
// ninguna marca de ENTRADA pero sí de SALIDA, y el día calendario anterior
// para el mismo rut sí tiene entrada registrada, esa salida en realidad
// pertenece al turno que comenzó el día anterior. Se mueve ahí y se elimina
// el día "fantasma" para que no aparezca como un registro aparte.
//
// talanaPorDia: Map con key 'rut|fecha' -> { entradas: [...], salidas: [...] }
function fusionarTurnosNocturnos(talanaPorDia) {
  const fusionado = new Map();
  for (const [key, val] of talanaPorDia) {
    fusionado.set(key, { entradas: [...val.entradas], salidas: [...val.salidas] });
  }

  for (const key of [...fusionado.keys()]) {
    const [rut, fecha] = key.split('|');
    const val = fusionado.get(key);
    if (val.entradas.length === 0 && val.salidas.length > 0) {
      const keyAnterior = `${rut}|${sumarDias(fecha, -1)}`;
      if (fusionado.has(keyAnterior)) {
        const anterior = fusionado.get(keyAnterior);
        anterior.salidas = [...anterior.salidas, ...val.salidas].sort();
        fusionado.delete(key);
      }
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
    rut: (r['Rut'] || '').trim(),
    fecha: toFechaISO(r['Fecha']),
    hora: toHoraStr(r['Hora']),
    tipo: (r['Dirección'] || '').trim(), // ojo: esta columna trae 'Entrada'/'Salida'
    sucursal: r['Sucursal'] || null,
    razon_social: r['Razón Social'] || null,
  })).filter(r => r.rut && r.fecha && r.hora);
}

function parseCencosud(path) {
  const wb = leerHojas(path);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
  return rows.map(r => ({
    rut: (r['RUT'] || '').trim(),
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
    rut: (r['RUT'] || '').trim(),
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
    rut: (r['RUT'] || '').trim(),
    nombre: r['NOMBRE Y APELLIDO'] || '',
    cargo: r['CARGO'] || '',
    jefe_turno: r['Jefe de Turno'] || null,
    centro_costo: r['AREA'] || null,
  })).filter(r => r.rut);
}

// Mapeo de Razón Social (columna C de DB_Talana) a la sigla de contrato que va en el reporte final
const CONTRATO_POR_RAZON_SOCIAL = {
  'Manpower Servicios Integrales SpA.': 'OUT',
  'Manpower Empresa de Servicios Transitorios Ltda.': 'EST',
};

function contratoDesdeRazonSocial(razonSocial) {
  return CONTRATO_POR_RAZON_SOCIAL[razonSocial] || null;
}

// --- Carga a base de datos (PostgreSQL, asíncrono) ---

async function cargarTodo(pool, paths) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query('DELETE FROM marcaciones_talana');
    await client.query('DELETE FROM marcaciones_cencosud');
    await client.query('DELETE FROM rotacion_turnos');
    await client.query('DELETE FROM jefe_turno_asignacion');
    await client.query('DELETE FROM contrato_rut');

    if (paths.maestro) {
      for (const e of parseMaestro(paths.maestro)) {
        await client.query(
          `INSERT INTO empleados (rut, nombre, apellido_paterno, apellido_materno, cargo, empresa, centro_costo, fecha_ingreso, vigente)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (rut) DO UPDATE SET
             nombre=EXCLUDED.nombre, apellido_paterno=EXCLUDED.apellido_paterno, apellido_materno=EXCLUDED.apellido_materno,
             cargo=EXCLUDED.cargo, empresa=EXCLUDED.empresa, centro_costo=EXCLUDED.centro_costo,
             fecha_ingreso=EXCLUDED.fecha_ingreso, vigente=EXCLUDED.vigente`,
          [e.rut, e.nombre, e.apellido_paterno, e.apellido_materno, e.cargo, e.empresa, e.centro_costo, e.fecha_ingreso, e.vigente]
        );
      }
    }

    if (paths.talana) {
      const marcacionesTalana = parseTalana(paths.talana);
      for (const m of marcacionesTalana) {
        await client.query(
          `INSERT INTO marcaciones_talana (rut, fecha, hora, tipo, sucursal) VALUES ($1,$2,$3,$4,$5)`,
          [m.rut, m.fecha, m.hora, m.tipo, m.sucursal]
        );
      }
      const razonPorRut = new Map();
      for (const m of marcacionesTalana) if (m.razon_social) razonPorRut.set(m.rut, m.razon_social);
      for (const [rut, razon_social] of razonPorRut) {
        await client.query(
          `INSERT INTO contrato_rut (rut, razon_social) VALUES ($1,$2)
           ON CONFLICT (rut) DO UPDATE SET razon_social=EXCLUDED.razon_social`,
          [rut, razon_social]
        );
      }
    }

    if (paths.cencosud) {
      for (const m of parseCencosud(paths.cencosud)) {
        await client.query(
          `INSERT INTO marcaciones_cencosud (rut, fecha, hora_entrada, hora_salida, turno, local) VALUES ($1,$2,$3,$4,$5,$6)`,
          [m.rut, m.fecha, m.hora_entrada, m.hora_salida, m.turno, m.local]
        );
      }
    }

    if (paths.parametros) {
      for (const r of parseRotacion(paths.parametros)) {
        await client.query(
          `INSERT INTO rotacion_turnos (sem, jefe_turno, dia, hora_entrada, hora_salida, colacion, jornada) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [r.sem, r.jefe_turno, r.dia, r.hora_entrada, r.hora_salida, r.colacion, r.jornada]
        );
      }
    }

    if (paths.asignacion) {
      for (const a of parseAsignacion(paths.asignacion)) {
        await client.query(
          `INSERT INTO jefe_turno_asignacion (rut, nombre, cargo, jefe_turno, centro_costo) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (rut) DO UPDATE SET nombre=EXCLUDED.nombre, cargo=EXCLUDED.cargo,
             jefe_turno=EXCLUDED.jefe_turno, centro_costo=EXCLUDED.centro_costo`,
          [a.rut, a.nombre, a.cargo, a.jefe_turno, a.centro_costo]
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
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
    for (const m of marcaciones) {
      await client.query(
        `INSERT INTO marcaciones_talana (rut, fecha, hora, tipo, sucursal) VALUES ($1,$2,$3,$4,$5)`,
        [m.rut, m.fecha, m.hora, m.tipo, m.sucursal]
      );
    }
    const razonPorRut = new Map();
    for (const m of marcaciones) if (m.razon_social) razonPorRut.set(m.rut, m.razon_social);
    for (const [rut, razon_social] of razonPorRut) {
      await client.query(
        `INSERT INTO contrato_rut (rut, razon_social) VALUES ($1,$2)
         ON CONFLICT (rut) DO UPDATE SET razon_social=EXCLUDED.razon_social`,
        [rut, razon_social]
      );
    }
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
    for (const m of marcaciones) {
      await client.query(
        `INSERT INTO marcaciones_cencosud (rut, fecha, hora_entrada, hora_salida, turno, local) VALUES ($1,$2,$3,$4,$5,$6)`,
        [m.rut, m.fecha, m.hora_entrada, m.hora_salida, m.turno, m.local]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { fechas, filas: marcaciones.length };
}

module.exports = {
  parseTalana, parseCencosud, parseMaestro, parseRotacion, parseAsignacion,
  cargarTodo, cargarTalanaIncremental, cargarCencosudIncremental,
  diaDeSemana, semanaISO, resolverJefeTurno, toFechaISO, toHoraStr,
  contratoDesdeRazonSocial, sumarDias, fusionarTurnosNocturnos,
};