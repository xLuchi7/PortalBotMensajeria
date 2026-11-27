const usuarios = require('../services/usuarioService');

// Las rutas de /api responden JSON (el frontend en React decide adónde ir); las
// demás (el flujo de Shopify, que navega el navegador) redirigen como siempre.
function esApi(req) {
  return req.originalUrl.startsWith('/api/');
}

function sinSesion(req, res) {
  if (esApi(req)) return res.status(401).json({ ok: false, sesion: false, mensaje: 'Tu Sesión Venció, Volvé A Ingresar' });
  return res.redirect('/login');
}

// La sesión guarda una foto del usuario del momento del login. Cada VALIDEZ_MS se
// vuelve a mirar en la base: si lo borraron o desactivaron (a él o a su Cliente),
// o si le cambiaron la contraseña, la sesión se corta; si le cambiaron el rol o
// el Cliente, se actualiza. invalidar() fuerza a mirar de nuevo en el próximo pedido.
const VALIDEZ_MS = 30 * 1000;
const cache = new Map(); // usuarioId -> { en, estado }

async function estadoActual(usuarioId) {
  const guardado = cache.get(usuarioId);
  if (guardado && Date.now() - guardado.en < VALIDEZ_MS) return guardado.estado;
  const estado = await usuarios.estadoSesion(usuarioId);
  cache.set(usuarioId, { en: Date.now(), estado });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return estado;
}

function invalidar(usuarioId) {
  if (usuarioId == null) cache.clear();
  else cache.delete(usuarioId);
}

async function requireAuth(req, res, next) {
  const usuario = req.session.usuario;
  if (!usuario) return sinSesion(req, res);

  let estado;
  try {
    estado = await estadoActual(usuario.id);
  } catch (err) {
    return next(err);
  }

  if (!estado || !estado.activo || estado.passwordCambiadaEn !== (req.session.passwordMarca ?? null)) {
    console.warn(`[auth] Sesión cortada para ${usuario.email}: ${!estado ? 'usuario borrado' : !estado.activo ? 'usuario o Cliente inactivo' : 'cambió la contraseña'}`);
    return req.session.destroy(() => sinSesion(req, res));
  }

  if (estado.rol !== usuario.rol || estado.clienteId !== usuario.clienteId || estado.email !== usuario.email || estado.razonSocial !== usuario.razonSocial) {
    req.session.usuario = { ...usuario, rol: estado.rol, clienteId: estado.clienteId, email: estado.email, razonSocial: estado.razonSocial };
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.usuario.rol !== 'admin') {
    if (esApi(req)) return res.status(403).json({ ok: false, mensaje: 'No Tenés Permiso Para Esto' });
    return res.redirect('/');
  }
  next();
}

// Habilita /clientes/:clienteId/... — un admin puede entrar a cualquier Cliente,
// un usuario de tipo "cliente" solo al suyo.
function resolveClienteAccess(req, res, next) {
  const clienteId = parseInt(req.params.clienteId, 10);
  const { usuario } = req.session;

  if (!clienteId || (usuario.rol !== 'admin' && usuario.clienteId !== clienteId)) {
    if (esApi(req)) return res.status(403).json({ ok: false, mensaje: 'No Tenés Acceso A Este Cliente' });
    return res.redirect('/');
  }

  req.clienteId = clienteId;
  next();
}

module.exports = { requireAuth, requireAdmin, resolveClienteAccess, invalidar };
