import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { obtenerSerieCumplimiento, listarCargosDashboard } from '../api';

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

const OPCIONES_JEFE_TURNO = [
  { value: 'T_RD', label: 'T_RD' },
  { value: 'T_BV', label: 'T_BV' },
  { value: 'T_WP', label: 'T_WP (Noche)' },
  { value: 'CG', label: 'Plano (CG)' },
];

// Vista única de cumplimiento (Requerido vs Presentes) por día, en barras.
// Sin filtros muestra el consolidado de TODOS los cargos y jefes de turno;
// con filtros, muestra el detalle específico. El filtro de Jefe de Turno
// admite selección múltiple (checkboxes).
export default function GraficoCumplimientoCargo({ desde: desdeProp, hasta: hastaProp, titulo, cdGlobal }) {
  const fechasControladas = Boolean(desdeProp && hastaProp);

  const [desdePropio, setDesdePropio] = useState(primerDiaMesISO());
  const [hastaPropio, setHastaPropio] = useState(hoyISO());
  const desde = fechasControladas ? desdeProp : desdePropio;
  const hasta = fechasControladas ? hastaProp : hastaPropio;

  const [cargos, setCargos] = useState([]);
  const [cargo, setCargo] = useState('');
  const [jefesTurno, setJefesTurno] = useState([]);
  const [serie, setSerie] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { listarCargosDashboard().then(setCargos).catch(() => {}); }, []);

  function toggleJefeTurno(codigo) {
    setJefesTurno(prev => prev.includes(codigo) ? prev.filter(j => j !== codigo) : [...prev, codigo]);
  }

  const cargar = useCallback(async () => {
    if (!desde || !hasta) return;
    setCargando(true);
    setError(null);
    try {
      const datos = await obtenerSerieCumplimiento(desde, hasta, cargo || undefined, jefesTurno, cdGlobal || undefined);
      setSerie(datos.serie);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [cargo, jefesTurno, desde, hasta, cdGlobal]);

  useEffect(() => { cargar(); }, [cargar]);

  const datosGrafico = (serie || []).map(p => ({ ...p, fechaLabel: formatoDiaMes(p.fecha) }));

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>{titulo || 'Cumplimiento de dotación (consolidado)'}</h2>
      <p className="card-desc">
        Requerido vs. presentes reales por día. Sin filtros muestra el consolidado de todos los
        cargos y jefes de turno — filtra por cargo y/o por uno o más jefes de turno para ver el
        detalle específico.
      </p>

      <div className="filters-row">
        {!fechasControladas && (
          <>
            <div className="field">
              <label>Desde</label>
              <input type="date" value={desdePropio} onChange={e => setDesdePropio(e.target.value)} />
            </div>
            <div className="field">
              <label>Hasta</label>
              <input type="date" value={hastaPropio} onChange={e => setHastaPropio(e.target.value)} />
            </div>
          </>
        )}
        <div className="field">
          <label>Cargo</label>
          <select
            value={cargo} onChange={e => setCargo(e.target.value)}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: '0.82rem', minWidth: 200 }}
          >
            <option value="">Todos</option>
            {cargos.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
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
      </div>

      {error && <p className="status-msg error">{error}</p>}

      {datosGrafico.length > 0 && (
        <div style={{ width: '100%', height: 340, marginTop: 10 }}>
          <ResponsiveContainer>
            <BarChart data={datosGrafico} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="fechaLabel" stroke="var(--text-muted)" fontSize={11} />
              <YAxis stroke="var(--text-muted)" fontSize={11} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'var(--text)' }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="requerido" name="Requerido" fill="var(--warn)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="presentes" name="Presentes" fill="var(--ok)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {!cargando && datosGrafico.length === 0 && (
        <div className="empty-state">Sin datos para estos filtros en el período.</div>
      )}
    </div>
  );
}
