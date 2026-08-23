const { getPool, sql } = require('./db');

const PAGE_SIZE = 20;
const ESTADOS_FINALES = ['entregado', 'cancelado'];

class EstadoFinalError extends Error {
  constructor() {
    super('El pedido ya está en un estado final y no se puede modificar.');
    this.name = 'EstadoFinalError';
  }
}

async function listarPedidos(clienteId, page = 1) {
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, sumResult, rowsResult] = await Promise.all([
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT COUNT(*) AS total FROM Pedidos WHERE clienteId = @clienteId'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT ISNULL(SUM(total), 0) AS totalMonto FROM Pedidos WHERE clienteId = @clienteId'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, PAGE_SIZE)
      .query(`
        SELECT
          p.id, p.userId, p.estado, p.total, p.notas,
          p.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria AS fecha
        FROM Pedidos p
        JOIN Clientes c ON c.id = p.clienteId
        WHERE p.clienteId = @clienteId
        ORDER BY p.id DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `),
  ]);

  const total = countResult.recordset[0].total;

  return {
    rows: rowsResult.recordset,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    totalMonto: sumResult.recordset[0].totalMonto,
  };
}

async function obtenerDetalle(pedidoId, clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('pedidoId', sql.Int, pedidoId)
    .input('clienteId', sql.Int, clienteId)
    .query(`
      SELECT d.id, d.articuloId, a.nombre, d.cantidad, d.precioUnitario, d.subtotal
      FROM DetallePedidos d
      JOIN Articulos a ON a.id = d.articuloId
      JOIN Pedidos p ON p.id = d.pedidoId
      WHERE d.pedidoId = @pedidoId AND p.clienteId = @clienteId
    `);

  return result.recordset;
}

// entregado/cancelado son estados finales: una vez ahi, no se puede volver a
// tocar el pedido. Al marcar "entregado" se descuenta el Stock recien ahi
// (no al crear el pedido), porque es cuando realmente salio la mercaderia.
async function actualizarEstado(pedidoId, clienteId, nuevoEstado) {
  const pool = await getPool();

  const actual = await pool
    .request()
    .input('pedidoId', sql.Int, pedidoId)
    .input('clienteId', sql.Int, clienteId)
    .query('SELECT estado FROM Pedidos WHERE id = @pedidoId AND clienteId = @clienteId');

  const pedido = actual.recordset[0];
  if (!pedido) throw new Error('Pedido no encontrado.');
  if (ESTADOS_FINALES.includes(pedido.estado)) throw new EstadoFinalError();

  if (nuevoEstado !== 'entregado') {
    await pool
      .request()
      .input('pedidoId', sql.Int, pedidoId)
      .input('clienteId', sql.Int, clienteId)
      .input('estado', sql.NVarChar, nuevoEstado)
      .query('UPDATE Pedidos SET estado = @estado WHERE id = @pedidoId AND clienteId = @clienteId');
    return;
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const items = await new sql.Request(transaction)
      .input('pedidoId', sql.Int, pedidoId)
      .query('SELECT articuloId, cantidad FROM DetallePedidos WHERE pedidoId = @pedidoId');

    for (const item of items.recordset) {
      await new sql.Request(transaction)
        .input('articuloId', sql.Int, item.articuloId)
        .input('cantidad', sql.Int, item.cantidad)
        .query('UPDATE Stock SET cantidad = cantidad - @cantidad, actualizado = SYSUTCDATETIME() WHERE articuloId = @articuloId');
    }

    await new sql.Request(transaction)
      .input('pedidoId', sql.Int, pedidoId)
      .input('clienteId', sql.Int, clienteId)
      .query("UPDATE Pedidos SET estado = 'entregado' WHERE id = @pedidoId AND clienteId = @clienteId");

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

module.exports = { listarPedidos, obtenerDetalle, actualizarEstado, EstadoFinalError };
