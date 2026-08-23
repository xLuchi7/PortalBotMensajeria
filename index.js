require('dotenv').config();

// Las reglas de firewall de Azure SQL son solo IPv4 — si Railway resuelve el
// hostname por IPv6, la conexión no matchea ninguna regla y se cae en timeout
// silencioso en vez de un rechazo directo. Forzamos IPv4 primero.
require('dns').setDefaultResultOrder('ipv4first');

const express = require('express');
const session = require('express-session');
const config = require('./src/config');
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const usuariosRoutes = require('./src/routes/usuarios');
const { getPool } = require('./src/services/db');
const icons = require('./src/icons');
const timezones = require('./src/timezones');

const app = express();

app.set('view engine', 'ejs');
app.set('views', './src/views');
app.locals.icons = icons;
app.locals.timezones = timezones;

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8hs
}));
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.use('/', authRoutes);
app.use('/', dashboardRoutes);
app.use('/', usuariosRoutes);

app.listen(config.port, () => {
  console.log(`Portal Mensajeria running on port ${config.port}`);

  getPool()
    .then(() => console.log(`[db] Connected to ${config.db.database} on ${config.db.server}`))
    .catch(err => console.error('[db] Connection failed:', err.message));
});
