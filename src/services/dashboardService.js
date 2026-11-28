const { ejecutar, sql } = require('./db');
const shopify = require('./shopifyClient');
const metaAds = require('./metaAdsService');
const mercadoPago = require('./mercadoPagoService');
const cotizaciones = require('./cotizacionService');
const eventos = require('./eventosService');

// Dashboard de rentabilidad: cruza las órdenes de la tienda de Shopify con el
// gasto en Meta Ads, lo que cobró y se quedó Mercado Pago y los costos que carga
// el negocio. Todo se muestra en dólares (cotizacionService, día por día).
//
// Las órdenes se copian a ShopifyOrdenes (con sus ítems y el costo de cada
// producto) para poder sumar cualquier rango rápido con SQL:
// - la primera vez se traen las del último año (Shopify solo deja ver 60 días sin
//   el permiso read_all_orders: se trae lo que deje);
// - después, solo las que cambiaron desde la última (cursor por updatedAt);
// - los webhooks orders/* disparan una sync corta (programarSync) y al terminar
//   se avisa 'pedido' por SSE para que el Dashboard abierto se actualice.

const DIAS_HISTORIA = 365;
const ORDENES_POR_PAGINA = 12; // con 10 ítems por orden queda abajo del tope de costo de GraphQL (1000)
const ITEMS_POR_ORDEN = 10;
const REFRESCO_MS = 10 * 60 * 1000;
const ESPERA_WEBHOOK_MS = 15 * 1000;

const DINERO = 'shopMoney { amount }';
const CAMPOS_ITEM = `
  title quantity currentQuantity
  discountedTotalSet { ${DINERO} }
  variant { id inventoryItem { unitCost { amount } } }
`;
const QUERY_ORDENES = `
  query Ordenes($q: String!, $after: String) {
    orders(first: ${ORDENES_POR_PAGINA}, after: $after, query: $q, sortKey: UPDATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id name createdAt updatedAt cancelledAt test sourceName tags displayFinancialStatus currencyCode
        customAttributes { key value }
        totalPriceSet { ${DINERO} }
        subtotalPriceSet { ${DINERO} }
        totalDiscountsSet { ${DINERO} }
        totalShippingPriceSet { ${DINERO} }
        totalTaxSet { ${DINERO} }
        totalRefundedSet { ${DINERO} }
        lineItems(first: ${ITEMS_POR_ORDEN}) {
          pageInfo { hasNextPage endCursor }
          nodes { ${CAMPOS_ITEM} }
        }
      }
    }
  }
`;
const QUERY_MAS_ITEMS = `
  query MasItems($id: ID!, $after: String) {
    order(id: $id) {
      lineItems(first: 50, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { ${CAMPOS_ITEM} }
      }
    }
  }
`;

const monto = m => Number(m?.shopMoney?.amount) || 0;
const sinZ = iso => (iso ? String(iso).replace(/Z$/, '').slice(0, 23) : null);

function sumarDias(iso, dias) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diasEntre(desde, hasta) {
  return Math.round((new Date(`${hasta}T00:00:00Z`) - new Date(`${desde}T00:00:00Z`)) / 86400000) + 1;
}

function aItem(li) {
  const cantidad = Number(li.quantity) || 0;
  const actual = li.currentQuantity == null ? cantidad : Number(li.currentQuantity) || 0;
  const total = monto(li.discountedTotalSet);
  const costo = li.variant?.inventoryItem?.unitCost?.amount;
  return {
    varianteId: li.variant?.id ? Number(shopify.idNumerico(li.variant.id)) : null,
    titulo: li.title ? String(li.title).slice(0, 255) : null,
    cantidad: actual,
    // Lo devuelto no cuenta: el total se prorratea por la cantidad que quedó.
    total: cantidad ? Math.round((total * actual / cantidad) * 100) / 100 : 0,
    costoUnitario: costo == null || costo === '' ? null : Number(costo),
  };
}

function esWhatsapp(o) {
  if ((o.tags || []).some(t => String(t).toLowerCase() === 'whatsapp')) return true;
  return (o.customAttributes || []).some(a => String(a.key || '').trim().toLowerCase() === 'whatsapp');
}

async function itemsDe(clienteId, o) {
  const items = o.lineItems.nodes.map(aItem);
  let page = o.lineItems.pageInfo;
  while (page?.hasNextPage) {
    const d = await shopify.graphql(clienteId, QUERY_MAS_ITEMS, { id: o.id, after: page.endCursor });
    const li = d.order?.lineItems;
    if (!li) break;
    items.push(...li.nodes.map(aItem));
    page = li.pageInfo;
  }
  return items;
}

async function aOrden(clienteId, o) {
  const items = await itemsDe(clienteId, o);
  return {
    id: Number(shopify.idNumerico(o.id)),
    nombre: o.name ? String(o.name).slice(0, 50) : null,
    creadaEn: sinZ(o.createdAt),
    actualizadaEn: sinZ(o.updatedAt),
    total: monto(o.totalPriceSet),
    subtotal: monto(o.subtotalPriceSet),
    descuentos: monto(o.totalDiscountsSet),
    envio: monto(o.totalShippingPriceSet),
    impuestos: monto(o.totalTaxSet),
    reembolsado: monto(o.totalRefundedSet),
    unidades: items.reduce((a, i) => a + i.cantidad, 0),
    cancelada: o.cancelledAt ? 1 : 0,
    estadoPago: o.displayFinancialStatus ? String(o.displayFinancialStatus).slice(0, 30) : null,
    canal: o.sourceName ? String(o.sourceName).slice(0, 100) : null,
    esWhatsapp: esWhatsapp(o) ? 1 : 0,
    moneda: o.currencyCode || null,
    items,
  };
}

async function estadoSync(clienteId, accion = 'leer', { shopDomain = null, error = null } = {}) {
  const r = await ejecutar('dbo.usp_Portal_DashboardSyncCambiar', {
    clienteId: [sql.Int, clienteId],
    accion: [sql.VarChar(10), accion],
    shopDomain: [sql.NVarChar(255), shopDomain],
    error: [sql.NVarChar(1000), error ? String(error).slice(0, 1000) : null],
  });
  return r.recordset[0] ?? null;
}

// ── Sync de órdenes ─────────────────────────────────────────────────────────

const enCurso = new Map(); // `${clienteId}:shopify|meta` -> Promise
// Última vez que falló la sync de órdenes: sin esto, con la página abierta (que
// re-pide cada 4 s mientras sincroniza) se reintentaba sin parar y nunca
// terminaba de cargar. "Actualizar" la fuerza igual.
const falloShopify = new Map(); // clienteId -> ms

function unaALaVez(clave, fn) {
  if (!enCurso.has(clave)) {
    const p = fn().finally(() => enCurso.delete(clave));
    enCurso.set(clave, p);
  }
  return enCurso.get(clave);
}

function sincronizarOrdenes(clienteId) {
  return unaALaVez(`${clienteId}:shopify`, async () => {
    const conexion = await shopify.obtenerConexionActiva(clienteId);
    if (!conexion) return 0;
    let estado = await estadoSync(clienteId);
    // Primera vez (crea la fila de estado) o se conectó otra tienda (lo guardado era de la anterior).
    if (!estado || (estado.shopDomain && estado.shopDomain !== conexion.shopDomain)) {
      estado = await estadoSync(clienteId, 'reset', { shopDomain: conexion.shopDomain });
    }
    const desde = sumarDias(new Date().toISOString().slice(0, 10), -DIAS_HISTORIA);
    const filtros = [`created_at:>=${desde}`, 'test:false'];
    if (estado?.cursorActualizada) filtros.push(`updated_at:>='${new Date(estado.cursorActualizada).toISOString()}'`);
    const q = filtros.join(' AND ');

    let guardadas = 0;
    try {
      let after = null;
      for (;;) {
        const d = await shopify.graphql(clienteId, QUERY_ORDENES, { q, after });
        const nodos = (d.orders?.nodes || []).filter(o => !o.test);
        if (nodos.length) {
          const ordenes = [];
          for (const o of nodos) ordenes.push(await aOrden(clienteId, o));
          const cursor = nodos.map(o => o.updatedAt).sort().pop();
          await ejecutar('dbo.usp_Portal_DashboardOrdenesGuardar', {
            clienteId: [sql.Int, clienteId],
            shopDomain: [sql.NVarChar(255), conexion.shopDomain],
            ordenes: [sql.NVarChar(sql.MAX), JSON.stringify(ordenes)],
            cursor: [sql.DateTime2, cursor ? new Date(cursor) : null],
          });
          guardadas += ordenes.length;
        }
        if (!d.orders?.pageInfo?.hasNextPage) break;
        after = d.orders.pageInfo.endCursor;
      }
      await estadoSync(clienteId, 'ok');
      falloShopify.delete(clienteId);
    } catch (err) {
      falloShopify.set(clienteId, Date.now());
      await estadoSync(clienteId, 'error', { error: err.message }).catch(() => {});
      throw err;
    }
    if (guardadas) eventos.emitir(clienteId, 'pedido');
    return guardadas;
  });
}

// Un webhook de órdenes: se espera unos segundos (llegan varios juntos:
// create + updated + pago) y se trae lo que cambió.
const programadas = new Map();
function programarSync(clienteId) {
  if (programadas.has(clienteId)) return;
  const t = setTimeout(() => {
    programadas.delete(clienteId);
    sincronizarOrdenes(clienteId).catch(err => console.warn(`[dashboard] Sync de órdenes (cliente ${clienteId}) falló:`, err.message));
  }, ESPERA_WEBHOOK_MS);
  t.unref?.();
  programadas.set(clienteId, t);
}

// Mercado Pago: si falla, no se reintenta en cada pedido de la página.
const falloMp = new Map(); // clienteId -> ms
function sincronizarMp(clienteId) {
  return unaALaVez(`${clienteId}:mp`, async () => {
    try {
      const n = await mercadoPago.sincronizar(clienteId);
      falloMp.delete(clienteId);
      if (n) eventos.emitir(clienteId, 'pedido');
      return n;
    } catch (err) {
      falloMp.set(clienteId, Date.now());
      throw err;
    }
  });
}

function sincronizarMeta(clienteId, desde, opciones) {
  return unaALaVez(`${clienteId}:meta`, async () => {
    const hizo = await metaAds.sincronizar(clienteId, desde, opciones);
    if (hizo) eventos.emitir(clienteId, 'pedido');
    return hizo;
  });
}

// Arranca en segundo plano lo que haga falta (no espera).
function enSegundoPlano(promesa, que, clienteId) {
  promesa.catch(err => console.warn(`[dashboard] ${que} (cliente ${clienteId}):`, err.message));
}

async function actualizar(clienteId, desde) {
  enSegundoPlano(sincronizarOrdenes(clienteId), 'Sync de órdenes', clienteId);
  enSegundoPlano(sincronizarMeta(clienteId, desde, { forzar: true }), 'Sync de Meta Ads', clienteId);
  enSegundoPlano(sincronizarMp(clienteId), 'Sync de Mercado Pago', clienteId);
}

// ── Configuración de costos ─────────────────────────────────────────────────
// Los montos fijos (comisión fija, envío, costos fijos) se cargan en dólares.

const CONFIG_VACIA = { comisionPct: 0, comisionFija: 0, envioPorOrden: 0, costoProductoPct: null, costosFijosMes: 0, cotizacionAds: null, cotizacionUsd: null };

async function guardarConfig(clienteId, c) {
  await ejecutar('dbo.usp_Portal_DashboardConfigGuardar', {
    clienteId: [sql.Int, clienteId],
    comisionPct: [sql.Decimal(6, 3), c.comisionPct],
    comisionFija: [sql.Decimal(12, 2), c.comisionFija],
    envioPorOrden: [sql.Decimal(12, 2), c.envioPorOrden],
    costoProductoPct: [sql.Decimal(6, 3), c.costoProductoPct],
    costosFijosMes: [sql.Decimal(14, 2), c.costosFijosMes],
    cotizacionAds: [sql.Decimal(14, 4), null],
    cotizacionUsd: [sql.Decimal(18, 6), c.cotizacionUsd],
  });
}

// ── Métricas ────────────────────────────────────────────────────────────────

const div = (a, b) => (b ? a / b : null);
// Las columnas nuevas guardan hora Argentina y mssql las lee como si fueran UTC.
const horaArgentinaAUtc = d => (d ? new Date(new Date(d).getTime() + 3 * 3600 * 1000).toISOString() : null);
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Números de un día (o de un período, si se le pasan las sumas). Todo llega ya en USD.
// Con Mercado Pago conectado, la comisión es la real; el % y el fijo de Costos se
// aplican solo a lo que no pasó por Mercado Pago (otros medios de pago).
function calcular(s, m, p, cfg, dias, conMp) {
  const ventas = s.bruto - s.reembolsado;
  const costoProductos = s.costoProductos + s.ventasSinCosto * (Number(cfg.costoProductoPct) || 0) / 100;
  const costoEnvios = s.ordenes * (Number(cfg.envioPorOrden) || 0);
  const pct = (Number(cfg.comisionPct) || 0) / 100;
  const fija = Number(cfg.comisionFija) || 0;
  const comisionesOtros = conMp
    ? Math.max(0, ventas - p.cobrado) * pct + Math.max(0, s.ordenes - p.pagos) * fija
    : ventas * pct + s.ordenes * fija;
  const comisiones = (conMp ? p.costo : 0) + comisionesOtros;
  const costosFijos = (Number(cfg.costosFijosMes) || 0) * 12 / 365 * dias;
  const inversion = m.gasto;
  const contribucion = ventas - s.impuestos - costoProductos - costoEnvios - comisiones;
  const ganancia = contribucion - costosFijos - inversion;
  return {
    ordenes: s.ordenes,
    ordenesConValor: s.ordenesConValor,
    canceladas: s.canceladas,
    unidades: s.unidades,
    ventas,
    ventasNetas: ventas - s.impuestos - s.envioCobrado,
    reembolsado: s.reembolsado,
    descuentos: s.descuentos,
    impuestos: s.impuestos,
    envioCobrado: s.envioCobrado,
    costoProductos,
    costoEnvios,
    comisiones,
    comisionesMp: conMp ? p.costo : 0,
    comisionesOtros,
    costosFijos,
    inversion,
    ganancia,
    margen: div(ganancia, ventas),
    ticket: div(ventas, s.ordenes),
    roas: div(ventas, inversion),
    roasNeto: div(ventas - s.impuestos - s.envioCobrado, inversion),
    roasEquilibrio: contribucion > 0 ? ventas / contribucion : null,
    cpa: div(inversion, s.ordenes),
    ordenesWhatsapp: s.ordenesWhatsapp,
    ventasWhatsapp: s.ventasWhatsapp,
    gasto: m.gasto,
    impresiones: m.impresiones,
    clics: m.clics,
    ctr: div(m.clics, m.impresiones),
    cpc: div(inversion, m.clics),
    cpm: div(inversion * 1000, m.impresiones),
    comprasMeta: m.compras,
    valorComprasMeta: m.valorCompras,
    roasMeta: div(m.valorCompras, inversion),
    conversaciones: m.conversaciones,
    costoConversacion: div(inversion, m.conversaciones),
    pagosMp: p.pagos,
    cobradoMp: p.cobrado,
    costoMp: p.costo,
    netoMp: p.cobrado - p.costo,
    devueltoMp: p.devuelto,
    comisionMpPct: div(p.costo, p.cobrado),
    ticketMp: div(p.cobrado, p.pagos),
  };
}

const CAMPOS_SHOPIFY = ['ordenes', 'ordenesConValor', 'canceladas', 'unidades', 'bruto', 'reembolsado', 'impuestos', 'envioCobrado',
  'descuentos', 'costoProductos', 'ventasSinCosto', 'ordenesWhatsapp', 'ventasWhatsapp'];
const PLATA_SHOPIFY = ['bruto', 'reembolsado', 'impuestos', 'envioCobrado', 'descuentos', 'costoProductos', 'ventasSinCosto', 'ventasWhatsapp'];
const CAMPOS_META = ['gasto', 'impresiones', 'clics', 'compras', 'valorCompras', 'conversaciones'];
const PLATA_META = ['gasto', 'valorCompras'];
const CAMPOS_MP = ['pagos', 'cobrado', 'costo', 'devuelto'];
const PLATA_MP = ['cobrado', 'costo', 'devuelto'];
const ceros = campos => Object.fromEntries(campos.map(c => [c, 0]));
function sumar(filas, campos) {
  const t = ceros(campos);
  for (const f of filas) for (const c of campos) t[c] += Number(f[c]) || 0;
  return t;
}
function convertir(fila, campos, factor) {
  const r = { ...fila };
  for (const c of campos) r[c] = (Number(fila[c]) || 0) * factor;
  return r;
}
const promedio = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 1);

async function datos(clienteId, { desde, hasta }) {
  const dias = diasEntre(desde, hasta);
  const previoHasta = sumarDias(desde, -1);
  const previoDesde = sumarDias(desde, -dias);

  const [conexionShopify, conexionMeta, conexionMp] = await Promise.all([
    shopify.obtenerConexion(clienteId),
    metaAds.obtenerConexion(clienteId),
    mercadoPago.obtenerConexion(clienteId),
  ]);
  const shopifyActiva = conexionShopify && conexionShopify.estado !== 'desinstalada';

  const r = await ejecutar('dbo.usp_Portal_DashboardDatos', {
    clienteId: [sql.Int, clienteId],
    previoDesde: [sql.Date, previoDesde],
    desde: [sql.Date, desde],
    hasta: [sql.Date, hasta],
  });
  const [porDiaShopify, porDiaMeta, productos, campanias, canales, [cfgFila], [sync], porDiaMp = [], mediosMp = []] = r.recordsets;
  const cfg = { ...CONFIG_VACIA, ...(cfgFila || {}) };

  // Sync en segundo plano si hace falta (la página vuelve a pedir mientras corre).
  const ultimaShopify = sync?.ultimaSync ? new Date(sync.ultimaSync).getTime() + 3 * 3600 * 1000 : 0;
  const falloReciente = Date.now() - (falloShopify.get(clienteId) || 0) < REFRESCO_MS;
  if (shopifyActiva && !falloReciente && (!sync || !sync.ultimaSync || Date.now() - ultimaShopify > REFRESCO_MS)) {
    enSegundoPlano(sincronizarOrdenes(clienteId), 'Sync de órdenes', clienteId);
  }
  if (conexionMeta && metaAds.necesitaSync(conexionMeta, previoDesde)) {
    enSegundoPlano(sincronizarMeta(clienteId, previoDesde), 'Sync de Meta Ads', clienteId);
  }
  if (conexionMp && mercadoPago.necesitaSync(conexionMp) && Date.now() - (falloMp.get(clienteId) || 0) > REFRESCO_MS) {
    enSegundoPlano(sincronizarMp(clienteId), 'Sync de Mercado Pago', clienteId);
  }

  // ── Pasar todo a dólares, con la cotización de cada día ──
  const monedaTienda = conexionShopify?.moneda || null;
  const monedaAds = conexionMeta?.moneda || null;
  const monedasMp = [...new Set(porDiaMp.map(f => f.moneda).filter(Boolean))];
  const cotFija = Number(cfg.cotizacionUsd) || null;
  const tabla = await cotizaciones.tabla([monedaTienda, monedaAds, ...monedasMp], previoDesde, hasta)
    .catch((err) => { console.warn('[dashboard] Cotizaciones:', err.message); return { valor: () => null, completando: false }; });
  const sinCotizacion = new Set();
  // Factor para pasar 1 unidad de `moneda` a USD ese día.
  const factor = (moneda, fecha) => {
    if (!moneda || moneda === 'USD') return 1;
    // La cotización fija de Costos vale para la moneda de la tienda (y la misma moneda en Meta o Mercado Pago).
    if (cotFija && (moneda === monedaTienda || !monedaTienda)) return 1 / cotFija;
    const v = tabla.valor(moneda, fecha);
    if (!v) { sinCotizacion.add(moneda); return 1; }
    return 1 / v;
  };

  const sPorDia = new Map(porDiaShopify.map(f => [iso(f.fecha), f]));
  const mPorDia = new Map(porDiaMeta.map(f => [iso(f.fecha), f]));
  const pPorDia = new Map();
  for (const f of porDiaMp) {
    const d = iso(f.fecha);
    const enUsd = convertir(f, PLATA_MP, factor(f.moneda, d));
    const previa = pPorDia.get(d);
    pPorDia.set(d, previa ? sumar([previa, enUsd], CAMPOS_MP) : enUsd);
  }
  const filaS = d => convertir({ ...ceros(CAMPOS_SHOPIFY), ...sPorDia.get(d) }, PLATA_SHOPIFY, factor(monedaTienda, d));
  const filaM = d => convertir({ ...ceros(CAMPOS_META), ...mPorDia.get(d) }, PLATA_META, factor(monedaAds, d));
  const filaP = d => ({ ...ceros(CAMPOS_MP), ...pPorDia.get(d) });

  const conMp = Boolean(conexionMp);
  const fechas = Array.from({ length: dias }, (_, i) => sumarDias(desde, i));
  const fechasPrevias = Array.from({ length: dias }, (_, i) => sumarDias(previoDesde, i));
  const serie = fechas.map(d => ({ fecha: d, ...calcular(filaS(d), filaM(d), filaP(d), cfg, 1, conMp) }));
  const totalDe = fs => calcular(sumar(fs.map(filaS), CAMPOS_SHOPIFY), sumar(fs.map(filaM), CAMPOS_META), sumar(fs.map(filaP), CAMPOS_MP), cfg, fs.length, conMp);
  const actual = totalDe(fechas);
  const previo = totalDe(fechasPrevias);

  // Tablas del período (vienen sumadas): cotización promedio del período.
  const fTienda = promedio(fechas.map(d => factor(monedaTienda, d)));
  const fAds = promedio(fechas.map(d => factor(monedaAds, d)));

  const pct = Number(cfg.costoProductoPct) || 0;
  const avisos = [];
  const sinCosto = sumar(fechas.map(d => sPorDia.get(d) || {}), ['ventasSinCosto']).ventasSinCosto;
  if (sinCosto > 0 && !pct) avisos.push('sinCosto');
  if (sync?.primeraFecha && iso(sync.primeraFecha) > desde && sync.ultimaSync) avisos.push('historiaCorta');
  if (sinCotizacion.size) avisos.push('sinCotizacion');
  const metaExpira = horaArgentinaAUtc(conexionMeta?.tokenExpira);
  if (metaExpira && new Date(metaExpira).getTime() - Date.now() < 7 * 86400000) avisos.push('metaVence');

  const cotizacionHoy = monedaTienda && monedaTienda !== 'USD'
    ? (cotFija || tabla.valor(monedaTienda, hasta) || null)
    : null;

  return {
    rango: { desde, hasta, previoDesde, previoHasta, dias },
    moneda: 'USD',
    monedaTienda,
    monedaAds,
    cotizacion: {
      moneda: monedaTienda && monedaTienda !== 'USD' ? monedaTienda : null,
      valor: cotizacionHoy,
      fija: Boolean(cotFija),
      completando: Boolean(tabla.completando),
      sinCotizacion: [...sinCotizacion],
    },
    totales: { actual, previo },
    serie,
    productos: productos.map(p => {
      const costoLocal = Number(p.costo) + Number(p.ventasSinCosto) * pct / 100;
      const costoParcial = Number(p.ventasSinCosto) > 0 && !pct;
      // Sin ningún costo conocido el margen sería un 100% falso.
      const sinCostoProd = costoParcial && !Number(p.costo);
      const ventas = Number(p.ventas);
      return {
        titulo: p.titulo, unidades: p.unidades, ordenes: p.ordenes, ventas: ventas * fTienda, costo: costoLocal * fTienda,
        margen: sinCostoProd ? null : div(ventas - costoLocal, ventas), costoParcial,
      };
    }),
    campanias: campanias.map(c => ({
      id: c.campaniaId,
      nombre: c.campania || 'Sin nombre',
      gasto: Number(c.gasto) * fAds,
      impresiones: Number(c.impresiones),
      clics: c.clics,
      ctr: div(c.clics, Number(c.impresiones)),
      compras: c.compras,
      valorCompras: Number(c.valorCompras) * fAds,
      roas: div(Number(c.valorCompras), Number(c.gasto)),
      conversaciones: c.conversaciones,
      costoConversacion: div(Number(c.gasto) * fAds, c.conversaciones),
    })),
    canales: canales.map(c => ({ canal: c.canal, ordenes: c.ordenes, ventas: Number(c.ventas) * fTienda })),
    mediosMp: (() => {
      const porTipo = new Map();
      for (const m of mediosMp) {
        const f = promedio(fechas.map(d => factor(m.moneda, d)));
        const t = porTipo.get(m.tipoMedio) || { tipo: m.tipoMedio, pagos: 0, cobrado: 0, costo: 0 };
        t.pagos += Number(m.pagos) || 0;
        t.cobrado += Number(m.cobrado) * f;
        t.costo += Number(m.costo) * f;
        porTipo.set(m.tipoMedio, t);
      }
      return [...porTipo.values()].sort((a, b) => b.cobrado - a.cobrado).map(t => ({ ...t, pct: div(t.costo, t.cobrado) }));
    })(),
    config: {
      comisionPct: Number(cfg.comisionPct),
      comisionFija: Number(cfg.comisionFija),
      envioPorOrden: Number(cfg.envioPorOrden),
      costoProductoPct: cfg.costoProductoPct == null ? null : Number(cfg.costoProductoPct),
      costosFijosMes: Number(cfg.costosFijosMes),
      cotizacionUsd: cotFija,
    },
    avisos,
    oauth: { meta: metaAds.oauthDisponible(), mercadoPago: mercadoPago.oauthDisponible() },
    shopify: shopifyActiva ? {
      shopDomain: conexionShopify.shopDomain,
      nombreTienda: conexionShopify.nombreTienda || null,
      estado: conexionShopify.estado,
      ordenes: sync?.ordenes ?? 0,
      primeraFecha: sync?.primeraFecha ? iso(sync.primeraFecha) : null,
      ultimaSync: horaArgentinaAUtc(sync?.ultimaSync),
      ultimoError: sync?.ultimoError || null,
    } : null,
    meta: conexionMeta ? {
      adAccountId: conexionMeta.adAccountId,
      nombreCuenta: conexionMeta.nombreCuenta,
      moneda: conexionMeta.moneda,
      estado: conexionMeta.estado,
      ultimoError: conexionMeta.ultimoError,
      ultimaSync: horaArgentinaAUtc(conexionMeta.ultimaSync),
      tokenPropio: conexionMeta.tokenPropio,
      tokenExpira: metaExpira,
    } : null,
    mercadoPago: conexionMp ? {
      nickname: conexionMp.nickname,
      email: conexionMp.email,
      sitio: conexionMp.sitio,
      origen: conexionMp.origen,
      estado: conexionMp.estado,
      ultimoError: conexionMp.ultimoError,
      ultimaSync: horaArgentinaAUtc(conexionMp.ultimaSync),
      pagos: conexionMp.pagos ?? 0,
      primeraFecha: conexionMp.primeraFecha ? iso(conexionMp.primeraFecha) : null,
    } : null,
    sincronizando: {
      shopify: enCurso.has(`${clienteId}:shopify`),
      meta: enCurso.has(`${clienteId}:meta`),
      mercadoPago: enCurso.has(`${clienteId}:mp`),
    },
  };
}

module.exports = { datos, actualizar, guardarConfig, programarSync, sincronizarMeta, sincronizarMp, diasEntre };

