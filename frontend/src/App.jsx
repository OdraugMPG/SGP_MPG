import { useState } from 'react';
import CargaArchivos from './components/CargaArchivos';
import TablaResultados from './components/TablaResultados';
import ReporteDiario from './components/ReporteDiario';
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
          className={`tab-btn ${tab === 'resultados' ? 'active' : ''}`}
          onClick={() => setTab('resultados')}
        >
          Resultados
        </button>
        <button
          className={`tab-btn ${tab === 'reporte' ? 'active' : ''}`}
          onClick={() => setTab('reporte')}
        >
          Reporte diario
        </button>
        <button
          className={`tab-btn ${tab === 'carga' ? 'active' : ''}`}
          onClick={() => setTab('carga')}
        >
          Cargar planillas
        </button>
      </nav>

      <main>
        {tab === 'carga' && (
          <CargaArchivos onImportado={() => { setRefrescarSenal(n => n + 1); setTab('resultados'); }} />
        )}
        {tab === 'resultados' && <TablaResultados refrescarSenal={refrescarSenal} />}
        {tab === 'reporte' && <ReporteDiario />}
      </main>
    </>
  );
}
