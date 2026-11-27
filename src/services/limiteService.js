// Limitador en memoria por clave (IP, email...) con ventana fija. Sirve mientras
// Railway corra una sola instancia, igual que eventosService.
//
//   const intentos = crearLimite({ max: 5, ventanaMs: 15 * 60 * 1000 });
//   if (intentos.bloqueado(clave)) ...   // ¿ya se pasó?
//   intentos.sumar(clave);               // contar un intento (ej. login fallido)
//   intentos.limpiar(clave);             // olvidar (ej. login correcto)

function crearLimite({ max, ventanaMs }) {
  const registros = new Map(); // clave -> { cantidad, desde }

  const vigente = (clave) => {
    const r = registros.get(clave);
    if (r && Date.now() - r.desde >= ventanaMs) { registros.delete(clave); return null; }
    return r || null;
  };

  // Limpieza periódica para que el Map no crezca con claves viejas.
  setInterval(() => {
    const ahora = Date.now();
    for (const [clave, r] of registros) if (ahora - r.desde >= ventanaMs) registros.delete(clave);
  }, Math.min(ventanaMs, 10 * 60 * 1000)).unref();

  return {
    bloqueado: clave => (vigente(clave)?.cantidad ?? 0) >= max,
    // Minutos que faltan para que se libere (para el mensaje al usuario).
    minutosRestantes: (clave) => {
      const r = vigente(clave);
      return r ? Math.max(1, Math.ceil((ventanaMs - (Date.now() - r.desde)) / 60000)) : 0;
    },
    sumar: (clave) => {
      const r = vigente(clave);
      if (r) r.cantidad++;
      else registros.set(clave, { cantidad: 1, desde: Date.now() });
    },
    limpiar: clave => registros.delete(clave),
  };
}

module.exports = { crearLimite };
