const bcrypt = require('bcryptjs');
const { ejecutar, sql } = require('./db');

const PAGE_SIZE = 20;
const COSTO_BCRYPT = 12;
const PASSWORD_MIN = 10;
// Si el email no existe igual se compara contra este hash: así la respuesta tarda
// lo mismo y no se puede adivinar qué emails tienen cuenta midiendo el tiempo.
const HASH_FALSO = bcrypt.hashSync('contraseña-que-no-existe', COSTO_BCRYPT);

// passwordCambiadaEn viaja en la sesión como texto: si cambia, requireAuth corta la sesión.
const marcaPassword = fecha => (fecha ? new Date(fecha).toISOString() : null);

async function autenticar(email, password) {
  const result = await ejecutar('dbo.usp_Portal_UsuarioAutenticar', { email: [sql.NVarChar(200), email] });
  const usuario = result.recordset[0];

  const ok = await bcrypt.compare(password, usuario?.passwordHash || HASH_FALSO);
  if (!usuario || !ok) return null;

  // Hashes viejos (costo 10): se rehacen con el costo actual, sin cortar sesiones.
  if (bcrypt.getRounds(usuario.passwordHash) < COSTO_BCRYPT) {
    bcrypt.hash(password, COSTO_BCRYPT)
      .then(hash => ejecutar('dbo.usp_Portal_UsuarioHashActualizar', { id: [sql.Int, usuario.id], passwordHash: [sql.NVarChar(200), hash] }))
      .catch(err => console.error('[auth] No se pudo actualizar el hash:', err.message));
  }

  return {
    id: usuario.id,
    clienteId: usuario.clienteId,
    email: usuario.email,
    rol: usuario.rol,
    razonSocial: usuario.razonSocial,
    passwordCambiadaEn: marcaPassword(usuario.passwordCambiadaEn),
  };
}

// Estado actual del usuario y su Cliente (lo usa requireAuth). null = ya no existe.
async function estadoSesion(usuarioId) {
  const result = await ejecutar('dbo.usp_Portal_SesionValidar', { usuarioId: [sql.Int, usuarioId] });
  const u = result.recordset[0];
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    rol: u.rol,
    clienteId: u.clienteId,
    razonSocial: u.razonSocial,
    activo: Boolean(u.activo) && Boolean(u.clienteActivo),
    passwordCambiadaEn: marcaPassword(u.passwordCambiadaEn),
  };
}

async function listarUsuarios(page = 1) {
  const result = await ejecutar('dbo.usp_Portal_UsuariosListar', {
    offset: [sql.Int, (page - 1) * PAGE_SIZE],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const total = result.recordsets[0][0].total;
  return {
    rows: result.recordsets[1],
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

async function obtenerUsuario(id) {
  const result = await ejecutar('dbo.usp_Portal_UsuarioObtener', { id: [sql.Int, id] });
  return result.recordset[0] ?? null;
}

async function crearUsuario({ email, password, rol, clienteId }) {
  const passwordHash = await bcrypt.hash(password, COSTO_BCRYPT);
  await ejecutar('dbo.usp_Portal_UsuarioCrear', {
    email: [sql.NVarChar(200), email],
    passwordHash: [sql.NVarChar(200), passwordHash],
    rol: [sql.NVarChar(20), rol],
    clienteId: [sql.Int, rol === 'admin' ? null : clienteId],
  });
}

// Devuelve la nueva marca de contraseña (para no cortarle la sesión a quien se la cambia a sí mismo).
async function actualizarUsuario(id, { email, rol, clienteId, password }) {
  const passwordHash = password ? await bcrypt.hash(password, COSTO_BCRYPT) : null;
  const result = await ejecutar('dbo.usp_Portal_UsuarioActualizar', {
    id: [sql.Int, id],
    email: [sql.NVarChar(200), email],
    rol: [sql.NVarChar(20), rol],
    clienteId: [sql.Int, rol === 'admin' ? null : clienteId],
    passwordHash: [sql.NVarChar(200), passwordHash],
  });
  return marcaPassword(result.recordset[0]?.passwordCambiadaEn);
}

async function borrarUsuario(id) {
  await ejecutar('dbo.usp_Portal_UsuarioBorrar', { id: [sql.Int, id] });
}

module.exports = { autenticar, estadoSesion, listarUsuarios, obtenerUsuario, crearUsuario, actualizarUsuario, borrarUsuario, PASSWORD_MIN };
