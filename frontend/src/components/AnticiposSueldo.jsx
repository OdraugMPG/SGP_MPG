import { useState, useRef } from 'react';
import { validarAnticipos, descargarReporteAnticipos } from '../api';

function formatoMonto(n) {
  return new Intl.NumberFormat('es-CL').format(n || 0);
}

export default function AnticiposSueldo() {
  const [file, setFile] = useState(null);
  const [filas, setFilas] = useState(null);
  const [validando, setValidando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  function elegirArchivo(e) {
    const f = e.target.files?.[0];
    setFile(f || null);
    setFilas(null);
    setError(null);
  }

  async function validar() {
    if (!file) { setError('Elige un archivo Excel primero.'); return; }
    setValidando(true);
    setError(null);
    try {
      setFilas(await validarAnticipos(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setValidando(false);
    }
  }

  async function descargar() {
    if (!file) return;
    setDescargando(true);
    setError(null);
    try {
      await descargarReporteAnticipos(file);
    } catch (err) {
      setError(err.message);
    } finally {
      setDescargando(false);
    }
  }

  const aprobados = filas ? filas.filter(f => f.aprobado).length : 0;
  const noAprobados = filas ? filas.length - aprobados : 0;

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Validar Anticipos de Sueldo</h2>
        <p className="card-desc">
          Sube el Excel con las columnas RUT, Nombre, Cargo y Monto. Cada solicitud se cruza contra las
          faltas injustificadas (F_In) registradas en el mes en curso — quien tenga al menos una queda
          marcado como "No aprobado" en el reporte, junto al detalle de días y fechas, para que RRHH
          decida. No se guarda nada de esta carga en el sistema.
        </p>

        <div className="filters-row">
          <div className="field">
            <label>Archivo Excel</label>
            <input
              ref={inputRef} type="file" accept=".xlsx,.xls"
              onChange={elegirArchivo} className="file-input"
            />
          </div>
          <button className="btn" type="button" onClick={validar} disabled={!file || validando}>
            {validando ? 'Validando…' : 'Validar'}
          </button>
          {filas && (
            <button className="btn" type="button" onClick={descargar} disabled={descargando}>
              {descargando ? 'Generando…' : 'Descargar reporte Excel'}
            </button>
          )}
        </div>

        {error && <p className="status-msg error">{error}</p>}

        {filas && (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {filas.length} solicitudes · <span style={{ color: 'var(--ok)' }}>{aprobados} aprobadas</span> ·{' '}
            <span style={{ color: 'var(--danger)' }}>{noAprobados} no aprobadas</span>
          </p>
        )}
      </div>

      {filas && (
        <div className="card">
          <h2>Resultado</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>RUT</th><th>Nombre</th><th>Cargo</th><th>Monto</th><th>Estado</th>
                  <th>Días Falta Injust.</th><th>Fechas</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(f => (
                  <tr key={f.rut}>
                    <td>{f.rut}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                    <td>{f.cargo}</td>
                    <td>${formatoMonto(f.monto)}</td>
                    <td>
                      {f.aprobado
                        ? <span className="badge badge-ok">Aprobado</span>
                        : <span className="badge badge-danger">No aprobado</span>}
                    </td>
                    <td>{f.dias_ausencia || '—'}</td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {f.fechas_ausencia.join(', ') || '—'}
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={7} className="empty-state">Sin filas válidas en el archivo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
