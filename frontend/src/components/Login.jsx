import { useState } from 'react';
import { iniciarSesion } from '../api';

export default function Login({ onIngreso }) {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!usuario || !password) return;
    setCargando(true);
    setError(null);
    try {
      const u = await iniciarSesion(usuario, password);
      onIngreso(u);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div style={estilos.pagina}>
      <div style={estilos.panelIzquierdo}>
        <div style={estilos.logoWrap}>
          <div style={estilos.logoTitulo}>SGP</div>
          <div style={estilos.logoSubtitulo}>
            SISTEMA GESTIÓN DE <span style={{ color: '#3fd68c' }}>PERSONAS</span>
          </div>
        </div>
        <p style={estilos.tagline}>
          Tecnología que <span style={{ color: '#5fb8f5' }}>impulsa</span> personas.<br />
          Personas que <span style={{ color: '#3fd68c' }}>transforman</span> organizaciones.
        </p>

        <div style={estilos.featuresGrid}>
          <div style={estilos.feature}>
            <strong>Gestión Centralizada</strong>
            <span>Toda la información en un solo lugar</span>
          </div>
          <div style={estilos.feature}>
            <strong>Seguridad</strong>
            <span>Protección de datos y acceso seguro</span>
          </div>
          <div style={estilos.feature}>
            <strong>Analítica</strong>
            <span>Datos que generan mejores decisiones</span>
          </div>
          <div style={estilos.feature}>
            <strong>Eficiencia</strong>
            <span>Procesos simples, resultados grandes</span>
          </div>
        </div>
      </div>

      <div style={estilos.panelDerecho}>
        <div style={estilos.card}>
          <h1 style={estilos.tituloCard}>
            Bienvenido a <span style={{ color: '#5fb8f5' }}>SGP</span>
          </h1>
          <p style={estilos.subtituloCard}>Ingresa tus credenciales para continuar</p>

          <form onSubmit={handleSubmit}>
            <div style={estilos.campo}>
              <input
                type="text"
                placeholder="Usuario"
                value={usuario}
                onChange={e => setUsuario(e.target.value)}
                style={estilos.input}
                autoComplete="username"
              />
            </div>
            <div style={{ ...estilos.campo, position: 'relative' }}>
              <input
                type={mostrarPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={estilos.input}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setMostrarPassword(v => !v)}
                style={estilos.togglePassword}
                tabIndex={-1}
              >
                {mostrarPassword ? '🙈' : '👁️'}
              </button>
            </div>

            <div style={estilos.filaOpciones}>
              <label style={estilos.checkboxLabel}>
                <input type="checkbox" checked={recordar} onChange={e => setRecordar(e.target.checked)} />
                Recordar sesión
              </label>
            </div>

            {error && <p style={estilos.error}>{error}</p>}

            <button type="submit" disabled={cargando} style={estilos.botonPrincipal}>
              {cargando ? 'Ingresando…' : 'Iniciar Sesión'}
            </button>
          </form>

          <div style={estilos.separador}>
            <span>o continúa con</span>
          </div>

          <button type="button" disabled style={estilos.botonMicrosoft} title="Próximamente">
            Iniciar sesión con Microsoft
          </button>

          <p style={estilos.footerNota}>🔒 Sistema seguro y certificado</p>
        </div>
      </div>
    </div>
  );
}

const estilos = {
  pagina: {
    display: 'flex',
    minHeight: '100vh',
    background: '#0a1224',
    color: '#e7ebf1',
    fontFamily: "'IBM Plex Sans', system-ui, sans-serif",
  },
  panelIzquierdo: {
    flex: '1.1',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '60px 70px',
    background: 'radial-gradient(circle at 30% 30%, #12244a 0%, #0a1224 70%)',
  },
  logoWrap: { marginBottom: 28 },
  logoTitulo: {
    fontSize: '4rem',
    fontWeight: 800,
    letterSpacing: '0.05em',
    lineHeight: 1,
  },
  logoSubtitulo: {
    fontSize: '0.95rem',
    letterSpacing: '0.15em',
    color: '#9aa7c2',
    marginTop: 6,
  },
  tagline: {
    fontSize: '1.15rem',
    color: '#c7d0e6',
    lineHeight: 1.6,
    marginBottom: 44,
  },
  featuresGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
    maxWidth: 480,
  },
  feature: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: '0.85rem',
    color: '#9aa7c2',
  },
  panelDerecho: {
    flex: '1',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0d1830',
    padding: 40,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    background: '#101c38',
    border: '1px solid #22345c',
    borderRadius: 16,
    padding: '40px 36px',
  },
  tituloCard: { fontSize: '1.6rem', fontWeight: 700, margin: '0 0 6px' },
  subtituloCard: { color: '#9aa7c2', fontSize: '0.88rem', marginBottom: 26 },
  campo: { marginBottom: 16 },
  input: {
    width: '100%',
    background: '#0d1830',
    border: '1px solid #22345c',
    borderRadius: 10,
    padding: '13px 16px',
    color: '#e7ebf1',
    fontSize: '0.9rem',
    boxSizing: 'border-box',
  },
  togglePassword: {
    position: 'absolute',
    right: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
  },
  filaOpciones: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    fontSize: '0.82rem',
    color: '#9aa7c2',
  },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 7 },
  error: { color: '#f27171', fontSize: '0.85rem', marginBottom: 14 },
  botonPrincipal: {
    width: '100%',
    padding: '14px',
    borderRadius: 10,
    border: 'none',
    background: 'linear-gradient(90deg, #2f7fe0, #3fd68c)',
    color: '#06101f',
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
  },
  separador: {
    textAlign: 'center',
    color: '#637090',
    fontSize: '0.78rem',
    margin: '22px 0',
  },
  botonMicrosoft: {
    width: '100%',
    padding: '12px',
    borderRadius: 10,
    border: '1px solid #22345c',
    background: 'transparent',
    color: '#637090',
    fontSize: '0.88rem',
    cursor: 'not-allowed',
  },
  footerNota: {
    textAlign: 'center',
    color: '#637090',
    fontSize: '0.78rem',
    marginTop: 24,
  },
};
