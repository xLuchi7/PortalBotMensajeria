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
const apiRoutes = require('./src/routes/api');
const shopifyRoutes = require('./src/routes/shopify');
const shopifySync = require('./src/services/shopifySyncService');
const { getPool } = require('./src/services/db');

const app = express();
// Railway termina el HTTPS en un proxy: así req.protocol es "https".
app.set('trust proxy', 1);

// Frontend en React ya compilado (npm run build → client/dist).
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');
const INDEX_HTML = path.join(CLIENT_DIST, 'index.html');

// Antes de los parsers y la sesión: la firma de Shopify se valida sobre el body crudo.
app.use('/', shopifyRoutes.webhookRouter);

// Archivos con hash en el nombre: se cachean para siempre; index.html nunca.
app.use('/assets', express.static(path.join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(CLIENT_DIST, { index: false }));
app.use(express.static('public', { index: false })); // favicon, plantilla de Excel

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000, sameSite: 'lax', httpOnly: true }, // 8hs
}));

app.use('/api', apiRoutes);
// Flujo de instalación de Shopify (/shopify y /shopify/callback): lo navega el
// navegador, así que redirige a páginas del frontend con un toast en la sesión.
app.use('/', shopifyRoutes.publicRouter);

// Cualquier otra página la resuelve React (client/src/App.jsx).
app.get(/.*/, (req, res) => {
  if (!fs.existsSync(INDEX_HTML)) {
    return res.status(503).send('Falta compilar el frontend: corré "npm run build" (o "npm run dev:client" para desarrollo).');
  }
  res.set('Cache-Control', 'no-cache');
  res.sendFile(INDEX_HTML);
});

app.listen(config.port, () => {
  console.log(`Portal Mensajeria running on port ${config.port}`);
  shopifySync.iniciarSyncPeriodica();

  getPool()
    .then(() => console.log(`[db] Connected to ${config.db.database} on ${config.db.server}`))
    .catch(err => console.error('[db] Connection failed:', err.message));
});
