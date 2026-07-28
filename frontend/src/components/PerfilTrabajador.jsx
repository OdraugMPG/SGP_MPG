import { useState, useEffect, useCallback } from 'react';
import {
  buscarEmpleados, crearEmpleado, actualizarEmpleado,
  listarAreas, crearArea, eliminarArea, listarCargos, activarEmpleadosMasivo, actualizarAreasMasivo,
  actualizarJefeTurnoMasivo, listarMapeoCdSucursal, guardarMapeoCdSucursal, eliminarMapeoCdSucursal, recalcularCd,
  listarSucursalesSinMapear,
} from '../api';

function PanelMapeoCd() {
  const [mapeo, setMapeo] = useState([]);
  const [sucursal, setSucursal] = useState('');
  const [cd, setCd] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [recalculando, setRecalculando] = useState(false);
  const [mensajeRecalculo, setMensajeRecalculo] = useState(null);
  const [sinMapear, setSinMapear] = useState([]);

  const cargar = useCallback(async () => {
    try {
      setMapeo(await listarMapeoCdSucursal());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const cargarSinMapear = useCallback(async () => {
    try {
      setSinMapear(await listarSucursalesSinMapear());
    } catch (err) {
      // silencioso: no es crítico si esto falla
    }
  }, []);

  useEffect(() => { cargar(); cargarSinMapear(); }, [cargar, cargarSinMapear]);

  async function recalcular() {
    setRecalculando(true);
    setError(null);
    setMensajeRecalculo(null);
    try {
      const resultado = await recalcularCd();
      setMensajeRecalculo(`✓ ${resultado.empleados_con_cd} trabajadores quedaron con CD asignado.`);
      cargarSinMapear();
    } catch (err) {
      setError(err.message);
    } finally {
      setRecalculando(false);
    }
  }

  async function agregar(e) {
    e.preventDefault();
    if (!sucursal.trim() || !cd.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await guardarMapeoCdSucursal(sucursal.trim(), cd.trim());
      setSucursal(''); setCd('');
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(suc) {
    setError(null);
    try {
      await eliminarMapeoCdSucursal(suc);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Mapeo Sucursal → CD</h2>
      <p className="card-desc">
        Cada vez que subes Talana, el sistema asigna el CD de cada trabajador según la columna
        "Sucursal" de la marcación, usando esta tabla. Agrega aquí las sucursales nuevas que
        aparezcan (varias sucursales pueden apuntar al mismo CD).
      </p>

      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
          Si ya subiste Talana pero algunos trabajadores no muestran CD (o el filtro de CD no trae
          datos), usa este botón para recalcularlo con el mapeo actual — no hace falta volver a
          subir los archivos.
        </p>
        <button className="btn" type="button" disabled={recalculando} onClick={recalcular}>
          {recalculando ? 'Recalculando…' : 'Recalcular CD de todos los trabajadores'}
        </button>
        {mensajeRecalculo && <p className="status-msg ok" style={{ marginTop: 8 }}>{mensajeRecalculo}</p>}
      </div>

      {sinMapear.length > 0 && (
        <div style={{ background: 'rgba(233,162,59,0.1)', border: '1px solid var(--warn)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <p style={{ fontSize: '0.82rem', color: 'var(--warn)', margin: '0 0 8px', fontWeight: 600 }}>
            ⚠ Hay {sinMapear.length} sucursal(es) en Talana sin CD asignado — agrégalas abajo:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {sinMapear.map(s => (
              <button
                key={s.sucursal} type="button"
                onClick={() => { setSucursal(s.sucursal); setCd(''); }}
                className="badge badge-warn"
                style={{ border: 'none', cursor: 'pointer', padding: '5px 10px' }}
                title="Click para copiar al formulario de abajo"
              >
                {s.sucursal} ({s.trabajadores} trab.)
              </button>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={agregar} style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input type="text" placeholder="Sucursal (tal como viene en Talana)" value={sucursal} onChange={e => setSucursal(e.target.value)} className="file-input" style={{ maxWidth: 260 }} />
        <input type="text" placeholder="CD (nombre agrupado)" value={cd} onChange={e => setCd(e.target.value)} className="file-input" style={{ maxWidth: 200 }} />
        <button className="btn" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Agregar / Actualizar'}</button>
      </form>

      {error && <p className="status-msg error">{error}</p>}

      <div className="table-scroll" style={{ maxHeight: '30vh' }}>
        <table>
          <thead><tr><th>Sucursal</th><th>CD</th><th></th></tr></thead>
          <tbody>
            {mapeo.map(m => (
              <tr key={m.sucursal}>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{m.sucursal}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{m.cd}</td>
                <td>
                  <button type="button" onClick={() => quitar(m.sucursal)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
            {mapeo.length === 0 && <tr><td colSpan={3} className="empty-state">Sin mapeos todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PanelActualizacionJefeTurno() {
  const [file, setFile] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function procesar() {
    if (!file) return;
    setCargando(true);
    setError(null);
    setResultado(null);
    try {
      const data = await actualizarJefeTurnoMasivo(file);
      setResultado(data);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Actualizar Jefe de Turno (masivo)</h2>
      <p className="card-desc">
        Sube un archivo con columnas <strong>RUT</strong> y <strong>JEFE TURNO</strong> (valores:
        T_RD, T_BV, T_WP, o CG para turno Plano). Corrige de una vez a los trabajadores que
        aparecen como "Sin asignar" en los reportes.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="file" accept=".xlsx,.xlsm,.xls"
          className={`file-input ${file ? 'filled' : ''}`}
          style={{ maxWidth: 320 }}
          onChange={e => { setFile(e.target.files[0] || null); setResultado(null); setError(null); }}
        />
        <button className="btn" type="button" disabled={!file || cargando} onClick={procesar}>
          {cargando ? 'Procesando…' : 'Actualizar Jefes de Turno'}
        </button>
      </div>
      {error && <p className="status-msg error" style={{ marginTop: 10 }}>{error}</p>}
      {resultado && (
        <p className="status-msg ok" style={{ marginTop: 10 }}>
          ✓ {resultado.filas_en_archivo} filas en el archivo · {resultado.actualizados} trabajadores actualizados
        </p>
      )}
    </div>
  );
}

function PanelActualizacionAreas({ onCambio }) {
  const [file, setFile] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function procesar() {
    if (!file) return;
    setCargando(true);
    setError(null);
    setResultado(null);
    try {
      const data = await actualizarAreasMasivo(file);
      setResultado(data);
      setFile(null);
      onCambio?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Actualizar áreas (masivo)</h2>
      <p className="card-desc">
        Sube un archivo con columnas <strong>RUT</strong> y <strong>ÁREA</strong>. Se actualiza el
        área solo de los trabajadores que estén en el archivo; las áreas nuevas se agregan
        automáticamente a la lista de arriba.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="file" accept=".xlsx,.xlsm,.xls"
          className={`file-input ${file ? 'filled' : ''}`}
          style={{ maxWidth: 320 }}
          onChange={e => { setFile(e.target.files[0] || null); setResultado(null); setError(null); }}
        />
        <button className="btn" type="button" disabled={!file || cargando} onClick={procesar}>
          {cargando ? 'Procesando…' : 'Actualizar áreas'}
        </button>
      </div>
      {error && <p className="status-msg error" style={{ marginTop: 10 }}>{error}</p>}
      {resultado && (
        <p className="status-msg ok" style={{ marginTop: 10 }}>
          ✓ {resultado.filas_en_archivo} filas en el archivo · {resultado.actualizados} trabajadores actualizados · {resultado.areas_nuevas} área(s) nueva(s) agregada(s)
        </p>
      )}
    </div>
  );
}

function PanelActivacionMasiva() {
  const [file, setFile] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  async function procesar() {
    if (!file) return;
    setCargando(true);
    setError(null);
    setResultado(null);
    try {
      const data = await activarEmpleadosMasivo(file);
      setResultado(data);
      setFile(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Actualizar trabajadores activos/inactivos (masivo)</h2>
      <p className="card-desc">
        Sube un archivo con la lista de RUTs actualmente vigentes (columna "RUT" recomendada).
        Los que estén en el archivo quedan <strong>activos</strong>; todos los demás pasan a{' '}
        <strong>inactivos</strong> y dejan de aparecer en Dashboard y Reporte Diario.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="file" accept=".xlsx,.xlsm,.xls"
          className={`file-input ${file ? 'filled' : ''}`}
          style={{ maxWidth: 320 }}
          onChange={e => { setFile(e.target.files[0] || null); setResultado(null); setError(null); }}
        />
        <button className="btn" type="button" disabled={!file || cargando} onClick={procesar}>
          {cargando ? 'Procesando…' : 'Actualizar estados'}
        </button>
      </div>
      {error && <p className="status-msg error" style={{ marginTop: 10 }}>{error}</p>}
      {resultado && (
        <p className="status-msg ok" style={{ marginTop: 10 }}>
          ✓ {resultado.ruts_en_archivo} RUTs en el archivo · {resultado.activados} activos · {resultado.desactivados} inactivos (de {resultado.total} trabajadores en total)
        </p>
      )}
    </div>
  );
}

function FormularioEdicion({ empleado, areas, cargos, onGuardado, onCancelar }) {
  const [form, setForm] = useState({
    nombre: empleado.nombre || '',
    apellido_paterno: empleado.apellido_paterno || '',
    apellido_materno: empleado.apellido_materno || '',
    cargo: empleado.cargo || '',
    centro_costo: empleado.centro_costo || '',
    activo: empleado.activo !== false,
    motivo_inactivo: empleado.motivo_inactivo || '',
    tipo_contrato: empleado.tipo_contrato_efectivo || empleado.tipo_contrato || 'OUT',
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar() {
    if (!form.activo && !form.motivo_inactivo.trim()) {
      setError('Debes indicar el motivo por el que queda inactivo.');
      return;
    }
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
      <td colSpan={7} style={{ background: 'var(--surface-2)', padding: 16 }}>
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
          <div className="field">
            <label>Tipo de contrato</label>
            <select value={form.tipo_contrato} onChange={e => setForm(f => ({ ...f, tipo_contrato: e.target.value }))}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }}>
              <option value="OUT">OUT</option>
              <option value="SSTT">SSTT</option>
            </select>
          </div>
          <div className="field">
            <label>Estado</label>
            <select
              value={form.activo ? 'activo' : 'inactivo'}
              onChange={e => setForm(f => ({ ...f, activo: e.target.value === 'activo', motivo_inactivo: e.target.value === 'activo' ? '' : f.motivo_inactivo }))}
              style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }}
            >
              <option value="activo">Activo</option>
              <option value="inactivo">Inactivo</option>
            </select>
          </div>
          {!form.activo && (
            <div className="field">
              <label>Motivo de inactividad</label>
              <input
                type="text" value={form.motivo_inactivo}
                onChange={e => setForm(f => ({ ...f, motivo_inactivo: e.target.value }))}
                placeholder="Ej: Renuncia voluntaria, término de contrato, desvinculación..."
                style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', color: 'var(--text)' }}
              />
            </div>
          )}
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

export default function PerfilTrabajador({ cdGlobal }) {
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
        setResultados(await buscarEmpleados(query, cdGlobal || undefined));
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
    if (query.trim().length >= 2) setResultados(await buscarEmpleados(query, cdGlobal || undefined));
  }

  return (
    <>
      <PanelActivacionMasiva />
      <PanelMapeoCd />
      <PanelActualizacionAreas onCambio={cargarAreas} />
      <PanelActualizacionJefeTurno />
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
                  <th>Contrato</th>
                  <th>Estado</th>
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
                      <td>{emp.tipo_contrato_efectivo || '—'}</td>
                      <td>
                        {emp.activo === false
                          ? <span className="badge badge-danger" title={emp.motivo_inactivo || ''}>Inactivo</span>
                          : <span className="badge badge-ok">Activo</span>}
                      </td>
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
                  <tr><td colSpan={7} className="empty-state">Sin resultados.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
