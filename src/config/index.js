module.exports = {
  port: process.env.PORT || 3100,
  sessionSecret: process.env.SESSION_SECRET,
  // Opcional. URL pública del portal, sin "/" final. Si no está, se usa el
  // dominio desde el que el admin cargó las credenciales de Shopify.
  appUrl: (process.env.APP_URL || '').replace(/\/+$/, ''),
  db: {
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '1433', 10),
  },
  shopify: {
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-10',
    scopes: process.env.SHOPIFY_SCOPES || 'read_products,read_inventory,read_orders,write_orders',
    // Opcional (32 bytes hex). Si no está, la clave se deriva de SESSION_SECRET.
    tokenEncKey: process.env.TOKEN_ENC_KEY,
  },
  // Para responder chats a mano: el Portal le pide a Bot_Mensajeria que mande el
  // mensaje (el token de WhatsApp vive solo en el bot). BOT_API_TOKEN tiene que
  // ser igual al PORTAL_API_TOKEN del bot. Sin esto, la caja para escribir no aparece.
  bot: {
    url: (process.env.BOT_URL || '').replace(/\/+$/, ''),
    apiToken: process.env.BOT_API_TOKEN,
  },
};
