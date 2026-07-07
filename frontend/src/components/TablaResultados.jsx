import { useEffect, useState, useCallback } from 'react';
import { obtenerResultados } from '../api';

function claseAtraso(min) {
  if (min === null || min === undefined) return '';
  if (min <= 0) return '';
  if (min > 60) return 'severo';
  return 'leve';
}

function BadgeInconsistencia({ valor }) {
  if (!valor) return <span className="badge badge-ok">OK</span>;
  const esTalana = valor.toLowerCase().includes('talana');
  return (
    <span className="badge badge-danger" title={valor}>
      {esTalana ? 'Sin marca Cencosud' : 'Sin marca Talana'}
    </span>
  );
}

export default function TablaResultados({ refrescarSenal }) {
  const [filtros, setFiltros] = useState({
    rut: '', desde: '', hasta: '', soloAtrasos: false, soloInconsistencias: false,
  });
  const [datos, setDatos] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await obtenerResultados({
        rut: filtros.rut || undefined,
        desde: filtros.desde || undefined,
        hasta: filtros.hasta || undefined,
        soloAtrasos: filtros.soloAtrasos ? 'true' : undefined,
        soloInconsistencias: filtros.soloInconsistencias ? 'true' : undefined,
      });
      setDatos(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  useEffect(() => { cargar(); }, [cargar, refrescarSenal]);

  return (
    <div className="card">
      <h2>Resultados de asistencia</h2>
      <p className="card-desc">Cruce Talana / Cencosud, horas trabajadas y atrasos calculados.</p>

      <div className="filters-row">
        <div className="field">
          <label>RUT</label>
          <input
            type="text"
            placeholder="12345678-9"
            value={filtros.rut}
            onChange={e => setFiltros(f => ({ ...f, rut: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Desde</label>
          <input
            type="date"
            value={filtros.desde}
            onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))}
          />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input
            type="date"
            value={filtros.hasta}
            onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))}
          />
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={filtros.soloAtrasos}
            onChange={e => setFiltros(f => ({ ...f, soloAtrasos: e.target.checked }))}
          />
          Solo atrasos
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={filtros.soloInconsistencias}
            onChange={e => setFiltros(f => ({ ...f, soloInconsistencias: e.target.checked }))}
          />
          Solo inconsistencias
        </label>
        <button className="btn" type="button" onClick={cargar} disabled={cargando}>
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
              <th>Talana</th>
              <th>Cencosud</th>
              <th>Cruce</th>
              <th>Entrada real</th>
              <th>Entrada esperada</th>
              <th>Atraso (min)</th>
              <th>Salida real</th>
              <th>Horas trabajadas</th>
            </tr>
          </thead>
          <tbody>
            {datos.map(r => (
              <tr key={r.id}>
                <td>{r.rut}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{r.nombre || '—'}</td>
                <td>{r.fecha}</td>
                <td>{r.marco_talana ? <span className="badge badge-ok">Sí</span> : <span className="badge badge-muted">No</span>}</td>
                <td>{r.marco_cencosud ? <span className="badge badge-ok">Sí</span> : <span className="badge badge-muted">No</span>}</td>
                <td><BadgeInconsistencia valor={r.inconsistencia} /></td>
                <td>{r.hora_entrada_real || '—'}</td>
                <td>{r.hora_entrada_esperada || '—'}</td>
                <td className={`atraso-cell ${claseAtraso(r.minutos_atraso)}`}>
                  {r.minutos_atraso ?? '—'}
                  {claseAtraso(r.minutos_atraso) === 'severo' && ' ⚠'}
                </td>
                <td>{r.hora_salida_real || '—'}</td>
                <td>{r.horas_trabajadas ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cargando && datos.length === 0 && (
          <div className="empty-state">No hay resultados para estos filtros.</div>
        )}
      </div>
    </div>
  );
}
