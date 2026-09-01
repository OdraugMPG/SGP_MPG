import { useState } from 'react';
import { listarCandidatosOrdinarias, solicitarHoraExtraOrdinaria, resolverHoraExtraOrdinaria } from '../api';

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function badgeEstado(estado) {
  if (estado === 'autorizado') return <span className="badge badge-ok">Autorizado</span>;
  if (estado === 'solicitado') return <span className="badge badge-warn">Solicitado</span>;
  if (estado === 'rechazado') return <span className="badge" style={{ background: 'var(--danger)', color: 'white' }}>Rechazado</span>;
  return <span className="badge badge-muted">Pendiente</span>;
}

const NOMBRE_DIA_POR_INDICE = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
function diaSemanaDeFecha(fecha) {
  return NOMBRE_DIA_POR_INDICE[new Date(fecha + 'T00:00:00').getDay()];
}

const DIAS = [
  { valor: 'Lun', label: 'Lunes' },
  { valor: 'Mar', label: 'Martes' },
  { valor: 'Mié', label: 'Miércoles' },
  { valor: 'Jue', label: 'Jueves' },
  { valor: 'Vie', label: 'Viernes' },
  { valor: 'Sáb', label: 'Sábado' },
  { valor: 'Dom', label: 'Domingo' },
];

const TURNOS = [
  { valor: 'AM', label: 'AM' },
  { valor: 'PM', label: 'PM' },
  { valor: 'NOCHE', label: 'Noche' },
];

function clave(f) { return `${f.rut}|${f.fecha}`; }

// Flujo: el Jefe de Turno (permiso horasExtrasSolicitar) solicita la hora
// extra ordinaria de un trabajador; el Jefe de Operaciones o un admin
// (permiso horasExtrasAprobar) la aprueba o rechaza — y también puede
// autorizarla directamente sin esperar una solicitud previa. Además de fila
// por fila, se puede filtrar por día/turno (igual que el Reporte de Horas
// Extras) y aplicar una acción masiva a los trabajadores seleccionados, con
// un mismo motivo para todos.
export default function AutorizacionHorasExtrasOrdinarias({ cdGlobal, puedeSolicitar, puedeAprobar }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [diasSemana, setDiasSemana] = useState(DIAS.map(d => d.valor)); // todos marcados por defecto
  const [turnos, setTurnos] = useState(TURNOS.map(t => t.valor)); // todos marcados por defecto
  const [filas, setFilas] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [guardandoClave, setGuardandoClave] = useState(null);
  const [observaciones, setObservaciones] = useState({}); // `${rut}|${fecha}` -> texto

  const [seleccionadas, setSeleccionadas] = useState(new Set());
  const [motivoMasivo, setMotivoMasivo] = useState('');
  const [procesandoMasivo, setProcesandoMasivo] = useState(false);

  function toggleDia(dia) {
    setDiasSemana(prev => prev.includes(dia) ? prev.filter(d => d !== dia) : [...prev, dia]);
  }
  function toggleTurno(turno) {
    setTurnos(prev => prev.includes(turno) ? prev.filter(t => t !== turno) : [...prev, turno]);
  }
  function marcarTodosDias() { setDiasSemana(DIAS.map(d => d.valor)); }
  function marcarNingunDia() { setDiasSemana([]); }

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      setFilas(await listarCandidatosOrdinarias(desde, hasta, cdGlobal || undefined));
      setSeleccionadas(new Set());
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  const filasFiltradas = (filas || []).filter(f => {
    if (diasSemana.length > 0 && !diasSemana.includes(diaSemanaDeFecha(f.fecha))) return false;
    if (turnos.length > 0) {
      const t = (f.turno || '').toUpperCase();
      if (!turnos.includes(t)) return false;
    }
    return true;
  });

  const todasVisiblesSeleccionadas = filasFiltradas.length > 0 && filasFiltradas.every(f => seleccionadas.has(clave(f)));

  function toggleSeleccionTodas() {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      if (todasVisiblesSeleccionadas) {
        filasFiltradas.forEach(f => next.delete(clave(f)));
      } else {
        filasFiltradas.forEach(f => next.add(clave(f)));
      }
      return next;
    });
  }

  function toggleSeleccionUna(f) {
    setSeleccionadas(prev => {
      const next = new Set(prev);
      const k = clave(f);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function actualizarFila(fila, promesa) {
    const claveFila = clave(fila);
    setGuardandoClave(claveFila);
    setError(null);
    try {
      await promesa;
      await buscar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoClave(null);
    }
  }

  function solicitar(fila) {
    actualizarFila(fila, solicitarHoraExtraOrdinaria(fila.rut, fila.fecha, observaciones[clave(fila)] || ''));
  }

  function resolver(fila, decision) {
    actualizarFila(fila, resolverHoraExtraOrdinaria(fila.rut, fila.fecha, decision, observaciones[clave(fila)] || ''));
  }

  const seleccionadasVisibles = filasFiltradas.filter(f => seleccionadas.has(clave(f)));

  async function accionMasiva(accion) {
    if (seleccionadasVisibles.length === 0) return;
    setProcesandoMasivo(true);
    setError(null);
    try {
      const resultados = await Promise.allSettled(seleccionadasVisibles.map(f => (
        accion === 'solicitar'
          ? solicitarHoraExtraOrdinaria(f.rut, f.fecha, motivoMasivo || '')
          : resolverHoraExtraOrdinaria(f.rut, f.fecha, accion, motivoMasivo || '')
      )));
      const fallidos = resultados.filter(r => r.status === 'rejected').length;
      if (fallidos > 0) {
        setError(`${fallidos} de ${seleccionadasVisibles.length} registro(s) no se pudieron actualizar. Revisa e intenta de nuevo con esos.`);
      }
      await buscar();
    } finally {
      setProcesandoMasivo(false);
    }
  }

  return (
    <div className="card">
      <h2>Autorización de Horas Extras Ordinarias</h2>
      <p className="card-desc">
        Trabajadores que marcaron salida <strong>después</strong> de su horario esperado en el rango
        de fechas elegido. Por defecto, esos minutos <strong>no se pagan como hora extra</strong> —
        {puedeSolicitar && ' solicita la autorización aquí, y '}
        {puedeAprobar && ' apruébala o recházala aquí (también puedes autorizarla directo, sin esperar una solicitud). '}
        Esto afecta de inmediato al cálculo en Detalle de Marcaciones, Cierre de Nómina y el Reporte
        de Horas Extras.
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
        <button className="btn" type="button" onClick={buscar} disabled={cargando}>
          {cargando ? 'Buscando…' : 'Buscar'}
        </button>
      </div>

      <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 8px' }}>Días de la semana a incluir:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
          {DIAS.map(d => (
            <label key={d.valor} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={diasSemana.includes(d.valor)} onChange={() => toggleDia(d.valor)} />
              {d.label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button type="button" onClick={marcarTodosDias} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}>Marcar todos</button>
          <button type="button" onClick={marcarNingunDia} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}>Marcar ninguno</button>
        </div>

        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '10px 0 8px', paddingTop: 10, borderTop: '1px solid var(--border)' }}>Turno a incluir:</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {TURNOS.map(t => (
            <label key={t.valor} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={turnos.includes(t.valor)} onChange={() => toggleTurno(t.valor)} />
              {t.label}
            </label>
          ))}
        </div>
      </div>

      {cdGlobal && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Filtrado por CD: <strong>{cdGlobal}</strong> (elegido en el encabezado)
        </p>
      )}

      {error && <p className="status-msg error">{error}</p>}

      {filas && (
        <>
          {(puedeSolicitar || puedeAprobar) && (
            <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 14, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
              <div className="field" style={{ minWidth: 260 }}>
                <label>Motivo (se aplica a todos los seleccionados)</label>
                <input
                  type="text" placeholder="Opcional" value={motivoMasivo} onChange={e => setMotivoMasivo(e.target.value)}
                  className="file-input"
                />
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>
                <strong>{seleccionadasVisibles.length}</strong> seleccionado(s)
              </p>
              {puedeSolicitar && (
                <button
                  type="button" className="btn" disabled={procesandoMasivo || seleccionadasVisibles.length === 0}
                  onClick={() => accionMasiva('solicitar')}
                >
                  {procesandoMasivo ? 'Procesando…' : 'Solicitar seleccionados'}
                </button>
              )}
              {puedeAprobar && (
                <>
                  <button
                    type="button" disabled={procesandoMasivo || seleccionadasVisibles.length === 0}
                    onClick={() => accionMasiva('autorizado')}
                    style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', padding: '8px 14px', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    {procesandoMasivo ? 'Procesando…' : 'Aprobar seleccionados'}
                  </button>
                  <button
                    type="button" disabled={procesandoMasivo || seleccionadasVisibles.length === 0}
                    onClick={() => accionMasiva('rechazado')}
                    style={{ background: 'none', border: '1px solid var(--danger)', borderRadius: 6, color: 'var(--danger)', padding: '8px 14px', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    {procesandoMasivo ? 'Procesando…' : 'Rechazar seleccionados'}
                  </button>
                </>
              )}
            </div>
          )}

          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            Mostrando <strong>{filasFiltradas.length}</strong> de {filas.length} registro(s) según los filtros de día/turno.
          </p>

          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" checked={todasVisiblesSeleccionadas} onChange={toggleSeleccionTodas} disabled={filasFiltradas.length === 0} /></th>
                  <th>Fecha</th>
                  <th>RUT</th>
                  <th>Nombre</th>
                  <th>Cargo</th>
                  <th>Turno</th>
                  <th>Salida real</th>
                  <th>Salida esperada</th>
                  <th>Min. extra</th>
                  <th>Estado</th>
                  <th>Observación</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map(f => {
                  const claveFila = clave(f);
                  const guardando = guardandoClave === claveFila;
                  const detalleEstado = f.estado === 'solicitado'
                    ? `Solicitado por ${f.solicitado_por || '—'}${f.observacion_solicitud ? `: "${f.observacion_solicitud}"` : ''}`
                    : (f.estado === 'autorizado' || f.estado === 'rechazado')
                      ? `${f.estado === 'autorizado' ? 'Autorizado' : 'Rechazado'} por ${f.resuelto_por || '—'}${f.observacion_resolucion ? `: "${f.observacion_resolucion}"` : ''}`
                      : null;
                  return (
                    <tr key={claveFila}>
                      <td><input type="checkbox" checked={seleccionadas.has(claveFila)} onChange={() => toggleSeleccionUna(f)} /></td>
                      <td>{f.fecha}</td>
                      <td>{f.rut}</td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                      <td style={{ fontFamily: 'var(--font-sans)' }}>{f.cargo}</td>
                      <td>{f.turno || '—'}</td>
                      <td>{f.salida_real}</td>
                      <td>{f.hora_salida_esperada}</td>
                      <td><strong>{f.minutos_extra}</strong></td>
                      <td>
                        {badgeEstado(f.estado)}
                        {detalleEstado && (
                          <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '4px 0 0', maxWidth: 200 }}>{detalleEstado}</p>
                        )}
                      </td>
                      <td>
                        <input
                          type="text" placeholder="Opcional"
                          value={observaciones[claveFila] ?? ''}
                          onChange={e => setObservaciones(prev => ({ ...prev, [claveFila]: e.target.value }))}
                          style={{ width: 160, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 7px', color: 'var(--text)', fontSize: '0.8rem' }}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                          {puedeSolicitar && f.estado !== 'autorizado' && (
                            <button
                              type="button" disabled={guardando} onClick={() => solicitar(f)}
                              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.75rem' }}
                            >
                              {guardando ? '...' : (f.estado === 'solicitado' ? 'Volver a solicitar' : 'Solicitar')}
                            </button>
                          )}
                          {puedeAprobar && f.estado !== 'autorizado' && (
                            <button
                              type="button" disabled={guardando} onClick={() => resolver(f, 'autorizado')}
                              style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem' }}
                            >
                              {guardando ? 'Guardando…' : 'Autorizar'}
                            </button>
                          )}
                          {puedeAprobar && f.estado !== 'rechazado' && f.estado !== 'autorizado' && (
                            <button
                              type="button" disabled={guardando} onClick={() => resolver(f, 'rechazado')}
                              style={{ background: 'none', border: '1px solid var(--danger)', borderRadius: 6, color: 'var(--danger)', padding: '4px 8px', cursor: 'pointer', fontSize: '0.75rem' }}
                            >
                              Rechazar
                            </button>
                          )}
                          {puedeAprobar && f.estado !== 'pendiente' && (
                            <button
                              type="button" disabled={guardando} onClick={() => resolver(f, 'pendiente')}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.72rem' }}
                            >
                              Volver a pendiente
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filasFiltradas.length === 0 && (
                  <tr><td colSpan={12} className="empty-state">No hay horas extras ordinarias para estos filtros en el período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
