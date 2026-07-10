import { useState, useEffect, useCallback } from 'react';
import { buscarEmpleados, listarAsignacionesJefeTurno, asignarJefeTurno, quitarAsignacionJefeTurno } from '../api';

const OPCIONES_TURNO = [
  { valor: 'T_RD', label: 'T_RD (rotativo AM/PM)' },
  { valor: 'T_BV', label: 'T_BV (rotativo AM/PM)' },
  { valor: 'T_WP', label: 'T_WP (Noche, fijo)' },
  { valor: 'PLANO', label: 'Turno Plano (sin jefatura, Lun-Vie)' },
];

function labelTurno(valor) {
  if (valor === 'CG') return 'Turno Plano (sin jefatura, Lun-Vie)';
  return OPCIONES_TURNO.find(o => o.valor === valor)?.label || valor || '—';
}

export default function AsignacionJefeTurno() {
  const [query, setQuery] = useState('');
  const [resultadosBusqueda, setResultadosBusqueda] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [asignaciones, setAsignaciones] = useState([]);
  const [cargandoLista, setCargandoLista] = useState(false);
  const [guardandoRut, setGuardandoRut] = useState(null);
  const [error, setError] = useState(null);

  const cargarAsignaciones = useCallback(async () => {
    setCargandoLista(true);
    try {
      const data = await listarAsignacionesJefeTurno();
      setAsignaciones(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargandoLista(false);
    }
  }, []);

  useEffect(() => { cargarAsignaciones(); }, [cargarAsignaciones]);

  useEffect(() => {
    if (query.trim().length < 2) { setResultadosBusqueda([]); return; }
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const data = await buscarEmpleados(query);
        setResultadosBusqueda(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleAsignar(rut, jefeTurno) {
    setGuardandoRut(rut);
    setError(null);
    try {
      await asignarJefeTurno(rut, jefeTurno);
      await cargarAsignaciones();
      setResultadosBusqueda(rs => rs.map(r => r.rut === rut ? { ...r, jefe_turno: jefeTurno } : r));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoRut(null);
    }
  }

  async function handleQuitar(rut) {
    setGuardandoRut(rut);
    setError(null);
    try {
      await quitarAsignacionJefeTurno(rut);
      await cargarAsignaciones();
      setResultadosBusqueda(rs => rs.map(r => r.rut === rut ? { ...r, jefe_turno: null } : r));
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoRut(null);
    }
  }

  return (
    <div className="card">
      <h2>Asignación de Jefe de Turno</h2>
      <p className="card-desc">
        Busca un trabajador por RUT o nombre y asígnalo a un jefe de turno (grupo rotativo AM/PM/Noche)
        o márcalo como Turno Plano (horario fijo, sin jefatura). Al guardar, se recalculan los atrasos.
      </p>

      <div className="filters-row">
        <div className="field" style={{ minWidth: 280 }}>
          <label>Buscar trabajador</label>
          <input
            type="text"
            placeholder="RUT o nombre..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="status-msg error">{error}</p>}

      {query.trim().length >= 2 && (
        <div className="table-scroll" style={{ marginBottom: 24, maxHeight: '40vh' }}>
          <table>
            <thead>
              <tr>
                <th>RUT</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Asignación actual</th>
                <th>Asignar como</th>
              </tr>
            </thead>
            <tbody>
              {resultadosBusqueda.map(emp => (
                <tr key={emp.rut}>
                  <td>{emp.rut}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>
                    {emp.nombre} {emp.apellido_paterno}
                  </td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.cargo}</td>
                  <td>
                    {emp.jefe_turno
                      ? <span className="badge badge-ok">{labelTurno(emp.jefe_turno)}</span>
                      : <span className="badge badge-muted">Sin asignar</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {OPCIONES_TURNO.map(op => (
                        <button
                          key={op.valor}
                          type="button"
                          className="btn"
                          style={{
                            padding: '5px 10px', fontSize: '0.75rem',
                            background: emp.jefe_turno === op.valor ? 'var(--accent)' : 'var(--surface-2)',
                            color: emp.jefe_turno === op.valor ? '#0d1117' : 'var(--text)',
                            border: '1px solid var(--border)',
                          }}
                          disabled={guardandoRut === emp.rut}
                          onClick={() => handleAsignar(emp.rut, op.valor)}
                        >
                          {op.valor}
                        </button>
                      ))}
                      {emp.jefe_turno && (
                        <button
                          type="button"
                          className="btn"
                          style={{ padding: '5px 10px', fontSize: '0.75rem', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }}
                          disabled={guardandoRut === emp.rut}
                          onClick={() => handleQuitar(emp.rut)}
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!buscando && resultadosBusqueda.length === 0 && (
                <tr><td colSpan={5} className="empty-state">Sin resultados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 8 }}>Asignaciones actuales ({asignaciones.length})</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>RUT</th>
              <th>Nombre</th>
              <th>Cargo</th>
              <th>Jefe de Turno</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {asignaciones.map(a => (
              <tr key={a.rut}>
                <td>{a.rut}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{a.nombre}</td>
                <td style={{ fontFamily: 'var(--font-sans)' }}>{a.cargo}</td>
                <td>{labelTurno(a.jefe_turno)}</td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '4px 10px', fontSize: '0.75rem', background: 'transparent', color: 'var(--danger)', border: '1px solid var(--border)' }}
                    disabled={guardandoRut === a.rut}
                    onClick={() => handleQuitar(a.rut)}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cargandoLista && asignaciones.length === 0 && (
          <div className="empty-state">No hay asignaciones registradas todavía.</div>
        )}
      </div>
    </div>
  );
}
