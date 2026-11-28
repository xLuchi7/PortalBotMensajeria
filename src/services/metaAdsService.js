const config = require('../config');
const { ejecutar, sql } = require('./db');
const { cifrar, descifrar } = require('./cryptoService');

// Gasto en publicidad de Meta (Facebook / Instagram) para el Dashboard.
// Cada Cliente conecta su cuenta publicitaria (act_XXXX) con un token que tenga
// el permiso ads_read sobre esa cuenta (ej. un usuario del sistema de su Business
// Manager). Si no carga token, se prueba con el del Tech Provider
// (WHATSAPP_ACCESS_TOKEN), que sirve si la cuenta está compartida con ese Business.
// Se guarda el gasto por campaña y por día en MetaAdsDiario.

const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
const TIMEOUT_MS = 30 * 1000;
const MAX_DIAS_POR_PEDIDO = 31; // Meta responde mejor con rangos cortos y time_increment=1

// Orden de preferencia: la primera que venga es la que se usa.
const TIPOS_COMPRA = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'];
const TIPO_CONVERSACION = 'onsite_conversion.messaging_conversation_started_7d';

class MetaAdsError extends Error {
  constructor(message, { tokenInvalido = false } = {}) {
    super(message);
    this.name = 'MetaAdsError';
    this.tokenInvalido = tokenInvalido;
  }
}

function normalizarCuenta(valor) {
  const id = String(valor || '').trim().replace(/^act_/i, '');
  return /^\d{5,25}$/.test(id) ? id : null;
}

async function llamar(url, token) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch (err) {
    throw new MetaAdsError(`No se pudo conectar con Meta: ${err.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const e = data?.error || {};
    // 190 = token vencido o inválido; 200/10/100 con permisos = sin acceso a la cuenta.
    const tokenInvalido = e.code === 190 || e.code === 102;
    let msg = e.error_user_msg || e.message || `Meta respondió HTTP ${res.status}`;
    if (e.code === 190) msg = 'El acceso a Meta venció o no es válido. Volvé a conectar la cuenta.';
    else if (e.code === 200 || e.code === 10 || /permission|ads_read|ads_management/i.test(msg)) {
      msg = 'El token no tiene permiso para ver esa cuenta publicitaria (hace falta ads_read sobre la cuenta).';
    } else if (e.code === 17 || e.code === 4 || e.code === 80004) {
      msg = 'Meta está limitando las consultas de esta cuenta. Probá de nuevo en unos minutos.';
    }
    throw new MetaAdsError(msg, { tokenInvalido });
  }
  return data;
}

function url(path, params) {
  return `${BASE}/${path}?${new URLSearchParams(params)}`;
}

// ── Conexión ────────────────────────────────────────────────────────────────

async function obtenerConexionInterna(clienteId) {
  const r = await ejecutar('dbo.usp_Portal_MetaAdsConexionObtener', { clienteId: [sql.Int, clienteId] });
  return r.recordset[0] ?? null;
}

// Lo que puede ver el navegador (sin token).
async function obtenerConexion(clienteId) {
  const c = await obtenerConexionInterna(clienteId);
  if (!c) return null;
  const { tokenEnc, ...resto } = c;
  return { ...resto, tokenPropio: Boolean(tokenEnc) };
}

function tokenDe(conexion) {
  if (conexion.tokenEnc) {
    try { return descifrar(conexion.tokenEnc); } catch {
      throw new MetaAdsError('No se pudo leer el token guardado. Volvé a conectar la cuenta.', { tokenInvalido: true });
    }
  }
  if (!config.meta.whatsappToken) throw new MetaAdsError('Falta el token de Meta. Cargalo al conectar la cuenta.', { tokenInvalido: true });
  return config.meta.whatsappToken;
}

// Prueba el token contra la cuenta y la guarda. Sin token nuevo: si ya había uno
// para esa misma cuenta lo conserva; si no, usa el del Tech Provider.
async function conectar(clienteId, { adAccountId, token, expiraSeg = null }) {
  const cuenta = normalizarCuenta(adAccountId);
  if (!cuenta) throw new MetaAdsError('Revisá el ID de la cuenta publicitaria (son solo números, ej. act_1234567890).');
  const anterior = await obtenerConexionInterna(clienteId);
  let tokenEnc = null;
  let tokenUsado;
  let mismoToken = false;
  const nuevo = String(token || '').trim();
  if (nuevo) {
    if (nuevo.length < 20 || /\s/.test(nuevo)) throw new MetaAdsError('El token no parece válido.');
    tokenUsado = nuevo;
    tokenEnc = cifrar(nuevo);
  } else if (anterior?.tokenEnc && anterior.adAccountId === cuenta) {
    tokenEnc = anterior.tokenEnc;
    tokenUsado = tokenDe(anterior);
    mismoToken = true;
  } else {
    tokenUsado = tokenDe({ tokenEnc: null });
  }

  const info = await llamar(url(`act_${cuenta}`, { fields: 'name,currency,timezone_name,account_status' }), tokenUsado);
  await ejecutar('dbo.usp_Portal_MetaAdsConexionGuardar', {
    clienteId: [sql.Int, clienteId],
    adAccountId: [sql.NVarChar(40), cuenta],
    tokenEnc: [sql.NVarChar(2000), tokenEnc],
    nombreCuenta: [sql.NVarChar(255), info.name ? String(info.name).slice(0, 255) : null],
    moneda: [sql.NVarChar(10), info.currency || null],
    zonaHoraria: [sql.NVarChar(100), info.timezone_name || null],
    tokenExpiraSeg: [sql.Int, expiraSeg ? Math.round(expiraSeg) : null],
    mismoToken: [sql.Bit, mismoToken],
  });
  return { nombreCuenta: info.name, moneda: info.currency, activa: info.account_status === 1 };
}

// ── OAuth ("Conectar con Facebook") ─────────────────────────────────────────
// Necesita META_APP_ID + META_APP_SECRET (una app de Meta con Facebook Login y
// el permiso ads_read; para cuentas de otros negocios, ads_read con acceso
// avanzado). El token de usuario se canjea por uno largo (~60 días).

const oauthDisponible = () => Boolean(config.meta.appId && config.meta.appSecret);

function urlAutorizacion({ state, redirectUri }) {
  const params = new URLSearchParams({ client_id: config.meta.appId, redirect_uri: redirectUri, state, response_type: 'code' });
  if (config.meta.adsConfigId) params.set('config_id', config.meta.adsConfigId);
  else params.set('scope', 'ads_read');
  return `https://www.facebook.com/${config.meta.apiVersion}/dialog/oauth?${params}`;
}

async function canjearCodigo({ code, redirectUri }) {
  const corto = await llamar(url('oauth/access_token', {
    client_id: config.meta.appId, client_secret: config.meta.appSecret, redirect_uri: redirectUri, code,
  }), '');
  if (!corto?.access_token) throw new MetaAdsError('Meta no devolvió el token.');
  // Token largo (~60 días). Los de "Facebook Login for Business" con usuario del
  // sistema ya no vencen y el canje puede fallar: se usa el que vino.
  try {
    const largo = await llamar(url('oauth/access_token', {
      grant_type: 'fb_exchange_token', client_id: config.meta.appId, client_secret: config.meta.appSecret, fb_exchange_token: corto.access_token,
    }), '');
    if (largo?.access_token) return { token: largo.access_token, expiraSeg: largo.expires_in || null };
  } catch { /* se queda con el corto */ }
  return { token: corto.access_token, expiraSeg: corto.expires_in || null };
}

// Cuentas publicitarias que puede ver el token.
async function cuentasDe(token) {
  const cuentas = [];
  let siguiente = url('me/adaccounts', { fields: 'account_id,name,currency,account_status,business{name}', limit: '200' });
  for (let paginas = 0; siguiente && paginas < 10; paginas++) {
    const data = await llamar(siguiente, token);
    for (const c of data.data || []) {
      cuentas.push({
        id: String(c.account_id || '').replace(/^act_/, ''),
        nombre: c.name || `act_${c.account_id}`,
        moneda: c.currency || null,
        activa: c.account_status === 1,
        negocio: c.business?.name || null,
      });
    }
    siguiente = data.paging?.next || null;
  }
  return cuentas.filter(c => normalizarCuenta(c.id));
}

async function desconectar(clienteId) {
  await ejecutar('dbo.usp_Portal_MetaAdsConexionCambiar', { clienteId: [sql.Int, clienteId], accion: [sql.VarChar(10), 'eliminar'] });
}

async function marcarError(clienteId, error) {
  await ejecutar('dbo.usp_Portal_MetaAdsConexionCambiar', {
    clienteId: [sql.Int, clienteId],
    accion: [sql.VarChar(10), 'error'],
    error: [sql.NVarChar(1000), String(error).slice(0, 1000)],
  });
}

// ── Insights ────────────────────────────────────────────────────────────────

const numero = v => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));

function accion(lista, tipos) {
  for (const t of tipos) {
    const a = (lista || []).find(x => x.action_type === t);
    if (a) return numero(a.value);
  }
  return 0;
}

function sumarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// "Hoy" en la zona de la cuenta publicitaria (Meta no acepta un until futuro).
function hoyDeCuenta(conexion) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: conexion.zonaHoraria || 'America/Argentina/Buenos_Aires' }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date());
  }
}

async function insights(conexion, desde, hasta) {
  const token = tokenDe(conexion);
  const filas = [];
  let siguiente = url(`act_${conexion.adAccountId}/insights`, {
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({ since: desde, until: hasta }),
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions,action_values',
    limit: '500',
  });
  for (let paginas = 0; siguiente && paginas < 50; paginas++) {
    const data = await llamar(siguiente, token);
    for (const f of data.data || []) {
      filas.push({
        fecha: f.date_start,
        campaniaId: String(f.campaign_id || 'sin-campania'),
        campania: f.campaign_name ? String(f.campaign_name).slice(0, 255) : null,
        gasto: numero(f.spend),
        impresiones: numero(f.impressions),
        clics: numero(f.clicks),
        compras: Math.round(accion(f.actions, TIPOS_COMPRA)),
        valorCompras: accion(f.action_values, TIPOS_COMPRA),
        conversaciones: Math.round(accion(f.actions, [TIPO_CONVERSACION])),
      });
    }
    siguiente = data.paging?.next || null;
  }
  return filas;
}

// Trae y guarda [desde, hasta] de a tramos de un mes.
async function sincronizarRango(clienteId, conexion, desde, hasta) {
  const hoy = hoyDeCuenta(conexion);
  const tope = hasta > hoy ? hoy : hasta;
  for (let inicio = desde; inicio <= tope; inicio = sumarDias(inicio, MAX_DIAS_POR_PEDIDO)) {
    const fin = [sumarDias(inicio, MAX_DIAS_POR_PEDIDO - 1), tope].sort()[0];
    const filas = await insights(conexion, inicio, fin);
    await ejecutar('dbo.usp_Portal_MetaAdsDiarioGuardar', {
      clienteId: [sql.Int, clienteId],
      desde: [sql.Date, inicio],
      hasta: [sql.Date, fin],
      filas: [sql.NVarChar(sql.MAX), JSON.stringify(filas)],
    });
  }
}

const REFRESCO_MS = 15 * 60 * 1000;
const DIAS_A_REFRESCAR = 3; // Meta sigue ajustando los últimos días (atribución)

// Se asegura de tener [desde, hoy] guardado: completa lo que falta hacia atrás y
// refresca los últimos días si pasó un rato. `forzar` refresca aunque sea reciente.
async function sincronizar(clienteId, desdeNecesario, { forzar = false } = {}) {
  const conexion = await obtenerConexionInterna(clienteId);
  if (!conexion) return false;
  if (conexion.estado === 'error' && !forzar) return false;
  const hoy = hoyDeCuenta(conexion);
  const syncDesde = conexion.syncDesde ? new Date(conexion.syncDesde).toISOString().slice(0, 10) : null;
  const ultima = conexion.ultimaSync ? new Date(conexion.ultimaSync).getTime() + 3 * 3600 * 1000 : 0; // hora Argentina → UTC
  try {
    let hizoAlgo = false;
    if (!syncDesde) {
      await sincronizarRango(clienteId, conexion, desdeNecesario, hoy);
      return true;
    }
    if (desdeNecesario < syncDesde) {
      await sincronizarRango(clienteId, conexion, desdeNecesario, sumarDias(syncDesde, -1));
      hizoAlgo = true;
    }
    if (forzar || Date.now() - ultima > REFRESCO_MS) {
      await sincronizarRango(clienteId, conexion, [sumarDias(hoy, -DIAS_A_REFRESCAR), syncDesde].sort().pop(), hoy);
      hizoAlgo = true;
    }
    return hizoAlgo;
  } catch (err) {
    await marcarError(clienteId, err.message).catch(() => {});
    throw err;
  }
}

function necesitaSync(conexion, desdeNecesario) {
  if (!conexion || conexion.estado === 'error') return false;
  const syncDesde = conexion.syncDesde ? new Date(conexion.syncDesde).toISOString().slice(0, 10) : null;
  const ultima = conexion.ultimaSync ? new Date(conexion.ultimaSync).getTime() + 3 * 3600 * 1000 : 0;
  return !syncDesde || desdeNecesario < syncDesde || Date.now() - ultima > REFRESCO_MS;
}

module.exports = {
  MetaAdsError,
  normalizarCuenta,
  obtenerConexion,
  conectar,
  desconectar,
  oauthDisponible,
  urlAutorizacion,
  canjearCodigo,
  cuentasDe,
  sincronizar,
  necesitaSync,
};
