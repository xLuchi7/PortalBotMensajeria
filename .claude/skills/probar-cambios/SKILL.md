---
name: probar-cambios
description: Use to verify a change in Portal_Mensajeria without touching the production database: rendering EJS views, testing services against a fake DB, mocking Shopify, or booting the server.
---

# Verificar cambios

No hay tests en el repo y la `.env` apunta a la base de **producción**: nunca escribir en ella. Los scripts van en el scratchpad (no en el repo), con la ruta del repo como argumento, y con el Write tool (los heredocs con comillas fallan en este Git Bash).

**Vistas** — renderizar con datos falsos y chequear con regex:
```js
const root = process.argv[2];
const ejs = require(root + '/node_modules/ejs');
const html = await ejs.renderFile(`${root}/src/views/x.ejs`, {
  icons: require(root + '/src/icons'), timezones: require(root + '/src/timezones'),
  currentPath: '/clientes/1/x', flash: null, usuario: { id: 1, rol: 'cliente', clienteId: 1 },
  cliente: { id: 1, razonSocial: 'Demo' }, clienteId: 1, /* datos de la vista */
}, { views: [`${root}/src/views`] });
```
Probar rol `cliente` y rol `admin` si la vista cambia según el rol.

**Servicios** — DB falsa antes de requerir el servicio:
```js
const path = require('path'); const realSql = require(root + '/node_modules/mssql');
const req = () => { const inputs = {}; const r = { input(k, t, v) { inputs[k] = v === undefined ? t : v; return r; },
  async query(q) { if (/FROM Tabla/.test(q)) return { recordset: [/* filas */] }; return { recordset: [], rowsAffected: [1] }; } }; return r; };
require.cache[path.resolve(root, 'src/services/db.js')] = { id: 'db', filename: 'db', loaded: true,
  exports: { sql: realSql, getPool: async () => ({ request: req }) } };
```
Shopify: reemplazar `global.fetch` y responder según URL/body. Setear `process.env.SESSION_SECRET` antes de requerir (cifrado).

**Servidor** — `PORT=3197 timeout 15 node index.js &` y `curl -s -o /dev/null -w "%{http_code}"` a las rutas (solo GET o rutas que no escriban). Solo lectura contra la base real.
