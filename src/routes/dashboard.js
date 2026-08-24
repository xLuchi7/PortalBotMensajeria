const express = require('express');
const { requireAuth, requireAdmin, resolveClienteAccess } = require('../middleware/requireAuth');
const mensajes = require('../services/mensajeService');
const escalamientos = require('../services/escalamientoService');
const pedidos = require('../services/pedidoService');
const clientes = require('../services/clienteService');
const articulos = require('../services/articuloService');
const consultas = require('../services/consultaService');

const router = express.Router();
router.use(requireAuth);

function paginaDe(req) {
  return Math.max(1, parseInt(req.query.page, 10) || 1);
}

router.get('/', (req, res) => {
  if (req.session.usuario.rol === 'admin') return res.redirect('/clientes');
  res.redirect(`/clientes/${req.session.usuario.clienteId}/mensajes`);
});

// ── Admin: listado de Clientes ─────────────────────────────────────────────

router.get('/clientes', requireAdmin, async (req, res, next) => {
  try {
    const resultado = await clientes.listarClientes(paginaDe(req));
    res.render('clientes', { usuario: req.session.usuario, ...resultado });
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/nuevo', requireAdmin, (req, res) => {
  res.render('cliente-form', { usuario: req.session.usuario, editar: null, error: null });
});

router.post('/clientes/nuevo', requireAdmin, async (req, res, next) => {
  try {
    const { razonSocial, cuit, telefono, email, zonaHoraria } = req.body;
    await clientes.crearCliente({ razonSocial, cuit, telefono, email, zonaHoraria });
    res.redirect('/clientes');
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      return res.render('cliente-form', {
        usuario: req.session.usuario,
        editar: null,
        error: 'Ya existe un Cliente con ese CUIT o teléfono.',
      });
    }
    next(err);
  }
});

router.get('/clientes/:clienteId/editar', requireAdmin, async (req, res, next) => {
  try {
    const editar = await clientes.obtenerCliente(req.params.clienteId);
    if (!editar) return res.status(404).send('Cliente no encontrado.');
    res.render('cliente-form', { usuario: req.session.usuario, editar, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/editar', requireAdmin, async (req, res, next) => {
  try {
    const { razonSocial, cuit, telefono, email, zonaHoraria } = req.body;
    await clientes.actualizarCliente(req.params.clienteId, { razonSocial, cuit, telefono, email, zonaHoraria });
    res.redirect('/clientes');
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      const editar = await clientes.obtenerCliente(req.params.clienteId);
      return res.render('cliente-form', {
        usuario: req.session.usuario,
        editar,
        error: 'Ya existe otro Cliente con ese CUIT o teléfono.',
      });
    }
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

router.post('/clientes/:clienteId/activar', requireAdmin, async (req, res, next) => {
  try {
    await clientes.activarCliente(req.params.clienteId);
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

// ── Datos de un Cliente puntual (el propio, o cualquiera si sos admin) ─────

router.get('/clientes/:clienteId/articulos', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, resultado] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      articulos.listarArticulos(req.clienteId, paginaDe(req)),
    ]);
    res.render('articulos', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, ...resultado });
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/articulos/nuevo', resolveClienteAccess, (req, res) => {
  res.render('articulo-form', { usuario: req.session.usuario, clienteId: req.clienteId, editar: null, error: null });
});

router.post('/clientes/:clienteId/articulos/nuevo', resolveClienteAccess, async (req, res, next) => {
  try {
    const { codigo, nombre, descripcion, precio, cantidadInicial, usaStock } = req.body;
    await articulos.crearArticulo(req.clienteId, { codigo, nombre, descripcion, precio, cantidadInicial, usaStock: !!usaStock });
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/articulos/:id/editar', resolveClienteAccess, async (req, res, next) => {
  try {
    const editar = await articulos.obtenerArticulo(req.params.id, req.clienteId);
    if (!editar) return res.status(404).send('Artículo no encontrado.');
    res.render('articulo-form', { usuario: req.session.usuario, clienteId: req.clienteId, editar, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/editar', resolveClienteAccess, async (req, res, next) => {
  try {
    const { codigo, nombre, descripcion, precio, usaStock } = req.body;
    await articulos.actualizarArticulo(req.params.id, req.clienteId, { codigo, nombre, descripcion, precio, usaStock: !!usaStock });
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/stock', resolveClienteAccess, async (req, res, next) => {
  try {
    await articulos.actualizarStock(req.params.id, req.clienteId, req.body.cantidad);
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/borrar', resolveClienteAccess, async (req, res, next) => {
  try {
    await articulos.desactivarArticulo(req.params.id, req.clienteId);
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/activar', resolveClienteAccess, async (req, res, next) => {
  try {
    await articulos.activarArticulo(req.params.id, req.clienteId);
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/mensajes', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, resultado] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      mensajes.listarMensajes(req.clienteId, paginaDe(req)),
    ]);
    res.render('mensajes', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, ...resultado });
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/escalamientos', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, resultado] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      escalamientos.listarEscalamientos(req.clienteId, paginaDe(req)),
    ]);
    res.render('escalamientos', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, ...resultado });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/escalamientos/:id/estado', resolveClienteAccess, async (req, res, next) => {
  try {
    await escalamientos.actualizarEstado(req.params.id, req.clienteId, req.body.estado);
    res.redirect(`/clientes/${req.clienteId}/escalamientos`);
  } catch (err) {
    if (err instanceof escalamientos.EstadoFinalError) {
      console.warn(`[escalamientos] Intento de modificar un escalamiento ya resuelto (id=${req.params.id})`);
      return res.redirect(`/clientes/${req.clienteId}/escalamientos`);
    }
    next(err);
  }
});

router.get('/clientes/:clienteId/pedidos', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, resultado] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      pedidos.listarPedidos(req.clienteId, paginaDe(req)),
    ]);
    res.render('pedidos', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, ...resultado });
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

router.get('/clientes/:clienteId/consultas', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, resultado] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      consultas.listarConsultas(req.clienteId, paginaDe(req)),
    ]);
    res.render('consultas', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, ...resultado });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/pedidos/:id/estado', resolveClienteAccess, async (req, res, next) => {
  try {
    await pedidos.actualizarEstado(req.params.id, req.clienteId, req.body.estado);
    res.redirect(`/clientes/${req.clienteId}/pedidos`);
  } catch (err) {
    if (err instanceof pedidos.EstadoFinalError) {
      console.warn(`[pedidos] Intento de modificar un pedido ya finalizado (id=${req.params.id})`);
      return res.redirect(`/clientes/${req.clienteId}/pedidos`);
    }
    next(err);
  }
});

module.exports = router;
