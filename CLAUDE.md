# Portal_Mensajeria

Panel web multi-cliente del bot de WhatsApp (`../Bot_Mensajeria`). Cada Cliente (comercio) entra con sus usuarios y ve sus pedidos, artículos, chats, consultas, escalamientos e integraciones. Mismo deploy y mismo link para todos.

Stack: backend Node 22 + Express 5 (API JSON en `/api`), frontend React 19 + React Router 7 compilado con Vite (`client/`), Azure SQL vía `mssql` (sin ORM), sesiones en memoria (`express-session`). Deploy en Railway (un solo servicio: corre `npm run build` y después `npm start`). Sin tests automatizados.

Desarrollo: `npm run dev` (Express en `PORT`, default 3100) + `npm run dev:client` (Vite en :5173, pasa `/api` y `/shopify` a Express). `client/dist` lo genera el build y no se commitea.

## Reglas fijas

- **SQL**: nunca crear archivos `.sql` en el repo ni ejecutar DDL/DML contra la base. Todo script nuevo se agrega al final de `D:\SQL Scripts\Bot_Mensajeria.sql`, debajo de `---------------CAMBIOS CLAUDE`, con encabezado `-- [AAAA-MM-DD] Descripción`, idempotente (`IF OBJECT_ID(...) IS NULL`, `IF COL_LENGTH(...) IS NULL`) y con `GO` entre bloques. El usuario lo corre en SSMS. Si el código nuevo lee columnas nuevas, avisar: **correr el SQL antes de deployar**. Ver la skill `sql-cambio`.
- La base es **compartida con Bot_Mensajeria** (`Clientes`, `Articulos`, `Stock`, `Pedidos`, `DetallePedidos`, `Mensajes`, `Escalamientos`, `ConsultasArticulo/Pedido`, vista `VConsultas`). No renombrar ni borrar columnas que use el bot; el bot busca artículos por `nombre` exacto con `activo = 1`.
- **Multi-tenant**: toda ruta de datos va bajo `/clientes/:clienteId/...` con `requireAuth` + `resolveClienteAccess` (admin entra a cualquiera, rol `cliente` solo al suyo) y **toda query filtra por `clienteId`**. `requireAdmin` para lo que solo ve el admin.
- Queries siempre parametrizadas (`.input(...)`). Nada de concatenar valores.
- Copy de la UI en español rioplatense (voseo). Toasts en Title Case: la API responde `{ ok, tipo: 'success'|'warning', mensaje }` (helpers `ok`/`aviso`/`falla` en `api.js`) y el frontend lo muestra con `useAvisar()`. `setFlash` queda solo para el flujo de Shopify que navega el navegador (lo lee `/api/sesion`).
- Sin dependencias nuevas salvo necesidad real (usar `fetch` y `crypto` nativos).
- Commits solo cuando el usuario lo pide; mensajes en inglés.

## Mapa

- `index.js`: orden de montaje importa. `shopifyRoutes.webhookRouter` va **antes** de los parsers y la sesión (firma sobre body crudo). Después: estáticos de `client/dist` y `public/`, `express.json`, sesión, `/api` (`routes/api.js`), `shopifyRoutes.publicRouter` (`/shopify`, `/shopify/callback`) y al final el fallback que devuelve `client/dist/index.html` para cualquier otra ruta (React resuelve la página).
- `src/routes/api.js`: toda la API JSON (sesión/login, clientes, usuarios, negocio, artículos + importación Excel, chats + polling `/chats/novedades`, escalamientos, pedidos, consultas, integraciones/Shopify). `src/routes/shopify.js`: solo webhooks + instalación/OAuth.
- `src/middleware/requireAuth.js`: en rutas `/api/` responde 401/403 JSON; en el resto redirige.
- `src/services/`: un servicio por tabla/feature (`pedidoService`, `articuloService`, `chatService` (`huellaBandeja` para el tiempo real), `importService` con jobs en memoria + polling, `flash`, `db.getPool()`). Shopify: `shopifyClient` (token + GraphQL), `shopifyAppService` (credenciales de apps en DB), `shopifyOAuthService`, `shopifySyncService`, `shopifyOrderService`, `shopifyWebhookService`, `cryptoService` (AES-GCM, clave derivada de `SESSION_SECRET`). `src/viewHelpers.js`: `numero()`, lo usa `chatService`.
- `client/src/`:
  - `main.jsx` (router de datos + providers) y `App.jsx` (todas las rutas; `<Privada admin>` para lo que solo ve el admin).
  - `pages/`: una por pantalla.
  - `components/Layout.jsx`: menú lateral (lista `GRUPOS`, agregá ahí las páginas nuevas); `useCliente()` da el Cliente que se está viendo.
  - `components/ui.jsx`: `PageHead`, `PageHelp`, `Stats`/`Stat`, `Empty`, `TablaCargando`, `ErrorCarga`, `Pagination`, `Contacto`, `useTitulo`.
  - `components/`: `Toasts.jsx` (`useToast`, `useAvisar`), `Confirm.jsx` (`useConfirm`), `Modal.jsx` (`<dialog>` nativo), `Form.jsx` (validación con toasts), `BotSwitch.jsx`, `ShopifySync.jsx`, `ImportarExcel.jsx`, `DetalleArticulo.jsx` (modal con fotos y toda la info del artículo; lo de Shopify sale de `Articulos.shopifyDatos`, el JSON completo que guarda el sync).
  - `lib/`: `api.js` (`api()` y `useApi()`), `auth.jsx`, `format.js` (`numero`, `fecha`, `plata`, `iniciales`), `icons.js` (SVGs genéricos, sin logos de marcas; se usan con `<Icon name="x" />`), `timezones.js`.
- `client/src/styles.css`: un solo CSS con secciones `/* ── Nombre ── */` y variables en `:root`. Patrón de página: `.page-head` (h1 + `.page-sub`), ayuda larga en `PageHelp`, números en `.stats`. `public/`: favicon y plantilla de Excel.
- `docs/SHOPIFY.md`: cómo funciona la integración con Shopify.

## Variables de entorno

`SESSION_SECRET`, `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `PORT`. Opcionales: `APP_URL`, `TOKEN_ENC_KEY`, `SHOPIFY_API_VERSION`, `SHOPIFY_SCOPES`, `BOT_URL` + `BOT_API_TOKEN` (para responder chats a mano desde Mensajes: el portal llama a `POST {BOT_URL}/portal/enviar`; el token tiene que ser igual al `PORTAL_API_TOKEN` del bot). Las credenciales de Shopify se cargan desde el portal (tabla `ShopifyApps`), no en Railway. Cambiar `SESSION_SECRET` invalida los tokens de Shopify guardados.

## Cómo trabajar

- Leer solo lo necesario: `Grep` para ubicar, `Read` con `offset/limit`. No releer archivos ya leídos en la sesión.
- Para verificar sin tocar la base real: skill `probar-cambios`. Para páginas nuevas: skill `nueva-pagina`.
- Respuestas cortas y en español.
