# Portal_Mensajeria

Panel web multi-cliente del bot de WhatsApp (`../Bot_Mensajeria`). Cada Cliente (comercio) entra con sus usuarios y ve sus pedidos, artículos, chats, consultas, escalamientos e integraciones. Mismo deploy y mismo link para todos.

Stack: Node 22 + Express 5 + EJS, Azure SQL vía `mssql` (sin ORM), sesiones en memoria (`express-session`). Deploy en Railway. Sin tests automatizados ni build.

## Reglas fijas

- **SQL**: nunca crear archivos `.sql` en el repo ni ejecutar DDL/DML contra la base. Todo script nuevo se agrega al final de `D:\SQL Scripts\Bot_Mensajeria.sql`, debajo de `---------------CAMBIOS CLAUDE`, con encabezado `-- [AAAA-MM-DD] Descripción`, idempotente (`IF OBJECT_ID(...) IS NULL`, `IF COL_LENGTH(...) IS NULL`) y con `GO` entre bloques. El usuario lo corre en SSMS. Si el código nuevo lee columnas nuevas, avisar: **correr el SQL antes de deployar**. Ver la skill `sql-cambio`.
- La base es **compartida con Bot_Mensajeria** (`Clientes`, `Articulos`, `Stock`, `Pedidos`, `DetallePedidos`, `Mensajes`, `Escalamientos`, `ConsultasArticulo/Pedido`, vista `VConsultas`). No renombrar ni borrar columnas que use el bot; el bot busca artículos por `nombre` exacto con `activo = 1`.
- **Multi-tenant**: toda ruta de datos va bajo `/clientes/:clienteId/...` con `requireAuth` + `resolveClienteAccess` (admin entra a cualquiera, rol `cliente` solo al suyo) y **toda query filtra por `clienteId`**. `requireAdmin` para lo que solo ve el admin.
- Queries siempre parametrizadas (`.input(...)`). Nada de concatenar valores.
- Copy de la UI en español rioplatense (voseo). Toasts con `setFlash(req, 'success'|'warning', 'Texto En Title Case')`.
- Sin dependencias nuevas salvo necesidad real (usar `fetch` y `crypto` nativos).
- Commits solo cuando el usuario lo pide; mensajes en inglés.

## Mapa

- `index.js`: orden de montaje importa. `shopifyRoutes.webhookRouter` va **antes** de `express.urlencoded` y la sesión (firma sobre body crudo). Después: `publicRouter`, `auth`, `shopifyRoutes.router`, `dashboard`, `usuarios`.
- `src/routes/`: `auth.js`, `dashboard.js` (pedidos, artículos, stock, importación Excel, chats (bandeja + pausar bot + responder a mano), consultas, escalamientos, negocio, clientes), `usuarios.js`, `shopify.js`.
- `src/services/`: un servicio por tabla/feature (`pedidoService`, `articuloService`, `importService` con jobs en memoria + polling, `flash`, `db.getPool()`). Shopify: `shopifyClient` (token + GraphQL), `shopifyAppService` (credenciales de apps en DB), `shopifyOAuthService`, `shopifySyncService`, `shopifyOrderService`, `shopifyWebhookService`, `cryptoService` (AES-GCM, clave derivada de `SESSION_SECRET`).
- `src/views/`: una vista por página + `partials/header.ejs` (menú lateral: una sola lista `grupos` para admin y cliente, agregá ahí las páginas nuevas), `partials/bot-switch.ejs` (interruptor del bot) y `partials/footer.ejs` (`mostrarToast`, `confirmarEliminar`, validación con toasts, fetch de los interruptores). Patrón de página: `.page-head` (h1 + `.page-sub`), ayuda larga en `<details class="page-help">`, números en `.stats`.
- `src/viewHelpers.js`: helpers de formato disponibles en todas las vistas (`numero`, `fecha`, `plata`, `iniciales`).
- `src/icons.js`: SVGs inline genéricos (`icons.nombre`), sin logos de marcas. `public/style.css`: un solo CSS con secciones `/* ── Nombre ── */` y variables en `:root`.
- `docs/SHOPIFY.md`: cómo funciona la integración con Shopify.

## Variables de entorno

`SESSION_SECRET`, `DB_SERVER`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, `PORT`. Opcionales: `APP_URL`, `TOKEN_ENC_KEY`, `SHOPIFY_API_VERSION`, `SHOPIFY_SCOPES`, `BOT_URL` + `BOT_API_TOKEN` (para responder chats a mano desde Mensajes: el portal llama a `POST {BOT_URL}/portal/enviar`; el token tiene que ser igual al `PORTAL_API_TOKEN` del bot). Las credenciales de Shopify se cargan desde el portal (tabla `ShopifyApps`), no en Railway. Cambiar `SESSION_SECRET` invalida los tokens de Shopify guardados.

## Cómo trabajar

- Leer solo lo necesario: `Grep` para ubicar, `Read` con `offset/limit`. No releer archivos ya leídos en la sesión.
- Para verificar sin tocar la base real: skill `probar-cambios`. Para páginas nuevas: skill `nueva-pagina`.
- Respuestas cortas y en español.
