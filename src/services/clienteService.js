const { getPool, sql } = require('./db');

// Clientes.telefono se guarda solo con dígitos (sin +, espacios ni guiones) —
// es como el bot matchea el número de WhatsApp entrante contra este Cliente.
function normalizePhone(phoneNumber) {
  return (phoneNumber || '').replace(/\D/g, '');
}

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
    .query('SELECT id, razonSocial, cuit, telefono, email, activo, zonaHoraria FROM Clientes WHERE id = @id');
  return result.recordset[0] ?? null;
}

async function crearCliente({ razonSocial, cuit, telefono, email, zonaHoraria }) {
  const pool = await getPool();
  await pool
    .request()
    .input('razonSocial', sql.NVarChar, razonSocial)
    .input('cuit', sql.NVarChar, cuit)
    .input('telefono', sql.NVarChar, normalizePhone(telefono))
    .input('email', sql.NVarChar, email || null)
    .input('zonaHoraria', sql.NVarChar, zonaHoraria || 'Argentina Standard Time')
    .query(`
      INSERT INTO Clientes (razonSocial, cuit, telefono, email, zonaHoraria)
      VALUES (@razonSocial, @cuit, @telefono, @email, @zonaHoraria)
    `);
}

async function actualizarCliente(id, { razonSocial, cuit, telefono, email, zonaHoraria }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('razonSocial', sql.NVarChar, razonSocial)
    .input('cuit', sql.NVarChar, cuit)
    .input('telefono', sql.NVarChar, normalizePhone(telefono))
    .input('email', sql.NVarChar, email || null)
    .input('zonaHoraria', sql.NVarChar, zonaHoraria || 'Argentina Standard Time')
    .query(`
      UPDATE Clientes
      SET razonSocial = @razonSocial, cuit = @cuit, telefono = @telefono, email = @email, zonaHoraria = @zonaHoraria
      WHERE id = @id
    `);
}

// No borramos de verdad: desactivar preserva el historial (Mensajes, Pedidos,
// Escalamientos) y ya corta el acceso del bot y del portal, porque ambos
// filtran por Clientes.activo = 1.
async function desactivarCliente(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.Int, id).query('UPDATE Clientes SET activo = 0 WHERE id = @id');
}

async function activarCliente(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.Int, id).query('UPDATE Clientes SET activo = 1 WHERE id = @id');
}

module.exports = {
  listarClientes,
  listarClientesActivos,
  obtenerCliente,
  crearCliente,
  actualizarCliente,
  desactivarCliente,
  activarCliente,
};
