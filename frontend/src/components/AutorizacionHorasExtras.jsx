import { useState } from 'react';
import { listarCandidatosAutorizacion, autorizarHoraExtra } from '../api';

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function AutorizacionHorasExtras({ cdGlobal }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [filas, setFilas] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [guardandoClave, setGuardandoClave] = useState(null);
  const [observaciones, setObservaciones] = useState({}); // `${rut}|${fecha}` -> texto

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      setFilas(await listarCandidatosAutorizacion(desde, hasta, cdGlobal || undefined));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function cambiarAutorizacion(fila, autorizar) {
    const clave = `${fila.rut}|${fila.fecha}`;
    setGuardandoClave(clave);
    setError(null);
    try {
      await autorizarHoraExtra(fila.rut, fila.fecha, autorizar, observaciones[clave] || '');
      setFilas(prev => prev.map(f =>
        f.rut === fila.rut && f.fecha === fila.fecha ? { ...f, autorizado: autorizar } : f
      ));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoClave(null);
    }
  }

  return (
    <div className="card">
      <h2>Autorización de Horas Extras Anticipadas</h2>
      <p className="card-desc">
        Trabajadores que marcaron entrada <strong>antes</strong> de su horario esperado en el rango
        de fechas elegido. Por defecto, esos minutos anticipados <strong>no se pagan como hora
        extra</strong> — autorízalos aquí si corresponde que sí se paguen (por ejemplo, si se les
        pidió llegar antes para un evento puntual). Esto afecta de inmediato al cálculo en Detalle
        de Marcaciones, Cierre de Nómina y el Reporte de Horas Extras.
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

      {cdGlobal && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Filtrado por CD: <strong>{cdGlobal}</strong> (elegido en el encabezado)
        </p>
      )}

      {error && <p className="status-msg error">{error}</p>}

      {filas && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Turno</th>
                <th>Entrada real</th>
                <th>Entrada esperada</th>
                <th>Min. anticipados</th>
                <th>Estado</th>
                <th>Observación</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => {
                const clave = `${f.rut}|${f.fecha}`;
                const guardando = guardandoClave === clave;
                return (
                  <tr key={clave}>
                    <td>{f.fecha}</td>
                    <td>{f.rut}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{f.cargo}</td>
                    <td>{f.turno || '—'}</td>
                    <td>{f.entrada_real}</td>
                    <td>{f.hora_entrada_esperada}</td>
                    <td><strong>{f.minutos_anticipados}</strong></td>
                    <td>
                      {f.autorizado
                        ? <span className="badge badge-ok">Autorizado</span>
                        : <span className="badge badge-muted">No autorizado</span>}
                    </td>
                    <td>
                      <input
                        type="text" placeholder="Opcional"
                        value={observaciones[clave] ?? f.observacion ?? ''}
                        onChange={e => setObservaciones(prev => ({ ...prev, [clave]: e.target.value }))}
                        style={{ width: 160, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 7px', color: 'var(--text)', fontSize: '0.8rem' }}
                      />
                    </td>
                    <td>
                      {f.autorizado ? (
                        <button
                          type="button" disabled={guardando} onClick={() => cambiarAutorizacion(f, false)}
                          style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
                        >
                          {guardando ? '...' : 'Quitar'}
                        </button>
                      ) : (
                        <button
                          type="button" disabled={guardando} onClick={() => cambiarAutorizacion(f, true)}
                          style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', padding: '5px 10px', cursor: 'pointer', fontSize: '0.78rem' }}
                        >
                          {guardando ? 'Guardando…' : 'Autorizar'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filas.length === 0 && (
                <tr><td colSpan={11} className="empty-state">No hay entradas anticipadas en este rango.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
