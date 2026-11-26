const crypto = require('crypto');
const config = require('../config');
const { igualesSeguro, firmarInterno } = require('./cryptoService');
const shopify = require('./shopifyClient');
const apps = require('./shopifyAppService');

const STATE_TTL_MS = 15 * 60 * 1000;
const SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

// Topics que registramos por tienda. Los de compliance (customers/*, shop/redact)
// no se pueden registrar por API: se configuran en el Dev Dashboard de la app.
const WEBHOOK_TOPICS = ['PRODUCTS_CREATE', 'PRODUCTS_UPDATE', 'PRODUCTS_DELETE', 'INVENTORY_LEVELS_UPDATE', 'ORDERS_UPDATED', 'ORDERS_CANCELLED', 'APP_UNINSTALLED'];

// URL pública del portal. APP_URL (opcional) manda; si no, la que quedó
// guardada en la app al cargar las credenciales (el dominio desde el que se
// cargaron), que es la misma que se configuró en Shopify.
function baseUrl(app) {
  return config.appUrl || app.appUrl;
}
function callbackUrl(app) {
  return `${baseUrl(app)}/shopify/callback`;
}
function webhookUrl(app) {
  return `${baseUrl(app)}/shopify/webhooks`;
}

// Acepta lo que el Cliente pegue: "mitienda", "mitienda.myshopify.com",
// "https://mitienda.myshopify.com/admin", o la URL nueva
// "admin.shopify.com/store/mitienda". Devuelve null si no es válido.
function normalizarShop(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  const adminNuevo = s.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (adminNuevo) s = adminNuevo[1];
  s = s.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  if (!s.includes('.')) s = `${s}.myshopify.com`;
  return SHOP_REGEX.test(s) ? s : null;
}

function esShopValido(shop) {
  return typeof shop === 'string' && SHOP_REGEX.test(shop);
}

// ── state firmado ───────────────────────────────────────────────────────────
// No depende de la sesión en memoria (Railway puede reiniciar entre ida y
// vuelta). Lleva clienteId + usuarioId + shop + timestamp, firmado con HMAC.

const firmar = firmarInterno;

function crearState({ clienteId, usuarioId, shop, appId }) {
  const payload = Buffer.from(JSON.stringify({
    c: clienteId,
    u: usuarioId,
    s: shop,
    a: appId,
    t: Date.now(),
    n: crypto.randomBytes(8).toString('hex'),
  })).toString('base64url');
  return `${payload}.${firmar(payload)}`;
}

function leerState(state) {
  const [payload, firma] = String(state || '').split('.');
  if (!payload || !firma || !igualesSeguro(firma, firmar(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - data.t > STATE_TTL_MS) return null;
    return { clienteId: data.c, usuarioId: data.u, shop: data.s, appId: data.a };
  } catch {
    return null;
  }
}

function urlAutorizacion({ app, shop, state }) {
  const params = new URLSearchParams({
    client_id: app.clientId,
    scope: config.shopify.scopes,
    redirect_uri: callbackUrl(app),
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params}`;
}

// HMAC de los query params con que Shopify vuelve (callback y app URL):
// todos menos "hmac", ordenados, "k=v" unidos con "&", HMAC-SHA256 hex.
function verificarHmacQuery(query, secret) {
  const { hmac, ...resto } = query;
  if (!hmac || !secret) return false;
  const mensaje = Object.keys(resto)
    .sort()
    .map(k => `${k}=${Array.isArray(resto[k]) ? resto[k].join(',') : resto[k]}`)
    .join('&');
  const calculado = crypto.createHmac('sha256', secret).update(mensaje).digest('hex');
  return igualesSeguro(calculado, String(hmac));
}

// Cuando Shopify abre el portal (App URL) no sabemos de qué app viene: es la
// que tenga el secret que valida la firma.
async function appQueFirmo(query) {
  for (const app of await apps.secretos()) {
    if (verificarHmacQuery(query, app.clientSecret)) return app;
  }
  return null;
}

// ── Post-conexión ───────────────────────────────────────────────────────────

async function cargarDatosTienda(clienteId) {
  const data = await shopify.graphql(clienteId, '{ shop { name currencyCode } }');
  await shopify.actualizarDatosTienda(clienteId, { nombreTienda: data.shop.name, moneda: data.shop.currencyCode });
}

async function registrarWebhooks(clienteId, app) {
  const mutation = `
    mutation crear($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`;
  const fallas = [];
  for (const topic of WEBHOOK_TOPICS) {
    const data = await shopify.graphql(clienteId, mutation, { topic, webhookSubscription: { uri: webhookUrl(app) } });
    const errores = data.webhookSubscriptionCreate.userErrors;
    // Al reconectar la misma tienda la suscripción ya existe: no es un error real.
    const reales = errores.filter(e => !/already been taken|ya existe/i.test(e.message));
    if (reales.length) fallas.push(`${topic}: ${reales.map(e => e.message).join(', ')}`);
  }
  if (fallas.length) console.warn('[shopify] No se pudieron registrar algunos webhooks:', fallas.join(' | '));
  return fallas;
}

// Al desconectar desde el portal: que Shopify deje de mandarnos avisos.
async function borrarWebhooks(clienteId, app) {
  const data = await shopify.graphql(clienteId, '{ webhookSubscriptions(first: 100) { nodes { id uri } } }');
  const nuestros = data.webhookSubscriptions.nodes.filter(w => w.uri === webhookUrl(app));
  for (const w of nuestros) {
    await shopify.graphql(clienteId, `
      mutation borrar($id: ID!) { webhookSubscriptionDelete(id: $id) { userErrors { message } } }`, { id: w.id });
  }
}

module.exports = {
  normalizarShop,
  borrarWebhooks,
  esShopValido,
  crearState,
  leerState,
  urlAutorizacion,
  verificarHmacQuery,
  appQueFirmo,
  baseUrl,
  cargarDatosTienda,
  registrarWebhooks,
  callbackUrl,
  webhookUrl,
};
