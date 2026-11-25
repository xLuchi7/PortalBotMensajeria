const express = require('express');
const shopify = require('../services/shopifyClient');
const apps = require('../services/shopifyAppService');
const oauth = require('../services/shopifyOAuthService');
const sync = require('../services/shopifySyncService');
const webhooks = require('../services/shopifyWebhookService');
const { setFlash } = require('../services/flash');

// ── Rutas públicas (las llama Shopify, no el usuario logueado) ──────────────
// Las navega el navegador: terminan en un redirect a una página del frontend
// (React) y dejan el toast en la sesión, que el frontend lee de /api/sesion.

const publicRouter = express.Router();

// Webhooks: necesitan el body crudo para validar la firma HMAC, así que se
// montan en index.js antes de cualquier parser y de la sesión.
const webhookRouter = express.Router();
webhookRouter.post('/shopify/webhooks', express.raw({ type: '*/*', limit: '5mb' }), webhooks.handler);

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

// Las rutas del panel (conectar, desconectar, sincronizar, credenciales) están
// en routes/api.js: las llama el frontend con fetch.

module.exports = { webhookRouter, publicRouter };
