const { calcularDistanciaMetros } = require('./geo');

// Fecha/hora del servidor en huso de Santiago — nunca se usa la hora que
// mande el celular del trabajador (evitar que se falsifique el timestamp
// desde el propio dispositivo, justo el dato que se va a comparar con Talana
// durante el piloto).
function ahoraChile() {
  const ahora = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const partes = Object.fromEntries(fmt.formatToParts(ahora).map(p => [p.type, p.value]));
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora: `${partes.hour}:${partes.minute}:${partes.second}`,
  };
}

// Registra una marcación móvil. Rechaza (sin guardar en marcacion_movil) si
// el trabajador está fuera del radio configurado para su CD — el intento
// queda igual auditado en log_marcacion, ya existente en el sistema.
async function registrarMarcacion(pool, { rut, tipo, lat, lng, fotoBuffer, fotoMime }) {
  if (tipo !== 'entrada' && tipo !== 'salida') {
    return { ok: false, status: 400, error: "tipo debe ser 'entrada' o 'salida'" };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return { ok: false, status: 400, error: 'lat/lng inválidos' };
  }

  const { rows: empRows } = await pool.query('SELECT nombre, apellido_paterno, cd, activo FROM empleados WHERE rut = $1', [rut]);
  if (empRows.length === 0 || !empRows[0].activo) {
    return { ok: false, status: 403, error: 'Trabajador no encontrado o inactivo' };
  }
  const emp = empRows[0];
  const nombre = `${emp.nombre} ${emp.apellido_paterno || ''}`.trim();

  if (!emp.cd) {
    return { ok: false, status: 422, error: 'Tu CD no está configurado, contacta a RRHH' };
  }

  const { rows: cdRows } = await pool.query('SELECT nombre, lat, lng, radio_metros FROM cd_movil WHERE nombre = $1 AND activo = true', [emp.cd]);
  if (cdRows.length === 0) {
    return { ok: false, status: 422, error: 'Tu CD no está habilitado para marcación móvil, contacta a RRHH' };
  }
  const cd = cdRows[0];

  const distanciaM = calcularDistanciaMetros(lat, lng, cd.lat, cd.lng);
  const dentroRadio = distanciaM <= cd.radio_metros;
  const { fecha, hora } = ahoraChile();

  if (!dentroRadio) {
    await pool.query(
      `INSERT INTO log_marcacion (rut, nombre, fecha, tipo_error, detalle)
       VALUES ($1, $2, $3, 'marcacion_movil_fuera_radio', $4)`,
      [rut, nombre, fecha, `CD ${cd.nombre}: distancia ${Math.round(distanciaM)}m, radio permitido ${cd.radio_metros}m`]
    );
    return {
      ok: false, status: 422,
      error: `Estás a ${Math.round(distanciaM)}m del CD, debes estar a menos de ${cd.radio_metros}m para marcar`,
      distancia_m: Math.round(distanciaM), radio_metros: cd.radio_metros,
    };
  }

  const { rows } = await pool.query(
    `INSERT INTO marcacion_movil (rut, cd, fecha, hora, tipo, lat, lng, distancia_m, dentro_radio, foto, foto_mime)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, cd, fecha, hora, tipo, distancia_m, dentro_radio`,
    [rut, cd.nombre, fecha, hora, tipo, lat, lng, distanciaM, dentroRadio, fotoBuffer || null, fotoMime || null]
  );

  return { ok: true, marcacion: rows[0] };
}

async function listarMarcacionesPropias(pool, rut, desde, hasta) {
  const { rows } = await pool.query(
    `SELECT id, cd, fecha, hora, tipo, distancia_m, dentro_radio
     FROM marcacion_movil
     WHERE rut = $1 AND fecha BETWEEN $2 AND $3
     ORDER BY fecha DESC, hora DESC`,
    [rut, desde, hasta]
  );
  return rows;
}

async function listarCdsMovil(pool) {
  const { rows } = await pool.query('SELECT nombre, lat, lng, radio_metros, activo FROM cd_movil ORDER BY nombre');
  return rows;
}

async function crearCdMovil(pool, { nombre, lat, lng, radio_metros, adminNombre }) {
  const { rows } = await pool.query(
    `INSERT INTO cd_movil (nombre, lat, lng, radio_metros, creado_por)
     VALUES ($1,$2,$3,COALESCE($4,40),$5)
     ON CONFLICT (nombre) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, radio_metros = EXCLUDED.radio_metros
     RETURNING nombre, lat, lng, radio_metros, activo`,
    [nombre, lat, lng, radio_metros || null, adminNombre || null]
  );
  return rows[0];
}

async function actualizarCdMovil(pool, nombre, { lat, lng, radio_metros, activo }) {
  const { rows } = await pool.query(
    `UPDATE cd_movil SET
       lat = COALESCE($1, lat), lng = COALESCE($2, lng),
       radio_metros = COALESCE($3, radio_metros), activo = COALESCE($4, activo)
     WHERE nombre = $5
     RETURNING nombre, lat, lng, radio_metros, activo`,
    [lat ?? null, lng ?? null, radio_metros ?? null, activo ?? null, nombre]
  );
  return rows[0] || null;
}

async function eliminarCdMovil(pool, nombre) {
  const { rowCount } = await pool.query('DELETE FROM cd_movil WHERE nombre = $1', [nombre]);
  return rowCount > 0;
}

async function listarTrabajadoresConCredencial(pool) {
  const { rows } = await pool.query(
    `SELECT c.rut, e.nombre, e.apellido_paterno, e.cd, c.intentos_fallidos, c.bloqueado_hasta, c.actualizado_en
     FROM trabajador_credencial c
     JOIN empleados e ON e.rut = c.rut
     ORDER BY e.nombre`
  );
  return rows;
}

async function generarReporteMovil(pool, { desde, hasta, rut, cd, soloFueraRadio }) {
  const condiciones = ['m.fecha BETWEEN $1 AND $2'];
  const params = [desde, hasta];

  if (rut) { params.push(rut); condiciones.push(`m.rut = $${params.length}`); }
  if (cd) { params.push(cd); condiciones.push(`m.cd = $${params.length}`); }
  if (soloFueraRadio) condiciones.push('m.dentro_radio = false');

  const { rows } = await pool.query(
    `SELECT m.id, m.rut, e.nombre, e.apellido_paterno, m.cd, m.fecha, m.hora, m.tipo,
            m.distancia_m, m.dentro_radio, (m.foto IS NOT NULL) AS tiene_foto
     FROM marcacion_movil m
     LEFT JOIN empleados e ON e.rut = m.rut
     WHERE ${condiciones.join(' AND ')}
     ORDER BY m.fecha DESC, m.hora DESC`,
    params
  );
  return rows.map(({ apellido_paterno, ...r }) => ({
    ...r,
    nombre: r.nombre ? `${r.nombre} ${apellido_paterno || ''}`.trim() : null,
  }));
}

async function obtenerFotoMarcacion(pool, id) {
  const { rows } = await pool.query('SELECT foto, foto_mime FROM marcacion_movil WHERE id = $1', [id]);
  return rows[0] || null;
}

module.exports = {
  ahoraChile, registrarMarcacion, listarMarcacionesPropias,
  listarCdsMovil, crearCdMovil, actualizarCdMovil, eliminarCdMovil,
  listarTrabajadoresConCredencial, generarReporteMovil, obtenerFotoMarcacion,
};
