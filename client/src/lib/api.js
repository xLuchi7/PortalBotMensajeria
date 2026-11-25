import { useCallback, useEffect, useRef, useState } from 'react';

// Llamadas a la API del portal (/api/...). El servidor responde
// { ok, tipo, mensaje, ... }; si ok es false (o el status no es 2xx) se tira
// un ApiError con el mensaje listo para mostrar en un toast.
export class ApiError extends Error {
  constructor(mensaje, status, data) {
    super(mensaje);
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, signal };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, opts);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Sin Conexión Con El Servidor, Probá De Nuevo', 0, null);
  }
  const data = await res.json().catch(() => null);
  // Sesión vencida: AuthProvider escucha esto y manda al login.
  if (res.status === 401 && path !== '/login') window.dispatchEvent(new Event('portal:sesion-vencida'));
  if (!res.ok || (data && data.ok === false)) {
    throw new ApiError((data && data.mensaje) || 'Ocurrió Un Error, Probá De Nuevo', res.status, data);
  }
  return data;
}

// Carga datos para una página. Mientras recarga (cambio de página, filtro o
// reload()) conserva lo anterior en pantalla, así no parpadea.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(path) });
  const [tick, setTick] = useState(0);
  const pathRef = useRef(path);

  useEffect(() => {
    const cambioDeRecurso = pathRef.current?.split('?')[0] !== path?.split('?')[0];
    pathRef.current = path;
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    const ctrl = new AbortController();
    setState(s => ({ data: cambioDeRecurso ? null : s.data, error: null, loading: true }));
    api(path, { signal: ctrl.signal })
      .then(data => setState({ data, error: null, loading: false }))
      .catch(err => {
        if (err.name !== 'AbortError') setState(s => ({ ...s, error: err, loading: false }));
      });
    return () => ctrl.abort();
  }, [path, tick]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  const setData = useCallback(fn => setState(s => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })), []);
  return { ...state, reload, setData };
}
