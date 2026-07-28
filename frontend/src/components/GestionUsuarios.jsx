import { useState, useEffect, useCallback } from 'react';
import {
  listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, cambiarMiPassword,
  listarRoles, crearRol, actualizarRol, eliminarRol, listarModulosDisponibles, listarCds,
} from '../api';

function FormularioCreacion({ roles, onCreado }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [nombre, setNombre] = useState('');
  const [rol, setRol] = useState('usuario');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await crearUsuario({ usuario, password, nombre, rol });
      setUsuario(''); setPassword(''); setNombre('');
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Crear nueva clave de acceso</h2>
      <p className="card-desc">Crea un usuario y contraseña nuevos para que otra persona pueda entrar al sistema.</p>
      <form onSubmit={guardar}>
        <div className="field-grid">
          <div className="field">
            <label>Usuario</label>
            <input type="text" value={usuario} onChange={e => setUsuario(e.target.value)} className="file-input" required />
          </div>
          <div className="field">
            <label>Contraseña (mín. 6 caracteres)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="file-input" required minLength={6} />
          </div>
          <div className="field">
            <label>Nombre para mostrar</label>
            <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className="file-input" />
          </div>
          <div className="field">
            <label>Rol</label>
            <select value={rol} onChange={e => setRol(e.target.value)} className="file-input">
              {roles.map(r => <option key={r.nombre} value={r.nombre}>{r.nombre}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="status-msg error">{error}</p>}
        <div className="btn-row">
          <button className="btn" type="submit" disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear usuario'}
          </button>
        </div>
      </form>
    </div>
  );
}

function FilaUsuario({ u, roles, cdsDisponibles, onCambio, esUnoMismo }) {
  const [editandoPassword, setEditandoPassword] = useState(false);
  const [passwordNueva, setPasswordNueva] = useState('');
  const [editandoCds, setEditandoCds] = useState(false);
  const [seleccionCds, setSeleccionCds] = useState(new Set(u.cds_visibles || []));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function toggleActivo() {
    setGuardando(true);
    setError(null);
    try {
      await actualizarUsuario(u.id, { activo: !u.activo });
      onCambio();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarRol(nuevoRol) {
    setGuardando(true);
    setError(null);
    try {
      await actualizarUsuario(u.id, { rol: nuevoRol });
      onCambio();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarPassword() {
    if (passwordNueva.length < 6) { setError('Mínimo 6 caracteres.'); return; }
    setGuardando(true);
    setError(null);
    try {
      await actualizarUsuario(u.id, { password: passwordNueva });
      setPasswordNueva('');
      setEditandoPassword(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  function toggleCd(cd) {
    setSeleccionCds(prev => {
      const next = new Set(prev);
      if (next.has(cd)) next.delete(cd); else next.add(cd);
      return next;
    });
  }

  async function guardarCds() {
    setGuardando(true);
    setError(null);
    try {
      await actualizarUsuario(u.id, { cds_visibles: [...seleccionCds] });
      onCambio();
      setEditandoCds(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar el usuario "${u.usuario}"? Esta acción no se puede deshacer.`)) return;
    setGuardando(true);
    setError(null);
    try {
      await eliminarUsuario(u.id);
      onCambio();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <tr>
        <td>{u.usuario}{esUnoMismo && <span className="badge badge-muted" style={{ marginLeft: 6 }}>tú</span>}</td>
        <td style={{ fontFamily: 'var(--font-sans)' }}>{u.nombre}</td>
        <td>
          <select
            value={u.rol} disabled={guardando || esUnoMismo}
            onChange={e => cambiarRol(e.target.value)}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', color: 'var(--text)', fontSize: '0.78rem' }}
          >
            {roles.map(r => <option key={r.nombre} value={r.nombre}>{r.nombre}</option>)}
          </select>
        </td>
        <td>
          {(u.cds_visibles && u.cds_visibles.length > 0)
            ? u.cds_visibles.join(', ')
            : <span className="badge badge-muted">Todos</span>}
        </td>
        <td>
          {u.activo
            ? <span className="badge badge-ok">Activo</span>
            : <span className="badge badge-muted">Deshabilitado</span>}
        </td>
        <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn" type="button" disabled={guardando || esUnoMismo} onClick={toggleActivo}
            style={{ padding: '5px 10px', fontSize: '0.76rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            {u.activo ? 'Deshabilitar' : 'Habilitar'}
          </button>
          <button className="btn" type="button" disabled={guardando} onClick={() => setEditandoCds(v => !v)}
            style={{ padding: '5px 10px', fontSize: '0.76rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            Editar CDs
          </button>
          <button className="btn" type="button" disabled={guardando} onClick={() => setEditandoPassword(v => !v)}
            style={{ padding: '5px 10px', fontSize: '0.76rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}>
            Resetear clave
          </button>
          {!esUnoMismo && (
            <button className="btn" type="button" disabled={guardando} onClick={eliminar}
              style={{ padding: '5px 10px', fontSize: '0.76rem', background: 'var(--surface-2)', color: 'var(--danger)', border: '1px solid var(--border)' }}>
              Eliminar
            </button>
          )}
        </td>
      </tr>
      {editandoCds && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--surface-2)', padding: 14 }}>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>
              Sin marcar ninguno = ve todos los CDs (consolidado). Marca uno o más para restringirlo.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
              {cdsDisponibles.map(c => (
                <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={seleccionCds.has(c)} onChange={() => toggleCd(c)} />
                  {c}
                </label>
              ))}
              {cdsDisponibles.length === 0 && <span className="status-msg">Aún no hay CDs configurados.</span>}
            </div>
            <button className="btn" type="button" disabled={guardando} onClick={guardarCds}>
              {guardando ? 'Guardando…' : 'Guardar CDs'}
            </button>
          </td>
        </tr>
      )}
      {editandoPassword && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0' }}>
              <input
                type="password" placeholder="Nueva contraseña (mín. 6 caracteres)"
                value={passwordNueva} onChange={e => setPasswordNueva(e.target.value)}
                className="file-input" style={{ maxWidth: 260 }}
              />
              <button className="btn" type="button" disabled={guardando} onClick={guardarPassword}>Guardar</button>
              {error && <span className="status-msg error">{error}</span>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CambiarMiPassword({ usuarioActual }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [ok, setOk] = useState(false);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setOk(false);
    try {
      await cambiarMiPassword(actual, nueva);
      setActual(''); setNueva('');
      setOk(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Cambiar mi contraseña</h2>
      <p className="card-desc">Sesión actual: <strong style={{ fontFamily: 'var(--font-sans)' }}>{usuarioActual.nombre || usuarioActual.usuario}</strong></p>
      <form onSubmit={guardar}>
        <div className="field-grid">
          <div className="field">
            <label>Contraseña actual</label>
            <input type="password" value={actual} onChange={e => setActual(e.target.value)} className="file-input" required />
          </div>
          <div className="field">
            <label>Contraseña nueva (mín. 6 caracteres)</label>
            <input type="password" value={nueva} onChange={e => setNueva(e.target.value)} className="file-input" required minLength={6} />
          </div>
        </div>
        {error && <p className="status-msg error">{error}</p>}
        {ok && <p className="status-msg ok">Contraseña actualizada correctamente.</p>}
        <div className="btn-row">
          <button className="btn" type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Actualizar contraseña'}</button>
        </div>
      </form>
    </div>
  );
}

function FilaRol({ rol, modulosDisponibles, onCambio }) {
  const [seleccion, setSeleccion] = useState(new Set(rol.modulos || []));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [expandido, setExpandido] = useState(false);

  function toggleModulo(key) {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await actualizarRol(rol.nombre, [...seleccion]);
      onCambio();
      setExpandido(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return;
    setError(null);
    try {
      await eliminarRol(rol.nombre);
      onCambio();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <tr>
        <td style={{ fontFamily: 'var(--font-sans)' }}>
          {rol.nombre}
          {rol.es_sistema && <span className="badge badge-muted" style={{ marginLeft: 8 }}>Sistema</span>}
        </td>
        <td style={{ fontFamily: 'var(--font-sans)', whiteSpace: 'normal', maxWidth: 380 }}>
          {rol.es_sistema
            ? (rol.nombre === 'admin' ? 'Todos los módulos' : (rol.modulos || []).join(', ') || '—')
            : (rol.modulos || []).join(', ') || '— Ningún módulo habilitado —'}
        </td>
        <td>
          {!rol.es_sistema && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button" className="btn" onClick={() => setExpandido(v => !v)}
                style={{ padding: '5px 10px', fontSize: '0.76rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}
              >
                {expandido ? 'Cerrar' : 'Editar módulos'}
              </button>
              <button
                type="button" onClick={eliminar}
                style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
              >
                Eliminar
              </button>
            </div>
          )}
        </td>
      </tr>
      {expandido && (
        <tr>
          <td colSpan={3} style={{ background: 'var(--surface-2)', padding: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
              {modulosDisponibles.map(m => (
                <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={seleccion.has(m.key)} onChange={() => toggleModulo(m.key)} />
                  {m.label}
                </label>
              ))}
            </div>
            {error && <p className="status-msg error">{error}</p>}
            <button className="btn" type="button" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : 'Guardar módulos'}
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

function FormularioNuevoRol({ modulosDisponibles, onCreado }) {
  const [nombre, setNombre] = useState('');
  const [seleccion, setSeleccion] = useState(new Set());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  function toggleModulo(key) {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function guardar(e) {
    e.preventDefault();
    if (!nombre.trim()) return;
    setGuardando(true);
    setError(null);
    try {
      await crearRol(nombre.trim(), [...seleccion]);
      setNombre(''); setSeleccion(new Set());
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Crear nuevo rol/perfil</h2>
      <p className="card-desc">Define un rol nuevo y qué módulos puede ver.</p>
      <form onSubmit={guardar}>
        <div className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
          <label>Nombre del rol</label>
          <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Coordinador de Turno" className="file-input" />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          {modulosDisponibles.map(m => (
            <label key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={seleccion.has(m.key)} onChange={() => toggleModulo(m.key)} />
              {m.label}
            </label>
          ))}
        </div>
        {error && <p className="status-msg error">{error}</p>}
        <button className="btn" type="submit" disabled={guardando}>
          {guardando ? 'Creando…' : 'Crear rol'}
        </button>
      </form>
    </div>
  );
}

function PanelRoles() {
  const [roles, setRoles] = useState([]);
  const [modulosDisponibles, setModulosDisponibles] = useState([]);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const [r, m] = await Promise.all([listarRoles(), listarModulosDisponibles()]);
      setRoles(r);
      setModulosDisponibles(m);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <>
      <FormularioNuevoRol modulosDisponibles={modulosDisponibles} onCreado={cargar} />
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Roles y módulos habilitados</h2>
        <p className="card-desc">"admin" siempre ve todo el sistema. Los demás roles solo ven los módulos que marques aquí.</p>
        {error && <p className="status-msg error">{error}</p>}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Rol</th><th>Módulos habilitados</th><th></th></tr></thead>
            <tbody>
              {roles.map(r => (
                <FilaRol key={r.nombre} rol={r} modulosDisponibles={modulosDisponibles} onCambio={cargar} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function GestionUsuarios({ usuarioActual }) {
  const [usuarios, setUsuarios] = useState([]);
  const [roles, setRoles] = useState([]);
  const [cds, setCds] = useState([]);
  const [error, setError] = useState(null);
  const esAdmin = usuarioActual.rol === 'admin';

  const cargar = useCallback(async () => {
    try {
      const [u, r, c] = await Promise.all([listarUsuarios(), listarRoles(), listarCds()]);
      setUsuarios(u);
      setRoles(r);
      setCds(c);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { if (esAdmin) cargar(); }, [esAdmin, cargar]);

  return (
    <div>
      <CambiarMiPassword usuarioActual={usuarioActual} />

      {esAdmin ? (
        <>
          <PanelRoles />
          <FormularioCreacion roles={roles} onCreado={cargar} />

          <div className="card">
            <h2>Usuarios del sistema</h2>
            {error && <p className="status-msg error">{error}</p>}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>CDs visibles</th><th>Estado</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {usuarios.map(u => (
                    <FilaUsuario key={u.id} u={u} roles={roles} cdsDisponibles={cds} onCambio={cargar} esUnoMismo={u.usuario === usuarioActual.usuario} />
                  ))}
                </tbody>
              </table>
              {usuarios.length === 0 && <div className="empty-state">No hay usuarios.</div>}
            </div>
          </div>
        </>
      ) : (
        <p className="card-desc">Solo un administrador puede crear o gestionar otros usuarios.</p>
      )}
    </div>
  );
}
