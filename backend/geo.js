const RADIO_TIERRA_M = 6371000;

function aRadianes(grados) {
  return (grados * Math.PI) / 180;
}

// Distancia en metros entre dos coordenadas (fórmula de Haversine). Usada
// para validar la geocerca de marcación móvil: el trabajador debe estar a
// menos de 'radio_metros' del punto configurado para su CD.
function calcularDistanciaMetros(lat1, lng1, lat2, lng2) {
  const dLat = aRadianes(lat2 - lat1);
  const dLng = aRadianes(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(aRadianes(lat1)) * Math.cos(aRadianes(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return RADIO_TIERRA_M * c;
}

module.exports = { calcularDistanciaMetros };
