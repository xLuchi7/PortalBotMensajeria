const crypto = require('crypto');
const { getPool, sql } = require('./db');
const shopify = require('./shopifyClient');
const apps = require('./shopifyAppService');
const sync = require('./shopifySyncService');
const orders = require('./shopifyOrderService');
const eventos = require('./eventosService');

// X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(body crudo, client secret)).
// Tiene que calcularse sobre los bytes tal cual llegaron, antes de parsear.
// Puede haber varias apps (una por Cliente): vale si la firma alguna.
function verificarFirma(rawBody, hmacHeader, secrets) {
  if (!hmacHeader || !Buffer.isBuffer(rawBody)) return false;
  const recibido = Buffer.from(String(hmacHeader), 'base64');
  return secrets.some(secret => {
    const esperado = crypto.createHmac('sha256', secret).update(rawBody).digest();
    return esperado.length === recibido.length && crypto.timingSafeEqual(esperado, recibido);
  });
}

// true si es la primera vez que vemos este webhook (Shopify reintenta y
// puede mandar el mismo aviso más de una vez).
async function registrarUnaVez(webhookId, shopDomain, topic) {
  if (!webhookId) return true;
  const pool = await getPool();
  try {
    await pool
      .request()
      .input('id', sql.NVarChar, webhookId)
      .input('shop', sql.NVarChar, shopDomain)
      .input('topic', sql.NVarChar, topic)
      .query('INSERT INTO ShopifyWebhookLog (webhookId, shopDomain, topic) VALUES (@id, @shop, @topic)');
    return true;
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) return false;
    throw err;
  }
}

async function procesar(topic, shopDomain, payload) {
  // Compliance (GDPR). No guardamos datos de clientes de Shopify: los Pedidos
  // vienen de WhatsApp. Solo shop/redact implica borrar algo de nuestro lado.
  if (topic === 'customers/data_request' || topic === 'customers/redact') {
    console.log(`[shopify] Compliance ${topic} de ${shopDomain}: sin datos de clientes de Shopify guardados.`);
    return;
  }

  const conexion = await shopify.obtenerConexionPorShop(shopDomain);
  if (!conexion) return;
  const { clienteId } = conexion;

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

// Handler Express. Responde 200 apenas valida (Shopify corta a los 5s y
// después de varias fallas da de baja la suscripción) y procesa después.
async function handler(req, res) {
  const hmac = req.get('X-Shopify-Hmac-Sha256');
  let secrets;
  try {
    secrets = (await apps.secretos()).map(a => a.clientSecret);
  } catch (err) {
    console.error('[shopify] No se pudieron leer las apps:', err.message);
    return res.status(500).send('error');
  }
  if (!verificarFirma(req.body, hmac, secrets)) return res.status(401).send('Firma inválida');

  const topic = req.get('X-Shopify-Topic');
  const shopDomain = req.get('X-Shopify-Shop-Domain');
  const webhookId = req.get('X-Shopify-Webhook-Id');

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

  setImmediate(() => {
    procesar(topic, shopDomain, payload).catch(err => {
      // La sync diaria corrige cualquier cambio que se pierda acá.
      console.error(`[shopify] Error procesando ${topic} de ${shopDomain}:`, err.message);
    });
  });
}

module.exports = { handler, verificarFirma };
