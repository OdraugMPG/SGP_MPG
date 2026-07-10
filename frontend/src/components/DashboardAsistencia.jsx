import { useState, useEffect } from 'react';
import { obtenerDashboardAsistencia, listarAreas } from '../api';

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

function infoDia(fechaISO) {
  const d = new Date(fechaISO + 'T00:00:00');
  const diaSemana = d.getDay(); // 0=domingo, 6=sábado
  let clase = '';
  if (diaSemana === 6) clase = 'matriz-dia-sabado';
  if (diaSemana === 0) clase = 'matriz-dia-domingo';
  return { etiqueta: DIAS_SEMANA[diaSemana].toUpperCase(), clase };
}

function formatoDiaMes(fechaISO) {
  const [, mm, dd] = fechaISO.split('-');
  return `${dd}-${mm}`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function hace6DiasISO() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

const CLASE_POR_CATEGORIA = {
  ok: 'matriz-ok',
  inconsistencia: 'matriz-inconsistencia',
  ausente: 'matriz-ausente',
  ausencia: 'matriz-ausencia',
  futuro: 'matriz-futuro',
  diaLibre: 'matriz-diaLibre',
  diaLibreTrabajado: 'matriz-diaLibreTrabajado',
};

export default function DashboardAsistencia() {
  const [desde, setDesde] = useState(hace6DiasISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [area, setArea] = useState('');
  const [areas, setAreas] = useState([]);
  const [filtroNombre, setFiltroNombre] = useState('');

  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { listarAreas().then(setAreas).catch(() => {}); }, []);

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      setData(await obtenerDashboardAsistencia(desde, hasta, area || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { buscar(); }, []); // carga inicial con el rango por defecto

  const trabajadoresFiltrados = data
    ? data.trabajadores.filter(t => {
        if (!filtroNombre.trim()) return true;
        const q = filtroNombre.trim().toLowerCase();
        return t.nombre.toLowerCase().includes(q) || t.rut.toLowerCase().includes(q);
      })
    : [];

  return (
    <div className="card">
      <h2>Dashboard de asistencia</h2>
      <p className="card-desc">
        Vista tipo calendario: verde = presente en ambos sistemas, amarillo = marcó solo en uno
        (Talana o Cencosud), azul = ausencia/permiso asignado, rojo = sin ninguna marca ese día.
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
        <div className="field">
          <label>Área</label>
          <select
            value={area} onChange={e => setArea(e.target.value)}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: '0.82rem' }}
          >
            <option value="">Todas</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Buscar trabajador</label>
          <input type="text" placeholder="RUT o nombre..." value={filtroNombre} onChange={e => setFiltroNombre(e.target.value)} />
        </div>
        <button className="btn" type="button" onClick={buscar} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap', fontSize: '0.78rem' }}>
        <span className="badge matriz-ok" style={{ padding: '3px 10px' }}>P — Presente (ambos sistemas)</span>
        <span className="badge matriz-inconsistencia" style={{ padding: '3px 10px' }}>SM_CTRL / SM_TLN — Falta marca en un sistema</span>
        <span className="badge matriz-ausencia" style={{ padding: '3px 10px' }}>Ausencia / permiso asignado</span>
        <span className="badge matriz-diaLibre" style={{ padding: '3px 10px' }}>DL — Día Libre</span>
        <span className="badge matriz-diaLibreTrabajado" style={{ padding: '3px 10px' }}>DLT — Día Libre Trabajado</span>
        <span className="badge matriz-ausente" style={{ padding: '3px 10px' }}>A — Sin ninguna marca</span>
      </div>

      {error && <p className="status-msg error">{error}</p>}

      {data && (
        <div className="matriz-scroll">
          <table className="matriz-table">
            <thead>
              <tr>
                <th className="col-fija col-rut">RUT</th>
                <th className="col-fija col-nombre">Nombre</th>
                <th className="col-fija col-area">Área</th>
                {data.fechas.map(f => {
                  const { etiqueta, clase } = infoDia(f);
                  return (
                    <th key={f}>
                      <div className={`matriz-dia-semana ${clase}`}>{etiqueta}</div>
                      <div>{formatoDiaMes(f)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {trabajadoresFiltrados.map(t => (
                <tr key={t.rut}>
                  <td className="col-fija col-rut">{t.rut}</td>
                  <td className="col-fija col-nombre">{t.nombre}</td>
                  <td className="col-fija col-area">{t.area || '—'}</td>
                  {data.fechas.map(f => {
                    const e = t.estados[f];
                    return (
                      <td key={f} className={`matriz-celda ${CLASE_POR_CATEGORIA[e?.categoria] || ''}`}>
                        {e?.codigo || ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {trabajadoresFiltrados.length === 0 && (
            <div className="empty-state">No hay trabajadores para estos filtros.</div>
          )}
        </div>
      )}
    </div>
  );
}
