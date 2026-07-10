const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const TOKEN_KEY = 'sgp_token';
const USUARIO_KEY = 'sgp_usuario';

export function obtenerToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function obtenerUsuarioActual() {
  const raw = localStorage.getItem(USUARIO_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function cerrarSesion() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USUARIO_KEY);
}

// Se avisa a App.jsx cuando el token deja de ser válido (401), para mostrar
// el login de nuevo sin que cada componente tenga que manejarlo por su cuenta.
function notificarSesionInvalida() {
  window.dispatchEvent(new CustomEvent('sgp:sesion-invalida'));
}

// Wrapper de fetch que agrega el token automáticamente y detecta sesión expirada.
async function authFetch(url, options = {}) {
  const token = obtenerToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    cerrarSesion();
    notificarSesionInvalida();
  }
  return res;
}

// --- Autenticación ---

export async function iniciarSesion(usuario, password) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario, password }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo iniciar sesión');

  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USUARIO_KEY, JSON.stringify(data.usuario));
  return data.usuario;
}

// --- Carga de archivos ---

export async function importarArchivos(files) {
  const formData = new FormData();
  Object.entries(files).forEach(([campo, file]) => {
    if (file) formData.append(campo, file);
  });

  const res = await authFetch(`${API_URL}/api/importar`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Error al importar los archivos');
  }
  return data.resumen;
}

// Igual que importarArchivos, pero reporta el progreso de la SUBIDA (0-100%).
export function importarArchivosConProgreso(files, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    Object.entries(files).forEach(([campo, file]) => {
      if (file) formData.append(campo, file);
    });

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/importar`);
    const token = obtenerToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) { cerrarSesion(); notificarSesionInvalida(); }
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error('Respuesta inválida del servidor'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
        resolve(data.resumen);
      } else {
        reject(new Error(data.error || 'Error al importar los archivos'));
      }
    };

    xhr.onerror = () => reject(new Error('Error de red al subir los archivos'));

    xhr.send(formData);
  });
}

export async function obtenerResultados(filtros) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => {
    if (v) params.append(k, v);
  });
  const res = await authFetch(`${API_URL}/api/resultados?${params.toString()}`);
  if (!res.ok) throw new Error('Error al consultar resultados');
  return res.json();
}

export async function obtenerReporteDiario(fecha) {
  const res = await authFetch(`${API_URL}/api/reporte-diario?fecha=${fecha}`);
  if (!res.ok) throw new Error('Error al consultar el reporte diario');
  return res.json();
}

// La descarga del Excel es un link directo (<a href>), así que el token va
// como query param en vez de header (no se puede setear header en una navegación).
export function urlDescargaReporteDiario(fecha) {
  const token = obtenerToken();
  return `${API_URL}/api/reporte-diario/export?fecha=${fecha}&token=${encodeURIComponent(token || '')}`;
}

export async function obtenerLogMarcacion(fecha) {
  const res = await authFetch(`${API_URL}/api/reporte-diario/log?fecha=${fecha}`);
  if (!res.ok) throw new Error('Error al consultar el log de errores');
  return res.json();
}

export async function obtenerDetalleMarcaciones(filtros) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => { if (v) params.append(k, v); });
  const res = await authFetch(`${API_URL}/api/detalle-marcaciones?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al obtener el detalle de marcaciones');
  return data;
}

export function urlDescargaDetalleMarcaciones(filtros) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => { if (v) params.append(k, v); });
  params.append('token', obtenerToken() || '');
  return `${API_URL}/api/detalle-marcaciones/export?${params.toString()}`;
}

export async function obtenerDashboardAsistencia(desde, hasta, area) {
  const params = new URLSearchParams({ desde, hasta });
  if (area) params.append('area', area);
  const res = await authFetch(`${API_URL}/api/dashboard-asistencia?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al cargar el dashboard');
  return data;
}

// --- Ausencias y permisos ---

export async function listarAusencias(filtros = {}) {
  const params = new URLSearchParams();
  Object.entries(filtros).forEach(([k, v]) => { if (v) params.append(k, v); });
  const res = await authFetch(`${API_URL}/api/ausencias?${params.toString()}`);
  if (!res.ok) throw new Error('Error al listar ausencias');
  return res.json();
}

export async function asignarAusencia(rut, fecha, tipo, observacion) {
  const res = await authFetch(`${API_URL}/api/ausencias`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, fecha, tipo, observacion }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al asignar la ausencia');
  return data;
}

export async function quitarAusencia(rut, fecha) {
  const res = await authFetch(`${API_URL}/api/ausencias/${encodeURIComponent(rut)}/${encodeURIComponent(fecha)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al quitar la ausencia');
  return data;
}

export async function buscarEmpleados(query) {
  const res = await authFetch(`${API_URL}/api/empleados?q=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error('Error al buscar empleados');
  return res.json();
}

export async function listarAsignacionesJefeTurno() {
  const res = await authFetch(`${API_URL}/api/jefe-turno`);
  if (!res.ok) throw new Error('Error al listar asignaciones');
  return res.json();
}

export async function asignarJefeTurno(rut, jefeTurno) {
  const res = await authFetch(`${API_URL}/api/jefe-turno`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, jefe_turno: jefeTurno }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al asignar');
  return data;
}

export async function quitarAsignacionJefeTurno(rut) {
  const res = await authFetch(`${API_URL}/api/jefe-turno/${encodeURIComponent(rut)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al quitar asignación');
  return data;
}

export async function actualizarMarcaciones(fuente, file) {
  const formData = new FormData();
  formData.append(fuente, file);

  const res = await authFetch(`${API_URL}/api/actualizar/${fuente}`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Error al actualizar ${fuente}`);
  }
  return data;
}

// Igual que actualizarMarcaciones, pero reporta el progreso de la SUBIDA del
// archivo (0-100%) vía onProgress. Usa XMLHttpRequest porque fetch() no
// expone eventos de progreso de subida.
export function actualizarMarcacionesConProgreso(fuente, file, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append(fuente, file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/api/actualizar/${fuente}`);
    const token = obtenerToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 401) { cerrarSesion(); notificarSesionInvalida(); }
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error('Respuesta inválida del servidor'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
        resolve(data);
      } else {
        reject(new Error(data.error || `Error al actualizar ${fuente}`));
      }
    };

    xhr.onerror = () => reject(new Error('Error de red al subir el archivo'));

    xhr.send(formData);
  });
}

// --- Áreas de trabajo ---

export async function listarCargos() {
  const res = await authFetch(`${API_URL}/api/cargos`);
  if (!res.ok) throw new Error('Error al listar cargos');
  return res.json();
}

export async function listarAreas() {
  const res = await authFetch(`${API_URL}/api/areas`);
  if (!res.ok) throw new Error('Error al listar áreas');
  return res.json();
}

export async function crearArea(nombre) {
  const res = await authFetch(`${API_URL}/api/areas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al crear el área');
  return data;
}

export async function eliminarArea(nombre) {
  const res = await authFetch(`${API_URL}/api/areas/${encodeURIComponent(nombre)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al eliminar el área');
  return data;
}

// --- Gestión de usuarios ---

export async function listarUsuarios() {
  const res = await authFetch(`${API_URL}/api/usuarios`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al listar usuarios');
  return data;
}

export async function crearUsuario(datos) {
  const res = await authFetch(`${API_URL}/api/usuarios`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al crear el usuario');
  return data;
}

export async function actualizarUsuario(id, datos) {
  const res = await authFetch(`${API_URL}/api/usuarios/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al actualizar el usuario');
  return data;
}

export async function eliminarUsuario(id) {
  const res = await authFetch(`${API_URL}/api/usuarios/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al eliminar el usuario');
  return data;
}

export async function cambiarMiPassword(passwordActual, passwordNueva) {
  const res = await authFetch(`${API_URL}/api/usuarios/me/password`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passwordActual, passwordNueva }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al cambiar la contraseña');
  return data;
}

export async function activarEmpleadosMasivo(file) {
  const formData = new FormData();
  formData.append('activos', file);
  const res = await authFetch(`${API_URL}/api/empleados/activar-masivo`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'Error al actualizar el estado de los trabajadores');
  return data;
}

// --- Perfil de trabajador ---

export async function crearEmpleado(datos) {
  const res = await authFetch(`${API_URL}/api/empleados`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al crear el trabajador');
  return data;
}

export async function actualizarEmpleado(rut, datos) {
  const res = await authFetch(`${API_URL}/api/empleados/${encodeURIComponent(rut)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error al actualizar el trabajador');
  return data;
}