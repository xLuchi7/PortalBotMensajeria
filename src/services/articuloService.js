const { getPool, sql } = require('./db');

const PAGE_SIZE = 20;

function parsearJson(valor, porDefecto) {
  try {
    return valor ? JSON.parse(valor) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function parsearImagenes(valor) {
  const urls = parsearJson(valor, []);
  return Array.isArray(urls) ? urls : [];
}

const FILTROS_ESTADO = {
  activos: 'a.activo = 1',
  inactivos: 'a.activo = 0',
  agotados: 'a.activo = 1 AND a.usaStock = 1 AND ISNULL(s.cantidad, 0) <= 0',
  sinFoto: 'a.activo = 1 AND a.imagenes IS NULL',
};

// Cada palabra tiene que aparecer en algún campo (no todas en el mismo ni en orden).
function condicionBusqueda(request, q) {
  const palabras = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  return palabras.map((p, i) => {
    request.input(`q${i}`, sql.NVarChar, `%${p}%`);
    return `(a.nombre LIKE @q${i} OR a.codigo LIKE @q${i} OR a.codigoBarras LIKE @q${i} OR a.marca LIKE @q${i}
      OR a.tipoProducto LIKE @q${i} OR a.etiquetas LIKE @q${i} OR a.colecciones LIKE @q${i})`;
  });
}

async function listarArticulos(clienteId, { page = 1, q = '', estado = '' } = {}) {
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;

  const listado = pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('offset', sql.Int, offset)
    .input('pageSize', sql.Int, PAGE_SIZE);
  const condiciones = ['a.clienteId = @clienteId', ...condicionBusqueda(listado, q)];
  if (FILTROS_ESTADO[estado]) condiciones.push(FILTROS_ESTADO[estado]);

  const [resumenResult, rowsResult] = await Promise.all([
    pool.request().input('clienteId', sql.Int, clienteId).query(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN a.activo = 1 THEN 1 ELSE 0 END) AS activos,
        SUM(CASE WHEN a.activo = 1 AND a.usaStock = 1 AND ISNULL(s.cantidad, 0) <= 0 THEN 1 ELSE 0 END) AS agotados,
        SUM(CASE WHEN a.activo = 1 AND a.imagenes IS NOT NULL THEN 1 ELSE 0 END) AS conFoto
      FROM Articulos a
      LEFT JOIN Stock s ON s.articuloId = a.id
      WHERE a.clienteId = @clienteId
    `),
    listado.query(`
      SELECT a.id, a.codigo, a.nombre, a.precio, a.precioComparacion, a.activo, a.usaStock, a.origen,
             a.shopifyProductId, a.imagenes, a.marca, a.opciones, ISNULL(s.cantidad, 0) AS stock,
             COUNT(*) OVER () AS filtrados
      FROM Articulos a
      LEFT JOIN Stock s ON s.articuloId = a.id
      WHERE ${condiciones.join(' AND ')}
      ORDER BY a.activo DESC, a.nombre
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `),
  ]);

  const resumen = resumenResult.recordset[0];
  const filtrados = rowsResult.recordset[0]?.filtrados ?? 0;

  return {
    rows: rowsResult.recordset.map(({ imagenes, opciones, filtrados: _f, ...a }) => ({
      ...a,
      imagenes: parsearImagenes(imagenes),
      opciones: parsearJson(opciones, []),
    })),
    total: resumen.total,
    filtrados,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(filtrados / PAGE_SIZE)),
    activos: resumen.activos ?? 0,
    agotados: resumen.agotados ?? 0,
    conFoto: resumen.conFoto ?? 0,
  };
}

// Todo lo guardado del artículo, para el modal de info.
async function obtenerDetalle(id, clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('clienteId', sql.Int, clienteId)
    .query(`
      SELECT a.id, a.codigo, a.nombre, a.descripcion, a.precio, a.precioComparacion, a.costo, a.codigoBarras,
             a.marca, a.tipoProducto, a.categoria, a.etiquetas, a.colecciones, a.opciones, a.urlTienda,
             a.activo, a.usaStock, a.origen, a.fechaAlta, a.imagenes, a.shopifyProductId, a.shopifyVariantId,
             a.shopifyDatos, a.shopifyActualizado, ISNULL(s.cantidad, 0) AS stock, s.actualizado AS stockActualizado
      FROM Articulos a
      LEFT JOIN Stock s ON s.articuloId = a.id
      WHERE a.id = @id AND a.clienteId = @clienteId
    `);
  const a = result.recordset[0];
  if (!a) return null;
  return {
    ...a,
    imagenes: parsearImagenes(a.imagenes),
    opciones: parsearJson(a.opciones, []),
    shopifyDatos: parsearJson(a.shopifyDatos, null),
  };
}

async function obtenerArticulo(id, clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('clienteId', sql.Int, clienteId)
    .query('SELECT id, codigo, nombre, descripcion, precio, activo, usaStock, origen FROM Articulos WHERE id = @id AND clienteId = @clienteId');
  return result.recordset[0] ?? null;
}

async function crearArticulo(clienteId, { codigo, nombre, descripcion, precio, cantidadInicial, usaStock }) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input('clienteId', sql.Int, clienteId)
      .input('codigo', sql.NVarChar, codigo || null)
      .input('nombre', sql.NVarChar, nombre)
      .input('descripcion', sql.NVarChar, descripcion || null)
      .input('precio', sql.Decimal(12, 2), precio || null)
      .input('usaStock', sql.Bit, usaStock ? 1 : 0)
      .query(`
        INSERT INTO Articulos (clienteId, codigo, nombre, descripcion, precio, usaStock)
        OUTPUT INSERTED.id
        VALUES (@clienteId, @codigo, @nombre, @descripcion, @precio, @usaStock)
      `);

    const articuloId = result.recordset[0].id;

    await new sql.Request(transaction)
      .input('articuloId', sql.Int, articuloId)
      .input('cantidad', sql.Int, cantidadInicial || 0)
      .query('INSERT INTO Stock (articuloId, cantidad) VALUES (@articuloId, @cantidad)');

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

async function actualizarArticulo(id, clienteId, { codigo, nombre, descripcion, precio, usaStock }) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('clienteId', sql.Int, clienteId)
    .input('codigo', sql.NVarChar, codigo || null)
    .input('nombre', sql.NVarChar, nombre)
    .input('descripcion', sql.NVarChar, descripcion || null)
    .input('precio', sql.Decimal(12, 2), precio || null)
    .input('usaStock', sql.Bit, usaStock ? 1 : 0)
    .query(`
      UPDATE Articulos
      SET codigo = @codigo, nombre = @nombre, descripcion = @descripcion, precio = @precio, usaStock = @usaStock
      WHERE id = @id AND clienteId = @clienteId
    `);
}

async function actualizarStock(id, clienteId, cantidad) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('clienteId', sql.Int, clienteId)
    .input('cantidad', sql.Int, cantidad)
    .query(`
      UPDATE s
      SET s.cantidad = @cantidad, s.actualizado = SYSUTCDATETIME()
      FROM Stock s
      JOIN Articulos a ON a.id = s.articuloId
      WHERE s.articuloId = @id AND a.clienteId = @clienteId
    `);
}

async function desactivarArticulo(id, clienteId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('clienteId', sql.Int, clienteId)
    .query('UPDATE Articulos SET activo = 0 WHERE id = @id AND clienteId = @clienteId');
}

async function activarArticulo(id, clienteId) {
  const pool = await getPool();
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('clienteId', sql.Int, clienteId)
    .query('UPDATE Articulos SET activo = 1 WHERE id = @id AND clienteId = @clienteId');
}

module.exports = {
  listarArticulos,
  obtenerDetalle,
  obtenerArticulo,
  crearArticulo,
  actualizarArticulo,
  actualizarStock,
  desactivarArticulo,
  activarArticulo,
};
