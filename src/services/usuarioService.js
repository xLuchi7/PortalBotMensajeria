const bcrypt = require('bcryptjs');
const { getPool, sql } = require('./db');

async function autenticar(email, password) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query(`
      SELECT u.id, u.clienteId, u.email, u.passwordHash, c.razonSocial
      FROM Usuarios u
      JOIN Clientes c ON c.id = u.clienteId
      WHERE u.email = @email AND u.activo = 1 AND c.activo = 1
    `);

  const usuario = result.recordset[0];
  if (!usuario) return null;

  const ok = await bcrypt.compare(password, usuario.passwordHash);
  if (!ok) return null;

  return { id: usuario.id, clienteId: usuario.clienteId, email: usuario.email, razonSocial: usuario.razonSocial };
}

module.exports = { autenticar };
