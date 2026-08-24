const { getPool, sql } = require('./db');

const PAGE_SIZE = 20;

async function listarArticulos(clienteId, page = 1) {
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;

  const [countResult, activosResult, rowsResult] = await Promise.all([
    pool.request().input('clienteId', sql.Int, clienteId).query('SELECT COUNT(*) AS total FROM Articulos WHERE clienteId = @clienteId'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT COUNT(*) AS activos FROM Articulos WHERE clienteId = @clienteId AND activo = 1'),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, PAGE_SIZE)
      .query(`
        SELECT a.id, a.codigo, a.nombre, a.descripcion, a.precio, a.activo, a.usaStock, ISNULL(s.cantidad, 0) AS stock
        FROM Articulos a
        LEFT JOIN Stock s ON s.articuloId = a.id
        WHERE a.clienteId = @clienteId
        ORDER BY a.activo DESC, a.nombre
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `),
  ]);

  const total = countResult.recordset[0].total;

  return {
    rows: rowsResult.recordset,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    activos: activosResult.recordset[0].activos,
  };
}

async function obtenerArticulo(id, clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('id', sql.Int, id)
    .input('clienteId', sql.Int, clienteId)
    .query('SELECT id, codigo, nombre, descripcion, precio, activo, usaStock FROM Articulos WHERE id = @id AND clienteId = @clienteId');
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
  obtenerArticulo,
  crearArticulo,
  actualizarArticulo,
  actualizarStock,
  desactivarArticulo,
  activarArticulo,
};
