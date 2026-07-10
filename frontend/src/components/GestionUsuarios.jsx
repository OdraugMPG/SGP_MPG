import { useState, useEffect, useCallback } from 'react';
import {
  listarUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario, cambiarMiPassword,
} from '../api';

function FormularioCreacion({ onCreado }) {
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
      setUsuario(''); setPassword(''); setNombre(''); setRol('usuario');
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
              <option value="usuario">Usuario</option>
              <option value="admin">Administrador</option>
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

function FilaUsuario({ u, onCambio, esUnoMismo }) {
  const [editandoPassword, setEditandoPassword] = useState(false);
  const [passwordNueva, setPasswordNueva] = useState('');
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
            <option value="usuario">Usuario</option>
            <option value="admin">Administrador</option>
          </select>
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
      {editandoPassword && (
        <tr>
          <td colSpan={5} style={{ background: 'var(--surface-2)' }}>
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

export default function GestionUsuarios({ usuarioActual }) {
  const [usuarios, setUsuarios] = useState([]);
  const [error, setError] = useState(null);
  const esAdmin = usuarioActual.rol === 'admin';

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await listarUsuarios());
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
          <FormularioCreacion onCreado={cargar} />

          <div className="card">
            <h2>Usuarios del sistema</h2>
            {error && <p className="status-msg error">{error}</p>}
            <div className="table-scroll">
              <table>
                <thead>
                  <tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr>
                </thead>
                <tbody>
                  {usuarios.map(u => (
                    <FilaUsuario key={u.id} u={u} onCambio={cargar} esUnoMismo={u.usuario === usuarioActual.usuario} />
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
