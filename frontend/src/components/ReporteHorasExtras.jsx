import { useState } from 'react';
import {
  obtenerReporteHorasExtras, urlDescargaHorasExtrasExcel, urlDescargaHorasExtrasPdf,
} from '../api';

function primerDiaMesISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
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

export default function ReporteHorasExtras({ cdGlobal }) {
  const [desde, setDesde] = useState(primerDiaMesISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [diasSemana, setDiasSemana] = useState(DIAS.map(d => d.valor)); // todos marcados por defecto
  const [turnos, setTurnos] = useState(TURNOS.map(t => t.valor)); // todos marcados por defecto
  const [soloAutorizadas, setSoloAutorizadas] = useState(false);
  const [filas, setFilas] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  function toggleDia(dia) {
    setDiasSemana(prev => prev.includes(dia) ? prev.filter(d => d !== dia) : [...prev, dia]);
  }

  function toggleTurno(turno) {
    setTurnos(prev => prev.includes(turno) ? prev.filter(t => t !== turno) : [...prev, turno]);
  }

  function marcarTodos() { setDiasSemana(DIAS.map(d => d.valor)); }
  function marcarNinguno() { setDiasSemana([]); }

  async function buscar() {
    setCargando(true);
    setError(null);
    try {
      setFilas(await obtenerReporteHorasExtras(desde, hasta, diasSemana, turnos, cdGlobal || undefined, soloAutorizadas));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  const totalMin = (filas || []).reduce((acc, f) => {
    if (!f.horas_extras) return acc;
    const [h, m] = f.horas_extras.split(':').map(Number);
    return acc + (h * 60 + m);
  }, 0);
  const totalFormato = `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;

  return (
    <div className="card">
      <h2>Reporte de Horas Extras</h2>
      <p className="card-desc">
        Detalle de horas extras por trabajador en el rango de fechas que elijas — filtra además por
        día(s) de la semana si solo necesitas, por ejemplo, un día particular (o excluir domingos).
        La columna "Autorizado" queda preparada para el módulo de autorización de horas extras que
        viene en una próxima actualización — por ahora todo aparece como "Pendiente".
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
          {cargando ? 'Calculando…' : 'Ver reporte'}
        </button>
        {filas && filas.length > 0 && (
          <>
            <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaHorasExtrasExcel(desde, hasta, diasSemana, turnos, cdGlobal, soloAutorizadas)}>
              Descargar Excel
            </a>
            <a className="btn" style={{ textDecoration: 'none' }} href={urlDescargaHorasExtrasPdf(desde, hasta, diasSemana, turnos, cdGlobal, soloAutorizadas)}>
              Descargar PDF
            </a>
          </>
        )}
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
          <button type="button" onClick={marcarTodos} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}>Marcar todos</button>
          <button type="button" onClick={marcarNinguno} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: '0.78rem' }}>Marcar ninguno</button>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <input type="checkbox" checked={soloAutorizadas} onChange={e => setSoloAutorizadas(e.target.checked)} />
          Mostrar solo horas extras autorizadas (aún sin flujo de aprobación — por ahora esto mostrará vacío)
        </label>
      </div>

      {cdGlobal && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          Filtrado por CD: <strong>{cdGlobal}</strong> (elegido en el encabezado)
        </p>
      )}

      {error && <p className="status-msg error">{error}</p>}

      {filas && (
        <>
          <p style={{ fontSize: '0.85rem', marginBottom: 10 }}>
            <strong>{filas.length}</strong> registro(s) — Total horas extras: <strong>{totalFormato}</strong>
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Día</th>
                  <th>RUT</th>
                  <th>Nombre</th>
                  <th>Cargo</th>
                  <th>Turno</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Horas Extras</th>
                  <th>Autorizado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f, i) => (
                  <tr key={`${f.rut}-${f.fecha}-${i}`}>
                    <td>{f.fecha}</td>
                    <td>{f.dia_semana}</td>
                    <td>{f.rut}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{f.nombre}</td>
                    <td style={{ fontFamily: 'var(--font-sans)' }}>{f.cargo}</td>
                    <td>{f.turno || '—'}</td>
                    <td>{f.entrada}</td>
                    <td>{f.salida}</td>
                    <td><strong>{f.horas_extras}</strong></td>
                    <td>
                      {f.autorizado === 'Sí' || f.autorizado === true
                        ? <span className="badge badge-ok">Sí</span>
                        : <span className="badge badge-muted">Pendiente</span>}
                    </td>
                  </tr>
                ))}
                {filas.length === 0 && (
                  <tr><td colSpan={10} className="empty-state">Sin horas extras para estos filtros en el período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}