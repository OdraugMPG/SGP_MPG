import { useState, useEffect, useCallback } from 'react';
import {
  listarRequerimientoDotacion, listarRequerimientoDotacionVigente, guardarRequerimientoDotacionMasivo,
  eliminarRequerimientoDotacion, listarCargosRequerimiento, crearCargoRequerimiento, eliminarCargoRequerimiento,
  crearRequerimientoDotacion, editarRequerimientoDotacion, listarCds,
} from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const TURNOS = ['AM', 'PM', 'NOCHE', 'PLANO'];

function PanelCargos({ cargos, onCambio }) {
  const [nuevoCargo, setNuevoCargo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function agregar() {
    if (!nuevoCargo.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await crearCargoRequerimiento(nuevoCargo.trim());
      setNuevoCargo('');
      onCambio();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(nombre) {
    setError(null);
    try {
      await eliminarCargoRequerimiento(nombre);
      onCambio();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Cargos de Requerimiento Dotación</h2>
      <p className="card-desc">Solo estos cargos aparecen en la matriz y en el registro histórico. Puedes agregar más si el cliente lo pide.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {cargos.map(c => (
          <span key={c} className="badge badge-muted" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px' }}>
            {c}
            <button
              type="button" onClick={() => quitar(c)}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}
              title="Quitar cargo"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {error && <p className="status-msg error">{error}</p>}

      <div style={{ display: 'flex', gap: 10 }}>
        <input
          type="text" placeholder="Nuevo cargo (ej: RECEPCIONISTA)"
          value={nuevoCargo} onChange={e => setNuevoCargo(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && agregar()}
          className="file-input" style={{ maxWidth: 280 }}
        />
        <button className="btn" type="button" disabled={guardando} onClick={agregar}>Agregar</button>
      </div>
    </div>
  );
}

function MatrizRequerimiento({ cargos, cd, onGuardado }) {
  const [valores, setValores] = useState({}); // clave `${cargo}|${turno}` -> string
  const [vigenteDesde, setVigenteDesde] = useState(hoyISO());
  const [observacion, setObservacion] = useState('');
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  const cargarVigente = useCallback(async () => {
    if (!cd) return;
    setCargando(true);
    try {
      const vigente = await listarRequerimientoDotacionVigente(hoyISO(), cd);
      const mapa = {};
      for (const v of vigente) {
        mapa[`${v.cargo}|${v.turno || ''}`] = String(v.cantidad_requerida);
      }
      setValores(mapa);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [cd]);

  useEffect(() => { cargarVigente(); }, [cargarVigente]);

  function cambiarValor(cargo, turno, valor) {
    setValores(v => ({ ...v, [`${cargo}|${turno}`]: valor }));
  }

  async function guardarTodo() {
    if (!cd) { setError('Elige un CD arriba antes de guardar.'); return; }
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      const items = [];
      for (const cargo of cargos) {
        for (const turno of TURNOS) {
          const valor = valores[`${cargo}|${turno}`];
          if (valor !== undefined && valor !== '') {
            items.push({ cargo, turno, cantidad_requerida: valor });
          }
        }
      }
      if (items.length === 0) {
        setError('No hay ninguna celda con valor para guardar.');
        setGuardando(false);
        return;
      }
      const resultado = await guardarRequerimientoDotacionMasivo({ vigente_desde: vigenteDesde, cd, observacion, items });
      setMensajeOk(`✓ ${resultado.guardados} celdas guardadas para ${cd}.`);
      setObservacion('');
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Matriz de requerimiento (Cargo × Turno)</h2>
      <p className="card-desc">
        Completa la cantidad requerida por cargo y turno <strong>para el CD elegido arriba</strong>.
        Los valores ya vigentes de ese CD vienen precargados; cambia solo lo que necesites y guarda —
        cada celda modificada queda como un nuevo registro en el historial, sin perder lo anterior.
        Esto queda <strong>abierto</strong> (sin fecha de término) hasta que registres un cambio nuevo
        o cierres el período abajo en "Registro histórico con rango".
      </p>

      <div className="field-grid" style={{ marginBottom: 16, maxWidth: 700 }}>
        <div className="field">
          <label>Vigente desde</label>
          <input type="date" value={vigenteDesde} onChange={e => setVigenteDesde(e.target.value)} className="file-input" />
        </div>
        <div className="field">
          <label>Observación / respaldo (aplica a todos los cambios que guardes ahora)</label>
          <input
            type="text" value={observacion} onChange={e => setObservacion(e.target.value)}
            placeholder="Ej: Ajuste solicitado por correo del 10-07-2026, Cyber Days."
            className="file-input"
          />
        </div>
      </div>

      {!cd && <p className="status-msg error">Elige un CD arriba para ver y editar su matriz.</p>}
      {error && <p className="status-msg error">{error}</p>}
      {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

      {cd && cargando ? (
        <p className="status-msg">Cargando valores vigentes…</p>
      ) : cd && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Cargo</th>
                {TURNOS.map(t => <th key={t}>{t}</th>)}
              </tr>
            </thead>
            <tbody>
              {cargos.map(cargo => (
                <tr key={cargo}>
                  <td style={{ textAlign: 'left', fontFamily: 'var(--font-sans)' }}>{cargo}</td>
                  {TURNOS.map(turno => (
                    <td key={turno}>
                      <input
                        type="number" min="0"
                        value={valores[`${cargo}|${turno}`] ?? ''}
                        onChange={e => cambiarValor(cargo, turno, e.target.value)}
                        style={{
                          width: 70, background: 'var(--surface-2)', border: '1px solid var(--border)',
                          borderRadius: 6, padding: '5px 7px', color: 'var(--text)', textAlign: 'center',
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {cargos.length === 0 && (
                <tr><td colSpan={TURNOS.length + 1} className="empty-state">Agrega al menos un cargo arriba para poder registrar requerimiento.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="btn-row">
        <button className="btn" type="button" disabled={guardando || cargando || !cd} onClick={guardarTodo}>
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

// Registro histórico puntual: un solo cargo+turno, con Desde y Hasta
// explícitos — para reconstruir un período pasado (ej. "en julio, en Renca,
// el requerido era X") sin afectar el requerimiento vigente actual.
function RegistroHistorico({ cargos, cd, onGuardado }) {
  const [cargo, setCargo] = useState('');
  const [turno, setTurno] = useState('AM');
  const [cantidad, setCantidad] = useState('');
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState('');
  const [observacion, setObservacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  useEffect(() => { if (cargos.length > 0 && !cargo) setCargo(cargos[0]); }, [cargos]); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar(e) {
    e.preventDefault();
    if (!cd) { setError('Elige un CD arriba antes de registrar.'); return; }
    if (!cargo || !cantidad || !desde) { setError('Cargo, cantidad y fecha desde son obligatorios.'); return; }
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      await crearRequerimientoDotacion({
        cargo, turno, cd, cantidad_requerida: Number(cantidad), vigente_desde: desde,
        vigente_hasta: hasta || undefined, observacion,
      });
      setMensajeOk(`✓ Registrado en ${cd}: ${cargo} / ${turno} = ${cantidad}, desde ${desde}${hasta ? ` hasta ${hasta}` : ' (sin fecha de término)'}.`);
      setCantidad(''); setHasta(''); setObservacion('');
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Registro histórico con rango (retroactivo)</h2>
      <p className="card-desc">
        Para reconstruir un período pasado específico: indica desde cuándo y hasta cuándo aplicó ese
        requerimiento. Deja "Hasta" vacío si sigue vigente hasta hoy (el último registro sin fecha de
        término).
      </p>
      <form onSubmit={guardar}>
        <div className="field-grid">
          <div className="field">
            <label>Cargo</label>
            <select value={cargo} onChange={e => setCargo(e.target.value)} className="file-input">
              {cargos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Turno</label>
            <select value={turno} onChange={e => setTurno(e.target.value)} className="file-input">
              {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Cantidad requerida</label>
            <input type="number" min="0" value={cantidad} onChange={e => setCantidad(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Desde</label>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Hasta (opcional — vacío = sigue vigente)</label>
            <input type="date" value={hasta} min={desde} onChange={e => setHasta(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Observación / respaldo</label>
            <input
              type="text" value={observacion} onChange={e => setObservacion(e.target.value)}
              placeholder="Ej: Reconstrucción histórica de julio 2026, Renca."
              className="file-input"
            />
          </div>
        </div>
        {error && <p className="status-msg error">{error}</p>}
        {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}
        <div className="btn-row">
          <button className="btn" type="submit" disabled={guardando || cargos.length === 0 || !cd}>
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </form>
    </div>
  );
}

function FilaHistorial({ h, esVigente, onEliminar, onGuardado }) {
  const [editando, setEditando] = useState(false);
  const [cantidad, setCantidad] = useState(h.cantidad_requerida);
  const [vigenteHasta, setVigenteHasta] = useState(h.vigente_hasta || '');
  const [observacion, setObservacion] = useState(h.observacion || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    if (vigenteHasta && vigenteHasta < h.vigente_desde) {
      setError('Vigente hasta no puede ser anterior a Vigente desde.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await editarRequerimientoDotacion(h.id, {
        cantidad_requerida: Number(cantidad), vigente_hasta: vigenteHasta || null, observacion,
      });
      setEditando(false);
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <tr style={esVigente ? { background: 'rgba(63,174,106,0.08)' } : undefined}>
        <td style={{ fontFamily: 'var(--font-sans)' }}>{h.cargo}</td>
        <td>
          {h.turno || '—'}
          {esVigente && <span className="badge badge-ok" style={{ marginLeft: 8 }}>Vigente</span>}
        </td>
        <td style={{ fontFamily: 'var(--font-sans)' }}>{h.cd || '—'}</td>
        <td>{h.cantidad_requerida}</td>
        <td>{h.vigente_desde}</td>
        <td>{h.vigente_hasta || <span className="badge badge-muted">Sin término</span>}</td>
        <td style={{ fontFamily: 'var(--font-sans)', whiteSpace: 'normal', minWidth: 260 }}>{h.observacion || '—'}</td>
        <td style={{ fontFamily: 'var(--font-sans)' }}>{h.creado_por || '—'}</td>
        <td style={{ display: 'flex', gap: 10 }}>
          <button
            type="button" onClick={() => setEditando(v => !v)}
            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}
          >
            {editando ? 'Cerrar' : 'Editar'}
          </button>
          <button
            type="button" onClick={onEliminar}
            style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
          >
            Eliminar
          </button>
        </td>
      </tr>
      {editando && (
        <tr>
          <td colSpan={9} style={{ background: 'var(--surface-2)', padding: 14 }}>
            <div className="field-grid" style={{ marginBottom: 10 }}>
              <div className="field">
                <label>Cantidad requerida</label>
                <input type="number" min="0" value={cantidad} onChange={e => setCantidad(e.target.value)} className="file-input" />
              </div>
              <div className="field">
                <label>Vigente hasta (vacío = sin término / sigue vigente)</label>
                <input type="date" value={vigenteHasta} min={h.vigente_desde} onChange={e => setVigenteHasta(e.target.value)} className="file-input" />
              </div>
              <div className="field">
                <label>Observación</label>
                <input type="text" value={observacion} onChange={e => setObservacion(e.target.value)} className="file-input" />
              </div>
            </div>
            {error && <p className="status-msg error">{error}</p>}
            <button className="btn" type="button" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

export default function RequerimientoDotacion() {
  const [cargos, setCargos] = useState([]);
  const [cds, setCds] = useState([]);
  const [cd, setCd] = useState('');
  const [historial, setHistorial] = useState([]);
  const [filtroCargo, setFiltroCargo] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [refrescarSenal, setRefrescarSenal] = useState(0);

  const cargarCargos = useCallback(async () => {
    try {
      setCargos(await listarCargosRequerimiento());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    listarCds().then(lista => {
      setCds(lista);
      if (lista.length > 0) setCd(prev => prev || lista[0]);
    }).catch(() => {});
  }, []);

  const cargarHistorial = useCallback(async () => {
    if (!cd) { setHistorial([]); return; }
    setCargando(true);
    setError(null);
    try {
      setHistorial(await listarRequerimientoDotacion(filtroCargo || undefined, cd));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [filtroCargo, cd]);

  useEffect(() => { cargarCargos(); }, [cargarCargos]);
  useEffect(() => { cargarHistorial(); }, [cargarHistorial, refrescarSenal]);

  const vigentePorClave = new Map();
  for (const h of historial) {
    const clave = `${h.cargo}|${h.turno || ''}`;
    if (!vigentePorClave.has(clave)) vigentePorClave.set(clave, h.id);
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este registro del historial? Esta acción no se puede deshacer.')) return;
    try {
      await eliminarRequerimientoDotacion(id);
      cargarHistorial();
    } catch (err) {
      setError(err.message);
    }
  }

  function refrescarTodo() {
    setRefrescarSenal(n => n + 1);
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent)' }}>
        <h2>CD (Centro de Distribución)</h2>
        <p className="card-desc">
          El requerimiento de dotación es específico de cada CD — elige con cuál vas a trabajar. Todo
          lo de abajo (matriz, registro histórico e historial) corresponde solo a este CD.
        </p>
        <div className="field" style={{ maxWidth: 320 }}>
          <select
            value={cd} onChange={e => setCd(e.target.value)}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--accent)', borderRadius: 8, padding: '10px 12px', color: 'var(--text)', fontSize: '0.9rem', fontWeight: 600 }}
          >
            <option value="">— Elegir CD —</option>
            {cds.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <PanelCargos cargos={cargos} onCambio={cargarCargos} />
      <MatrizRequerimiento cargos={cargos} cd={cd} onGuardado={refrescarTodo} />
      <RegistroHistorico cargos={cargos} cd={cd} onGuardado={refrescarTodo} />

      <div className="card">
        <h2>Historial de requerimiento por cargo y turno {cd && `— ${cd}`}</h2>
        <p className="card-desc">El registro más reciente de cada combinación cargo+turno (resaltado) es el vigente actualmente, para este CD.</p>

        <div className="filters-row">
          <div className="field">
            <label>Filtrar por cargo</label>
            <select value={filtroCargo} onChange={e => setFiltroCargo(e.target.value)} className="file-input">
              <option value="">Todos</option>
              {cargos.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {!cd && <p className="status-msg error">Elige un CD arriba para ver su historial.</p>}
        {error && <p className="status-msg error">{error}</p>}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Cargo</th>
                <th>Turno</th>
                <th>CD</th>
                <th>Cantidad requerida</th>
                <th>Vigente desde</th>
                <th>Vigente hasta</th>
                <th>Observación</th>
                <th>Registrado por</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {historial.map(h => {
                const clave = `${h.cargo}|${h.turno || ''}`;
                const esVigente = vigentePorClave.get(clave) === h.id;
                return (
                  <FilaHistorial
                    key={h.id} h={h} esVigente={esVigente}
                    onEliminar={() => eliminar(h.id)}
                    onGuardado={refrescarTodo}
                  />
                );
              })}
            </tbody>
          </table>
          {!cargando && cd && historial.length === 0 && (
            <div className="empty-state">No hay registros todavía para este CD.</div>
          )}
        </div>
      </div>
    </div>
  );
}