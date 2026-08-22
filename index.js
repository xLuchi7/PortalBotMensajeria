require('dotenv').config();
const express = require('express');
const session = require('express-session');
const config = require('./src/config');
const authRoutes = require('./src/routes/auth');
const dashboardRoutes = require('./src/routes/dashboard');
const { getPool } = require('./src/services/db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', './src/views');

app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8hs
}));

app.use('/', authRoutes);
app.use('/', dashboardRoutes);

app.listen(config.port, () => {
  console.log(`Portal Mensajeria running on port ${config.port}`);

  getPool()
    .then(() => console.log(`[db] Connected to ${config.db.database} on ${config.db.server}`))
    .catch(err => console.error('[db] Connection failed:', err.message));
});
