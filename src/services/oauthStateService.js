const crypto = require('crypto');
const config = require('../config');
const { firmarInterno, igualesSeguro } = require('./cryptoService');

// `state` firmado para los OAuth del Dashboard (Meta y Mercado Pago). Igual que
// el de Shopify: no depende de la sesión, vence a los 15 min y sirve una sola vez.

const TTL_MS = 15 * 60 * 1000;
const usados = new Map(); // nonce -> vence (ms)

function crear(proveedor, { clienteId, usuarioId }) {
  const payload = Buffer.from(JSON.stringify({
    p: proveedor, c: clienteId, u: usuarioId, t: Date.now(), n: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  return `${payload}.${firmarInterno(payload)}`;
}

function leer(proveedor, state) {
  const [payload, firma] = String(state || '').split('.');
  if (!payload || !firma || !igualesSeguro(firma, firmarInterno(payload))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (d.p !== proveedor || Date.now() - d.t > TTL_MS) return null;
    const ahora = Date.now();
    for (const [n, vence] of usados) if (vence < ahora) usados.delete(n);
    if (usados.has(d.n)) return null;
    usados.set(d.n, d.t + TTL_MS);
    return { clienteId: d.c, usuarioId: d.u };
  } catch {
    return null;
  }
}

// URL pública del portal (APP_URL o el host del pedido: Railway pone https por el proxy).
function baseUrl(req) {
  return config.appUrl || `${req.protocol}://${req.get('host')}`;
}

module.exports = { crear, leer, baseUrl };
