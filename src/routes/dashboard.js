const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin, resolveClienteAccess } = require('../middleware/requireAuth');
const mensajes = require('../services/mensajeService');
const escalamientos = require('../services/escalamientoService');
const pedidos = require('../services/pedidoService');
const clientes = require('../services/clienteService');
const articulos = require('../services/articuloService');
const consultas = require('../services/consultaService');
const importacion = require('../services/importService');
const { setFlash } = require('../services/flash');

const router = express.Router();
router.use(requireAuth);

const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
    setFlash(req, 'success', 'Cliente creado correctamente.');
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
    setFlash(req, 'success', 'Cliente actualizado correctamente.');
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
    setFlash(req, 'success', 'Cliente desactivado.');
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/activar', requireAdmin, async (req, res, next) => {
  try {
    await clientes.activarCliente(req.params.clienteId);
    setFlash(req, 'success', 'Cliente reactivado.');
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

// ── Datos de un Cliente puntual (el propio, o cualquiera si sos admin) ─────

router.get('/clientes/:clienteId/negocio', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, contexto] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      clientes.obtenerContexto(req.clienteId),
    ]);
    res.render('negocio', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, contexto });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/negocio', resolveClienteAccess, async (req, res, next) => {
  try {
    await clientes.actualizarContexto(req.clienteId, req.body.contextoNegocio);
    setFlash(req, 'success', 'Información guardada.');
    res.redirect(`/clientes/${req.clienteId}/negocio`);
  } catch (err) {
    next(err);
  }
});

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
    setFlash(req, 'success', 'Artículo creado correctamente.');
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
    setFlash(req, 'success', 'Artículo actualizado correctamente.');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/stock', resolveClienteAccess, async (req, res, next) => {
  try {
    await articulos.actualizarStock(req.params.id, req.clienteId, req.body.cantidad);
    setFlash(req, 'success', 'Stock actualizado.');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/borrar', resolveClienteAccess, async (req, res, next) => {
  try {
    await articulos.desactivarArticulo(req.params.id, req.clienteId);
    setFlash(req, 'success', 'Artículo desactivado.');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/activar', resolveClienteAccess, async (req, res, next) => {
  try {
    await articulos.activarArticulo(req.params.id, req.clienteId);
    setFlash(req, 'success', 'Artículo reactivado.');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/importar', resolveClienteAccess, uploadExcel.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
  try {
    const filas = await importacion.leerFilas(req.file.buffer);
    if (!filas.length) return res.status(400).json({ error: 'El archivo no tiene filas de datos.' });
    const jobId = importacion.crearJob(req.clienteId, filas);
    res.json({ jobId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/clientes/:clienteId/articulos/importar/:jobId/estado', resolveClienteAccess, (req, res) => {
  const estado = importacion.obtenerEstado(req.params.jobId, req.clienteId);
  if (!estado) return res.status(404).json({ error: 'Importación no encontrada (puede haber expirado).' });
  res.json(estado);
});

router.get('/clientes/:clienteId/articulos/importar/:jobId/errores.xlsx', resolveClienteAccess, async (req, res, next) => {
  try {
    const buffer = await importacion.generarExcelErrores(req.params.jobId, req.clienteId);
    if (!buffer) return res.status(404).send('No hay errores para esta importación.');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Errores-Importacion.xlsx"');
    res.send(buffer);
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
    setFlash(req, 'success', 'Estado actualizado.');
    res.redirect(`/clientes/${req.clienteId}/escalamientos`);
  } catch (err) {
    if (err instanceof escalamientos.EstadoFinalError) {
      console.warn(`[escalamientos] Intento de modificar un escalamiento ya resuelto (id=${req.params.id})`);
      setFlash(req, 'warning', 'Este Escalamiento ya está resuelto y no se puede modificar.');
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

router.get('/clientes/:clienteId/pedidos/:id/detalle.json', resolveClienteAccess, async (req, res, next) => {
  try {
    const items = await pedidos.obtenerDetalle(req.params.id, req.clienteId);
    res.json({ pedidoId: req.params.id, items });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/pedidos/:id/notas', resolveClienteAccess, async (req, res, next) => {
  try {
    await pedidos.actualizarNotas(req.params.id, req.clienteId, req.body.notas);
    setFlash(req, 'success', 'Notas guardadas.');
    res.redirect(`/clientes/${req.clienteId}/pedidos`);
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
    setFlash(req, 'success', 'Estado actualizado.');
    res.redirect(`/clientes/${req.clienteId}/pedidos`);
  } catch (err) {
    if (err instanceof pedidos.EstadoFinalError) {
      console.warn(`[pedidos] Intento de modificar un pedido ya finalizado (id=${req.params.id})`);
      setFlash(req, 'warning', 'Este Pedido ya está en un estado final y no se puede modificar.');
      return res.redirect(`/clientes/${req.clienteId}/pedidos`);
    }
    if (err.message === 'Un pedido reclamado solo puede pasar a Solucionado.') {
      setFlash(req, 'warning', err.message);
      return res.redirect(`/clientes/${req.clienteId}/pedidos`);
    }
    next(err);
  }
});

module.exports = router;
