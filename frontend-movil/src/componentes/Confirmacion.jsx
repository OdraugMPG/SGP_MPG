export default function Confirmacion({ marcacion, onVolver }) {
  return (
    <div className="pantalla">
      <div className="tarjeta" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem' }}>✓</div>
        <h1>Marcación registrada</h1>
        <p className="desc">
          {marcacion.tipo === 'entrada' ? 'Entrada' : 'Salida'} — {marcacion.fecha} a las {marcacion.hora}
        </p>
        <p className="desc">CD: {marcacion.cd} · a {Math.round(marcacion.distancia_m)}m del punto autorizado</p>
        <button className="btn-primario" type="button" onClick={onVolver}>Volver</button>
      </div>
    </div>
  );
}
