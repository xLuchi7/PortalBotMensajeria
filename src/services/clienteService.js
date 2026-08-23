const { getPool, sql } = require('./db');

async function listarClientes() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT id, razonSocial, cuit, telefono, email, activo
    FROM Clientes
    ORDER BY activo DESC, razonSocial
  `);
  return result.recordset;
}

async function listarClientesActivos() {
  const pool = await getPool();
  const result = await pool
    .request()
    .query('SELECT id, razonSocial FROM Clientes WHERE activo = 1 ORDER BY razonSocial');
  return result.recordset;
}

async function obtenerCliente(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, razonSocial, cuit, telefono, email, activo FROM Clientes WHERE id = @id');
  return result.recordset[0] ?? null;
}

// No borramos de verdad: desactivar preserva el historial (Mensajes, Pedidos,
// Escalamientos) y ya corta el acceso del bot y del portal, porque ambos
// filtran por Clientes.activo = 1.
async function desactivarCliente(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.Int, id).query('UPDATE Clientes SET activo = 0 WHERE id = @id');
}

module.exports = { listarClientes, listarClientesActivos, obtenerCliente, desactivarCliente };
