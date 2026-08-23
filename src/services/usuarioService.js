const bcrypt = require('bcryptjs');
const { getPool, sql } = require('./db');

async function autenticar(email, password) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('email', sql.NVarChar, email)
    .query(`
      SELECT u.id, u.clienteId, u.email, u.passwordHash, u.rol, c.razonSocial
      FROM Usuarios u
      LEFT JOIN Clientes c ON c.id = u.clienteId
      WHERE u.email = @email AND u.activo = 1 AND (c.activo = 1 OR u.clienteId IS NULL)
    `);

  const usuario = result.recordset[0];
  if (!usuario) return null;

  const ok = await bcrypt.compare(password, usuario.passwordHash);
  if (!ok) return null;

  return {
    id: usuario.id,
    clienteId: usuario.clienteId,
    email: usuario.email,
    rol: usuario.rol,
    razonSocial: usuario.razonSocial,
  };
}

async function listarUsuarios() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT u.id, u.email, u.rol, u.activo, u.clienteId, c.razonSocial
    FROM Usuarios u
    LEFT JOIN Clientes c ON c.id = u.clienteId
    ORDER BY u.rol, c.razonSocial, u.email
  `);
  return result.recordset;
}

async function obtenerUsuario(id) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .query('SELECT id, email, rol, clienteId, activo FROM Usuarios WHERE id = @id');
  return result.recordset[0] ?? null;
}

async function crearUsuario({ email, password, rol, clienteId }) {
  const pool = await getPool();
  const passwordHash = await bcrypt.hash(password, 10);
  await pool
    .request()
    .input('email', sql.NVarChar, email)
    .input('passwordHash', sql.NVarChar, passwordHash)
    .input('rol', sql.NVarChar, rol)
    .input('clienteId', sql.Int, rol === 'admin' ? null : clienteId)
    .query(`
      INSERT INTO Usuarios (email, passwordHash, rol, clienteId)
      VALUES (@email, @passwordHash, @rol, @clienteId)
    `);
}

async function actualizarUsuario(id, { email, rol, clienteId, password }) {
  const pool = await getPool();
  const request = pool
    .request()
    .input('id', sql.Int, id)
    .input('email', sql.NVarChar, email)
    .input('rol', sql.NVarChar, rol)
    .input('clienteId', sql.Int, rol === 'admin' ? null : clienteId);

  if (password) {
    const passwordHash = await bcrypt.hash(password, 10);
    await request
      .input('passwordHash', sql.NVarChar, passwordHash)
      .query(`
        UPDATE Usuarios
        SET email = @email, rol = @rol, clienteId = @clienteId, passwordHash = @passwordHash
        WHERE id = @id
      `);
  } else {
    await request.query(`
      UPDATE Usuarios
      SET email = @email, rol = @rol, clienteId = @clienteId
      WHERE id = @id
    `);
  }
}

async function borrarUsuario(id) {
  const pool = await getPool();
  await pool.request().input('id', sql.Int, id).query('DELETE FROM Usuarios WHERE id = @id');
}

module.exports = { autenticar, listarUsuarios, obtenerUsuario, crearUsuario, actualizarUsuario, borrarUsuario };
