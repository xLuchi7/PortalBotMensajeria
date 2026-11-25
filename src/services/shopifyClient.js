const { getPool, sql } = require('./db');
const config = require('../config');
const { cifrar, descifrar } = require('./cryptoService');
const apps = require('./shopifyAppService');

// Todo acceso a la Admin API de Shopify pasa por acá: lee la conexión del
// Cliente, renueva el token si está por vencer y hace la llamada GraphQL con
// reintentos ante rate limit.

const MARGEN_REFRESH_MS = 5 * 60 * 1000;
const VENCIDO = 'El acceso a Shopify venció. Volvé a conectar la tienda.';

// ── Conexiones ──────────────────────────────────────────────────────────────

const COLUMNAS_PUBLICAS = 'clienteId, appId, shopDomain, nombreTienda, moneda, scopes, estado, ultimaSync, ultimoError, fechaAlta';

async function obtenerConexion(clienteId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query(`SELECT ${COLUMNAS_PUBLICAS} FROM ShopifyConexiones WHERE clienteId = @clienteId`);
  return r.recordset[0] ?? null;
}

// Conexión utilizable (para decidir si Shopify manda sobre artículos/stock/pedidos).
// Una conexión en "error" sigue contando: el vínculo existe, solo hay que reconectar.
async function obtenerConexionActiva(clienteId) {
  const c = await obtenerConexion(clienteId);
  return c && c.estado !== 'desinstalada' ? c : null;
}

async function obtenerConexionPorShop(shopDomain) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('shop', sql.NVarChar, shopDomain)
    .query(`SELECT ${COLUMNAS_PUBLICAS} FROM ShopifyConexiones WHERE shopDomain = @shop`);
  return r.recordset[0] ?? null;
}

async function listarConexionesActivas() {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT ${COLUMNAS_PUBLICAS} FROM ShopifyConexiones WHERE estado = 'activa'`);
  return r.recordset;
}

function vencimiento(segundos) {
  return segundos ? new Date(Date.now() + Number(segundos) * 1000) : null;
}

// appId solo al conectar; en un refresh se conserva el que ya tenía.
async function guardarConexion(clienteId, { shopDomain, tokenData, appId = null }) {
  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('shop', sql.NVarChar, shopDomain)
    .input('access', sql.NVarChar, cifrar(tokenData.access_token))
    .input('expira', sql.DateTime2, vencimiento(tokenData.expires_in))
    .input('refresh', sql.NVarChar, cifrar(tokenData.refresh_token ?? null))
    .input('refreshExpira', sql.DateTime2, vencimiento(tokenData.refresh_token_expires_in))
    .input('scopes', sql.NVarChar, tokenData.scope ?? null)
    .input('appId', sql.Int, appId)
    .query(`
      MERGE ShopifyConexiones AS t
      USING (SELECT @clienteId AS clienteId) AS s ON t.clienteId = s.clienteId
      WHEN MATCHED THEN UPDATE SET
        appId = COALESCE(@appId, t.appId), shopDomain = @shop, accessTokenEnc = @access, tokenExpira = @expira,
        refreshTokenEnc = @refresh, refreshExpira = @refreshExpira, scopes = @scopes,
        estado = 'activa', ultimoError = NULL
      WHEN NOT MATCHED THEN INSERT
        (clienteId, appId, shopDomain, accessTokenEnc, tokenExpira, refreshTokenEnc, refreshExpira, scopes, estado)
        VALUES (@clienteId, @appId, @shop, @access, @expira, @refresh, @refreshExpira, @scopes, 'activa');
    `);
}

async function actualizarDatosTienda(clienteId, { nombreTienda, moneda }) {
  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('nombre', sql.NVarChar, nombreTienda)
    .input('moneda', sql.NVarChar, moneda)
    .query('UPDATE ShopifyConexiones SET nombreTienda = @nombre, moneda = @moneda WHERE clienteId = @clienteId');
}

async function marcarEstado(clienteId, estado, ultimoError = null) {
  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('estado', sql.NVarChar, estado)
    .input('error', sql.NVarChar(1000), ultimoError ? String(ultimoError).slice(0, 1000) : null)
    .query('UPDATE ShopifyConexiones SET estado = @estado, ultimoError = @error WHERE clienteId = @clienteId');
}

async function marcarSync(clienteId) {
  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query('UPDATE ShopifyConexiones SET ultimaSync = SYSUTCDATETIME() WHERE clienteId = @clienteId');
}

// Al desinstalar/desconectar se borran los tokens: no queremos credenciales
// muertas guardadas. La fila queda para mostrar el estado en el portal.
async function borrarTokens(clienteId, estado) {
  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('estado', sql.NVarChar, estado)
    .query(`
      UPDATE ShopifyConexiones
      SET accessTokenEnc = NULL, refreshTokenEnc = NULL, tokenExpira = NULL, refreshExpira = NULL, estado = @estado
      WHERE clienteId = @clienteId
    `);
}

async function eliminarConexion(clienteId) {
  const pool = await getPool();
  await pool.request().input('clienteId', sql.Int, clienteId).query('DELETE FROM ShopifyConexiones WHERE clienteId = @clienteId');
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
  const pool = await getPool();
  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query('SELECT appId, shopDomain, accessTokenEnc, tokenExpira, refreshTokenEnc, estado FROM ShopifyConexiones WHERE clienteId = @clienteId');
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
      await marcarEstado(clienteId, 'error', 'Shopify rechazó el acceso. Volvé a conectar la tienda.');
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
