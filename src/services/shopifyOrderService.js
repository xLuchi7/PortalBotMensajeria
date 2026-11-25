const { getPool, sql } = require('./db');
const shopify = require('./shopifyClient');

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

module.exports = { enviarPedido, cancelarPedido, alCambiarEstado };
