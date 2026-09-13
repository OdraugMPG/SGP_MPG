import { useState, useEffect, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { obtenerResumenAsistenciaArea } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
function etiquetaMes(mesISO) {
  const mes = Number(mesISO.split('-')[1]);
  return NOMBRES_MES[mes - 1] || mesISO;
}

function TarjetaKpi({ titulo, valor, sufijo = '' }) {
  return (
    <div className="summary-tile">
      <div className="n">{valor ?? '—'}{valor !== null && valor !== undefined ? sufijo : ''}</div>
      <div className="l">{titulo}</div>
    </div>
  );
}

export default function ResumenAsistenciaArea({ cdGlobal }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await obtenerResumenAsistenciaArea(desde, hasta, cdGlobal || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cdGlobal]);

  useEffect(() => { cargar(); }, [cargar]);

  const serieMensual = (datos?.por_mes || []).map(m => ({ ...m, mesLabel: etiquetaMes(m.mes) }));
  const horasExtraPorArea = (datos?.por_area || [])
    .map(a => ({ area: a.area, horas_extra: a.horas_extra }))
    .sort((a, b) => b.horas_extra - a.horas_extra);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>Gestión de Asistencias y Jornada Laboral</h2>
      <p className="card-desc">
        Resumen por área — cumplimiento de horario, tardanzas, inasistencias, permisos y horas extra —
        con tendencia mensual. Pensado para compartir con gerencia de un vistazo.
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

      {datos && (
        <>
          <div className="summary-grid" style={{ marginBottom: 20 }}>
            <TarjetaKpi titulo="Trabajadores activos" valor={datos.kpis.trabajadores_activos} />
            <TarjetaKpi titulo="% Asistencia" valor={datos.kpis.pct_asistencia} sufijo="%" />
            <TarjetaKpi titulo="Inasistencias" valor={datos.kpis.inasistencias} />
            <TarjetaKpi titulo="Tardanzas" valor={datos.kpis.tardanzas} />
            <TarjetaKpi titulo="Permisos" valor={datos.kpis.permisos} />
            <TarjetaKpi titulo="Horas extra" valor={datos.kpis.horas_extra} />
          </div>

          <div className="table-scroll" style={{ marginBottom: 24 }}>
            <table>
              <thead>
                <tr>
                  <th>Área</th><th>Días Analizables</th><th>Asistencias</th><th>% Asistencia</th>
                  <th>Tardanzas</th><th>Inasistencias</th><th>Permisos</th><th>Horas Extra</th>
                </tr>
              </thead>
              <tbody>
                {datos.por_area.map(a => (
                  <tr key={a.area}>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{a.area}</td>
                    <td>{a.dias_analizables}</td>
                    <td>{a.asistencias}</td>
                    <td>
                      {a.pct_asistencia === null ? '—' : (
                        <span className={`badge ${a.pct_asistencia >= 95 ? 'badge-ok' : a.pct_asistencia >= 85 ? 'badge-warn' : 'badge-danger'}`}>
                          {a.pct_asistencia}%
                        </span>
                      )}
                    </td>
                    <td>{a.tardanzas}</td>
                    <td>{a.inasistencias}</td>
                    <td>{a.permisos}</td>
                    <td>{a.horas_extra}</td>
                  </tr>
                ))}
                {datos.por_area.length === 0 && (
                  <tr><td colSpan={8} className="empty-state">Sin trabajadores con área asignada en este período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: -14, marginBottom: 20 }}>
            "Días Analizables" excluye los días de descanso propios de cada turno y los feriados —
            no se le exige asistencia a nadie en su día libre. Permisos = licencias, permisos con/sin
            goce, día compensatorio, fallecimiento y vacaciones. Inasistencias = cualquier día sin
            presencia real, con o sin falta registrada.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>% Asistencia por mes</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={serieMensual} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="mesLabel" stroke="var(--text-muted)" fontSize={11} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: 'var(--text)' }} />
                    <Line type="monotone" dataKey="pct_asistencia" name="% Asistencia" stroke="var(--ok)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>Tardanzas por mes</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={serieMensual} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="mesLabel" stroke="var(--text-muted)" fontSize={11} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: 'var(--text)' }} />
                    <Bar dataKey="tardanzas" name="Tardanzas" fill="var(--warn)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>Horas Extra por Área</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={horasExtraPorArea} layout="vertical" margin={{ top: 5, right: 25, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis type="number" stroke="var(--text-muted)" fontSize={11} />
                    <YAxis type="category" dataKey="area" stroke="var(--text-muted)" fontSize={10} width={100} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: 'var(--text)' }} />
                    <Bar dataKey="horas_extra" name="Horas Extra" fill="var(--accent)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
              <h3 style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>Horas Extra por mes</h3>
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={serieMensual} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="mesLabel" stroke="var(--text-muted)" fontSize={11} />
                    <YAxis stroke="var(--text-muted)" fontSize={11} />
                    <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: 'var(--text)' }} />
                    <Line type="monotone" dataKey="horas_extra" name="Horas Extra" stroke="var(--danger)" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 16 }}>
            El costo en pesos de las horas extra todavía no se muestra acá — el sistema no tiene
            cargado ningún valor de sueldo/hora por cargo. Se puede agregar cuando se defina esa tabla.
          </p>
        </>
      )}
    </div>
  );
}
