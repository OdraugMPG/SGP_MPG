const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { limpiarRut } = require('./importar');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRA_EN = '12h';

const MAX_INTENTOS_FALLIDOS = 5;
const MINUTOS_BLOQUEO = 15;
const LARGO_MINIMO_PIN = 4;

// Login de trabajador (RUT + PIN), separado del login de staff en auth.js —
// distinta tabla (trabajador_credencial, no usuarios) y distinto payload de
// JWT (sin 'rol', para que las rutas de admin lo rechacen automáticamente).
async function loginTrabajador(pool, rutCrudo, pin) {
  const rut = limpiarRut(rutCrudo);
  if (!rut || !pin) return { ok: false, error: 'RUT y PIN son requeridos' };

  const { rows } = await pool.query(
    `SELECT c.rut, c.pin_hash, c.intentos_fallidos, c.bloqueado_hasta,
            e.nombre, e.apellido_paterno, e.activo, e.cd
     FROM trabajador_credencial c
     JOIN empleados e ON e.rut = c.rut
     WHERE c.rut = $1`,
    [rut]
  );
  if (rows.length === 0) return { ok: false, error: 'RUT o PIN incorrectos' };

  const cred = rows[0];
  if (!cred.activo) return { ok: false, error: 'Trabajador inactivo, contacta a RRHH' };

  if (cred.bloqueado_hasta && new Date(cred.bloqueado_hasta) > new Date()) {
    return { ok: false, error: `Demasiados intentos fallidos. Intenta de nuevo después de ${new Date(cred.bloqueado_hasta).toLocaleTimeString('es-CL')}.` };
  }

  const coincide = await bcrypt.compare(String(pin), cred.pin_hash);
  if (!coincide) {
    const intentos = (cred.intentos_fallidos || 0) + 1;
    const bloquear = intentos >= MAX_INTENTOS_FALLIDOS;
    await pool.query(
      `UPDATE trabajador_credencial
       SET intentos_fallidos = $1, bloqueado_hasta = $2, actualizado_en = now()
       WHERE rut = $3`,
      [bloquear ? 0 : intentos, bloquear ? new Date(Date.now() + MINUTOS_BLOQUEO * 60000) : null, rut]
    );
    return { ok: false, error: 'RUT o PIN incorrectos' };
  }

  await pool.query(
    `UPDATE trabajador_credencial SET intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = now() WHERE rut = $1`,
    [rut]
  );

  const nombre = `${cred.nombre} ${cred.apellido_paterno || ''}`.trim();
  const token = jwt.sign(
    { rut, nombre, tipo: 'trabajador' },
    JWT_SECRET || 'secreto-temporal-inseguro',
    { expiresIn: JWT_EXPIRA_EN }
  );

  return { ok: true, token, trabajador: { rut, nombre, cd: cred.cd } };
}

// Middleware: exige un JWT de trabajador (tipo: 'trabajador'), no de staff.
// Se monta DESPUÉS de requireAuth (index.js aplica requireAuth a todo /api,
// que ya validó la firma y dejó el payload en req.usuario) — acá solo se
// verifica que el payload sea de trabajador, no de staff, y viceversa: un
// token de staff (con 'rol' pero sin 'tipo') se rechaza aunque la firma sea
// válida, evitando que una sesión de admin filtrada marque asistencia a
// nombre de otra persona.
function requireSoloTrabajador(req, res, next) {
  if (!req.usuario || req.usuario.tipo !== 'trabajador') {
    return res.status(403).json({ error: 'Este token no corresponde a un trabajador' });
  }
  req.trabajador = { rut: req.usuario.rut, nombre: req.usuario.nombre };
  next();
}

function validarPin(pin) {
  const s = String(pin || '');
  return /^\d+$/.test(s) && s.length >= LARGO_MINIMO_PIN;
}

// El propio trabajador cambia su PIN (requiere saber el actual).
async function cambiarPinPropio(pool, rut, pinActual, pinNuevo) {
  if (!validarPin(pinNuevo)) return { ok: false, error: `El PIN debe tener al menos ${LARGO_MINIMO_PIN} dígitos numéricos` };

  const { rows } = await pool.query('SELECT pin_hash FROM trabajador_credencial WHERE rut = $1', [rut]);
  if (rows.length === 0) return { ok: false, error: 'No tienes un PIN asignado, contacta a RRHH' };

  const coincide = await bcrypt.compare(String(pinActual), rows[0].pin_hash);
  if (!coincide) return { ok: false, error: 'El PIN actual no coincide' };

  const hash = await bcrypt.hash(String(pinNuevo), 10);
  await pool.query(
    `UPDATE trabajador_credencial SET pin_hash = $1, intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = now() WHERE rut = $2`,
    [hash, rut]
  );
  return { ok: true };
}

// Un admin asigna o resetea el PIN de un trabajador (ej. primera vez, o si
// se le olvidó). Crea la credencial si el trabajador todavía no tenía una.
async function asignarPin(pool, rutCrudo, pinNuevo, adminNombre) {
  const rut = limpiarRut(rutCrudo);
  if (!validarPin(pinNuevo)) return { ok: false, error: `El PIN debe tener al menos ${LARGO_MINIMO_PIN} dígitos numéricos` };

  const { rows: emp } = await pool.query('SELECT rut FROM empleados WHERE rut = $1', [rut]);
  if (emp.length === 0) return { ok: false, error: 'No existe un trabajador con ese RUT' };

  const hash = await bcrypt.hash(String(pinNuevo), 10);
  await pool.query(
    `INSERT INTO trabajador_credencial (rut, pin_hash, creado_por)
     VALUES ($1, $2, $3)
     ON CONFLICT (rut) DO UPDATE SET
       pin_hash = EXCLUDED.pin_hash, intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = now()`,
    [rut, hash, adminNombre || null]
  );
  return { ok: true };
}

module.exports = { loginTrabajador, requireSoloTrabajador, cambiarPinPropio, asignarPin };
