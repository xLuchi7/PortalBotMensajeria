const { getPool, sql } = require('./db');
const shopify = require('./shopifyClient');
const avisos = require('./avisoService');

// Un Pedido tomado por WhatsApp se crea en Shopify cuando el Cliente lo pasa
// a Confirmado (o directo a Entregado): como pedido real con pago pendiente,
// descontando inventario en Shopify. Si falla, el Pedido igual queda
// confirmado en el portal y se puede reintentar desde ahí.

const ESTADOS_QUE_ENVIAN = ['confirmado', 'entregado'];

const MUTATION_CREAR = `
  mutation crear($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
    orderCreate(order: $order, options: $options) {
      order { id name }
      userErrors { field message code }
    }
  }`;

const MUTATION_CANCELAR = `
  mutation cancelar($orderId: ID!, $refundMethod: OrderCancelRefundMethodInput!, $restock: Boolean!, $reason: OrderCancelReason!, $staffNote: String) {
    orderCancel(orderId: $orderId, refundMethod: $refundMethod, restock: $restock, reason: $reason, notifyCustomer: false, staffNote: $staffNote) {
      job { id }
      orderCancelUserErrors { field message code }
    }
  }`;

async function guardarResultado(pedidoId, { estado, orderId = null, orderName = null, error = null }) {
  const pool = await getPool();
  await pool
    .request()
    .input('pedidoId', sql.Int, pedidoId)
    .input('estado', sql.NVarChar, estado)
    .input('orderId', sql.NVarChar, orderId)
    .input('orderName', sql.NVarChar, orderName)
    .input('error', sql.NVarChar(1000), error ? String(error).slice(0, 1000) : null)
    .query(`
      UPDATE Pedidos SET
        shopifyEstado = @estado,
        shopifyOrderId = COALESCE(@orderId, shopifyOrderId),
        shopifyOrderName = COALESCE(@orderName, shopifyOrderName),
        shopifyError = @error
      WHERE id = @pedidoId
    `);
}

// Reserva atómica: solo un request puede pasar el Pedido a "enviando". Evita
// crear dos órdenes en Shopify por un doble click o dos pestañas abiertas.
async function reservarEnvio(pedidoId, clienteId, { reintento }) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('pedidoId', sql.Int, pedidoId)
    .input('clienteId', sql.Int, clienteId)
    .input('reintento', sql.Bit, reintento ? 1 : 0)
    .query(`
      UPDATE Pedidos SET shopifyEstado = 'enviando', shopifyError = NULL
      WHERE id = @pedidoId AND clienteId = @clienteId AND shopifyOrderId IS NULL
        AND (shopifyEstado IS NULL OR shopifyEstado = 'error' OR (@reintento = 1 AND shopifyEstado = 'enviando'))
    `);
  return r.rowsAffected[0] > 0;
}

async function leerPedido(pedidoId, clienteId) {
  const pool = await getPool();
  const [pedido, items] = await Promise.all([
    pool
      .request()
      .input('pedidoId', sql.Int, pedidoId)
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT id, userId, estado, notas, shopifyOrderId, shopifyEstado FROM Pedidos WHERE id = @pedidoId AND clienteId = @clienteId'),
    pool
      .request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`
        SELECT d.cantidad, d.precioUnitario, a.nombre, a.shopifyVariantId
        FROM DetallePedidos d JOIN Articulos a ON a.id = d.articuloId
        WHERE d.pedidoId = @pedidoId
      `),
  ]);
  return { pedido: pedido.recordset[0] ?? null, items: items.recordset };
}

function telefonoE164(userId) {
  const digitos = String(userId || '').replace(/\D/g, '');
  return digitos.length >= 8 ? `+${digitos}` : null;
}

function armarOrden(pedido, items, moneda, { conTelefono }) {
  const telefono = telefonoE164(pedido.userId);
  const nota = [
    `Pedido tomado por WhatsApp (Portal #${pedido.id}).`,
    telefono ? `WhatsApp del cliente: ${telefono}` : null,
    pedido.notas ? `Notas: ${pedido.notas}` : null,
  ].filter(Boolean).join('\n');

  const order = {
    lineItems: items.map(i => ({
      variantId: i.shopifyVariantId,
      quantity: i.cantidad,
      // Se respeta el precio que el bot le pasó al cliente, aunque después haya
      // cambiado en Shopify.
      ...(moneda ? { priceSet: { shopMoney: { amount: Number(i.precioUnitario).toFixed(2), currencyCode: moneda } } } : {}),
    })),
    financialStatus: 'PENDING',
    note: nota,
    tags: ['whatsapp', 'portal'],
    sourceIdentifier: `portal-pedido-${pedido.id}`,
  };
  if (conTelefono && telefono) order.phone = telefono;
  return order;
}

async function crearOrden(clienteId, order) {
  const data = await shopify.graphql(clienteId, MUTATION_CREAR, {
    order,
    // Ignora la política de "vender sin stock": el bot ya validó stock al tomar
    // el pedido y no queremos perderlo por una diferencia de segundos.
    options: { inventoryBehaviour: 'DECREMENT_IGNORING_POLICY', sendReceipt: false, sendFulfillmentReceipt: false },
  });
  return data.orderCreate;
}

/**
 * Crea el Pedido en Shopify si corresponde. Nunca tira: devuelve
 * { enviado, orderName } o { error } para que la ruta muestre el toast.
 */
async function enviarPedido(pedidoId, clienteId, { reintento = false } = {}) {
  const conexion = await shopify.obtenerConexionActiva(clienteId);
  if (!conexion) return { omitido: true };

  const { pedido, items } = await leerPedido(pedidoId, clienteId);
  if (!pedido) return { error: 'Pedido no encontrado.' };
  if (pedido.shopifyOrderId) return { omitido: true, yaEnviado: true };
  if (!ESTADOS_QUE_ENVIAN.includes(pedido.estado)) return { omitido: true };

  if (!(await reservarEnvio(pedidoId, clienteId, { reintento }))) return { omitido: true, enCurso: true };

  const sinVincular = items.filter(i => !i.shopifyVariantId).map(i => i.nombre);
  if (!items.length || sinVincular.length) {
    const error = items.length
      ? `Estos artículos no están vinculados a Shopify: ${sinVincular.join(', ')}.`
      : 'El pedido no tiene artículos.';
    await guardarResultado(pedidoId, { estado: 'error', error });
    return { error };
  }

  try {
    let resultado = await crearOrden(clienteId, armarOrden(pedido, items, conexion.moneda, { conTelefono: true }));

    // Si Shopify rechaza el teléfono (formato, o la app sin acceso a datos de
    // clientes), se manda igual sin él: el número ya va en la nota.
    if (!resultado.order && resultado.userErrors.some(e => (e.field || []).join('.').includes('phone'))) {
      resultado = await crearOrden(clienteId, armarOrden(pedido, items, conexion.moneda, { conTelefono: false }));
    }

    if (!resultado.order) {
      const error = resultado.userErrors.map(e => e.message).join(' | ') || 'Shopify no creó el pedido.';
      await guardarResultado(pedidoId, { estado: 'error', error });
      return { error };
    }

    await guardarResultado(pedidoId, { estado: 'enviado', orderId: resultado.order.id, orderName: resultado.order.name });
    return { enviado: true, orderName: resultado.order.name };
  } catch (err) {
    // Errores de acceso a datos protegidos llegan como error GraphQL, no userError.
    if (/phone|customer data|protected/i.test(err.message)) {
      try {
        const r2 = await crearOrden(clienteId, armarOrden(pedido, items, conexion.moneda, { conTelefono: false }));
        if (r2.order) {
          await guardarResultado(pedidoId, { estado: 'enviado', orderId: r2.order.id, orderName: r2.order.name });
          return { enviado: true, orderName: r2.order.name };
        }
      } catch { /* cae al error de abajo */ }
    }
    console.error(`[shopify] No se pudo crear el pedido ${pedidoId}:`, err.message);
    await guardarResultado(pedidoId, { estado: 'error', error: err.message });
    return { error: err.message };
  }
}

async function cancelarPedido(pedidoId, clienteId) {
  const conexion = await shopify.obtenerConexionActiva(clienteId);
  const { pedido } = await leerPedido(pedidoId, clienteId);
  if (!conexion || !pedido?.shopifyOrderId) return { omitido: true };

  try {
    const data = await shopify.graphql(clienteId, MUTATION_CANCELAR, {
      orderId: pedido.shopifyOrderId,
      refundMethod: { originalPaymentMethodsRefund: true },
      restock: true,
      reason: 'CUSTOMER',
      staffNote: `Cancelado desde el Portal (pedido #${pedidoId}).`,
    });
    const errores = data.orderCancel.orderCancelUserErrors;
    if (errores.length) {
      const error = errores.map(e => e.message).join(' | ');
      await guardarResultado(pedidoId, { estado: 'enviado', error: `No se pudo cancelar en Shopify: ${error}` });
      return { error };
    }
    await guardarResultado(pedidoId, { estado: 'cancelado' });
    return { cancelado: true };
  } catch (err) {
    console.error(`[shopify] No se pudo cancelar el pedido ${pedidoId}:`, err.message);
    await guardarResultado(pedidoId, { estado: 'enviado', error: `No se pudo cancelar en Shopify: ${err.message}` });
    return { error: err.message };
  }
}

// Punto único que llama la ruta después de cambiar el estado en el portal.
async function alCambiarEstado(pedidoId, clienteId, nuevoEstado) {
  if (ESTADOS_QUE_ENVIAN.includes(nuevoEstado)) return enviarPedido(pedidoId, clienteId);
  if (nuevoEstado === 'cancelado') return cancelarPedido(pedidoId, clienteId);
  return { omitido: true };
}

// ── De Shopify al portal (webhook orders/updated) ───────────────────────────

const PAGO = {
  pending: 'pendiente',
  authorized: 'pendiente',
  partially_paid: 'parcial',
  paid: 'pagado',
  partially_refunded: 'reembolsado',
  refunded: 'reembolsado',
  voided: 'anulado',
};
const ESTADOS_FINALES = ['entregado', 'cancelado', 'solucionado', 'reclamado'];
const ENVIADOS = ['parcial', 'despachado', 'entregado'];

function estadoEnvio(payload) {
  const fulfillments = (payload.fulfillments || []).filter(f => !['cancelled', 'error', 'failure'].includes(f.status));
  if (payload.fulfillment_status === 'fulfilled') {
    return fulfillments.length && fulfillments.every(f => f.shipment_status === 'delivered') ? 'entregado' : 'despachado';
  }
  return payload.fulfillment_status === 'partial' || fulfillments.length ? 'parcial' : 'sin_enviar';
}

// El último envío que trae algún dato de seguimiento.
function seguimiento(payload) {
  const f = [...(payload.fulfillments || [])].reverse()
    .find(x => x.status !== 'cancelled' && (x.tracking_number || x.tracking_url || x.tracking_urls?.length));
  if (!f) return { numero: null, url: null, empresa: null };
  const url = f.tracking_url || f.tracking_urls?.[0] || null;
  return {
    numero: (f.tracking_number || f.tracking_numbers?.[0] || '').slice(0, 100) || null,
    url: url && /^https?:\/\//i.test(url) ? url.slice(0, 500) : null,
    empresa: (f.tracking_company || '').slice(0, 100) || null,
  };
}

function textoEnvio(nombre, envio, t) {
  const lineas = [envio === 'parcial' ? `¡Ya salió parte de tu pedido ${nombre}! 🚚` : `¡Tu pedido ${nombre} ya está en camino! 🚚`];
  if (t.url) lineas.push(`Seguilo acá: ${t.url}`);
  else if (t.numero) lineas.push(`Número de seguimiento: ${t.numero}${t.empresa ? ` (${t.empresa})` : ''}`);
  return lineas.join('\n');
}

/**
 * Pago, envío, seguimiento y cancelación del pedido en Shopify → portal.
 * Si Shopify lo despacha, el pedido pasa a Entregado (en el portal, Entregado
 * es "salió la mercadería"); si lo cancelan allá, se cancela acá. Además manda
 * los avisos por WhatsApp que el Cliente tenga activados.
 */
async function actualizarDesdeShopify(clienteId, payload) {
  const pool = await getPool();
  const orderId = shopify.gid('Order', payload.id);

  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('orderId', sql.NVarChar, orderId)
    .query(`
      SELECT id, userId, estado, shopifyPago, shopifyEnvio, shopifyOrderName
      FROM Pedidos WHERE clienteId = @clienteId AND shopifyOrderId = @orderId
    `);
  const p = r.recordset[0];
  if (!p) return { omitido: true }; // pedido que no salió del portal (ej. de la tienda web)

  const cancelado = Boolean(payload.cancelled_at);
  const pago = PAGO[payload.financial_status] || 'pendiente';
  const envio = estadoEnvio(payload);
  const t = seguimiento(payload);
  const nombre = p.shopifyOrderName || payload.name || `#${p.id}`;

  let nuevoEstado = null;
  if (!ESTADOS_FINALES.includes(p.estado)) {
    if (cancelado) nuevoEstado = 'cancelado';
    else if (envio === 'despachado' || envio === 'entregado') nuevoEstado = 'entregado';
  }

  await pool
    .request()
    .input('id', sql.Int, p.id)
    .input('clienteId', sql.Int, clienteId)
    .input('pago', sql.NVarChar(20), pago)
    .input('envio', sql.NVarChar(20), envio)
    .input('numero', sql.NVarChar(100), t.numero)
    .input('url', sql.NVarChar(500), t.url)
    .input('empresa', sql.NVarChar(100), t.empresa)
    .input('estado', sql.NVarChar, nuevoEstado)
    .input('cancelado', sql.Bit, cancelado ? 1 : 0)
    .input('nombre', sql.NVarChar, payload.name || null)
    .query(`
      UPDATE Pedidos SET
        shopifyPago = @pago,
        shopifyEnvio = @envio,
        trackingNumero = COALESCE(@numero, trackingNumero),
        trackingUrl = COALESCE(@url, trackingUrl),
        trackingEmpresa = COALESCE(@empresa, trackingEmpresa),
        shopifyActualizado = SYSUTCDATETIME(),
        shopifyOrderName = COALESCE(shopifyOrderName, @nombre),
        estado = COALESCE(@estado, estado),
        shopifyEstado = CASE WHEN @cancelado = 1 THEN 'cancelado' ELSE shopifyEstado END
      WHERE id = @id AND clienteId = @clienteId
    `);

  if (nuevoEstado) console.log(`[shopify] Pedido ${p.id} (cliente ${clienteId}) pasó a ${nuevoEstado} desde Shopify.`);
  if (cancelado) return { actualizado: true };

  if (pago === 'pagado' && p.shopifyPago !== 'pagado') {
    await avisos.avisar({
      clienteId, userId: p.userId, tipo: 'pago', clave: `pago:pedido:${p.id}`, pedidoId: p.id,
      texto: `¡Recibimos el pago de tu pedido ${nombre}! Gracias por tu compra 🙌`,
      datos: { orderName: nombre },
    });
  }
  if (ENVIADOS.includes(envio) && !ENVIADOS.includes(p.shopifyEnvio)) {
    await avisos.avisar({
      clienteId, userId: p.userId, tipo: 'envio', clave: `envio:pedido:${p.id}`, pedidoId: p.id,
      texto: textoEnvio(nombre, envio, t),
      datos: { orderName: nombre, trackingUrl: t.url, trackingNumero: t.numero },
    });
  }
  return { actualizado: true };
}

module.exports = { enviarPedido, cancelarPedido, alCambiarEstado, actualizarDesdeShopify };
