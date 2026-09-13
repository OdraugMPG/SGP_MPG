import { useState } from 'react';
import { cambiarPin } from '../api-movil';

export default function CambiarPin({ onVolver }) {
  const [pinActual, setPinActual] = useState('');
  const [pinNuevo, setPinNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  async function enviar(e) {
    e.preventDefault();
    setError(null);
    setMensajeOk(null);
    setGuardando(true);
    try {
      await cambiarPin(pinActual, pinNuevo);
      setMensajeOk('PIN actualizado.');
      setPinActual('');
      setPinNuevo('');
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="pantalla">
      <div className="tarjeta">
        <h1>Cambiar PIN</h1>
        <form onSubmit={enviar} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label>PIN actual</label>
            <input type="password" inputMode="numeric" maxLength={6} value={pinActual} onChange={e => setPinActual(e.target.value.replace(/\D/g, ''))} />
          </div>
          <div>
            <label>PIN nuevo (mínimo 4 dígitos)</label>
            <input type="password" inputMode="numeric" maxLength={6} value={pinNuevo} onChange={e => setPinNuevo(e.target.value.replace(/\D/g, ''))} />
          </div>
          {error && <p className="mensaje error">{error}</p>}
          {mensajeOk && <p className="mensaje ok">{mensajeOk}</p>}
          <button className="btn-primario" type="submit" disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </form>
        <button className="enlace" type="button" onClick={onVolver}>Volver</button>
      </div>
    </div>
  );
}
