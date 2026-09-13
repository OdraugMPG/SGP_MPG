const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const TOKEN_KEY = 'movil_token';
const TRABAJADOR_KEY = 'movil_trabajador';

export function obtenerToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function obtenerTrabajadorActual() {
  const raw = localStorage.getItem(TRABAJADOR_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function cerrarSesion() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TRABAJADOR_KEY);
}

async function authFetch(url, options = {}) {
  const token = obtenerToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) cerrarSesion();
  return res;
}

export async function iniciarSesionTrabajador(rut, pin) {
  const res = await fetch(`${API_URL}/api/movil/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, pin }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo iniciar sesión');

  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(TRABAJADOR_KEY, JSON.stringify(data.trabajador));
  return data.trabajador;
}

export async function registrarMarcacion({ tipo, lat, lng, foto }) {
  const formData = new FormData();
  formData.append('tipo', tipo);
  formData.append('lat', lat);
  formData.append('lng', lng);
  if (foto) formData.append('foto', foto);

  const res = await authFetch(`${API_URL}/api/movil/mi/marcaciones`, {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo registrar la marcación');
  return data.marcacion;
}

export async function obtenerMisMarcaciones(desde, hasta) {
  const params = new URLSearchParams({ desde, hasta });
  const res = await authFetch(`${API_URL}/api/movil/mi/marcaciones?${params.toString()}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudo consultar el historial');
  return data;
}

export async function cambiarPin(pinActual, pinNuevo) {
  const res = await authFetch(`${API_URL}/api/movil/mi/pin`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinActual, pinNuevo }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error || 'No se pudo cambiar el PIN');
  return data;
}
