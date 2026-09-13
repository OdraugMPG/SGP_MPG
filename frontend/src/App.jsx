import { useState, useEffect, useCallback, useRef } from 'react';
import CargaArchivos from './components/CargaArchivos';
import ActualizacionDiaria from './components/ActualizacionDiaria';
import TablaResultados from './components/TablaResultados';
import ReporteDiario from './components/ReporteDiario';
import CierreNomina from './components/CierreNomina';
import ReporteHorasExtras from './components/ReporteHorasExtras';
import AutorizacionHorasExtras from './components/AutorizacionHorasExtras';
import AutorizacionHorasExtrasOrdinarias from './components/AutorizacionHorasExtrasOrdinarias';
import AsignacionJefeTurno from './components/AsignacionJefeTurno';
import PerfilTrabajador from './components/PerfilTrabajador';
import FueroMaternal from './components/FueroMaternal';
import Amonestaciones from './components/Amonestaciones';
import Feriados from './components/Feriados';
import AsignacionAusencias from './components/AsignacionAusencias';
import DashboardAsistencia from './components/DashboardAsistencia';
import DetalleMarcaciones from './components/DetalleMarcaciones';
import Login from './components/Login';
import GestionUsuarios from './components/GestionUsuarios';
import RequerimientoDotacion from './components/RequerimientoDotacion';
import MarcacionMovilAdmin from './components/MarcacionMovilAdmin';
import AnticiposSueldo from './components/AnticiposSueldo';
import { obtenerToken, obtenerUsuarioActual, cerrarSesion, obtenerMisModulos, listarCds } from './api';
import './index.css';

// Menú del header: "dashboard" queda suelto (es el más usado), el resto se
// agrupa en desplegables por relación funcional, para no repetir el scroll
// horizontal de 17 pestañas sueltas. 'horasExtrasOrdinarias' es un caso
// especial: no es un módulo real, se resuelve más abajo (tieneAccesoOrdinarias).
const GRUPOS_MENU = [
  { tipo: 'item', key: 'dashboard', label: 'Dashboard' },
  {
    tipo: 'grupo', id: 'asistencia', label: 'Asistencia',
    items: [
      { key: 'resultados', label: 'Resultados' },
      { key: 'detalle', label: 'Detalle Marcaciones' },
      { key: 'reporte', label: 'Reporte diario' },
      { key: 'actualizacion', label: 'Actualización diaria' },
      { key: 'carga', label: 'Cargar planillas (5)' },
    ],
  },
  {
    tipo: 'grupo', id: 'nomina', label: 'Nómina',
    items: [
      { key: 'nomina', label: 'Cierre de Nómina' },
      { key: 'horasExtras', label: 'Horas Extras' },
      { key: 'horasExtrasOrdinarias', label: 'Aprobación Horas Extras' },
      { key: 'anticipos', label: 'Anticipos de Sueldo' },
    ],
  },
  {
    tipo: 'grupo', id: 'personas', label: 'Personas',
    items: [
      { key: 'perfiles', label: 'Perfiles / Áreas' },
      { key: 'ausencias', label: 'Ausencias / Permisos' },
      { key: 'fueroMaternal', label: 'Fuero Maternal' },
      { key: 'amonestaciones', label: 'Amonestaciones' },
      { key: 'asignacion', label: 'Jefe de Turno' },
      { key: 'requerimiento', label: 'Requerimiento Dotación' },
    ],
  },
  {
    tipo: 'grupo', id: 'configuracion', label: 'Configuración',
    items: [
      { key: 'feriados', label: 'Feriados' },
      { key: 'usuarios', label: 'Usuarios' },
      { key: 'marcacionMovil', label: 'Marcación Móvil (Piloto)' },
    ],
  },
];

export default function App() {
  const [tab, setTab] = useState(null);
  const [refrescarSenal, setRefrescarSenal] = useState(0);
  const [usuario, setUsuario] = useState(() => (obtenerToken() ? obtenerUsuarioActual() : null));
  const [modulosHabilitados, setModulosHabilitados] = useState(null); // null = cargando
  const [cdGlobal, setCdGlobal] = useState('');
  const [cdsDisponibles, setCdsDisponibles] = useState([]);
  const [grupoAbierto, setGrupoAbierto] = useState(null);
  const navRef = useRef(null);

  useEffect(() => {
    if (!usuario) return;
    listarCds().then(setCdsDisponibles).catch(() => {});
  }, [usuario]);

  // Cierra el desplegable abierto si se hace clic fuera del menú.
  useEffect(() => {
    if (!grupoAbierto) return;
    function alHacerClicFuera(e) {
      if (navRef.current && !navRef.current.contains(e.target)) setGrupoAbierto(null);
    }
    document.addEventListener('mousedown', alHacerClicFuera);
    return () => document.removeEventListener('mousedown', alHacerClicFuera);
  }, [grupoAbierto]);

  const handleSesionInvalida = useCallback(() => {
    setUsuario(null);
  }, []);

  useEffect(() => {
    window.addEventListener('sgp:sesion-invalida', handleSesionInvalida);
    return () => window.removeEventListener('sgp:sesion-invalida', handleSesionInvalida);
  }, [handleSesionInvalida]);

  useEffect(() => {
    if (!usuario) { setModulosHabilitados(null); return; }
    obtenerMisModulos()
      .then(modulos => {
        setModulosHabilitados(modulos);
        if (modulos.length > 0) setTab(modulos.includes('dashboard') ? 'dashboard' : modulos[0]);
      })
      .catch(() => setModulosHabilitados([]));
  }, [usuario]);

  function handleLogout() {
    cerrarSesion();
    setUsuario(null);
  }

  if (!usuario) {
    return <Login onIngreso={setUsuario} />;
  }

  if (modulosHabilitados === null) {
    return (
      <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
        Cargando…
      </div>
    );
  }

  // "Aprobación Horas Extras" no es un módulo real por sí mismo: se ve si el
  // usuario puede solicitar O aprobar horas extras ordinarias (no hace falta
  // el módulo 'horasExtras' completo, para que Jefe de Turno/Jefe de
  // Operaciones puedan tener solo este acceso puntual).
  const tieneAccesoOrdinarias = modulosHabilitados.includes('horasExtrasSolicitar') || modulosHabilitados.includes('horasExtrasAprobar');
  function tieneAccesoA(key) {
    return key === 'horasExtrasOrdinarias' ? tieneAccesoOrdinarias : modulosHabilitados.includes(key);
  }
  // Lista plana de todo lo que el usuario puede ver, sin importar si está
  // suelto o dentro de un grupo — solo para saber si mostrar el estado
  // "sin módulos habilitados".
  const todoLoVisible = GRUPOS_MENU.flatMap(g => g.tipo === 'item' ? [g] : g.items).filter(i => tieneAccesoA(i.key));

  return (
    <>
      <header className="app-header">
        <h1>SGP · Control de Asistencia</h1>
        <span className="subtitle">Talana / Cencosud — atrasos y horas trabajadas</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {cdsDisponibles.length > 0 && (
            <select
              value={cdGlobal} onChange={e => setCdGlobal(e.target.value)}
              title="Filtrar todo el sistema por Centro de Distribución"
              style={{
                background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 8,
                padding: '6px 10px', color: 'var(--text)', fontSize: '0.82rem',
              }}
            >
              <option value="">Todos los CD (consolidado)</option>
              {cdsDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {usuario.nombre || usuario.usuario} <span className="badge badge-muted" style={{ marginLeft: 6 }}>{usuario.rol}</span>
          </span>
          <button
            type="button"
            onClick={handleLogout}
            style={{
              background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
              borderRadius: 8, padding: '6px 12px', fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </header>

      {todoLoVisible.length === 0 ? (
        <main>
          <div className="card">
            <h2>Sin módulos habilitados</h2>
            <p className="card-desc">
              Tu rol ("{usuario.rol}") todavía no tiene ningún módulo habilitado. Pide a un
              administrador que te asigne acceso desde "Usuarios".
            </p>
          </div>
        </main>
      ) : (
        <>
          <nav className="tabs" ref={navRef}>
            {GRUPOS_MENU.map(entrada => {
              if (entrada.tipo === 'item') {
                if (!tieneAccesoA(entrada.key)) return null;
                return (
                  <button
                    key={entrada.key}
                    className={`tab-btn ${tab === entrada.key ? 'active' : ''}`}
                    onClick={() => { setTab(entrada.key); setGrupoAbierto(null); }}
                  >
                    {entrada.label}
                  </button>
                );
              }

              const itemsVisibles = entrada.items.filter(i => tieneAccesoA(i.key));
              if (itemsVisibles.length === 0) return null;
              const grupoActivo = itemsVisibles.some(i => i.key === tab);
              return (
                <div key={entrada.id} className="tab-dropdown">
                  <button
                    type="button"
                    className={`tab-btn ${grupoActivo ? 'active' : ''}`}
                    onClick={() => setGrupoAbierto(g => (g === entrada.id ? null : entrada.id))}
                  >
                    {entrada.label} <span className="tab-dropdown-caret">▾</span>
                  </button>
                  {grupoAbierto === entrada.id && (
                    <div className="tab-dropdown-menu">
                      {itemsVisibles.map(i => (
                        <button
                          key={i.key}
                          type="button"
                          className={`tab-dropdown-item ${tab === i.key ? 'active' : ''}`}
                          onClick={() => { setTab(i.key); setGrupoAbierto(null); }}
                        >
                          {i.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <main>
            {modulosHabilitados.includes('dashboard') && (
              <div style={{ display: tab === 'dashboard' ? 'block' : 'none' }}>
                <DashboardAsistencia cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('resultados') && (
              <div style={{ display: tab === 'resultados' ? 'block' : 'none' }}>
                <TablaResultados refrescarSenal={refrescarSenal} cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('detalle') && (
              <div style={{ display: tab === 'detalle' ? 'block' : 'none' }}>
                <DetalleMarcaciones cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('reporte') && (
              <div style={{ display: tab === 'reporte' ? 'block' : 'none' }}>
                <ReporteDiario cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('nomina') && (
              <div style={{ display: tab === 'nomina' ? 'block' : 'none' }}>
                <CierreNomina cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('horasExtras') && (
              <div style={{ display: tab === 'horasExtras' ? 'block' : 'none' }}>
                <AutorizacionHorasExtras cdGlobal={cdGlobal} />
                <div style={{ marginTop: 20 }}>
                  <ReporteHorasExtras cdGlobal={cdGlobal} />
                </div>
              </div>
            )}
            {tieneAccesoOrdinarias && (
              <div style={{ display: tab === 'horasExtrasOrdinarias' ? 'block' : 'none' }}>
                <AutorizacionHorasExtrasOrdinarias
                  cdGlobal={cdGlobal}
                  puedeSolicitar={modulosHabilitados.includes('horasExtrasSolicitar')}
                  puedeAprobar={modulosHabilitados.includes('horasExtrasAprobar')}
                />
              </div>
            )}
            {modulosHabilitados.includes('asignacion') && (
              <div style={{ display: tab === 'asignacion' ? 'block' : 'none' }}>
                <AsignacionJefeTurno cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('perfiles') && (
              <div style={{ display: tab === 'perfiles' ? 'block' : 'none' }}>
                <PerfilTrabajador cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('fueroMaternal') && (
              <div style={{ display: tab === 'fueroMaternal' ? 'block' : 'none' }}>
                <FueroMaternal />
              </div>
            )}
            {modulosHabilitados.includes('amonestaciones') && (
              <div style={{ display: tab === 'amonestaciones' ? 'block' : 'none' }}>
                <Amonestaciones />
              </div>
            )}
            {modulosHabilitados.includes('feriados') && (
              <div style={{ display: tab === 'feriados' ? 'block' : 'none' }}>
                <Feriados />
              </div>
            )}
            {modulosHabilitados.includes('requerimiento') && (
              <div style={{ display: tab === 'requerimiento' ? 'block' : 'none' }}>
                <RequerimientoDotacion />
              </div>
            )}
            {modulosHabilitados.includes('ausencias') && (
              <div style={{ display: tab === 'ausencias' ? 'block' : 'none' }}>
                <AsignacionAusencias cdGlobal={cdGlobal} />
              </div>
            )}
            {modulosHabilitados.includes('actualizacion') && (
              <div style={{ display: tab === 'actualizacion' ? 'block' : 'none' }}>
                <ActualizacionDiaria onActualizado={() => setRefrescarSenal(n => n + 1)} />
              </div>
            )}
            {modulosHabilitados.includes('carga') && (
              <div style={{ display: tab === 'carga' ? 'block' : 'none' }}>
                <CargaArchivos onImportado={() => { setRefrescarSenal(n => n + 1); setTab('resultados'); }} />
              </div>
            )}
            {modulosHabilitados.includes('usuarios') && (
              <div style={{ display: tab === 'usuarios' ? 'block' : 'none' }}>
                <GestionUsuarios usuarioActual={usuario} />
              </div>
            )}
            {modulosHabilitados.includes('marcacionMovil') && (
              <div style={{ display: tab === 'marcacionMovil' ? 'block' : 'none' }}>
                <MarcacionMovilAdmin />
              </div>
            )}
            {modulosHabilitados.includes('anticipos') && (
              <div style={{ display: tab === 'anticipos' ? 'block' : 'none' }}>
                <AnticiposSueldo />
              </div>
            )}
          </main>
        </>
      )}

      <footer className="app-footer">
        © {new Date().getFullYear()} SGP · Sistema Gestión de Personas. Todos los derechos reservados.
      </footer>
    </>
  );
}