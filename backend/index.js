const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const { initDb } = require('./db');
const { cargarTodo, cargarTalanaIncremental, cargarCencosudIncremental } = require('./importar');
const { calcularResultados } = require('./calcular');
const { generarReporteDiario, exportarReporteDiarioXlsx, obtenerLogMarcacion } = require('./reporteDiario');
const { generarDetalleMarcaciones } = require('./detalleMarcaciones');
const { semanaISO, diaDeSemana, resolverJefeTurno } = require('./importar');
const { login, requireAuth } = require('./auth');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: path.join(__dirname, 'uploads') });

let pool; // se inicializa al arrancar (ver bottom del archivo)

app.get('/api/ping', (req, res) => {
  res.json({ message: 'Backend funcionando!' });
});

// Ruta pública: login. Debe ir ANTES del middleware requireAuth.
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;
    if (!usuario || !password) return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
    const resultado = await login(pool, usuario, password);
    if (!resultado.ok) return res.status(401).json({ error: resultado.error });
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// A partir de aquí, todas las rutas /api/* requieren un token válido.
app.use('/api', requireAuth);

app.post('/api/importar', upload.fields([
  { name: 'maestro', maxCount: 1 },
  { name: 'talana', maxCount: 1 },
  { name: 'cencosud', maxCount: 1 },
  { name: 'parametros', maxCount: 1 },
  { name: 'asignacion', maxCount: 1 },
]), async (req, res) => {
  try {
    const f = req.files;
    const paths = {
      maestro: f.maestro?.[0]?.path,
      talana: f.talana?.[0]?.path,
      cencosud: f.cencosud?.[0]?.path,
      parametros: f.parametros?.[0]?.path,
      asignacion: f.asignacion?.[0]?.path,
    };

    await cargarTodo(pool, paths);
    await calcularResultados(pool);

    const contar = async (sql) => (await pool.query(sql)).rows[0].c;

    const resumen = {
      empleados: await contar('SELECT COUNT(*) c FROM empleados'),
      marcaciones_talana: await contar('SELECT COUNT(*) c FROM marcaciones_talana'),
      marcaciones_cencosud: await contar('SELECT COUNT(*) c FROM marcaciones_cencosud'),
      resultados: await contar('SELECT COUNT(*) c FROM resultado_diario'),
      con_atraso: await contar('SELECT COUNT(*) c FROM resultado_diario WHERE minutos_atraso > 0'),
      con_inconsistencia: await contar('SELECT COUNT(*) c FROM resultado_diario WHERE inconsistencia IS NOT NULL'),
    };

    res.json({ ok: true, resumen });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/resultados', async (req, res) => {
  try {
    const { rut, desde, hasta, soloAtrasos, soloInconsistencias } = req.query;
    let sql = 'SELECT * FROM resultado_diario WHERE 1=1';
    const params = [];

    if (rut) { params.push(rut); sql += ` AND rut = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND fecha >= $${params.length}`; }
    if (hasta) { params.push(hasta); sql += ` AND fecha <= $${params.length}`; }
    if (soloAtrasos === 'true') sql += ' AND minutos_atraso > 0';
    if (soloInconsistencias === 'true') sql += ' AND inconsistencia IS NOT NULL';

    sql += ' ORDER BY fecha DESC, rut LIMIT 1000';

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/empleados/:rut', async (req, res) => {
  try {
    const { rows: empRows } = await pool.query('SELECT * FROM empleados WHERE rut = $1', [req.params.rut]);
    if (empRows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    const { rows: historial } = await pool.query(
      'SELECT * FROM resultado_diario WHERE rut = $1 ORDER BY fecha DESC', [req.params.rut]
    );
    res.json({ empleado: empRows[0], historial });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reporte-diario', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro fecha (YYYY-MM-DD)' });
    const filas = await generarReporteDiario(pool, fecha);
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reporte-diario/export', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro fecha (YYYY-MM-DD)' });
    const buffer = await exportarReporteDiarioXlsx(pool, fecha);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ReporteDiario_${fecha}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reporte-diario/log', async (req, res) => {
  try {
    const { fecha } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro fecha (YYYY-MM-DD)' });
    const log = await obtenerLogMarcacion(pool, fecha);
    res.json(log);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Ausencias y permisos ---

const SIGLAS_VALIDAS = ['P', 'F_Ju', 'F_In', 'PSGS', 'PCGS', 'DC', 'V', 'R', 'Dv', 'A', 'LM'];

// Lista/filtra ausencias. Sin filtros trae las más recientes.
app.get('/api/ausencias', async (req, res) => {
  try {
    const { rut, desde, hasta } = req.query;
    let sql = `SELECT a.*, e.nombre, e.apellido_paterno FROM ausencias_permisos a
               LEFT JOIN empleados e ON e.rut = a.rut WHERE 1=1`;
    const params = [];
    if (rut) { params.push(rut); sql += ` AND a.rut = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND a.fecha >= $${params.length}`; }
    if (hasta) { params.push(hasta); sql += ` AND a.fecha <= $${params.length}`; }
    sql += ' ORDER BY a.fecha DESC LIMIT 500';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ausencias', async (req, res) => {
  try {
    const { rut, fecha, tipo, observacion } = req.body;
    if (!rut || !fecha || !tipo) return res.status(400).json({ error: 'rut, fecha y tipo son requeridos' });
    if (!SIGLAS_VALIDAS.includes(tipo)) return res.status(400).json({ error: 'Tipo de ausencia no válido' });

    await pool.query(
      `INSERT INTO ausencias_permisos (rut, fecha, tipo, observacion) VALUES ($1,$2,$3,$4)
       ON CONFLICT (rut, fecha) DO UPDATE SET tipo = EXCLUDED.tipo, observacion = EXCLUDED.observacion`,
      [rut, fecha, tipo, observacion || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/ausencias/:rut/:fecha', async (req, res) => {
  try {
    await pool.query('DELETE FROM ausencias_permisos WHERE rut = $1 AND fecha = $2', [req.params.rut, req.params.fecha]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Dashboard de asistencia (matriz trabajadores x días) ---

app.get('/api/detalle-marcaciones', async (req, res) => {
  try {
    const { rut, desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const filas = await generarDetalleMarcaciones(pool, { rut, desde, hasta });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard-asistencia', async (req, res) => {
  try {
    const { desde, hasta, area } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });

    const dIni = new Date(desde + 'T00:00:00');
    const dFin = new Date(hasta + 'T00:00:00');
    const dias = Math.round((dFin - dIni) / 86400000) + 1;
    if (dias < 1 || dias > 62) return res.status(400).json({ error: 'El rango debe ser de 1 a 62 días' });

    const fechas = [];
    for (let i = 0; i < dias; i++) {
      const d = new Date(dIni);
      d.setDate(d.getDate() + i);
      fechas.push(d.toISOString().slice(0, 10));
    }

    let sqlEmp = 'SELECT rut, nombre, apellido_paterno, cargo, centro_costo FROM empleados WHERE 1=1';
    const paramsEmp = [];
    if (area) { paramsEmp.push(area); sqlEmp += ` AND centro_costo = $${paramsEmp.length}`; }
    sqlEmp += ' ORDER BY nombre';
    const { rows: empleados } = await pool.query(sqlEmp, paramsEmp);

    const { rows: resultados } = await pool.query(
      'SELECT rut, fecha, marco_talana, marco_cencosud FROM resultado_diario WHERE fecha BETWEEN $1 AND $2',
      [desde, hasta]
    );
    const resultadoPorClave = new Map(resultados.map(r => [`${r.rut}|${r.fecha}`, r]));

    const { rows: ausencias } = await pool.query(
      'SELECT rut, fecha, tipo FROM ausencias_permisos WHERE fecha BETWEEN $1 AND $2',
      [desde, hasta]
    );
    const ausenciaPorClave = new Map(ausencias.map(a => [`${a.rut}|${a.fecha}`, a.tipo]));

    const { rows: asignaciones } = await pool.query('SELECT rut, jefe_turno FROM jefe_turno_asignacion');
    const jefeTurnoPorRut = new Map(asignaciones.map(a => [a.rut, a.jefe_turno]));

    const { rows: rotacionRows } = await pool.query(
      `SELECT DISTINCT sem, jefe_turno, rotacion_base FROM rotacion_turnos WHERE rotacion_base IS NOT NULL`
    );
    const rotacionBasePorClave = new Map(rotacionRows.map(r => [`${r.sem}|${r.jefe_turno}`, r.rotacion_base]));

    const hoy = new Date().toISOString().slice(0, 10);

    // Determina si 'fecha' es día libre para el código de jefe de turno dado,
    // según la regla: turno Noche y turno Plano libran Sábado y Domingo;
    // turno AM/PM libra solo Domingo. Sin asignación: no aplica.
    function esDiaLibre(codigoJefeTurno, fecha) {
      if (!codigoJefeTurno) return false;
      const dia = diaDeSemana(fecha);

      if (codigoJefeTurno === 'CG' || codigoJefeTurno === 'PLANO') {
        return dia === 'Sáb' || dia === 'Dom';
      }

      const codigoResuelto = resolverJefeTurno(codigoJefeTurno);
      const sem = semanaISO(fecha);
      const rotacionBase = rotacionBasePorClave.get(`${sem}|${codigoResuelto}`);
      if (rotacionBase === 'NOCHE') return dia === 'Sáb' || dia === 'Dom';
      if (rotacionBase === 'AM' || rotacionBase === 'PM') return dia === 'Dom';
      return false;
    }

    const trabajadores = empleados.map(emp => {
      const estados = {};
      const codigoJefeTurno = jefeTurnoPorRut.get(emp.rut);
      for (const fecha of fechas) {
        const clave = `${emp.rut}|${fecha}`;
        const ausencia = ausenciaPorClave.get(clave);
        if (ausencia) {
          estados[fecha] = { codigo: ausencia, categoria: 'ausencia' };
          continue;
        }

        const r = resultadoPorClave.get(clave);
        const tieneMarca = !!(r && (r.marco_talana || r.marco_cencosud));

        if (esDiaLibre(codigoJefeTurno, fecha)) {
          estados[fecha] = tieneMarca
            ? { codigo: 'DLT', categoria: 'diaLibreTrabajado' }
            : { codigo: 'DL', categoria: 'diaLibre' };
          continue;
        }

        if (r && r.marco_talana && r.marco_cencosud) {
          estados[fecha] = { codigo: 'P', categoria: 'ok' };
        } else if (r && r.marco_talana && !r.marco_cencosud) {
          estados[fecha] = { codigo: 'SM_CTRL', categoria: 'inconsistencia' };
        } else if (r && !r.marco_talana && r.marco_cencosud) {
          estados[fecha] = { codigo: 'SM_TLN', categoria: 'inconsistencia' };
        } else if (fecha < hoy) {
          estados[fecha] = { codigo: 'A', categoria: 'ausente' };
        } else {
          estados[fecha] = { codigo: '', categoria: 'futuro' };
        }
      }
      return {
        rut: emp.rut,
        nombre: `${emp.nombre} ${emp.apellido_paterno || ''}`.trim(),
        cargo: emp.cargo,
        area: emp.centro_costo,
        estados,
      };
    });

    res.json({ fechas, trabajadores });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/actualizar/talana', upload.single('talana'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo talana' });
    const { fechas, filas } = await cargarTalanaIncremental(pool, req.file.path);
    await calcularResultados(pool);
    res.json({ ok: true, fechas_actualizadas: fechas, filas_cargadas: filas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/actualizar/cencosud', upload.single('cencosud'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Falta el archivo cencosud' });
    const { fechas, filas } = await cargarCencosudIncremental(pool, req.file.path);
    await calcularResultados(pool);
    res.json({ ok: true, fechas_actualizadas: fechas, filas_cargadas: filas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Buscar empleados por RUT o nombre (para el módulo de asignación de jefe de turno)
app.get('/api/empleados', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);
    const like = `%${q.trim()}%`;
    const { rows } = await pool.query(
      `SELECT e.rut, e.nombre, e.apellido_paterno, e.apellido_materno, e.cargo, e.centro_costo,
              a.jefe_turno
       FROM empleados e
       LEFT JOIN jefe_turno_asignacion a ON a.rut = e.rut
       WHERE e.rut ILIKE $1 OR e.nombre ILIKE $1 OR e.apellido_paterno ILIKE $1
       ORDER BY e.nombre
       LIMIT 30`,
      [like]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Listar todas las asignaciones actuales de jefe de turno
app.get('/api/jefe-turno', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT rut, nombre, cargo, jefe_turno, centro_costo
       FROM jefe_turno_asignacion
       ORDER BY jefe_turno NULLS LAST, nombre`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Crear o actualizar la asignación de un trabajador.
// body: { rut, jefe_turno } donde jefe_turno es 'T_RD' | 'T_BV' | 'T_WP' | 'PLANO'
app.post('/api/jefe-turno', async (req, res) => {
  try {
    const { rut, jefe_turno } = req.body;
    const VALORES_VALIDOS = ['T_RD', 'T_BV', 'T_WP', 'PLANO'];
    if (!rut || !VALORES_VALIDOS.includes(jefe_turno)) {
      return res.status(400).json({ error: 'rut y jefe_turno (T_RD|T_BV|T_WP|PLANO) son requeridos' });
    }

    const { rows: empRows } = await pool.query(
      'SELECT rut, nombre, apellido_paterno, cargo, centro_costo FROM empleados WHERE rut = $1', [rut]
    );
    if (empRows.length === 0) return res.status(404).json({ error: 'Empleado no encontrado' });
    const emp = empRows[0];
    const nombreCompleto = `${emp.nombre} ${emp.apellido_paterno || ''}`.trim();

    await pool.query(
      `INSERT INTO jefe_turno_asignacion (rut, nombre, cargo, jefe_turno, centro_costo)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (rut) DO UPDATE SET
         nombre=EXCLUDED.nombre, cargo=EXCLUDED.cargo, jefe_turno=EXCLUDED.jefe_turno, centro_costo=EXCLUDED.centro_costo`,
      [rut, nombreCompleto, emp.cargo, jefe_turno, emp.centro_costo]
    );

    await calcularResultados(pool);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Quitar la asignación de un trabajador (vuelve a quedar "sin turno definido")
app.delete('/api/jefe-turno/:rut', async (req, res) => {
  try {
    await pool.query('DELETE FROM jefe_turno_asignacion WHERE rut = $1', [req.params.rut]);
    await calcularResultados(pool);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Lista de cargos ya existentes (para sugerencias en el formulario de perfil)
app.get('/api/cargos', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT cargo FROM empleados WHERE cargo IS NOT NULL AND cargo <> '' ORDER BY cargo`
    );
    res.json(rows.map(r => r.cargo));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Áreas de trabajo ---

app.get('/api/areas', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT nombre FROM areas_trabajo ORDER BY nombre');
    res.json(rows.map(r => r.nombre));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/areas', async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim().toUpperCase();
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
    await pool.query('INSERT INTO areas_trabajo (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [nombre]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/areas/:nombre', async (req, res) => {
  try {
    await pool.query('DELETE FROM areas_trabajo WHERE nombre = $1', [req.params.nombre]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Perfil de trabajador (crear / editar) ---

// Crear un trabajador nuevo (para casos que aún no están en el Excel maestro)
app.post('/api/empleados', async (req, res) => {
  try {
    const { rut, nombre, apellido_paterno, apellido_materno, cargo, centro_costo } = req.body;
    if (!rut || !nombre) return res.status(400).json({ error: 'rut y nombre son requeridos' });

    const { rows: existe } = await pool.query('SELECT rut FROM empleados WHERE rut = $1', [rut]);
    if (existe.length > 0) return res.status(409).json({ error: 'Ya existe un trabajador con ese RUT' });

    await pool.query(
      `INSERT INTO empleados (rut, nombre, apellido_paterno, apellido_materno, cargo, centro_costo, empresa)
       VALUES ($1,$2,$3,$4,$5,$6,'MANPOWER')`,
      [rut, nombre, apellido_paterno || '', apellido_materno || '', cargo || '', centro_costo || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Editar el perfil de un trabajador existente (cargo, área/centro de costo, nombre)
app.put('/api/empleados/:rut', async (req, res) => {
  try {
    const { nombre, apellido_paterno, apellido_materno, cargo, centro_costo } = req.body;
    const { rows: existe } = await pool.query('SELECT rut FROM empleados WHERE rut = $1', [req.params.rut]);
    if (existe.length === 0) return res.status(404).json({ error: 'Trabajador no encontrado' });

    await pool.query(
      `UPDATE empleados SET
         nombre = COALESCE($1, nombre),
         apellido_paterno = COALESCE($2, apellido_paterno),
         apellido_materno = COALESCE($3, apellido_materno),
         cargo = COALESCE($4, cargo),
         centro_costo = COALESCE($5, centro_costo)
       WHERE rut = $6`,
      [nombre, apellido_paterno, apellido_materno, cargo, centro_costo, req.params.rut]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

initDb()
  .then((p) => {
    pool = p;
    app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
  })
  .catch((err) => {
    console.error('No se pudo conectar a PostgreSQL:', err.message);
    process.exit(1);
  });