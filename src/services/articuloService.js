const { ejecutar, sql } = require('./db');

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

const ESTADOS_FILTRO = ['activos', 'inactivos', 'agotados', 'sinFoto'];

// Cada palabra tiene que aparecer en algún campo (no todas en el mismo ni en orden).
// Los comodines de LIKE se sacan: se busca el texto tal cual.
function palabrasDe(q) {
  return String(q || '').replace(/[%_[\]]/g, '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
}

async function listarArticulos(clienteId, { page = 1, q = '', estado = '' } = {}) {
  const palabras = palabrasDe(q);
  const r = await ejecutar('dbo.usp_Portal_ArticulosListar', {
    clienteId: [sql.Int, clienteId],
    palabras: [sql.NVarChar(sql.MAX), palabras.length ? JSON.stringify(palabras) : null],
    estado: [sql.VarChar(20), ESTADOS_FILTRO.includes(estado) ? estado : null],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const [resumenRows, filas] = r.recordsets;
  const resumen = resumenRows[0];
  const filtrados = filas[0]?.filtrados ?? 0;

  return {
    rows: filas.map(({ imagenes, opciones, filtrados: _f, ...a }) => ({
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
  const result = await ejecutar('dbo.usp_Portal_ArticuloDetalle', { id: [sql.Int, id], clienteId: [sql.Int, clienteId] });
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
  const r = await ejecutar('dbo.usp_Portal_ArticuloObtener', { id: [sql.Int, id], clienteId: [sql.Int, clienteId] });
  return r.recordset[0] ?? null;
}

function datosArticulo({ codigo, nombre, descripcion, precio, usaStock }) {
  return {
    codigo: [sql.NVarChar(50), codigo || null],
    nombre: [sql.NVarChar(200), nombre],
    descripcion: [sql.NVarChar(sql.MAX), descripcion || null],
    precio: [sql.Decimal(12, 2), precio ?? null],
    usaStock: [sql.Bit, usaStock ? 1 : 0],
  };
}

// Artículo y Stock inicial en la misma transacción (usp_Portal_ArticuloGuardar).
async function crearArticulo(clienteId, datos) {
  await ejecutar('dbo.usp_Portal_ArticuloGuardar', {
    clienteId: [sql.Int, clienteId],
    ...datosArticulo(datos),
    stock: [sql.Int, datos.cantidadInicial || 0],
  });
}

async function actualizarArticulo(id, clienteId, datos) {
  await ejecutar('dbo.usp_Portal_ArticuloGuardar', {
    clienteId: [sql.Int, clienteId],
    id: [sql.Int, id],
    ...datosArticulo(datos),
  });
}

async function actualizarStock(id, clienteId, cantidad) {
  await ejecutar('dbo.usp_Portal_ArticuloStockSet', {
    id: [sql.Int, id],
    clienteId: [sql.Int, clienteId],
    cantidad: [sql.Int, cantidad],
  });
}

function setActivo(id, clienteId, activo) {
  return ejecutar('dbo.usp_Portal_ArticuloActivoSet', {
    id: [sql.Int, id],
    clienteId: [sql.Int, clienteId],
    activo: [sql.Bit, activo],
  });
}

async function desactivarArticulo(id, clienteId) {
  await setActivo(id, clienteId, false);
}

async function activarArticulo(id, clienteId) {
  await setActivo(id, clienteId, true);
}

// Importación Excel: busca por código (o por nombre si no trae código), crea o
// edita, y deja el Stock en lo que diga el Excel. No toca "activo".
async function importarArticulo(clienteId, { nombre, codigo, descripcion, precio, usaStock, stock }) {
  await ejecutar('dbo.usp_Portal_ArticuloGuardar', {
    clienteId: [sql.Int, clienteId],
    ...datosArticulo({ nombre, codigo, descripcion, precio, usaStock }),
    stock: [sql.Int, stock],
    importar: [sql.Bit, 1],
  });
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
  importarArticulo,
};
