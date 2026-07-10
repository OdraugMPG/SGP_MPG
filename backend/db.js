const { Pool } = require('pg');

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
      vigente TEXT
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

  // Siembra inicial de áreas conocidas (no pisa nada si ya existen o si el
  // usuario agregó/quitó áreas después).
  const areasIniciales = [
    'OSR-EMPAQUE', 'OSR-PUTWALL', 'SH1', 'SH2', 'SH3', 'INSUMOS', 'TRASPASO', 'RECEPCION',
  ];
  for (const area of areasIniciales) {
    await pool.query('INSERT INTO areas_trabajo (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [area]);
  }

  return pool;
}

module.exports = { initDb };