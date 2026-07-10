import { useState } from 'react';
import { actualizarMarcacionesConProgreso } from '../api';

function TarjetaActualizacion({ fuente, titulo, hint, onActualizado }) {
  const [file, setFile] = useState(null);
  const [progreso, setProgreso] = useState(null); // 0-100 mientras sube, null si no está subiendo
  const [procesando, setProcesando] = useState(false); // true entre "subida terminada" y "respuesta del servidor"
  const [error, setError] = useState(null);
  const [resultado, setResultado] = useState(null);

  const cargando = progreso !== null || procesando;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setResultado(null);
    setProgreso(0);
    try {
      const data = await actualizarMarcacionesConProgreso(fuente, file, (pct) => {
        setProgreso(pct);
        if (pct >= 100) setProcesando(true); // subida lista, esperando que el servidor procese
      });
      setResultado(data);
      setFile(null);
      e.target.reset();
      onActualizado?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgreso(null);
      setProcesando(false);
    }
  }

  return (
    <div style={{
      background: 'var(--surface-2)', border: '1px solid var(--border)',
      borderRadius: 10, padding: 18, flex: '1 1 300px',
    }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '0.95rem' }}>{titulo}</h3>
      <p style={{ margin: '0 0 14px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{hint}</p>

      <form onSubmit={handleSubmit}>
        <input
          type="file"
          accept=".xlsx,.xlsm"
          className={`file-input ${file ? 'filled' : ''}`}
          disabled={cargando}
          onChange={e => { setFile(e.target.files[0] || null); setResultado(null); setError(null); }}
        />
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn" type="submit" disabled={!file || cargando}>
            {cargando ? 'Procesando…' : 'Actualizar'}
          </button>
        </div>
      </form>

      {progreso !== null && (
        <div style={{ marginTop: 14 }}>
          <div style={{
            height: 6, borderRadius: 4, background: 'var(--surface)',
            border: '1px solid var(--border)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${progreso}%`,
              background: 'var(--accent)', transition: 'width 0.15s ease',
            }} />
          </div>
          <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {progreso < 100
              ? `Subiendo archivo… ${progreso}%`
              : 'Archivo recibido, procesando en el servidor…'}
          </div>
        </div>
      )}

      {error && <p className="status-msg error" style={{ marginTop: 10 }}>{error}</p>}

      {resultado && (
        <div style={{ marginTop: 12, fontSize: '0.8rem', color: 'var(--ok)' }}>
          ✓ {resultado.filas_cargadas} marcaciones actualizadas
          {resultado.fechas_actualizadas?.length > 0 && (
            <> · Fechas: {resultado.fechas_actualizadas.join(', ')}</>
          )}
        </div>
      )}
    </div>
  );
}

export default function ActualizacionDiaria({ onActualizado }) {
  return (
    <div className="card">
      <h2>Actualización diaria de marcaciones</h2>
      <p className="card-desc">
        Sube solo el archivo del día (Talana o Cencosud) para actualizar las marcaciones de esas
        fechas, sin tocar el maestro de empleados, parámetros ni asignaciones. Los atrasos y
        cruces se recalculan automáticamente al terminar.
      </p>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <TarjetaActualizacion
          fuente="talana"
          titulo="Marcaciones Talana"
          hint="Reemplaza únicamente los días incluidos en este archivo (.xlsm)"
          onActualizado={onActualizado}
        />
        <TarjetaActualizacion
          fuente="cencosud"
          titulo="Marcaciones Cencosud"
          hint="Reemplaza únicamente los días incluidos en este archivo (.xlsx)"
          onActualizado={onActualizado}
        />
      </div>
    </div>
  );
}
