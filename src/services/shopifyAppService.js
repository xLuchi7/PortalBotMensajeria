const { ejecutar, sql } = require('./db');
const { cifrar, descifrar } = require('./cryptoService');

// Credenciales de las apps de Shopify (Client ID / Client secret del Dev
// Dashboard). Se cargan desde Integraciones, no en variables del servidor.
//   clienteId NULL  => app general (distribución pública): sirve para todos.
//   clienteId = X   => app de distribución personalizada, solo para ese Cliente.
// Cada conexión guarda con qué app se creó: el token pertenece a esa app.

const CACHE_MS = 30 * 1000;
let cache = null;

function mapear(f) {
  if (!f) return null;
  let clientSecret = null;
  try {
    clientSecret = descifrar(f.clientSecretEnc);
  } catch {
    // La clave de cifrado cambió: hay que volver a cargar el secret.
  }
  return {
    id: f.id,
    clienteId: f.clienteId,
    clientId: f.clientId,
    clientSecret,
    secretIlegible: !clientSecret,
    appUrl: f.appUrl,
    fechaAlta: f.fechaAlta,
  };
}

async function listarApps() {
  if (cache && Date.now() - cache.t < CACHE_MS) return cache.apps;
  const r = await ejecutar('dbo.usp_Portal_ShopifyAppsListar');
  const apps = r.recordset.map(mapear);
  cache = { t: Date.now(), apps };
  return apps;
}

async function obtenerApp(id) {
  if (!id) return null;
  return (await listarApps()).find(a => a.id === id) ?? null;
}

// La app con la que se conecta un Cliente nuevo: la suya propia si tiene,
// si no la general.
async function obtenerAppDeCliente(clienteId) {
  const apps = await listarApps();
  return apps.find(a => a.clienteId === clienteId) ?? apps.find(a => a.clienteId == null) ?? null;
}

// Reemplaza la app del alcance (Cliente o general) si ya existe: las tiendas
// conectadas con las credenciales anteriores tendrán que reconectar.
async function guardarApp({ clienteId, clientId, clientSecret, appUrl }) {
  await ejecutar('dbo.usp_Portal_ShopifyAppGuardar', {
    clienteId: [sql.Int, clienteId ?? null],
    clientId: [sql.NVarChar(100), clientId],
    secretEnc: [sql.NVarChar(1000), cifrar(clientSecret)],
    appUrl: [sql.NVarChar(255), appUrl],
  });
  cache = null;
}

// Para validar firmas cuando todavía no sabemos de qué app viene el aviso.
async function secretos() {
  return (await listarApps()).filter(a => a.clientSecret);
}

module.exports = { listarApps, obtenerApp, obtenerAppDeCliente, guardarApp, secretos };
