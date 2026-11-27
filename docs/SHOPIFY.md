# Integración con Shopify

Cada Cliente conecta **su propia tienda de Shopify** (la que ya usa) desde **Integraciones** en el portal. A partir de ahí:

- Cada variante de Shopify es un Artículo del portal (lo que el bot ofrece por WhatsApp). Nombre, precio, stock y activo se actualizan solos por webhooks, más una sincronización completa cada 24 hs como red de seguridad.
- **Venta por link de compra** (Integraciones → Venta por link de compra, prendida por defecto): cuando el cliente confirma, el bot no crea un Pedido sino que le manda un link al checkout de la tienda con el carrito armado (`https://{tienda}.myshopify.com/cart/{variante}:{cantidad},...?attributes[whatsapp]=TOKEN&ref=wa-TOKEN`). La persona completa envío y paga en Shopify. Cada link queda en `LinksCompra` (intención de compra) y los webhooks `orders/create`, `orders/updated` y `orders/cancelled` lo vinculan por el token (atributo del carrito o `ref`): **Sin comprar → Pago pendiente → Pagado** (o **Cancelado**), con el total real cobrado. Página **Links de Compra** con la conversión. Artículos sin variante de Shopify no se pueden mandar por link (el bot avisa). Código: `src/services/linkCompraService.js` (portal) y `src/services/linkCompraService.js` (bot).
- Sin venta por link: al pasar un Pedido a **Confirmado** (o directo a Entregado) se crea en la tienda del Cliente como pedido con pago pendiente, tag `whatsapp`, y Shopify descuenta el inventario.
- Si se cancela en el portal un pedido ya enviado, se cancela en Shopify con restock.
- Para Clientes conectados el portal no mueve stock local: lo maneja Shopify.
- **Pedido vivo**: lo que pasa con el pedido en Shopify vuelve al portal por el webhook `orders/updated` (y `orders/cancelled`). Eso incluye el pago (`shopifyPago`), el despacho (`shopifyEnvio`), el seguimiento (`tracking*`) y la cancelación. Si Shopify lo despacha, el pedido pasa a **Entregado** en el portal ("salió la mercadería"); si lo cancelan allá, se cancela acá. Los pedidos que no salieron del portal (ej. de la tienda web) se ignoran.
- **Avisos por WhatsApp** (Integraciones → Avisos por WhatsApp, apagados por defecto): "Pedido despachado" (con el link de seguimiento) y "Pago recibido". Los manda el bot (`POST /portal/enviar`). Si pasaron más de 24 hs desde el último mensaje de la persona, solo se pueden mandar **plantillas aprobadas por Meta** (`POST /portal/plantilla` del bot). El Cliente crea la plantilla en el WhatsApp Manager y carga su nombre en el portal. Variables: despachado `{{1}}` = número de pedido, `{{2}}` = link o número de seguimiento; pago `{{1}}` = número de pedido. Cada aviso se manda una sola vez (clave única en `AvisosWhatsApp`) y se ve en el detalle del pedido. Configuración en `Clientes.avisosConfig` (JSON). Código: `src/services/avisoService.js`.
- Las tiendas conectadas antes de sumar un webhook nuevo lo reciben solas en la próxima sincronización (cada sync re-registra los que falten).

## Puesta en marcha

1. Correr el bloque `[2026-11-25] Integración Shopify (completo)` de `D:\SQL Scripts\Bot_Mensajeria.sql` en SSMS **antes de deployar** (el código lee columnas y tablas nuevas).
2. Deployar. **No hacen falta variables nuevas en Railway.**
3. Como admin, entrar a un Cliente → **Integraciones**. Si todavía no hay app de Shopify, el portal muestra un asistente paso a paso: link al Dev Dashboard, las URLs para copiar con un botón, y el formulario para pegar Client ID y Client secret (se guardan cifrados en la base).
4. El Cliente (o el admin desde el panel del Cliente) escribe su tienda, toca **Conectar con Shopify**, acepta los permisos y vuelve conectado.

## La app de Shopify: por qué existe y cuál usar

Shopify no deja que un sistema externo entre a una tienda con una clave suelta: hace falta una **app** registrada en el Dev Dashboard. La app es solo "la llave" del portal; cada tienda sigue siendo del Cliente y él decide instalarla.

| Opción | Cuándo | Cómo |
|---|---|---|
| **Personalizada** (custom distribution) | Primeros clientes, ya mismo | Una app por Cliente, atada a su dominio `.myshopify.com`. Sin revisión de Shopify. En el asistente: "Solo para este cliente". |
| **Pública unlisted** | Cuando haya varios clientes | Una sola app para todos. Requiere App Review de Shopify una vez. En el asistente: "Para todos los clientes". |

Se pueden combinar: un Cliente con app propia la sigue usando aunque después se cargue una general. Cada conexión recuerda con qué app se creó.

## Probar antes de usar con un Cliente

1. Crear una **development store** gratis desde el Dev Dashboard, con 2 o 3 productos con variantes y stock.
2. Crear una app personalizada para esa tienda y cargarla en un Cliente de prueba.
3. Integraciones → Conectar → aceptar permisos → ver la sincronización inicial.
4. Cambiar un precio o stock en Shopify: en pocos segundos se ve en Artículos.
5. Hacer un pedido por WhatsApp → Confirmarlo en Pedidos → aparece en Shopify (#1001…) con pago pendiente.
6. Cancelarlo en el portal → queda cancelado en Shopify y vuelve el stock.

> Las tiendas de desarrollo aceptan como máximo 5 pedidos por minuto creados por API.

## Notas técnicas

- Código: `src/services/shopify*.js`, `src/routes/shopify.js` (webhooks + instalación/OAuth), las rutas `/api/clientes/:id/shopify/*` e `/integraciones` en `src/routes/api.js`, y `client/src/pages/Integraciones.jsx` + `client/src/components/ShopifySync.jsx`.
- Tablas: `ShopifyApps` (credenciales; `clienteId` NULL = app general), `ShopifyConexiones` (una por Cliente, con `appId`), `ShopifyWebhookLog` (dedupe). Columnas `shopify*` en `Articulos` y `Pedidos`.
- Tokens y secrets cifrados con AES-256-GCM. La clave se deriva de `SESSION_SECRET` (o `TOKEN_ENC_KEY` si existe). **Si cambia `SESSION_SECRET`**, hay que volver a cargar las credenciales y reconectar las tiendas (el portal lo avisa).
- La URL pública se toma del dominio desde el que el admin cargó las credenciales. `APP_URL` (opcional) la fuerza.
- Tokens offline **con expiración** (1 h, refresh 90 días), obligatorios para apps nuevas desde el 1/12/2026. La sync diaria mantiene vivo el refresh token. Si se pierde, la conexión pasa a "Requiere atención" con un botón **Reconectar**.
- Webhooks y firmas: se valida contra el secret de cada app cargada.
- **Lista de IP permitidas**: desde el 20/11/2026 Shopify la exige para apps personalizadas instaladas en tiendas fuera de tu organización (y desde el 1/1/2027 también para las ya instaladas). Sin ella, la API responde 403. Hace falta una IP de salida fija: Railway → Settings → Networking → Static Outbound IPs (plan Pro), cargada en la app → Configuración → Lista de IP permitidas.
- Los webhooks de compliance (GDPR) ya no se cargan desde el Dev Dashboard (solo vía `shopify.app.toml` + CLI) y solo los exige el App Store. Para distribución personalizada no hacen falta. El endpoint `/shopify/webhooks` igual los atiende.
- No se pide acceso a "datos protegidos de clientes": si Shopify rechaza el teléfono del pedido, se reintenta sin él y el WhatsApp queda en la nota.
- Artículos cargados a mano antes de conectar se "adoptan" si coinciden por SKU (= Código) o por nombre exacto. Los que no coinciden siguen siendo manuales: el bot los ofrece, pero esos pedidos no se pueden mandar a Shopify (el portal muestra el error y permite reintentar).
- Los pedidos que fallan al enviarse quedan Confirmados en el portal con estado Shopify "Error" y un botón para reintentar. Nunca se crean dos veces.
