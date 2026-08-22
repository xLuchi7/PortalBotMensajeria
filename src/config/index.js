module.exports = {
  port: process.env.PORT || 3100,
  sessionSecret: process.env.SESSION_SECRET,
  db: {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '1433', 10),
  },
};
