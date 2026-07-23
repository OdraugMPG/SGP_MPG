const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initDb } = require('./db');
const { cargarTodo, cargarTalanaIncremental, cargarCencosudIncremental, activarEmpleadosDesdeArchivo, actualizarAreasDesdeArchivo } = require('./importar');
const { calcularResultados } = require('./calcular');
const { generarReporteDiario, exportarReporteDiarioXlsx, obtenerLogMarcacion } = require('./reporteDiario');
const { generarReporteEmpleadoPDF, generarReportePorJefeTurnoPDF } = require('./reporteEmpleadoPDF');
const { generarDetalleMarcaciones, exportarDetalleMarcacionesXlsx } = require('./detalleMarcaciones');
const { calcularIndicadores, exportarReporteDesvinculacionXlsx } = require('./indicadores');
const { calcularMatrizAsistencia, exportarMatrizAsistenciaXlsx } = require('./dashboardAsistencia');
const { DIAS_FALLECIMIENTO, calcularFechaFinFallecimiento } = require('./permisoFallecimiento');
const { semanaISO, diaDeSemana, resolverJefeTurno, sumarDias, determinarTipoTurno, contratoDesdeRazonSocial } = require('./importar');
const { login, requireAuth, requireAdmin } = require('./auth');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: path.join(__dirname, 'uploads'), limits: { fileSize: 10 * 1024 * 1024 } });

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
    const { rut, desde, hasta, soloAtrasos, soloInconsistencias, jefeTurno } = req.query;
    let sql = `SELECT r.* FROM resultado_diario r`;
    if (jefeTurno) sql += ` JOIN jefe_turno_asignacion jt ON jt.rut = r.rut`;
    sql += ' WHERE 1=1';
    const params = [];

    if (rut) { params.push(rut); sql += ` AND r.rut = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND r.fecha >= $${params.length}`; }
    if (hasta) { params.push(hasta); sql += ` AND r.fecha <= $${params.length}`; }
    if (soloAtrasos === 'true') sql += ' AND r.minutos_atraso > 0';
    if (soloInconsistencias === 'true') sql += ' AND r.inconsistencia IS NOT NULL';
    if (jefeTurno) { params.push(jefeTurno); sql += ` AND jt.jefe_turno = $${params.length}`; }

    sql += ' ORDER BY r.fecha DESC, r.rut LIMIT 1000';

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
    const { fecha, excluirAreas } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro fecha (YYYY-MM-DD)' });
    const areasExcluidas = excluirAreas ? excluirAreas.split(',').filter(Boolean) : [];
    const filas = await generarReporteDiario(pool, fecha, { excluirAreas: areasExcluidas });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reporte-diario/export', async (req, res) => {
  try {
    const { fecha, excluirAreas } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro fecha (YYYY-MM-DD)' });
    const areasExcluidas = excluirAreas ? excluirAreas.split(',').filter(Boolean) : [];
    const buffer = await exportarReporteDiarioXlsx(pool, fecha, { excluirAreas: areasExcluidas });
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

// Reporte individual mensual en PDF (solo Talana), para mostrarle al trabajador.
app.get('/api/reporte-empleado/:rut/pdf', async (req, res) => {
  try {
    const { mes } = req.query; // 'YYYY-MM'
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return res.status(400).json({ error: 'Falta o es inválido el parámetro mes (YYYY-MM)' });
    const buffer = await generarReporteEmpleadoPDF(pool, req.params.rut, mes);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_${req.params.rut}_${mes}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Reporte masivo en PDF: una sección por cada trabajador activo asignado al
// Jefe de Turno indicado, en un solo archivo.
app.get('/api/reporte-jefe-turno/pdf', async (req, res) => {
  try {
    const { jefeTurno, mes } = req.query;
    if (!jefeTurno || !mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: 'jefeTurno y mes (YYYY-MM) son requeridos' });
    }
    const buffer = await generarReportePorJefeTurnoPDF(pool, jefeTurno, mes);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Reporte_${jefeTurno}_${mes}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Ausencias y permisos ---

const SIGLAS_VALIDAS = ['P', 'F_Ju', 'F_In', 'PSGS', 'PCGS', 'DC', 'V', 'R', 'Dv', 'A', 'LM', 'PF'];

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

// Determina el tipo de turno (AM/PM/NOCHE/PLANO) de un rut para una fecha,
// consultando su asignación de jefe de turno y la rotación vigente esa semana.
async function tipoTurnoDeRut(rut, fecha) {
  const { rows: asigRows } = await pool.query('SELECT jefe_turno FROM jefe_turno_asignacion WHERE rut = $1', [rut]);
  const codigoJefeTurno = asigRows[0]?.jefe_turno || null;
  const { rows: rotacionRows } = await pool.query(
    'SELECT DISTINCT sem, jefe_turno, rotacion_base FROM rotacion_turnos WHERE rotacion_base IS NOT NULL'
  );
  const rotacionBasePorClave = new Map(rotacionRows.map(r => [`${r.sem}|${r.jefe_turno}`, r.rotacion_base]));
  return determinarTipoTurno(codigoJefeTurno, fecha, rotacionBasePorClave);
}

// Calcula la fecha de término de un permiso por fallecimiento según parentesco.
app.get('/api/ausencias/fallecimiento/calcular', async (req, res) => {
  try {
    const { fecha_inicio, parentesco, rut } = req.query;
    if (!fecha_inicio || !parentesco) return res.status(400).json({ error: 'fecha_inicio y parentesco son requeridos' });
    const config = DIAS_FALLECIMIENTO[parentesco];
    if (!config) return res.status(400).json({ error: 'Parentesco no válido' });
    const tipoTurno = rut ? await tipoTurnoDeRut(rut, fecha_inicio) : null;
    const fecha_fin = calcularFechaFinFallecimiento(fecha_inicio, parentesco, tipoTurno);
    res.json({ fecha_fin, dias: config.dias, tipo_dia: config.tipo_dia, label: config.label, turno_usado: tipoTurno });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Lista de parentescos válidos para permiso por fallecimiento (para el selector).
app.get('/api/ausencias/fallecimiento/parentescos', (req, res) => {
  res.json(Object.entries(DIAS_FALLECIMIENTO).map(([value, c]) => ({
    value, label: c.label, dias: c.dias, tipo_dia: c.tipo_dia,
  })));
});

// Registra un permiso/ausencia en un RANGO de fechas de una vez (licencia
// médica o permiso por fallecimiento), con documento de respaldo opcional.
// Crea una fila en ausencias_permisos por cada día del rango, todas ligadas
// al mismo documento (si se adjuntó uno).
app.post('/api/ausencias/rango', upload.single('documento'), async (req, res) => {
  try {
    const { rut, tipo, fecha_inicio, parentesco, observacion } = req.body;
    let { fecha_fin } = req.body;

    if (!rut || !tipo || !fecha_inicio) {
      return res.status(400).json({ error: 'rut, tipo y fecha_inicio son requeridos' });
    }

    if (tipo === 'PF') {
      if (!parentesco || !DIAS_FALLECIMIENTO[parentesco]) {
        return res.status(400).json({ error: 'Para permiso por fallecimiento, parentesco es requerido y debe ser válido' });
      }
      const tipoTurno = await tipoTurnoDeRut(rut, fecha_inicio);
      fecha_fin = calcularFechaFinFallecimiento(fecha_inicio, parentesco, tipoTurno);
    }

    if (!fecha_fin) return res.status(400).json({ error: 'fecha_fin es requerido (o parentesco válido para calcularlo)' });
    if (fecha_fin < fecha_inicio) return res.status(400).json({ error: 'fecha_fin no puede ser anterior a fecha_inicio' });

    const creadoPor = req.usuario.nombre || req.usuario.usuario;

    let documentoId = null;
    if (req.file) {
      const contenido = fs.readFileSync(req.file.path);
      const { rows } = await pool.query(
        `INSERT INTO documentos_respaldo
          (rut, fecha_inicio, fecha_fin, tipo, parentesco, nombre_archivo, mime_tipo, contenido, observacion, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [rut, fecha_inicio, fecha_fin, tipo, parentesco || null, req.file.originalname, req.file.mimetype, contenido, observacion || null, creadoPor]
      );
      documentoId = rows[0].id;
      fs.unlink(req.file.path, () => {}); // limpia el archivo temporal, ya quedó en la base
    }

    // Genera la lista de fechas del rango e inserta una fila por día.
    const fechas = [];
    let f = fecha_inicio;
    while (f <= fecha_fin) {
      fechas.push(f);
      f = sumarDias(f, 1);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const fecha of fechas) {
        await client.query(
          `INSERT INTO ausencias_permisos (rut, fecha, tipo, observacion, documento_id, parentesco)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (rut, fecha) DO UPDATE SET tipo = EXCLUDED.tipo, observacion = EXCLUDED.observacion,
             documento_id = EXCLUDED.documento_id, parentesco = EXCLUDED.parentesco`,
          [rut, fecha, tipo, observacion || null, documentoId, parentesco || null]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, fecha_inicio, fecha_fin, dias: fechas.length, documento_id: documentoId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Descarga/visualiza un documento de respaldo adjunto.
app.get('/api/ausencias/documento/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT nombre_archivo, mime_tipo, contenido FROM documentos_respaldo WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado' });
    const doc = rows[0];
    res.setHeader('Content-Type', doc.mime_tipo || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${doc.nombre_archivo}"`);
    res.send(doc.contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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

app.get('/api/detalle-marcaciones/export', async (req, res) => {
  try {
    const { rut, desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const buffer = await exportarDetalleMarcacionesXlsx(pool, { rut, desde, hasta });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DetalleMarcaciones_${desde}_a_${hasta}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indicadores', async (req, res) => {
  try {
    const { desde, hasta, area } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const datos = await calcularIndicadores(pool, { desde, hasta, area });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indicadores/reporte-desvinculacion/export', async (req, res) => {
  try {
    const { desde, hasta, area } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const buffer = await exportarReporteDesvinculacionXlsx(pool, { desde, hasta, area });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ReporteCausalDesvinculacion_${desde}_a_${hasta}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard-asistencia', async (req, res) => {
  try {
    const { desde, hasta, area } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const datos = await calcularMatrizAsistencia(pool, { desde, hasta, area });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard-asistencia/export', async (req, res) => {
  try {
    const { desde, hasta, area } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const buffer = await exportarMatrizAsistenciaXlsx(pool, { desde, hasta, area });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DashboardAsistencia_${desde}_a_${hasta}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Requerimiento de dotación por cargo (historial de cambios) ---

// Historial completo, o filtrado por cargo.
app.get('/api/requerimiento-dotacion', async (req, res) => {
  try {
    const { cargo } = req.query;
    let sql = 'SELECT * FROM requerimiento_dotacion WHERE 1=1';
    const params = [];
    if (cargo) { params.push(cargo); sql += ` AND cargo = $${params.length}`; }
    sql += ' ORDER BY cargo, vigente_desde DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// El requerimiento vigente de cada cargo+turno a una fecha dada (el último
// cambio cuya "vigente_desde" sea igual o anterior a esa fecha).
app.get('/api/requerimiento-dotacion/vigente', async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (cargo, turno) cargo, turno, cantidad_requerida, vigente_desde, observacion
       FROM requerimiento_dotacion
       WHERE vigente_desde <= $1
       ORDER BY cargo, turno, vigente_desde DESC`,
      [fecha]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/requerimiento-dotacion', async (req, res) => {
  try {
    const { cargo, turno, cantidad_requerida, vigente_desde, observacion } = req.body;
    if (!cargo || !cantidad_requerida || !vigente_desde) {
      return res.status(400).json({ error: 'cargo, cantidad_requerida y vigente_desde son requeridos' });
    }
    await pool.query(
      `INSERT INTO requerimiento_dotacion (cargo, turno, cantidad_requerida, vigente_desde, observacion, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [cargo, turno || null, cantidad_requerida, vigente_desde, observacion || null, req.usuario.nombre || req.usuario.usuario]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Guarda de una vez varias celdas de la matriz Cargo x Turno.
// body: { vigente_desde, observacion, items: [{ cargo, turno, cantidad_requerida }, ...] }
app.post('/api/requerimiento-dotacion/masivo', async (req, res) => {
  try {
    const { vigente_desde, observacion, items } = req.body;
    if (!vigente_desde || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'vigente_desde e items son requeridos' });
    }
    const creadoPor = req.usuario.nombre || req.usuario.usuario;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        if (item.cantidad_requerida === '' || item.cantidad_requerida === null || item.cantidad_requerida === undefined) continue;
        await client.query(
          `INSERT INTO requerimiento_dotacion (cargo, turno, cantidad_requerida, vigente_desde, observacion, creado_por)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [item.cargo, item.turno || null, Number(item.cantidad_requerida), vigente_desde, observacion || null, creadoPor]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, guardados: items.filter(i => i.cantidad_requerida !== '' && i.cantidad_requerida !== null).length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/requerimiento-dotacion/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM requerimiento_dotacion WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Gestión de usuarios (solo administradores) ---

app.get('/api/usuarios', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, usuario, nombre, rol, activo, creado_en FROM usuarios ORDER BY creado_en'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/usuarios', requireAdmin, async (req, res) => {
  try {
    const { usuario, password, nombre, rol } = req.body;
    if (!usuario || !password) return res.status(400).json({ error: 'usuario y password son requeridos' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const { rows: existe } = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario]);
    if (existe.length > 0) return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO usuarios (usuario, password_hash, nombre, rol) VALUES ($1,$2,$3,$4)`,
      [usuario, hash, nombre || usuario, rol === 'admin' ? 'admin' : 'usuario']
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/usuarios/:id', requireAdmin, async (req, res) => {
  try {
    const { nombre, rol, activo, password } = req.body;

    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    }

    await pool.query(
      `UPDATE usuarios SET
         nombre = COALESCE($1, nombre),
         rol = COALESCE($2, rol),
         activo = COALESCE($3, activo)
       WHERE id = $4`,
      [nombre, rol, activo, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/usuarios/:id', requireAdmin, async (req, res) => {
  try {
    if (String(req.usuario.id) === String(req.params.id)) {
      return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
    }
    await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Cualquier usuario logueado puede cambiar SU PROPIA contraseña.
app.put('/api/usuarios/me/password', async (req, res) => {
  try {
    const { passwordActual, passwordNueva } = req.body;
    if (!passwordActual || !passwordNueva) return res.status(400).json({ error: 'Faltan datos' });
    if (passwordNueva.length < 6) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' });

    const { rows } = await pool.query('SELECT password_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

    const coincide = await bcrypt.compare(passwordActual, rows[0].password_hash);
    if (!coincide) return res.status(401).json({ error: 'La contraseña actual no es correcta' });

    const hash = await bcrypt.hash(passwordNueva, 10);
    await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, req.usuario.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
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
              e.empresa, e.activo, e.motivo_inactivo, e.tipo_contrato,
              a.jefe_turno
       FROM empleados e
       LEFT JOIN jefe_turno_asignacion a ON a.rut = e.rut
       WHERE e.rut ILIKE $1 OR e.nombre ILIKE $1 OR e.apellido_paterno ILIKE $1
       ORDER BY e.nombre
       LIMIT 30`,
      [like]
    );
    const conContratoEfectivo = rows.map(r => ({
      ...r,
      tipo_contrato_efectivo: r.tipo_contrato || contratoDesdeRazonSocial(r.empresa) || 'OUT',
    }));
    res.json(conContratoEfectivo);
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

// Marca activos/inactivos en masa a partir de un archivo con los RUTs vigentes.
app.post('/api/empleados/activar-masivo', upload.single('activos'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo con los RUTs vigentes' });
    const resultado = await activarEmpleadosDesdeArchivo(pool, req.file.path);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Actualiza el área (centro de costo) en masa desde un archivo RUT + ÁREA.
app.post('/api/empleados/areas-masivo', upload.single('areas'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo con RUT y Área' });
    const resultado = await actualizarAreasDesdeArchivo(pool, req.file.path);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Editar el perfil de un trabajador existente (cargo, área/centro de costo, nombre)
app.put('/api/empleados/:rut', async (req, res) => {
  try {
    const { nombre, apellido_paterno, apellido_materno, cargo, centro_costo, activo, motivo_inactivo, tipo_contrato } = req.body;
    const { rows: existe } = await pool.query('SELECT rut FROM empleados WHERE rut = $1', [req.params.rut]);
    if (existe.length === 0) return res.status(404).json({ error: 'Trabajador no encontrado' });

    if (activo === false && !motivo_inactivo) {
      return res.status(400).json({ error: 'Debes indicar el motivo por el que queda inactivo' });
    }

    // El campo "activo" puede venir como true, false o no venir (undefined -> null,
    // en cuyo caso no se toca). Cuando se reactiva a alguien (true), se limpia el
    // motivo guardado; cuando se marca inactivo (false), se guarda/actualiza el motivo.
    const activoParam = activo === true || activo === false ? activo : null;

    await pool.query(
      `UPDATE empleados SET
         nombre = COALESCE($1, nombre),
         apellido_paterno = COALESCE($2, apellido_paterno),
         apellido_materno = COALESCE($3, apellido_materno),
         cargo = COALESCE($4, cargo),
         centro_costo = COALESCE($5, centro_costo),
         activo = COALESCE($6, activo),
         motivo_inactivo = CASE
           WHEN $6 = true THEN NULL
           WHEN $6 = false THEN COALESCE($7, motivo_inactivo)
           ELSE motivo_inactivo
         END,
         tipo_contrato = COALESCE($8, tipo_contrato)
       WHERE rut = $9`,
      [nombre, apellido_paterno, apellido_materno, cargo, centro_costo, activoParam, motivo_inactivo, tipo_contrato, req.params.rut]
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