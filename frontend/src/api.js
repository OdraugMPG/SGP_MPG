const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function importarArchivos(files) {
  const formData = new FormData();
  Object.entries(files).forEach(([campo, file]) => {
    if (file) formData.append(campo, file);
  });

  const res = await fetch(`${API_URL}/api/importar`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Error al importar los archivos');
  }
  return data.resumen;
}

export async function obtenerResultados(filtros) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => {
    if (v) params.append(k, v);
  });
  const res = await fetch(`${API_URL}/api/resultados?${params.toString()}`);
  if (!res.ok) throw new Error('Error al consultar resultados');
  return res.json();
}

export async function obtenerReporteDiario(fecha) {
  const res = await fetch(`${API_URL}/api/reporte-diario?fecha=${fecha}`);
  if (!res.ok) throw new Error('Error al consultar el reporte diario');
  return res.json();
}

export function urlDescargaReporteDiario(fecha) {
  return `${API_URL}/api/reporte-diario/export?fecha=${fecha}`;
}