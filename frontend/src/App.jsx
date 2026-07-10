import { useState, useEffect, useCallback } from 'react';
import CargaArchivos from './components/CargaArchivos';
import ActualizacionDiaria from './components/ActualizacionDiaria';
import TablaResultados from './components/TablaResultados';
import ReporteDiario from './components/ReporteDiario';
import AsignacionJefeTurno from './components/AsignacionJefeTurno';
import PerfilTrabajador from './components/PerfilTrabajador';
import AsignacionAusencias from './components/AsignacionAusencias';
import DashboardAsistencia from './components/DashboardAsistencia';
import DetalleMarcaciones from './components/DetalleMarcaciones';
import Login from './components/Login';
import { obtenerToken, obtenerUsuarioActual, cerrarSesion } from './api';
import './index.css';

export default function App() {
  const [tab, setTab] = useState('resultados');
  const [refrescarSenal, setRefrescarSenal] = useState(0);
  const [usuario, setUsuario] = useState(() => (obtenerToken() ? obtenerUsuarioActual() : null));

  const handleSesionInvalida = useCallback(() => {
    setUsuario(null);
  }, []);

  useEffect(() => {
    window.addEventListener('sgp:sesion-invalida', handleSesionInvalida);
    return () => window.removeEventListener('sgp:sesion-invalida', handleSesionInvalida);
  }, [handleSesionInvalida]);

  function handleLogout() {
    cerrarSesion();
    setUsuario(null);
  }

  if (!usuario) {
    return <Login onIngreso={setUsuario} />;
  }

  return (
    <>
      <header className="app-header">
        <h1>SGP · Control de Asistencia</h1>
        <span className="subtitle">Talana / Cencosud — atrasos y horas trabajadas</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{usuario.nombre || usuario.usuario}</span>
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

      <nav className="tabs">
        <button
          className={`tab-btn ${tab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setTab('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`tab-btn ${tab === 'resultados' ? 'active' : ''}`}
          onClick={() => setTab('resultados')}
        >
          Resultados
        </button>
        <button
          className={`tab-btn ${tab === 'detalle' ? 'active' : ''}`}
          onClick={() => setTab('detalle')}
        >
          Detalle Marcaciones
        </button>
        <button
          className={`tab-btn ${tab === 'reporte' ? 'active' : ''}`}
          onClick={() => setTab('reporte')}
        >
          Reporte diario
        </button>
        <button
          className={`tab-btn ${tab === 'asignacion' ? 'active' : ''}`}
          onClick={() => setTab('asignacion')}
        >
          Jefe de Turno
        </button>
        <button
          className={`tab-btn ${tab === 'perfiles' ? 'active' : ''}`}
          onClick={() => setTab('perfiles')}
        >
          Perfiles / Áreas
        </button>
        <button
          className={`tab-btn ${tab === 'ausencias' ? 'active' : ''}`}
          onClick={() => setTab('ausencias')}
        >
          Ausencias / Permisos
        </button>
        <button
          className={`tab-btn ${tab === 'actualizacion' ? 'active' : ''}`}
          onClick={() => setTab('actualizacion')}
        >
          Actualización diaria
        </button>
        <button
          className={`tab-btn ${tab === 'carga' ? 'active' : ''}`}
          onClick={() => setTab('carga')}
        >
          Cargar planillas (5)
        </button>
      </nav>

      <main>
        {tab === 'carga' && (
          <CargaArchivos onImportado={() => { setRefrescarSenal(n => n + 1); setTab('resultados'); }} />
        )}
        {tab === 'actualizacion' && <ActualizacionDiaria onActualizado={() => setRefrescarSenal(n => n + 1)} />}
        {tab === 'dashboard' && <DashboardAsistencia />}
        {tab === 'resultados' && <TablaResultados refrescarSenal={refrescarSenal} />}
        {tab === 'detalle' && <DetalleMarcaciones />}
        {tab === 'reporte' && <ReporteDiario />}
        {tab === 'asignacion' && <AsignacionJefeTurno />}
        {tab === 'perfiles' && <PerfilTrabajador />}
        {tab === 'ausencias' && <AsignacionAusencias />}
      </main>
    </>
  );
}
