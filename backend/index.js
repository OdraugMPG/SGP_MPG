const express = require('express');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { initDb, procesarTransicionesTermino } = require('./db');
const { cargarTodo, cargarTalanaIncremental, cargarCencosudIncremental, activarEmpleadosDesdeArchivo, actualizarAreasDesdeArchivo, actualizarJefeTurnoDesdeArchivo, actualizarCdDesdeMarcaciones, actualizarDireccionDesdeArchivo } = require('./importar');
const { calcularResultados } = require('./calcular');
const { generarReporteDiario, exportarReporteDiarioXlsx, obtenerLogMarcacion } = require('./reporteDiario');
const { calcularReporteAtrasos, exportarReporteAtrasosXlsx } = require('./reporteAtrasos');
const { generarReporteEmpleadoPDF, generarReportePorJefeTurnoPDF } = require('./reporteEmpleadoPDF');
const { generarDetalleMarcaciones, exportarDetalleMarcacionesXlsx } = require('./detalleMarcaciones');
const { calcularCierreNomina, exportarCierreNominaXlsx } = require('./cierreNomina');
const { generarAmonestacionPDF } = require('./amonestacionPDF');
const { generarAmonestacionDOCX } = require('./amonestacionDOCX');
const { obtenerFeriadosDesdeApi } = require('./feriados');
const { calcularAusentismoUltimaSemana } = require('./analisisAusentismo');
const { calcularMarcasAbiertas, exportarMarcasAbiertasXlsx } = require('./analisisMarcasAbiertas');
const { generarInformeIA } = require('./analisisIA');
const {
  calcularReporteHorasExtras, exportarReporteHorasExtrasXlsx, exportarReporteHorasExtrasPdf,
  exportarReporteHorasExtrasPorTrabajadorPdf,
} = require('./reporteHorasExtras');
const { calcularIndicadores, exportarReporteDesvinculacionXlsx, calcularSerieCumplimiento, calcularAusentismoPorTipoDiario, calcularPresentismoHistorico, CARGOS_DASHBOARD } = require('./indicadores');
const { calcularResumenAsistenciaArea } = require('./resumenAsistenciaArea');
const { calcularMatrizAsistencia, exportarMatrizAsistenciaXlsx } = require('./dashboardAsistencia');
const { calcularMatrizDotacion, calcularDetalleDiaTurno } = require('./simuladorDotacion');
const { generarAnalisisRiesgoDotacion } = require('./analisisRiesgoDotacion');
const { DIAS_FALLECIMIENTO, calcularFechaFinFallecimiento } = require('./permisoFallecimiento');
const { semanaISO, diaDeSemana, resolverJefeTurno, sumarDias, determinarTipoTurno, contratoDesdeRazonSocial, tipoTurnoDesdeHoraEntrada } = require('./importar');
const { login, requireAuth, requireAdmin } = require('./auth');
const { loginTrabajador, requireSoloTrabajador, cambiarPinPropio, asignarPin } = require('./authMovil');
const {
  registrarMarcacion, listarMarcacionesPropias, listarCdsMovil, crearCdMovil,
  actualizarCdMovil, eliminarCdMovil, listarTrabajadoresConCredencial, generarReporteMovil, obtenerFotoMarcacion,
} = require('./marcacionMovil');
const { parseAnticiposExcel, validarAnticipos, exportarAnticiposXlsx } = require('./anticipos');
const bcrypt = require('bcryptjs');

const app = express();
app.use(cors());
app.use(express.json());

// uploads/ está en .gitignore (son archivos temporales) — en un despliegue
// nuevo (Render, u otra máquina) la carpeta no existe hasta que Multer
// intenta escribir en ella, y a diferencia de mkdir, Multer no la crea sola.
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

// Multer dedicado para la foto de marcación móvil: solo imágenes, límite
// más chico (una selfie no necesita 10MB).
const uploadFotoMovil = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

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

// Ruta pública: login de trabajador (RUT + PIN) para marcación móvil.
// Separada del login de staff (/api/auth/login): distinta tabla de
// credenciales y distinto payload de JWT (sin 'rol').
app.post('/api/movil/auth/login', async (req, res) => {
  try {
    const { rut, pin } = req.body;
    if (!rut || !pin) return res.status(400).json({ error: 'RUT y PIN son requeridos' });
    const resultado = await loginTrabajador(pool, rut, pin);
    if (!resultado.ok) return res.status(401).json({ error: resultado.error });
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// A partir de aquí, todas las rutas /api/* requieren un token válido.
app.use('/api', requireAuth);

// Middleware: exige que el ROL del usuario logueado tenga habilitado el
// módulo indicado (consultando la tabla roles). 'admin' siempre pasa, sin
// importar qué módulos tenga configurados. Esto refuerza a nivel de backend
// lo que en el frontend ya se ve como pestañas ocultas — así un usuario no
// puede saltarse el control llamando la URL directamente.
// Resuelve la lista de CDs que debe usarse para filtrar una consulta, según
// lo que el usuario PIDIÓ (cdSolicitado, puede venir vacío = "Todos") y lo
// que su cuenta tiene PERMITIDO ver (cds_visibles). Devuelve:
//  - null: sin restricción, mostrar todos los CDs (admin, o usuario sin cds_visibles configurados y sin pedir uno específico)
//  - []: el usuario pidió un CD al que no tiene acceso (bloquear, mostrar vacío)
//  - [cd1, cd2, ...]: filtrar solo a estos CDs
async function resolverCdsFiltro(req, cdSolicitado) {
  let permitidos = null;
  if (req.usuario.rol !== 'admin') {
    const { rows } = await pool.query('SELECT cds_visibles FROM usuarios WHERE id = $1', [req.usuario.id]);
    const propios = rows[0]?.cds_visibles || [];
    if (propios.length > 0) permitidos = propios;
  }
  if (cdSolicitado) {
    if (permitidos && !permitidos.includes(cdSolicitado)) return [];
    return [cdSolicitado];
  }
  return permitidos; // null = todos, o el arreglo de CDs permitidos del usuario
}

function moduloRequerido(clave) {
  return async (req, res, next) => {
    try {
      if (req.usuario.rol === 'admin') return next();
      const { rows } = await pool.query('SELECT modulos FROM roles WHERE nombre = $1', [req.usuario.rol]);
      const modulos = rows[0]?.modulos || [];
      if (modulos.includes(clave)) return next();
      return res.status(403).json({ error: `Tu rol ("${req.usuario.rol}") no tiene acceso a este módulo.` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}

// Igual que moduloRequerido, pero pasa si el usuario tiene AL MENOS UNO de
// los módulos indicados (ej: ver la lista de horas extras ordinarias exige
// poder solicitarlas O poder aprobarlas, no ambas).
function algunModuloRequerido(claves) {
  return async (req, res, next) => {
    try {
      if (req.usuario.rol === 'admin') return next();
      const { rows } = await pool.query('SELECT modulos FROM roles WHERE nombre = $1', [req.usuario.rol]);
      const modulos = rows[0]?.modulos || [];
      if (claves.some(c => modulos.includes(c))) return next();
      return res.status(403).json({ error: `Tu rol ("${req.usuario.rol}") no tiene acceso a este módulo.` });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  };
}

// Rutas con prefijo exclusivo de un solo módulo: se protegen todas de una vez.
// (Rutas compartidas entre varios módulos, como la búsqueda de empleados o
// las listas de áreas/cargos, quedan sin restringir a propósito — son datos
// de referencia de solo lectura que varios módulos necesitan consultar.)
app.use('/api/reporte-diario', moduloRequerido('reporte'));
app.use('/api/cierre-nomina', moduloRequerido('nomina'));
app.use('/api/horas-extras', moduloRequerido('horasExtras'));
app.use('/api/reporte-empleado', moduloRequerido('reporte'));
app.use('/api/reporte-jefe-turno', moduloRequerido('reporte'));
app.use('/api/ausencias', moduloRequerido('ausencias'));
app.use('/api/detalle-marcaciones', moduloRequerido('detalle'));
app.use('/api/indicadores', moduloRequerido('dashboard'));
app.use('/api/dashboard-asistencia', moduloRequerido('dashboard'));
app.use('/api/requerimiento-dotacion', moduloRequerido('requerimiento'));
app.use('/api/cargos-requerimiento', moduloRequerido('requerimiento'));
app.use('/api/simulador-dotacion', moduloRequerido('requerimiento'));
// Sin cache: el desglose por_turno cambia seguido (nuevos registros de
// requerimiento, marcaciones del día) y una respuesta vieja en caché del
// navegador puede faltarle campos que se agregaron después.
app.use('/api/simulador-dotacion', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api/actualizar', moduloRequerido('actualizacion'));
app.use('/api/importar', moduloRequerido('carga'));
app.use('/api/jefe-turno', moduloRequerido('asignacion'));
app.use('/api/anticipos', moduloRequerido('anticipos'));

// Marcación móvil: '/mi' es para el trabajador (login con RUT+PIN propio,
// no el token de staff), '/admin' es para RRHH (login normal + módulo
// 'marcacionMovil'). requireSoloTrabajador ya rechaza un token de staff (sin
// 'tipo'); acá se agrega el chequeo inverso de forma explícita, como defensa
// en profundidad, para que un token de trabajador nunca llegue a evaluarse
// contra moduloRequerido (que lo rechazaría igual al no tener 'rol', pero
// así queda escrito el porqué en vez de depender de un efecto colateral).
app.use('/api/movil/mi', requireSoloTrabajador);
app.use('/api/movil/admin', (req, res, next) => {
  if (req.usuario.tipo === 'trabajador') {
    return res.status(403).json({ error: 'Esta ruta es solo para personal administrativo' });
  }
  next();
}, moduloRequerido('marcacionMovil'));

// --- Marcación móvil: trabajador ---

app.put('/api/movil/mi/pin', async (req, res) => {
  try {
    const { pinActual, pinNuevo } = req.body;
    if (!pinActual || !pinNuevo) return res.status(400).json({ error: 'pinActual y pinNuevo son requeridos' });
    const resultado = await cambiarPinPropio(pool, req.trabajador.rut, pinActual, pinNuevo);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/movil/mi/marcaciones', uploadFotoMovil.single('foto'), async (req, res) => {
  try {
    const { tipo } = req.body;
    const lat = Number(req.body.lat);
    const lng = Number(req.body.lng);

    let fotoBuffer = null;
    let fotoMime = null;
    if (req.file) {
      fotoBuffer = fs.readFileSync(req.file.path);
      fotoMime = req.file.mimetype;
      fs.unlink(req.file.path, () => {}); // limpia el archivo temporal, ya quedó en la base
    }

    const resultado = await registrarMarcacion(pool, { rut: req.trabajador.rut, tipo, lat, lng, fotoBuffer, fotoMime });
    if (!resultado.ok) return res.status(resultado.status || 400).json(resultado);
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/movil/mi/marcaciones', async (req, res) => {
  try {
    const { desde, hasta } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
    const filas = await listarMarcacionesPropias(pool, req.trabajador.rut, desde, hasta);
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Marcación móvil: administración (RRHH) ---

app.get('/api/movil/admin/cds', async (req, res) => {
  try {
    res.json(await listarCdsMovil(pool));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/movil/admin/cds', async (req, res) => {
  try {
    const { nombre, lat, lng, radio_metros } = req.body;
    if (!nombre || typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'nombre, lat y lng son requeridos' });
    }
    const cd = await crearCdMovil(pool, { nombre, lat, lng, radio_metros, adminNombre: req.usuario.nombre });
    res.json(cd);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/movil/admin/cds/:nombre', async (req, res) => {
  try {
    const cd = await actualizarCdMovil(pool, req.params.nombre, req.body);
    if (!cd) return res.status(404).json({ error: 'CD no encontrado' });
    res.json(cd);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/movil/admin/cds/:nombre', async (req, res) => {
  try {
    const eliminado = await eliminarCdMovil(pool, req.params.nombre);
    if (!eliminado) return res.status(404).json({ error: 'CD no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/movil/admin/trabajadores', async (req, res) => {
  try {
    res.json(await listarTrabajadoresConCredencial(pool));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/movil/admin/trabajadores/:rut/pin', async (req, res) => {
  try {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'pin es requerido' });
    const resultado = await asignarPin(pool, req.params.rut, pin, req.usuario.nombre);
    if (!resultado.ok) return res.status(400).json({ error: resultado.error });
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/movil/admin/reporte', async (req, res) => {
  try {
    const { desde, hasta, rut, cd, soloFueraRadio } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
    const filas = await generarReporteMovil(pool, { desde, hasta, rut, cd, soloFueraRadio: soloFueraRadio === 'true' });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/movil/admin/marcaciones/:id/foto', async (req, res) => {
  try {
    const foto = await obtenerFotoMarcacion(pool, req.params.id);
    if (!foto || !foto.foto) return res.status(404).json({ error: 'Sin foto para esta marcación' });
    res.set('Content-Type', foto.foto_mime || 'image/jpeg');
    res.send(foto.foto);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Anticipos de sueldo ---
// Sin persistencia: se sube el Excel, se valida contra faltas injustificadas
// del mes en curso, y se devuelve el resultado o el reporte descargable —
// no queda nada guardado en la base entre una carga y otra.

app.post('/api/anticipos/validar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo Excel' });
    const filas = parseAnticiposExcel(req.file.path);
    fs.unlink(req.file.path, () => {});
    if (filas.length === 0) {
      return res.status(400).json({ error: 'El archivo no tiene filas válidas — revisa que tenga columnas RUT, Nombre, Cargo y Monto' });
    }
    const validados = await validarAnticipos(pool, filas);
    res.json({ ok: true, filas: validados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/anticipos/exportar', upload.single('archivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo Excel' });
    const filas = parseAnticiposExcel(req.file.path);
    fs.unlink(req.file.path, () => {});
    if (filas.length === 0) {
      return res.status(400).json({ error: 'El archivo no tiene filas válidas — revisa que tenga columnas RUT, Nombre, Cargo y Monto' });
    }
    const buffer = await exportarAnticiposXlsx(pool, filas);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ValidacionAnticipos_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
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

// Fuerza el recálculo completo de "Resultados" usando los datos ACTUALES de
// rotación/horario plano — útil si se hicieron varios cambios y se quiere
// asegurar que todo (Resultados, Indicadores, Dashboard) quede sincronizado
// de una vez, sin depender de que cada guardado individual lo haya disparado.
app.post('/api/resultados/recalcular', moduloRequerido('asignacion'), async (req, res) => {
  try {
    await calcularResultados(pool);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/resultados', async (req, res) => {
  try {
    const { rut, desde, hasta, soloAtrasos, soloInconsistencias, jefeTurno, cd } = req.query;
    const cdsFiltro = await resolverCdsFiltro(req, cd);

    let sql = `SELECT r.* FROM resultado_diario r`;
    if (jefeTurno) sql += ` JOIN jefe_turno_asignacion jt ON jt.rut = r.rut`;
    if (cdsFiltro) sql += ` JOIN empleados emp_cd ON emp_cd.rut = r.rut`;
    sql += ' WHERE 1=1';
    const params = [];

    if (rut) { params.push(rut); sql += ` AND r.rut = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND r.fecha >= $${params.length}`; }
    if (hasta) { params.push(hasta); sql += ` AND r.fecha <= $${params.length}`; }
    if (soloAtrasos === 'true') sql += ' AND r.minutos_atraso > 0';
    if (soloInconsistencias === 'true') sql += ' AND r.inconsistencia IS NOT NULL';
    if (jefeTurno) { params.push(jefeTurno); sql += ` AND jt.jefe_turno = $${params.length}`; }
    if (cdsFiltro) { params.push(cdsFiltro); sql += ` AND emp_cd.cd = ANY($${params.length}::text[])`; }

    sql += ' ORDER BY r.fecha DESC, r.rut LIMIT 1000';

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/resultados/export', async (req, res) => {
  try {
    const { rut, desde, hasta, soloAtrasos, soloInconsistencias, jefeTurno, cd } = req.query;
    const cdsFiltro = await resolverCdsFiltro(req, cd);

    let sql = `SELECT r.* FROM resultado_diario r`;
    if (jefeTurno) sql += ` JOIN jefe_turno_asignacion jt ON jt.rut = r.rut`;
    if (cdsFiltro) sql += ` JOIN empleados emp_cd ON emp_cd.rut = r.rut`;
    sql += ' WHERE 1=1';
    const params = [];

    if (rut) { params.push(rut); sql += ` AND r.rut = $${params.length}`; }
    if (desde) { params.push(desde); sql += ` AND r.fecha >= $${params.length}`; }
    if (hasta) { params.push(hasta); sql += ` AND r.fecha <= $${params.length}`; }
    if (soloAtrasos === 'true') sql += ' AND r.minutos_atraso > 0';
    if (soloInconsistencias === 'true') sql += ' AND r.inconsistencia IS NOT NULL';
    if (jefeTurno) { params.push(jefeTurno); sql += ` AND jt.jefe_turno = $${params.length}`; }
    if (cdsFiltro) { params.push(cdsFiltro); sql += ` AND emp_cd.cd = ANY($${params.length}::text[])`; }

    sql += ' ORDER BY r.fecha, r.rut'; // sin límite, para exportar todo lo filtrado

    const { rows } = await pool.query(sql, params);

    const encabezado = ['RUT', 'Nombre', 'Fecha', 'Talana', 'Cencosud', 'Cruce', 'Entrada real', 'Entrada esperada', 'Atraso (min)', 'Salida real', 'Horas trabajadas'];
    const datos = rows.map(r => [
      r.rut, r.nombre, r.fecha,
      r.marco_talana ? 'Sí' : 'No', r.marco_cencosud ? 'Sí' : 'No', r.inconsistencia || 'OK',
      r.hora_entrada_real || '—', r.hora_entrada_esperada || '—', r.minutos_atraso ?? '—',
      r.hora_salida_real || '—', r.horas_trabajadas ?? '—',
    ]);

    const ws = XLSX.utils.aoa_to_sheet([
      [`Resultados de Asistencia — ${desde || 'Inicio'} a ${hasta || 'Hoy'}`],
      [`${rows.length} registro(s)`],
      [],
      encabezado,
      ...datos,
    ]);
    const nCols = encabezado.length;
    ws['!autofilter'] = { ref: `A4:${XLSX.utils.encode_col(nCols - 1)}${datos.length + 4}` };
    ws['!views'] = [{ state: 'frozen', ySplit: 4 }];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: nCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: nCols - 1 } },
    ];
    ws['!cols'] = [
      { wch: 13 }, { wch: 26 }, { wch: 12 }, { wch: 8 }, { wch: 9 }, { wch: 10 },
      { wch: 12 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 15 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Resultados');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ResultadosAsistencia_${desde || 'inicio'}_a_${hasta || 'hoy'}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Fuero Maternal (Art. 201 Código del Trabajo) ---
// Dato sensible: acceso restringido al módulo "fueroMaternal".

async function fueroVigente(pool, rut, fecha) {
  const { rows } = await pool.query(
    `SELECT id, fecha_inicio_fuero, fecha_termino_fuero FROM fuero_maternal
     WHERE rut = $1 AND fecha_inicio_fuero <= $2 AND (fecha_termino_fuero IS NULL OR fecha_termino_fuero >= $2)
     ORDER BY fecha_inicio_fuero DESC LIMIT 1`,
    [rut, fecha]
  );
  return rows[0] || null;
}

app.get('/api/fuero-maternal', moduloRequerido('fueroMaternal'), async (req, res) => {
  try {
    const hoy = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT f.*, e.nombre, e.apellido_paterno, e.cargo, e.cd,
              (f.fecha_inicio_fuero <= $1 AND (f.fecha_termino_fuero IS NULL OR f.fecha_termino_fuero >= $1)) AS vigente
       FROM fuero_maternal f
       LEFT JOIN empleados e ON e.rut = f.rut
       ORDER BY vigente DESC, f.fecha_inicio_fuero DESC`,
      [hoy]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fuero-maternal', moduloRequerido('fueroMaternal'), async (req, res) => {
  try {
    const { rut, fecha_probable_parto, fecha_inicio_fuero, fecha_termino_fuero, fecha_parto_real, restriccion_turno, observaciones } = req.body;
    if (!rut || !fecha_inicio_fuero) {
      return res.status(400).json({ error: 'rut y fecha_inicio_fuero son requeridos' });
    }
    await pool.query(
      `INSERT INTO fuero_maternal (rut, fecha_probable_parto, fecha_inicio_fuero, fecha_termino_fuero, fecha_parto_real, restriccion_turno, observaciones, registrado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [rut, fecha_probable_parto || null, fecha_inicio_fuero, fecha_termino_fuero || null, fecha_parto_real || null,
       !!restriccion_turno, observaciones || null, req.usuario.nombre || req.usuario.usuario]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/fuero-maternal/:id', moduloRequerido('fueroMaternal'), async (req, res) => {
  try {
    const { fecha_probable_parto, fecha_inicio_fuero, fecha_termino_fuero, fecha_parto_real, restriccion_turno, observaciones } = req.body;
    await pool.query(
      `UPDATE fuero_maternal SET
         fecha_probable_parto = COALESCE($1, fecha_probable_parto),
         fecha_inicio_fuero = COALESCE($2, fecha_inicio_fuero),
         fecha_termino_fuero = $3,
         fecha_parto_real = COALESCE($4, fecha_parto_real),
         restriccion_turno = COALESCE($5, restriccion_turno),
         observaciones = COALESCE($6, observaciones)
       WHERE id = $7`,
      [fecha_probable_parto, fecha_inicio_fuero, fecha_termino_fuero, fecha_parto_real, restriccion_turno, observaciones, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/fuero-maternal/:id', moduloRequerido('fueroMaternal'), async (req, res) => {
  try {
    await pool.query('DELETE FROM fuero_maternal WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Cartas de Amonestación ---

// --- Catálogo de Motivos (Motivo -> Causal reutilizable) ---

app.get('/api/motivos-amonestacion', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM motivos_amonestacion ORDER BY motivo');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/motivos-amonestacion', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    const { motivo, causal, autocompletar_atrasos } = req.body;
    if (!motivo || !motivo.trim() || !causal || !causal.trim()) {
      return res.status(400).json({ error: 'motivo y causal son requeridos' });
    }
    await pool.query(
      `INSERT INTO motivos_amonestacion (motivo, causal, autocompletar_atrasos, creado_por) VALUES ($1,$2,$3,$4)
       ON CONFLICT (motivo) DO UPDATE SET causal = EXCLUDED.causal, autocompletar_atrasos = EXCLUDED.autocompletar_atrasos`,
      [motivo.trim(), causal.trim(), !!autocompletar_atrasos, req.usuario.nombre || req.usuario.usuario]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/motivos-amonestacion/:id', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    await pool.query('DELETE FROM motivos_amonestacion WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/amonestaciones', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    const { rut } = req.query;
    let sql = `SELECT id, rut, fecha, motivo, causal, generado_por, creado_en FROM amonestaciones WHERE 1=1`;
    const params = [];
    if (rut) { params.push(rut); sql += ` AND rut = $${params.length}`; }
    sql += ' ORDER BY fecha DESC, creado_en DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/amonestaciones', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    const { rut, fecha, motivo, causal, direccion, comuna, tabla_atrasos } = req.body;
    if (!rut || !fecha || !causal || !causal.trim()) {
      return res.status(400).json({ error: 'rut, fecha y causal son requeridos' });
    }
    const { rows: empRows } = await pool.query(
      'SELECT nombre, apellido_paterno, apellido_materno, direccion, comuna FROM empleados WHERE rut = $1',
      [rut]
    );
    if (empRows.length === 0) return res.status(404).json({ error: 'Trabajador no encontrado' });
    const emp = empRows[0];
    const nombreCompleto = `${emp.nombre} ${emp.apellido_paterno || ''} ${emp.apellido_materno || ''}`.replace(/\s+/g, ' ').trim();
    const direccionFinal = direccion || emp.direccion || '';
    const comunaFinal = comuna || emp.comuna || '';

    const pdfBuffer = await generarAmonestacionPDF({
      nombreTrabajador: nombreCompleto,
      run: rut,
      direccion: direccionFinal,
      comuna: comunaFinal,
      fecha,
      causal: causal.trim(),
      tablaAtrasos: Array.isArray(tabla_atrasos) ? tabla_atrasos : null,
    });
    const docxBuffer = await generarAmonestacionDOCX({
      nombreTrabajador: nombreCompleto,
      run: rut,
      direccion: direccionFinal,
      comuna: comunaFinal,
      fecha,
      causal: causal.trim(),
      tablaAtrasos: Array.isArray(tabla_atrasos) ? tabla_atrasos : null,
    });

    // Guarda la dirección/comuna en la ficha del trabajador si no las tenía,
    // para no tener que volver a escribirlas la próxima vez.
    if (direccion && !emp.direccion) await pool.query('UPDATE empleados SET direccion = $1 WHERE rut = $2', [direccion, rut]);
    if (comuna && !emp.comuna) await pool.query('UPDATE empleados SET comuna = $1 WHERE rut = $2', [comuna, rut]);

    const { rows } = await pool.query(
      `INSERT INTO amonestaciones (rut, fecha, motivo, causal, direccion, comuna, pdf_contenido, docx_contenido, generado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [rut, fecha, motivo || null, causal.trim(), direccionFinal, comunaFinal, pdfBuffer, docxBuffer, req.usuario.nombre || req.usuario.usuario]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Detalle de días con atraso (marca de Talana) del trabajador en el último
// mes — usado para autocompletar el causal de amonestaciones por atrasos
// reiterados. Aplica el mismo umbral de tolerancia que el resto del sistema
// (16+ minutos de diferencia cuenta como atraso).
app.get('/api/amonestaciones/atrasos-detalle', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    const { rut, hasta } = req.query;
    if (!rut) return res.status(400).json({ error: 'rut es requerido' });
    const fechaHasta = hasta || new Date().toISOString().slice(0, 10);
    const fechaDesde = `${fechaHasta.slice(0, 7)}-01`; // 1° del mes en curso (según la fecha de la carta)

    const filas = await generarDetalleMarcaciones(pool, { rut, desde: fechaDesde, hasta: fechaHasta }, Infinity);
    const atrasos = filas
      .filter(f => f.entrada_mpg && f.hora_entrada_esperada)
      .map(f => {
        const [he, me] = f.hora_entrada_esperada.split(':').map(Number);
        const [hr, mr] = f.entrada_mpg.split(':').map(Number);
        const diffMin = (hr * 60 + mr) - (he * 60 + me);
        // Mismo criterio que el resto del sistema: solo cuenta desde el
        // minuto 16, y el atraso mostrado es el EXCESO sobre los 15 minutos
        // de tolerancia (no la diferencia completa).
        const minutosAtraso = diffMin >= 16 ? diffMin - 15 : 0;
        return {
          fecha: f.fecha, hora_entrada_esperada: f.hora_entrada_esperada.slice(0, 5),
          entrada_real: f.entrada_mpg.slice(0, 5), minutos_atraso: minutosAtraso,
        };
      })
      .filter(f => f.minutos_atraso > 0)
      .sort((a, b) => a.fecha.localeCompare(b.fecha));

    res.json(atrasos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/amonestaciones/:id/pdf', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT rut, fecha, pdf_contenido FROM amonestaciones WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Amonestacion_${rows[0].rut}_${rows[0].fecha}.pdf"`);
    res.send(rows[0].pdf_contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/amonestaciones/:id/docx', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT rut, fecha, docx_contenido FROM amonestaciones WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    if (!rows[0].docx_contenido) return res.status(404).json({ error: 'Esta carta se generó antes de tener la versión en Word. Vuelve a generarla para obtenerla en ambos formatos.' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Amonestacion_${rows[0].rut}_${rows[0].fecha}.docx"`);
    res.send(rows[0].docx_contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/amonestaciones/:id', moduloRequerido('amonestaciones'), async (req, res) => {
  try {
    await pool.query('DELETE FROM amonestaciones WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Feriados de Chile ---

app.get('/api/feriados', moduloRequerido('feriados'), async (req, res) => {
  try {
    const { anio } = req.query;
    let sql = 'SELECT * FROM feriados';
    const params = [];
    if (anio) { params.push(`${anio}-%`); sql += ' WHERE fecha LIKE $1'; }
    sql += ' ORDER BY fecha';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Consulta la API pública de feriados para un año — devuelve la lista SIN
// guardar nada, para que se revise/edite antes de confirmar.
app.get('/api/feriados/previsualizar-api', moduloRequerido('feriados'), async (req, res) => {
  try {
    const anio = Number(req.query.anio);
    if (!anio || anio < 2000 || anio > 2100) return res.status(400).json({ error: 'anio inválido' });
    const feriados = await obtenerFeriadosDesdeApi(anio);
    res.json(feriados);
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: `No se pudo consultar la API de feriados: ${err.message}` });
  }
});

// Guarda (o actualiza) una lista de feriados de una sola vez — usado tanto
// tras revisar la carga automática, como para registrar varios a mano.
app.post('/api/feriados/confirmar', moduloRequerido('feriados'), async (req, res) => {
  try {
    const { feriados } = req.body;
    if (!Array.isArray(feriados) || feriados.length === 0) {
      return res.status(400).json({ error: 'feriados debe ser un arreglo con al menos un elemento' });
    }
    const creadoPor = req.usuario.nombre || req.usuario.usuario;
    let guardados = 0;
    for (const f of feriados) {
      if (!f.fecha || !f.nombre) continue;
      await pool.query(
        `INSERT INTO feriados (fecha, nombre, irrenunciable, creado_por) VALUES ($1,$2,$3,$4)
         ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre, irrenunciable = EXCLUDED.irrenunciable`,
        [f.fecha, f.nombre, !!f.irrenunciable, creadoPor]
      );
      guardados++;
    }
    res.json({ ok: true, guardados });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/feriados', moduloRequerido('feriados'), async (req, res) => {
  try {
    const { fecha, nombre, irrenunciable } = req.body;
    if (!fecha || !nombre) return res.status(400).json({ error: 'fecha y nombre son requeridos' });
    await pool.query(
      `INSERT INTO feriados (fecha, nombre, irrenunciable, creado_por) VALUES ($1,$2,$3,$4)
       ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre, irrenunciable = EXCLUDED.irrenunciable`,
      [fecha, nombre, !!irrenunciable, req.usuario.nombre || req.usuario.usuario]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/feriados/:fecha', moduloRequerido('feriados'), async (req, res) => {
  try {
    await pool.query('DELETE FROM feriados WHERE fecha = $1', [req.params.fecha]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
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
    const { fecha, excluirAreas, cd } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro fecha (YYYY-MM-DD)' });
    const areasExcluidas = excluirAreas ? excluirAreas.split(',').filter(Boolean) : [];
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const filas = await generarReporteDiario(pool, fecha, { excluirAreas: areasExcluidas, cds: cdsFiltro });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reporte-diario/export', async (req, res) => {
  try {
    const { fecha, excluirAreas, cd } = req.query;
    if (!fecha) return res.status(400).json({ error: 'Falta el parámetro fecha (YYYY-MM-DD)' });
    const areasExcluidas = excluirAreas ? excluirAreas.split(',').filter(Boolean) : [];
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarReporteDiarioXlsx(pool, fecha, { excluirAreas: areasExcluidas, cds: cdsFiltro });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ReporteDiario_${fecha}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reporte-diario/atrasos', moduloRequerido('reporte'), async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const filas = await calcularReporteAtrasos(pool, { desde, hasta, cds: cdsFiltro });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reporte-diario/atrasos/export', moduloRequerido('reporte'), async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarReporteAtrasosXlsx(pool, { desde, hasta, cds: cdsFiltro });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="TrabajadoresConAtrasos_${desde}_a_${hasta}.xlsx"`);
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
    const { rut, desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const filas = await generarDetalleMarcaciones(pool, { rut, desde, hasta, cds: cdsFiltro });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/detalle-marcaciones/export', async (req, res) => {
  try {
    const { rut, desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarDetalleMarcacionesXlsx(pool, { rut, desde, hasta, cds: cdsFiltro });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="DetalleMarcaciones_${desde}_a_${hasta}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cierre-nomina', async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const filas = await calcularCierreNomina(pool, { desde, hasta, cds: cdsFiltro });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/cierre-nomina/export', async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarCierreNominaXlsx(pool, { desde, hasta, cds: cdsFiltro });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="CierreNomina_${desde}_a_${hasta}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function parseDiasSemanaQuery(diasSemana) {
  return diasSemana ? diasSemana.split(',').filter(Boolean) : null;
}

app.get('/api/horas-extras', async (req, res) => {
  try {
    const { desde, hasta, diasSemana, turnos, cd, soloAutorizadas } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const filas = await calcularReporteHorasExtras(pool, {
      desde, hasta, diasSemana: parseDiasSemanaQuery(diasSemana), turnos: parseDiasSemanaQuery(turnos),
      cds: cdsFiltro, soloAutorizadas: soloAutorizadas === 'true',
    });
    res.json(filas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/horas-extras/export', async (req, res) => {
  try {
    const { desde, hasta, diasSemana, turnos, cd, soloAutorizadas } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarReporteHorasExtrasXlsx(pool, {
      desde, hasta, diasSemana: parseDiasSemanaQuery(diasSemana), turnos: parseDiasSemanaQuery(turnos),
      cds: cdsFiltro, soloAutorizadas: soloAutorizadas === 'true',
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="HorasExtras_${desde}_a_${hasta}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/horas-extras/export-pdf', async (req, res) => {
  try {
    const { desde, hasta, diasSemana, turnos, cd, soloAutorizadas } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarReporteHorasExtrasPdf(pool, {
      desde, hasta, diasSemana: parseDiasSemanaQuery(diasSemana), turnos: parseDiasSemanaQuery(turnos),
      cds: cdsFiltro, soloAutorizadas: soloAutorizadas === 'true',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="HorasExtras_${desde}_a_${hasta}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// PDF con una sección por trabajador (para imprimir y validar/firmar con
// cada uno) en vez de la tabla larga de export-pdf.
app.get('/api/horas-extras/export-pdf-trabajador', async (req, res) => {
  try {
    const { desde, hasta, diasSemana, turnos, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarReporteHorasExtrasPorTrabajadorPdf(pool, {
      desde, hasta, diasSemana: parseDiasSemanaQuery(diasSemana), turnos: parseDiasSemanaQuery(turnos),
      cds: cdsFiltro,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="HorasExtrasPorTrabajador_${desde}_a_${hasta}.pdf"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Lista los días/trabajadores que llegaron antes de su horario esperado
// (candidatos a autorización de hora extra anticipada), con su estado actual.
app.get('/api/horas-extras/candidatos-autorizacion', async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const filas = await generarDetalleMarcaciones(pool, { desde, hasta, cds: cdsFiltro }, Infinity);
    const candidatos = filas
      .filter(f => f.minutos_anticipados > 0)
      .map(f => ({
        fecha: f.fecha, rut: f.rut, nombre: f.nombre, cargo: f.cargo, turno: f.turno,
        entrada_real: f.entrada_mpg, hora_entrada_esperada: f.hora_entrada_esperada,
        minutos_anticipados: f.minutos_anticipados, autorizado: f.anticipado_autorizado,
      }))
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.nombre || '').localeCompare(b.nombre || ''));
    res.json(candidatos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Autoriza (o quita la autorización de) la hora extra anticipada de un
// trabajador en una fecha específica.
app.post('/api/horas-extras/autorizar', moduloRequerido('horasExtras'), async (req, res) => {
  try {
    const { rut, fecha, autorizado, observacion } = req.body;
    if (!rut || !fecha || typeof autorizado !== 'boolean') {
      return res.status(400).json({ error: 'rut, fecha y autorizado (true/false) son requeridos' });
    }
    await pool.query(
      `INSERT INTO horas_extras_autorizacion (rut, fecha, autorizado, autorizado_por, autorizado_en, observacion)
       VALUES ($1,$2,$3,$4,now(),$5)
       ON CONFLICT (rut, fecha) DO UPDATE SET
         autorizado = EXCLUDED.autorizado, autorizado_por = EXCLUDED.autorizado_por,
         autorizado_en = EXCLUDED.autorizado_en, observacion = EXCLUDED.observacion`,
      [rut, fecha, autorizado, req.usuario.nombre || req.usuario.usuario, observacion || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Horas extras ORDINARIAS (minutos trabajados después de la hora de
// salida esperada): a diferencia de las anticipadas, sí tienen flujo de
// solicitud (Jefe de Turno) + aprobación (Jefe de Operaciones o admin). ---

// Lista los días/trabajadores con minutos trabajados después de su horario
// de salida esperado (candidatos a hora extra ordinaria), con su estado
// actual de solicitud/aprobación. Visible para quien pueda solicitar O
// aprobar (no hace falta tener ambos permisos para ver la lista).
app.get('/api/horas-extras/ordinarias/candidatos', algunModuloRequerido(['horasExtrasSolicitar', 'horasExtrasAprobar']), async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const filas = await generarDetalleMarcaciones(pool, { desde, hasta, cds: cdsFiltro }, Infinity);

    const { rows: estadosRows } = await pool.query(
      `SELECT rut, fecha, estado, solicitado_por, solicitado_en, observacion_solicitud,
              resuelto_por, resuelto_en, observacion_resolucion
       FROM horas_extras_ordinarias_autorizacion WHERE fecha BETWEEN $1 AND $2`,
      [desde, hasta]
    );
    const estadoPorClave = new Map(estadosRows.map(r => [`${r.rut}|${r.fecha}`, r]));

    const candidatos = filas
      .filter(f => f.minutos_extra_final > 0)
      .map(f => {
        const info = estadoPorClave.get(`${f.rut}|${f.fecha}`);
        return {
          fecha: f.fecha, rut: f.rut, nombre: f.nombre, cargo: f.cargo, turno: f.turno,
          salida_real: f.salida_mpg, hora_salida_esperada: f.hora_salida_esperada,
          minutos_extra: f.minutos_extra_final,
          estado: info?.estado || 'pendiente',
          solicitado_por: info?.solicitado_por || null,
          solicitado_en: info?.solicitado_en || null,
          observacion_solicitud: info?.observacion_solicitud || null,
          resuelto_por: info?.resuelto_por || null,
          resuelto_en: info?.resuelto_en || null,
          observacion_resolucion: info?.observacion_resolucion || null,
        };
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.nombre || '').localeCompare(b.nombre || ''));
    res.json(candidatos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// El Jefe de Turno (u otro rol con el permiso) solicita la autorización de
// la hora extra ordinaria de un trabajador en una fecha específica.
app.post('/api/horas-extras/ordinarias/solicitar', moduloRequerido('horasExtrasSolicitar'), async (req, res) => {
  try {
    const { rut, fecha, observacion } = req.body;
    if (!rut || !fecha) return res.status(400).json({ error: 'rut y fecha son requeridos' });
    await pool.query(
      `INSERT INTO horas_extras_ordinarias_autorizacion (rut, fecha, estado, solicitado_por, solicitado_en, observacion_solicitud)
       VALUES ($1,$2,'solicitado',$3,now(),$4)
       ON CONFLICT (rut, fecha) DO UPDATE SET
         estado = 'solicitado', solicitado_por = EXCLUDED.solicitado_por,
         solicitado_en = EXCLUDED.solicitado_en, observacion_solicitud = EXCLUDED.observacion_solicitud`,
      [rut, fecha, req.usuario.nombre || req.usuario.usuario, observacion || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// El Jefe de Operaciones (u otro rol con el permiso) o un admin aprueba,
// rechaza, o revierte a pendiente (decision: 'autorizado' | 'rechazado' |
// 'pendiente') la hora extra ordinaria de un trabajador en una fecha —
// puede resolverla directamente aunque nunca haya sido solicitada.
app.post('/api/horas-extras/ordinarias/resolver', moduloRequerido('horasExtrasAprobar'), async (req, res) => {
  try {
    const { rut, fecha, decision, observacion } = req.body;
    const DECISIONES_VALIDAS = ['autorizado', 'rechazado', 'pendiente'];
    if (!rut || !fecha || !DECISIONES_VALIDAS.includes(decision)) {
      return res.status(400).json({ error: "rut, fecha y decision ('autorizado'|'rechazado'|'pendiente') son requeridos" });
    }
    if (decision === 'pendiente') {
      await pool.query('DELETE FROM horas_extras_ordinarias_autorizacion WHERE rut = $1 AND fecha = $2', [rut, fecha]);
    } else {
      await pool.query(
        `INSERT INTO horas_extras_ordinarias_autorizacion (rut, fecha, estado, resuelto_por, resuelto_en, observacion_resolucion)
         VALUES ($1,$2,$3,$4,now(),$5)
         ON CONFLICT (rut, fecha) DO UPDATE SET
           estado = EXCLUDED.estado, resuelto_por = EXCLUDED.resuelto_por,
           resuelto_en = EXCLUDED.resuelto_en, observacion_resolucion = EXCLUDED.observacion_resolucion`,
        [rut, fecha, decision, req.usuario.nombre || req.usuario.usuario, observacion || null]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/api/marcas-abiertas', moduloRequerido('dashboard'), async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const datos = await calcularMarcasAbiertas(pool, { desde, hasta, cds: cdsFiltro });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/marcas-abiertas/export', moduloRequerido('dashboard'), async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarMarcasAbiertasXlsx(pool, { desde, hasta, cds: cdsFiltro });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="MarcasAbiertas_${desde}_a_${hasta}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ausentismo-recurrente', moduloRequerido('dashboard'), async (req, res) => {
  try {
    const { mesesAtras, cd } = req.query;
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const datos = await calcularAusentismoUltimaSemana(pool, {
      mesesAtras: mesesAtras ? Number(mesesAtras) : 6,
      cds: cdsFiltro,
    });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Informe de análisis con IA (rotación de personal + ausentismo) ---
// Se genera bajo demanda (botón), recomendado la última semana de cada mes;
// no hay ningún job automático que llame a la API de IA por su cuenta.

app.get('/api/analisis-ia/historial', moduloRequerido('dashboard'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, periodo, generado_por, creado_en FROM informes_ia ORDER BY creado_en DESC LIMIT 24'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/analisis-ia/historial/:id', moduloRequerido('dashboard'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, periodo, narrativa, datos, generado_por, creado_en FROM informes_ia WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Informe no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/analisis-ia/generar', moduloRequerido('dashboard'), async (req, res) => {
  try {
    const { mesesAtras, cd } = req.body || {};
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const resultado = await generarInformeIA(pool, {
      mesesAtras: mesesAtras ? Number(mesesAtras) : 6,
      cds: cdsFiltro,
    });
    const { rows } = await pool.query(
      `INSERT INTO informes_ia (periodo, narrativa, datos, generado_por) VALUES ($1,$2,$3,$4)
       RETURNING id, creado_en`,
      [resultado.periodo, resultado.narrativa, JSON.stringify(resultado.datos), req.usuario.usuario]
    );
    res.json({
      ok: true, id: rows[0].id, periodo: resultado.periodo,
      narrativa: resultado.narrativa, datos: resultado.datos, creado_en: rows[0].creado_en,
    });
  } catch (err) {
    console.error(err);
    if (err.sinApiKey) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Error al generar el informe con IA' });
  }
});

app.get('/api/indicadores', async (req, res) => {
  try {
    const { desde, hasta, area, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const datos = await calcularIndicadores(pool, { desde, hasta, area, cds: cdsFiltro });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indicadores/serie-cumplimiento', async (req, res) => {
  try {
    const { desde, hasta, cargo, jefesTurno, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
    const listaJefes = jefesTurno ? jefesTurno.split(',').filter(Boolean) : null;
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const datos = await calcularSerieCumplimiento(pool, { desde, hasta, cargo: cargo || null, jefesTurno: listaJefes, cds: cdsFiltro });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indicadores/resumen-area', async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const datos = await calcularResumenAsistenciaArea(pool, { desde, hasta, cds: cdsFiltro });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indicadores/ausentismo-diario', async (req, res) => {
  try {
    const { desde, hasta, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const datos = await calcularAusentismoPorTipoDiario(pool, { desde, hasta, cds: cdsFiltro });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/indicadores/cargos-dashboard', (req, res) => {
  res.json(CARGOS_DASHBOARD);
});

app.get('/api/indicadores/presentismo-historico', async (req, res) => {
  try {
    const { meses, jefesTurno, cd } = req.query;
    if (!meses) return res.status(400).json({ error: 'meses es requerido (ej: 2026-01,2026-02,2026-03)' });
    const listaMeses = meses.split(',').filter(Boolean);
    if (listaMeses.length !== 3) return res.status(400).json({ error: 'Debes indicar exactamente 3 meses (un trimestre)' });
    const listaJefes = jefesTurno ? jefesTurno.split(',').filter(Boolean) : null;
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    // Esta vista trabaja con un solo CD a la vez (o "Todos" si no hay filtro
    // activo ni seleccionado) — si el usuario está restringido a más de un
    // CD, se usa el primero permitido como valor por defecto.
    const cdUsado = cdsFiltro && cdsFiltro.length > 0 ? cdsFiltro[0] : null;
    const datos = await calcularPresentismoHistorico(pool, { meses: listaMeses, jefesTurno: listaJefes, cd: cdUsado });
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
    const { desde, hasta, area, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const datos = await calcularMatrizAsistencia(pool, { desde, hasta, area, cds: cdsFiltro });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/dashboard-asistencia/export', async (req, res) => {
  try {
    const { desde, hasta, area, cd } = req.query;
    if (!desde || !hasta) return res.status(400).json({ error: 'desde y hasta son requeridos (YYYY-MM-DD)' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    const buffer = await exportarMatrizAsistenciaXlsx(pool, { desde, hasta, area, cds: cdsFiltro });
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
    const { cargo, cd } = req.query;
    let sql = 'SELECT * FROM requerimiento_dotacion WHERE 1=1';
    const params = [];
    if (cargo) { params.push(cargo); sql += ` AND cargo = $${params.length}`; }
    if (cd) { params.push(cd); sql += ` AND cd = $${params.length}`; }
    sql += ' ORDER BY cargo, vigente_desde DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// El requerimiento vigente de cada cargo+turno+CD a una fecha dada (el último
// cambio cuya "vigente_desde" sea igual o anterior a esa fecha, para ese CD).
app.get('/api/requerimiento-dotacion/vigente', async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
    const { cd } = req.query;
    if (!cd) return res.status(400).json({ error: 'cd es requerido' });
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (cargo, turno) cargo, turno, cd, cantidad_requerida, vigente_desde, vigente_hasta, observacion
       FROM requerimiento_dotacion
       WHERE cd = $1 AND vigente_desde <= $2 AND (vigente_hasta IS NULL OR vigente_hasta >= $2)
       ORDER BY cargo, turno, vigente_desde DESC`,
      [cd, fecha]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Matriz de TODOS los cargos de un CD de una sola vez: requerido actual,
// ausentismo histórico, dotación activa y frecuencia de sobredotación real
// (para no tener que simular cargo por cargo).
app.get('/api/simulador-dotacion/matriz', async (req, res) => {
  try {
    const { cd, dias, cargos } = req.query;
    if (!cd) return res.status(400).json({ error: 'cd es requerido' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    if (cdsFiltro && cdsFiltro.length === 0) return res.status(403).json({ error: 'No tienes acceso a este CD' });

    const datos = await calcularMatrizDotacion(pool, {
      cd, dias: dias ? Number(dias) : undefined,
      cargos: cargos ? cargos.split(',').map(c => c.trim()).filter(Boolean) : undefined,
    });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Detalle Lunes a Sábado × AM/PM/NOCHE/PLANO de un cargo puntual (se pide al
// hacer clic en una fila de la matriz, no viene precargado para todos).
app.get('/api/simulador-dotacion/detalle-dia-turno', async (req, res) => {
  try {
    const { cargo, cd, dias } = req.query;
    if (!cargo || !cd) return res.status(400).json({ error: 'cargo y cd son requeridos' });
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    if (cdsFiltro && cdsFiltro.length === 0) return res.status(403).json({ error: 'No tienes acceso a este CD' });

    const datos = await calcularDetalleDiaTurno(pool, { cargo, cd, dias: dias ? Number(dias) : undefined });
    res.json(datos);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Análisis de riesgo (sub y sobre-dotación) con IA sobre la matriz que ya
// armó el usuario en pantalla (incluye lo que haya simulado como "nuevo
// requerido" en cada fila) — se dispara con un botón, no automático.
app.post('/api/simulador-dotacion/analisis-ia', async (req, res) => {
  try {
    const { cd, filas } = req.body || {};
    if (!cd || !Array.isArray(filas) || filas.length === 0) {
      return res.status(400).json({ error: 'cd y filas (arreglo con al menos un cargo) son requeridos' });
    }
    const { narrativa } = await generarAnalisisRiesgoDotacion({ cd, filas });
    res.json({ ok: true, narrativa });
  } catch (err) {
    console.error(err);
    if (err.sinApiKey) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message || 'Error al generar el análisis con IA' });
  }
});

app.post('/api/requerimiento-dotacion', async (req, res) => {
  try {
    const { cargo, turno, cd, cantidad_requerida, vigente_desde, vigente_hasta, observacion } = req.body;
    if (!cargo || !cd || !cantidad_requerida || !vigente_desde) {
      return res.status(400).json({ error: 'cargo, cd, cantidad_requerida y vigente_desde son requeridos' });
    }
    if (vigente_hasta && vigente_hasta < vigente_desde) {
      return res.status(400).json({ error: 'vigente_hasta no puede ser anterior a vigente_desde' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Cierra automáticamente cualquier registro anterior del mismo
      // cargo+turno+CD que haya quedado "abierto" (sin vigente_hasta) y que
      // empezó antes que este — así no queda un tramo indefinido que se
      // solape con el nuevo registro en los cálculos históricos.
      await client.query(
        `UPDATE requerimiento_dotacion
         SET vigente_hasta = ($1::date - INTERVAL '1 day')::text
         WHERE cargo = $2 AND turno IS NOT DISTINCT FROM $3 AND cd = $4
           AND vigente_hasta IS NULL AND vigente_desde < $1`,
        [vigente_desde, cargo, turno || null, cd]
      );
      await client.query(
        `INSERT INTO requerimiento_dotacion (cargo, turno, cd, cantidad_requerida, vigente_desde, vigente_hasta, observacion, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cargo, turno || null, cd, cantidad_requerida, vigente_desde, vigente_hasta || null, observacion || null, req.usuario.nombre || req.usuario.usuario]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Guarda de una vez varias celdas de la matriz Cargo x Turno.
// body: { vigente_desde, cd, observacion, items: [{ cargo, turno, cantidad_requerida }, ...] }
app.post('/api/requerimiento-dotacion/masivo', async (req, res) => {
  try {
    const { vigente_desde, cd, observacion, items } = req.body;
    if (!vigente_desde || !cd || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'vigente_desde, cd e items son requeridos' });
    }
    const creadoPor = req.usuario.nombre || req.usuario.usuario;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of items) {
        if (item.cantidad_requerida === '' || item.cantidad_requerida === null || item.cantidad_requerida === undefined) continue;
        // Mismo cierre automático que en el registro individual.
        await client.query(
          `UPDATE requerimiento_dotacion
           SET vigente_hasta = ($1::date - INTERVAL '1 day')::text
           WHERE cargo = $2 AND turno IS NOT DISTINCT FROM $3 AND cd = $4
             AND vigente_hasta IS NULL AND vigente_desde < $1`,
          [vigente_desde, item.cargo, item.turno || null, cd]
        );
        await client.query(
          `INSERT INTO requerimiento_dotacion (cargo, turno, cd, cantidad_requerida, vigente_desde, observacion, creado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [item.cargo, item.turno || null, cd, Number(item.cantidad_requerida), vigente_desde, observacion || null, creadoPor]
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

// Edita un registro existente (típicamente para cerrarlo con vigente_hasta,
// o corregir la cantidad/observación). No se permite cambiar cargo, turno,
// CD ni vigente_desde, para no romper la identidad histórica del registro.
app.put('/api/requerimiento-dotacion/:id', async (req, res) => {
  try {
    const { cantidad_requerida, vigente_hasta, observacion } = req.body;
    const { rows: existe } = await pool.query('SELECT vigente_desde FROM requerimiento_dotacion WHERE id = $1', [req.params.id]);
    if (existe.length === 0) return res.status(404).json({ error: 'Registro no encontrado' });
    if (vigente_hasta && vigente_hasta < existe[0].vigente_desde) {
      return res.status(400).json({ error: 'vigente_hasta no puede ser anterior a vigente_desde' });
    }
    await pool.query(
      `UPDATE requerimiento_dotacion SET
         cantidad_requerida = COALESCE($1, cantidad_requerida),
         vigente_hasta = $2,
         observacion = COALESCE($3, observacion)
       WHERE id = $4`,
      [cantidad_requerida || null, vigente_hasta || null, observacion, req.params.id]
    );
    res.json({ ok: true });
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

// --- Roles y módulos habilitados ---

const MODULOS_DISPONIBLES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'resultados', label: 'Resultados' },
  { key: 'detalle', label: 'Detalle Marcaciones' },
  { key: 'reporte', label: 'Reporte diario' },
  { key: 'nomina', label: 'Cierre de Nómina' },
  { key: 'horasExtras', label: 'Horas Extras' },
  { key: 'horasExtrasSolicitar', label: 'Horas Extras — Solicitar Ordinarias' },
  { key: 'horasExtrasAprobar', label: 'Horas Extras — Aprobar Ordinarias' },
  { key: 'asignacion', label: 'Jefe de Turno' },
  { key: 'perfiles', label: 'Perfiles / Áreas' },
  { key: 'fueroMaternal', label: 'Fuero Maternal' },
  { key: 'feriados', label: 'Feriados' },
  { key: 'amonestaciones', label: 'Cartas de Amonestación' },
  { key: 'requerimiento', label: 'Requerimiento Dotación' },
  { key: 'ausencias', label: 'Ausencias / Permisos' },
  { key: 'actualizacion', label: 'Actualización diaria' },
  { key: 'carga', label: 'Cargar planillas' },
  { key: 'usuarios', label: 'Usuarios' },
  { key: 'marcacionMovil', label: 'Marcación Móvil (Piloto)' },
  { key: 'anticipos', label: 'Anticipos de Sueldo' },
];

app.get('/api/roles/modulos-disponibles', (req, res) => {
  res.json(MODULOS_DISPONIBLES);
});

// Cualquier usuario logueado puede consultar sus propios módulos habilitados
// (para que el frontend sepa qué pestañas mostrarle).
app.get('/api/roles/mis-modulos', async (req, res) => {
  try {
    if (req.usuario.rol === 'admin') return res.json(MODULOS_DISPONIBLES.map(m => m.key));
    const { rows } = await pool.query('SELECT modulos FROM roles WHERE nombre = $1', [req.usuario.rol]);
    res.json(rows[0]?.modulos || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/roles', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT nombre, modulos, es_sistema FROM roles ORDER BY es_sistema DESC, nombre');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/roles', requireAdmin, async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    const modulos = Array.isArray(req.body.modulos) ? req.body.modulos : [];
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
    const { rows: existe } = await pool.query('SELECT nombre FROM roles WHERE nombre = $1', [nombre]);
    if (existe.length > 0) return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    await pool.query('INSERT INTO roles (nombre, modulos, es_sistema) VALUES ($1,$2,false)', [nombre, modulos]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/roles/:nombre', requireAdmin, async (req, res) => {
  try {
    const { rows: existe } = await pool.query('SELECT es_sistema FROM roles WHERE nombre = $1', [req.params.nombre]);
    if (existe.length === 0) return res.status(404).json({ error: 'Rol no encontrado' });
    if (existe[0].es_sistema) return res.status(400).json({ error: 'Este rol es del sistema y no se puede editar' });
    const modulos = Array.isArray(req.body.modulos) ? req.body.modulos : [];
    await pool.query('UPDATE roles SET modulos = $1 WHERE nombre = $2', [modulos, req.params.nombre]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/roles/:nombre', requireAdmin, async (req, res) => {
  try {
    const { rows: existe } = await pool.query('SELECT es_sistema FROM roles WHERE nombre = $1', [req.params.nombre]);
    if (existe.length === 0) return res.status(404).json({ error: 'Rol no encontrado' });
    if (existe[0].es_sistema) return res.status(400).json({ error: 'Este rol es del sistema y no se puede eliminar' });
    const { rows: enUso } = await pool.query('SELECT id FROM usuarios WHERE rol = $1 LIMIT 1', [req.params.nombre]);
    if (enUso.length > 0) return res.status(400).json({ error: 'Hay usuarios usando este rol; reasígnalos antes de eliminarlo' });
    await pool.query('DELETE FROM roles WHERE nombre = $1', [req.params.nombre]);
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
      'SELECT id, usuario, nombre, rol, activo, cds_visibles, creado_en FROM usuarios ORDER BY creado_en'
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
    const { nombre, rol, activo, password, cds_visibles } = req.body;

    if (password) {
      if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
    }

    await pool.query(
      `UPDATE usuarios SET
         nombre = COALESCE($1, nombre),
         rol = COALESCE($2, rol),
         activo = COALESCE($3, activo),
         cds_visibles = COALESCE($4, cds_visibles)
       WHERE id = $5`,
      [nombre, rol, activo, cds_visibles, req.params.id]
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
    await procesarTransicionesTermino(pool);
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
    await procesarTransicionesTermino(pool);
    res.json({ ok: true, fechas_actualizadas: fechas, filas_cargadas: filas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Buscar empleados por RUT o nombre (para el módulo de asignación de jefe de turno)
app.get('/api/empleados', async (req, res) => {
  try {
    const { q, cd } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);
    const cdsFiltro = await resolverCdsFiltro(req, cd);
    // e.rut se guarda sin puntos (ver limpiarRut en importar.js) — si se
    // busca pegando un RUT con el formato chileno normal (con puntos), el
    // ILIKE nunca calzaba contra el valor guardado y la búsqueda no
    // mostraba nada. Los nombres nunca llevan puntos, así que sacarlos acá
    // no afecta la búsqueda por nombre.
    const like = `%${q.trim().replace(/\./g, '')}%`;
    let sql = `SELECT e.rut, e.nombre, e.apellido_paterno, e.apellido_materno, e.cargo, e.centro_costo,
              e.empresa, e.activo, e.motivo_inactivo, e.motivo_termino, e.fecha_termino, e.tipo_contrato, e.cd, e.direccion, e.comuna,
              a.jefe_turno
       FROM empleados e
       LEFT JOIN jefe_turno_asignacion a ON a.rut = e.rut
       WHERE (e.rut ILIKE $1 OR e.nombre ILIKE $1 OR e.apellido_paterno ILIKE $1)`;
    const params = [like];
    if (cdsFiltro) { params.push(cdsFiltro); sql += ` AND e.cd = ANY($${params.length}::text[])`; }
    sql += ' ORDER BY e.nombre LIMIT 30';
    const { rows } = await pool.query(sql, params);
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

function etiquetaJefeTurnoExport(valor) {
  const OPCIONES = {
    T_RD: 'T_RD (rotativo AM/PM)',
    T_BV: 'T_BV (rotativo AM/PM)',
    T_WP: 'T_WP (Noche, fijo)',
    PLANO: 'Turno Plano (sin jefatura, Lun-Vie)',
    CG: 'Turno Plano (sin jefatura, Lun-Vie)',
  };
  return valor ? (OPCIONES[valor] || valor) : 'Sin asignar';
}

// Excel con los trabajadores ACTIVOS por CD (universo completo de empleados
// activos, no solo los que ya tienen jefe de turno asignado) — para análisis
// de dotación desde la planilla.
app.get('/api/jefe-turno/export', async (req, res) => {
  try {
    const { cd } = req.query;
    const cdsFiltro = await resolverCdsFiltro(req, cd);

    let sql = `
      SELECT e.rut, e.nombre, e.apellido_paterno, e.cargo, e.cd, e.centro_costo, jta.jefe_turno
      FROM empleados e
      LEFT JOIN jefe_turno_asignacion jta ON jta.rut = e.rut
      WHERE e.activo = true
    `;
    const params = [];
    if (cdsFiltro) { params.push(cdsFiltro); sql += ` AND e.cd = ANY($${params.length}::text[])`; }
    sql += ` ORDER BY e.cd NULLS LAST, e.cargo NULLS LAST, e.nombre`;

    const { rows } = await pool.query(sql, params);

    const encabezado = ['RUT', 'Nombre', 'Cargo', 'CD', 'Centro de Costo', 'Jefe de Turno'];
    const datos = rows.map(r => [
      r.rut, `${r.nombre || ''} ${r.apellido_paterno || ''}`.trim(), r.cargo || '', r.cd || '',
      r.centro_costo || '', etiquetaJefeTurnoExport(r.jefe_turno),
    ]);

    const ws = XLSX.utils.aoa_to_sheet([encabezado, ...datos]);
    ws['!autofilter'] = { ref: `A1:F${datos.length + 1}` };
    ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
    ws['!cols'] = [{ wch: 13 }, { wch: 28 }, { wch: 28 }, { wch: 16 }, { wch: 18 }, { wch: 32 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Trabajadores Activos');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="TrabajadoresActivosPorCD_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buffer);
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

// --- CDs (Centros de Distribución) ---

// Lista de CDs distintos (para selects). Cualquier usuario logueado puede
// consultarla, es solo referencia.
app.get('/api/cds', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT DISTINCT cd FROM cd_sucursal ORDER BY cd');
    res.json(rows.map(r => r.cd));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Los CDs que el usuario actual tiene permitido ver. Arreglo vacío = ve
// todos los CDs (consolidado) — así se configura para admin/Gerente/etc.
app.get('/api/mis-cds', async (req, res) => {
  try {
    if (req.usuario.rol === 'admin') return res.json([]);
    const { rows } = await pool.query('SELECT cds_visibles FROM usuarios WHERE id = $1', [req.usuario.id]);
    res.json(rows[0]?.cds_visibles || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Rotación de turnos (horarios AM/PM/Noche por semana) ---
// Permite corregir horarios puntuales sin tener que volver a subir el
// archivo completo de Parámetros/Rotación.

app.get('/api/rotacion-turnos', moduloRequerido('asignacion'), async (req, res) => {
  try {
    const { sem, jefe_turno } = req.query;
    let sql = 'SELECT * FROM rotacion_turnos WHERE 1=1';
    const params = [];
    if (sem) { params.push(sem); sql += ` AND sem = $${params.length}`; }
    if (jefe_turno) { params.push(jefe_turno); sql += ` AND jefe_turno = $${params.length}`; }
    sql += " ORDER BY sem DESC, jefe_turno, CASE dia WHEN 'Lun' THEN 1 WHEN 'Mar' THEN 2 WHEN 'Mié' THEN 3 WHEN 'Jue' THEN 4 WHEN 'Vie' THEN 5 WHEN 'Sáb' THEN 6 WHEN 'Dom' THEN 7 ELSE 8 END";
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Lista de semanas y jefes de turno distintos, para armar los filtros del selector.
app.get('/api/rotacion-turnos/opciones', moduloRequerido('asignacion'), async (req, res) => {
  try {
    const { rows: semanas } = await pool.query('SELECT DISTINCT sem FROM rotacion_turnos ORDER BY sem DESC');
    const { rows: jefes } = await pool.query('SELECT DISTINCT jefe_turno FROM rotacion_turnos ORDER BY jefe_turno');
    res.json({ semanas: semanas.map(r => r.sem), jefes_turno: jefes.map(r => r.jefe_turno) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Matriz simple Día x Turno (AM/PM/Noche): muestra el horario típico actual
// de cada combinación (tomando la semana más reciente como referencia), sin
// necesidad de elegir semana ni Jefe de Turno específico.
// OJO: esta ruta debe quedar ANTES de '/api/rotacion-turnos/:id' — si no,
// Express interpreta "matriz" como si fuera el :id y falla.
// Resuelve qué códigos de Jefe de Turno (T_RD, T_BV, T_WP, etc.) pertenecen a
// un CD específico, mirando a qué CD están asignados los trabajadores que
// tienen cada código (ya que rotacion_turnos no tiene columna de CD propia).
async function codigosJefeTurnoDeCd(pool, cd) {
  const { rows } = await pool.query(
    `SELECT DISTINCT a.jefe_turno
     FROM jefe_turno_asignacion a
     JOIN empleados e ON e.rut = a.rut
     WHERE e.cd = $1 AND a.jefe_turno IS NOT NULL`,
    [cd]
  );
  return rows.map(r => r.jefe_turno);
}

app.get('/api/rotacion-turnos/matriz', moduloRequerido('asignacion'), async (req, res) => {
  try {
    const { cd } = req.query;
    if (!cd) return res.status(400).json({ error: 'cd es requerido' });
    const codigos = await codigosJefeTurnoDeCd(pool, cd);
    if (codigos.length === 0) return res.json([]);
    const { rows } = await pool.query(
      `SELECT sem, jefe_turno, dia, hora_entrada, hora_salida, rotacion_base
       FROM rotacion_turnos
       WHERE jefe_turno = ANY($1::text[])
       ORDER BY sem DESC`,
      [codigos]
    );
    // Clasifica cada fila (turno real AM/PM/NOCHE, usando rotacion_base si
    // existe o derivándolo de la hora de entrada si no) y se queda con la
    // más reciente por cada combinación turno+día como valor representativo.
    const vistos = new Set();
    const resultado = [];
    for (const r of rows) {
      const turno = r.rotacion_base || tipoTurnoDesdeHoraEntrada(r.hora_entrada);
      if (!turno) continue;
      const clave = `${turno}|${r.dia}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      resultado.push({ turno, dia: r.dia, hora_entrada: r.hora_entrada, hora_salida: r.hora_salida });
    }
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Actualiza el horario de un Turno (AM/PM/NOCHE) para un día de la semana en
// TODAS las semanas, pero SOLO para los códigos de Jefe de Turno del CD
// indicado — así no afecta a otros CDs que también tengan un grupo "AM" esa
// semana con otro código. Clasifica cada fila con el mismo respaldo que el
// resto del sistema (rotacion_base si existe, si no lo deriva de la hora de
// entrada) — así encuentra y actualiza también las filas sin rotacion_base
// guardado, que son la mayoría.
app.put('/api/rotacion-turnos/matriz', moduloRequerido('asignacion'), async (req, res) => {
  try {
    const { turno, dia, hora_entrada, hora_salida, cd, semDesde, semHasta } = req.body;
    if (!turno || !dia || !hora_entrada || !hora_salida || !cd) {
      return res.status(400).json({ error: 'turno, dia, hora_entrada, hora_salida y cd son requeridos' });
    }
    const codigos = await codigosJefeTurnoDeCd(pool, cd);
    if (codigos.length === 0) return res.status(400).json({ error: 'No hay Jefes de Turno asignados a trabajadores de este CD' });

    // Rango de semanas opcional: si no se indica, se aplica a TODAS las
    // semanas (comportamiento anterior). Si se indica, solo esas semanas
    // (sirve tanto para "desde semana 27 hasta 52" como para corregir 1 o 2
    // semanas puntuales, poniendo el mismo número en ambos campos).
    let sqlFilas = `SELECT id, sem, hora_entrada, rotacion_base FROM rotacion_turnos WHERE jefe_turno = ANY($1::text[]) AND dia = $2`;
    const paramsFilas = [codigos, dia];
    if (semDesde) { paramsFilas.push(Number(semDesde)); sqlFilas += ` AND sem >= $${paramsFilas.length}`; }
    if (semHasta) { paramsFilas.push(Number(semHasta)); sqlFilas += ` AND sem <= $${paramsFilas.length}`; }

    const { rows } = await pool.query(sqlFilas, paramsFilas);
    const idsAActualizar = rows
      .filter(r => (r.rotacion_base || tipoTurnoDesdeHoraEntrada(r.hora_entrada)) === turno)
      .map(r => r.id);

    if (idsAActualizar.length === 0) {
      return res.json({ ok: true, filas_actualizadas: 0 });
    }

    const { rowCount } = await pool.query(
      `UPDATE rotacion_turnos SET hora_entrada = $1, hora_salida = $2 WHERE id = ANY($3::int[])`,
      [hora_entrada, hora_salida, idsAActualizar]
    );
    // "Resultados" es una tabla pre-calculada — sin este recálculo, el
    // cambio de horario quedaría guardado en rotacion_turnos pero invisible
    // en Resultados hasta la próxima carga de archivos.
    await calcularResultados(pool);
    res.json({ ok: true, filas_actualizadas: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put('/api/rotacion-turnos/:id', moduloRequerido('asignacion'), async (req, res) => {
  try {
    const { hora_entrada, hora_salida, colacion, jornada, rotacion_base } = req.body;
    await pool.query(
      `UPDATE rotacion_turnos SET
         hora_entrada = COALESCE($1, hora_entrada),
         hora_salida = COALESCE($2, hora_salida),
         colacion = COALESCE($3, colacion),
         jornada = COALESCE($4, jornada),
         rotacion_base = COALESCE($5, rotacion_base)
       WHERE id = $6`,
      [hora_entrada, hora_salida, colacion, jornada, rotacion_base, req.params.id]
    );
    await calcularResultados(pool);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- Horario Plano (Jefe de Operaciones / Supervisor Senior, código CG) ---
// Reemplaza el horario que antes estaba fijo en el código, para poder
// ajustarlo desde la pantalla.

app.get('/api/horario-plano', moduloRequerido('asignacion'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM horario_plano ORDER BY CASE dia WHEN 'Lun' THEN 1 WHEN 'Mar' THEN 2 WHEN 'Mié' THEN 3 WHEN 'Jue' THEN 4 WHEN 'Vie' THEN 5 WHEN 'Sáb' THEN 6 WHEN 'Dom' THEN 7 ELSE 8 END`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/horario-plano/:dia', moduloRequerido('asignacion'), async (req, res) => {
  try {
    const { hora_entrada, hora_salida } = req.body;
    if (!hora_entrada || !hora_salida) return res.status(400).json({ error: 'hora_entrada y hora_salida son requeridos' });
    await pool.query(
      `INSERT INTO horario_plano (dia, hora_entrada, hora_salida) VALUES ($1,$2,$3)
       ON CONFLICT (dia) DO UPDATE SET hora_entrada = EXCLUDED.hora_entrada, hora_salida = EXCLUDED.hora_salida`,
      [req.params.dia, hora_entrada, hora_salida]
    );
    await calcularResultados(pool);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/cd-sucursal', moduloRequerido('perfiles'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT sucursal, cd FROM cd_sucursal ORDER BY cd, sucursal');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Sucursales que aparecen en Talana pero no tienen ninguna fila en
// cd_sucursal (por eso esos trabajadores quedan sin CD). Útil para
// diagnosticar rápido si falta agregar alguna al mapeo.
app.get('/api/cd-sucursal/sin-mapear', moduloRequerido('perfiles'), async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT TRIM(UPPER(mt.sucursal)) AS sucursal, COUNT(DISTINCT mt.rut) AS trabajadores
      FROM marcaciones_talana mt
      WHERE mt.sucursal IS NOT NULL
        AND TRIM(UPPER(mt.sucursal)) NOT IN (SELECT TRIM(UPPER(sucursal)) FROM cd_sucursal)
      GROUP BY TRIM(UPPER(mt.sucursal))
      ORDER BY trabajadores DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cd-sucursal', moduloRequerido('perfiles'), async (req, res) => {
  try {
    const sucursal = (req.body.sucursal || '').trim().toUpperCase();
    const cd = (req.body.cd || '').trim().toUpperCase();
    if (!sucursal || !cd) return res.status(400).json({ error: 'sucursal y cd son requeridos' });
    await pool.query(
      `INSERT INTO cd_sucursal (sucursal, cd) VALUES ($1,$2)
       ON CONFLICT (sucursal) DO UPDATE SET cd = EXCLUDED.cd`,
      [sucursal, cd]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/cd-sucursal/:sucursal', moduloRequerido('perfiles'), async (req, res) => {
  try {
    await pool.query('DELETE FROM cd_sucursal WHERE sucursal = $1', [req.params.sucursal]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Recalcula el CD de todos los empleados a partir de sus marcas de Talana ya
// cargadas + el mapeo Sucursal→CD actual. Útil después de corregir el mapeo,
// sin tener que volver a subir los archivos de Talana.
// Fuerza la transición a inactivo de quienes ya tienen renuncia/desvinculación
// registrada y su mes de término ya pasó — normalmente corre sola (al
// arrancar el servidor y en cada carga diaria), este botón es solo por si se
// necesita forzarla sin esperar.
app.post('/api/empleados/procesar-transiciones-termino', moduloRequerido('perfiles'), async (req, res) => {
  try {
    const cantidad = await procesarTransicionesTermino(pool);
    res.json({ ok: true, transicionados: cantidad });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/empleados/recalcular-cd', moduloRequerido('perfiles'), async (req, res) => {
  try {
    await actualizarCdDesdeMarcaciones(pool);
    const { rows } = await pool.query('SELECT COUNT(*) AS n FROM empleados WHERE cd IS NOT NULL');
    res.json({ ok: true, empleados_con_cd: Number(rows[0].n) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});


app.get('/api/cargos-requerimiento', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT nombre FROM cargos_requerimiento ORDER BY nombre');
    res.json(rows.map(r => r.nombre));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/cargos-requerimiento', async (req, res) => {
  try {
    const nombre = (req.body.nombre || '').trim().toUpperCase();
    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
    await pool.query('INSERT INTO cargos_requerimiento (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [nombre]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/cargos-requerimiento/:nombre', async (req, res) => {
  try {
    await pool.query('DELETE FROM cargos_requerimiento WHERE nombre = $1', [req.params.nombre]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/areas', moduloRequerido('perfiles'), async (req, res) => {
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

app.delete('/api/areas/:nombre', moduloRequerido('perfiles'), async (req, res) => {
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
app.post('/api/empleados', moduloRequerido('perfiles'), async (req, res) => {
  try {
    const { rut, nombre, apellido_paterno, apellido_materno, cargo, centro_costo, fecha_ingreso } = req.body;
    if (!rut || !nombre) return res.status(400).json({ error: 'rut y nombre son requeridos' });

    const { rows: existe } = await pool.query('SELECT rut FROM empleados WHERE rut = $1', [rut]);
    if (existe.length > 0) return res.status(409).json({ error: 'Ya existe un trabajador con ese RUT' });

    // fecha_ingreso queda registrada desde la creación para que el Dashboard
    // de Asistencia no marque "Ausente" los días previos a que la persona
    // realmente empezara a trabajar (sin esto, quedaba NULL y el día de
    // hoy hacia atrás se veía todo como ausentismo).
    await pool.query(
      `INSERT INTO empleados (rut, nombre, apellido_paterno, apellido_materno, cargo, centro_costo, empresa, fecha_ingreso)
       VALUES ($1,$2,$3,$4,$5,$6,'MANPOWER',$7)`,
      [rut, nombre, apellido_paterno || '', apellido_materno || '', cargo || '', centro_costo || null, fecha_ingreso || new Date().toISOString().slice(0, 10)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Marca activos/inactivos en masa a partir de un archivo con los RUTs vigentes.
app.post('/api/empleados/activar-masivo', moduloRequerido('perfiles'), upload.single('activos'), async (req, res) => {
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
app.post('/api/empleados/areas-masivo', moduloRequerido('perfiles'), upload.single('areas'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo con RUT y Área' });
    const resultado = await actualizarAreasDesdeArchivo(pool, req.file.path);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Actualiza el Jefe de Turno en masa desde un archivo RUT + JEFE TURNO.
app.post('/api/empleados/jefe-turno-masivo', moduloRequerido('perfiles'), upload.single('jefeturno'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo con RUT y Jefe Turno' });
    const resultado = await actualizarJefeTurnoDesdeArchivo(pool, req.file.path);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/empleados/direccion-masivo', moduloRequerido('perfiles'), upload.single('direccion'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Falta el archivo con RUT, Comuna y Dirección' });
    const resultado = await actualizarDireccionDesdeArchivo(pool, req.file.path);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Editar el perfil de un trabajador existente (cargo, área/centro de costo, nombre)
app.put('/api/empleados/:rut', moduloRequerido('perfiles'), async (req, res) => {
  try {
    const { nombre, apellido_paterno, apellido_materno, cargo, centro_costo, estado, fecha_termino, fecha_ingreso, motivo_inactivo, tipo_contrato, direccion, comuna } = req.body;
    const { rows: existe } = await pool.query(
      'SELECT rut, activo, motivo_termino, fecha_termino, fecha_ingreso, motivo_inactivo FROM empleados WHERE rut = $1',
      [req.params.rut]
    );
    if (existe.length === 0) return res.status(404).json({ error: 'Trabajador no encontrado' });
    const actual = existe[0];

    // "estado" es opcional: si no viene en este PUT (ej. solo se está editando
    // el cargo), no se toca nada de activo/motivo_termino/fecha_termino.
    let activoNuevo = actual.activo;
    let motivoTerminoNuevo = actual.motivo_termino;
    let fechaTerminoNuevo = actual.fecha_termino;
    let fechaIngresoNuevo = actual.fecha_ingreso;
    let motivoInactivoNuevo = motivo_inactivo !== undefined ? motivo_inactivo : actual.motivo_inactivo;

    if (estado === 'activo') {
      // Reactivación real (estaba inactivo en la base, más allá de qué
      // mostrara el select): se actualiza fecha_ingreso a la fecha de
      // reingreso indicada, para que el Dashboard de Asistencia no marque
      // "Ausente" los días entre la baja anterior y el reingreso (no hay
      // ninguna marca real esos días porque la persona no trabajaba).
      if (actual.activo === false && fecha_ingreso) {
        fechaIngresoNuevo = fecha_ingreso;
      }
      activoNuevo = true;
      motivoTerminoNuevo = null;
      fechaTerminoNuevo = null;
      motivoInactivoNuevo = null;
    } else if (estado === 'R' || estado === 'Des' || estado === 'Des160' || estado === 'CcTo') {
      if (!fecha_termino) {
        return res.status(400).json({ error: 'Debes indicar la fecha de renuncia/desvinculación/culminación' });
      }
      // El fuero maternal (Art. 201 CT) protege contra la desvinculación por
      // parte de la empresa sin autorización judicial previa — no aplica a
      // la renuncia voluntaria de la propia trabajadora, así que solo se
      // bloquea "Des", "Des160" y "CcTo" (la culminación de un contrato a
      // plazo fijo tampoco puede aplicarse durante el fuero, según
      // jurisprudencia mayoritaria). Se puede saltar el bloqueo únicamente
      // si se confirma explícitamente contar con la autorización judicial
      // (desafuero).
      if (estado === 'Des' || estado === 'Des160' || estado === 'CcTo') {
        const fuero = await fueroVigente(pool, req.params.rut, fecha_termino);
        if (fuero && !req.body.confirmarDesafuero) {
          return res.status(400).json({
            error: `Esta trabajadora tiene fuero maternal vigente (desde ${fuero.fecha_inicio_fuero}${fuero.fecha_termino_fuero ? ` hasta ${fuero.fecha_termino_fuero}` : ', sin fecha de término registrada'}). No se puede desvincular sin autorización judicial previa (Art. 201 Código del Trabajo). Si ya cuentas con esa autorización, marca la casilla de confirmación para continuar.`,
            requiereConfirmacionDesafuero: true,
          });
        }
      }
      motivoTerminoNuevo = estado;
      fechaTerminoNuevo = fecha_termino;
      // Sigue activo mientras su mes de término no haya terminado todavía
      // (para no perder el procesamiento de asistencia de ese mes); al mes
      // siguiente, procesarTransicionesTermino() lo pasa a inactivo solo.
      const mesActual = new Date().toISOString().slice(0, 7);
      const mesTermino = fecha_termino.slice(0, 7);
      activoNuevo = mesTermino >= mesActual;
    }

    await pool.query(
      `UPDATE empleados SET
         nombre = COALESCE($1, nombre),
         apellido_paterno = COALESCE($2, apellido_paterno),
         apellido_materno = COALESCE($3, apellido_materno),
         cargo = COALESCE($4, cargo),
         centro_costo = COALESCE($5, centro_costo),
         activo = $6,
         motivo_termino = $7,
         fecha_termino = $8,
         motivo_inactivo = $9,
         tipo_contrato = COALESCE($10, tipo_contrato),
         direccion = COALESCE($11, direccion),
         comuna = COALESCE($12, comuna),
         fecha_ingreso = $13
       WHERE rut = $14`,
      [nombre, apellido_paterno, apellido_materno, cargo, centro_costo, activoNuevo, motivoTerminoNuevo, fechaTerminoNuevo, motivoInactivoNuevo, tipo_contrato, direccion, comuna, fechaIngresoNuevo, req.params.rut]
    );
    res.json({ ok: true, activo: activoNuevo });
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