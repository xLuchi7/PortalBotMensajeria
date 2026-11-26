const sql = require('mssql');
const config = require('../config');

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = sql.connect({
      server: config.db.server,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      port: config.db.port,
      options: {
        encrypt: true, // requerido por Azure SQL
        trustServerCertificate: false,
      },
    }).catch(err => {
      // Si la conexión falla (timeout, firewall, la base despertando), no se
      // guarda el error: el próximo pedido vuelve a intentar conectar.
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/**
 * Ejecuta un stored procedure (D:/SQL Scripts/Bot_Mensajeria.sql).
 * @param {string} procedure  ej. 'dbo.usp_Portal_LogsListar'
 * @param {Record<string, [any, any]>} params  { nombre: [tipoMssql, valor] }
 */
async function ejecutar(procedure, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [nombre, [tipo, valor]] of Object.entries(params)) {
    request.input(nombre, tipo, valor === undefined ? null : valor);
  }
  return request.execute(procedure);
}

module.exports = { getPool, ejecutar, sql };
