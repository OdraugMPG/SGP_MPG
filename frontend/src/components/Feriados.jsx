import { useState, useEffect, useCallback } from 'react';
import { listarFeriados, previsualizarFeriadosApi, confirmarFeriados, crearFeriado, eliminarFeriado } from '../api';

function anioActual() {
  return new Date().getFullYear();
}

function PanelCargaApi({ onGuardado }) {
  const [anio, setAnio] = useState(anioActual());
  const [previsualizacion, setPrevisualizacion] = useState(null); // [{fecha, nombre, irrenunciable, incluir}]
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  async function consultarApi() {
    setCargando(true);
    setError(null);
    setMensajeOk(null);
    setPrevisualizacion(null);
    try {
      const feriados = await previsualizarFeriadosApi(anio);
      setPrevisualizacion(feriados.map(f => ({ ...f, incluir: true })));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  function actualizarFila(idx, campo, valor) {
    setPrevisualizacion(prev => prev.map((f, i) => i === idx ? { ...f, [campo]: valor } : f));
  }

  function marcarTodos(valor) {
    setPrevisualizacion(prev => prev.map(f => ({ ...f, incluir: valor })));
  }

  async function confirmar() {
    const seleccionados = previsualizacion.filter(f => f.incluir);
    if (seleccionados.length === 0) { setError('Marca al menos un feriado para guardar.'); return; }
    setGuardando(true);
    setError(null);
    try {
      const resultado = await confirmarFeriados(
        seleccionados.map(({ fecha, nombre, irrenunciable }) => ({ fecha, nombre, irrenunciable }))
      );
      setMensajeOk(`✓ ${resultado.guardados} feriados guardados para ${anio}.`);
      setPrevisualizacion(null);
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Cargar feriados desde la API pública</h2>
      <p className="card-desc">
        Trae el calendario oficial de feriados de Chile para el año que elijas. Antes de guardar nada,
        puedes revisar la lista, desmarcar los que no quieras, o editar el nombre — solo se guarda lo
        que confirmes.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Año</label>
          <input type="number" value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ width: 100 }} className="file-input" />
        </div>
        <button className="btn" type="button" onClick={consultarApi} disabled={cargando}>
          {cargando ? 'Consultando…' : 'Cargar desde API'}
        </button>
      </div>

      {error && <p className="status-msg error">{error}</p>}
      {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

      {previsualizacion && (
        <>
          <div style={{ display: 'flex', gap: 14, margin: '10px 0', fontSize: '0.8rem' }}>
            <button type="button" onClick={() => marcarTodos(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
              Marcar todos
            </button>
            <button type="button" onClick={() => marcarTodos(false)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
              Marcar ninguno
            </button>
          </div>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Fecha</th>
                  <th>Nombre</th>
                  <th>Irrenunciable</th>
                </tr>
              </thead>
              <tbody>
                {previsualizacion.map((f, i) => (
                  <tr key={f.fecha}>
                    <td>
                      <input type="checkbox" checked={f.incluir} onChange={e => actualizarFila(i, 'incluir', e.target.checked)} />
                    </td>
                    <td>{f.fecha}</td>
                    <td>
                      <input
                        type="text" value={f.nombre} onChange={e => actualizarFila(i, 'nombre', e.target.value)}
                        style={{ width: '100%', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 7px', color: 'var(--text)' }}
                      />
                    </td>
                    <td>
                      <input type="checkbox" checked={f.irrenunciable} onChange={e => actualizarFila(i, 'irrenunciable', e.target.checked)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn" type="button" disabled={guardando} onClick={confirmar}>
              {guardando ? 'Guardando…' : `Confirmar y guardar (${previsualizacion.filter(f => f.incluir).length})`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PanelRegistroManual({ onGuardado }) {
  const [fecha, setFecha] = useState('');
  const [nombre, setNombre] = useState('');
  const [irrenunciable, setIrrenunciable] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    if (!fecha || !nombre.trim()) { setError('Fecha y nombre son obligatorios.'); return; }
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      await crearFeriado({ fecha, nombre: nombre.trim(), irrenunciable });
      setMensajeOk(`✓ Registrado: ${nombre} (${fecha}).`);
      setFecha(''); setNombre(''); setIrrenunciable(false);
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Registrar feriado manualmente</h2>
      <p className="card-desc">
        Para feriados puente, aniversarios de la empresa, u otros que no vengan en el calendario oficial.
      </p>
      <form onSubmit={guardar}>
        <div className="field-grid" style={{ marginBottom: 10 }}>
          <div className="field">
            <label>Fecha</label>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Nombre</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className="file-input" placeholder="Ej: Feriado puente" />
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer', marginBottom: 10 }}>
          <input type="checkbox" checked={irrenunciable} onChange={e => setIrrenunciable(e.target.checked)} />
          Irrenunciable
        </label>
        {error && <p className="status-msg error">{error}</p>}
        {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}
        <button className="btn" type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Registrar'}
        </button>
      </form>
    </div>
  );
}

export default function Feriados() {
  const [anioFiltro, setAnioFiltro] = useState(anioActual());
  const [feriados, setFeriados] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setFeriados(await listarFeriados(anioFiltro));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [anioFiltro]);

  useEffect(() => { cargar(); }, [cargar]);

  async function eliminar(fecha) {
    if (!confirm(`¿Eliminar el feriado del ${fecha}? Esto puede afectar cálculos de dotación ya hechos con esa fecha.`)) return;
    try {
      await eliminarFeriado(fecha);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <PanelCargaApi onGuardado={cargar} />
      <PanelRegistroManual onGuardado={cargar} />

      <div className="card">
        <h2>Feriados registrados</h2>
        <p className="card-desc">
          Estos feriados se consideran como día libre para todos los turnos en el cálculo de
          Cumplimiento de Dotación (igual que un domingo), y el turno Noche además descansa el día
          previo a cada uno.
        </p>

        <div className="filters-row">
          <div className="field">
            <label>Año</label>
            <input type="number" value={anioFiltro} onChange={e => setAnioFiltro(Number(e.target.value))} style={{ width: 100 }} className="file-input" />
          </div>
        </div>

        {error && <p className="status-msg error">{error}</p>}

        <div className="table-scroll">
          <table>
            <thead>
              <tr><th>Fecha</th><th>Nombre</th><th>Irrenunciable</th><th></th></tr>
            </thead>
            <tbody>
              {feriados.map(f => (
                <tr key={f.fecha}>
                  <td>{f.fecha}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                  <td>{f.irrenunciable ? <span className="badge badge-warn">Sí</span> : '—'}</td>
                  <td>
                    <button
                      type="button" onClick={() => eliminar(f.fecha)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
              {!cargando && feriados.length === 0 && (
                <tr><td colSpan={4} className="empty-state">Sin feriados registrados para {anioFiltro}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
