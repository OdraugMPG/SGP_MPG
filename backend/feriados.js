// Consulta la API pública de feriados de Chile (api.boostr.cl, gratuita, sin
// llave). Devuelve la lista SIN guardar nada — el llamador decide si
// confirma o no (para poder revisar/editar antes de guardar en la base).
async function obtenerFeriadosDesdeApi(anio) {
  const resp = await fetch(`https://api.boostr.cl/holidays/${anio}.json`);
  if (!resp.ok) throw new Error(`La API de feriados respondió con error (${resp.status})`);
  const json = await resp.json();

  // La respuesta puede venir como array de objetos, o como objeto
  // keyed por fecha — se maneja ambos casos por robustez ante cambios
  // menores de formato de la API.
  const lista = Array.isArray(json?.data) ? json.data
    : json?.data && typeof json.data === 'object' ? Object.entries(json.data).map(([fecha, v]) => ({ date: fecha, ...v }))
    : Array.isArray(json) ? json
    : [];

  const feriados = lista.map(f => ({
    fecha: f.date || f.fecha,
    nombre: f.title || f.nombre || f.name || 'Feriado',
    irrenunciable: f.inalienable ?? f.irrenunciable ?? false,
  })).filter(f => f.fecha && /^\d{4}-\d{2}-\d{2}$/.test(f.fecha));

  if (feriados.length === 0) throw new Error('La API no devolvió feriados para ese año (puede estar caída) — puedes registrarlos manualmente.');
  return feriados;
}

module.exports = { obtenerFeriadosDesdeApi };