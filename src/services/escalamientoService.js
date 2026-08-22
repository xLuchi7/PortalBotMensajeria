const { getPool, sql } = require('./db');

async function listarEscalamientos(clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query(`
      SELECT
        e.id, e.userId, e.motivo, e.resuelto,
        e.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria AS fecha
      FROM Escalamientos e
      JOIN Clientes c ON c.id = e.clienteId
      WHERE e.clienteId = @clienteId
      ORDER BY e.resuelto ASC, e.id DESC
    `);

  return result.recordset;
}

async function marcarResuelto(id, clienteId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('clienteId', sql.Int, clienteId)
    .query('UPDATE Escalamientos SET resuelto = 1 WHERE id = @id AND clienteId = @clienteId');
}

module.exports = { listarEscalamientos, marcarResuelto };
