const { ejecutar, sql } = require('./db');

const PAGE_SIZE = 20;
// Los que se eligen a mano desde el portal ("reclamado" lo pone el bot).
const ESTADOS_ELEGIBLES = ['pendiente', 'confirmado', 'entregado', 'cancelado', 'solucionado'];

async function listarPedidos(clienteId, page = 1) {
  const r = await ejecutar('dbo.usp_Portal_PedidosListar', {
    clienteId: [sql.Int, clienteId],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const resumen = r.recordsets[0][0];
  const total = resumen.total;

  return {
    rows: r.recordsets[1],
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    totalMonto: resumen.totalMonto,
    pendientes: resumen.pendientes || 0,
    reclamados: resumen.reclamados || 0,
  };
}

async function obtenerDetalle(pedidoId, clienteId) {
  const r = await ejecutar('dbo.usp_Portal_PedidoDetalle', {
    pedidoId: [sql.Int, pedidoId],
    clienteId: [sql.Int, clienteId],
  });
  return r.recordset;
}

// entregado/cancelado/solucionado son estados finales: una vez ahi, no se puede
// volver a tocar el pedido. Al marcar "entregado" se descuenta el Stock recien ahi
// (no al crear el pedido), porque es cuando realmente salio la mercaderia.
// "reclamado" lo pone el bot directamente en la base (ver Bot_Mensajeria) y su
// único paso siguiente es "solucionado", que devuelve el stock solo si se había
// descontado (Pedidos.stockDescontado) y resuelve los reclamos del pedido.
// omitirStock: el Cliente tiene Shopify conectado, que es quien maneja el
// inventario (descuenta al crear la orden y nos avisa por webhook) -- tocar el
// Stock local ademas lo descontaria dos veces.
// Todo pasa en usp_Portal_PedidoEstadoSet con el pedido bloqueado: dos clics (o dos
// pestañas) a la vez ya no descuentan el stock dos veces.
// Devuelve 'ok' | 'no_existe' | 'final' | 'solo_solucionado' | 'invalido'.
async function actualizarEstado(pedidoId, clienteId, nuevoEstado, { omitirStock = false } = {}) {
  const result = await ejecutar('dbo.usp_Portal_PedidoEstadoSet', {
    pedidoId: [sql.Int, pedidoId],
    clienteId: [sql.Int, clienteId],
    estado: [sql.NVarChar(20), nuevoEstado],
    omitirStock: [sql.Bit, omitirStock],
  });
  return result.recordset[0]?.resultado ?? 'no_existe';
}

// Las notas son metadata libre del staff, no un paso del flujo de estados —
// se pueden editar en cualquier momento, incluso con el pedido en un estado final.
async function actualizarNotas(pedidoId, clienteId, notas) {
  await ejecutar('dbo.usp_Portal_PedidoNotasSet', {
    pedidoId: [sql.Int, pedidoId],
    clienteId: [sql.Int, clienteId],
    notas: [sql.NVarChar(500), notas || null],
  });
}

module.exports = { listarPedidos, obtenerDetalle, actualizarEstado, actualizarNotas, ESTADOS_ELEGIBLES };
