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
      origen_salida TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_resultado_rut_fecha ON resultado_diario(rut, fecha);
  `);

  return pool;
}

module.exports = { initDb };