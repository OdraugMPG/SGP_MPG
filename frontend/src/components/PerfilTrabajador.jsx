import { useState, useEffect, useCallback } from 'react';
import {
  buscarEmpleados, crearEmpleado, actualizarEmpleado,
  listarAreas, crearArea, eliminarArea, listarCargos,
} from '../api';

function FormularioEdicion({ empleado, areas, cargos, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    nombre: empleado.nombre || '',
    apellido_paterno: empleado.apellido_paterno || '',
    apellido_materno: empleado.apellido_materno || '',
    cargo: empleado.cargo || '',
    centro_costo: empleado.centro_costo || '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await actualizarEmpleado(empleado.rut, form);
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <tr>
      <td colSpan={6} style={{ background: 'var(--surface-2)', padding: 16 }}>
        <div className="field-grid" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Nombre</label>
            <input type="text" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }} />
          </div>
          <div className="field">
            <label>Apellido paterno</label>
            <input type="text" value={form.apellido_paterno} onChange={e => setForm(f => ({ ...f, apellido_paterno: e.target.value }))}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }} />
          </div>
          <div className="field">
            <label>Apellido materno</label>
            <input type="text" value={form.apellido_materno} onChange={e => setForm(f => ({ ...f, apellido_materno: e.target.value }))}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }} />
          </div>
          <div className="field">
            <label>Cargo</label>
            <select value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }}>
              <option value={form.cargo}>{form.cargo || '— Elegir —'}</option>
              {cargos.filter(c => c !== form.cargo).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Área de trabajo</label>
            <select value={form.centro_costo} onChange={e => setForm(f => ({ ...f, centro_costo: e.target.value }))}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }}>
              <option value="">— Sin área —</option>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="status-msg error">{error}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" type="button" disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
          <button
            type="button" onClick={onCancelar}
            style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', cursor: 'pointer' }}
          >
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}

function FormularioCreacion({ areas, cargos, onCreado, onCancelar }) {
  const [form, setForm] = useState({
    rut: '', nombre: '', apellido_paterno: '', apellido_materno: '', cargo: '', centro_costo: '',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    if (!form.rut || !form.nombre) {
      setError('RUT y nombre son obligatorios.');
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await crearEmpleado(form);
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Nuevo trabajador</h2>
      <p className="card-desc">Para personas que aún no están en el maestro de dotación cargado por Excel.</p>
      <div className="field-grid">
        <div className="field">
          <label>RUT</label>
          <input type="text" placeholder="12345678-9" value={form.rut} onChange={e => setForm(f => ({ ...f, rut: e.target.value }))} className="file-input" />
        </div>
        <div className="field">
          <label>Nombre</label>
          <input type="text" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} className="file-input" />
        </div>
        <div className="field">
          <label>Apellido paterno</label>
          <input type="text" value={form.apellido_paterno} onChange={e => setForm(f => ({ ...f, apellido_paterno: e.target.value }))} className="file-input" />
        </div>
        <div className="field">
          <label>Apellido materno</label>
          <input type="text" value={form.apellido_materno} onChange={e => setForm(f => ({ ...f, apellido_materno: e.target.value }))} className="file-input" />
        </div>
        <div className="field">
          <label>Cargo</label>
          <select value={form.cargo} onChange={e => setForm(f => ({ ...f, cargo: e.target.value }))} className="file-input">
            <option value="">— Elegir —</option>
            {cargos.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Área de trabajo</label>
          <select value={form.centro_costo} onChange={e => setForm(f => ({ ...f, centro_costo: e.target.value }))} className="file-input">
            <option value="">— Sin área —</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      {error && <p className="status-msg error">{error}</p>}
      <div className="btn-row">
        <button className="btn" type="button" disabled={guardando} onClick={guardar}>
          {guardando ? 'Creando…' : 'Crear trabajador'}
        </button>
        <button
          type="button" onClick={onCancelar}
          style={{ background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px', cursor: 'pointer' }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

function PanelAreas({ areas, onCambio }) {
  const [nuevaArea, setNuevaArea] = useState('');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  async function agregar() {
    if (!nuevaArea.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await crearArea(nuevaArea.trim());
      setNuevaArea('');
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
      await eliminarArea(nombre);
      onCambio();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Áreas de trabajo</h2>
      <p className="card-desc">Lista disponible para asignar a los trabajadores.</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {areas.map(a => (
          <span key={a} className="badge badge-muted" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px' }}>
            {a}
            <button
              type="button" onClick={() => quitar(a)}
              style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1 }}
              title="Quitar área"
            >
              ×
            </button>
          </span>
        ))}
      </div>

      {error && <p className="status-msg error">{error}</p>}

      <div style={{ display: 'flex', gap: 10 }}>
        <input
          type="text" placeholder="Nueva área (ej: SH4)"
          value={nuevaArea} onChange={e => setNuevaArea(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && agregar()}
          className="file-input" style={{ maxWidth: 220 }}
        />
        <button className="btn" type="button" disabled={guardando} onClick={agregar}>Agregar</button>
      </div>
    </div>
  );
}

export default function PerfilTrabajador() {
  const [areas, setAreas] = useState([]);
  const [cargos, setCargos] = useState([]);
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [mostrarCreacion, setMostrarCreacion] = useState(false);
  const [error, setError] = useState(null);

  const cargarAreas = useCallback(async () => {
    try {
      setAreas(await listarAreas());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { cargarAreas(); }, [cargarAreas]);
  useEffect(() => { listarCargos().then(setCargos).catch(err => setError(err.message)); }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResultados([]); return; }
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        setResultados(await buscarEmpleados(query));
      } catch (err) {
        setError(err.message);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  async function refrescarBusqueda() {
    setEditando(null);
    if (query.trim().length >= 2) setResultados(await buscarEmpleados(query));
  }

  return (
    <>
      <PanelAreas areas={areas} onCambio={cargarAreas} />

      {mostrarCreacion && (
        <FormularioCreacion
          areas={areas}
          cargos={cargos}
          onCreado={() => { setMostrarCreacion(false); refrescarBusqueda(); }}
          onCancelar={() => setMostrarCreacion(false)}
        />
      )}

      <div className="card">
        <h2>Perfil de trabajador</h2>
        <p className="card-desc">Busca un trabajador para editar su cargo o área de trabajo.</p>

        <div className="filters-row">
          <div className="field" style={{ minWidth: 280 }}>
            <label>Buscar trabajador</label>
            <input type="text" placeholder="RUT o nombre..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          {!mostrarCreacion && (
            <button className="btn" type="button" onClick={() => setMostrarCreacion(true)} style={{ marginBottom: 2 }}>
              + Nuevo trabajador
            </button>
          )}
        </div>

        {error && <p className="status-msg error">{error}</p>}

        {query.trim().length >= 2 && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>RUT</th>
                  <th>Nombre</th>
                  <th>Cargo</th>
                  <th>Área</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {resultados.map(emp => (
                  editando === emp.rut ? (
                    <FormularioEdicion
                      key={emp.rut}
                      empleado={emp}
                      areas={areas}
                      cargos={cargos}
                      onGuardado={refrescarBusqueda}
                      onCancelar={() => setEditando(null)}
                    />
                  ) : (
                    <tr key={emp.rut}>
                      <td>{emp.rut}</td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.nombre} {emp.apellido_paterno}</td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.cargo}</td>
                      <td>{emp.centro_costo || <span className="badge badge-muted">Sin área</span>}</td>
                      <td>
                        <button
                          type="button" className="btn"
                          style={{ padding: '5px 10px', fontSize: '0.78rem' }}
                          onClick={() => setEditando(emp.rut)}
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  )
                ))}
                {!buscando && resultados.length === 0 && (
                  <tr><td colSpan={5} className="empty-state">Sin resultados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
