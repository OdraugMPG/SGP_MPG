import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { obtenerAusentismoRecurrente } from '../api';

export default function AnalisisAusentismo({ cdGlobal }) {
  const [mesesAtras, setMesesAtras] = useState(6);
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [rutExpandido, setRutExpandido] = useState(null);
  const [cargoFiltro, setCargoFiltro] = useState('');
  const seccionReincidentesRef = useRef(null);

  function verReincidentesDeCargo(cargo) {
    setCargoFiltro(cargo);
    seccionReincidentesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await obtenerAusentismoRecurrente(mesesAtras, cdGlobal || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [mesesAtras, cdGlobal]);

  useEffect(() => { cargar(); }, [cargar]);

  const listaFiltrada = datos
    ? (cargoFiltro ? datos.trabajadores_recurrentes.filter(t => `${t.cargo}|${t.cd}` === cargoFiltro) : datos.trabajadores_recurrentes)
    : [];

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Análisis de Ausentismo Recurrente</h2>
        <p className="card-desc">
          Analiza Falta Justificada e Injustificada (F_Ju / F_In) ocurridas en la <strong>última
          semana de cada mes</strong> (últimos 7 días calendario) — no considera Licencia Médica,
          ya que no corresponde a un problema disciplinario. Un trabajador se marca como{' '}
          <strong>reincidente</strong> cuando registra falta en la última semana de 2 o más meses
          distintos dentro del período analizado.
        </p>

        <div className="filters-row">
          <div className="field">
            <label>Meses hacia atrás a analizar</label>
            <select value={mesesAtras} onChange={e => setMesesAtras(Number(e.target.value))} className="file-input" style={{ width: 140 }}>
              <option value={3}>3 meses</option>
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
            </select>
          </div>
          <button className="btn" type="button" onClick={cargar} disabled={cargando}>
            {cargando ? 'Calculando…' : 'Actualizar'}
          </button>
        </div>

        {cdGlobal && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>
            Filtrado por CD: <strong>{cdGlobal}</strong>
          </p>
        )}

        {error && <p className="status-msg error">{error}</p>}

        {datos && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 10 }}>
            Períodos analizados: {datos.meses_analizados.map(m => `${m.desde} a ${m.hasta}`).join(' · ')}
          </p>
        )}
      </div>

      {datos && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Resumen por Cargo y CD</h2>
            <p className="card-desc">Incluye todos los cargos con dotación activa, aunque no tengan ausentismo.</p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Cargo</th>
                    <th>CD</th>
                    <th>Dotación activa</th>
                    <th>Total faltas (última semana)</th>
                    <th>Trabajadores con falta</th>
                    <th>Trabajadores reincidentes</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.resumen_por_cargo.map(r => (
                    <tr key={`${r.cargo}|${r.cd}`}>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{r.cargo}</td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{r.cd}</td>
                      <td>{r.dotacion_activa}</td>
                      <td>{r.total_faltas || '—'}</td>
                      <td>{r.trabajadores_con_falta || '—'}</td>
                      <td>
                        {r.trabajadores_recurrentes > 0
                          ? (
                            <button
                              type="button" onClick={() => verReincidentesDeCargo(`${r.cargo}|${r.cd}`)}
                              className="badge badge-warn"
                              style={{ border: 'none', cursor: 'pointer' }}
                              title={`Ver los ${r.trabajadores_recurrentes} trabajadores reincidentes de ${r.cargo} (${r.cd})`}
                            >
                              {r.trabajadores_recurrentes}
                            </button>
                          )
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {datos.resumen_por_cargo.length === 0 && (
                    <tr><td colSpan={6} className="empty-state">Sin datos para este filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" ref={seccionReincidentesRef}>
            <h2>Trabajadores Reincidentes</h2>
            <p className="card-desc">
              {datos.trabajadores_recurrentes.length} trabajador(es) con falta en la última semana de 2 o más meses distintos.
            </p>

            <div className="filters-row">
              <div className="field">
                <label>Filtrar por cargo</label>
                <select value={cargoFiltro} onChange={e => setCargoFiltro(e.target.value)} className="file-input">
                  <option value="">Todos</option>
                  {datos.resumen_por_cargo.filter(r => r.trabajadores_recurrentes > 0).map(r => (
                    <option key={`${r.cargo}|${r.cd}`} value={`${r.cargo}|${r.cd}`}>{r.cargo} — {r.cd}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>RUT</th>
                    <th>Nombre</th>
                    <th>Cargo</th>
                    <th>CD</th>
                    <th>Meses con falta</th>
                    <th>Total faltas</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {listaFiltrada.map(t => (
                    <Fragment key={t.rut}>
                      <tr>
                        <td>{t.rut}</td>
                        <td style={{ fontFamily: 'var(--font-sans)' }}>{t.nombre}</td>
                        <td style={{ fontFamily: 'var(--font-sans)' }}>{t.cargo}</td>
                        <td style={{ fontFamily: 'var(--font-sans)' }}>{t.cd}</td>
                        <td><span className="badge badge-warn">{t.meses_con_falta}</span></td>
                        <td>{t.total_faltas}</td>
                        <td>
                          <button
                            type="button" onClick={() => setRutExpandido(v => v === t.rut ? null : t.rut)}
                            style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}
                          >
                            {rutExpandido === t.rut ? 'Ocultar' : 'Ver detalle'}
                          </button>
                        </td>
                      </tr>
                      {rutExpandido === t.rut && (
                        <tr>
                          <td colSpan={7} style={{ background: 'var(--surface-2)', padding: 14 }}>
                            <table style={{ width: 'auto', minWidth: 260 }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', padding: '2px 16px 4px 0' }}>Fecha</th>
                                  <th style={{ textAlign: 'left', padding: '2px 0 4px' }}>Tipo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.detalle.map(d => (
                                  <tr key={d.fecha}>
                                    <td style={{ padding: '2px 16px 2px 0', fontFamily: 'var(--font-sans)' }}>{d.fecha}</td>
                                    <td style={{ padding: '2px 0', fontFamily: 'var(--font-sans)' }}>
                                      {d.tipo === 'F_In' ? 'Falta Injustificada' : 'Falta Justificada'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {listaFiltrada.length === 0 && (
                    <tr><td colSpan={7} className="empty-state">Sin trabajadores reincidentes para este filtro.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}