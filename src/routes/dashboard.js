const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const mensajes = require('../services/mensajeService');
const escalamientos = require('../services/escalamientoService');
const pedidos = require('../services/pedidoService');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => res.redirect('/mensajes'));

router.get('/mensajes', async (req, res, next) => {
  try {
    const lista = await mensajes.listarMensajes(req.session.usuario.clienteId);
    res.render('mensajes', { usuario: req.session.usuario, mensajes: lista });
  } catch (err) {
    next(err);
  }
});

router.get('/escalamientos', async (req, res, next) => {
  try {
    const lista = await escalamientos.listarEscalamientos(req.session.usuario.clienteId);
    res.render('escalamientos', { usuario: req.session.usuario, escalamientos: lista });
  } catch (err) {
    next(err);
  }
});

router.post('/escalamientos/:id/resolver', async (req, res, next) => {
  try {
    await escalamientos.marcarResuelto(req.params.id, req.session.usuario.clienteId);
    res.redirect('/escalamientos');
  } catch (err) {
    next(err);
  }
});

router.get('/pedidos', async (req, res, next) => {
  try {
    const lista = await pedidos.listarPedidos(req.session.usuario.clienteId);
    res.render('pedidos', { usuario: req.session.usuario, pedidos: lista });
  } catch (err) {
    next(err);
  }
});

router.get('/pedidos/:id', async (req, res, next) => {
  try {
    const detalle = await pedidos.obtenerDetalle(req.params.id, req.session.usuario.clienteId);
    res.render('pedido-detalle', { usuario: req.session.usuario, pedidoId: req.params.id, items: detalle });
  } catch (err) {
    next(err);
  }
});

router.post('/pedidos/:id/estado', async (req, res, next) => {
  try {
    await pedidos.actualizarEstado(req.params.id, req.session.usuario.clienteId, req.body.estado);
    res.redirect('/pedidos');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
