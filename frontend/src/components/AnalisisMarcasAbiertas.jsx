import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { obtenerMarcasAbiertas, urlDescargaMarcasAbiertas } from '../api';

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AnalisisMarcasAbiertas({ cdGlobal }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [rutExpandido, setRutExpandido] = useState(null);
  const [jefeTurnoFiltro, setJefeTurnoFiltro] = useState('');
  const seccionReincidentesRef = useRef(null);

  function verReincidentesDeJefeTurno(jefeTurno) {
    setJefeTurnoFiltro(jefeTurno);
    seccionReincidentesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setDatos(await obtenerMarcasAbiertas(desde, hasta, cdGlobal || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, cdGlobal]);

  useEffect(() => { cargar(); }, [cargar]);

  const listaFiltrada = datos
    ? (jefeTurnoFiltro ? datos.trabajadores_recurrentes.filter(t => t.jefe_turno === jefeTurnoFiltro) : datos.trabajadores_recurrentes)
    : [];

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Análisis de Marcas Abiertas (Control del Cliente)</h2>
        <p className="card-desc">
          Detecta trabajadores que marcan entrada en el control del cliente (Cencosud) pero no
          marcan salida ese día — agrupado por <strong>Jefe de Turno</strong> (no por AM/PM, ya que
          en los códigos rotativos la misma persona cambia de AM a PM semana a semana; agrupar por
          jefatura mantiene siempre junto al mismo equipo). Se marca como <strong>reincidente</strong> a
          quien lo haga 2 o más veces en el período elegido.
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
            {cargando ? 'Calculando…' : 'Actualizar'}
          </button>
          {datos && datos.todos.length > 0 && (
            <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaMarcasAbiertas(desde, hasta, cdGlobal)}>
              Descargar Excel
            </a>
          )}
        </div>

        {cdGlobal && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6 }}>
            Filtrado por CD: <strong>{cdGlobal}</strong>
          </p>
        )}

        {error && <p className="status-msg error">{error}</p>}
      </div>

      {datos && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h2>Resumen por Jefe de Turno</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Jefe de Turno</th>
                    <th>Trabajadores con marca abierta</th>
                    <th>Total marcas abiertas</th>
                    <th>Trabajadores reincidentes</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.resumen_por_jefe_turno.map(r => (
                    <tr key={r.jefe_turno}>
                      <td>{r.jefe_turno}</td>
                      <td>{r.trabajadores_con_marca_abierta}</td>
                      <td>{r.total_marcas_abiertas}</td>
                      <td>
                        {r.trabajadores_recurrentes > 0
                          ? (
                            <button
                              type="button" onClick={() => verReincidentesDeJefeTurno(r.jefe_turno)}
                              className="badge badge-warn"
                              style={{ border: 'none', cursor: 'pointer' }}
                              title={`Ver los ${r.trabajadores_recurrentes} trabajadores reincidentes de ${r.jefe_turno}`}
                            >
                              {r.trabajadores_recurrentes}
                            </button>
                          )
                          : '—'}
                      </td>
                    </tr>
                  ))}
                  {datos.resumen_por_jefe_turno.length === 0 && (
                    <tr><td colSpan={4} className="empty-state">Sin marcas abiertas en este período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" ref={seccionReincidentesRef}>
            <h2>Trabajadores Reincidentes</h2>
            <p className="card-desc">
              {datos.trabajadores_recurrentes.length} trabajador(es) con 2 o más marcas abiertas en el período.
            </p>

            <div className="filters-row">
              <div className="field">
                <label>Filtrar por Jefe de Turno</label>
                <select value={jefeTurnoFiltro} onChange={e => setJefeTurnoFiltro(e.target.value)} className="file-input">
                  <option value="">Todos</option>
                  {datos.resumen_por_jefe_turno.map(r => <option key={r.jefe_turno} value={r.jefe_turno}>{r.jefe_turno}</option>)}
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
                    <th>Jefe de Turno</th>
                    <th>N° Marcas Abiertas</th>
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
                        <td>{t.jefe_turno}</td>
                        <td><span className="badge badge-warn">{t.cantidad}</span></td>
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
                          <td colSpan={6} style={{ background: 'var(--surface-2)', padding: 14 }}>
                            <table style={{ width: 'auto', minWidth: 260 }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', padding: '2px 16px 4px 0' }}>Fecha</th>
                                  <th style={{ textAlign: 'left', padding: '2px 0 4px' }}>Entrada (sin salida)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.detalle.map(d => (
                                  <tr key={d.fecha}>
                                    <td style={{ padding: '2px 16px 2px 0', fontFamily: 'var(--font-sans)' }}>{d.fecha}</td>
                                    <td style={{ padding: '2px 0', fontFamily: 'var(--font-sans)' }}>{d.entrada}</td>
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
                    <tr><td colSpan={6} className="empty-state">Sin trabajadores reincidentes para este filtro.</td></tr>
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