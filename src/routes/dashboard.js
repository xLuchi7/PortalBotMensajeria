const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin, resolveClienteAccess } = require('../middleware/requireAuth');
const chats = require('../services/chatService');
const bot = require('../services/botService');
const escalamientos = require('../services/escalamientoService');
const pedidos = require('../services/pedidoService');
const clientes = require('../services/clienteService');
const articulos = require('../services/articuloService');
const consultas = require('../services/consultaService');
const importacion = require('../services/importService');
const shopify = require('../services/shopifyClient');
const shopifyOrders = require('../services/shopifyOrderService');
const { setFlash } = require('../services/flash');

const router = express.Router();
router.use(requireAuth);

const uploadExcel = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function paginaDe(req) {
  return Math.max(1, parseInt(req.query.page, 10) || 1);
}

function quiereJson(req) {
  return (req.get('Accept') || '').includes('application/json');
}

// Redirect de vuelta a una página del propio portal (nunca a un dominio externo).
function volverA(req, porDefecto) {
  const destino = req.body.volver;
  return typeof destino === 'string' && /^\/(?![/\\])/.test(destino) ? destino : porDefecto;
}

// Con Shopify conectado, los Artículos que vienen de Shopify se editan allá:
// si se tocaran acá, el próximo aviso de Shopify pisaría el cambio igual.
async function bloquearSiEsDeShopify(req, res, next) {
  try {
    const [articulo, conexion] = await Promise.all([
      articulos.obtenerArticulo(req.params.id, req.clienteId),
      shopify.obtenerConexionActiva(req.clienteId),
    ]);
    if (articulo && articulo.origen === 'shopify' && conexion) {
      setFlash(req, 'warning', 'Este Artículo Se Edita En Shopify');
      return res.redirect(`/clientes/${req.clienteId}/articulos`);
    }
    next();
  } catch (err) {
    next(err);
  }
}

router.get('/', (req, res) => {
  if (req.session.usuario.rol === 'admin') return res.redirect('/clientes');
  // Vino desde el link de instalación de Shopify sin sesión: al loguearse se
  // lo lleva directo a terminar la conexión.
  if (req.session.shopifyPendiente) return res.redirect(`/clientes/${req.session.usuario.clienteId}/integraciones`);
  res.redirect(`/clientes/${req.session.usuario.clienteId}/chats`);
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
    setFlash(req, 'success', 'Cliente Creado Correctamente');
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
    setFlash(req, 'success', 'Cliente Actualizado Correctamente');
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
    setFlash(req, 'success', 'Cliente Desactivado');
    res.redirect('/clientes');
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/activar', requireAdmin, async (req, res, next) => {
  try {
    await clientes.activarCliente(req.params.clienteId);
    setFlash(req, 'success', 'Cliente Reactivado');
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
    setFlash(req, 'success', 'Información Guardada');
    res.redirect(`/clientes/${req.clienteId}/negocio`);
  } catch (err) {
    next(err);
  }
});

// Interruptor general del bot. La página lo llama con fetch (respuesta JSON, sin
// recargar); sin JS cae al submit común del form y vuelve con un toast.
router.post('/clientes/:clienteId/negocio/bot', resolveClienteAccess, async (req, res, next) => {
  try {
    const activo = req.body.activo === '1';
    await clientes.setBotGeneral(req.clienteId, activo);
    const mensaje = activo ? 'Bot Encendido Para Todos Los Chats' : 'Bot Apagado: No Responde A Ningún Chat';
    if (quiereJson(req)) return res.json({ ok: true, activo, mensaje });
    setFlash(req, activo ? 'success' : 'warning', mensaje);
    res.redirect(volverA(req, `/clientes/${req.clienteId}/negocio`));
  } catch (err) {
    if (quiereJson(req)) return res.status(500).json({ ok: false, mensaje: 'No Se Pudo Guardar, Probá De Nuevo' });
    next(err);
  }
});

// Default para números nuevos. Por ahora solo lo toca el admin (fase de prueba).
router.post('/clientes/:clienteId/negocio/chats-nuevos', requireAdmin, resolveClienteAccess, async (req, res, next) => {
  try {
    const activo = req.body.activo === '1';
    await clientes.setBotChatsNuevos(req.clienteId, activo);
    const mensaje = activo ? 'Los Chats Nuevos Arrancan Con El Bot Respondiendo' : 'Los Chats Nuevos Arrancan Sin Respuesta Del Bot';
    if (quiereJson(req)) return res.json({ ok: true, activo, mensaje });
    setFlash(req, 'success', mensaje);
    res.redirect(`/clientes/${req.clienteId}/negocio`);
  } catch (err) {
    if (quiereJson(req)) return res.status(500).json({ ok: false, mensaje: 'No Se Pudo Guardar, Probá De Nuevo' });
    next(err);
  }
});

router.get('/clientes/:clienteId/articulos', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, resultado, shopifyConexion] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      articulos.listarArticulos(req.clienteId, paginaDe(req)),
      shopify.obtenerConexionActiva(req.clienteId),
    ]);
    res.render('articulos', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, shopifyConexion, ...resultado });
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
    setFlash(req, 'success', 'Artículo Creado Correctamente');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.get('/clientes/:clienteId/articulos/:id/editar', resolveClienteAccess, bloquearSiEsDeShopify, async (req, res, next) => {
  try {
    const editar = await articulos.obtenerArticulo(req.params.id, req.clienteId);
    if (!editar) return res.status(404).send('Artículo no encontrado.');
    res.render('articulo-form', { usuario: req.session.usuario, clienteId: req.clienteId, editar, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/editar', resolveClienteAccess, bloquearSiEsDeShopify, async (req, res, next) => {
  try {
    const { codigo, nombre, descripcion, precio, usaStock } = req.body;
    await articulos.actualizarArticulo(req.params.id, req.clienteId, { codigo, nombre, descripcion, precio, usaStock: !!usaStock });
    setFlash(req, 'success', 'Artículo Actualizado Correctamente');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/stock', resolveClienteAccess, bloquearSiEsDeShopify, async (req, res, next) => {
  try {
    await articulos.actualizarStock(req.params.id, req.clienteId, req.body.cantidad);
    setFlash(req, 'success', 'Stock Actualizado');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/borrar', resolveClienteAccess, bloquearSiEsDeShopify, async (req, res, next) => {
  try {
    await articulos.desactivarArticulo(req.params.id, req.clienteId);
    setFlash(req, 'success', 'Artículo Desactivado');
    res.redirect(`/clientes/${req.clienteId}/articulos`);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/articulos/:id/activar', resolveClienteAccess, bloquearSiEsDeShopify, async (req, res, next) => {
  try {
    await articulos.activarArticulo(req.params.id, req.clienteId);
    setFlash(req, 'success', 'Artículo Reactivado');
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

// La página se llamaba "Mensajes": los links viejos siguen andando.
router.get('/clientes/:clienteId/mensajes', resolveClienteAccess, (req, res) => {
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  res.redirect(301, `/clientes/${req.clienteId}/chats${qs}`);
});

// Bandeja de chats: lista de números a la izquierda y, si viene ?chat=, la
// conversación de ese número a la derecha con el interruptor del bot.
router.get('/clientes/:clienteId/chats', resolveClienteAccess, async (req, res, next) => {
  try {
    const chatId = typeof req.query.chat === 'string' ? req.query.chat.slice(0, 100) : '';
    const [cliente, resultado, chat] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      chats.listarChats(req.clienteId, {
        page: paginaDe(req),
        q: typeof req.query.q === 'string' ? req.query.q.slice(0, 50) : '',
        estado: req.query.estado,
        bot: req.query.bot,
      }),
      chatId ? chats.obtenerChat(req.clienteId, chatId) : null,
    ]);
    res.render('chats', {
      usuario: req.session.usuario,
      cliente,
      clienteId: req.clienteId,
      ...resultado,
      chat,
      chatId,
      estados: chats.ESTADOS,
      envioHabilitado: bot.envioHabilitado(),
    });
  } catch (err) {
    next(err);
  }
});

// Respuesta escrita a mano por alguien del negocio. La manda Bot_Mensajeria (que
// tiene el token de WhatsApp) y queda guardada en Mensajes con enviadoPor. Si el
// bot estaba activo en ese chat se pausa solo, para que no conteste encima tuyo.
router.post('/clientes/:clienteId/chats/:userId/enviar', resolveClienteAccess, async (req, res, next) => {
  const userId = String(req.params.userId).slice(0, 100);
  const texto = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
  const volverUrl = volverA(req, `/clientes/${req.clienteId}/chats?chat=${encodeURIComponent(userId)}`);
  const responder = (ok, mensaje, extra = {}) => {
    if (quiereJson(req)) return res.status(ok ? 200 : 400).json({ ok, mensaje, ...extra });
    setFlash(req, ok ? 'success' : 'warning', mensaje);
    res.redirect(volverUrl);
  };

  try {
    if (!texto) return responder(false, 'Escribí Un Mensaje');
    if (texto.length > 4096) return responder(false, 'El Mensaje Es Demasiado Largo');

    const chat = await chats.obtenerChat(req.clienteId, userId);
    if (!chat) return responder(false, 'Chat No Encontrado');

    const resultado = await bot.enviarMensaje({ clienteId: req.clienteId, userId, texto, enviadoPor: req.session.usuario.email });
    if (!resultado.ok) return responder(false, resultado.mensaje);

    const pausado = chat.botActivo;
    if (pausado) await chats.setBotChat(req.clienteId, userId, false, req.session.usuario.email);
    responder(true, pausado ? 'Mensaje Enviado Y Bot Pausado En Este Chat' : 'Mensaje Enviado', { botPausado: pausado });
  } catch (err) {
    if (quiereJson(req)) return res.status(500).json({ ok: false, mensaje: 'No Se Pudo Enviar El Mensaje' });
    next(err);
  }
});

// Nombre propio para identificar un número (vacío lo borra).
router.post('/clientes/:clienteId/chats/:userId/nombre', resolveClienteAccess, async (req, res, next) => {
  try {
    const userId = String(req.params.userId).slice(0, 100);
    const nombre = typeof req.body.nombre === 'string' ? req.body.nombre.trim() : '';
    const ok = await chats.setNombreChat(req.clienteId, userId, nombre);
    const mensaje = !ok ? 'Chat No Encontrado' : nombre ? 'Nombre Guardado' : 'Nombre Borrado';
    if (quiereJson(req)) return res.status(ok ? 200 : 404).json({ ok, nombre, mensaje });
    setFlash(req, ok ? 'success' : 'warning', mensaje);
    res.redirect(volverA(req, `/clientes/${req.clienteId}/chats?chat=${encodeURIComponent(userId)}`));
  } catch (err) {
    if (quiereJson(req)) return res.status(500).json({ ok: false, mensaje: 'No Se Pudo Guardar, Probá De Nuevo' });
    next(err);
  }
});

// Pausa / reactiva el bot para un número puntual.
router.post('/clientes/:clienteId/chats/:userId/bot', resolveClienteAccess, async (req, res, next) => {
  try {
    const activo = req.body.activo === '1';
    const userId = String(req.params.userId).slice(0, 100);
    const ok = await chats.setBotChat(req.clienteId, userId, activo, req.session.usuario.email);
    const mensaje = !ok ? 'Chat No Encontrado' : activo ? 'Bot Reactivado En Este Chat' : 'Bot Pausado: Ya No Le Responde';
    if (quiereJson(req)) return res.status(ok ? 200 : 404).json({ ok, activo, mensaje });
    setFlash(req, ok && activo ? 'success' : 'warning', mensaje);
    res.redirect(volverA(req, `/clientes/${req.clienteId}/chats?chat=${encodeURIComponent(userId)}`));
  } catch (err) {
    if (quiereJson(req)) return res.status(500).json({ ok: false, mensaje: 'No Se Pudo Guardar, Probá De Nuevo' });
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
    setFlash(req, 'success', 'Estado Actualizado');
    res.redirect(`/clientes/${req.clienteId}/escalamientos`);
  } catch (err) {
    if (err instanceof escalamientos.EstadoFinalError) {
      console.warn(`[escalamientos] Intento de modificar un escalamiento ya resuelto (id=${req.params.id})`);
      setFlash(req, 'warning', 'Escalamiento Ya Resuelto');
      return res.redirect(`/clientes/${req.clienteId}/escalamientos`);
    }
    next(err);
  }
});

router.get('/clientes/:clienteId/pedidos', resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, resultado, shopifyConexion] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      pedidos.listarPedidos(req.clienteId, paginaDe(req)),
      shopify.obtenerConexionActiva(req.clienteId),
    ]);
    res.render('pedidos', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, shopifyConexion, ...resultado });
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
    setFlash(req, 'success', 'Notas Guardadas');
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
    const conexion = await shopify.obtenerConexionActiva(req.clienteId);
    await pedidos.actualizarEstado(req.params.id, req.clienteId, req.body.estado, { omitirStock: !!conexion });

    // El estado en el portal ya quedó guardado; lo de Shopify nunca lo revierte.
    const r = conexion
      ? await shopifyOrders.alCambiarEstado(parseInt(req.params.id, 10), req.clienteId, req.body.estado)
      : { omitido: true };
    if (r.enviado) setFlash(req, 'success', `Estado Actualizado Y Enviado A Shopify (${r.orderName})`);
    else if (r.cancelado) setFlash(req, 'success', 'Pedido Cancelado También En Shopify');
    else if (r.error && req.body.estado === 'cancelado') setFlash(req, 'warning', 'Cancelado En El Portal, Pero No En Shopify');
    else if (r.error) setFlash(req, 'warning', 'Estado Actualizado, Pero No Se Pudo Enviar A Shopify');
    else setFlash(req, 'success', 'Estado Actualizado');
    res.redirect(`/clientes/${req.clienteId}/pedidos`);
  } catch (err) {
    if (err instanceof pedidos.EstadoFinalError) {
      console.warn(`[pedidos] Intento de modificar un pedido ya finalizado (id=${req.params.id})`);
      setFlash(req, 'warning', 'Pedido en Estado Final');
      return res.redirect(`/clientes/${req.clienteId}/pedidos`);
    }
    if (err.message === 'Un pedido reclamado solo puede pasar a Solucionado.') {
      setFlash(req, 'warning', 'Reclamado Solo Puede Pasar a Solucionado');
      return res.redirect(`/clientes/${req.clienteId}/pedidos`);
    }
    next(err);
  }
});

module.exports = router;
