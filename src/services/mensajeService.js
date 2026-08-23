const { getPool, sql } = require('./db');

const PAGE_SIZE = 50;

async function listarMensajes(clienteId, page = 1) {
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, rowsResult] = await Promise.all([
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT COUNT(*) AS total FROM Mensajes WHERE clienteId = @clienteId'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, PAGE_SIZE)
      .query(`
        SELECT
          m.id, m.userId, m.platform, m.role, m.content, m.esError,
          m.createdAt AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria AS fecha
        FROM Mensajes m
        JOIN Clientes c ON c.id = m.clienteId
        WHERE m.clienteId = @clienteId
        ORDER BY m.id DESC
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
  };
}

module.exports = { listarMensajes };
