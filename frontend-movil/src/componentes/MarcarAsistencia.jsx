import { useState, useRef } from 'react';
import { registrarMarcacion } from '../api-movil';

function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Este navegador no soporta geolocalización.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(`No se pudo obtener tu ubicación (${err.message}). Revisa que el permiso de ubicación esté activado.`)),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  });
}

export default function MarcarAsistencia({ trabajador, onMarcado, onIrAPin, onCerrarSesion }) {
  const [tipo, setTipo] = useState('entrada');
  const [foto, setFoto] = useState(null);
  const [fotoPreview, setFotoPreview] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const inputFotoRef = useRef(null);

  function elegirFoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFoto(file);
    setFotoPreview(URL.createObjectURL(file));
  }

  async function marcar() {
    setEnviando(true);
    setError(null);
    try {
      const { lat, lng } = await obtenerUbicacion();
      const marcacion = await registrarMarcacion({ tipo, lat, lng, foto });
      onMarcado(marcacion);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pantalla">
      <div className="tarjeta">
        <h1>Hola, {trabajador.nombre?.split(' ')[0] || trabajador.rut}</h1>
        <p className="desc">CD asignado: {trabajador.cd || 'sin configurar'}</p>

        <div className="selector-tipo">
          <button type="button" className={tipo === 'entrada' ? 'activo' : ''} onClick={() => setTipo('entrada')}>
            Entrada
          </button>
          <button type="button" className={tipo === 'salida' ? 'activo' : ''} onClick={() => setTipo('salida')}>
            Salida
          </button>
        </div>

        <div>
          <label>Foto de respaldo (opcional)</label>
          <input
            ref={inputFotoRef} type="file" accept="image/*" capture="user"
            onChange={elegirFoto} style={{ display: 'none' }}
          />
          <button type="button" className="btn-secundario" onClick={() => inputFotoRef.current?.click()}>
            {foto ? 'Cambiar foto' : 'Tomar foto'}
          </button>
          {fotoPreview && <img src={fotoPreview} alt="Previsualización" className="foto-previa" style={{ marginTop: 10 }} />}
        </div>

        {error && <p className="mensaje error">{error}</p>}

        <button className="btn-primario" type="button" onClick={marcar} disabled={enviando}>
          {enviando ? 'Marcando…' : `Marcar ${tipo}`}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <button className="enlace" type="button" onClick={onIrAPin}>Cambiar PIN</button>
          <button className="enlace" type="button" onClick={onCerrarSesion}>Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}
