import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { obtenerAusentismoPorTipoDiario } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatoDiaMes(fechaISO) {
  const [, mm, dd] = fechaISO.split('-');
  return `${dd}-${mm}`;
}

const ETIQUETA_TIPO = {
  LM: 'Licencia Médica', F_Ju: 'Falta Justificada', F_In: 'Falta Injustificada',
  PSGS: 'Permiso S/Goce', PCGS: 'Permiso C/Goce', DC: 'Día Compensatorio', PF: 'Permiso Fallecimiento',
};

// Colores fijos por tipo (paleta acotada a los tokens ya definidos en
// index.css, para no introducir colores nuevos sueltos en el gráfico).
const COLOR_TIPO = {
  LM: 'var(--accent)', F_In: 'var(--danger)', F_Ju: 'var(--warn)',
  PSGS: 'var(--ok)', PCGS: '#8b6fd6', DC: '#4fa8c9', PF: 'var(--text-muted)',
};

export default function AusentismoPorTipoDiario({ cdGlobal }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await obtenerAusentismoPorTipoDiario(desde, hasta, cdGlobal || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cdGlobal]);

  useEffect(() => { cargar(); }, [cargar]);

  const datosGrafico = (datos?.serie || []).map(d => ({
    fechaLabel: formatoDiaMes(d.fecha),
    ...Object.fromEntries((datos?.tipos || []).map(t => [t, d.por_tipo[t].cantidad])),
  }));

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>Ausentismo diario por tipo</h2>
      <p className="card-desc">
        Cantidad de LM, Falta Injustificada, Permisos, etc. por día, y qué porcentaje representan sobre
        la dotación requerida ese día (mismo "requerido" que el gráfico de Cumplimiento de Dotación).
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
        <button className="btn" type="button" onClick={cargar} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {error && <p className="status-msg error">{error}</p>}

      {datosGrafico.length > 0 && (
        <div style={{ width: '100%', height: 300, marginTop: 10 }}>
          <ResponsiveContainer>
            <BarChart data={datosGrafico} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="fechaLabel" stroke="var(--text-muted)" fontSize={11} />
              <YAxis stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text)' }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(datos?.tipos || []).map(t => (
                <Bar key={t} dataKey={t} name={ETIQUETA_TIPO[t] || t} stackId="ausentismo" fill={COLOR_TIPO[t]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {datos && (
        <div className="table-scroll" style={{ marginTop: 16, maxHeight: '40vh' }}>
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Requerido</th>
                {datos.tipos.map(t => <th key={t}>{ETIQUETA_TIPO[t] || t}</th>)}
                <th>Total ausentismo</th>
              </tr>
            </thead>
            <tbody>
              {datos.serie.map(d => (
                <tr key={d.fecha}>
                  <td>{d.fecha}</td>
                  <td>{d.requerido}</td>
                  {datos.tipos.map(t => {
                    const { cantidad, pct } = d.por_tipo[t];
                    return (
                      <td key={t}>
                        {cantidad > 0 ? <>{cantidad} <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>({pct ?? '—'}%)</span></> : '—'}
                      </td>
                    );
                  })}
                  <td>
                    <strong>{d.total}</strong>{' '}
                    <span className={`badge ${d.total_pct === null ? 'badge-muted' : d.total_pct >= 15 ? 'badge-danger' : d.total_pct >= 8 ? 'badge-warn' : 'badge-ok'}`}>
                      {d.total_pct === null ? '—' : `${d.total_pct}%`}
                    </span>
                  </td>
                </tr>
              ))}
              {datos.serie.length === 0 && (
                <tr><td colSpan={datos.tipos.length + 3} className="empty-state">Sin datos en el período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
