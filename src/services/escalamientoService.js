const { ejecutar, sql } = require('./db');

const PAGE_SIZE = 20;
const ESTADOS = ['pendiente', 'en_proceso', 'resuelto'];

// Los "[Revisión humana]" son registros viejos (antes la revisión humana se
// guardaba como escalamiento): el procedure los saca, igual que en Inicio y en Chats.
async function listarEscalamientos(clienteId, page = 1) {
  const r = await ejecutar('dbo.usp_Portal_EscalamientosListar', {
    clienteId: [sql.Int, clienteId],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const { total, pendientes } = r.recordsets[0][0];

  return {
    rows: r.recordsets[1],
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    pendientes,
  };
}

// Con bloqueo en usp_Portal_EscalamientoEstadoSet.
// Devuelve 'ok' | 'no_existe' | 'final' | 'invalido'.
async function actualizarEstado(id, clienteId, nuevoEstado) {
  const result = await ejecutar('dbo.usp_Portal_EscalamientoEstadoSet', {
    id: [sql.BigInt, id],
    clienteId: [sql.Int, clienteId],
    estado: [sql.NVarChar(20), nuevoEstado],
  });
  return result.recordset[0]?.resultado ?? 'no_existe';
}

module.exports = { listarEscalamientos, actualizarEstado, ESTADOS };
