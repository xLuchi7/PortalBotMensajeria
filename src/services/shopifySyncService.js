const crypto = require('crypto');
const { getPool, sql } = require('./db');
const shopify = require('./shopifyClient');
const apps = require('./shopifyAppService');
const oauth = require('./shopifyOAuthService');

// Shopify es la fuente de verdad del catálogo para los Clientes conectados:
// cada VARIANTE de Shopify es un Artículo del portal (que es lo que el bot
// busca y vende). Precio, nombre, stock y activo se pisan con lo de Shopify.

const JOB_TTL_MS = 30 * 60 * 1000;
const SYNC_CADA_MS = 24 * 60 * 60 * 1000;
const CHEQUEO_PERIODICO_MS = 60 * 60 * 1000;

// ── Queries ─────────────────────────────────────────────────────────────────
// Se guarda TODO lo que Shopify sabe del producto y la variante: lo que se busca
// o se muestra en la tabla va a columnas propias, y el JSON completo queda en
// Articulos.shopifyDatos (lo usa el modal de info del Portal).
//
// Shopify rechaza queries de costo > 1000, así que va en dos pasos: variantes de
// a VARIANTES_POR_PAGINA (sus campos) y los productos de esa página aparte, de a
// PRODUCTOS_POR_QUERY con nodes(ids:).

const VARIANTES_POR_PAGINA = 30;
const PRODUCTOS_POR_QUERY = 12;
const MAX_IMAGENES = 10;

// Fotos ya en JPG y achicadas: WhatsApp no acepta WebP en mensajes de imagen y
// tiene tope de 5 MB.
const IMAGEN = `... on MediaImage {
  id alt
  image { url(transform: { maxWidth: 1200, maxHeight: 1200, preferredContentType: JPG }) altText width height }
}`;
const METACAMPOS = 'nodes { namespace key type value }';

// unitCost (costo por artículo) puede no estar permitido para la app: si
// Shopify lo rechaza, se sigue sin ese campo (ver conReintentoSinCosto).
const camposVariante = (conCosto) => `
  id title sku barcode price compareAtPrice taxable inventoryPolicy inventoryQuantity
  availableForSale position createdAt updatedAt
  selectedOptions { name value }
  inventoryItem {
    id tracked requiresShipping countryCodeOfOrigin provinceCodeOfOrigin harmonizedSystemCode
    ${conCosto ? 'unitCost { amount currencyCode }' : ''}
    measurement { weight { value unit } }
  }
  media(first: 3) { nodes { ${IMAGEN} } }
  metafields(first: 5) { ${METACAMPOS} }
  product { id }
`;

const CAMPOS_PRODUCTO = `
  id title handle status description descriptionHtml vendor productType tags
  createdAt updatedAt publishedAt onlineStoreUrl totalInventory tracksInventory isGiftCard templateSuffix
  seo { title description }
  category { id name fullName }
  options { name values }
  priceRangeV2 { minVariantPrice { amount currencyCode } maxVariantPrice { amount currencyCode } }
  collections(first: 10) { nodes { id title handle } }
  metafields(first: 25) { ${METACAMPOS} }
  media(first: ${MAX_IMAGENES}) { nodes { ${IMAGEN} } }
`;

const paginaVariantes = (conCosto) => `
  variants(first: ${VARIANTES_POR_PAGINA}, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { ${camposVariante(conCosto)} }
  }`;

// Todas las variantes de la tienda, o las de un producto. Para un producto se
// pagina product.variants y no productVariants(query: "product_id:…"): el
// buscador de Shopify tarda en indexar y desactivaríamos variantes recién creadas.
const queryVariantes = (conCosto, deProducto) => (deProducto ? `
  query variantes($cursor: String, $id: ID!) {
    product(id: $id) { ${paginaVariantes(conCosto)} }
  }` : `
  query variantes($cursor: String) {
    productVariants(first: ${VARIANTES_POR_PAGINA}, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ${camposVariante(conCosto)} }
    }
  }`);

const QUERY_PRODUCTOS = `
  query productos($ids: [ID!]!) {
    nodes(ids: $ids) { ... on Product { ${CAMPOS_PRODUCTO} } }
  }`;

const clientesSinCosto = new Set();

async function conReintentoSinCosto(clienteId, fn) {
  if (clientesSinCosto.has(clienteId)) return fn(false);
  try {
    return await fn(true);
  } catch (err) {
    const esPorCosto = (err.detalles || []).some(e => (e.path || []).includes('unitCost')) || /unitCost/.test(err.message);
    if (!(err instanceof shopify.ShopifyApiError) || !esPorCosto) throw err;
    console.warn(`[shopify] Sin permiso para ver costos (cliente ${clienteId}), se sigue sin el costo:`, err.message);
    clientesSinCosto.add(clienteId);
    return fn(false);
  }
}

async function* paginasDeVariantes(clienteId, productGid = null) {
  let cursor = null;
  do {
    const data = await conReintentoSinCosto(clienteId, conCosto =>
      shopify.graphql(clienteId, queryVariantes(conCosto, Boolean(productGid)), productGid ? { cursor, id: productGid } : { cursor }));
    const pagina = productGid ? data.product?.variants : data.productVariants;
    if (!pagina) return;
    yield pagina.nodes;
    cursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
  } while (cursor);
}

async function traerProductos(clienteId, ids) {
  const porId = new Map();
  for (let i = 0; i < ids.length; i += PRODUCTOS_POR_QUERY) {
    const data = await shopify.graphql(clienteId, QUERY_PRODUCTOS, { ids: ids.slice(i, i + PRODUCTOS_POR_QUERY) });
    for (const p of data.nodes || []) if (p?.id) porId.set(p.id, p);
  }
  return porId;
}

// ── Mapeo variante → Artículo ───────────────────────────────────────────────

const imagenesDeMedia = (media) => (media?.nodes || [])
  .filter(n => n.image?.url)
  .map(n => ({ url: n.image.url, alt: n.alt || n.image.altText || null, ancho: n.image.width, alto: n.image.height }));

const numeroONull = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const textoONull = (v, max) => (v ? String(v).slice(0, max) : null);
const metacampos = (m) => (m?.nodes || []).map(x => ({ ...x, value: String(x.value ?? '').slice(0, 2000) }));

function aArticulo(producto, variante) {
  const tituloVariante = variante.title && variante.title !== 'Default Title' ? variante.title : null;
  const nombre = (tituloVariante ? `${producto.title} - ${tituloVariante}` : producto.title).slice(0, 200);
  const item = variante.inventoryItem || {};
  const tracked = Boolean(item.tracked);

  // La foto propia de la variante (ej. el color) va primero; después las del producto.
  const vistas = new Set();
  const imagenes = [...imagenesDeMedia(variante.media), ...imagenesDeMedia(producto.media)]
    .filter(i => !vistas.has(i.url) && vistas.add(i.url))
    .slice(0, MAX_IMAGENES);

  const opciones = (variante.selectedOptions || []).filter(o => !(o.name === 'Title' && o.value === 'Default Title'));
  const colecciones = (producto.collections?.nodes || []).map(c => c.title);
  const actualizado = [producto.updatedAt, variante.updatedAt].filter(Boolean).sort().pop();

  // El JSON completo, sin las fotos (ya van en `imagenes`).
  const { media: _m, ...productoSinFotos } = producto;
  const { media: _vm, product: _p, ...varianteSinFotos } = variante;
  const datos = {
    producto: { ...productoSinFotos, metafields: metacampos(producto.metafields), collections: producto.collections?.nodes || [] },
    variante: { ...varianteSinFotos, metafields: metacampos(variante.metafields) },
  };

  return {
    shopifyProductId: producto.id,
    shopifyVariantId: variante.id,
    shopifyInventoryItemId: item.id ?? null,
    nombre,
    codigo: textoONull(variante.sku, 50),
    descripcion: producto.description || null,
    precio: numeroONull(variante.price),
    activo: producto.status === 'ACTIVE',
    usaStock: tracked,
    stock: tracked ? Math.max(0, Number(variante.inventoryQuantity) || 0) : 0,
    imagenes: imagenes.length ? JSON.stringify(imagenes.map(i => i.url)) : null,
    precioComparacion: numeroONull(variante.compareAtPrice),
    costo: numeroONull(item.unitCost?.amount),
    codigoBarras: textoONull(variante.barcode, 100),
    marca: textoONull(producto.vendor, 255),
    tipoProducto: textoONull(producto.productType, 255),
    categoria: textoONull(producto.category?.fullName, 500),
    etiquetas: producto.tags?.length ? producto.tags.join(', ') : null,
    colecciones: colecciones.length ? colecciones.join(', ') : null,
    opciones: opciones.length ? JSON.stringify(opciones.map(o => ({ nombre: o.name, valor: o.value }))) : null,
    urlTienda: textoONull(producto.onlineStoreUrl, 500),
    shopifyDatos: JSON.stringify({ ...datos, imagenes }),
    shopifyActualizado: actualizado ? new Date(actualizado) : null,
  };
}

// Primero por variante ya vinculada; si no, se "adopta" un Artículo manual con
// el mismo código (SKU) o el mismo nombre, para no duplicar lo que el Cliente
// ya había cargado a mano antes de conectar Shopify.
async function buscarArticulo(pool, clienteId, a) {
  const porVariante = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('variantId', sql.NVarChar, a.shopifyVariantId)
    .query('SELECT id FROM Articulos WHERE clienteId = @clienteId AND shopifyVariantId = @variantId');
  if (porVariante.recordset[0]) return porVariante.recordset[0].id;

  if (a.codigo) {
    const porCodigo = await pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('codigo', sql.NVarChar, a.codigo)
      .query('SELECT TOP 1 id FROM Articulos WHERE clienteId = @clienteId AND codigo = @codigo AND shopifyVariantId IS NULL ORDER BY activo DESC, id');
    if (porCodigo.recordset[0]) return porCodigo.recordset[0].id;
  }

  const porNombre = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('nombre', sql.NVarChar, a.nombre)
    .query('SELECT TOP 1 id FROM Articulos WHERE clienteId = @clienteId AND nombre = @nombre AND shopifyVariantId IS NULL ORDER BY activo DESC, id');
  return porNombre.recordset[0]?.id ?? null;
}

async function upsertArticulo(pool, clienteId, a) {
  const existenteId = await buscarArticulo(pool, clienteId, a);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const req = () => new sql.Request(transaction)
      .input('clienteId', sql.Int, clienteId)
      .input('codigo', sql.NVarChar(50), a.codigo)
      .input('nombre', sql.NVarChar(200), a.nombre)
      .input('descripcion', sql.NVarChar(sql.MAX), a.descripcion)
      .input('precio', sql.Decimal(12, 2), a.precio)
      .input('activo', sql.Bit, a.activo ? 1 : 0)
      .input('usaStock', sql.Bit, a.usaStock ? 1 : 0)
      .input('productId', sql.NVarChar, a.shopifyProductId)
      .input('variantId', sql.NVarChar, a.shopifyVariantId)
      .input('inventoryItemId', sql.NVarChar, a.shopifyInventoryItemId)
      .input('imagenes', sql.NVarChar(sql.MAX), a.imagenes)
      .input('precioComparacion', sql.Decimal(12, 2), a.precioComparacion)
      .input('costo', sql.Decimal(12, 2), a.costo)
      .input('codigoBarras', sql.NVarChar(100), a.codigoBarras)
      .input('marca', sql.NVarChar(255), a.marca)
      .input('tipoProducto', sql.NVarChar(255), a.tipoProducto)
      .input('categoria', sql.NVarChar(500), a.categoria)
      .input('etiquetas', sql.NVarChar(sql.MAX), a.etiquetas)
      .input('colecciones', sql.NVarChar(sql.MAX), a.colecciones)
      .input('opciones', sql.NVarChar(sql.MAX), a.opciones)
      .input('urlTienda', sql.NVarChar(500), a.urlTienda)
      .input('shopifyDatos', sql.NVarChar(sql.MAX), a.shopifyDatos)
      .input('shopifyActualizado', sql.DateTime2, a.shopifyActualizado);

    let articuloId = existenteId;
    if (existenteId) {
      await req().input('id', sql.Int, existenteId).query(`
        UPDATE Articulos SET
          codigo = @codigo, nombre = @nombre, descripcion = @descripcion, precio = @precio,
          activo = @activo, usaStock = @usaStock, origen = 'shopify', imagenes = @imagenes,
          precioComparacion = @precioComparacion, costo = @costo, codigoBarras = @codigoBarras,
          marca = @marca, tipoProducto = @tipoProducto, categoria = @categoria, etiquetas = @etiquetas,
          colecciones = @colecciones, opciones = @opciones, urlTienda = @urlTienda,
          shopifyDatos = @shopifyDatos, shopifyActualizado = @shopifyActualizado,
          shopifyProductId = @productId, shopifyVariantId = @variantId, shopifyInventoryItemId = @inventoryItemId
        WHERE id = @id AND clienteId = @clienteId
      `);
    } else {
      const r = await req().query(`
        INSERT INTO Articulos
          (clienteId, codigo, nombre, descripcion, precio, activo, usaStock, origen, shopifyProductId, shopifyVariantId, shopifyInventoryItemId, imagenes,
           precioComparacion, costo, codigoBarras, marca, tipoProducto, categoria, etiquetas, colecciones, opciones, urlTienda,
           shopifyDatos, shopifyActualizado)
        OUTPUT INSERTED.id
        VALUES (@clienteId, @codigo, @nombre, @descripcion, @precio, @activo, @usaStock, 'shopify', @productId, @variantId, @inventoryItemId, @imagenes,
                @precioComparacion, @costo, @codigoBarras, @marca, @tipoProducto, @categoria, @etiquetas, @colecciones, @opciones, @urlTienda,
                @shopifyDatos, @shopifyActualizado)
      `);
      articuloId = r.recordset[0].id;
    }

    await new sql.Request(transaction)
      .input('articuloId', sql.Int, articuloId)
      .input('cantidad', sql.Int, a.stock)
      .query(`
        IF EXISTS (SELECT 1 FROM Stock WHERE articuloId = @articuloId)
          UPDATE Stock SET cantidad = @cantidad, actualizado = SYSUTCDATETIME() WHERE articuloId = @articuloId
        ELSE
          INSERT INTO Stock (articuloId, cantidad) VALUES (@articuloId, @cantidad)
      `);

    await transaction.commit();
    return { creado: !existenteId };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// Variantes que ya no existen en Shopify (borradas) → se desactivan, no se
// borran: puede haber Pedidos viejos apuntando a ese Artículo.
async function desactivarFaltantes(pool, clienteId, variantIdsVistos, { productId = null } = {}) {
  const vistos = JSON.stringify([...variantIdsVistos]);
  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('vistos', sql.NVarChar(sql.MAX), vistos)
    .input('productId', sql.NVarChar, productId)
    .query(`
      UPDATE Articulos SET activo = 0
      WHERE clienteId = @clienteId AND origen = 'shopify' AND activo = 1
        AND (@productId IS NULL OR shopifyProductId = @productId)
        AND shopifyVariantId NOT IN (SELECT value FROM OPENJSON(@vistos))
    `);
  return r.rowsAffected[0] || 0;
}

// ── Sync completo ───────────────────────────────────────────────────────────

// Las tiendas conectadas antes de sumar un webhook nuevo (ej. orders/updated)
// no lo tienen: en cada sincronización se registran los que falten. Shopify
// ignora los que ya existen.
async function asegurarWebhooks(clienteId) {
  try {
    const conexion = await shopify.obtenerConexion(clienteId);
    const app = await apps.obtenerApp(conexion?.appId);
    if (app && oauth.baseUrl(app)) await oauth.registrarWebhooks(clienteId, app);
  } catch (err) {
    console.warn(`[shopify] No se pudieron revisar los webhooks (cliente ${clienteId}):`, err.message);
  }
}

async function sincronizarTodo(clienteId, progreso = {}) {
  const pool = await getPool();
  await asegurarWebhooks(clienteId);

  try {
    const c = await shopify.graphql(clienteId, '{ productVariantsCount { count } }');
    progreso.total = c.productVariantsCount?.count ?? 0;
  } catch {
    progreso.total = 0; // solo es para la barra de progreso
  }

  const vistos = new Set();
  const productos = new Map(); // un producto puede tener variantes en varias páginas
  for await (const variantes of paginasDeVariantes(clienteId)) {
    const faltan = [...new Set(variantes.map(v => v.product.id))].filter(id => !productos.has(id));
    for (const [id, p] of await traerProductos(clienteId, faltan)) productos.set(id, p);

    for (const v of variantes) {
      vistos.add(v.id);
      const producto = productos.get(v.product.id);
      try {
        if (!producto) throw new Error('Shopify no devolvió el producto');
        const { creado } = await upsertArticulo(pool, clienteId, aArticulo(producto, v));
        if (creado) progreso.creados = (progreso.creados || 0) + 1;
        else progreso.actualizados = (progreso.actualizados || 0) + 1;
      } catch (err) {
        progreso.errores = progreso.errores || [];
        progreso.errores.push(`${producto?.title || v.title}: ${err.message}`);
      }
      progreso.procesado = (progreso.procesado || 0) + 1;
    }
  }

  progreso.desactivados = await desactivarFaltantes(pool, clienteId, vistos);
  await shopify.marcarSync(clienteId);
  return progreso;
}

// ── Cambios puntuales (webhooks) ────────────────────────────────────────────

async function sincronizarProducto(clienteId, productId) {
  const gid = shopify.gid('Product', productId);
  const producto = (await traerProductos(clienteId, [gid])).get(gid);
  if (!producto) return desactivarProducto(clienteId, productId);

  const pool = await getPool();
  const vistos = new Set();
  for await (const variantes of paginasDeVariantes(clienteId, gid)) {
    for (const v of variantes) {
      vistos.add(v.id);
      await upsertArticulo(pool, clienteId, aArticulo(producto, v));
    }
  }
  await desactivarFaltantes(pool, clienteId, vistos, { productId: producto.id });
}

async function desactivarProducto(clienteId, productId) {
  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('productId', sql.NVarChar, shopify.gid('Product', productId))
    .query("UPDATE Articulos SET activo = 0 WHERE clienteId = @clienteId AND origen = 'shopify' AND shopifyProductId = @productId");
}

// inventory_levels/update avisa por sucursal; leemos el total disponible de la
// variante (suma de todas las sucursales), que es lo que el bot puede vender.
async function actualizarStockDeInventoryItem(clienteId, inventoryItemId) {
  const data = await shopify.graphql(clienteId, `
    query item($id: ID!) {
      inventoryItem(id: $id) { id tracked variant { id inventoryQuantity } }
    }`, { id: shopify.gid('InventoryItem', inventoryItemId) });

  const item = data.inventoryItem;
  if (!item?.variant) return;

  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('variantId', sql.NVarChar, item.variant.id)
    .input('cantidad', sql.Int, item.tracked ? Math.max(0, Number(item.variant.inventoryQuantity) || 0) : 0)
    .input('usaStock', sql.Bit, item.tracked ? 1 : 0)
    .query(`
      UPDATE a SET a.usaStock = @usaStock
      FROM Articulos a WHERE a.clienteId = @clienteId AND a.shopifyVariantId = @variantId;

      UPDATE s SET s.cantidad = @cantidad, s.actualizado = SYSUTCDATETIME()
      FROM Stock s JOIN Articulos a ON a.id = s.articuloId
      WHERE a.clienteId = @clienteId AND a.shopifyVariantId = @variantId;
    `);
}

// ── Jobs en background (mismo patrón que importService) ─────────────────────

const jobs = new Map();
const jobPorCliente = new Map();

function crearJobSync(clienteId) {
  const enCurso = jobPorCliente.get(clienteId);
  if (enCurso && jobs.has(enCurso) && !jobs.get(enCurso).terminado) return enCurso;

  const jobId = crypto.randomUUID();
  const job = { clienteId, total: 0, procesado: 0, creados: 0, actualizados: 0, desactivados: 0, errores: [], terminado: false };
  jobs.set(jobId, job);
  jobPorCliente.set(clienteId, jobId);

  sincronizarTodo(clienteId, job)
    .catch(err => {
      job.errorFatal = err.message;
      console.error(`[shopify] Sync falló (cliente ${clienteId}):`, err.message);
    })
    .finally(() => { job.terminado = true; });

  setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
  return jobId;
}

function obtenerEstadoSync(jobId, clienteId) {
  const job = jobs.get(jobId);
  if (!job || job.clienteId !== clienteId) return null;
  return {
    total: job.total,
    procesado: job.procesado,
    creados: job.creados,
    actualizados: job.actualizados,
    desactivados: job.desactivados,
    erroresCount: job.errores.length,
    errores: job.errores.slice(0, 20),
    terminado: job.terminado,
    errorFatal: job.errorFatal ?? null,
  };
}

// Red de seguridad por si se pierde algún webhook: cada hora revisa qué tiendas
// no se sincronizan hace más de 24hs. De paso mantiene vivo el refresh token.
function iniciarSyncPeriodica() {
  const chequear = async () => {
    try {
      const conexiones = await shopify.listarConexionesActivas();
      for (const c of conexiones) {
        const ultima = c.ultimaSync ? new Date(c.ultimaSync).getTime() : 0;
        if (Date.now() - ultima > SYNC_CADA_MS) crearJobSync(c.clienteId);
      }
    } catch (err) {
      console.error('[shopify] Chequeo periódico falló:', err.message);
    }
  };
  setTimeout(chequear, 60 * 1000);
  setInterval(chequear, CHEQUEO_PERIODICO_MS).unref();
}

// Números para la tarjeta de Integraciones.
async function resumen(clienteId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query(`
      SELECT
        (SELECT COUNT(*) FROM Articulos WHERE clienteId = @clienteId AND origen = 'shopify' AND activo = 1) AS articulosShopify,
        (SELECT COUNT(*) FROM Articulos WHERE clienteId = @clienteId AND origen = 'manual' AND activo = 1) AS articulosManuales,
        (SELECT COUNT(*) FROM Pedidos WHERE clienteId = @clienteId AND shopifyOrderId IS NOT NULL) AS pedidosEnviados,
        (SELECT COUNT(*) FROM Pedidos WHERE clienteId = @clienteId AND shopifyEstado = 'error') AS pedidosConError
    `);
  return r.recordset[0];
}

module.exports = {
  resumen,
  sincronizarTodo,
  sincronizarProducto,
  desactivarProducto,
  actualizarStockDeInventoryItem,
  crearJobSync,
  obtenerEstadoSync,
  iniciarSyncPeriodica,
};
