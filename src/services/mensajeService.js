const { getPool, sql } = require('./db');

async function listarMensajes(clienteId, limit = 200) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        m.id, m.userId, m.platform, m.role, m.content, m.esError,
        m.createdAt AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria AS fecha
      FROM Mensajes m
      JOIN Clientes c ON c.id = m.clienteId
      WHERE m.clienteId = @clienteId
      ORDER BY m.id DESC
    `);

  return result.recordset;
}

module.exports = { listarMensajes };
