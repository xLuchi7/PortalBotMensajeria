// Tiempo real con Server-Sent Events: en vez de que el navegador pregunte cada
// pocos segundos, el portal le avisa cuando algo cambia en su Cliente.
//
// - El navegador abre GET /api/clientes/:id/eventos (una conexión por pestaña).
// - Bot_Mensajeria avisa con POST /api/interno/eventos cuando escribe en la base
//   (mensaje nuevo, reclamo, pedido, revisión humana).
// - El propio portal avisa cuando un usuario cambia algo (ver api.js), así se
//   actualizan las otras pestañas y usuarios del mismo Cliente.
//
// Los eventos solo dicen "cambió X": cada pantalla vuelve a pedir sus datos con
// los endpoints de siempre. Vive en memoria, igual que las sesiones: sirve
// mientras Railway corra una sola instancia.

const TIPOS = new Set(['mensaje', 'chat', 'revision', 'escalamiento', 'pedido']);
const PING_MS = 25 * 1000; // los proxies cortan conexiones que no mandan nada
const MAX_POR_CLIENTE = 100;

const suscriptores = new Map(); // clienteId -> Set<res>
let pingTimer = null;

function ping() {
  for (const conjunto of suscriptores.values()) {
    for (const res of conjunto) res.write(': ping\n\n');
  }
}

function suscribir(clienteId, req, res) {
  let conjunto = suscriptores.get(clienteId);
  if (!conjunto) suscriptores.set(clienteId, (conjunto = new Set()));
  if (conjunto.size >= MAX_POR_CLIENTE) {
    return res.status(429).json({ ok: false, mensaje: 'Demasiadas Pestañas Abiertas' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // retry: cuánto espera el navegador para reconectarse si se corta.
  res.write('retry: 5000\n\n');
  conjunto.add(res);

  if (!pingTimer) pingTimer = setInterval(ping, PING_MS).unref();

  req.on('close', () => {
    conjunto.delete(res);
    if (!conjunto.size) suscriptores.delete(clienteId);
    if (!suscriptores.size && pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  });
}

function emitir(clienteId, tipo, datos = {}) {
  const conjunto = suscriptores.get(Number(clienteId));
  if (!conjunto || !TIPOS.has(tipo)) return;
  const linea = `data: ${JSON.stringify({ ...datos, tipo })}\n\n`;
  for (const res of conjunto) res.write(linea);
}

module.exports = { TIPOS, suscribir, emitir };
