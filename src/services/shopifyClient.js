const { ejecutar, sql } = require('./db');
const config = require('../config');
const { cifrar, descifrar } = require('./cryptoService');
const apps = require('./shopifyAppService');

// Todo acceso a la Admin API de Shopify pasa por acá: lee la conexión del
// Cliente, renueva el token si está por vencer y hace la llamada GraphQL con
// reintentos ante rate limit.

const MARGEN_REFRESH_MS = 5 * 60 * 1000;
const VENCIDO = 'El acceso a Shopify venció. Volvé a conectar la tienda.';

// ── Conexiones ──────────────────────────────────────────────────────────────

// Datos públicos de la conexión (sin tokens), de usp_Portal_ShopifyConexionObtener.
async function obtenerConexion(clienteId) {
  const r = await ejecutar('dbo.usp_Portal_ShopifyConexionObtener', { clienteId: [sql.Int, clienteId] });
  return r.recordset[0] ?? null;
}

// Conexión utilizable (para decidir si Shopify manda sobre artículos/stock/pedidos).
// Una conexión en "error" sigue contando: el vínculo existe, solo hay que reconectar.
async function obtenerConexionActiva(clienteId) {
  const c = await obtenerConexion(clienteId);
  return c && c.estado !== 'desinstalada' ? c : null;
}

async function obtenerConexionPorShop(shopDomain) {
  const r = await ejecutar('dbo.usp_Portal_ShopifyConexionObtener', { shopDomain: [sql.NVarChar(255), shopDomain] });
  return r.recordset[0] ?? null;
}

async function listarConexionesActivas() {
  const r = await ejecutar('dbo.usp_Portal_ShopifyConexionObtener', { soloActivas: [sql.Bit, 1] });
  return r.recordset;
}

function vencimiento(segundos) {
  return segundos ? new Date(Date.now() + Number(segundos) * 1000) : null;
}

// appId solo al conectar; en un refresh se conserva el que ya tenía.
async function guardarConexion(clienteId, { shopDomain, tokenData, appId = null }) {
  await ejecutar('dbo.usp_Portal_ShopifyConexionGuardar', {
    clienteId: [sql.Int, clienteId],
    shopDomain: [sql.NVarChar(255), shopDomain],
    accessEnc: [sql.NVarChar(1000), cifrar(tokenData.access_token)],
    tokenExpira: [sql.DateTime2, vencimiento(tokenData.expires_in)],
    refreshEnc: [sql.NVarChar(1000), cifrar(tokenData.refresh_token ?? null)],
    refreshExpira: [sql.DateTime2, vencimiento(tokenData.refresh_token_expires_in)],
    scopes: [sql.NVarChar(500), tokenData.scope ?? null],
    appId: [sql.Int, appId],
  });
}

// Cambios chicos de la conexión (usp_Portal_ShopifyConexionCambiar).
function cambiarConexion(clienteId, accion, { estado = null, error = null, nombreTienda = null, moneda = null } = {}) {
  return ejecutar('dbo.usp_Portal_ShopifyConexionCambiar', {
    clienteId: [sql.Int, clienteId],
    accion: [sql.VarChar(20), accion],
    estado: [sql.NVarChar(20), estado],
    error: [sql.NVarChar(1000), error ? String(error).slice(0, 1000) : null],
    nombreTienda: [sql.NVarChar(255), nombreTienda],
    moneda: [sql.NVarChar(10), moneda],
  });
}

async function actualizarDatosTienda(clienteId, { nombreTienda, moneda }) {
  await cambiarConexion(clienteId, 'datosTienda', { nombreTienda, moneda });
}

async function marcarEstado(clienteId, estado, ultimoError = null) {
  await cambiarConexion(clienteId, 'estado', { estado, error: ultimoError });
}

// Si había quedado en error (ej. un bloqueo por IP ya resuelto), un sync que
// anduvo la vuelve a activa: si no, la sync periódica la saltearía para siempre.
async function marcarSync(clienteId) {
  await cambiarConexion(clienteId, 'sync');
}

// Al desinstalar/desconectar se borran los tokens: no queremos credenciales
// muertas guardadas. La fila queda para mostrar el estado en el portal.
async function borrarTokens(clienteId, estado) {
  await cambiarConexion(clienteId, 'borrarTokens', { estado });
}

async function eliminarConexion(clienteId) {
  await cambiarConexion(clienteId, 'eliminar');
}

// ── Tokens ──────────────────────────────────────────────────────────────────

class ShopifyAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ShopifyAuthError';
  }
}

async function postToken(app, shopDomain, params) {
  const resp = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      ...params,
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    const err = new Error(`Shopify rechazó el pedido de token (HTTP ${resp.status}${data.error ? `: ${data.error}` : ''}).`);
    err.status = resp.status;
    throw err;
  }
  return data;
}

// Canje del "code" del OAuth. expiring=1 => token offline que vence en 1h con
// refresh token de 90 días (obligatorio para apps nuevas desde dic-2026).
function canjearCodigo(app, shopDomain, code) {
  return postToken(app, shopDomain, { code, expiring: '1' });
}

// Un refresh en curso por Cliente: dos llamadas simultáneas no deben gastar el
// mismo refresh token dos veces.
const refreshEnCurso = new Map();

async function obtenerToken(clienteId) {
  const r = await ejecutar('dbo.usp_Portal_ShopifyConexionToken', { clienteId: [sql.Int, clienteId] });
  const fila = r.recordset[0];
  if (!fila || !fila.accessTokenEnc || fila.estado === 'desinstalada') {
    throw new ShopifyAuthError('La tienda de Shopify no está conectada.');
  }

  const vencePronto = fila.tokenExpira && new Date(fila.tokenExpira).getTime() - Date.now() < MARGEN_REFRESH_MS;
  if (!vencePronto) {
    try {
      return { shopDomain: fila.shopDomain, token: descifrar(fila.accessTokenEnc) };
    } catch {
      await marcarEstado(clienteId, 'error', VENCIDO);
      throw new ShopifyAuthError(VENCIDO);
    }
  }

  const app = await apps.obtenerApp(fila.appId);
  if (!app || !app.clientSecret) {
    await marcarEstado(clienteId, 'error', 'Faltan las credenciales de la app de Shopify. Volvé a conectar la tienda.');
    throw new ShopifyAuthError('Faltan las credenciales de la app de Shopify.');
  }

  if (!fila.refreshTokenEnc) {
    await marcarEstado(clienteId, 'error', VENCIDO);
    throw new ShopifyAuthError(VENCIDO);
  }

  if (!refreshEnCurso.has(clienteId)) {
    const p = (async () => {
      try {
        let refreshToken;
        try {
          refreshToken = descifrar(fila.refreshTokenEnc);
        } catch {
          const e = new Error('Refresh token ilegible.');
          e.status = 401;
          throw e;
        }
        const data = await postToken(app, fila.shopDomain, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        });
        await guardarConexion(clienteId, { shopDomain: fila.shopDomain, tokenData: data });
        return data.access_token;
      } catch (err) {
        // 400/401 = refresh token inválido o vencido: no tiene arreglo sin reconectar.
        if (err.status === 400 || err.status === 401) {
          await marcarEstado(clienteId, 'error', VENCIDO);
          throw new ShopifyAuthError(VENCIDO);
        }
        throw err;
      } finally {
        refreshEnCurso.delete(clienteId);
      }
    })();
    refreshEnCurso.set(clienteId, p);
  }

  const token = await refreshEnCurso.get(clienteId);
  return { shopDomain: fila.shopDomain, token };
}

// ── GraphQL ─────────────────────────────────────────────────────────────────

const esperar = ms => new Promise(r => setTimeout(r, ms));

class ShopifyApiError extends Error {
  constructor(message, detalles) {
    super(message);
    this.name = 'ShopifyApiError';
    this.detalles = detalles;
  }
}

async function graphqlConToken(shopDomain, token, query, variables = {}) {
  const url = `https://${shopDomain}/admin/api/${config.shopify.apiVersion}/graphql.json`;

  for (let intento = 0; intento < 6; intento++) {
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      if (intento < 5) { await esperar(1000 * 2 ** intento); continue; }
      throw new ShopifyApiError(`No se pudo conectar con Shopify: ${err.message}`);
    }

    if (resp.status === 401 || resp.status === 403) {
      const cuerpo = await resp.text().catch(() => '');
      // La app tiene una lista de IPs permitidas y el servidor salió por otra
      // (Railway cambia la IP de salida). Reconectar no lo arregla.
      if (/IP restriction/i.test(cuerpo)) {
        const ip = cuerpo.match(/from ([0-9a-f:.]+)/i)?.[1];
        const err = new ShopifyAuthError(`Shopify bloqueó la conexión por la restricción de IPs de la app${ip ? ` (el servidor salió por ${ip})` : ''}. Sacá la restricción o agregá esa IP en la configuración de la app en Shopify.`);
        err.porIp = true;
        throw err;
      }
      throw new ShopifyAuthError(`Shopify rechazó el acceso (HTTP ${resp.status}).`);
    }
    if (resp.status === 429 || resp.status >= 500) {
      const retryAfter = Number(resp.headers.get('retry-after')) || 2 ** intento;
      if (intento < 5) { await esperar(retryAfter * 1000); continue; }
      throw new ShopifyApiError(`Shopify no respondió (HTTP ${resp.status}).`);
    }

    const body = await resp.json();
    const throttled = body.errors?.some(e => e.extensions?.code === 'THROTTLED');
    if (throttled && intento < 5) {
      const t = body.extensions?.cost?.throttleStatus;
      const costo = body.extensions?.cost?.requestedQueryCost ?? 100;
      const espera = t ? Math.max(1, (costo - t.currentlyAvailable) / t.restoreRate) : 2;
      await esperar(espera * 1000);
      continue;
    }
    if (body.errors?.length) {
      throw new ShopifyApiError(body.errors.map(e => e.message).join(' | '), body.errors);
    }
    return body.data;
  }
  throw new ShopifyApiError('Shopify está limitando las llamadas, probá de nuevo en un rato.');
}

async function graphql(clienteId, query, variables) {
  const { shopDomain, token } = await obtenerToken(clienteId);
  try {
    return await graphqlConToken(shopDomain, token, query, variables);
  } catch (err) {
    if (err instanceof ShopifyAuthError) {
      await marcarEstado(clienteId, 'error', err.porIp ? err.message : 'Shopify rechazó el acceso. Volvé a conectar la tienda.');
    }
    throw err;
  }
}

// Shopify identifica todo con GIDs ("gid://shopify/Product/123"); los webhooks
// mandan el número suelto.
function gid(tipo, id) {
  return String(id).startsWith('gid://') ? String(id) : `gid://shopify/${tipo}/${id}`;
}
function idNumerico(gidValor) {
  return String(gidValor || '').split('/').pop();
}

module.exports = {
  obtenerConexion,
  obtenerConexionActiva,
  obtenerConexionPorShop,
  listarConexionesActivas,
  guardarConexion,
  actualizarDatosTienda,
  marcarEstado,
  marcarSync,
  borrarTokens,
  eliminarConexion,
  canjearCodigo,
  graphql,
  graphqlConToken,
  gid,
  idNumerico,
  ShopifyAuthError,
  ShopifyApiError,
};
