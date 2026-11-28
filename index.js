require('dotenv').config();

// Las reglas de firewall de Azure SQL son solo IPv4 — si Railway resuelve el
// hostname por IPv6, la conexión no matchea ninguna regla y se cae en timeout
// silencioso en vez de un rechazo directo. Forzamos IPv4 primero.
require('dns').setDefaultResultOrder('ipv4first');

const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const config = require('./src/config');

// Las cookies de sesión (y los tokens de Shopify, si no hay TOKEN_ENC_KEY) se
// protegen con SESSION_SECRET: sin él no se arranca; corto, se avisa.
const COMO_GENERAR = 'Generá uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';
if (!config.sessionSecret) {
  console.error(`[config] Falta SESSION_SECRET. ${COMO_GENERAR}`);
  process.exit(1);
}
if (config.sessionSecret.length < 32) {
  console.warn(`[config] SESSION_SECRET es corto (${config.sessionSecret.length} caracteres, recomendado 32 o más). ${COMO_GENERAR}`);
}
if (config.produccion && !config.shopify.tokenEncKey) {
  console.warn('[config] Falta TOKEN_ENC_KEY: los tokens de Shopify se cifran con una clave derivada de SESSION_SECRET (si cambiás SESSION_SECRET, dejan de servir).');
}

const apiRoutes = require('./src/routes/api');
const shopifyRoutes = require('./src/routes/shopify');
const shopifySync = require('./src/services/shopifySyncService');
const { getPool } = require('./src/services/db');
const logs = require('./src/services/logService');
const SesionStore = require('./src/services/sesionStore');

// Tabla Logs: eventos del portal + todo console.warn/error. Se purga sola a los 7 días.
logs.iniciar();
logs.info('portal_iniciado');

// Última red: una promesa rechazada sin catch queda en Logs en vez de pasar desapercibida.
process.on('unhandledRejection', (err) => {
  console.error('[proceso] Promesa rechazada sin manejar:', err?.stack || err);
});

const app = express();
// Railway termina el HTTPS en un proxy: así req.protocol es "https".
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Headers de seguridad (lo mismo que haría helmet, sin sumar dependencias).
// CSP: scripts solo propios; estilos propios + Google Fonts ('unsafe-inline' por
// los style="" de los íconos SVG); imágenes de cualquier https (fotos de Shopify).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Frontend en React ya compilado (npm run build → client/dist).
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');
const INDEX_HTML = path.join(CLIENT_DIST, 'index.html');

// Antes de los parsers y la sesión: la firma de Shopify se valida sobre el body crudo.
app.use('/', shopifyRoutes.webhookRouter);

// Archivos con hash en el nombre: se cachean para siempre; index.html nunca.
app.use('/assets', express.static(path.join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(CLIENT_DIST, { index: false }));
app.use(express.static('public', { index: false })); // favicon, plantilla de Excel

// Solo JSON: el frontend nunca manda formularios clásicos (y aceptarlos facilita CSRF).
app.use(express.json({ limit: '1mb' }));
app.use(session({
  name: config.sessionCookie,
  secret: config.sessionSecret,
  store: new SesionStore(),
  resave: false,
  saveUninitialized: false,
  // secure 'auto': la cookie solo viaja por https cuando el pedido llegó por https
  // (Railway); en desarrollo, con http, sigue andando.
  cookie: { maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax', httpOnly: true, secure: 'auto' }, // 8hs
}));

app.use('/api', apiRoutes);
// Flujo de instalación de Shopify (/shopify y /shopify/callback): lo navega el
// navegador, así que redirige a páginas del frontend con un toast en la sesión.
app.use('/', shopifyRoutes.publicRouter);
// Vuelta de los OAuth de Meta Ads y Mercado Pago (Dashboard): mismo esquema.
app.use('/', require('./src/routes/conexiones'));

// Cualquier otra página la resuelve React (client/src/App.jsx).
app.get(/.*/, (req, res) => {
  if (!fs.existsSync(INDEX_HTML)) {
    return res.status(503).send('Falta compilar el frontend: corré "npm run build" (o "npm run dev:client" para desarrollo).');
  }
  res.set('Cache-Control', 'no-cache');
  res.sendFile(INDEX_HTML);
});

// Último manejador de errores (JSON inválido, errores del flujo de Shopify...):
// nunca se manda el stack al navegador.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[app] ${req.method} ${req.originalUrl}:`, err.stack || err.message);
  if (res.headersSent) return;
  const mensaje = status === 413 ? 'El Pedido Es Demasiado Grande' : status < 500 ? 'Pedido Inválido' : 'Ocurrió Un Error, Probá De Nuevo';
  if (req.originalUrl.startsWith('/api/')) return res.status(status).json({ ok: false, tipo: 'warning', mensaje });
  res.status(status).type('text/plain').send(mensaje);
});

const server = app.listen(config.port, () => {
  console.log(`Portal Mensajeria running on port ${config.port}`);
  shopifySync.iniciarSyncPeriodica();

  getPool()
    .then(() => console.log(`[db] Connected to ${config.db.database} on ${config.db.server}`))
    .catch(err => console.error('[db] Connection failed:', err.message));
});

// Apagado ordenado (deploy en Railway): deja de aceptar conexiones, espera las que
// están en curso (las de tiempo real se cortan) y manda los logs pendientes.
let apagando = false;
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.once(senal, () => {
    if (apagando) return;
    apagando = true;
    logs.info('portal_apagado', { detalle: { senal } });
    server.close();
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 5000).unref();
    logs.vaciar().finally(() => process.exit(0));
  });
}
