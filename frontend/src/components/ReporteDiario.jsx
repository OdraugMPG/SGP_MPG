import { useState } from 'react';
import { obtenerReporteDiario, urlDescargaReporteDiario, obtenerLogMarcacion } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const ETIQUETA_ERROR = {
  doble_entrada: 'Doble marca "Entrada"',
  doble_salida: 'Doble marca "Salida"',
  sin_marca_salida_talana: 'Sin marca de salida (sanción 4h)',
};

export default function ReporteDiario() {
  const [fecha, setFecha] = useState(hoyISO());
  const [filas, setFilas] = useState(null);
  const [log, setLog] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      const [res, logRes] = await Promise.all([
        obtenerReporteDiario(fecha),
        obtenerLogMarcacion(fecha),
      ]);
      setFilas(res);
      setLog(logRes);
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
                  <td className={f.salida_sancion ? 'atraso-cell severo' : ''}>
                    {f['HORA (SALIDA)']}{f.salida_sancion && ' ⚠'}
                  </td>
                  <td>{f.CONTRATO}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filas.length === 0 && <div className="empty-state">No hay datos para esta fecha.</div>}
        </div>
      )}

      {log && log.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2>Log de errores de marcación</h2>
          <p className="card-desc">
            Casos detectados este día: doble marca del mismo tipo (reasignada automáticamente) o
            falta de marca de salida en Talana (sancionada a 4 horas). Útil para informar al trabajador.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>RUT</th>
                  <th>Nombre</th>
                  <th>Tipo de error</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l, i) => (
                  <tr key={i}>
                    <td>{l.rut}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{l.nombre}</td>
                    <td><span className="badge badge-warn">{ETIQUETA_ERROR[l.tipo_error] || l.tipo_error}</span></td>
                    <td style={{ whiteSpace: 'normal', fontFamily: 'var(--font-sans)', minWidth: 320 }}>{l.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
