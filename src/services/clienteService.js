const { getPool, sql } = require('./db');

const PAGE_SIZE = 20;

// Clientes.telefono se guarda solo con dígitos (sin +, espacios ni guiones) —
// es como el bot matchea el número de WhatsApp entrante contra este Cliente.
function normalizePhone(phoneNumber) {
  return (phoneNumber || '').replace(/\D/g, '');
}

async function listarClientes(page = 1) {
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, activosResult, rowsResult] = await Promise.all([
    pool.request().query('SELECT COUNT(*) AS total FROM Clientes'),
    pool.request().query('SELECT COUNT(*) AS activos FROM Clientes WHERE activo = 1'),
    pool
      .request()
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, PAGE_SIZE)
      .query(`
        SELECT id, razonSocial, cuit, telefono, email, activo
        FROM Clientes
        ORDER BY activo DESC, razonSocial
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
    activos: activosResult.recordset[0].activos,
  };
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
