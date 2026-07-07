import { useState } from 'react';
import { obtenerReporteDiario, urlDescargaReporteDiario } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReporteDiario() {
  const [fecha, setFecha] = useState(hoyISO());
  const [filas, setFilas] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      const res = await obtenerReporteDiario(fecha);
      setFilas(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card">
      <h2>Reporte diario</h2>
      <p className="card-desc">
        Vista lista para entregar al cliente: entrada y salida de cada trabajador para un día específico.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <button className="btn" type="button" onClick={buscar} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Ver reporte'}
        </button>
        {filas && filas.length > 0 && (
          <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaReporteDiario(fecha)}>
            Descargar Excel
          </a>
        )}
      </div>

      {error && <p className="status-msg error">{error}</p>}

      {filas && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Empresa</th>
                <th>Nombre</th>
                <th>RUT</th>
                <th>Cargo</th>
                <th>Turno</th>
                <th>Fecha</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Contrato</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.RUT}>
                  <td>{f['N°']}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.EMPRESA}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.NOMBRE}</td>
                  <td>{f.RUT}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.CARGO}</td>
                  <td>{f.TURNO}</td>
                  <td>{f.FECHA}</td>
                  <td>{f['HORA (ENTRADA)']}</td>
                  <td>{f['HORA (SALIDA)']}</td>
                  <td>{f.CONTRATO}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filas.length === 0 && <div className="empty-state">No hay datos para esta fecha.</div>}
        </div>
      )}
    </div>
  );
}
