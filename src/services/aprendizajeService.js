const { ejecutar, sql } = require('./db');

// Pares pregunta → respuesta que el bot suma a su system prompt (usp_Bot_AprendizajesActivos).
// El tope existe para que el prompt no crezca sin límite.
const TOPE_ACTIVOS = 50;
const MAX_PREGUNTA = 300;
const MAX_RESPUESTA = 1000;

async function listar(clienteId) {
  const result = await ejecutar('dbo.usp_Portal_AprendizajesListar', { clienteId: [sql.Int, clienteId] });
  return result.recordset;
}

/** @returns {Promise<'ok'|'tope'|'no_existe'>} */
async function guardar(clienteId, { id = null, pregunta, respuesta, origenUserId = null }, usuario) {
  const result = await ejecutar('dbo.usp_Portal_AprendizajeGuardar', {
    clienteId: [sql.Int, clienteId],
    id: [sql.Int, id],
    pregunta: [sql.NVarChar(MAX_PREGUNTA), pregunta],
    respuesta: [sql.NVarChar(MAX_RESPUESTA), respuesta],
    origenUserId: [sql.NVarChar(100), origenUserId],
    usuario: [sql.NVarChar(255), usuario],
    tope: [sql.Int, TOPE_ACTIVOS],
  });
  return result.recordset[0]?.resultado ?? 'no_existe';
}

/** @returns {Promise<'ok'|'tope'|'no_existe'>} */
async function setActivo(clienteId, id, activo, usuario) {
  const result = await ejecutar('dbo.usp_Portal_AprendizajeActivoSet', {
    clienteId: [sql.Int, clienteId],
    id: [sql.Int, id],
    activo: [sql.Bit, activo],
    usuario: [sql.NVarChar(255), usuario],
    tope: [sql.Int, TOPE_ACTIVOS],
  });
  return result.recordset[0]?.resultado ?? 'no_existe';
}

async function borrar(clienteId, id) {
  const result = await ejecutar('dbo.usp_Portal_AprendizajeBorrar', {
    clienteId: [sql.Int, clienteId],
    id: [sql.Int, id],
  });
  return (result.recordset[0]?.borrados ?? 0) > 0;
}

module.exports = { listar, guardar, setActivo, borrar, TOPE_ACTIVOS, MAX_PREGUNTA, MAX_RESPUESTA };
