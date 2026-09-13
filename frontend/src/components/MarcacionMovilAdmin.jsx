import { useState, useEffect, useCallback } from 'react';
import {
  listarCdsMovil, crearCdMovil, actualizarCdMovil, eliminarCdMovil,
  listarTrabajadoresMovil, asignarPinTrabajador, obtenerReporteMovil, urlFotoMarcacionMovil,
  buscarEmpleados,
} from '../api';

function PanelCds() {
  const [cds, setCds] = useState([]);
  const [nombre, setNombre] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [radio, setRadio] = useState(40);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  const cargar = useCallback(async () => {
    try {
      setCds(await listarCdsMovil());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function guardar(e) {
    e.preventDefault();
    if (!nombre.trim() || lat === '' || lng === '') { setError('Nombre, latitud y longitud son obligatorios.'); return; }
    setGuardando(true);
    setError(null);
    setMensajeOk(null);
    try {
      await crearCdMovil({ nombre: nombre.trim(), lat: Number(lat), lng: Number(lng), radio_metros: Number(radio) || 40 });
      setMensajeOk(`✓ CD "${nombre}" guardado.`);
      setNombre(''); setLat(''); setLng(''); setRadio(40);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarRadio(cd, nuevoRadio) {
    try {
      await actualizarCdMovil(cd.nombre, { radio_metros: Number(nuevoRadio) });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cambiarActivo(cd, activo) {
    try {
      await actualizarCdMovil(cd.nombre, { activo });
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  async function eliminar(nombreCd) {
    if (!confirm(`¿Eliminar el CD "${nombreCd}" de marcación móvil? Los trabajadores asignados a ese CD no van a poder marcar hasta que se cree de nuevo.`)) return;
    try {
      await eliminarCdMovil(nombreCd);
      cargar();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>CDs habilitados para marcación móvil</h2>
      <p className="card-desc">
        El nombre debe coincidir exactamente con el CD del trabajador (columna "cd" en Perfiles). El
        radio es la distancia máxima en metros a la que se permite marcar — la precisión típica de un
        GPS de celular ronda los 5-20m a cielo abierto (peor cerca de galpones), así que 10m suele ser
        demasiado estricto; 30-50m es un punto de partida más realista para ajustar según lo que se
        observe en terreno.
      </p>

      <form onSubmit={guardar} className="field-grid" style={{ marginBottom: 10 }}>
        <div className="field">
          <label>Nombre del CD</label>
          <input type="text" value={nombre} onChange={e => setNombre(e.target.value)} className="file-input" placeholder="Ej: MC CD SAN IGNACIO" />
        </div>
        <div className="field">
          <label>Latitud</label>
          <input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} className="file-input" placeholder="-33.4500" />
        </div>
        <div className="field">
          <label>Longitud</label>
          <input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} className="file-input" placeholder="-70.6500" />
        </div>
        <div className="field">
          <label>Radio (metros)</label>
          <input type="number" value={radio} onChange={e => setRadio(e.target.value)} className="file-input" style={{ width: 100 }} />
        </div>
      </form>
      <button className="btn" type="button" onClick={guardar} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Guardar CD'}
      </button>

      {error && <p className="status-msg error">{error}</p>}
      {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

      <div className="table-scroll" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr><th>CD</th><th>Lat</th><th>Lng</th><th>Radio (m)</th><th>Activo</th><th></th></tr>
          </thead>
          <tbody>
            {cds.map(cd => (
              <tr key={cd.nombre}>
                <td>{cd.nombre}</td>
                <td>{cd.lat}</td>
                <td>{cd.lng}</td>
                <td>
                  <input
                    type="number" defaultValue={cd.radio_metros}
                    onBlur={e => { if (Number(e.target.value) !== cd.radio_metros) cambiarRadio(cd, e.target.value); }}
                    style={{ width: 70, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 7px', color: 'var(--text)' }}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={cd.activo} onChange={e => cambiarActivo(cd, e.target.checked)} />
                </td>
                <td>
                  <button
                    type="button" onClick={() => eliminar(cd.nombre)}
                    style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '0.78rem' }}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
            {cds.length === 0 && <tr><td colSpan={6} className="empty-state">Sin CDs habilitados todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PanelPines() {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState([]);
  const [trabajadoresConPin, setTrabajadoresConPin] = useState([]);
  const [pinPorRut, setPinPorRut] = useState({});
  const [error, setError] = useState(null);
  const [mensajeOk, setMensajeOk] = useState(null);

  const cargarConPin = useCallback(async () => {
    try {
      setTrabajadoresConPin(await listarTrabajadoresMovil());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { cargarConPin(); }, [cargarConPin]);

  async function buscar() {
    if (!query.trim()) { setResultados([]); return; }
    try {
      setResultados(await buscarEmpleados(query.trim()));
    } catch (err) {
      setError(err.message);
    }
  }

  async function asignar(rut) {
    const pin = pinPorRut[rut];
    if (!pin || pin.length < 4) { setError('El PIN debe tener al menos 4 dígitos.'); return; }
    setError(null);
    setMensajeOk(null);
    try {
      await asignarPinTrabajador(rut, pin);
      setMensajeOk(`✓ PIN asignado a ${rut}.`);
      setPinPorRut(prev => ({ ...prev, [rut]: '' }));
      cargarConPin();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h2>Asignar PIN de marcación móvil</h2>
      <p className="card-desc">
        El trabajador usa su RUT + este PIN para entrar a la app de marcación desde su celular. Puede
        cambiarlo después desde ahí; acá se asigna el primero o se resetea si lo olvidó.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Buscar trabajador (nombre o RUT)</label>
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') buscar(); }}
            className="file-input"
          />
        </div>
        <button className="btn" type="button" onClick={buscar}>Buscar</button>
      </div>

      {error && <p className="status-msg error">{error}</p>}
      {mensajeOk && <p className="status-msg ok">{mensajeOk}</p>}

      {resultados.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>RUT</th><th>Nombre</th><th>CD</th><th>PIN nuevo</th><th></th></tr></thead>
            <tbody>
              {resultados.map(e => (
                <tr key={e.rut}>
                  <td>{e.rut}</td>
                  <td>{e.nombre} {e.apellido_paterno}</td>
                  <td>{e.cd || '—'}</td>
                  <td>
                    <input
                      type="text" inputMode="numeric" maxLength={6}
                      value={pinPorRut[e.rut] || ''}
                      onChange={ev => setPinPorRut(prev => ({ ...prev, [e.rut]: ev.target.value.replace(/\D/g, '') }))}
                      style={{ width: 80, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 7px', color: 'var(--text)' }}
                    />
                  </td>
                  <td>
                    <button className="btn" type="button" onClick={() => asignar(e.rut)}>Asignar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 20, fontSize: '0.95rem' }}>Trabajadores con PIN asignado</h3>
      <div className="table-scroll">
        <table>
          <thead><tr><th>RUT</th><th>Nombre</th><th>CD</th><th>Estado</th></tr></thead>
          <tbody>
            {trabajadoresConPin.map(t => (
              <tr key={t.rut}>
                <td>{t.rut}</td>
                <td>{t.nombre} {t.apellido_paterno}</td>
                <td>{t.cd || '—'}</td>
                <td>
                  {t.bloqueado_hasta && new Date(t.bloqueado_hasta) > new Date()
                    ? <span className="badge badge-warn">Bloqueado</span>
                    : <span className="badge badge-ok">Activo</span>}
                </td>
              </tr>
            ))}
            {trabajadoresConPin.length === 0 && <tr><td colSpan={4} className="empty-state">Nadie tiene PIN asignado todavía.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function PanelReporte() {
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const [soloFueraRadio, setSoloFueraRadio] = useState(false);
  const [filas, setFilas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  async function consultar() {
    setCargando(true);
    setError(null);
    try {
      setFilas(await obtenerReporteMovil({ desde, hasta, soloFueraRadio: soloFueraRadio ? 'true' : '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => { consultar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="card">
      <h2>Reporte del piloto (para revisión de RRHH)</h2>
      <p className="card-desc">
        Marcaciones registradas desde el celular en el período. Esto es informativo — no está integrado
        al cálculo de horas/atrasos/nómina; sirve para comparar manualmente contra Talana durante el piloto.
      </p>

      <div className="filters-row">
        <div className="field">
          <label>Desde</label>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="file-input" />
        </div>
        <div className="field">
          <label>Hasta</label>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="file-input" />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloFueraRadio} onChange={e => setSoloFueraRadio(e.target.checked)} />
          Solo fuera de radio
        </label>
        <button className="btn" type="button" onClick={consultar} disabled={cargando}>
          {cargando ? 'Consultando…' : 'Consultar'}
        </button>
      </div>

      {error && <p className="status-msg error">{error}</p>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr><th>Fecha</th><th>Hora</th><th>RUT</th><th>Nombre</th><th>CD</th><th>Tipo</th><th>Distancia</th><th>Foto</th></tr>
          </thead>
          <tbody>
            {filas.map(f => (
              <tr key={f.id}>
                <td>{f.fecha}</td>
                <td>{f.hora}</td>
                <td>{f.rut}</td>
                <td>{f.nombre || '—'}</td>
                <td>{f.cd || '—'}</td>
                <td>{f.tipo}</td>
                <td>
                  {f.distancia_m != null ? `${Math.round(f.distancia_m)}m` : '—'}{' '}
                  {f.dentro_radio ? <span className="badge badge-ok">OK</span> : <span className="badge badge-warn">Fuera</span>}
                </td>
                <td>
                  {f.tiene_foto
                    ? <a href={urlFotoMarcacionMovil(f.id)} target="_blank" rel="noreferrer">Ver</a>
                    : '—'}
                </td>
              </tr>
            ))}
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={8} className="empty-state">Sin marcaciones móviles en este período.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MarcacionMovilAdmin() {
  return (
    <div>
      <PanelCds />
      <PanelPines />
      <PanelReporte />
    </div>
  );
}
