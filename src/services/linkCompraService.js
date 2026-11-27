const { ejecutar, sql } = require('./db');
const shopify = require('./shopifyClient');
const avisos = require('./avisoService');

// Links de compra: el bot (Bot_Mensajeria, linkCompraService) le manda a la persona
// un link al checkout de Shopify con el carrito armado y lo registra en LinksCompra
// (= intención de compra). El link lleva un token en attributes[whatsapp] y en
// ref=wa-<token>; cuando la persona compra, la orden vuelve con ese token por los
// webhooks orders/create, orders/updated y orders/cancelled, y acá se vincula:
// enviado → comprado (orden creada, pago pendiente) → pagado, o cancelado.

const PAGE_SIZE = 20;
const ESTADOS = ['enviado', 'comprado', 'pagado', 'cancelado'];
const PERIODOS = [7, 30, 90];

const PAGO = {
  pending: 'pendiente',
  authorized: 'pendiente',
  partially_paid: 'parcial',
  paid: 'pagado',
  partially_refunded: 'reembolsado',
  refunded: 'reembolsado',
  voided: 'anulado',
};
const ENVIADOS = ['parcial', 'despachado', 'entregado'];
function sinProcedure(err) {
  return /Could not find stored procedure/i.test(err?.message || '');
}

const TOKEN_RE = /^[A-Za-z0-9_-]{8,40}$/;

// El token de la orden: primero el atributo del carrito (note_attributes), y si no
// está, el ref del link (landing_site / landing_site_ref).
function tokenDeOrden(payload) {
  const attr = (payload.note_attributes || []).find(a => String(a?.name || '').trim().toLowerCase() === 'whatsapp');
  const valor = String(attr?.value || '').trim();
  if (TOKEN_RE.test(valor)) return valor;
  for (const texto of [payload.landing_site_ref, payload.landing_site, payload.referring_site]) {
    const m = /(?:^|[?&=\s]|%3D)wa-([A-Za-z0-9_-]{8,40})/.exec(String(texto || ''));
    if (m) return m[1];
  }
  return null;
}

function estadoEnvio(payload) {
  const fulfillments = (payload.fulfillments || []).filter(f => !['cancelled', 'error', 'failure'].includes(f.status));
  if (payload.fulfillment_status === 'fulfilled') {
    return fulfillments.length && fulfillments.every(f => f.shipment_status === 'delivered') ? 'entregado' : 'despachado';
  }
  return payload.fulfillment_status === 'partial' || fulfillments.length ? 'parcial' : 'sin_enviar';
}

// Shopify no garantiza el orden de los webhooks: se ignora uno más viejo que el
// último procesado de la misma orden.
const ultimoUpdatedAt = new Map(); // orderId -> ms
function esViejo(orderId, updatedAt) {
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return false;
  if (t < (ultimoUpdatedAt.get(orderId) ?? 0)) return true;
  ultimoUpdatedAt.set(orderId, t);
  if (ultimoUpdatedAt.size > 10000) ultimoUpdatedAt.delete(ultimoUpdatedAt.keys().next().value);
  return false;
}

// created_at de Shopify (con zona) → hora Argentina, como el resto de LinksCompra.
function fechaArgentina(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t - 3 * 60 * 60 * 1000) : null;
}

function numeroODefault(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Webhook de una orden (orders/create, orders/updated, orders/cancelled). Devuelve
 * true si la orden salió de un link de compra (y quedó registrada), false si no.
 */
async function actualizarDesdeOrden(clienteId, payload) {
  const orderId = shopify.gid('Order', payload.id);
  const token = tokenDeOrden(payload);

  let r;
  try {
    r = await ejecutar('dbo.usp_Portal_LinkCompraVincular', {
      clienteId: [sql.Int, clienteId],
      token: [sql.VarChar(40), token],
      orderId: [sql.NVarChar(100), orderId],
    });
  } catch (err) {
    // Sin el SQL nuevo: que los webhooks de los Pedidos del portal sigan andando.
    if (sinProcedure(err)) return false;
    throw err;
  }
  const link = r.recordset[0];
  if (!link) return false; // no salió de un link del bot (o el token no es de este Cliente)
  if (esViejo(orderId, payload.updated_at)) {
    console.log(`[links] Webhook viejo de ${orderId} ignorado (llegó después de uno más nuevo).`);
    return true;
  }

  const cancelado = Boolean(payload.cancelled_at);
  const pago = PAGO[payload.financial_status] || 'pendiente';
  const envio = estadoEnvio(payload);
  const estado = cancelado ? 'cancelado' : pago === 'pagado' ? 'pagado' : 'comprado';
  // Una venta pagada no vuelve a "comprado": ni por un reembolso parcial ni por un
  // webhook viejo que llegue tarde (después de reiniciar, esViejo no lo recuerda).
  // Lo mismo con una orden cancelada (en Shopify no se puede "descancelar").
  const estadoFinal = link.estado === 'cancelado' ? 'cancelado'
    : link.estado === 'pagado' && estado === 'comprado' ? 'pagado'
    : estado;
  if (estadoFinal === 'cancelado' && !cancelado) return true;

  await ejecutar('dbo.usp_Portal_LinkCompraActualizar', {
    id: [sql.Int, link.id],
    clienteId: [sql.Int, clienteId],
    estado: [sql.NVarChar(20), estadoFinal],
    pago: [sql.NVarChar(20), pago],
    envio: [sql.NVarChar(20), envio],
    orderName: [sql.NVarChar(50), payload.name ? String(payload.name).slice(0, 50) : null],
    totalCompra: [sql.Decimal(18, 2), numeroODefault(payload.current_total_price ?? payload.total_price)],
    moneda: [sql.NVarChar(10), payload.currency ? String(payload.currency).slice(0, 10) : null],
    fechaCompra: [sql.DateTime2, fechaArgentina(payload.created_at)],
  });

  if (link.estado !== estadoFinal) console.log(`[links] Link ${link.id} (cliente ${clienteId}) pasó a ${estadoFinal} (orden ${payload.name || orderId}).`);
  if (cancelado) return true;

  // Mismos avisos por WhatsApp que los pedidos (si el Cliente los activó en Integraciones).
  const nombre = payload.name || link.shopifyOrderName || 'tu pedido';
  if (pago === 'pagado' && link.shopifyPago !== 'pagado') {
    await avisos.avisar({
      clienteId, userId: link.userId, tipo: 'pago', clave: `pago:link:${link.id}`,
      texto: `¡Recibimos el pago de tu pedido ${nombre}! Gracias por tu compra 🙌`,
      datos: { orderName: nombre },
    });
  }
  if (ENVIADOS.includes(envio) && !ENVIADOS.includes(link.shopifyEnvio)) {
    const f = [...(payload.fulfillments || [])].reverse().find(x => x.status !== 'cancelled' && (x.tracking_url || x.tracking_urls?.length || x.tracking_number));
    const url = f && (f.tracking_url || f.tracking_urls?.[0]);
    const trackingUrl = url && /^https?:\/\//i.test(url) ? url : null;
    const trackingNumero = f?.tracking_number || null;
    const lineas = [envio === 'parcial' ? `¡Ya salió parte de tu pedido ${nombre}! 🚚` : `¡Tu pedido ${nombre} ya está en camino! 🚚`];
    if (trackingUrl) lineas.push(`Seguilo acá: ${trackingUrl}`);
    else if (trackingNumero) lineas.push(`Número de seguimiento: ${trackingNumero}`);
    await avisos.avisar({
      clienteId, userId: link.userId, tipo: 'envio', clave: `envio:link:${link.id}`,
      texto: lineas.join('\n'),
      datos: { orderName: nombre, trackingUrl, trackingNumero },
    });
  }
  return true;
}

function filtroEstado(valor) {
  return ESTADOS.includes(valor) ? valor : null;
}
function filtroDias(valor) {
  const n = parseInt(valor, 10);
  return PERIODOS.includes(n) ? n : null;
}

async function listar(clienteId, { page = 1, estado = null, dias = null } = {}) {
  const r = await ejecutar('dbo.usp_Portal_LinksCompraListar', {
    clienteId: [sql.Int, clienteId],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
    estado: [sql.NVarChar(20), filtroEstado(estado)],
    dias: [sql.Int, filtroDias(dias)],
  });
  const resumen = r.recordsets[0][0];
  const rows = r.recordsets[1].map((f) => {
    let items = [];
    try { items = JSON.parse(f.items); } catch { /* fila vieja o rota: sin detalle */ }
    return { ...f, items };
  });
  return {
    resumen,
    rows,
    page,
    pageSize: PAGE_SIZE,
    total: resumen.filtrados,
    totalPages: Math.max(1, Math.ceil(resumen.filtrados / PAGE_SIZE)),
  };
}

// null si no tiene Shopify conectado (o todavía no se corrió el SQL).
async function leerConfig(clienteId) {
  let r;
  try {
    r = await ejecutar('dbo.usp_Portal_LinkCompraConfigObtener', { clienteId: [sql.Int, clienteId] });
  } catch (err) {
    if (sinProcedure(err)) return null;
    throw err;
  }
  const fila = r.recordset[0];
  return fila ? { activo: Boolean(fila.linkCompra) } : null;
}

async function guardarConfig(clienteId, activo) {
  const r = await ejecutar('dbo.usp_Portal_LinkCompraConfigSet', {
    clienteId: [sql.Int, clienteId],
    activo: [sql.Bit, activo ? 1 : 0],
  });
  return (r.recordset[0]?.cambiados ?? 0) > 0;
}

module.exports = { actualizarDesdeOrden, tokenDeOrden, listar, leerConfig, guardarConfig, filtroEstado, filtroDias };
