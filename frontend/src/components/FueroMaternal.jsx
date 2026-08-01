import { useState, useEffect, useCallback } from 'react';
import { buscarEmpleados, listarFueroMaternal, crearFueroMaternal, editarFueroMaternal, eliminarFueroMaternal } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function FormularioNuevo({ onGuardado }) {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [seleccionada, setSeleccionada] = useState(null);
  const [fechaProbableParto, setFechaProbableParto] = useState('');
  const [fechaInicioFuero, setFechaInicioFuero] = useState(hoyISO());
  const [fechaTerminoFuero, setFechaTerminoFuero] = useState('');
  const [restriccionTurno, setRestriccionTurno] = useState(false);
  const [observaciones, setObservaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  useEffect(() => {
    if (query.trim().length < 2) { setResultados([]); return; }
    const timer = setTimeout(async () => {
      try { setResultados(await buscarEmpleados(query.trim())); } catch { /* silencioso */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function guardar(e) {
    e.preventDefault();
    if (!seleccionada) { setError('Busca y selecciona a la trabajadora.'); return; }
    if (!fechaInicioFuero) { setError('La fecha de inicio del fuero es obligatoria.'); return; }
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      await crearFueroMaternal({
        rut: seleccionada.rut,
        fecha_probable_parto: fechaProbableParto || undefined,
        fecha_inicio_fuero: fechaInicioFuero,
        fecha_termino_fuero: fechaTerminoFuero || undefined,
        restriccion_turno: restriccionTurno,
        observaciones,
      });
      setMensajeOk(`✓ Registrado: ${seleccionada.nombre} ${seleccionada.apellido_paterno}.`);
      setSeleccionada(null); setQuery(''); setFechaProbableParto(''); setFechaTerminoFuero('');
      setRestriccionTurno(false); setObservaciones('');
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Registrar fuero maternal</h2>
      <p className="card-desc">
        Dato sensible (Art. 201 Código del Trabajo) — solo accesible desde este módulo restringido.
        Mientras el fuero esté vigente, el sistema bloqueará automáticamente cualquier intento de
        desvinculación desde "Perfiles" (la renuncia voluntaria de la trabajadora sí se permite).
      </p>

      <form onSubmit={guardar}>
        <div className="field" style={{ marginBottom: 14, maxWidth: 420, position: 'relative' }}>
          <label>Buscar trabajadora (RUT o nombre)</label>
          <input
            type="text" value={seleccionada ? `${seleccionada.nombre} ${seleccionada.apellido_paterno} — ${seleccionada.rut}` : query}
            onChange={e => { setQuery(e.target.value); setSeleccionada(null); }}
            placeholder="RUT o nombre..." className="file-input"
          />
          {!seleccionada && resultados.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, width: '100%', maxHeight: 220, overflowY: 'auto' }}>
              {resultados.map(r => (
                <div
                  key={r.rut} onClick={() => { setSeleccionada(r); setResultados([]); }}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-sans)', fontSize: '0.85rem' }}
                >
                  {r.nombre} {r.apellido_paterno} — {r.rut} · {r.cargo}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field-grid">
          <div className="field">
            <label>Fecha probable de parto (FPP)</label>
            <input type="date" value={fechaProbableParto} onChange={e => setFechaProbableParto(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Fuero vigente desde</label>
            <input type="date" value={fechaInicioFuero} onChange={e => setFechaInicioFuero(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Fuero vigente hasta (opcional — normalmente 1 año después del término del post-natal)</label>
            <input type="date" value={fechaTerminoFuero} onChange={e => setFechaTerminoFuero(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Observaciones</label>
            <input type="text" value={observaciones} onChange={e => setObservaciones(e.target.value)} className="file-input" placeholder="Opcional" />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', marginTop: 10 }}>
          <input type="checkbox" checked={restriccionTurno} onChange={e => setRestriccionTurno(e.target.checked)} />
          Tiene restricción de turno (nocturno / trabajo pesado) según Art. 202
        </label>

        {error && <p className="status-msg error">{error}</p>}
        {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn" type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Registrar'}
          </button>
        </div>
      </form>
    </div>
  );
}

function FilaFuero({ f, onCambio }) {
  const [editando, setEditando] = useState(false);
  const [fechaTerminoFuero, setFechaTerminoFuero] = useState(f.fecha_termino_fuero || '');
  const [fechaPartoReal, setFechaPartoReal] = useState(f.fecha_parto_real || '');
  const [observaciones, setObservaciones] = useState(f.observaciones || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await editarFueroMaternal(f.id, {
        fecha_termino_fuero: fechaTerminoFuero || null,
        fecha_parto_real: fechaPartoReal || null,
        observaciones,
      });
      setEditando(false);
      onCambio();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
    try {
      await eliminarFueroMaternal(f.id);
      onCambio();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <tr style={f.vigente ? { background: 'rgba(63,174,106,0.08)' } : undefined}>
        <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre} {f.apellido_paterno}</td>
        <td>{f.rut}</td>
        <td style={{ fontFamily: 'var(--font-sans)' }}>{f.cargo}</td>
        <td>{f.fecha_probable_parto || '—'}</td>
        <td>{f.fecha_inicio_fuero}</td>
        <td>{f.fecha_termino_fuero || <span className="badge badge-muted">Sin definir</span>}</td>
        <td>{f.fecha_parto_real || '—'}</td>
        <td>{f.restriccion_turno ? <span className="badge badge-warn">Sí</span> : '—'}</td>
        <td>
          {f.vigente ? <span className="badge badge-ok">Vigente</span> : <span className="badge badge-muted">Terminado</span>}
        </td>
        <td style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={() => setEditando(v => !v)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}>
            {editando ? 'Cerrar' : 'Editar'}
          </button>
          <button type="button" onClick={eliminar} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}>
            Eliminar
          </button>
        </td>
      </tr>
      {editando && (
        <tr>
          <td colSpan={10} style={{ background: 'var(--surface-2)', padding: 14 }}>
            <div className="field-grid" style={{ marginBottom: 10 }}>
              <div className="field">
                <label>Fuero vigente hasta</label>
                <input type="date" value={fechaTerminoFuero} onChange={e => setFechaTerminoFuero(e.target.value)} className="file-input" />
              </div>
              <div className="field">
                <label>Fecha de parto real</label>
                <input type="date" value={fechaPartoReal} onChange={e => setFechaPartoReal(e.target.value)} className="file-input" />
              </div>
              <div className="field">
                <label>Observaciones</label>
                <input type="text" value={observaciones} onChange={e => setObservaciones(e.target.value)} className="file-input" />
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

export default function FueroMaternal() {
  const [registros, setRegistros] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setRegistros(await listarFueroMaternal());
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const vigentes = registros.filter(r => r.vigente);

  return (
    <div>
      <FormularioNuevo onGuardado={cargar} />

      <div className="card">
        <h2>Registro de Fuero Maternal</h2>
        <p className="card-desc">
          {vigentes.length} trabajadora(s) con fuero vigente actualmente. Este listado es un dato
          sensible — solo debería estar habilitado para RRHH.
        </p>

        {error && <p className="status-msg error">{error}</p>}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>RUT</th>
                <th>Cargo</th>
                <th>FPP</th>
                <th>Fuero desde</th>
                <th>Fuero hasta</th>
                <th>Parto real</th>
                <th>Restricción turno</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {registros.map(f => <FilaFuero key={f.id} f={f} onCambio={cargar} />)}
              {!cargando && registros.length === 0 && (
                <tr><td colSpan={10} className="empty-state">No hay registros todavía.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
