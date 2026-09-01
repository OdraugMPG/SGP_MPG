import { useState, useEffect, useCallback } from 'react';
import { generarInformeIA, obtenerHistorialInformesIA, obtenerInformeIA } from '../api';
import { renderizarNarrativa } from '../utils/markdownLite';

function esUltimaSemanaDelMes() {
  const hoy = new Date();
  const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return hoy.getDate() >= ultimoDia - 6;
}

export default function AnalisisIA({ cdGlobal }) {
  const [mesesAtras, setMesesAtras] = useState(6);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState(null);
  const [informe, setInforme] = useState(null);
  const [historial, setHistorial] = useState([]);

  const cargarHistorial = useCallback(() => {
    obtenerHistorialInformesIA().then(setHistorial).catch(() => {});
  }, []);

  useEffect(() => { cargarHistorial(); }, [cargarHistorial]);

  async function generar() {
    setGenerando(true);
    setError(null);
    try {
      const resultado = await generarInformeIA(mesesAtras, cdGlobal || undefined);
      setInforme(resultado);
      cargarHistorial();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerando(false);
    }
  }

  async function verInformeAnterior(id) {
    if (!id) return;
    setError(null);
    try {
      setInforme(await obtenerInformeIA(id));
    } catch (err) {
      setError(err.message);
    }
  }

  const enUltimaSemana = esUltimaSemanaDelMes();

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Informe de Análisis con IA — Rotación y Ausentismo</h2>
      <p className="card-desc">
        Un agente de IA sintetiza la rotación de personal (altas/bajas por cargo y CD) y el ausentismo
        recurrente (última semana de cada mes) en un informe ejecutivo con hallazgos y recomendaciones.
        Se recomienda generarlo la última semana de cada mes, cuando ya se conoce el cierre del mes —
        pero puedes generarlo cuando quieras.
      </p>

      <p style={{ marginBottom: 14 }}>
        {enUltimaSemana
          ? <span className="badge badge-ok">Estás en la última semana del mes — buen momento para generarlo</span>
          : <span className="badge badge-muted">Fuera de la última semana del mes</span>}
      </p>

      <div className="filters-row" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Meses de historia a considerar</label>
          <select value={mesesAtras} onChange={e => setMesesAtras(Number(e.target.value))} className="file-input" style={{ width: 160 }}>
            <option value={3}>3 meses</option>
            <option value={6}>6 meses</option>
            <option value={12}>12 meses</option>
          </select>
        </div>
        <button className="btn" type="button" onClick={generar} disabled={generando}>
          {generando ? 'Generando informe…' : 'Generar informe con IA'}
        </button>
        {historial.length > 0 && (
          <div className="field">
            <label>Ver informe anterior</label>
            <select className="file-input" style={{ width: 240 }} value="" onChange={e => verInformeAnterior(e.target.value)}>
              <option value="">Seleccionar…</option>
              {historial.map(h => (
                <option key={h.id} value={h.id}>
                  {h.periodo} — {new Date(h.creado_en).toLocaleDateString('es-CL')} ({h.generado_por || '—'})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <p className="status-msg error">{error}</p>}

      {informe && (
        <div style={{ marginTop: 10, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4 }}>
            Período: {informe.periodo} · Generado: {new Date(informe.creado_en).toLocaleString('es-CL')}
          </p>
          <div style={{ fontFamily: 'var(--font-sans)' }}>
            {renderizarNarrativa(informe.narrativa)}
          </div>
        </div>
      )}
    </div>
  );
}
