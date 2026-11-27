const { ejecutar, sql } = require('./db');

const PAGE_SIZE = 20;

async function listarConsultas(clienteId, page = 1) {
  const r = await ejecutar('dbo.usp_Portal_ConsultasListar', {
    clienteId: [sql.Int, clienteId],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const { total, sinStock } = r.recordsets[0][0];

  return {
    rows: r.recordsets[1],
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    sinStock,
  };
}

module.exports = { listarConsultas };
