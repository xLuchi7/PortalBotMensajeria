import { createContext, useContext, useEffect, useRef, useState } from 'react';

// Tiempo real: una sola conexión (EventSource) por Cliente, abierta en
// Layout.jsx, a GET /api/clientes/:id/eventos. El servidor avisa "cambió X"
// (mensaje, chat, revision, escalamiento, pedido) y cada pantalla vuelve a pedir
// lo suyo con useEnVivo. Si la conexión se cae, hay un respaldo que pregunta
// cada tanto, y al volver a la pestaña siempre se refresca una vez.

export const TIPOS_EVENTO = ['mensaje', 'chat', 'revision', 'escalamiento', 'pedido'];
const REINTENTO_MS = 15000;
const RESPALDO_MS = 60000;

function crearFuente(clienteId) {
  const oyentes = new Set();
  const avisar = evento => oyentes.forEach(f => f(evento));
  let fuente = null;
  let conectado = false;
  let huboCorte = false;
  let cerrada = false;
  let reintento = null;

  const abrir = () => {
    fuente = new EventSource(`/api/clientes/${clienteId}/eventos`);
    fuente.onopen = () => {
      conectado = true;
      // Mientras estuvo cortado se pudo perder algo: que todos refresquen.
      if (huboCorte) avisar({ tipo: 'reconectado' });
      huboCorte = false;
    };
    fuente.onmessage = e => {
      try { avisar(JSON.parse(e.data)); } catch { /* evento mal formado */ }
    };
    fuente.onerror = () => {
      conectado = false;
      huboCorte = true;
      // Ante un error de red el navegador reintenta solo; si el servidor
      // respondió con error (por ejemplo durante un deploy) no, así que se
      // reabre a mano.
      if (fuente.readyState === EventSource.CLOSED && !cerrada) {
        clearTimeout(reintento);
        reintento = setTimeout(abrir, REINTENTO_MS);
      }
    };
  };
  abrir();

  return {
    get conectado() { return conectado; },
    suscribir(f) { oyentes.add(f); return () => oyentes.delete(f); },
    cerrar() { cerrada = true; clearTimeout(reintento); fuente?.close(); },
  };
}

export function useFuenteEventos(clienteId) {
  const [fuente, setFuente] = useState(null);
  useEffect(() => {
    if (!clienteId || typeof EventSource === 'undefined') { setFuente(null); return undefined; }
    const f = crearFuente(clienteId);
    setFuente(f);
    return () => f.cerrar();
  }, [clienteId]);
  return fuente;
}

export const EventosContext = createContext(null);

// Llama a alCambiar cuando llega un evento de alguno de esos tipos (agrupando
// los que llegan juntos), al volver a la pestaña y, si la conexión está caída,
// cada RESPALDO_MS. `fuente` solo hace falta donde no llega el contexto (Layout).
export function useEnVivo(tipos, alCambiar, { fuente: propia, esperaMs = 400 } = {}) {
  const delContexto = useContext(EventosContext);
  const fuente = propia !== undefined ? propia : delContexto;
  const callback = useRef(alCambiar);
  callback.current = alCambiar;
  const clave = tipos.join(',');

  useEffect(() => {
    const aceptados = new Set(clave.split(','));
    let espera = null;
    const disparar = () => { clearTimeout(espera); espera = setTimeout(() => callback.current(), esperaMs); };

    const desuscribir = fuente?.suscribir(e => {
      if (e.tipo === 'reconectado' || aceptados.has(e.tipo)) disparar();
    });
    const alVolver = () => { if (!document.hidden) disparar(); };
    document.addEventListener('visibilitychange', alVolver);
    const respaldo = setInterval(() => {
      if (!document.hidden && !fuente?.conectado) callback.current();
    }, RESPALDO_MS);

    return () => {
      desuscribir?.();
      clearTimeout(espera);
      clearInterval(respaldo);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [fuente, clave, esperaMs]);
}
