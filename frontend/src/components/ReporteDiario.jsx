import { useState, useEffect } from 'react';
import { obtenerReporteDiario, urlDescargaReporteDiario, obtenerLogMarcacion, listarAreas, buscarEmpleados, urlDescargaReporteEmpleadoPDF, urlDescargaReportePorJefeTurnoPDF } from '../api';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

const ETIQUETA_ERROR = {
  doble_entrada: 'Doble marca "Entrada"',
  doble_salida: 'Doble marca "Salida"',
  sin_marca_salida_talana: 'Sin marca de salida (sanción 4h)',
};

function hoyMesISO() {
  return new Date().toISOString().slice(0, 7);
}

function ReporteIndividualPDF() {
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState([]);
  const [buscando, setBuscando] = useState(false);
  const [mes, setMes] = useState(hoyMesISO());

  useEffect(() => {
    if (busqueda.trim().length < 2) { setResultados([]); return; }
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        setResultados(await buscarEmpleados(busqueda.trim()));
      } finally {
        setBuscando(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [busqueda]);

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>Reporte individual mensual (PDF)</h2>
      <p className="card-desc">
        Marcaciones de Talana del mes, atrasos, ausencias y errores de marcación de un trabajador
        específico — listo para mostrarle su detalle.
      </p>

      <div className="filters-row">
        <div className="field" style={{ minWidth: 260 }}>
          <label>Buscar trabajador</label>
          <input type="text" placeholder="RUT o nombre..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        </div>
        <div className="field">
          <label>Mes</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        </div>
      </div>

      {busqueda.trim().length >= 2 && (
        <div className="table-scroll" style={{ maxHeight: '30vh' }}>
          <table>
            <thead><tr><th>RUT</th><th>Nombre</th><th>Cargo</th><th></th></tr></thead>
            <tbody>
              {resultados.map(emp => (
                <tr key={emp.rut}>
                  <td>{emp.rut}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.nombre} {emp.apellido_paterno}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{emp.cargo}</td>
                  <td>
                    <a
                      className="btn" style={{ textDecoration: 'none', padding: '5px 10px', fontSize: '0.78rem' }}
                      href={urlDescargaReporteEmpleadoPDF(emp.rut, mes)}
                    >
                      Descargar PDF
                    </a>
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
    </div>
  );
}

const OPCIONES_JEFE_TURNO = [
  { value: 'T_RD', label: 'T_RD' },
  { value: 'T_BV', label: 'T_BV' },
  { value: 'T_WP', label: 'T_WP (Noche)' },
  { value: 'CG', label: 'Plano (CG)' },
];

function ReporteMasivoPorJefeTurno() {
  const [jefeTurno, setJefeTurno] = useState('T_RD');
  const [mes, setMes] = useState(hoyMesISO());

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <h2>Reporte masivo por Jefe de Turno (PDF)</h2>
      <p className="card-desc">
        Genera un solo PDF con una sección por cada trabajador activo de ese grupo — sin tener que
        buscarlos uno por uno.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Jefe de Turno</label>
          <select
            value={jefeTurno} onChange={e => setJefeTurno(e.target.value)}
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text)', fontSize: '0.82rem' }}
          >
            {OPCIONES_JEFE_TURNO.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Mes</label>
          <input type="month" value={mes} onChange={e => setMes(e.target.value)} />
        </div>
        <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaReportePorJefeTurnoPDF(jefeTurno, mes)}>
          Descargar PDF masivo
        </a>
      </div>
    </div>
  );
}

export default function ReporteDiario() {
  const [fecha, setFecha] = useState(hoyISO());
  const [filas, setFilas] = useState(null);
  const [log, setLog] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const [areas, setAreas] = useState([]);
  const [areasExcluidas, setAreasExcluidas] = useState([]);
  const [mostrarSelectorAreas, setMostrarSelectorAreas] = useState(false);

  useEffect(() => { listarAreas().then(setAreas).catch(() => {}); }, []);

  function toggleArea(area) {
    setAreasExcluidas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]);
  }

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      const [res, logRes] = await Promise.all([
        obtenerReporteDiario(fecha, areasExcluidas),
        obtenerLogMarcacion(fecha),
      ]);
      setFilas(res);
      setLog(logRes);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
    <div className="card">
      <h2>Reporte diario</h2>
      <p className="card-desc">
        Vista lista para entregar al cliente: entrada y salida de cada trabajador para un día específico.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </div>
        <button className="btn" type="button" onClick={buscar} disabled={cargando}>
          {cargando ? 'Cargando…' : 'Ver reporte'}
        </button>
        {filas && filas.length > 0 && (
          <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaReporteDiario(fecha, areasExcluidas)}>
            Descargar Excel
          </a>
        )}
        <button
          type="button" onClick={() => setMostrarSelectorAreas(v => !v)}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', cursor: 'pointer' }}
        >
          Excluir áreas{areasExcluidas.length > 0 ? ` (${areasExcluidas.length})` : ''}
        </button>
      </div>

      {mostrarSelectorAreas && (
        <div style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {areas.map(a => (
            <label key={a} className="checkbox-field" style={{ paddingBottom: 0 }}>
              <input type="checkbox" checked={areasExcluidas.includes(a)} onChange={() => toggleArea(a)} />
              {a}
            </label>
          ))}
          {areas.length === 0 && <span className="status-msg">No hay áreas configuradas.</span>}
        </div>
      )}

      {error && <p className="status-msg error">{error}</p>}

      {filas && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Empresa</th>
                <th>Nombre</th>
                <th>RUT</th>
                <th>Cargo</th>
                <th>Turno</th>
                <th>Fecha</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th>Contrato</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.RUT}>
                  <td>{f['N°']}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.EMPRESA}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.NOMBRE}</td>
                  <td>{f.RUT}</td>
                  <td style={{ fontFamily: 'var(--font-sans)' }}>{f.CARGO}</td>
                  <td>{f.TURNO}</td>
                  <td>{f.FECHA}</td>
                  <td>{f.ausencia ? '—' : f['HORA (ENTRADA)']}</td>
                  <td className={f.salida_sancion ? 'atraso-cell severo' : ''}>
                    {f.ausencia ? <span className="badge badge-warn">{f['HORA (SALIDA)']}</span> : f['HORA (SALIDA)']}
                    {f.salida_sancion && ' ⚠'}
                  </td>
                  <td>{f.CONTRATO}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filas.length === 0 && <div className="empty-state">No hay datos para esta fecha.</div>}
        </div>
      )}

      {log && log.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2>Log de errores de marcación</h2>
          <p className="card-desc">
            Casos detectados este día: doble marca del mismo tipo (reasignada automáticamente) o
            falta de marca de salida en Talana (sancionada a 4 horas). Útil para informar al trabajador.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>RUT</th>
                  <th>Nombre</th>
                  <th>Tipo de error</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {log.map((l, i) => (
                  <tr key={i}>
                    <td>{l.rut}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{l.nombre}</td>
                    <td><span className="badge badge-warn">{ETIQUETA_ERROR[l.tipo_error] || l.tipo_error}</span></td>
                    <td style={{ whiteSpace: 'normal', fontFamily: 'var(--font-sans)', minWidth: 320 }}>{l.detalle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
    <ReporteIndividualPDF />
    <ReporteMasivoPorJefeTurno />
    </>
  );
}
