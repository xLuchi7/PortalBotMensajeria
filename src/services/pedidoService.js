const { getPool, sql } = require('./db');

async function listarPedidos(clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query(`
      SELECT
        p.id, p.userId, p.estado, p.total, p.notas,
        p.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria AS fecha
      FROM Pedidos p
      JOIN Clientes c ON c.id = p.clienteId
      WHERE p.clienteId = @clienteId
      ORDER BY p.id DESC
    `);

  return result.recordset;
}

async function obtenerDetalle(pedidoId, clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('pedidoId', sql.Int, pedidoId)
    .input('clienteId', sql.Int, clienteId)
    .query(`
      SELECT d.id, a.nombre, d.cantidad, d.precioUnitario, d.subtotal
      FROM DetallePedidos d
      JOIN Articulos a ON a.id = d.articuloId
      JOIN Pedidos p ON p.id = d.pedidoId
      WHERE d.pedidoId = @pedidoId AND p.clienteId = @clienteId
    `);

  return result.recordset;
}

async function actualizarEstado(pedidoId, clienteId, estado) {
  const pool = await getPool();
  await pool
    .request()
    .input('pedidoId', sql.Int, pedidoId)
    .input('clienteId', sql.Int, clienteId)
    .input('estado', sql.NVarChar, estado)
    .query('UPDATE Pedidos SET estado = @estado WHERE id = @pedidoId AND clienteId = @clienteId');
}

module.exports = { listarPedidos, obtenerDetalle, actualizarEstado };
