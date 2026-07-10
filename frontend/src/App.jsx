import { useState } from 'react';
import CargaArchivos from './components/CargaArchivos';
import ActualizacionDiaria from './components/ActualizacionDiaria';
import TablaResultados from './components/TablaResultados';
import ReporteDiario from './components/ReporteDiario';
import AsignacionJefeTurno from './components/AsignacionJefeTurno';
import PerfilTrabajador from './components/PerfilTrabajador';
import AsignacionAusencias from './components/AsignacionAusencias';
import DashboardAsistencia from './components/DashboardAsistencia';
import DetalleMarcaciones from './components/DetalleMarcaciones';
import './index.css';

export default function App() {
  const [tab, setTab] = useState('resultados');
  const [refrescarSenal, setRefrescarSenal] = useState(0);

  return (
    <>
      <header className="app-header">
        <h1>SGP · Control de Asistencia</h1>
        <span className="subtitle">Talana / Cencosud — atrasos y horas trabajadas</span>
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
