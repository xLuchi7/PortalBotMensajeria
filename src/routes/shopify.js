const express = require('express');
const config = require('../config');
const { requireAuth, requireAdmin, resolveClienteAccess } = require('../middleware/requireAuth');
const clientes = require('../services/clienteService');
const shopify = require('../services/shopifyClient');
const apps = require('../services/shopifyAppService');
const oauth = require('../services/shopifyOAuthService');
const sync = require('../services/shopifySyncService');
const orders = require('../services/shopifyOrderService');
const webhooks = require('../services/shopifyWebhookService');
const { setFlash } = require('../services/flash');

// ── Rutas públicas (las llama Shopify, no el usuario logueado) ──────────────
// Se montan ANTES que el resto: dashboardRoutes exige login para todo lo que
// pasa por él.

const publicRouter = express.Router();

// Webhooks: necesitan el body crudo para validar la firma HMAC, así que se
// montan en index.js antes de cualquier parser y de la sesión.
const webhookRouter = express.Router();
webhookRouter.post('/shopify/webhooks', express.raw({ type: '*/*', limit: '5mb' }), webhooks.handler);

// Dominio público con el que se está usando el portal (Railway termina el
// HTTPS en un proxy: requiere app.set('trust proxy')).
function urlDelPedido(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function irAIntegraciones(res, clienteId) {
  return res.redirect(`/clientes/${clienteId}/integraciones`);
}

// "App URL" de la app en Shopify: es adonde cae el comerciante cuando instala
// desde el link de instalación o abre la app desde su admin de Shopify.
publicRouter.get('/shopify', async (req, res, next) => {
  try {
    const { shop } = req.query;
    if (!oauth.esShopValido(shop)) return res.redirect('/');
    const app = await oauth.appQueFirmo(req.query);
    if (!app) return res.redirect('/');

    const { usuario } = req.session;
    const existente = await shopify.obtenerConexionPorShop(shop);
    if (existente && existente.estado === 'activa') {
      return usuario ? irAIntegraciones(res, existente.clienteId) : res.redirect('/login');
    }

    // Se recuerda la tienda: después del login (o desde Integraciones) se
    // completa la conexión sin tener que volver a escribirla.
    req.session.shopifyPendiente = shop;

    if (usuario && usuario.rol !== 'admin' && usuario.clienteId) {
      // Una app personalizada es de un solo Cliente.
      if (app.clienteId != null && app.clienteId !== usuario.clienteId) return res.redirect('/');
      const state = oauth.crearState({ clienteId: usuario.clienteId, usuarioId: usuario.id, shop, appId: app.id });
      return res.redirect(oauth.urlAutorizacion({ app, shop, state }));
    }
    if (usuario) {
      setFlash(req, 'warning', 'Conectá La Tienda Desde Integraciones Del Cliente');
      return res.redirect('/clientes');
    }
    res.redirect('/login');
  } catch (err) {
    next(err);
  }
});

publicRouter.get('/shopify/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  const datos = oauth.leerState(state);
  const { usuario } = req.session;
  const app = datos ? await apps.obtenerApp(datos.appId).catch(() => null) : null;

  if (!app || !oauth.esShopValido(shop) || !code || !oauth.verificarHmacQuery(req.query, app.clientSecret)) {
    if (usuario && datos) {
      setFlash(req, 'warning', 'No Se Pudo Verificar La Respuesta De Shopify, Probá De Nuevo');
      return irAIntegraciones(res, datos.clienteId);
    }
    return res.status(400).send('Solicitud de Shopify inválida o vencida. Volvé al portal e intentá conectar de nuevo.');
  }

  // La sesión tiene que ser la misma persona que inició la conexión: evita
  // que alguien enganche su tienda a la cuenta de otro con un link armado.
  if (!usuario) {
    req.session.shopifyPendiente = shop;
    return res.redirect('/login');
  }
  const puedeVer = usuario.rol === 'admin' || usuario.clienteId === datos.clienteId;
  if (usuario.id !== datos.usuarioId || !puedeVer) return res.redirect('/');

  if (datos.shop !== shop) {
    setFlash(req, 'warning', 'La Tienda No Coincide Con La Que Ingresaste');
    return irAIntegraciones(res, datos.clienteId);
  }

  try {
    const otra = await shopify.obtenerConexionPorShop(shop);
    if (otra && otra.clienteId !== datos.clienteId) {
      setFlash(req, 'warning', 'Esa Tienda Ya Está Conectada A Otro Cliente');
      return irAIntegraciones(res, datos.clienteId);
    }

    const tokenData = await shopify.canjearCodigo(app, shop, code);
    await shopify.guardarConexion(datos.clienteId, { shopDomain: shop, tokenData, appId: app.id });
    delete req.session.shopifyPendiente;

    await oauth.cargarDatosTienda(datos.clienteId);
    const fallas = await oauth.registrarWebhooks(datos.clienteId, app);
    const jobId = sync.crearJobSync(datos.clienteId);

    setFlash(req, fallas.length ? 'warning' : 'success',
      fallas.length ? 'Shopify Conectado, Pero Faltan Algunos Avisos Automáticos' : 'Shopify Conectado');
    res.redirect(`/clientes/${datos.clienteId}/integraciones?sync=${jobId}`);
  } catch (err) {
    console.error('[shopify] Falló la conexión:', err.message);
    setFlash(req, 'warning', 'No Se Pudo Conectar Con Shopify, Probá De Nuevo');
    irAIntegraciones(res, datos.clienteId);
  }
});

// ── Rutas del panel (requieren login) ───────────────────────────────────────

const router = express.Router();

router.get('/clientes/:clienteId/integraciones', requireAuth, resolveClienteAccess, async (req, res, next) => {
  try {
    const [cliente, conexion, resumen, app] = await Promise.all([
      clientes.obtenerCliente(req.clienteId),
      shopify.obtenerConexion(req.clienteId),
      sync.resumen(req.clienteId),
      apps.obtenerAppDeCliente(req.clienteId),
    ]);
    const base = config.appUrl || urlDelPedido(req);
    res.render('integraciones', {
      usuario: req.session.usuario,
      cliente,
      clienteId: req.clienteId,
      conexion,
      resumen,
      // Nunca el secret a la vista.
      app: app && {
        clientId: app.clientId,
        esGeneral: app.clienteId == null,
        secretIlegible: app.secretIlegible,
      },
      configurado: Boolean(app && !app.secretIlegible),
      // Lo que el admin pega en el Dev Dashboard de Shopify.
      urlsApp: {
        appUrl: `${base}/shopify`,
        redirect: `${base}/shopify/callback`,
        webhooks: `${base}/shopify/webhooks`,
        scopes: config.shopify.scopes,
        apiVersion: config.shopify.apiVersion,
      },
      shopPendiente: req.session.shopifyPendiente || '',
      // Se inyecta en un <script>: solo UUIDs, nunca texto libre de la URL.
      syncJobId: /^[0-9a-f-]{36}$/i.test(String(req.query.sync || '')) ? req.query.sync : null,
    });
  } catch (err) {
    next(err);
  }
});

// Solo admin: credenciales de la app (Client ID / secret del Dev Dashboard).
router.post('/clientes/:clienteId/shopify/app', requireAuth, requireAdmin, resolveClienteAccess, async (req, res, next) => {
  try {
    const clientId = String(req.body.clientId || '').trim();
    const clientSecret = String(req.body.clientSecret || '').trim();
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(clientId) || clientSecret.length < 16 || /\s/.test(clientSecret)) {
      setFlash(req, 'warning', 'Revisá El Client ID Y El Client Secret');
      return irAIntegraciones(res, req.clienteId);
    }
    await apps.guardarApp({
      clienteId: req.body.alcance === 'general' ? null : req.clienteId,
      clientId,
      clientSecret,
      appUrl: config.appUrl || urlDelPedido(req),
    });
    setFlash(req, 'success', 'Credenciales De Shopify Guardadas');
    irAIntegraciones(res, req.clienteId);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/shopify/conectar', requireAuth, resolveClienteAccess, async (req, res, next) => {
  try {
    const app = await apps.obtenerAppDeCliente(req.clienteId);
    if (!app || !app.clientSecret) {
      setFlash(req, 'warning', 'La Integración Con Shopify No Está Configurada');
      return irAIntegraciones(res, req.clienteId);
    }
    const shop = oauth.normalizarShop(req.body.shop);
    if (!shop) {
      setFlash(req, 'warning', 'Revisá La Dirección De La Tienda');
      return irAIntegraciones(res, req.clienteId);
    }
    const otra = await shopify.obtenerConexionPorShop(shop);
    if (otra && otra.clienteId !== req.clienteId) {
      setFlash(req, 'warning', 'Esa Tienda Ya Está Conectada A Otro Cliente');
      return irAIntegraciones(res, req.clienteId);
    }
    const state = oauth.crearState({ clienteId: req.clienteId, usuarioId: req.session.usuario.id, shop, appId: app.id });
    res.redirect(oauth.urlAutorizacion({ app, shop, state }));
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/shopify/desconectar', requireAuth, resolveClienteAccess, async (req, res, next) => {
  try {
    const conexion = await shopify.obtenerConexion(req.clienteId);
    const app = conexion && await apps.obtenerApp(conexion.appId);
    if (app) await oauth.borrarWebhooks(req.clienteId, app).catch(err => {
      console.warn('[shopify] No se pudieron borrar los webhooks al desconectar:', err.message);
    });
    await shopify.eliminarConexion(req.clienteId);
    setFlash(req, 'success', 'Shopify Desconectado');
    irAIntegraciones(res, req.clienteId);
  } catch (err) {
    next(err);
  }
});

router.post('/clientes/:clienteId/shopify/sync', requireAuth, resolveClienteAccess, async (req, res) => {
  try {
    const conexion = await shopify.obtenerConexionActiva(req.clienteId);
    if (!conexion) return res.status(400).json({ error: 'La tienda no está conectada.' });
    res.json({ jobId: sync.crearJobSync(req.clienteId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clientes/:clienteId/shopify/sync/:jobId', requireAuth, resolveClienteAccess, (req, res) => {
  const estado = sync.obtenerEstadoSync(req.params.jobId, req.clienteId);
  if (!estado) return res.status(404).json({ error: 'Sincronización no encontrada (puede haber expirado).' });
  res.json(estado);
});

router.post('/clientes/:clienteId/pedidos/:id/shopify/reintentar', requireAuth, resolveClienteAccess, async (req, res, next) => {
  try {
    const r = await orders.enviarPedido(parseInt(req.params.id, 10), req.clienteId, { reintento: true });
    if (r.enviado) setFlash(req, 'success', `Pedido Enviado A Shopify (${r.orderName})`);
    else if (r.error) setFlash(req, 'warning', 'No Se Pudo Enviar A Shopify');
    else if (r.yaEnviado) setFlash(req, 'success', 'El Pedido Ya Estaba En Shopify');
    else setFlash(req, 'warning', 'Este Pedido No Se Puede Enviar A Shopify Todavía');
    res.redirect(`/clientes/${req.clienteId}/pedidos`);
  } catch (err) {
    next(err);
  }
});

module.exports = { webhookRouter, publicRouter, router };
