const { getPool, sql } = require('./db');

const PAGE_SIZE = 20;

class EstadoFinalError extends Error {
  constructor() {
    super('El escalamiento ya está resuelto y no se puede modificar.');
    this.name = 'EstadoFinalError';
  }
}

async function listarEscalamientos(clienteId, page = 1) {
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, pendientesResult, rowsResult] = await Promise.all([
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT COUNT(*) AS total FROM Escalamientos WHERE clienteId = @clienteId'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query("SELECT COUNT(*) AS pendientes FROM Escalamientos WHERE clienteId = @clienteId AND estado <> 'resuelto'"),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, PAGE_SIZE)
      .query(`
        SELECT
          e.id, e.userId, e.motivo, e.estado,
          FORMAT(e.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'dd/MM/yyyy, HH:mm:ss') AS fecha
        FROM Escalamientos e
        JOIN Clientes c ON c.id = e.clienteId
        WHERE e.clienteId = @clienteId
        ORDER BY CASE WHEN e.estado = 'resuelto' THEN 1 ELSE 0 END, e.id DESC
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
    pendientes: pendientesResult.recordset[0].pendientes,
  };
}

async function actualizarEstado(id, clienteId, nuevoEstado) {
  const pool = await getPool();

  const actual = await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('clienteId', sql.Int, clienteId)
    .query('SELECT estado FROM Escalamientos WHERE id = @id AND clienteId = @clienteId');

  const escalamiento = actual.recordset[0];
  if (!escalamiento) throw new Error('Escalamiento no encontrado.');
  if (escalamiento.estado === 'resuelto') throw new EstadoFinalError();

  await pool
    .request()
    .input('id', sql.BigInt, id)
    .input('clienteId', sql.Int, clienteId)
    .input('estado', sql.NVarChar, nuevoEstado)
    .query('UPDATE Escalamientos SET estado = @estado WHERE id = @id AND clienteId = @clienteId');
}

module.exports = { listarEscalamientos, actualizarEstado, EstadoFinalError };
