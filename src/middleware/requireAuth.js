function requireAuth(req, res, next) {
  if (!req.session.usuario) {
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.usuario.rol !== 'admin') {
    return res.redirect('/');
  }
  next();
}

// Habilita /clientes/:clienteId/... — un admin puede entrar a cualquier Cliente,
// un usuario de tipo "cliente" solo al suyo.
function resolveClienteAccess(req, res, next) {
  const clienteId = parseInt(req.params.clienteId, 10);
  const { usuario } = req.session;

  if (usuario.rol !== 'admin' && usuario.clienteId !== clienteId) {
    return res.redirect('/');
  }

  req.clienteId = clienteId;
  next();
}

module.exports = { requireAuth, requireAdmin, resolveClienteAccess };
