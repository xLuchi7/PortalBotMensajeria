// Helpers de formato (los mismos que usaban las vistas EJS).

// 5491132101982 → +54 9 11 3210-1982. Para otras características (que tienen
// largo variable) no adivinamos el corte y lo dejamos como +<número>.
export function numero(userId) {
  const s = String(userId || '');
  if (/^54911\d{8}$/.test(s)) return `+54 9 11 ${s.slice(5, 9)}-${s.slice(9)}`;
  return /^\d{8,15}$/.test(s) ? `+${s}` : s;
}

// "25/11/2026, 10:21:04" (como lo devuelven los FORMAT de las queries) → { dia, hora }
// con la hora sin segundos, para mostrar en dos líneas.
export function fecha(texto) {
  const [dia = '', hora = ''] = String(texto || '').split(', ');
  return { dia, hora: hora.slice(0, 5) };
}

export function plata(valor) {
  return '$' + Number(valor || 0).toLocaleString('es-AR');
}

export function iniciales(texto) {
  const palabras = String(texto || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return '?';
  return (palabras[0][0] + (palabras[1] ? palabras[1][0] : '')).toUpperCase();
}

export function plural(n, singular, pluralForm = `${singular}s`) {
  return n === 1 ? singular : pluralForm;
}

// Color de avatar fijo por número, para reconocer cada contacto de un vistazo.
export function tono(id) {
  return String(id).split('').reduce((a, d) => a + d.charCodeAt(0), 0) % 6;
}

// Arma "?a=1&b=2" salteando vacíos.
export function query(params) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== '' && v != null && v !== false)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return qs ? `?${qs}` : '';
}
