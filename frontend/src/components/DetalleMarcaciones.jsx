import { useState } from 'react';
import { obtenerDetalleMarcaciones, urlDescargaDetalleMarcaciones } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function celdaDiferencia(valor) {
  if (!valor) return '—';
  const abs = Math.abs(parseInt(valor.replace('-', '').split(':')[0], 10) * 60 + parseInt(valor.split(':')[1], 10));
  const clase = abs > 20 ? 'atraso-cell leve' : '';
  return <span className={clase}>{valor}</span>;
}

export default function DetalleMarcaciones() {
  const [rut, setRut] = useState('');
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      setFilas(await obtenerDetalleMarcaciones({ rut, desde, hasta }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="card">
      <h2>Detalle de marcaciones</h2>
      <p className="card-desc">
        Marcas crudas de Talana (MPG) y Cencosud lado a lado, con turno, cargo, tipo de contrato,
        horas trabajadas y horas extras calculadas por separado para cada sistema (colación ya
        aplicada), y la diferencia en minutos entre ambos en entrada y salida.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>RUT (opcional)</label>
          <input type="text" placeholder="12345678-9" value={rut} onChange={e => setRut(e.target.value)} />
        </div>
        <div className="field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
        <button className="btn" type="button" onClick={buscar} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Buscar'}
        </button>
        <a
          href={urlDescargaDetalleMarcaciones({ rut, desde, hasta })}
          className="btn"
          style={{ textDecoration: 'none', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}
        >
          Descargar Excel
        </a>
      </div>

      {error && <p className="status-msg error">{error}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Rut</th>
              <th>Nombre</th>
              <th>Turno</th>
              <th>Cargo</th>
              <th>Tipo Contrato</th>
              <th>Entrada MPG</th>
              <th>Salida MPG</th>
              <th>Horas Trabajadas</th>
              <th>Horas Extras</th>
              <th>Entrada CENCOSUD</th>
              <th>Salida CENCOSUD</th>
              <th>Horas Trabajadas</th>
              <th>Horas Extras</th>
              <th>Entrada MPG vs CENCOSUD</th>
              <th>Salida MPG vs CENCOSUD</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f.fecha}</td>
                <td>{f.rut}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                <td>{f.turno || '—'}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{f.cargo || '—'}</td>
                <td>{f.tipo_contrato}</td>
                <td>{f.entrada_mpg || '—'}</td>
                <td>{f.salida_mpg || '—'}</td>
                <td>{f.horas_trabajadas_mpg ?? '—'}</td>
                <td>{f.horas_extras_mpg ?? '—'}</td>
                <td>{f.entrada_cencosud || '—'}</td>
                <td>{f.salida_cencosud || '—'}</td>
                <td>{f.horas_trabajadas_cencosud ?? '—'}</td>
                <td>{f.horas_extras_cencosud ?? '—'}</td>
                <td>{celdaDiferencia(f.diferencia_entrada_min)}</td>
                <td>{celdaDiferencia(f.diferencia_salida_min)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cargando && filas.length === 0 && (
          <div className="empty-state">No hay datos para estos filtros.</div>
        )}
      </div>
    </div>
  );
}
