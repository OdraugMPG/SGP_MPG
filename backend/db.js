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
      activo BOOLEAN DEFAULT true,
      cd TEXT
    );

    CREATE TABLE IF NOT EXISTS cd_sucursal (
      sucursal TEXT PRIMARY KEY,
      cd TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS horario_plano (
      dia TEXT PRIMARY KEY,
      hora_entrada TEXT NOT NULL,
      hora_salida TEXT NOT NULL
    );

    -- Autorización de horas extras ANTICIPADAS (entrada antes del horario
    -- esperado) — sin flujo de solicitud/aprobación, un único botón
    -- "Autorizar" habilitado para el módulo 'horasExtras' completo.
    CREATE TABLE IF NOT EXISTS horas_extras_autorizacion (
      rut TEXT NOT NULL,
      fecha TEXT NOT NULL,
      autorizado BOOLEAN DEFAULT false,
      autorizado_por TEXT,
      autorizado_en TIMESTAMP,
      observacion TEXT,
      PRIMARY KEY (rut, fecha)
    );

    -- Autorización de horas extras ORDINARIAS (minutos trabajados después de
    -- la hora de salida esperada) — sí tiene flujo de solicitud/aprobación:
    -- el Jefe de Turno solicita (permiso 'horasExtrasSolicitar'), el Jefe de
    -- Operaciones o un admin aprueba/rechaza (permiso 'horasExtrasAprobar').
    -- Sin fila para un rut+fecha = "pendiente" (nadie ha hecho nada todavía).
    CREATE TABLE IF NOT EXISTS horas_extras_ordinarias_autorizacion (
      rut TEXT NOT NULL,
      fecha TEXT NOT NULL,
      estado TEXT NOT NULL, -- 'solicitado' | 'autorizado' | 'rechazado'
      solicitado_por TEXT,
      solicitado_en TIMESTAMP,
      observacion_solicitud TEXT,
      resuelto_por TEXT,
      resuelto_en TIMESTAMP,
      observacion_resolucion TEXT,
      PRIMARY KEY (rut, fecha)
    );

    -- Registro de embarazo / fuero maternal (Art. 201 Código del Trabajo).
    -- Dato sensible: acceso restringido al módulo "fueroMaternal" (RRHH/admin
    -- por defecto), y usado para bloquear desvinculaciones sin autorización
    -- judicial mientras el fuero esté vigente.
    CREATE TABLE IF NOT EXISTS fuero_maternal (
      id SERIAL PRIMARY KEY,
      rut TEXT NOT NULL,
      fecha_probable_parto TEXT,
      fecha_inicio_fuero TEXT NOT NULL,
      fecha_termino_fuero TEXT,
      fecha_parto_real TEXT,
      restriccion_turno BOOLEAN DEFAULT false,
      observaciones TEXT,
      registrado_por TEXT,
      registrado_en TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_fuero_maternal_rut ON fuero_maternal(rut);

    -- Calendario de feriados de Chile, usado para no exigir dotación en
    -- Indicadores/Dashboard en un feriado (igual que un domingo), y para que
    -- el turno Noche descanse el día previo al feriado.
    CREATE TABLE IF NOT EXISTS feriados (
      fecha TEXT PRIMARY KEY,
      nombre TEXT NOT NULL,
      irrenunciable BOOLEAN DEFAULT false,
      creado_por TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );

    -- Cartas de amonestación: se guarda tanto el detalle del causal como el
    -- PDF ya generado (como bytea, para que quede disponible en la ficha del
    -- trabajador sin depender del sistema de archivos del servidor, que no
    -- es persistente entre despliegues).
    CREATE TABLE IF NOT EXISTS amonestaciones (
      id SERIAL PRIMARY KEY,
      rut TEXT NOT NULL,
      fecha TEXT NOT NULL,
      motivo TEXT,
      causal TEXT NOT NULL,
      direccion TEXT,
      comuna TEXT,
      pdf_contenido BYTEA,
      docx_contenido BYTEA,
      generado_por TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_amonestaciones_rut ON amonestaciones(rut);

    -- Catálogo reutilizable de Motivo -> Causal, para no redactar el mismo
    -- texto cada vez en casos que se repiten (ej: atrasos reiterados).
    CREATE TABLE IF NOT EXISTS motivos_amonestacion (
      id SERIAL PRIMARY KEY,
      motivo TEXT NOT NULL UNIQUE,
      causal TEXT NOT NULL,
      autocompletar_atrasos BOOLEAN DEFAULT false,
      creado_por TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );

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

    CREATE TABLE IF NOT EXISTS cargos_requerimiento (
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

    CREATE TABLE IF NOT EXISTS roles (
      nombre TEXT PRIMARY KEY,
      modulos TEXT[] DEFAULT '{}',
      es_sistema BOOLEAN DEFAULT false,
      creado_en TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS requerimiento_dotacion (
      id SERIAL PRIMARY KEY,
      cargo TEXT NOT NULL,
      turno TEXT,
      cd TEXT,
      cantidad_requerida INTEGER NOT NULL,
      vigente_desde TEXT NOT NULL,
      vigente_hasta TEXT,
      observacion TEXT,
      creado_por TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );

    -- Informes generados por el agente de IA (rotación de personal +
    -- ausentismo recurrente). Se guarda tanto la narrativa como los datos
    -- de respaldo que se le entregaron al modelo, para poder revisar
    -- informes anteriores sin volver a llamar a la API.
    CREATE TABLE IF NOT EXISTS informes_ia (
      id SERIAL PRIMARY KEY,
      periodo TEXT NOT NULL,
      narrativa TEXT NOT NULL,
      datos JSONB NOT NULL,
      generado_por TEXT,
      creado_en TIMESTAMP DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_informes_ia_creado ON informes_ia(creado_en DESC);
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
  await pool.query("ALTER TABLE empleados ADD COLUMN IF NOT EXISTS motivo_termino TEXT"); // 'R' (Renuncia Voluntaria) o 'Des' (Desvinculación Art. 161)
  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS fecha_termino TEXT');
  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS tipo_contrato TEXT');
  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS direccion TEXT');
  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS comuna TEXT');
  await pool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS motivo TEXT');
  await pool.query('ALTER TABLE amonestaciones ADD COLUMN IF NOT EXISTS docx_contenido BYTEA');
  await pool.query('ALTER TABLE motivos_amonestacion ADD COLUMN IF NOT EXISTS autocompletar_atrasos BOOLEAN DEFAULT false');
  await pool.query('ALTER TABLE requerimiento_dotacion ADD COLUMN IF NOT EXISTS turno TEXT');
  await pool.query('ALTER TABLE requerimiento_dotacion ADD COLUMN IF NOT EXISTS vigente_hasta TEXT');
  await pool.query('ALTER TABLE requerimiento_dotacion ADD COLUMN IF NOT EXISTS cd TEXT');
  await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS cd TEXT');
  await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cds_visibles TEXT[]');
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

  // Siembra inicial de los cargos que exige el cliente para Requerimiento de
  // Dotación (se puede seguir agregando más desde el módulo).
  const cargosIniciales = [
    'ADMINISTRATIVO (A)', 'OPERADOR (A) DE MAQUINA ESPECIALIZADO', 'OPERARIO (A) MULTIFUNCIONAL',
    'SUPERVISOR (A) SENIOR', 'JEFE DE TURNO SENIOR', 'JEFE (A) DE OPERACIONES',
  ];
  for (const cargo of cargosIniciales) {
    await pool.query('INSERT INTO cargos_requerimiento (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [cargo]);
  }

  // Siembra inicial de roles. 'admin' siempre tiene todos los módulos (no se
  // puede editar ni eliminar). Los demás perfiles se crean con una selección
  // razonable de módulos por defecto, que el administrador puede ajustar
  // libremente desde "Usuarios" — incluyendo crear roles nuevos.
  const TODOS_LOS_MODULOS = [
    'dashboard', 'resultados', 'detalle', 'reporte', 'nomina', 'horasExtras', 'horasExtrasSolicitar', 'horasExtrasAprobar',
    'asignacion', 'perfiles', 'requerimiento', 'ausencias', 'actualizacion', 'carga', 'usuarios', 'fueroMaternal',
    'amonestaciones', 'feriados',
  ];
  const rolesIniciales = [
    { nombre: 'admin', modulos: TODOS_LOS_MODULOS, es_sistema: true },
    { nombre: 'usuario', modulos: ['dashboard', 'resultados'], es_sistema: true },
    { nombre: 'Gerente', modulos: ['dashboard', 'resultados', 'detalle', 'reporte'], es_sistema: false },
    // Jefe Operaciones aprueba las horas extras ordinarias que solicita el Jefe de Turno.
    { nombre: 'Jefe Operaciones', modulos: ['dashboard', 'resultados', 'detalle', 'reporte', 'asignacion', 'requerimiento', 'ausencias', 'feriados', 'horasExtrasAprobar'], es_sistema: false },
    { nombre: 'Jefe Turno', modulos: ['dashboard', 'resultados', 'reporte', 'asignacion', 'ausencias', 'horasExtrasSolicitar'], es_sistema: false },
    { nombre: 'Supervisor', modulos: ['resultados', 'reporte', 'ausencias', 'actualizacion'], es_sistema: false },
    { nombre: 'KAM', modulos: ['dashboard', 'reporte'], es_sistema: false },
    { nombre: 'RRHH', modulos: ['dashboard', 'resultados', 'perfiles', 'ausencias', 'requerimiento', 'nomina', 'fueroMaternal', 'amonestaciones'], es_sistema: false },
  ];
  for (const r of rolesIniciales) {
    await pool.query(
      'INSERT INTO roles (nombre, modulos, es_sistema) VALUES ($1,$2,$3) ON CONFLICT (nombre) DO NOTHING',
      [r.nombre, r.modulos, r.es_sistema]
    );
  }

  // Migración: si los roles "Jefe Turno"/"Jefe Operaciones" ya existían de
  // antes (el INSERT de arriba no los toca por el ON CONFLICT DO NOTHING),
  // igual les agrega el permiso nuevo del flujo de horas extras ordinarias
  // — sin pisar el resto de los módulos que el administrador ya les asignó.
  await pool.query(`
    UPDATE roles SET modulos = array_append(modulos, 'horasExtrasSolicitar')
    WHERE nombre = 'Jefe Turno' AND NOT ('horasExtrasSolicitar' = ANY(modulos))
  `);
  await pool.query(`
    UPDATE roles SET modulos = array_append(modulos, 'horasExtrasAprobar')
    WHERE nombre = 'Jefe Operaciones' AND NOT ('horasExtrasAprobar' = ANY(modulos))
  `);

  // Siembra inicial del horario Plano (los mismos valores que antes estaban
  // fijos en el código — se puede seguir ajustando desde el módulo).
  const horarioPlanoInicial = [
    ['Lun', '08:00:00', '17:30:00'],
    ['Mar', '08:00:00', '17:30:00'],
    ['Mié', '08:00:00', '17:30:00'],
    ['Jue', '08:00:00', '16:00:00'],
    ['Vie', '08:00:00', '16:00:00'],
  ];
  for (const [dia, hora_entrada, hora_salida] of horarioPlanoInicial) {
    await pool.query(
      'INSERT INTO horario_plano (dia, hora_entrada, hora_salida) VALUES ($1,$2,$3) ON CONFLICT (dia) DO NOTHING',
      [dia, hora_entrada, hora_salida]
    );
  }

  // Siembra inicial del mapeo Sucursal -> CD (varias sucursales pueden
  // apuntar al mismo CD). Se puede seguir ajustando desde el módulo de CDs.
  const mapeoCdInicial = [
    ['MC CD PARIS', 'MC CD PARIS'],
    ['MC CD SAN IGNACIO', 'MC CD SAN IGNACIO'],
    ['MC CD ENEA', 'MC CD ENEA'],
    ['MC CD JUNCAL', 'MC CD JUNCAL'],
    ['MC CENCOSUD SAN IGNACIO', 'MC CD SAN IGNACIO'],
    ['MC CENCOSUD EL JUNCAL', 'MC CD JUNCAL'],
    ['MC CENCOSUD BODEGAS PARIS', 'MC CD PARIS'],
    ['MC SAN IGNACIO CD EST', 'MC CD SAN IGNACIO'],
  ];
  for (const [sucursal, cd] of mapeoCdInicial) {
    await pool.query('INSERT INTO cd_sucursal (sucursal, cd) VALUES ($1,$2) ON CONFLICT (sucursal) DO NOTHING', [sucursal, cd]);
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

  // Transición automática: los trabajadores con renuncia/desvinculación
  // registrada cuyo mes de término ya quedó completamente atrás pasan a
  // inactivo automáticamente (mientras el mes de término sigue en curso,
  // permanecen activos para no perder su procesamiento de ese mes).
  await procesarTransicionesTermino(pool);

  return pool;
}

async function procesarTransicionesTermino(pool) {
  const { rowCount } = await pool.query(`
    UPDATE empleados
    SET activo = false
    WHERE activo = true
      AND motivo_termino IS NOT NULL
      AND fecha_termino < date_trunc('month', CURRENT_DATE)::date::text
  `);
  if (rowCount > 0) console.log(`${rowCount} trabajador(es) pasaron a inactivo automáticamente (mes de término ya cerrado).`);
  return rowCount;
}

module.exports = { initDb, procesarTransicionesTermino };