const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

function crearPool() {
  return new Pool({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || 'sgp_db',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    // Render Postgres requiere SSL; en local no.
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

async function initDb() {
  const pool = crearPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS empleados (
      rut TEXT PRIMARY KEY,
      nombre TEXT,
      apellido_paterno TEXT,
      apellido_materno TEXT,
      cargo TEXT,
      empresa TEXT,
      centro_costo TEXT,
      fecha_ingreso TEXT,
      turno_texto TEXT,
      jefe TEXT,
      vigente TEXT,
      activo BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS marcaciones_talana (
      id SERIAL PRIMARY KEY,
      rut TEXT,
      fecha TEXT,
      hora TEXT,
      tipo TEXT,
      sucursal TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_talana_rut_fecha ON marcaciones_talana(rut, fecha);

    CREATE TABLE IF NOT EXISTS marcaciones_cencosud (
      id SERIAL PRIMARY KEY,
      rut TEXT,
      fecha TEXT,
      hora_entrada TEXT,
      hora_salida TEXT,
      turno TEXT,
      local TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_cencosud_rut_fecha ON marcaciones_cencosud(rut, fecha);

    CREATE TABLE IF NOT EXISTS rotacion_turnos (
      id SERIAL PRIMARY KEY,
      sem INTEGER,
      jefe_turno TEXT,
      rotacion_base TEXT,
      dia TEXT,
      hora_entrada TEXT,
      hora_salida TEXT,
      colacion TEXT,
      jornada TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rotacion_lookup ON rotacion_turnos(sem, jefe_turno, dia);

    CREATE TABLE IF NOT EXISTS contrato_rut (
      rut TEXT PRIMARY KEY,
      razon_social TEXT
    );

    CREATE TABLE IF NOT EXISTS jefe_turno_asignacion (
      rut TEXT PRIMARY KEY,
      nombre TEXT,
      cargo TEXT,
      jefe_turno TEXT,
      centro_costo TEXT
    );

    CREATE TABLE IF NOT EXISTS resultado_diario (
      id SERIAL PRIMARY KEY,
      rut TEXT,
      fecha TEXT,
      nombre TEXT,
      marco_talana INTEGER,
      marco_cencosud INTEGER,
      inconsistencia TEXT,
      hora_entrada_real TEXT,
      hora_salida_real TEXT,
      hora_entrada_esperada TEXT,
      minutos_atraso INTEGER,
      horas_trabajadas REAL,
      origen_entrada TEXT,
      origen_salida TEXT,
      entrada_talana TEXT,
      salida_talana TEXT,
      entrada_cencosud TEXT,
      salida_cencosud TEXT,
      diferencia_entrada_min INTEGER,
      colacion_min INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_resultado_rut_fecha ON resultado_diario(rut, fecha);

    CREATE TABLE IF NOT EXISTS areas_trabajo (
      nombre TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS log_marcacion (
      id SERIAL PRIMARY KEY,
      rut TEXT,
      nombre TEXT,
      fecha TEXT,
      tipo_error TEXT,
      detalle TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_log_marcacion_fecha ON log_marcacion(fecha);

    CREATE TABLE IF NOT EXISTS ausencias_permisos (
      id SERIAL PRIMARY KEY,
      rut TEXT NOT NULL,
      fecha TEXT NOT NULL,
      tipo TEXT NOT NULL,
      observacion TEXT,
      creado_en TIMESTAMP DEFAULT now(),
      UNIQUE (rut, fecha)
    );
    CREATE INDEX IF NOT EXISTS idx_ausencias_rut_fecha ON ausencias_permisos(rut, fecha);

    CREATE TABLE IF NOT EXISTS documentos_respaldo (
      id SERIAL PRIMARY KEY,
      rut TEXT,
      fecha_inicio TEXT,
      fecha_fin TEXT,
      tipo TEXT,
      parentesco TEXT,
      nombre_archivo TEXT,
      mime_tipo TEXT,
      contenido BYTEA,
      observacion TEXT,
      creado_por TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      usuario TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nombre TEXT,
      rol TEXT DEFAULT 'admin',
      activo BOOLEAN DEFAULT true,
      creado_en TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS requerimiento_dotacion (
      id SERIAL PRIMARY KEY,
      cargo TEXT NOT NULL,
      turno TEXT,
      cantidad_requerida INTEGER NOT NULL,
      vigente_desde TEXT NOT NULL,
      observacion TEXT,
      creado_por TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );
  `);

  // Migración segura para bases creadas antes de agregar esta columna.
  await pool.query('ALTER TABLE rotacion_turnos ADD COLUMN IF NOT EXISTS rotacion_base TEXT');
  await pool.query(`
    ALTER TABLE resultado_diario ADD COLUMN IF NOT EXISTS entrada_talana TEXT;
    ALTER TABLE resultado_diario ADD COLUMN IF NOT EXISTS salida_talana TEXT;
    ALTER TABLE resultado_diario ADD COLUMN IF NOT EXISTS entrada_cencosud TEXT;
    ALTER TABLE resultado_diario ADD COLUMN IF NOT EXISTS salida_cencosud TEXT;
    ALTER TABLE resultado_diario ADD COLUMN IF NOT EXISTS diferencia_entrada_min INTEGER;
    ALTER TABLE resultado_diario ADD COLUMN IF NOT EXISTS colacion_min INTEGER;
  `);
  // Limpia duplicados que hayan quedado de antes (se queda con la fila de
  // mayor id, la más reciente, para cada rut+fecha), y agrega una restricción
  // que impide que se vuelvan a crear duplicados en el futuro.
  await pool.query(`
    DELETE FROM resultado_diario a USING resultado_diario b
    WHERE a.id < b.id AND a.rut = b.rut AND a.fecha = b.fecha
  `);
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'resultado_diario_rut_fecha_key'
      ) THEN
        ALTER TABLE resultado_diario ADD CONSTRAINT resultado_diario_rut_fecha_key UNIQUE (rut, fecha);
      END IF;
    END $$;
  `);

  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true');
  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS motivo_inactivo TEXT');
  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS tipo_contrato TEXT');
  await pool.query('ALTER TABLE requerimiento_dotacion ADD COLUMN IF NOT EXISTS turno TEXT');
  await pool.query('ALTER TABLE ausencias_permisos ADD COLUMN IF NOT EXISTS documento_id INTEGER REFERENCES documentos_respaldo(id)');
  await pool.query('ALTER TABLE ausencias_permisos ADD COLUMN IF NOT EXISTS parentesco TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_requerimiento_cargo_fecha ON requerimiento_dotacion(cargo, turno, vigente_desde)');

  // Siembra inicial de áreas conocidas (no pisa nada si ya existen o si el
  // usuario agregó/quitó áreas después).
  const areasIniciales = [
    'OSR-EMPAQUE', 'OSR-PUTWALL', 'SH1', 'SH2', 'SH3', 'INSUMOS', 'TRASPASO', 'RECEPCION',
  ];
  for (const area of areasIniciales) {
    await pool.query('INSERT INTO areas_trabajo (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [area]);
  }

  // Usuario administrador inicial, creado desde variables de entorno.
  // Si ya existe un usuario con ese nombre, no se hace nada (para no pisar
  // una contraseña que ya haya sido cambiada manualmente).
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    const { rows: existe } = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [process.env.ADMIN_USER]);
    if (existe.length === 0) {
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await pool.query(
        `INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ($1,$2,$3,'admin')`,
        [process.env.ADMIN_USER, hash, process.env.ADMIN_NOMBRE || 'Administrador']
      );
      console.log(`Usuario administrador "${process.env.ADMIN_USER}" creado.`);
    }
  }

  return pool;
}

module.exports = { initDb };