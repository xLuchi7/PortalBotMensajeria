---
name: probar-cambios
description: Use to verify a change in Portal_Mensajeria without touching the production database: running the React frontend in Chrome against an in-memory fake backend, testing services against a fake DB, mocking Shopify, or smoke-testing the API.
---

# Verificar cambios

No hay tests en el repo y la `.env` apunta a la base de **producción**: nunca escribir en ella. Los scripts de prueba van en el scratchpad (no en el repo), con la ruta del repo como argumento, y se escriben con el Write tool (los heredocs con comillas fallan en este Git Bash).

## Portal completo en el navegador (lo más útil)

En esta carpeta hay dos archivos listos:

- `fake-server.js` levanta el `index.js` real con **todos los servicios de datos reemplazados por versiones en memoria**, vía `require.cache`. Hay dos clientes (1 con Shopify conectado, 2 sin app) y dos usuarios: `admin@test.com`/`admin` y `cliente@test.com`/`cliente`. Escucha en :3197, y en :3198 expone `GET /inject?cliente=1&user=598...&texto=...`, que simula un mensaje entrante para probar el tiempo real. Si agregás funciones a un servicio, sumalas al stub correspondiente.
- `e2e.js` recorre todas las pantallas en Chrome headless (puppeteer-core + el Chrome instalado en `C:/Program Files/Google/Chrome/Application/chrome.exe`). Imprime `OK`/`FAIL` por paso, los errores de consola y los HTTP ≥ 400, y guarda capturas en `shots/`. Mirá las capturas con Read para revisar lo visual.

Pasos:
1. Copiá los dos archivos a una carpeta del scratchpad y corré `npm init -y && npm i puppeteer-core` ahí, no en el repo.
2. En el repo, `npm run build` (el servidor sirve `client/dist`).
3. `node fake-server.js "D:/Mis Proyectos/Portal_Mensajeria" &` y después `node e2e.js`.
4. Para reiniciar el server, buscá el PID con `netstat -ano | grep :3197` y cortalo con `taskkill //PID <pid> //F`.

Tené en cuenta:
- Con el login por formulario y la contraseña `cliente`, Chrome muestra el aviso de "contraseña filtrada", que bloquea el mouse en el navegador de prueba. Para ese usuario logueate con `fetch('/api/login')` y después `page.goto`.
- Los toasts (arriba a la derecha) pueden tapar botones: cerralos con un clic antes de hacer clic ahí.
- Los `<th>` se muestran en mayúsculas por CSS, así que compará `innerText` sin distinguir mayúsculas.

## API sola

Con el `fake-server.js` levantado: `curl -s -c c.txt -b c.txt -H 'Content-Type: application/json' -X POST -d '{"email":"admin@test.com","password":"admin"}' localhost:3197/api/login` y después las rutas `/api/...` con la misma cookie.

## Servicios (SQL) con DB falsa

Para probar el SQL de un servicio, reemplazá `db.js` antes de requerirlo:
```js
const path = require('path'); const realSql = require(root + '/node_modules/mssql');
const req = () => { const inputs = {}; const r = { input(k, t, v) { inputs[k] = v === undefined ? t : v; return r; },
  async query(q) { if (/FROM Tabla/.test(q)) return { recordset: [/* filas */] }; return { recordset: [], rowsAffected: [1] }; } }; return r; };
require.cache[path.resolve(root, 'src/services/db.js')] = { id: 'db', filename: 'db', loaded: true,
  exports: { sql: realSql, getPool: async () => ({ request: req }) } };
```
Para Shopify, reemplazá `global.fetch` y respondé según la URL o el body. Seteá `process.env.SESSION_SECRET` antes de requerir (lo usa el cifrado).

## Contra la base real

Solo lectura: `npm run build`, después `PORT=3197 timeout 15 node index.js &`, y `curl` a rutas GET nada más.
