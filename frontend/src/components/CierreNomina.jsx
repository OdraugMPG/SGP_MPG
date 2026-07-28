import { useState } from 'react';
import { obtenerCierreNomina, urlDescargaCierreNomina } from '../api';

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function CierreNomina({ cdGlobal }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [filas, setFilas] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      setFilas(await obtenerCierreNomina(desde, hasta, cdGlobal || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card">
      <h2>Cierre de Nómina</h2>
      <p className="card-desc">
        Horas trabajadas y horas extras consolidadas por trabajador, en el rango de fechas que
        elijas (no está limitado al mes en curso) — listo para entregar a RRHH y procesar los
        pagos. El cálculo usa las marcaciones de Talana con la colación ya aplicada, igual que en
        "Detalle de Marcaciones". Los días con solo entrada o solo salida marcada (falta la otra
        marca) <strong>no se suman a las horas</strong> — se muestran aparte en "Días marca
        incompleta" para que los revises antes de pagar.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
        <button className="btn" type="button" onClick={buscar} disabled={cargando}>
          {cargando ? 'Calculando…' : 'Calcular cierre'}
        </button>
        {filas && filas.length > 0 && (
          <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaCierreNomina(desde, hasta, cdGlobal)}>
            Descargar Excel
          </a>
        )}
      </div>

      {cdGlobal && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Filtrado por CD: <strong>{cdGlobal}</strong> (elegido en el encabezado)
        </p>
      )}

      {error && <p className="status-msg error">{error}</p>}

      {filas && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Contrato</th>
                <th>Días trabajados</th>
                <th>Días marca incompleta</th>
                <th>Horas trabajadas</th>
                <th>Horas extras</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.rut}>
                  <td>{f.rut}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.cargo}</td>
                  <td>{f.tipo_contrato}</td>
                  <td>{f.dias_trabajados}</td>
                  <td>
                    {f.dias_incompletos > 0 ? (
                      <span className="badge badge-danger" title="Días con solo entrada o solo salida marcada — no están sumados en las horas, hay que revisarlos manualmente antes de pagar.">
                        ⚠ {f.dias_incompletos}
                      </span>
                    ) : '—'}
                  </td>
                  <td><strong>{f.horas_trabajadas}</strong></td>
                  <td className={f.horas_extras !== '00:00' ? 'atraso-cell' : ''}>{f.horas_extras}</td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr><td colSpan={8} className="empty-state">No hay datos para este rango.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
