import { useState } from 'react';
import { obtenerDetalleMarcaciones } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
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
        Marcas crudas de Talana y Cencosud lado a lado, diferencia entre horas de entrada, y horas
        trabajadas con la colación ya aplicada (Noche: se resta 1 hora tomada a mitad de turno;
        AM/PM/Plano: se suman 30 minutos porque la colación es al final y se marca salida antes).
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
      </div>

      {error && <p className="status-msg error">{error}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>RUT</th>
              <th>Nombre</th>
              <th>Fecha</th>
              <th>Entrada Talana</th>
              <th>Salida Talana</th>
              <th>Entrada Cencosud</th>
              <th>Salida Cencosud</th>
              <th>Diferencia entrada (min)</th>
              <th>Horas trabajadas</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i}>
                <td>{f.rut}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                <td>{f.fecha}</td>
                <td>{f.entrada_talana || '—'}</td>
                <td>{f.salida_talana || '—'}</td>
                <td>{f.entrada_cencosud || '—'}</td>
                <td>{f.salida_cencosud || '—'}</td>
                <td className={f.diferencia_entrada_min !== null && Math.abs(f.diferencia_entrada_min) > 20 ? 'atraso-cell leve' : ''}>
                  {f.diferencia_entrada_min ?? '—'}
                </td>
                <td>{f.horas_trabajadas ?? '—'}</td>
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
