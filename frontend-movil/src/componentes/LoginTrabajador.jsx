import { useState } from 'react';
import { iniciarSesionTrabajador } from '../api-movil';

export default function LoginTrabajador({ onIngreso }) {
  const [rut, setRut] = useState('');
  const [pin, setPin] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    if (!rut.trim() || !pin.trim()) { setError('RUT y PIN son requeridos.'); return; }
    setCargando(true);
    setError(null);
    try {
      const trabajador = await iniciarSesionTrabajador(rut.trim(), pin.trim());
      onIngreso(trabajador);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="pantalla">
      <div className="tarjeta">
        <h1>Marcación SGP</h1>
        <p className="desc">Ingresa con tu RUT y el PIN que te asignó RRHH.</p>
        <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label>RUT</label>
            <input
              type="text" value={rut} onChange={e => setRut(e.target.value)}
              placeholder="12345678-9" autoComplete="username" autoCapitalize="off"
            />
          </div>
          <div>
            <label>PIN</label>
            <input
              type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••" autoComplete="current-password" maxLength={6}
            />
          </div>
          {error && <p className="mensaje error">{error}</p>}
          <button className="btn-primario" type="submit" disabled={cargando}>
            {cargando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      </div>
    </div>
  );
}
