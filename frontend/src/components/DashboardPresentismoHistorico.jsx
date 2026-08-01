import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { obtenerPresentismoHistorico } from '../api';

const NOMBRES_MES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function mesActualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Dado un mes inicial 'YYYY-MM', devuelve ese mes y los 2 siguientes (trimestre).
function trimestreDesde(mesInicial) {
  const [anio, mes] = mesInicial.split('-').map(Number);
  const meses = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(anio, mes - 1 + i, 1);
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return meses;
}

function etiquetaMes(mesISO) {
  const [anio, mes] = mesISO.split('-').map(Number);
  return `${NOMBRES_MES[mes - 1].slice(0, 3)} ${anio}`;
}

const OPCIONES_JEFE_TURNO = [
  { value: 'T_RD', label: 'T_RD' },
  { value: 'T_BV', label: 'T_BV' },
  { value: 'T_WP', label: 'T_WP (Noche)' },
  { value: 'CG', label: 'Plano (CG)' },
];

export default function DashboardPresentismoHistorico({ cdGlobal }) {
  const [mesInicial, setMesInicial] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [jefesTurno, setJefesTurno] = useState([]);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const meses = trimestreDesde(mesInicial);

  function toggleJefeTurno(codigo) {
    setJefesTurno(prev => prev.includes(codigo) ? prev.filter(j => j !== codigo) : [...prev, codigo]);
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await obtenerPresentismoHistorico(meses, jefesTurno, cdGlobal || undefined);
      setDatos(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [mesInicial, jefesTurno, cdGlobal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>Presentismo histórico por cargo (trimestral)</h2>
      <p className="card-desc">
        Evolución mensual de Requerido vs. Presentes para cada cargo, en un trimestre — filtra por
        uno o más Jefes de Turno, o deja todos sin marcar para ver el día completo.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Trimestre a partir de</label>
          <input type="month" value={mesInicial} onChange={e => setMesInicial(e.target.value)} max={mesActualISO()} />
        </div>
        <div className="field">
          <label>Jefe(s) de Turno {jefesTurno.length === 0 && '(Todos)'}</label>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
            {OPCIONES_JEFE_TURNO.map(o => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.82rem', color: 'var(--text)', cursor: 'pointer' }}>
                <input type="checkbox" checked={jefesTurno.includes(o.value)} onChange={() => toggleJefeTurno(o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </div>
        <button className="btn" type="button" onClick={cargar} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 16 }}>
        Trimestre seleccionado: {meses.map(etiquetaMes).join(' · ')}
      </p>

      {error && <p className="status-msg error">{error}</p>}

      {datos && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 20 }}>
          {datos.cargos.map(cargo => {
            const serie = datos.resultado[cargo].map(p => ({ ...p, mesLabel: etiquetaMes(p.mes) }));
            return (
              <div key={cargo} style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                <h3 style={{ margin: '0 0 10px', fontSize: '0.85rem', fontFamily: 'var(--font-sans)' }}>{cargo}</h3>
                <div style={{ width: '100%', height: 220 }}>
                  <ResponsiveContainer>
                    <LineChart data={serie} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="mesLabel" stroke="var(--text-muted)" fontSize={11} />
                      <YAxis stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: 'var(--text)' }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="requerido" name="Requerido" stroke="var(--warn)" strokeWidth={2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="presentes" name="Presentes" stroke="var(--ok)" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
