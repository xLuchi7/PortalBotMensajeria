const crypto = require('crypto');
const config = require('../config');

// Los tokens y secrets de Shopify dan acceso total a la tienda del Cliente:
// nunca se guardan en texto plano. AES-256-GCM => "iv.tag.ciphertext" en base64.
//
// La clave sale de TOKEN_ENC_KEY si está, y si no se deriva (HKDF) de
// SESSION_SECRET, que ya existe en el servidor: no hace falta otra variable.
// Cambiar cualquiera de las dos deja ilegible lo guardado (hay que reconectar
// las tiendas y volver a cargar las credenciales de la app).

const claves = new Map();

// proposito 'tokens-legado': la clave derivada de SESSION_SECRET aunque exista
// TOKEN_ENC_KEY, para poder leer lo que se guardó antes de configurarla.
function derivar(proposito) {
  if (claves.has(proposito)) return claves.get(proposito);
  let key;
  const raw = config.shopify.tokenEncKey;
  if (proposito === 'tokens-legado') {
    if (!config.sessionSecret) throw new Error('Falta SESSION_SECRET en el servidor.');
    key = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, 'portal-mensajeria', 'shopify-tokens', 32));
  } else if (raw && proposito === 'tokens') {
    key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
    if (key.length !== 32) throw new Error('TOKEN_ENC_KEY inválida: tiene que ser de 32 bytes (64 caracteres hex).');
  } else {
    if (!config.sessionSecret) throw new Error('Falta SESSION_SECRET en el servidor.');
    key = Buffer.from(crypto.hkdfSync('sha256', config.sessionSecret, 'portal-mensajeria', `shopify-${proposito}`, 32));
  }
  claves.set(proposito, key);
  return key;
}

function cifrar(texto) {
  if (texto == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', derivar('tokens'), iv);
  const enc = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}

function descifrarCon(clave, valor) {
  const [iv, tag, enc] = valor.split('.').map(p => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', clave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// Si se configuró TOKEN_ENC_KEY después de haber guardado tokens, lo viejo sigue
// cifrado con la clave derivada de SESSION_SECRET: se prueba con esa si la nueva
// no sirve. Lo que se vuelva a guardar (reconectar, refresh del token, editar la
// app) queda cifrado con TOKEN_ENC_KEY.
function descifrar(valor) {
  if (!valor) return null;
  try {
    return descifrarCon(derivar('tokens'), valor);
  } catch (err) {
    if (!config.shopify.tokenEncKey) throw err;
    return descifrarCon(derivar('tokens-legado'), valor);
  }
}

// Firma interna del portal (state del OAuth), independiente de la app de Shopify.
function firmarInterno(texto) {
  return crypto.createHmac('sha256', derivar('state')).update(texto).digest('base64url');
}

// Comparación en tiempo constante de dos strings (firmas HMAC).
function igualesSeguro(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

module.exports = { cifrar, descifrar, firmarInterno, igualesSeguro };
