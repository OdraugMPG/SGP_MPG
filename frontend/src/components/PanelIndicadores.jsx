import { useState, useEffect, useCallback } from 'react';
import { obtenerIndicadores, urlDescargaReporteDesvinculacion } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

const ETIQUETA_TIPO = {
  P: 'Presente', F_Ju: 'Falta Justificada', F_In: 'Falta Injustificada',
  PSGS: 'Permiso S/Goce', PCGS: 'Permiso C/Goce', DC: 'Día Compensatorio',
  V: 'Vacaciones', R: 'Renuncia', Dv: 'Desvinculado', A: 'Ausente', LM: 'Licencia Médica',
  PF: 'Permiso por Fallecimiento',
};

function TarjetaKpi({ titulo, valor, sufijo = '', color }) {
  return (
    <div className="summary-tile">
      <div className="n" style={color ? { color } : undefined}>{valor ?? '—'}{valor !== null && valor !== undefined ? sufijo : ''}</div>
      <div className="l">{titulo}</div>
    </div>
  );
}

export default function PanelIndicadores({ cd }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await obtenerIndicadores(desde, hasta, undefined, cd || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cd]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Indicadores del período</h2>
      <p className="card-desc">Cumplimiento de dotación, presentismo, ausentismo, permisos y recurrencia.</p>

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
          <div className="summary-grid">
            <TarjetaKpi titulo="Dotación requerida" valor={datos.dotacion_requerida} />
            <TarjetaKpi titulo="Cumplimiento dotación" valor={datos.cumplimiento_dotacion_pct} sufijo="%"
              color={datos.cumplimiento_dotacion_pct !== null && datos.cumplimiento_dotacion_pct < 90 ? 'var(--danger)' : 'var(--ok)'} />
            <TarjetaKpi titulo="Ausentismo (incumplimiento)" valor={datos.ausentismo_pct} sufijo="%" color="var(--warn)" />
            <TarjetaKpi titulo="Salidas anticipadas" valor={datos.salidas_anticipadas} />
            <TarjetaKpi titulo="Licencias médicas" valor={datos.permisos_por_tipo.LM || 0} />
            <TarjetaKpi titulo="Permisos (todos)" valor={
              (datos.permisos_por_tipo.PSGS || 0) + (datos.permisos_por_tipo.PCGS || 0) + (datos.permisos_por_tipo.DC || 0)
            } />
          </div>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 6, marginBottom: 0 }}>
            Dotación requerida es el total acumulado del período (persona-días), no un promedio diario.
            Ausentismo = 100% − Cumplimiento (la brecha entre lo requerido y lo presente). Solo se cuentan
            los cargos con requerimiento de dotación registrado.
          </p>

          {/* Cumplimiento de dotación por cargo */}
          <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: '0.9rem' }}>Cumplimiento de dotación por cargo</h3>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 8 }}>
            Requerido y Presentes son totales del período (persona-días acumulados), específicos de cada CD.
          </p>
          <div className="table-scroll" style={{ maxHeight: '30vh' }}>
            <table>
              <thead><tr><th>Cargo</th><th>CD</th><th>Requerido (total)</th><th>Presentes (total)</th><th>Promedio/día</th><th>Cumplimiento</th></tr></thead>
              <tbody>
                {datos.cumplimiento_dotacion.detalle.map(d => (
                  <tr key={`${d.cargo}|${d.cd}`}>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{d.cargo}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{d.cd}</td>
                    <td>{d.requerido}</td>
                    <td>{d.presentes}</td>
                    <td>{d.promedio_presente}</td>
                    <td>
                      {d.cumplimiento_pct === null ? '—' : (
                        <span className={`badge ${d.cumplimiento_pct >= 90 ? 'badge-ok' : d.cumplimiento_pct >= 75 ? 'badge-warn' : 'badge-danger'}`}>
                          {d.cumplimiento_pct}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {datos.cumplimiento_dotacion.detalle.length === 0 && (
                  <tr><td colSpan={6} className="empty-state">Aún no hay requerimiento de dotación registrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {datos.cumplimiento_dotacion.detalle.length > 0 && (
            <p style={{ fontSize: '0.8rem', marginTop: 8 }}>
              Cargo con más ausentismo: <strong style={{ fontFamily: 'var(--font-sans)' }}>{datos.cumplimiento_dotacion.detalle[0].cargo}</strong>{' '}
              <span className="badge badge-danger">
                {datos.cumplimiento_dotacion.detalle[0].cumplimiento_pct === null ? '—' : `${Math.round((100 - datos.cumplimiento_dotacion.detalle[0].cumplimiento_pct) * 10) / 10}% ausentismo`}
              </span>
            </p>
          )}

          {/* Ausentismo por día de la semana */}
          <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: '0.9rem' }}>Ausentismo por día de la semana</h3>
          <div className="table-scroll" style={{ maxHeight: '30vh' }}>
            <table>
              <thead><tr><th>Día</th><th>Requerido (total)</th><th>Presentes (total)</th><th>Ausentismo</th></tr></thead>
              <tbody>
                {(datos.ausentismo_por_dia_semana || []).map((d, i) => (
                  <tr key={d.dia} style={i === 0 ? { background: 'rgba(214,84,79,0.08)' } : undefined}>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>
                      {d.dia}{i === 0 && <span className="badge badge-danger" style={{ marginLeft: 8 }}>Peor día</span>}
                    </td>
                    <td>{d.requerido}</td>
                    <td>{d.presentes}</td>
                    <td>{d.ausentismo_pct}%</td>
                  </tr>
                ))}
                {(!datos.ausentismo_por_dia_semana || datos.ausentismo_por_dia_semana.length === 0) && (
                  <tr><td colSpan={4} className="empty-state">Sin datos suficientes en el período.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Brecha de recursos: contratados vs requerido actual */}
          <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: '0.9rem' }}>Recursos necesarios para cubrir la dotación</h3>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 8 }}>
            Requerido vigente hoy vs. trabajadores activos contratados, por cargo y CD — cuántos faltan por contratar (o sobran).
          </p>
          <div className="table-scroll" style={{ maxHeight: '30vh' }}>
            <table>
              <thead><tr><th>Cargo</th><th>CD</th><th>Requerido (actual)</th><th>Contratados</th><th>Brecha</th></tr></thead>
              <tbody>
                {(datos.brecha_recursos || []).map(d => (
                  <tr key={`${d.cargo}|${d.cd}`}>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{d.cargo}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{d.cd}</td>
                    <td>{d.requerido_actual}</td>
                    <td>{d.contratados}</td>
                    <td>
                      {d.brecha > 0 ? (
                        <span className="badge badge-danger">Faltan {d.brecha}</span>
                      ) : d.brecha < 0 ? (
                        <span className="badge badge-muted">Sobran {Math.abs(d.brecha)}</span>
                      ) : (
                        <span className="badge badge-ok">Completo</span>
                      )}
                    </td>
                  </tr>
                ))}
                {(!datos.brecha_recursos || datos.brecha_recursos.length === 0) && (
                  <tr><td colSpan={5} className="empty-state">Sin datos de requerimiento o dotación configurados.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Salidas anticipadas por turno */}
          <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: '0.9rem' }}>Salidas anticipadas por turno</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {Object.entries(datos.salidas_anticipadas_por_turno || {}).map(([turno, n]) => (
              <span key={turno} className="badge badge-warn" style={{ padding: '5px 10px' }}>
                {turno}: <strong>{n}</strong>
              </span>
            ))}
            {Object.keys(datos.salidas_anticipadas_por_turno || {}).length === 0 && (
              <span className="status-msg">Sin salidas anticipadas en el período.</span>
            )}
          </div>

          {/* Ausentismo por tipo (curado, excluye R y Dv) */}
          <h3 style={{ marginTop: 24, marginBottom: 4, fontSize: '0.9rem' }}>Ausentismo por tipo</h3>
          <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 0, marginBottom: 8 }}>
            Solo causales de ausentismo real (Licencia Médica, Permiso por Fallecimiento, Falta
            Justificada/Injustificada, Permisos, Día Compensatorio). Renuncia y Desvinculado quedan
            fuera porque no son ausentismo — son fin de la relación laboral.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {Object.entries(datos.ausentismo_por_tipo || {}).map(([tipo, n]) => (
              <span key={tipo} className="badge badge-muted" style={{ padding: '5px 10px' }}>
                {ETIQUETA_TIPO[tipo] || tipo}: <strong>{n}</strong>
              </span>
            ))}
          </div>

          {/* Recurrencia */}
          <h3 style={{ marginTop: 24, marginBottom: 8, fontSize: '0.9rem' }}>Trabajadores con más recurrencia (≥2 eventos)</h3>
          <div className="table-scroll" style={{ maxHeight: '30vh' }}>
            <table>
              <thead><tr><th>RUT</th><th>Nombre</th><th>Faltas injust.</th><th>Ausencias sin marca</th><th>Licencias</th><th>Permisos</th><th>Total</th></tr></thead>
              <tbody>
                {datos.recurrencia.map(r => (
                  <tr key={r.rut}>
                    <td>{r.rut}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{r.nombre}</td>
                    <td>{r.F_In}</td>
                    <td>{r.A}</td>
                    <td>{r.LM}</td>
                    <td>{r.permisos}</td>
                    <td><strong>{r.total}</strong></td>
                  </tr>
                ))}
                {datos.recurrencia.length === 0 && (
                  <tr><td colSpan={7} className="empty-state">Sin casos de recurrencia en el período.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Alertas de causal legal */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 24 }}>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--danger)' }}>
              ⚠ Posible causal de desvinculación por inasistencia
            </h3>
            {datos.alertas_desvinculacion.trabajadores.length > 0 && (
              <a
                href={urlDescargaReporteDesvinculacion(desde, hasta)}
                className="btn"
                style={{ textDecoration: 'none', padding: '6px 12px', fontSize: '0.78rem', background: 'var(--surface-2)', color: 'var(--text)', border: '1px solid var(--border)' }}
              >
                Descargar reporte para gerencia
              </a>
            )}
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 4, marginTop: 4 }}>
            <strong>{datos.alertas_desvinculacion.articulo.articulo}:</strong> "{datos.alertas_desvinculacion.articulo.texto}"
          </p>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 12, fontStyle: 'italic' }}>
            {datos.alertas_desvinculacion.articulo.nota}
          </p>
          <div className="table-scroll" style={{ maxHeight: '30vh' }}>
            <table>
              <thead><tr><th>RUT</th><th>Nombre</th><th>Cargo</th><th>Mes</th><th>Regla configurada</th><th>Días</th></tr></thead>
              <tbody>
                {datos.alertas_desvinculacion.trabajadores.flatMap(t =>
                  t.alertas.map((a, i) => (
                    <tr key={`${t.rut}-${i}`}>
                      <td>{t.rut}</td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{t.nombre}</td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{t.cargo}</td>
                      <td>{a.mes}</td>
                      <td><span className="badge badge-danger">{a.regla}</span></td>
                      <td>{a.dias.join(', ')}</td>
                    </tr>
                  ))
                )}
                {datos.alertas_desvinculacion.trabajadores.length === 0 && (
                  <tr><td colSpan={6} className="empty-state">Sin casos detectados en el período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
