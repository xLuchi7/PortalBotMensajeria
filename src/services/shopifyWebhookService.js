const crypto = require('crypto');
const { ejecutar, sql } = require('./db');
const shopify = require('./shopifyClient');
const apps = require('./shopifyAppService');
const sync = require('./shopifySyncService');
const orders = require('./shopifyOrderService');
const eventos = require('./eventosService');

// X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(body crudo, client secret)).
// Tiene que calcularse sobre los bytes tal cual llegaron, antes de parsear.
// Puede haber varias apps (una por Cliente): devuelve la que firmó, o null.
function verificarFirma(rawBody, hmacHeader, appsConSecreto) {
  if (!hmacHeader || !Buffer.isBuffer(rawBody)) return null;
  const recibido = Buffer.from(String(hmacHeader), 'base64');
  return appsConSecreto.find((app) => {
    const esperado = crypto.createHmac('sha256', app.clientSecret).update(rawBody).digest();
    return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
  }) ?? null;
}

// true si es la primera vez que vemos este webhook (Shopify reintenta y
// puede mandar el mismo aviso más de una vez).
async function registrarUnaVez(webhookId, shopDomain, topic) {
  if (!webhookId) return true;
  const r = await ejecutar('dbo.usp_Portal_ShopifyWebhookRegistrar', {
    webhookId: [sql.NVarChar(100), webhookId],
    shopDomain: [sql.NVarChar(255), shopDomain],
    topic: [sql.NVarChar(100), topic],
  });
  return Boolean(r.recordset[0]?.nuevo);
}

async function procesar(topic, shopDomain, payload, appId) {
  // Compliance (GDPR). No guardamos datos de clientes de Shopify: los Pedidos
  // vienen de WhatsApp. Solo shop/redact implica borrar algo de nuestro lado.
  if (topic === 'customers/data_request' || topic === 'customers/redact') {
    console.log(`[shopify] Compliance ${topic} de ${shopDomain}: sin datos de clientes de Shopify guardados.`);
    return;
  }

  const conexion = await shopify.obtenerConexionPorShop(shopDomain);
  if (!conexion) return;
  const { clienteId } = conexion;

  // La tienda sale del header X-Shopify-Shop-Domain: solo vale si el webhook lo
  // firmó la app de ESA conexión. Si no, alguien con el secreto de otra app podría
  // mandar avisos falsos (borrar la conexión, marcar pedidos como pagados...).
  if (conexion.appId != null && conexion.appId !== appId) {
    console.warn(`[shopify] Webhook ${topic} de ${shopDomain} firmado por otra app (${appId}, se esperaba ${conexion.appId}): ignorado.`);
    return;
  }

  if (topic === 'shop/redact') {
    await shopify.eliminarConexion(clienteId);
    return;
  }
  if (topic === 'app/uninstalled') {
    await shopify.borrarTokens(clienteId, 'desinstalada');
    console.log(`[shopify] App desinstalada en ${shopDomain} (cliente ${clienteId}).`);
    return;
  }
  if (conexion.estado === 'desinstalada') return;

  switch (topic) {
    case 'products/create':
    case 'products/update':
      await sync.sincronizarProducto(clienteId, payload.admin_graphql_api_id || payload.id);
      break;
    case 'products/delete':
      await sync.desactivarProducto(clienteId, payload.id);
      break;
    case 'orders/updated':
    case 'orders/cancelled':
      await orders.actualizarDesdeShopify(clienteId, payload);
      eventos.emitir(clienteId, 'pedido');
      break;
    case 'inventory_levels/update':
      await sync.actualizarStockDeInventoryItem(clienteId, payload.inventory_item_id);
      break;
    default:
      break;
  }
}

// De a uno por tienda: products/create y products/update llegan casi juntos y,
// procesados en paralelo, se pisaban (o duplicaban el artículo).
const colas = new Map(); // shopDomain -> Promise
function encolar(shopDomain, tarea) {
  const anterior = colas.get(shopDomain) || Promise.resolve();
  const actual = anterior.then(tarea, tarea);
  colas.set(shopDomain, actual);
  actual.finally(() => { if (colas.get(shopDomain) === actual) colas.delete(shopDomain); }).catch(() => {});
  return actual;
}

// Ya le respondimos 200 a Shopify (si no, reintenta y termina dando de baja la
// suscripción), así que si falla (la base despertando, Shopify con un 5xx) lo
// reintentamos nosotros: 30 s, 2 min y 10 min después.
const ESPERAS_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
function procesarConReintentos(topic, shopDomain, payload, appId, intento = 0) {
  encolar(shopDomain, () => procesar(topic, shopDomain, payload, appId)).catch((err) => {
    if (intento < ESPERAS_MS.length) {
      console.warn(`[shopify] Error procesando ${topic} de ${shopDomain} (intento ${intento + 1}), se reintenta:`, err.message);
      setTimeout(() => procesarConReintentos(topic, shopDomain, payload, appId, intento + 1), ESPERAS_MS[intento]).unref();
    } else {
      console.error(`[shopify] Error procesando ${topic} de ${shopDomain} después de ${intento + 1} intentos:`, err.message);
    }
  });
}

// Handler Express. Responde 200 apenas valida (Shopify corta a los 5s y
// después de varias fallas da de baja la suscripción) y procesa después.
async function handler(req, res) {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  let appsConSecreto;
  try {
    appsConSecreto = await apps.secretos();
  } catch (err) {
    console.error('[shopify] No se pudieron leer las apps:', err.message);
    return res.status(500).send('error');
  }
  const app = verificarFirma(req.body, hmac, appsConSecreto);
  if (!app) return res.status(401).send('Firma inválida');

  const topic = req.get('X-Shopify-Topic');
  const shopDomain = req.get('X-Shopify-Shop-Domain');
  const webhookId = req.get('X-Shopify-Webhook-Id');
  if (!topic || !shopDomain) return res.status(400).send('Faltan headers');

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8') || '{}');
  } catch {
    return res.status(400).send('JSON inválido');
  }

  try {
    if (!(await registrarUnaVez(webhookId, shopDomain, topic))) return res.status(200).send('ok');
  } catch (err) {
    console.error('[shopify] No se pudo registrar el webhook:', err.message);
    return res.status(500).send('error');
  }

  res.status(200).send('ok');
  setImmediate(() => procesarConReintentos(topic, shopDomain, payload, app.id));
}

// ShopifyWebhookLog solo sirve para descartar reintentos: a los 7 días se borra.
function purgarLog() {
  ejecutar('dbo.usp_Portal_ShopifyWebhookLogPurgar')
    .then(r => { if (r.recordset[0]?.borrados) console.log(`[shopify] ${r.recordset[0].borrados} webhooks viejos borrados del log.`); })
    .catch(err => console.error('[shopify] No se pudo purgar ShopifyWebhookLog:', err.message));
}
setTimeout(purgarLog, 60 * 1000).unref();
setInterval(purgarLog, 12 * 60 * 60 * 1000).unref();

module.exports = { handler, verificarFirma };
