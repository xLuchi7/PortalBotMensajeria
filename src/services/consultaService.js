const { getPool, sql } = require('./db');

const PAGE_SIZE = 20;

async function listarConsultas(clienteId, page = 1) {
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, sinStockResult, rowsResult] = await Promise.all([
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT COUNT(*) AS total FROM VConsultas WHERE clienteId = @clienteId'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT COUNT(*) AS sinStock FROM VConsultas WHERE clienteId = @clienteId AND sinStock = 1'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, PAGE_SIZE)
      .query(`
        SELECT
          v.tipo, v.userId, v.detalle, v.articuloNombre, v.sinStock, v.pedidoId, v.pedidoEstado,
          FORMAT(v.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'dd/MM/yyyy, HH:mm:ss') AS fecha
        FROM VConsultas v
        JOIN Clientes c ON c.id = v.clienteId
        WHERE v.clienteId = @clienteId
        ORDER BY v.fechaAlta DESC
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
    sinStock: sinStockResult.recordset[0].sinStock,
  };
}

module.exports = { listarConsultas };
