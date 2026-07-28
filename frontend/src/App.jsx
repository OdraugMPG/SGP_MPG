import { useState, useEffect, useCallback } from 'react';
import CargaArchivos from './components/CargaArchivos';
import ActualizacionDiaria from './components/ActualizacionDiaria';
import TablaResultados from './components/TablaResultados';
import ReporteDiario from './components/ReporteDiario';
import CierreNomina from './components/CierreNomina';
import AsignacionJefeTurno from './components/AsignacionJefeTurno';
import PerfilTrabajador from './components/PerfilTrabajador';
import AsignacionAusencias from './components/AsignacionAusencias';
import DashboardAsistencia from './components/DashboardAsistencia';
import DetalleMarcaciones from './components/DetalleMarcaciones';
import Login from './components/Login';
import GestionUsuarios from './components/GestionUsuarios';
import RequerimientoDotacion from './components/RequerimientoDotacion';
import { obtenerToken, obtenerUsuarioActual, cerrarSesion, obtenerMisModulos, listarCds } from './api';
import './index.css';

const TODAS_LAS_PESTANAS = [
  { key: 'dashboard', label: 'Dashboard', componente: () => <DashboardAsistencia /> },
  { key: 'resultados', label: 'Resultados' },
  { key: 'detalle', label: 'Detalle Marcaciones' },
  { key: 'reporte', label: 'Reporte diario' },
  { key: 'nomina', label: 'Cierre de Nómina' },
  { key: 'asignacion', label: 'Jefe de Turno' },
  { key: 'perfiles', label: 'Perfiles / Áreas' },
  { key: 'requerimiento', label: 'Requerimiento Dotación' },
  { key: 'ausencias', label: 'Ausencias / Permisos' },
  { key: 'actualizacion', label: 'Actualización diaria' },
  { key: 'carga', label: 'Cargar planillas (5)' },
  { key: 'usuarios', label: 'Usuarios' },
];

export default function App() {
  const [tab, setTab] = useState(null);
  const [refrescarSenal, setRefrescarSenal] = useState(0);
  const [usuario, setUsuario] = useState(() => (obtenerToken() ? obtenerUsuarioActual() : null));
  const [modulosHabilitados, setModulosHabilitados] = useState(null); // null = cargando
  const [cdGlobal, setCdGlobal] = useState('');
  const [cdsDisponibles, setCdsDisponibles] = useState([]);

  useEffect(() => {
    if (!usuario) return;
    listarCds().then(setCdsDisponibles).catch(() => {});
  }, [usuario]);

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

  const pestanas = TODAS_LAS_PESTANAS.filter(p => modulosHabilitados.includes(p.key));

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

      {pestanas.length === 0 ? (
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
          <nav className="tabs">
            {pestanas.map(p => (
              <button
                key={p.key}
                className={`tab-btn ${tab === p.key ? 'active' : ''}`}
                onClick={() => setTab(p.key)}
              >
                {p.label}
              </button>
            ))}
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
          </main>
        </>
      )}

      <footer className="app-footer">
        © {new Date().getFullYear()} SGP · Sistema Gestión de Personas. Todos los derechos reservados.
      </footer>
    </>
  );
}
