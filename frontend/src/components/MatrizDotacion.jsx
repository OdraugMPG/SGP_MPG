import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  obtenerMatrizSimuladorDotacion, obtenerDetalleDiaTurnoSimulador, generarAnalisisRiesgoDotacion,
  crearRequerimientoDotacion,
} from '../api';
import { renderizarNarrativa } from '../utils/markdownLite';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const DIAS_LUN_SAB = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const TURNOS_DETALLE = ['AM', 'PM', 'NOCHE', 'PLANO'];
const UMBRAL_MUESTRA_BAJA = 10; // menos de esto, el % de la celda no es confiable
const UMBRAL_AUSENTISMO_ALTO = 18; // % desde el cual se resalta una celda del detalle

// Turno por el que se puede filtrar cada fila de la matriz: TODOS (el
// cargo completo, comportamiento por defecto) o uno de los 5 turnos —
// AM y PM por separado (misma gente, tasa de ausentismo distinta), ROTATIVO
// como su combinado, y Noche/Plano que son fijos.
const OPCIONES_TURNO_MATRIZ = ['TODOS', 'AM', 'PM', 'ROTATIVO', 'NOCHE', 'PLANO'];

function etiquetaTurnoMatriz(t) {
  if (t === 'TODOS') return 'Todos los turnos';
  if (t === 'ROTATIVO') return 'Rotativo (AM+PM)';
  if (t === 'NOCHE') return 'Noche';
  if (t === 'PLANO') return 'Plano';
  return t; // AM, PM
}

// Extrae de una fila de la matriz los datos correspondientes al turno
// elegido — si es "TODOS", son los campos planos del cargo completo; si no,
// vienen del desglose por_turno que ya calculó el backend.
function datosDeFila(fila, turnoSel) {
  if (turnoSel === 'TODOS') {
    return {
      requerido_actual: fila.requerido_actual,
      ausentismo_pct: fila.ausentismo_pct,
      usa_promedio_general: fila.usa_promedio_general,
      dotacion_activa: fila.dotacion_activa,
      frecuencia_sobredotacion_pct: fila.frecuencia_sobredotacion_pct,
    };
  }
  return fila.por_turno?.[turnoSel] || {
    requerido_actual: 0, ausentismo_pct: 0, usa_promedio_general: false, dotacion_activa: 0, frecuencia_sobredotacion_pct: null,
  };
}

function calcularFila(datos, nuevoRequerido, margenPct) {
  const tasaTotal = Math.min(Math.max((datos.ausentismo_pct + margenPct) / 100, 0), 0.95);
  const dotacionMinima = nuevoRequerido > 0 ? Math.ceil(nuevoRequerido / (1 - tasaTotal)) : 0;
  const sobreRequerido = Math.max(dotacionMinima - nuevoRequerido, 0);
  const vsActiva = dotacionMinima - datos.dotacion_activa;
  return { dotacionMinima, sobreRequerido, vsActiva };
}

// Matriz de TODOS los cargos de un CD a la vez: requerido actual, nuevo
// requerido simulable, dotación mínima sugerida, sobre-requerido (backup) y
// la brecha vs. lo contratado hoy — sin tener que ir cargo por cargo. Cada
// fila se puede expandir para ver el detalle Lunes a Sábado × AM/PM/Noche/Plano,
// y hay un análisis de riesgo (sub y sobre-dotación) con IA sobre toda la matriz.
export default function MatrizDotacion({ cargos, cd }) {
  const [dias, setDias] = useState(60);
  const [margen, setMargen] = useState('0');
  const [matriz, setMatriz] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [nuevoRequeridoPorCargo, setNuevoRequeridoPorCargo] = useState({});
  const [turnoPorCargo, setTurnoPorCargo] = useState({});

  const [cargoExpandido, setCargoExpandido] = useState(null);
  const [detallePorCargo, setDetallePorCargo] = useState({});
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const [analizandoIA, setAnalizandoIA] = useState(false);
  const [narrativaRiesgo, setNarrativaRiesgo] = useState(null);
  const [errorIA, setErrorIA] = useState(null);

  const [aplicandoCargo, setAplicandoCargo] = useState(null);
  const [mensajeAplicado, setMensajeAplicado] = useState({}); // cargo -> texto

  const cargarMatriz = useCallback(async () => {
    if (!cd || cargos.length === 0) { setMatriz(null); return; }
    setCargando(true);
    setError(null);
    setNarrativaRiesgo(null);
    setCargoExpandido(null);
    try {
      const datos = await obtenerMatrizSimuladorDotacion(cd, dias, cargos);
      setMatriz(datos);
      const iniciales = {};
      const turnosIniciales = {};
      for (const fila of datos.filas) {
        iniciales[fila.cargo] = String(fila.requerido_actual);
        turnosIniciales[fila.cargo] = 'TODOS';
      }
      setNuevoRequeridoPorCargo(iniciales);
      setTurnoPorCargo(turnosIniciales);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }, [cd, dias, cargos]);

  useEffect(() => { cargarMatriz(); }, [cargarMatriz]);

  // Al cambiar el turno de una fila, "Nuevo Requerido" se reinicia al
  // requerido real de ESE turno (igual que en el simulador de un cargo) —
  // si el usuario ya lo había editado, parte de nuevo desde el dato real.
  function cambiarTurno(cargo, turno) {
    setTurnoPorCargo(prev => ({ ...prev, [cargo]: turno }));
    const fila = matriz?.filas.find(f => f.cargo === cargo);
    if (fila) {
      const datos = datosDeFila(fila, turno);
      setNuevoRequeridoPorCargo(prev => ({ ...prev, [cargo]: String(datos.requerido_actual) }));
    }
  }

  // Guarda "Nuevo Requerido" como el Requerimiento Dotación real de ese
  // cargo/turno/CD (mismo flujo que "Registro histórico" más abajo, con
  // fecha de hoy). Solo tiene sentido para un turno concreto — "Todos los
  // turnos" y "Rotativo" son vistas combinadas, no un turno que se pueda
  // guardar tal cual.
  async function aplicarFila(cargo, turnoSel, requerido, ausentismoPct, dotacionMinima) {
    setAplicandoCargo(cargo);
    setError(null);
    try {
      await crearRequerimientoDotacion({
        cargo, turno: turnoSel, cd, cantidad_requerida: requerido, vigente_desde: hoyISO(),
        observacion: `Aplicado desde la Matriz de Dotación (ausentismo hist. ${ausentismoPct}%, dotación mínima sugerida ${dotacionMinima}).`,
      });
      setMensajeAplicado(prev => ({ ...prev, [cargo]: `✓ Guardado: ${cargo} / ${turnoSel} = ${requerido}, desde ${hoyISO()}.` }));
    } catch (err) {
      setError(err.message);
    } finally {
      setAplicandoCargo(null);
    }
  }

  async function verDetalle(cargo) {
    if (cargoExpandido === cargo) { setCargoExpandido(null); return; }
    setCargoExpandido(cargo);
    if (detallePorCargo[cargo]) return;
    setCargandoDetalle(true);
    try {
      const datos = await obtenerDetalleDiaTurnoSimulador(cargo, cd, dias);
      setDetallePorCargo(prev => ({ ...prev, [cargo]: datos }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargandoDetalle(false);
    }
  }

  async function generarRiesgo() {
    if (!matriz) return;
    setAnalizandoIA(true);
    setErrorIA(null);
    try {
      const margenNum = Number(margen) || 0;
      const filas = matriz.filas.map(f => {
        const turnoSel = turnoPorCargo[f.cargo] || 'TODOS';
        const datos = datosDeFila(f, turnoSel);
        const nuevoRequerido = Number(nuevoRequeridoPorCargo[f.cargo]) || 0;
        const { dotacionMinima, sobreRequerido, vsActiva } = calcularFila(datos, nuevoRequerido, margenNum);
        return {
          cargo: f.cargo,
          turno: etiquetaTurnoMatriz(turnoSel),
          requerido_actual: datos.requerido_actual,
          nuevo_requerido: nuevoRequerido,
          ausentismo_pct: datos.ausentismo_pct,
          dotacion_minima_sugerida: dotacionMinima,
          sobre_requerido: sobreRequerido,
          dotacion_activa: datos.dotacion_activa,
          vs_dotacion_activa: vsActiva,
          frecuencia_sobredotacion_historica_pct: datos.frecuencia_sobredotacion_pct,
        };
      });
      const resultado = await generarAnalisisRiesgoDotacion(cd, filas);
      setNarrativaRiesgo(resultado.narrativa);
    } catch (err) {
      setErrorIA(err.message);
    } finally {
      setAnalizandoIA(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20, borderColor: 'var(--accent)' }}>
      <h2>Matriz de Dotación — Todos los Cargos</h2>
      <p className="card-desc">
        Mismo cálculo que el simulador de arriba (dotación mínima = requerido ÷ (1 − % ausentismo)),
        pero para todos los cargos de una vez. La columna “Turno” cambia toda la fila a ese turno
        específico (AM y PM tienen su propia tasa de ausentismo aunque compartan la misma gente
        rotando — “Rotativo” los junta). Edita “Nuevo Requerido” para simular un escenario, y usa
        “Sobre Requerido” para ver cuánta gente de más habría si el 100% de los contratados (incluido
        el backup) llega el mismo día — con “Frecuencia sobredotación” al lado, que muestra qué tan
        seguido eso ya pasa de verdad según el historial real.
      </p>

      {!cd && <p className="status-msg error">Elige un CD arriba para ver la matriz.</p>}
      {cargos.length === 0 && <p className="status-msg error">Agrega al menos un cargo abajo para poder ver la matriz.</p>}

      {cd && cargos.length > 0 && (
        <>
          <div className="filters-row" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>Historia de ausentismo a considerar</label>
              <select value={dias} onChange={e => setDias(Number(e.target.value))} className="file-input" style={{ width: 160 }}>
                <option value={30}>Últimos 30 días</option>
                <option value={45}>Últimos 45 días</option>
                <option value={60}>Últimos 60 días</option>
              </select>
            </div>
            <div className="field">
              <label>Margen de seguridad adicional (%, aplica a toda la matriz)</label>
              <input type="number" min="0" step="0.5" value={margen} onChange={e => setMargen(e.target.value)} className="file-input" style={{ width: 140 }} />
            </div>
          </div>

          {error && <p className="status-msg error">{error}</p>}
          {cargando && <p className="status-msg">Calculando matriz…</p>}

          {matriz && !cargando && (
            <>
              <div className="table-scroll" style={{ marginBottom: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Cargo</th>
                      <th>Requerido Actual</th>
                      <th>Nuevo Requerido</th>
                      <th>Turno</th>
                      <th>% Ausentismo</th>
                      <th>Dotación Mínima Sugerida</th>
                      <th>Sobre Requerido</th>
                      <th>Vs. Dotación Activa</th>
                      <th>Frecuencia Sobredotación</th>
                      <th>Aplicar</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {matriz.filas.map(f => {
                      const turnoSel = turnoPorCargo[f.cargo] || 'TODOS';
                      const datos = datosDeFila(f, turnoSel);
                      const nuevoRequerido = Number(nuevoRequeridoPorCargo[f.cargo]) || 0;
                      const margenNum = Number(margen) || 0;
                      const { dotacionMinima, sobreRequerido, vsActiva } = calcularFila(datos, nuevoRequerido, margenNum);
                      const frecuenciaAlta = datos.frecuencia_sobredotacion_pct !== null && datos.frecuencia_sobredotacion_pct >= 15;
                      return (
                        <Fragment key={f.cargo}>
                          <tr>
                            <td style={{ fontFamily: 'var(--font-sans)' }}>{f.cargo}</td>
                            <td>{datos.requerido_actual}</td>
                            <td>
                              <input
                                type="number" min="0"
                                value={nuevoRequeridoPorCargo[f.cargo] ?? ''}
                                onChange={e => setNuevoRequeridoPorCargo(prev => ({ ...prev, [f.cargo]: e.target.value }))}
                                style={{ width: 70, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 6px', color: 'var(--text)', textAlign: 'center' }}
                              />
                            </td>
                            <td>
                              <select
                                value={turnoSel} onChange={e => cambiarTurno(f.cargo, e.target.value)}
                                className="file-input" style={{ padding: '4px 6px', fontSize: '0.8rem' }}
                              >
                                {OPCIONES_TURNO_MATRIZ.map(t => <option key={t} value={t}>{etiquetaTurnoMatriz(t)}</option>)}
                              </select>
                            </td>
                            <td>
                              {datos.ausentismo_pct}%{datos.usa_promedio_general && <span title="Poca muestra propia — usa un promedio de respaldo" style={{ color: 'var(--text-muted)' }}> *</span>}
                            </td>
                            <td style={{ fontWeight: 700 }}>{dotacionMinima}</td>
                            <td>+{sobreRequerido}</td>
                            <td style={{ color: vsActiva > 0 ? 'var(--danger)' : 'var(--accent)', fontWeight: 600 }}>
                              {vsActiva > 0 ? `Faltan ${vsActiva}` : vsActiva < 0 ? `Sobran ${Math.abs(vsActiva)}` : 'Exacto'}
                            </td>
                            <td>
                              {datos.frecuencia_sobredotacion_pct === null
                                ? <span className="badge badge-muted">Sin datos</span>
                                : <span className={frecuenciaAlta ? 'badge badge-warn' : 'badge badge-muted'}>{datos.frecuencia_sobredotacion_pct}%</span>}
                            </td>
                            <td>
                              {turnoSel === 'TODOS' || turnoSel === 'ROTATIVO' ? (
                                <span title="Elige AM, PM, Noche o Plano específico para poder aplicar" style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>—</span>
                              ) : (
                                <button
                                  type="button" disabled={aplicandoCargo === f.cargo}
                                  onClick={() => aplicarFila(f.cargo, turnoSel, nuevoRequerido, datos.ausentismo_pct, dotacionMinima)}
                                  className="btn" style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                                  title={`Guardar ${nuevoRequerido} como Requerimiento Dotación de ${f.cargo} / ${turnoSel}, vigente desde hoy`}
                                >
                                  {aplicandoCargo === f.cargo ? '…' : 'Aplicar'}
                                </button>
                              )}
                              {mensajeAplicado[f.cargo] && (
                                <p style={{ fontSize: '0.7rem', color: 'var(--accent)', margin: '4px 0 0' }}>{mensajeAplicado[f.cargo]}</p>
                              )}
                            </td>
                            <td>
                              <button
                                type="button" onClick={() => verDetalle(f.cargo)}
                                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}
                              >
                                {cargoExpandido === f.cargo ? 'Ocultar' : 'Ver Lun-Sáb'}
                              </button>
                            </td>
                          </tr>
                          {cargoExpandido === f.cargo && (
                            <tr>
                              <td colSpan={11} style={{ background: 'var(--surface-2)', padding: 14 }}>
                                {cargandoDetalle && !detallePorCargo[f.cargo] && <p className="status-msg">Calculando detalle…</p>}
                                {detallePorCargo[f.cargo] && (
                                  <>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                                      % de ausentismo por día y turno ({detallePorCargo[f.cargo].desde} a {detallePorCargo[f.cargo].hasta}).
                                      Celdas en gris: menos de {UMBRAL_MUESTRA_BAJA} días de muestra, poco confiables.
                                    </p>
                                    <table style={{ width: 'auto' }}>
                                      <thead>
                                        <tr>
                                          <th style={{ textAlign: 'left' }}>Día</th>
                                          {TURNOS_DETALLE.map(t => <th key={t}>{t === 'NOCHE' ? 'Noche' : t === 'PLANO' ? 'Plano' : t}</th>)}
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {DIAS_LUN_SAB.map(dia => (
                                          <tr key={dia}>
                                            <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 600 }}>{dia}</td>
                                            {TURNOS_DETALLE.map(turno => {
                                              const celda = detallePorCargo[f.cargo].grilla[dia][turno];
                                              const sinDato = celda.ausentismo_pct === null;
                                              const pocaMuestra = !sinDato && celda.muestra < UMBRAL_MUESTRA_BAJA;
                                              const alto = !sinDato && celda.ausentismo_pct >= UMBRAL_AUSENTISMO_ALTO;
                                              return (
                                                <td
                                                  key={turno}
                                                  title={sinDato ? 'Sin datos' : `Muestra: ${celda.muestra} días-persona`}
                                                  style={{
                                                    textAlign: 'center', padding: '4px 10px',
                                                    color: sinDato ? 'var(--text-muted)' : pocaMuestra ? 'var(--text-muted)' : alto ? 'var(--danger)' : 'var(--text)',
                                                    fontWeight: alto ? 700 : 400,
                                                  }}
                                                >
                                                  {sinDato ? '—' : `${celda.ausentismo_pct}%`}
                                                </td>
                                              );
                                            })}
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                <p style={{ fontSize: '0.8rem', marginBottom: 10 }}>
                  Un agente de IA puede leer esta matriz completa (con lo que hayas simulado en “Nuevo
                  Requerido”, y el turno que hayas elegido en cada fila) y señalar qué cargos tienen
                  mayor riesgo de subdotación y cuáles de sobredotación real — usando la frecuencia
                  histórica, no solo el número teórico.
                </p>
                <button className="btn" type="button" disabled={analizandoIA} onClick={generarRiesgo}>
                  {analizandoIA ? 'Analizando…' : 'Generar análisis de riesgo con IA'}
                </button>
                {errorIA && <p className="status-msg error" style={{ marginTop: 10 }}>{errorIA}</p>}
                {narrativaRiesgo && (
                  <div style={{ marginTop: 14, fontFamily: 'var(--font-sans)' }}>
                    {renderizarNarrativa(narrativaRiesgo)}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
