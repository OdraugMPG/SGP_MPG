import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  buscarEmpleados, listarAsignacionesJefeTurno, asignarJefeTurno, quitarAsignacionJefeTurno,
  listarOpcionesRotacion, listarRotacionTurnos, editarRotacionTurno, listarHorarioPlano, editarHorarioPlano,
  listarMatrizRotacion, guardarMatrizRotacion, recalcularResultados,
} from '../api';

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const TIPOS_TURNO_MATRIZ = ['AM', 'PM', 'NOCHE'];

function PanelMatrizHorarios({ cd }) {
  const [matriz, setMatriz] = useState({}); // clave `${dia}|${turno}` -> {hora_entrada, hora_salida}
  const [editados, setEditados] = useState({});
  const [guardandoCelda, setGuardandoCelda] = useState(null);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);
  const [semDesde, setSemDesde] = useState('');
  const [semHasta, setSemHasta] = useState('');
  const [semanasDisponibles, setSemanasDisponibles] = useState([]);
  const [recalculando, setRecalculando] = useState(false);

  async function recalcularTodo() {
    setRecalculando(true);
    setError(null);
    setMensajeOk(null);
    try {
      await recalcularResultados();
      setMensajeOk('✓ Resultados, Indicadores y Dashboard recalculados con los datos actuales de rotación/horario.');
    } catch (err) {
      setError(err.message);
    } finally {
      setRecalculando(false);
    }
  }

  useEffect(() => {
    listarOpcionesRotacion().then(({ semanas }) => setSemanasDisponibles(semanas)).catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    if (!cd) { setMatriz({}); return; }
    try {
      const filas = await listarMatrizRotacion(cd);
      const mapa = {};
      for (const f of filas) mapa[`${f.dia}|${f.turno}`] = f;
      setMatriz(mapa);
    } catch (err) {
      setError(err.message);
    }
  }, [cd]);

  useEffect(() => { cargar(); }, [cargar]);

  function valorActual(dia, turno, campo) {
    const clave = `${dia}|${turno}|${campo}`;
    if (editados[clave] !== undefined) return editados[clave];
    const actual = matriz[`${dia}|${turno}`];
    return actual ? (actual[campo] || '').toString().slice(0, 5) : '';
  }

  function cambiar(dia, turno, campo, valor) {
    setEditados(prev => ({ ...prev, [`${dia}|${turno}|${campo}`]: valor }));
  }

  async function guardar(dia, turno) {
    if (!cd) { setError('Elige un CD en el encabezado antes de guardar.'); return; }
    const entrada = valorActual(dia, turno, 'hora_entrada');
    const salida = valorActual(dia, turno, 'hora_salida');
    if (!entrada || !salida) {
      setError(`Completa entrada y salida para ${turno} ${dia} antes de guardar.`);
      return;
    }
    if (semDesde && semHasta && Number(semDesde) > Number(semHasta)) {
      setError('"Semana desde" no puede ser mayor que "Semana hasta".');
      return;
    }
    setGuardandoCelda(`${dia}|${turno}`);
    setError(null);
    setMensajeOk(null);
    try {
      const resultado = await guardarMatrizRotacion(turno, dia, `${entrada}:00`, `${salida}:00`, cd, semDesde, semHasta);
      const alcance = semDesde || semHasta
        ? `semana(s) ${semDesde || '…'} a ${semHasta || '…'}`
        : 'todas las semanas';
      setMensajeOk(`✓ ${turno} ${dia} (${cd}): actualizado en ${resultado.filas_actualizadas} registro(s) (${alcance}). Los indicadores y dashboard se recalcularon solos.`);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoCelda(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
        <h2>Matriz de horarios por turno (forma rápida) {cd && `— ${cd}`}</h2>
        <button
          className="btn" type="button" disabled={recalculando} onClick={recalcularTodo}
          title="Recalcula Resultados, Indicadores y Dashboard con los datos que ya están guardados ahora mismo (no cambia ningún horario, solo asegura que todo esté sincronizado)"
        >
          {recalculando ? 'Recalculando…' : 'Recalcular Resultados / Indicadores / Dashboard'}
        </button>
      </div>
      <p className="card-desc">
        Día de la semana × Turno (AM / PM / Noche), con la entrada y salida ya configuradas. Cambia
        cualquier celda y dale click al ✓ para guardarla — se aplica de una vez a <strong>todas las
        semanas</strong> que tengan ese turno ese día, <strong>solo para el CD elegido en el
        encabezado</strong> (no afecta a otros CDs). Para una corrección puntual de una sola semana
        específica, usa el panel de abajo ("Rotación de turnos por semana").
      </p>

      {!cd && <p className="status-msg error">Elige un CD en el encabezado para ver y editar su matriz de horarios.</p>}

      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 14 }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          ¿A qué semanas aplicar el guardado? Deja ambos campos vacíos para aplicar a <strong>todas
          las semanas</strong>. Indica un rango (ej: 27 a 52) para actualizar solo ese período, o
          pon el mismo número en ambos para corregir <strong>una sola semana puntual</strong>
          {semanasDisponibles.length > 0 && ` (semanas disponibles: ${Math.min(...semanasDisponibles)} a ${Math.max(...semanasDisponibles)})`}.
        </p>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Semana desde</label>
            <input
              type="number" placeholder="Todas" value={semDesde}
              onChange={e => setSemDesde(e.target.value)} className="file-input"
            />
          </div>
          <div className="field" style={{ maxWidth: 140 }}>
            <label>Semana hasta</label>
            <input
              type="number" placeholder="Todas" value={semHasta}
              onChange={e => setSemHasta(e.target.value)} className="file-input"
            />
          </div>
          {(semDesde || semHasta) && (
            <button
              type="button" onClick={() => { setSemDesde(''); setSemHasta(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem', paddingBottom: 8 }}
            >
              Limpiar (volver a "todas las semanas")
            </button>
          )}
        </div>
      </div>

      {error && <p className="status-msg error">{error}</p>}
      {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Turno</th>
              {DIAS_SEMANA.map(d => <th key={d} colSpan={2} style={{ textAlign: 'center' }}>{d}</th>)}
            </tr>
            <tr>
              <th></th>
              {DIAS_SEMANA.map(d => (
                <Fragment key={d}>
                  <th style={{ fontSize: '0.72rem' }}>Entrada</th>
                  <th style={{ fontSize: '0.72rem' }}>Salida</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIPOS_TURNO_MATRIZ.map(turno => (
              <tr key={turno}>
                <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 600 }}>{turno === 'NOCHE' ? 'Noche' : turno}</td>
                {DIAS_SEMANA.map(dia => {
                  const existe = !!matriz[`${dia}|${turno}`] || editados[`${dia}|${turno}|hora_entrada`] !== undefined;
                  return (
                    <Fragment key={`${dia}-${turno}`}>
                      <td>
                        <input
                          type="time" value={valorActual(dia, turno, 'hora_entrada')}
                          onChange={e => cambiar(dia, turno, 'hora_entrada', e.target.value)}
                          style={{ width: 90, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', color: 'var(--text)', fontSize: '0.8rem' }}
                        />
                      </td>
                      <td style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          type="time" value={valorActual(dia, turno, 'hora_salida')}
                          onChange={e => cambiar(dia, turno, 'hora_salida', e.target.value)}
                          style={{ width: 90, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', color: 'var(--text)', fontSize: '0.8rem' }}
                        />
                        <button
                          type="button" disabled={guardandoCelda === `${dia}|${turno}` || !existe}
                          onClick={() => guardar(dia, turno)}
                          title={existe ? 'Guardar (aplica a todas las semanas)' : 'Sin datos para este turno/día'}
                          style={{
                            background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white',
                            width: 26, height: 26, cursor: existe ? 'pointer' : 'not-allowed', opacity: existe ? 1 : 0.3, fontSize: '0.85rem',
                          }}
                        >
                          ✓
                        </button>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const OPCIONES_TURNO = [
  { valor: 'T_RD', label: 'T_RD (rotativo AM/PM)' },
  { valor: 'T_BV', label: 'T_BV (rotativo AM/PM)' },
  { valor: 'T_WP', label: 'T_WP (Noche, fijo)' },
  { valor: 'PLANO', label: 'Turno Plano (sin jefatura, Lun-Vie)' },
];

function PanelHorarioPlano() {
  const [horario, setHorario] = useState([]);
  const [editados, setEditados] = useState({});
  const [guardandoDia, setGuardandoDia] = useState(null);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setHorario(await listarHorarioPlano());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  function valorActual(dia, campo, valorOriginal) {
    return editados[`${dia}|${campo}`] ?? (valorOriginal || '').slice(0, 5);
  }

  function cambiar(dia, campo, valor) {
    setEditados(prev => ({ ...prev, [`${dia}|${campo}`]: valor }));
  }

  async function guardar(dia) {
    const entrada = editados[`${dia}|hora_entrada`];
    const salida = editados[`${dia}|hora_salida`];
    if (!entrada && !salida) return;
    setGuardandoDia(dia);
    setError(null);
    setMensajeOk(null);
    try {
      const h = horario.find(x => x.dia === dia);
      await editarHorarioPlano(dia, `${entrada || h.hora_entrada.slice(0, 5)}:00`, `${salida || h.hora_salida.slice(0, 5)}:00`);
      setMensajeOk(`✓ Horario de ${dia} actualizado.`);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoDia(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Horario Plano (Jefe de Operaciones / Supervisor Senior)</h2>
      <p className="card-desc">
        Horario fijo de Lunes a Viernes para el código "Plano" (sin rotación semanal). Ajusta y
        guarda cada día — no necesitas tocar código para corregir un horario.
      </p>
      {error && <p className="status-msg error">{error}</p>}
      {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}
      <div className="table-scroll">
        <table>
          <thead><tr><th>Día</th><th>Entrada</th><th>Salida</th><th></th></tr></thead>
          <tbody>
            {horario.map(h => (
              <tr key={h.dia}>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{h.dia}</td>
                <td>
                  <input
                    type="time" value={valorActual(h.dia, 'hora_entrada', h.hora_entrada)}
                    onChange={e => cambiar(h.dia, 'hora_entrada', e.target.value)}
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)' }}
                  />
                </td>
                <td>
                  <input
                    type="time" value={valorActual(h.dia, 'hora_salida', h.hora_salida)}
                    onChange={e => cambiar(h.dia, 'hora_salida', e.target.value)}
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)' }}
                  />
                </td>
                <td>
                  <button
                    className="btn" type="button" disabled={guardandoDia === h.dia}
                    style={{ padding: '5px 10px', fontSize: '0.78rem' }}
                    onClick={() => guardar(h.dia)}
                  >
                    {guardandoDia === h.dia ? 'Guardando…' : 'Guardar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Si no hay rotacion_base guardado en esa fila, se deriva un valor de
// respaldo según la hora de entrada, solo para mostrarlo en pantalla (no
// cambia el dato real en la base).
function rotacionMostrada(fila) {
  if (fila.rotacion_base) return fila.rotacion_base;
  if (!fila.hora_entrada) return '—';
  const hora = parseInt(fila.hora_entrada.slice(0, 2), 10);
  if (hora >= 4 && hora < 12) return 'AM';
  if (hora >= 12 && hora < 19) return 'PM';
  return 'NOCHE';
}

function PanelRotacionTurnos() {
  const [semanas, setSemanas] = useState([]);
  const [jefes, setJefes] = useState([]);
  const [sem, setSem] = useState('');
  const [jefeTurno, setJefeTurno] = useState('');
  const [filas, setFilas] = useState([]);
  const [editados, setEditados] = useState({});
  const [guardandoId, setGuardandoId] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  useEffect(() => {
    listarOpcionesRotacion().then(({ semanas, jefes_turno }) => {
      setSemanas(semanas);
      setJefes(jefes_turno);
      if (semanas.length > 0) setSem(String(semanas[0]));
    }).catch(err => setError(err.message));
  }, []);

  const cargarFilas = useCallback(async () => {
    if (!sem) return;
    setCargando(true);
    setError(null);
    try {
      setFilas(await listarRotacionTurnos(sem, jefeTurno || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [sem, jefeTurno]);

  useEffect(() => { cargarFilas(); }, [cargarFilas]);

  function valorActual(fila, campo) {
    const clave = `${fila.id}|${campo}`;
    if (editados[clave] !== undefined) return editados[clave];
    return (fila[campo] || '').toString().slice(0, 5);
  }

  function cambiar(id, campo, valor) {
    setEditados(prev => ({ ...prev, [`${id}|${campo}`]: valor }));
  }

  async function guardar(fila) {
    setGuardandoId(fila.id);
    setError(null);
    setMensajeOk(null);
    try {
      const horaEntrada = editados[`${fila.id}|hora_entrada`];
      const horaSalida = editados[`${fila.id}|hora_salida`];
      await editarRotacionTurno(fila.id, {
        hora_entrada: horaEntrada ? `${horaEntrada}:00` : undefined,
        hora_salida: horaSalida ? `${horaSalida}:00` : undefined,
      });
      setMensajeOk(`✓ ${fila.jefe_turno} / ${fila.dia} (semana ${fila.sem}) actualizado.`);
      cargarFilas();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoId(null);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Rotación de turnos (AM / PM / Noche)</h2>
      <p className="card-desc">
        Horarios por semana y Jefe de Turno, tal como vienen del archivo de Parámetros/Rotación —
        corrige aquí un horario puntual sin tener que volver a subir el archivo completo.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Semana</label>
          <select value={sem} onChange={e => setSem(e.target.value)} className="file-input">
            {semanas.map(s => <option key={s} value={s}>Semana {s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Jefe de Turno</label>
          <select value={jefeTurno} onChange={e => setJefeTurno(e.target.value)} className="file-input">
            <option value="">Todos</option>
            {jefes.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
      </div>

      {error && <p className="status-msg error">{error}</p>}
      {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

      <div className="table-scroll">
        <table>
          <thead><tr><th>Jefe Turno</th><th>Rotación</th><th>Día</th><th>Entrada</th><th>Salida</th><th></th></tr></thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.id}>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{f.jefe_turno}</td>
                <td>{rotacionMostrada(f)}</td>
                <td>{f.dia}</td>
                <td>
                  <input
                    type="time" value={valorActual(f, 'hora_entrada')}
                    onChange={e => cambiar(f.id, 'hora_entrada', e.target.value)}
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)' }}
                  />
                </td>
                <td>
                  <input
                    type="time" value={valorActual(f, 'hora_salida')}
                    onChange={e => cambiar(f.id, 'hora_salida', e.target.value)}
                    style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', color: 'var(--text)' }}
                  />
                </td>
                <td>
                  <button
                    className="btn" type="button" disabled={guardandoId === f.id}
                    style={{ padding: '5px 10px', fontSize: '0.78rem' }}
                    onClick={() => guardar(f)}
                  >
                    {guardandoId === f.id ? 'Guardando…' : 'Guardar'}
                  </button>
                </td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={6} className="empty-state">Sin datos para esta semana/jefe de turno.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function labelTurno(valor) {
  if (valor === 'CG') return 'Turno Plano (sin jefatura, Lun-Vie)';
  return OPCIONES_TURNO.find(o => o.valor === valor)?.label || valor || '—';
}

export default function AsignacionJefeTurno({ cdGlobal }) {
  const [query, setQuery] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [asignaciones, setAsignaciones] = useState([]);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [guardandoRut, setGuardandoRut] = useState(null);
  const [error, setError] = useState(null);

  const cargarAsignaciones = useCallback(async () => {
    setCargandoLista(true);
    try {
      const data = await listarAsignacionesJefeTurno();
      setAsignaciones(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => { cargarAsignaciones(); }, [cargarAsignaciones]);

  useEffect(() => {
    if (query.trim().length < 2) { setResultadosBusqueda([]); return; }
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const data = await buscarEmpleados(query, cdGlobal || undefined);
        setResultadosBusqueda(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleAsignar(rut, jefeTurno) {
    setGuardandoRut(rut);
    setError(null);
    try {
      await asignarJefeTurno(rut, jefeTurno);
      await cargarAsignaciones();
      setResultadosBusqueda(rs => rs.map(r => r.rut === rut ? { ...r, jefe_turno: jefeTurno } : r));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoRut(null);
    }
  }

  async function handleQuitar(rut) {
    setGuardandoRut(rut);
    setError(null);
    try {
      await quitarAsignacionJefeTurno(rut);
      await cargarAsignaciones();
      setResultadosBusqueda(rs => rs.map(r => r.rut === rut ? { ...r, jefe_turno: null } : r));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoRut(null);
    }
  }

  return (
    <>
    <PanelMatrizHorarios cd={cdGlobal} />
    <PanelRotacionTurnos />
    <PanelHorarioPlano />
    <div className="card">
      <h2>Asignación de Jefe de Turno</h2>
      <p className="card-desc">
        Busca un trabajador por RUT o nombre y asígnalo a un jefe de turno (grupo rotativo AM/PM/Noche)
        o márcalo como Turno Plano (horario fijo, sin jefatura). Al guardar, se recalculan los atrasos.
      </p>

      <div className="filters-row">
        <div className="field" style={{ minWidth: 280 }}>
          <label>Buscar trabajador</label>
          <input
            type="text"
            placeholder="RUT o nombre..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="status-msg error">{error}</p>}

      {query.trim().length >= 2 && (
        <div className="table-scroll" style={{ marginBottom: 24, maxHeight: '40vh' }}>
          <table>
            <thead>
              <tr>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Asignación actual</th>
                <th>Asignar como</th>
              </tr>
            </thead>
            <tbody>
              {resultadosBusqueda.map(emp => (
                <tr key={emp.rut}>
                  <td>{emp.rut}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>
                    {emp.nombre} {emp.apellido_paterno}
                  </td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.cargo}</td>
                  <td>
                    {emp.jefe_turno
                      ? <span className="badge badge-ok">{labelTurno(emp.jefe_turno)}</span>
                      : <span className="badge badge-muted">Sin asignar</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {OPCIONES_TURNO.map(op => (
                        <button
                          key={op.valor}
                          type="button"
                          className="btn"
                          style={{
                            padding: '5px 10px', fontSize: '0.75rem',
                            background: emp.jefe_turno === op.valor ? 'var(--accent)' : 'var(--surface-2)',
                            color: emp.jefe_turno === op.valor ? '#0d1117' : 'var(--text)',
                            border: '1px solid var(--border)',
                          }}
                          disabled={guardandoRut === emp.rut}
                          onClick={() => handleAsignar(emp.rut, op.valor)}
                        >
                          {op.valor}
                        </button>
                      ))}
                      {emp.jefe_turno && (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '5px 10px', fontSize: '0.75rem', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }}
                          disabled={guardandoRut === emp.rut}
                          onClick={() => handleQuitar(emp.rut)}
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!buscando && resultadosBusqueda.length === 0 && (
                <tr><td colSpan={5} className="empty-state">Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 8 }}>Asignaciones actuales ({asignaciones.length})</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>RUT</th>
              <th>Nombre</th>
              <th>Cargo</th>
              <th>Jefe de Turno</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {asignaciones.map(a => (
              <tr key={a.rut}>
                <td>{a.rut}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{a.nombre}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{a.cargo}</td>
                <td>{labelTurno(a.jefe_turno)}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }}
                    disabled={guardandoRut === a.rut}
                    onClick={() => handleQuitar(a.rut)}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cargandoLista && asignaciones.length === 0 && (
          <div className="empty-state">No hay asignaciones registradas todavía.</div>
        )}
      </div>
    </div>
    </>
  );
}