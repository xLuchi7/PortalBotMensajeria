// Cache de pocos segundos para las consultas que piden todas las pestañas a la
// vez cuando llega un aviso en tiempo real (contadores, resumen de Inicio, huella
// de la bandeja). Si 5 pestañas del mismo Cliente piden lo mismo, va una sola
// consulta a la base y las demás esperan esa misma respuesta.
//
// No devuelve datos viejos después de un cambio: eventosService.emitir() llama a
// invalidarCliente(), así el pedido que sigue a un aviso siempre va a la base.

const TTL_MS = 3000;
const entradas = new Map(); // clave -> { en, promesa, clienteId }

function memo(clienteId, clave, fn, ttlMs = TTL_MS) {
  const k = `${clienteId}|${clave}`;
  const e = entradas.get(k);
  if (e && Date.now() - e.en < ttlMs) return e.promesa;
  const promesa = Promise.resolve().then(fn);
  entradas.set(k, { en: Date.now(), promesa, clienteId: Number(clienteId) });
  // Un error no se cachea: el próximo pedido vuelve a intentar.
  promesa.catch(() => { if (entradas.get(k)?.promesa === promesa) entradas.delete(k); });
  if (entradas.size > 2000) entradas.delete(entradas.keys().next().value);
  return promesa;
}

function invalidarCliente(clienteId) {
  const id = Number(clienteId);
  for (const [k, e] of entradas) if (e.clienteId === id) entradas.delete(k);
}

module.exports = { memo, invalidarCliente };
