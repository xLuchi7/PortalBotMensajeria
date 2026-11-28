const { ejecutar, sql } = require('./db');

// Cotización del dólar por día, para mostrar el Dashboard en USD.
// Fuente: currency-api (https://github.com/fawazahmed0/exchange-api), gratis y
// sin clave, con un archivo por fecha. Lo que se trae queda en CotizacionesDolar
// (es igual para todos los Clientes), así cada día se pide una sola vez.
// valor = unidades de la moneda por 1 USD.

const TIMEOUT_MS = 8000;
const EN_PARALELO = 4;
const MAX_FECHAS_POR_VEZ = 400;
const REINTENTO_MS = 60 * 60 * 1000;

const fuentes = fecha => [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${fecha}/v1/currencies/usd.min.json`,
  `https://${fecha}.currency-api.pages.dev/v1/currencies/usd.min.json`,
];

const MONEDA_RE = /^[A-Z]{3}$/;
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const hoy = () => new Date().toISOString().slice(0, 10);
function sumarDias(f, n) {
  const d = new Date(`${f}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Trae las cotizaciones de una fecha ('latest' = la última publicada).
async function pedir(fecha) {
  for (const url of fuentes(fecha)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.usd && data.date) return { fecha: String(data.date).slice(0, 10), usd: data.usd };
    } catch { /* probar la otra fuente */ }
  }
  return null;
}

async function guardar(filas) {
  if (!filas.length) return;
  await ejecutar('dbo.usp_Portal_CotizacionesGuardar', { filas: [sql.NVarChar(sql.MAX), JSON.stringify(filas)] });
}

function filasDe(respuesta, monedas) {
  return monedas
    .map(m => ({ moneda: m, fecha: respuesta.fecha, valor: Number(respuesta.usd[m.toLowerCase()]) }))
    .filter(f => f.valor > 0);
}

const fallidas = new Map(); // fecha -> ms del último intento fallido
const pidiendo = new Set(); // fechas en curso
let rellenando = null;

// Completa en segundo plano las fechas que faltan (no espera).
function rellenar(fechas, monedas) {
  const pendientes = fechas
    .filter(f => !pidiendo.has(f) && Date.now() - (fallidas.get(f) || 0) > REINTENTO_MS)
    .slice(0, MAX_FECHAS_POR_VEZ);
  if (!pendientes.length) return;
  pendientes.forEach(f => pidiendo.add(f));
  const anterior = rellenando || Promise.resolve();
  rellenando = anterior.then(async () => {
    const cola = [...pendientes];
    const filas = [];
    await Promise.all(Array.from({ length: EN_PARALELO }, async () => {
      while (cola.length) {
        const f = cola.shift();
        const r = await pedir(f);
        if (r) filas.push(...filasDe({ ...r, fecha: f }, monedas));
        else fallidas.set(f, Date.now());
        pidiendo.delete(f);
      }
    }));
    await guardar(filas);
  }).catch(err => {
    pendientes.forEach(f => pidiendo.delete(f));
    console.warn('[cotizaciones] No se pudieron completar las cotizaciones:', err.message);
  });
}

// Devuelve { valor(moneda, fecha) → unidades por 1 USD | null, completando }.
// Si de una moneda no hay ningún dato, espera la cotización de hoy (un pedido);
// los días que falten se completan en segundo plano y mientras tanto se usa el
// día más cercano que haya.
async function tabla(monedasPedidas, desde, hasta) {
  const monedas = [...new Set(monedasPedidas.filter(Boolean).map(m => String(m).toUpperCase()))]
    .filter(m => m !== 'USD' && MONEDA_RE.test(m));
  const porMoneda = new Map(monedas.map(m => [m, new Map()]));
  if (!monedas.length) return { valor: () => 1, completando: false };

  const leer = async () => {
    const r = await ejecutar('dbo.usp_Portal_CotizacionesObtener', {
      monedas: [sql.NVarChar(500), JSON.stringify(monedas)],
      desde: [sql.Date, desde],
      hasta: [sql.Date, hasta],
    });
    for (const f of r.recordset) porMoneda.get(f.moneda)?.set(iso(f.fecha), Number(f.valor));
  };
  await leer();

  const sinNada = monedas.filter(m => !porMoneda.get(m).size);
  if (sinNada.length) {
    const r = await pedir('latest');
    if (r) {
      const filas = filasDe(r, sinNada);
      await guardar(filas).catch(() => {});
      for (const f of filas) porMoneda.get(f.moneda).set(f.fecha, f.valor);
    }
  }

  // Días del rango sin cotización (hasta ayer: la de hoy a veces todavía no está publicada).
  const tope = [hasta, sumarDias(hoy(), -1)].sort()[0];
  const faltan = [];
  for (let f = desde; f <= tope; f = sumarDias(f, 1)) {
    if (monedas.some(m => !porMoneda.get(m).has(f))) faltan.push(f);
  }
  if (faltan.length) rellenar(faltan, monedas);

  const ordenadas = new Map(monedas.map(m => [m, [...porMoneda.get(m).entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))]));
  const valor = (moneda, fecha) => {
    const m = String(moneda || '').toUpperCase();
    if (!m || m === 'USD') return 1;
    const lista = ordenadas.get(m);
    if (!lista?.length) return null;
    const exacta = porMoneda.get(m).get(fecha);
    if (exacta) return exacta;
    // La anterior más cercana; si no hay, la primera que haya.
    let elegida = lista[0][1];
    for (const [f, v] of lista) {
      if (f > fecha) break;
      elegida = v;
    }
    return elegida;
  };
  return { valor, completando: faltan.some(f => pidiendo.has(f)) };
}

module.exports = { tabla };
