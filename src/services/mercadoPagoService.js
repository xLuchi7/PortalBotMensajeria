const config = require('../config');
const { ejecutar, sql } = require('./db');
const { cifrar, descifrar } = require('./cryptoService');

// Cobros de Mercado Pago para el Dashboard: cuánto se cobró, cuánto se quedó
// Mercado Pago (comisión + costo de cuotas + retenciones) y cuánto llegó de verdad.
//
// Conexión: con OAuth (botón "Conectar con Mercado Pago", app propia en
// developers.mercadopago.com con MP_CLIENT_ID / MP_CLIENT_SECRET; el token dura
// 180 días y se renueva solo con el refresh token) o pegando el Access Token de
// producción de la cuenta (no vence).
//
// Sync: GET /v1/payments/search ordenado por date_last_updated, desde el cursor
// guardado (la primera vez, un año para atrás). Se guarda pago por pago en
// MercadoPagoPagos y el Dashboard suma por día con SQL.

const API = 'https://api.mercadopago.com';
const TIMEOUT_MS = 30 * 1000;
const DIAS_HISTORIA = 365;
const POR_PAGINA = 100;
const MAX_OFFSET = 1000; // pasado esto se corre el begin_date al último traído (la API limita el offset)
const RENOVAR_ANTES_MS = 15 * 86400 * 1000;
const REFRESCO_MS = 10 * 60 * 1000;

// Lo que no es una venta: plata que entra o sale de la cuenta por otros motivos.
const OPERACIONES_EXCLUIDAS = new Set(['money_transfer', 'account_fund', 'payment_addition', 'cellphone_recharge', 'investment', 'pos_withdrawal']);

class MercadoPagoError extends Error {
  constructor(message, { tokenInvalido = false } = {}) {
    super(message);
    this.name = 'MercadoPagoError';
    this.tokenInvalido = tokenInvalido;
  }
}

const oauthDisponible = () => Boolean(config.mercadoPago.clientId && config.mercadoPago.clientSecret);

async function llamar(path, { token, method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new MercadoPagoError(`No se pudo conectar con Mercado Pago: ${err.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle = data?.message || data?.error_description || data?.error || `HTTP ${res.status}`;
    if (res.status === 401) throw new MercadoPagoError('Mercado Pago rechazó el acceso (token vencido o revocado). Volvé a conectar la cuenta.', { tokenInvalido: true });
    if (res.status === 403) throw new MercadoPagoError('El token no tiene permiso para ver los pagos de la cuenta.', { tokenInvalido: true });
    if (res.status === 429) throw new MercadoPagoError('Mercado Pago está limitando las consultas. Probá de nuevo en unos minutos.');
    throw new MercadoPagoError(`Mercado Pago respondió: ${detalle}`);
  }
  return data;
}

// ── Conexión ────────────────────────────────────────────────────────────────

async function obtenerConexionInterna(clienteId) {
  const r = await ejecutar('dbo.usp_Portal_MercadoPagoConexionObtener', { clienteId: [sql.Int, clienteId] });
  return r.recordset[0] ?? null;
}

// Lo que puede ver el navegador (sin tokens).
async function obtenerConexion(clienteId) {
  const c = await obtenerConexionInterna(clienteId);
  if (!c) return null;
  const { accessTokenEnc, refreshTokenEnc, ...resto } = c;
  return resto;
}

function urlAutorizacion({ state, redirectUri }) {
  const params = new URLSearchParams({
    client_id: config.mercadoPago.clientId,
    response_type: 'code',
    platform_id: 'mp',
    state,
    redirect_uri: redirectUri,
  });
  return `${config.mercadoPago.authUrl}?${params}`;
}

async function guardarConexion(clienteId, { accessToken, refreshToken = null, expiraSeg = null, origen }) {
  const yo = await llamar('/users/me', { token: accessToken });
  if (!yo?.id) throw new MercadoPagoError('Mercado Pago no devolvió los datos de la cuenta.');
  await ejecutar('dbo.usp_Portal_MercadoPagoConexionGuardar', {
    clienteId: [sql.Int, clienteId],
    mpUserId: [sql.BigInt, Number(yo.id)],
    nickname: [sql.NVarChar(255), yo.nickname ? String(yo.nickname).slice(0, 255) : null],
    email: [sql.NVarChar(255), yo.email ? String(yo.email).slice(0, 255) : null],
    sitio: [sql.NVarChar(10), yo.site_id || null],
    accessTokenEnc: [sql.NVarChar(2000), cifrar(accessToken)],
    refreshTokenEnc: [sql.NVarChar(2000), refreshToken ? cifrar(refreshToken) : null],
    tokenExpiraSeg: [sql.Int, expiraSeg ? Math.round(expiraSeg) : null],
    origen: [sql.NVarChar(10), origen],
  });
  return { nickname: yo.nickname, email: yo.email };
}

// Vuelta del OAuth: canjea el código por los tokens.
async function canjearCodigo(clienteId, { code, redirectUri }) {
  const t = await llamar('/oauth/token', {
    method: 'POST',
    body: {
      client_id: config.mercadoPago.clientId,
      client_secret: config.mercadoPago.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    },
  });
  if (!t?.access_token) throw new MercadoPagoError('Mercado Pago no devolvió el token.');
  return guardarConexion(clienteId, { accessToken: t.access_token, refreshToken: t.refresh_token, expiraSeg: t.expires_in, origen: 'oauth' });
}

// Access Token de producción pegado a mano (APP_USR-...).
async function conectarManual(clienteId, token) {
  const valor = String(token || '').trim();
  if (!/^APP_USR-[\w-]{20,}$/.test(valor)) {
    throw new MercadoPagoError('Pegá el Access Token de producción (empieza con APP_USR-). Los de prueba (TEST-) no traen ventas reales.');
  }
  return guardarConexion(clienteId, { accessToken: valor, origen: 'manual' });
}

async function cambiar(clienteId, accion, extra = {}) {
  await ejecutar('dbo.usp_Portal_MercadoPagoConexionCambiar', {
    clienteId: [sql.Int, clienteId],
    accion: [sql.VarChar(10), accion],
    error: [sql.NVarChar(1000), extra.error ? String(extra.error).slice(0, 1000) : null],
    accessTokenEnc: [sql.NVarChar(2000), extra.accessTokenEnc || null],
    refreshTokenEnc: [sql.NVarChar(2000), extra.refreshTokenEnc || null],
    tokenExpiraSeg: [sql.Int, extra.expiraSeg ? Math.round(extra.expiraSeg) : null],
  });
}

const desconectar = clienteId => cambiar(clienteId, 'eliminar');

// tokenExpira se guarda en hora Argentina y mssql lo lee como UTC.
const expiraMs = c => (c.tokenExpira ? new Date(c.tokenExpira).getTime() + 3 * 3600 * 1000 : null);

// Token listo para usar: si es de OAuth y está por vencer, lo renueva.
async function tokenDe(clienteId, conexion) {
  let token;
  try { token = descifrar(conexion.accessTokenEnc); } catch {
    throw new MercadoPagoError('No se pudo leer el token guardado. Volvé a conectar la cuenta.', { tokenInvalido: true });
  }
  const vence = expiraMs(conexion);
  if (conexion.refreshTokenEnc && vence && vence - Date.now() < RENOVAR_ANTES_MS && oauthDisponible()) {
    const t = await llamar('/oauth/token', {
      method: 'POST',
      body: {
        client_id: config.mercadoPago.clientId,
        client_secret: config.mercadoPago.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: descifrar(conexion.refreshTokenEnc),
      },
    });
    if (t?.access_token) {
      await cambiar(clienteId, 'token', {
        accessTokenEnc: cifrar(t.access_token),
        refreshTokenEnc: t.refresh_token ? cifrar(t.refresh_token) : null,
        expiraSeg: t.expires_in,
      });
      token = t.access_token;
    }
  }
  return token;
}

// ── Pagos ───────────────────────────────────────────────────────────────────

const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const redondo = n => Math.round(n * 100) / 100;
// '2026-11-27T10:00:00.000-04:00' → UTC sin zona (como lo guarda ShopifyOrdenes).
const aUtc = v => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().replace(/Z$/, '');
};

function aPago(p) {
  const monto = num(p.transaction_amount);
  const reembolsado = num(p.transaction_amount_refunded);
  // Comisiones que paga el vendedor (no las que paga el comprador).
  const comision = (p.fee_details || [])
    .filter(f => !f.fee_payer || f.fee_payer === 'collector')
    .reduce((a, f) => a + num(f.amount), 0);
  const neto = num(p.transaction_details?.net_received_amount);
  // Lo que se quedó Mercado Pago: lo cobrado menos lo que llegó (incluye cuotas y
  // retenciones). Si no hay neto o hubo devoluciones, solo las comisiones.
  const costo = p.status === 'approved' && neto > 0 && !reembolsado ? Math.max(0, monto - neto) : comision;
  return {
    id: Number(p.id),
    creadoEn: aUtc(p.date_created),
    aprobadoEn: aUtc(p.date_approved),
    actualizadoEn: aUtc(p.date_last_updated),
    estado: p.status ? String(p.status).slice(0, 30) : null,
    tipoOperacion: p.operation_type ? String(p.operation_type).slice(0, 40) : null,
    tipoMedio: p.payment_type_id ? String(p.payment_type_id).slice(0, 40) : null,
    medioPago: p.payment_method_id ? String(p.payment_method_id).slice(0, 40) : null,
    cuotas: p.installments ? Number(p.installments) : null,
    moneda: p.currency_id || null,
    monto: redondo(monto),
    reembolsado: redondo(reembolsado),
    comision: redondo(comision),
    costo: redondo(costo),
    neto: redondo(neto),
    referencia: p.external_reference ? String(p.external_reference).slice(0, 255) : null,
    descripcion: p.description ? String(p.description).slice(0, 255) : null,
  };
}

async function buscar(token, desdeIso, offset) {
  const params = new URLSearchParams({
    sort: 'date_last_updated',
    criteria: 'asc',
    range: 'date_last_updated',
    begin_date: desdeIso,
    end_date: 'NOW',
    limit: String(POR_PAGINA),
    offset: String(offset),
  });
  return llamar(`/v1/payments/search?${params}`, { token });
}

// Trae lo que cambió desde el cursor. Devuelve cuántos pagos guardó.
async function sincronizar(clienteId) {
  const conexion = await obtenerConexionInterna(clienteId);
  if (!conexion) return 0;
  let guardados = 0;
  try {
    const token = await tokenDe(clienteId, conexion);
    // Un minuto de solapamiento: pagos con el mismo date_last_updated que el cursor.
    let desde = conexion.cursorActualizado
      ? new Date(new Date(conexion.cursorActualizado).getTime() - 60 * 1000).toISOString()
      : new Date(Date.now() - DIAS_HISTORIA * 86400 * 1000).toISOString();

    for (let vueltas = 0; vueltas < 200; vueltas++) {
      let offset = 0;
      let ultimo = null;
      let fin = false;
      while (offset < MAX_OFFSET) {
        const data = await buscar(token, desde, offset);
        const resultados = data?.results || [];
        const pagos = resultados.filter(p => !OPERACIONES_EXCLUIDAS.has(p.operation_type)).map(aPago).filter(p => p.id && p.creadoEn);
        if (resultados.length) {
          const cursor = resultados.map(p => p.date_last_updated).filter(Boolean).sort((a, b) => new Date(a) - new Date(b)).pop();
          if (cursor) ultimo = new Date(cursor);
          await ejecutar('dbo.usp_Portal_MercadoPagoPagosGuardar', {
            clienteId: [sql.Int, clienteId],
            pagos: [sql.NVarChar(sql.MAX), JSON.stringify(pagos)],
            cursor: [sql.DateTime2, ultimo],
          });
          guardados += pagos.length;
        }
        offset += resultados.length;
        if (resultados.length < POR_PAGINA || offset >= num(data?.paging?.total)) { fin = true; break; }
      }
      if (fin || !ultimo) break;
      // Se llegó al tope del offset: se sigue desde el último traído.
      const nuevo = ultimo.toISOString();
      if (nuevo <= desde) break;
      desde = nuevo;
    }
    await cambiar(clienteId, 'ok');
  } catch (err) {
    await cambiar(clienteId, 'error', { error: err.message }).catch(() => {});
    throw err;
  }
  return guardados;
}

function necesitaSync(conexion) {
  if (!conexion) return false;
  const ultima = conexion.ultimaSync ? new Date(conexion.ultimaSync).getTime() + 3 * 3600 * 1000 : 0;
  // Con error se reintenta igual cada tanto (puede haber sido un corte de Mercado Pago).
  return Date.now() - ultima > (conexion.estado === 'error' ? 6 * REFRESCO_MS : REFRESCO_MS);
}

module.exports = {
  MercadoPagoError,
  oauthDisponible,
  obtenerConexion,
  urlAutorizacion,
  canjearCodigo,
  conectarManual,
  desconectar,
  sincronizar,
  necesitaSync,
  expiraMs,
};
