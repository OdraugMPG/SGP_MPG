import { useState } from 'react';
import { obtenerToken, obtenerTrabajadorActual, cerrarSesion } from './api-movil';
import LoginTrabajador from './componentes/LoginTrabajador';
import MarcarAsistencia from './componentes/MarcarAsistencia';
import Confirmacion from './componentes/Confirmacion';
import CambiarPin from './componentes/CambiarPin';

// Sin router: la app tiene 4 pantallas posibles y se navega con un switch
// simple por estado — no hay URLs profundas que valga la pena bookmarkear
// en un flujo de "marcar y listo".
export default function App() {
  const [trabajador, setTrabajador] = useState(() => (obtenerToken() ? obtenerTrabajadorActual() : null));
  const [pantalla, setPantalla] = useState('marcar'); // 'marcar' | 'confirmacion' | 'pin'
  const [ultimaMarcacion, setUltimaMarcacion] = useState(null);

  function alIngresar(t) {
    setTrabajador(t);
    setPantalla('marcar');
  }

  function alCerrarSesion() {
    cerrarSesion();
    setTrabajador(null);
  }

  if (!trabajador) {
    return <LoginTrabajador onIngreso={alIngresar} />;
  }

  if (pantalla === 'confirmacion') {
    return <Confirmacion marcacion={ultimaMarcacion} onVolver={() => setPantalla('marcar')} />;
  }

  if (pantalla === 'pin') {
    return <CambiarPin onVolver={() => setPantalla('marcar')} />;
  }

  return (
    <MarcarAsistencia
      trabajador={trabajador}
      onMarcado={m => { setUltimaMarcacion(m); setPantalla('confirmacion'); }}
      onIrAPin={() => setPantalla('pin')}
      onCerrarSesion={alCerrarSesion}
    />
  );
}
