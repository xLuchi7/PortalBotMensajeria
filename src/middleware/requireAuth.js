// Las rutas de /api responden JSON (el frontend en React decide adónde ir); las
// demás (el flujo de Shopify, que navega el navegador) redirigen como siempre.
function esApi(req) {
  return req.originalUrl.startsWith('/api/');
}

function requireAuth(req, res, next) {
  if (!req.session.usuario) {
    if (esApi(req)) return res.status(401).json({ ok: false, sesion: false, mensaje: 'Tu Sesión Venció, Volvé A Ingresar' });
    return res.redirect('/login');
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

module.exports = { requireAuth, requireAdmin, resolveClienteAccess };
