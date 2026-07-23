import { useState, useEffect, useCallback } from 'react';
import {
  buscarEmpleados, listarAusencias, asignarAusencia, quitarAusencia,
  listarParentescosFallecimiento, calcularFechaFinFallecimiento, registrarAusenciaEnRango,
  urlDescargaDocumentoAusencia,
} from '../api';

const TIPOS = [
  { value: 'P', label: 'P — Presente' },
  { value: 'F_Ju', label: 'F_Ju — Falta Justificada' },
  { value: 'F_In', label: 'F_In — Falta Injustificada' },
  { value: 'PSGS', label: 'PSGS — Permiso Sin goce de sueldo' },
  { value: 'PCGS', label: 'PCGS — Permiso Con goce de sueldo' },
  { value: 'DC', label: 'DC — Día Compensatorio' },
  { value: 'V', label: 'V — Vacaciones' },
  { value: 'R', label: 'R — Renuncia' },
  { value: 'Dv', label: 'Dv — Desvinculado' },
  { value: 'A', label: 'A — Ausente' },
  { value: 'LM', label: 'LM — Licencia Médica' },
  { value: 'PF', label: 'PF — Permiso por Fallecimiento (Art. 66)' },
];

function etiqueta(tipo) {
  const t = TIPOS.find(x => x.value === tipo);
  return t ? t.label : tipo;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const campoStyle = {
  width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 6, padding: '7px 9px', color: 'var(--text)',
};

// --- Registro por rango: Licencia Médica o Permiso por Fallecimiento ---
function RegistroPorRango({ rut, onGuardado }) {
  const [tipo, setTipo] = useState('LM');
  const [fechaInicio, setFechaInicio] = useState(hoyISO());
  const [fechaFin, setFechaFin] = useState(hoyISO());
  const [parentesco, setParentesco] = useState('');
  const [parentescos, setParentescos] = useState([]);
  const [calculo, setCalculo] = useState(null);
  const [observacion, setObservacion] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  useEffect(() => { listarParentescosFallecimiento().then(setParentescos).catch(() => {}); }, []);

  useEffect(() => {
    if (tipo !== 'PF' || !parentesco || !fechaInicio) { setCalculo(null); return; }
    calcularFechaFinFallecimiento(fechaInicio, parentesco, rut)
      .then(setCalculo)
      .catch(err => setError(err.message));
  }, [tipo, parentesco, fechaInicio]);

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      const datos = {
        rut, tipo, fecha_inicio: fechaInicio, observacion,
        documento: archivo || undefined,
      };
      if (tipo === 'LM') datos.fecha_fin = fechaFin;
      if (tipo === 'PF') datos.parentesco = parentesco;

      const resultado = await registrarAusenciaEnRango(datos);
      setMensajeOk(`✓ Registrado del ${resultado.fecha_inicio} al ${resultado.fecha_fin} (${resultado.dias} día(s)).`);
      setObservacion('');
      setArchivo(null);
      onGuardado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '0.9rem' }}>Registro por rango (con documento)</h3>
      <p style={{ margin: '0 0 12px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        Para Licencia Médica o Permiso por Fallecimiento: registra varios días de una vez y adjunta el respaldo.
      </p>

      <form onSubmit={guardar}>
        <div className="field-grid" style={{ marginBottom: 12 }}>
          <div className="field">
            <label>Tipo</label>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={campoStyle}>
              <option value="LM">LM — Licencia Médica</option>
              <option value="PF">PF — Permiso por Fallecimiento (Art. 66)</option>
            </select>
          </div>

          {tipo === 'PF' && (
            <div className="field">
              <label>Parentesco del fallecido/a</label>
              <select value={parentesco} onChange={e => setParentesco(e.target.value)} style={campoStyle}>
                <option value="">— Elegir —</option>
                {parentescos.map(p => (
                  <option key={p.value} value={p.value}>{p.label} ({p.dias} días {p.tipo_dia})</option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>{tipo === 'PF' ? 'Fecha de fallecimiento' : 'Fecha inicio'}</label>
            <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} style={campoStyle} />
          </div>

          {tipo === 'LM' && (
            <div className="field">
              <label>Fecha fin</label>
              <input type="date" value={fechaFin} min={fechaInicio} onChange={e => setFechaFin(e.target.value)} style={campoStyle} />
            </div>
          )}

          {tipo === 'PF' && calculo && (
            <div className="field">
              <label>Fecha término (calculada)</label>
              <input type="text" readOnly value={`${calculo.fecha_fin}  (${calculo.dias} días ${calculo.tipo_dia}${calculo.turno_usado ? `, calendario ${calculo.turno_usado}` : ', sin turno asignado — usó calendario genérico'})`} style={{ ...campoStyle, color: 'var(--ok)' }} />
            </div>
          )}
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Documento de respaldo {tipo === 'PF' ? '(certificado de defunción)' : '(certificado médico)'} — opcional</label>
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setArchivo(e.target.files[0] || null)} className="file-input" />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <label>Observación (opcional)</label>
          <input type="text" value={observacion} onChange={e => setObservacion(e.target.value)} style={campoStyle} />
        </div>

        {tipo === 'PF' && !calculo && parentesco && (
          <p className="status-msg" style={{ marginBottom: 10 }}>Calculando fecha de término…</p>
        )}
        {error && <p className="status-msg error">{error}</p>}
        {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

        <button className="btn" type="submit" disabled={guardando || (tipo === 'PF' && !calculo)}>
          {guardando ? 'Guardando…' : 'Registrar rango'}
        </button>
      </form>
    </div>
  );
}

export default function AsignacionAusencias() {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [empleadoElegido, setEmpleadoElegido] = useState(null);

  const [fecha, setFecha] = useState(hoyISO());
  const [tipo, setTipo] = useState('P');
  const [observacion, setObservacion] = useState('');
  const [guardando, setGuardando] = useState(false);

  const [historial, setHistorial] = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  useEffect(() => {
    if (busqueda.trim().length < 2) { setResultados([]); return; }
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        setResultados(await buscarEmpleados(busqueda.trim()));
      } catch (err) {
        setError(err.message);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [busqueda]);

  const cargarHistorial = useCallback(async (rut) => {
    setCargandoHistorial(true);
    try {
      setHistorial(await listarAusencias({ rut }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargandoHistorial(false);
    }
  }, []);

  function elegirEmpleado(emp) {
    setEmpleadoElegido(emp);
    setBusqueda('');
    setResultados([]);
    setMensajeOk(null);
    setError(null);
    cargarHistorial(emp.rut);
  }

  async function guardar() {
    if (!empleadoElegido || !fecha || !tipo) return;
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      await asignarAusencia(empleadoElegido.rut, fecha, tipo, observacion || null);
      setMensajeOk(`Asignado: ${tipo} para ${fecha}.`);
      setObservacion('');
      await cargarHistorial(empleadoElegido.rut);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function quitar(f) {
    setError(null);
    try {
      await quitarAusencia(empleadoElegido.rut, f);
      await cargarHistorial(empleadoElegido.rut);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2>Ausencias y permisos</h2>
      <p className="card-desc">
        Asigna una sigla (Presente, Falta, Permiso, Vacaciones, etc.) a un trabajador para un día
        específico. En el Reporte Diario esa sigla reemplaza las horas calculadas de ese día.
      </p>

      <div className="field" style={{ maxWidth: 400, marginBottom: 18 }}>
        <label>Buscar trabajador por RUT o nombre</label>
        <input
          type="text"
          placeholder="Ej: 12345678-9 o Juan Pérez"
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="file-input"
        />
      </div>

      {busqueda.trim().length >= 2 && (
        <div className="table-scroll" style={{ marginBottom: 20, maxHeight: '30vh' }}>
          <table>
            <thead><tr><th>RUT</th><th>Nombre</th><th>Cargo</th><th></th></tr></thead>
            <tbody>
              {resultados.map(emp => (
                <tr key={emp.rut}>
                  <td>{emp.rut}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.nombre} {emp.apellido_paterno}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.cargo}</td>
                  <td>
                    <button className="btn" type="button" style={{ padding: '5px 10px', fontSize: '0.78rem' }} onClick={() => elegirEmpleado(emp)}>
                      Elegir
                    </button>
                  </td>
                </tr>
              ))}
              {!buscando && resultados.length === 0 && (
                <tr><td colSpan={4} className="empty-state">Sin resultados</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {empleadoElegido && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10, padding: 18, marginBottom: 20 }}>
          <div style={{ marginBottom: 14 }}>
            <strong style={{ fontFamily: 'var(--font-sans)' }}>
              {empleadoElegido.nombre} {empleadoElegido.apellido_paterno}
            </strong>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontFamily: 'var(--font-mono)' }}>{empleadoElegido.rut}</span>
          </div>

          <RegistroPorRango rut={empleadoElegido.rut} onGuardado={() => cargarHistorial(empleadoElegido.rut)} />

          <h3 style={{ marginTop: 8, marginBottom: 6, fontSize: '0.9rem' }}>Registro de un solo día</h3>
          <div className="field-grid" style={{ marginBottom: 14 }}>
            <div className="field">
              <label>Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={campoStyle} />
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={tipo} onChange={e => setTipo(e.target.value)} style={campoStyle}>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Observación (opcional)</label>
              <input type="text" value={observacion} onChange={e => setObservacion(e.target.value)} style={campoStyle} />
            </div>
          </div>

          {error && <p className="status-msg error">{error}</p>}
          {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

          <button className="btn" type="button" disabled={guardando} onClick={guardar}>
            {guardando ? 'Guardando…' : 'Asignar'}
          </button>

          <h3 style={{ marginTop: 24, marginBottom: 6, fontSize: '0.9rem' }}>Historial de este trabajador</h3>
          <div className="table-scroll" style={{ maxHeight: '30vh' }}>
            <table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Observación</th><th>Documento</th><th></th></tr></thead>
              <tbody>
                {historial.map(h => (
                  <tr key={h.fecha}>
                    <td>{h.fecha}</td>
                    <td><span className="badge badge-muted">{etiqueta(h.tipo)}</span></td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{h.observacion || '—'}</td>
                    <td>
                      {h.documento_id ? (
                        <a href={urlDescargaDocumentoAusencia(h.documento_id)} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                          Ver documento
                        </a>
                      ) : '—'}
                    </td>
                    <td>
                      <button
                        type="button" onClick={() => quitar(h.fecha)}
                        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
                {!cargandoHistorial && historial.length === 0 && (
                  <tr><td colSpan={5} className="empty-state">Sin registros para este trabajador.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
