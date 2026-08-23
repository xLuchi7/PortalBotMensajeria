const express = require('express');
const { requireAuth, requireAdmin, resolveClienteAccess } = require('../middleware/requireAuth');
const mensajes = require('../services/mensajeService');
const escalamientos = require('../services/escalamientoService');
const pedidos = require('../services/pedidoService');
const clientes = require('../services/clienteService');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  if (req.session.usuario.rol === 'admin') return res.redirect('/clientes');
  res.redirect(`/clientes/${req.session.usuario.clienteId}/mensajes`);
});

// ── Admin: listado de Clientes ─────────────────────────────────────────────

router.get('/clientes', requireAdmin, async (req, res, next) => {
  try {
    const lista = await clientes.listarClientes();
    res.render('clientes', { usuario: req.session.usuario, clientes: lista });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/borrar', requireAdmin, async (req, res, next) => {
  try {
    await clientes.desactivarCliente(req.params.clienteId);
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

// ── Datos de un Cliente puntual (el propio, o cualquiera si sos admin) ─────

router.get('/clientes/:clienteId/mensajes', resolveClienteAccess, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const [cliente, resultado] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      mensajes.listarMensajes(req.clienteId, page),
    ]);
    res.render('mensajes', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, ...resultado });
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/escalamientos', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, lista] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      escalamientos.listarEscalamientos(req.clienteId),
    ]);
    res.render('escalamientos', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, escalamientos: lista });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/escalamientos/:id/resolver', resolveClienteAccess, async (req, res, next) => {
  try {
    await escalamientos.marcarResuelto(req.params.id, req.clienteId);
    res.redirect(`/clientes/${req.clienteId}/escalamientos`);
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/pedidos', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, lista] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      pedidos.listarPedidos(req.clienteId),
    ]);
    res.render('pedidos', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, pedidos: lista });
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/pedidos/:id', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, detalle] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      pedidos.obtenerDetalle(req.params.id, req.clienteId),
    ]);
    res.render('pedido-detalle', {
      usuario: req.session.usuario,
      cliente,
      clienteId: req.clienteId,
      pedidoId: req.params.id,
      items: detalle,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/pedidos/:id/estado', resolveClienteAccess, async (req, res, next) => {
  try {
    await pedidos.actualizarEstado(req.params.id, req.clienteId, req.body.estado);
    res.redirect(`/clientes/${req.clienteId}/pedidos`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
