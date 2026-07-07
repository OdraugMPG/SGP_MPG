const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const { initDb } = require('./db');
const { cargarTodo, cargarTalanaIncremental, cargarCencosudIncremental } = require('./importar');
const { calcularResultados } = require('./calcular');
const { generarReporteDiario, exportarReporteDiarioXlsx } = require('./reporteDiario');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: path.join(__dirname, 'uploads') });

let pool; // se inicializa al arrancar (ver bottom del archivo)

app.get('/api/ping', (req, res) => {
  res.json({ message: 'Backend funcionando!' });
});

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