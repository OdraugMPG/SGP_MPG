import { useState } from 'react';
import { importarArchivosConProgreso } from '../api';

const CAMPOS = [
  { key: 'maestro', label: 'Maestro de Dotación', hint: '.xlsx' },
  { key: 'talana', label: 'Marcaciones Talana', hint: '.xlsm' },
  { key: 'cencosud', label: 'Marcaciones Cencosud', hint: '.xlsx' },
  { key: 'parametros', label: 'Parámetros de Rotación', hint: '.xlsm' },
  { key: 'asignacion', label: 'Asignación Jefe de Turno', hint: '.xlsm' },
];

export default function CargaArchivos({ onImportado }) {
  const [files, setFiles] = useState({});
  const [progreso, setProgreso] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState(null);
  const [resumen, setResumen] = useState(null);

  const todosListos = CAMPOS.every(c => files[c.key]);
  const cargando = progreso !== null || procesando;

  function handleFile(key, fileList) {
    setFiles(prev => ({ ...prev, [key]: fileList[0] || null }));
    setResumen(null);
    setError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setProgreso(0);
    try {
      const resumen = await importarArchivosConProgreso(files, (pct) => {
        setProgreso(pct);
        if (pct >= 100) setProcesando(true);
      });
      setResumen(resumen);
      onImportado?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setProgreso(null);
      setProcesando(false);
    }
  }

  return (
    <div className="card">
      <h2>Cargar planillas de la semana</h2>
      <p className="card-desc">
        Sube los 5 archivos actualizados. Al procesar, se reemplazan todos los datos anteriores
        con la nueva información.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="field-grid">
          {CAMPOS.map(c => (
            <div className="field" key={c.key}>
              <label>{c.label} <span style={{ opacity: 0.5 }}>({c.hint})</span></label>
              <input
                type="file"
                accept=".xlsx,.xlsm"
                className={`file-input ${files[c.key] ? 'filled' : ''}`}
                onChange={e => handleFile(c.key, e.target.files)}
              />
            </div>
          ))}
        </div>

        <div className="btn-row">
          <button className="btn" type="submit" disabled={!todosListos || cargando}>
            {cargando ? 'Procesando…' : 'Procesar planillas'}
          </button>
          {error && <span className="status-msg error">{error}</span>}
          {!error && !todosListos && !cargando && (
            <span className="status-msg">Selecciona los 5 archivos para continuar</span>
          )}
        </div>
      </form>

      {progreso !== null && (
        <div style={{ marginTop: 16, maxWidth: 400 }}>
          <div style={{
            height: 6, borderRadius: 4, background: 'var(--surface-2)',
            border: '1px solid var(--border)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${progreso}%`,
              background: 'var(--accent)', transition: 'width 0.15s ease',
            }} />
          </div>
          <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {progreso < 100
              ? `Subiendo archivos… ${progreso}%`
              : 'Archivos recibidos, procesando en el servidor…'}
          </div>
        </div>
      )}

      {resumen && (
        <div className="summary-grid">
          <div className="summary-tile"><div className="n">{resumen.empleados}</div><div className="l">Empleados</div></div>
          <div className="summary-tile"><div className="n">{resumen.marcaciones_talana}</div><div className="l">Marcaciones Talana</div></div>
          <div className="summary-tile"><div className="n">{resumen.marcaciones_cencosud}</div><div className="l">Marcaciones Cencosud</div></div>
          <div className="summary-tile"><div className="n">{resumen.resultados}</div><div className="l">Días calculados</div></div>
          <div className="summary-tile"><div className="n" style={{ color: 'var(--warn)' }}>{resumen.con_atraso}</div><div className="l">Con atraso</div></div>
          <div className="summary-tile"><div className="n" style={{ color: 'var(--danger)' }}>{resumen.con_inconsistencia}</div><div className="l">Inconsistencias</div></div>
        </div>
      )}
    </div>
  );
}
