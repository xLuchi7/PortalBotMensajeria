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

const CAMPOS_VARIANTE = `
  id title sku price inventoryQuantity
  inventoryItem { id tracked }
`;
const CAMPOS_PRODUCTO = 'id title status description(truncateAt: 1000)';

// ── Mapeo variante → Artículo ───────────────────────────────────────────────

function aArticulo(producto, variante) {
  const tituloVariante = variante.title && variante.title !== 'Default Title' ? variante.title : null;
  const nombre = (tituloVariante ? `${producto.title} - ${tituloVariante}` : producto.title).slice(0, 200);
  const tracked = Boolean(variante.inventoryItem?.tracked);
  return {
    shopifyProductId: producto.id,
    shopifyVariantId: variante.id,
    shopifyInventoryItemId: variante.inventoryItem?.id ?? null,
    nombre,
    codigo: variante.sku ? variante.sku.slice(0, 50) : null,
    descripcion: producto.description || null,
    precio: variante.price != null ? Number(variante.price) : null,
    activo: producto.status === 'ACTIVE',
    usaStock: tracked,
    stock: tracked ? Math.max(0, Number(variante.inventoryQuantity) || 0) : 0,
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
      .input('inventoryItemId', sql.NVarChar, a.shopifyInventoryItemId);

    let articuloId = existenteId;
    if (existenteId) {
      await req().input('id', sql.Int, existenteId).query(`
        UPDATE Articulos SET
          codigo = @codigo, nombre = @nombre, descripcion = @descripcion, precio = @precio,
          activo = @activo, usaStock = @usaStock, origen = 'shopify',
          shopifyProductId = @productId, shopifyVariantId = @variantId, shopifyInventoryItemId = @inventoryItemId
        WHERE id = @id AND clienteId = @clienteId
      `);
    } else {
      const r = await req().query(`
        INSERT INTO Articulos
          (clienteId, codigo, nombre, descripcion, precio, activo, usaStock, origen, shopifyProductId, shopifyVariantId, shopifyInventoryItemId)
        OUTPUT INSERTED.id
        VALUES (@clienteId, @codigo, @nombre, @descripcion, @precio, @activo, @usaStock, 'shopify', @productId, @variantId, @inventoryItemId)
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

const QUERY_VARIANTES = `
  query variantes($cursor: String) {
    productVariants(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { ${CAMPOS_VARIANTE} product { ${CAMPOS_PRODUCTO} } }
    }
  }`;

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
  let cursor = null;
  do {
    const data = await shopify.graphql(clienteId, QUERY_VARIANTES, { cursor });
    const pagina = data.productVariants;
    for (const v of pagina.nodes) {
      vistos.add(v.id);
      try {
        const { creado } = await upsertArticulo(pool, clienteId, aArticulo(v.product, v));
        if (creado) progreso.creados = (progreso.creados || 0) + 1;
        else progreso.actualizados = (progreso.actualizados || 0) + 1;
      } catch (err) {
        progreso.errores = progreso.errores || [];
        progreso.errores.push(`${v.product.title}: ${err.message}`);
      }
      progreso.procesado = (progreso.procesado || 0) + 1;
    }
    cursor = pagina.pageInfo.hasNextPage ? pagina.pageInfo.endCursor : null;
  } while (cursor);

  progreso.desactivados = await desactivarFaltantes(pool, clienteId, vistos);
  await shopify.marcarSync(clienteId);
  return progreso;
}

// ── Cambios puntuales (webhooks) ────────────────────────────────────────────

async function sincronizarProducto(clienteId, productId) {
  const data = await shopify.graphql(clienteId, `
    query producto($id: ID!) {
      product(id: $id) {
        ${CAMPOS_PRODUCTO}
        variants(first: 250) { nodes { ${CAMPOS_VARIANTE} } }
      }
    }`, { id: shopify.gid('Product', productId) });

  const pool = await getPool();
  if (!data.product) return desactivarProducto(clienteId, productId);

  const vistos = new Set();
  for (const v of data.product.variants.nodes) {
    vistos.add(v.id);
    await upsertArticulo(pool, clienteId, aArticulo(data.product, v));
  }
  await desactivarFaltantes(pool, clienteId, vistos, { productId: data.product.id });
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
