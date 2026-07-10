const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRA_EN = '12h';

if (!JWT_SECRET) {
  console.warn('ADVERTENCIA: no está definida la variable JWT_SECRET en .env. Usa un valor largo y aleatorio en producción.');
}

async function login(pool, usuario, password) {
  const { rows } = await pool.query(
    'SELECT id, usuario, password_hash, nombre, rol, activo FROM usuarios WHERE usuario = $1',
    [usuario]
  );
  if (rows.length === 0) return { ok: false, error: 'Usuario o contraseña incorrectos' };

  const u = rows[0];
  if (!u.activo) return { ok: false, error: 'Este usuario está deshabilitado' };

  const coincide = await bcrypt.compare(password, u.password_hash);
  if (!coincide) return { ok: false, error: 'Usuario o contraseña incorrectos' };

  const token = jwt.sign(
    { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol },
    JWT_SECRET || 'secreto-temporal-inseguro',
    { expiresIn: JWT_EXPIRA_EN }
  );

  return { ok: true, token, usuario: { usuario: u.usuario, nombre: u.nombre, rol: u.rol } };
}

// Middleware: exige un token válido en el header 'Authorization: Bearer <token>'
// (o como query param ?token=... para links de descarga directa, como el Excel).
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    req.usuario = jwt.verify(token, JWT_SECRET || 'secreto-temporal-inseguro');
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}

module.exports = { login, requireAuth };