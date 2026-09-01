import { useState, useEffect } from 'react';
import {
  buscarEmpleados, listarAmonestaciones, crearAmonestacion, urlDescargaAmonestacion, urlDescargaAmonestacionWord, eliminarAmonestacion,
  listarMotivosAmonestacion, crearMotivoAmonestacion, eliminarMotivoAmonestacion, obtenerAtrasosDetalle,
} from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function PanelMotivos({ motivos, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [causal, setCausal] = useState('');
  const [autocompletarAtrasos, setAutocompletarAtrasos] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function guardar(e) {
    e.preventDefault();
    if (!motivo.trim() || !causal.trim()) { setError('Motivo y causal son obligatorios.'); return; }
    setGuardando(true);
    setError(null);
    try {
      await crearMotivoAmonestacion({ motivo: motivo.trim(), causal: causal.trim(), autocompletar_atrasos: autocompletarAtrasos });
      setMotivo(''); setCausal(''); setAutocompletarAtrasos(false);
      onCambio();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este motivo del catálogo? Las cartas ya generadas con este motivo no se ven afectadas.')) return;
    try {
      await eliminarMotivoAmonestacion(id);
      onCambio();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Catálogo de Motivos</h2>
        <button className="btn" type="button" onClick={() => setAbierto(v => !v)} style={{ padding: '6px 12px', fontSize: '0.82rem' }}>
          {abierto ? 'Cerrar' : 'Administrar motivos'}
        </button>
      </div>
      <p className="card-desc">
        Motivos reutilizables para casos que se repiten (ej: atrasos reiterados, incumplimiento de
        normativa de prevención) — al elegir uno abajo en "Generar Carta", el causal se completa
        solo, y lo puedes seguir ajustando si el caso lo requiere.
      </p>

      {abierto && (
        <>
          <form onSubmit={guardar} style={{ marginBottom: 16 }}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Motivo (nombre corto para el desplegable)</label>
              <input
                type="text" value={motivo} onChange={e => setMotivo(e.target.value)} className="file-input"
                placeholder="Ej: Normativa Prevención de Riesgo (Presentación Personal)"
              />
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Causal (texto que se usará en la carta)</label>
              <textarea
                value={causal} onChange={e => setCausal(e.target.value)} rows={3} className="file-input"
                style={{ width: '100%', resize: 'vertical' }}
                placeholder='Ej: "No cumple con la normativa de mantener el cabello recogido..."'
              />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={autocompletarAtrasos} onChange={e => setAutocompletarAtrasos(e.target.checked)} />
              Autocompletar con el detalle de atrasos del mes en curso (según marca de Talana) — se agrega
              automáticamente el listado de días al elegir este motivo en la carta
            </label>
            {error && <p className="status-msg error">{error}</p>}
            <button className="btn" type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar motivo'}
            </button>
          </form>

          <div className="table-scroll">
            <table>
              <thead><tr><th>Motivo</th><th>Causal</th><th>Auto-atrasos</th><th></th></tr></thead>
              <tbody>
                {motivos.map(m => (
                  <tr key={m.id}>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{m.motivo}</td>
                    <td style={{ fontFamily: 'var(--font-sans)', whiteSpace: 'normal', minWidth: 320 }}>{m.causal}</td>
                    <td>{m.autocompletar_atrasos ? <span className="badge badge-ok">Sí</span> : '—'}</td>
                    <td>
                      <button
                        type="button" onClick={() => eliminar(m.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {motivos.length === 0 && (
                  <tr><td colSpan={4} className="empty-state">Sin motivos registrados todavía.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function Amonestaciones() {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [seleccionado, setSeleccionado] = useState(null);
  const [fecha, setFecha] = useState(hoyISO());
  const [motivoId, setMotivoId] = useState('');
  const [motivos, setMotivos] = useState([]);
  const [causal, setCausal] = useState('');
  const [direccion, setDireccion] = useState('');
  const [comuna, setComuna] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);
  const [ultimaGenerada, setUltimaGenerada] = useState(null);
  const [historial, setHistorial] = useState([]);

  const cargarMotivos = () => listarMotivosAmonestacion().then(setMotivos).catch(() => {});
  useEffect(() => { cargarMotivos(); }, []);

  const [buscandoAtrasos, setBuscandoAtrasos] = useState(false);
  const [tablaAtrasos, setTablaAtrasos] = useState([]);

  async function elegirMotivo(id) {
    setMotivoId(id);
    const m = motivos.find(x => String(x.id) === String(id));
    if (!m) return;
    if (!m.autocompletar_atrasos) {
      setCausal(m.causal);
      return;
    }
    if (!seleccionado) {
      setError('Elige primero al trabajador arriba, para poder buscar sus atrasos.');
      setCausal(m.causal);
      return;
    }
    setBuscandoAtrasos(true);
    setError(null);
    try {
      const atrasos = await obtenerAtrasosDetalle(seleccionado.rut, fecha);
      if (atrasos.length === 0) {
        setCausal(`${m.causal} No se registran atrasos en el mes en curso según la marca de Talana.`);
        setTablaAtrasos([]);
      } else {
        setCausal(`${m.causal.replace(/[.:]?\s*$/, '')}, según el siguiente detalle:`);
        setTablaAtrasos(atrasos.map(a => {
          const [anio, mes, dia] = a.fecha.split('-');
          return { fecha: `${dia}/${mes}/${anio}`, esperada: a.hora_entrada_esperada, real: a.entrada_real, retraso: a.minutos_atraso };
        }));
      }
    } catch (err) {
      setError(err.message);
      setCausal(m.causal);
      setTablaAtrasos([]);
    } finally {
      setBuscandoAtrasos(false);
    }
  }

  useEffect(() => {
    if (query.trim().length < 2) { setResultados([]); return; }
    const timer = setTimeout(async () => {
      try { setResultados(await buscarEmpleados(query.trim())); } catch { /* silencioso */ }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function elegir(emp) {
    setSeleccionado(emp);
    setResultados([]);
    setQuery('');
    setDireccion(emp.direccion || '');
    setComuna(emp.comuna || '');
    setMotivoId(''); setCausal(''); setTablaAtrasos([]); setUltimaGenerada(null);
    setError(null);
    setMensajeOk(null);
    try {
      setHistorial(await listarAmonestaciones(emp.rut));
    } catch (err) {
      setError(err.message);
    }
  }

  async function generar(e) {
    e.preventDefault();
    if (!seleccionado) { setError('Busca y selecciona al trabajador.'); return; }
    if (!causal.trim()) { setError('Describe el causal de la amonestación.'); return; }
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      const motivoElegido = motivos.find(x => String(x.id) === String(motivoId));
      const resultado = await crearAmonestacion({
        rut: seleccionado.rut, fecha, motivo: motivoElegido?.motivo || null, causal: causal.trim(), direccion, comuna,
        tabla_atrasos: tablaAtrasos.length > 0 ? tablaAtrasos : undefined,
      });
      setMensajeOk('✓ Carta generada correctamente. Elige el formato para descargarla:');
      setUltimaGenerada(resultado.id);
      setCausal(''); setMotivoId(''); setTablaAtrasos([]);
      setHistorial(await listarAmonestaciones(seleccionado.rut));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(id) {
    if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return;
    try {
      await eliminarAmonestacion(id);
      setHistorial(await listarAmonestaciones(seleccionado.rut));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <PanelMotivos motivos={motivos} onCambio={cargarMotivos} />
      <div className="card" style={{ marginBottom: 20 }}>
        <h2>Generar Carta de Amonestación</h2>
        <p className="card-desc">
          Busca al trabajador, describe el causal específico, y genera la carta en PDF con el
          modelo formal de la empresa — el resto del texto legal (Reglamento Interno, cláusulas del
          contrato) es fijo. Queda guardada en el historial del trabajador para poder descargarla
          de nuevo cuando la necesites.
        </p>

        <div className="field" style={{ marginBottom: 14, maxWidth: 420, position: 'relative' }}>
          <label>Buscar trabajador (RUT o nombre)</label>
          <input
            type="text" value={seleccionado ? `${seleccionado.nombre} ${seleccionado.apellido_paterno} — ${seleccionado.rut}` : query}
            onChange={e => { setQuery(e.target.value); setSeleccionado(null); setHistorial([]); }}
            placeholder="RUT o nombre..." className="file-input"
          />
          {!seleccionado && resultados.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 10, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4, width: '100%', maxHeight: 220, overflowY: 'auto' }}>
              {resultados.map(r => (
                <div
                  key={r.rut} onClick={() => elegir(r)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-sans)', fontSize: '0.85rem' }}
                >
                  {r.nombre} {r.apellido_paterno} — {r.rut} · {r.cargo}
                </div>
              ))}
            </div>
          )}
        </div>

        {seleccionado && (
          <form onSubmit={generar}>
            <div className="field-grid" style={{ marginBottom: 14 }}>
              <div className="field">
                <label>Fecha de la carta</label>
                <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} className="file-input" />
              </div>
              <div className="field">
                <label>Dirección (se guarda en su ficha para la próxima vez)</label>
                <input type="text" value={direccion} onChange={e => setDireccion(e.target.value)} className="file-input" placeholder="Calle, número" />
              </div>
              <div className="field">
                <label>Comuna</label>
                <input type="text" value={comuna} onChange={e => setComuna(e.target.value)} className="file-input" />
              </div>
            </div>

            <div className="field" style={{ marginBottom: 14, maxWidth: 420 }}>
              <label>Motivo (opcional — autocompleta el causal, lo puedes seguir ajustando)</label>
              <select value={motivoId} onChange={e => elegirMotivo(e.target.value)} className="file-input" disabled={buscandoAtrasos}>
                <option value="">Otro (no está en la lista) — escribir causal manualmente</option>
                {motivos.map(m => <option key={m.id} value={m.id}>{m.motivo}{m.autocompletar_atrasos ? ' (busca atrasos automático)' : ''}</option>)}
              </select>
              {buscandoAtrasos && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>Buscando atrasos del mes en curso…</p>}
              {!motivoId && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>
                  Redacta el causal libremente abajo. Si este motivo se va a repetir, considera
                  guardarlo en el "Catálogo de Motivos" arriba para reutilizarlo la próxima vez.
                </p>
              )}
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label>Detalle del causal</label>
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: '0 0 6px' }}>
                Redáctalo como continuación de la frase: <em>"Esto, a raíz que…"</em> — por ejemplo:
                "se ha detectado que usted registra 3 atrasos superiores a 30 minutos durante julio de
                2026, sin justificación previa."
              </p>
              <textarea
                value={causal} onChange={e => setCausal(e.target.value)} rows={4} className="file-input"
                style={{ width: '100%', resize: 'vertical' }}
                placeholder="se ha detectado que..."
              />
            </div>

            {tablaAtrasos.length > 0 && (
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Vista previa de la tabla de atrasos (se agrega al PDF después del causal)</label>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr><th>Fecha</th><th>Hora de ingreso Establecida</th><th>Hora de entrada</th><th>Retraso</th></tr>
                    </thead>
                    <tbody>
                      {tablaAtrasos.map((a, i) => (
                        <tr key={i}>
                          <td>{a.fecha}</td>
                          <td>{a.esperada}</td>
                          <td>{a.real}</td>
                          <td>{a.retraso} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 6 }}>
                  Total: {tablaAtrasos.length} día(s) con atraso, {tablaAtrasos.reduce((acc, a) => acc + a.retraso, 0)} minutos acumulados.
                </p>
              </div>
            )}

            {error && <p className="status-msg error">{error}</p>}
            {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}
            {ultimaGenerada && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaAmonestacion(ultimaGenerada)} target="_blank" rel="noreferrer">
                  Descargar PDF
                </a>
                <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaAmonestacionWord(ultimaGenerada)} target="_blank" rel="noreferrer">
                  Descargar Word
                </a>
              </div>
            )}

            <button className="btn" type="submit" disabled={guardando}>
              {guardando ? 'Generando…' : 'Generar carta (PDF)'}
            </button>
          </form>
        )}
      </div>

      {seleccionado && (
        <div className="card">
          <h2>Historial de amonestaciones — {seleccionado.nombre} {seleccionado.apellido_paterno}</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Motivo</th>
                  <th>Causal</th>
                  <th>Generado por</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {historial.map(h => (
                  <tr key={h.id}>
                    <td>{h.fecha}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{h.motivo || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-sans)', whiteSpace: 'normal', minWidth: 300 }}>{h.causal}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{h.generado_por || '—'}</td>
                    <td style={{ display: 'flex', gap: 10 }}>
                      <a href={urlDescargaAmonestacion(h.id)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: '0.78rem' }}>
                        PDF
                      </a>
                      <a href={urlDescargaAmonestacionWord(h.id)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontSize: '0.78rem' }}>
                        Word
                      </a>
                      <button
                        type="button" onClick={() => eliminar(h.id)}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {historial.length === 0 && (
                  <tr><td colSpan={5} className="empty-state">Sin amonestaciones registradas para este trabajador.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}