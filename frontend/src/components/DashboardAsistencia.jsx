import { useState, useEffect } from 'react';
import { obtenerDashboardAsistencia, listarAreas, urlDescargaDashboardAsistencia } from '../api';
import PanelIndicadores from './PanelIndicadores';
import ResumenAsistenciaArea from './ResumenAsistenciaArea';
import GraficoCumplimientoCargo from './GraficoCumplimientoCargo';
import AusentismoPorTipoDiario from './AusentismoPorTipoDiario';
import DashboardPresentismoHistorico from './DashboardPresentismoHistorico';
import AnalisisAusentismo from './AnalisisAusentismo';
import AnalisisMarcasAbiertas from './AnalisisMarcasAbiertas';
import AnalisisIA from './AnalisisIA';

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

// Causales filtrables (mismos códigos que ausencias_permisos.tipo, sin 'P'
// que no es una causal sino la marca de presente). El código es lo que
// realmente aparece en cada celda de la matriz — el filtro compara contra
// eso, no contra la categoría visual.
const CAUSALES_FILTRABLES = [
  { codigo: 'F_In', etiqueta: 'Falta Injustificada' },
  { codigo: 'F_Ju', etiqueta: 'Falta Justificada' },
  { codigo: 'LM', etiqueta: 'Licencia Médica' },
  { codigo: 'PSGS', etiqueta: 'Permiso S/Goce' },
  { codigo: 'PCGS', etiqueta: 'Permiso C/Goce' },
  { codigo: 'DC', etiqueta: 'Día Compensatorio' },
  { codigo: 'PF', etiqueta: 'Permiso Fallecimiento' },
  { codigo: 'V', etiqueta: 'Vacaciones' },
  { codigo: 'A', etiqueta: 'Ausente / sin marca' },
  { codigo: 'R', etiqueta: 'Renuncia (asignada como ausencia)' },
  { codigo: 'Dv', etiqueta: 'Desvinculado (asignado como ausencia)' },
];

const CLASE_POR_CATEGORIA = {
  ok: 'matriz-ok',
  inconsistencia: 'matriz-inconsistencia',
  ausente: 'matriz-ausente',
  ausencia: 'matriz-ausencia',
  futuro: 'matriz-futuro',
  diaLibre: 'matriz-diaLibre',
  diaLibreTrabajado: 'matriz-diaLibreTrabajado',
  termino: 'matriz-termino',
};

export default function DashboardAsistencia({ cdGlobal }) {
  const [desde, setDesde] = useState(hace6DiasISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [area, setArea] = useState('');
  const [areas, setAreas] = useState([]);
  const [filtroNombre, setFiltroNombre] = useState('');
  const [causalesFiltro, setCausalesFiltro] = useState([]);

  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { listarAreas().then(setAreas).catch(() => {}); }, []);

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      setData(await obtenerDashboardAsistencia(desde, hasta, area || undefined, cdGlobal || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  // Si cambia el CD elegido en el header, vuelve a buscar automáticamente.
  useEffect(() => { buscar(); }, [cdGlobal]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { buscar(); }, []); // carga inicial con el rango por defecto

  function toggleCausal(codigo) {
    setCausalesFiltro(prev => prev.includes(codigo) ? prev.filter(c => c !== codigo) : [...prev, codigo]);
  }

  const trabajadoresFiltrados = data
    ? data.trabajadores.filter(t => {
        if (filtroNombre.trim()) {
          const q = filtroNombre.trim().toLowerCase();
          if (!(t.nombre.toLowerCase().includes(q) || t.rut.toLowerCase().includes(q))) return false;
        }
        if (causalesFiltro.length > 0) {
          const tieneCausalEnRango = data.fechas.some(f => causalesFiltro.includes(t.estados[f]?.codigo));
          if (!tieneCausalEnRango) return false;
        }
        return true;
      })
    : [];

  return (
    <>
      <ResumenAsistenciaArea cdGlobal={cdGlobal} />
      <PanelIndicadores cd={cdGlobal} />
      <GraficoCumplimientoCargo cdGlobal={cdGlobal} />
      <AusentismoPorTipoDiario cdGlobal={cdGlobal} />
      <DashboardPresentismoHistorico cdGlobal={cdGlobal} />
      <AnalisisIA cdGlobal={cdGlobal} />
      <AnalisisAusentismo cdGlobal={cdGlobal} />
      <AnalisisMarcasAbiertas cdGlobal={cdGlobal} />
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
        <a
          className="btn" style={{ textDecoration: 'none', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}
          href={urlDescargaDashboardAsistencia(desde, hasta, area, cdGlobal)}
        >
          Descargar Excel
        </a>
      </div>

      <div style={{ display: 'flex', gap: 14, marginBottom: 16, flexWrap: 'wrap', fontSize: '0.78rem' }}>
        <span className="badge matriz-ok" style={{ padding: '3px 10px' }}>P — Presente (ambos sistemas)</span>
        <span className="badge matriz-inconsistencia" style={{ padding: '3px 10px' }}>SM_CTRL / SM_TLN — Falta marca en un sistema</span>
        <span className="badge matriz-ausencia" style={{ padding: '3px 10px' }}>Ausencia / permiso asignado</span>
        <span className="badge matriz-diaLibre" style={{ padding: '3px 10px' }}>DL — Día Libre</span>
        <span className="badge matriz-diaLibreTrabajado" style={{ padding: '3px 10px' }}>DLT — Día Libre Trabajado</span>
        <span className="badge matriz-diaLibre" style={{ padding: '3px 10px' }}>DFNL — Día Feriado No Laborado</span>
        <span className="badge matriz-diaLibreTrabajado" style={{ padding: '3px 10px' }}>DFT — Día Feriado Trabajado</span>
        <span className="badge matriz-ausente" style={{ padding: '3px 10px' }}>A — Sin ninguna marca</span>
        <span className="badge matriz-termino" style={{ padding: '3px 10px' }}>SC — Sin Contrato (antes del ingreso/reingreso)</span>
        <span className="badge matriz-termino" style={{ padding: '3px 10px' }}>Rnv — Renuncia Voluntaria</span>
        <span className="badge matriz-termino" style={{ padding: '3px 10px' }}>Dsv — Desvinculado (Art. 161)</span>
        <span className="badge matriz-termino" style={{ padding: '3px 10px' }}>D160 — Desvinculado (Art. 160 N°3)</span>
        <span className="badge matriz-termino" style={{ padding: '3px 10px' }}>CcTo — Culminación de Contrato</span>
      </div>

      <div className="field" style={{ marginBottom: 16 }}>
        <label>
          Filtrar por causal {causalesFiltro.length > 0 && (
            <button
              type="button" onClick={() => setCausalesFiltro([])}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem', padding: 0, marginLeft: 6 }}
            >
              (limpiar)
            </button>
          )}
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {CAUSALES_FILTRABLES.map(({ codigo, etiqueta }) => {
            const activo = causalesFiltro.includes(codigo);
            return (
              <button
                key={codigo}
                type="button"
                onClick={() => toggleCausal(codigo)}
                className="badge matriz-ausencia"
                style={{
                  padding: '3px 10px', fontSize: '0.78rem', cursor: 'pointer',
                  border: activo ? '1px solid var(--accent)' : '1px solid transparent',
                  opacity: causalesFiltro.length > 0 && !activo ? 0.45 : 1,
                }}
              >
                {codigo} — {etiqueta}
              </button>
            );
          })}
        </div>
        {causalesFiltro.length > 0 && (
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            Mostrando solo trabajadores con {causalesFiltro.join(', ')} en el rango de fechas visible.
          </p>
        )}
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
                <th className="col-fija col-jefeturno">Jefe Turno</th>
                <th className="col-fija col-turno">Turno</th>
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
                  <td className="col-fija col-jefeturno">{t.jefe_turno || '—'}</td>
                  <td className="col-fija col-turno">{t.turno || '—'}</td>
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
    </>
  );
}