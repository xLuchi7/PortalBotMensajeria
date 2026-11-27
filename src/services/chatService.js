const { ejecutar, sql } = require('./db');
const { numero: formatearNumero } = require('../viewHelpers');

const PAGE_SIZE = 25;
const MAX_MENSAJES_CHAT = 300;
const VENTANA_MINUTOS = 24 * 60;

// Estado de cada chat, calculado a partir de lo que ya registra el bot (de mayor a
// menor prioridad): un reclamo sin resolver tapa todo lo demás, después si llegó a
// hacer un Pedido, después si buscó Artículos que tenemos (intención de compra), y
// si no, es solo una consulta.
const ESTADOS = {
  // El bot se pausó solo porque pidieron una persona o insultaron (Bot_Mensajeria, revisionService).
  revision: { label: 'Humano Solicitado', clase: 'badge-revision' },
  reclamo: { label: 'Reclamo Abierto', clase: 'badge-danger' },
  pedido: { label: 'Pedido Realizado', clase: 'badge-success' },
  intencion: { label: 'Intención De Compra', clase: 'badge-info' },
  consulta: { label: 'Solo Consulta', clase: 'badge-neutral' },
};

// Estados que una persona puede elegir a mano (Chats.estadoManual). "Humano
// Solicitado" no: depende de Chats.revisionHumana y siempre tapa al resto.
const ESTADOS_MANUALES = ['reclamo', 'pedido', 'intencion', 'consulta'];

// La bandeja (una fila por número con su último mensaje y su estado) se arma en
// usp_Portal_ChatsListar; el estado de un solo chat, en usp_Portal_ChatObtener.
// estadoAuto = el calculado; estado = el que se muestra (Humano Solicitado >
// elegido a mano > calculado). Sin fila en Chats = bot activo.

function fechaCorta(local, hoy) {
  // local/hoy vienen como datetime2/date ya pasados a la zona del Cliente, y mssql
  // los arma como Date en UTC: se leen con getUTC* para no correrlos de nuevo.
  const pad = n => String(n).padStart(2, '0');
  const hora = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  const dias = Math.round(
    (Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) -
      Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate())) / 86400000
  );
  if (dias <= 0) return hora;
  if (dias === 1) return 'Ayer';
  if (dias < 7) return ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'][local.getUTCDay()];
  return `${pad(local.getUTCDate())}/${pad(local.getUTCMonth() + 1)}/${String(local.getUTCFullYear()).slice(2)}`;
}

function filtrosDe({ q, estado, bot }) {
  return {
    // Se busca por nombre (el propio o el de WhatsApp) o por número; para el número
    // se ignoran espacios, guiones y el +, así se puede pegar tal cual se ve.
    q: q ? `%${String(q).replace(/[%_[\]]/g, '')}%` : null,
    qDigitos: q && /\d/.test(q) ? `%${String(q).replace(/\D/g, '')}%` : null,
    estado: ESTADOS[estado] ? estado : null,
    bot: bot === 'pausado' ? 0 : bot === 'activo' ? 1 : null,
  };
}

async function listarChats(clienteId, { page = 1, q, estado, bot } = {}) {
  const f = filtrosDe({ q, estado, bot });
  const resultado = await ejecutar('dbo.usp_Portal_ChatsListar', {
    clienteId: [sql.Int, clienteId],
    q: [sql.NVarChar(60), f.q],
    qDigitos: [sql.NVarChar(60), f.qDigitos],
    estado: [sql.NVarChar(20), f.estado],
    bot: [sql.Bit, f.bot],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const rowsResult = { recordset: resultado.recordsets[0] };
  const resumenResult = { recordset: resultado.recordsets[1] };

  const rows = rowsResult.recordset.map(r => ({
    ...r,
    numero: formatearNumero(r.userId),
    nombreVisible: r.nombre || r.nombrePerfil || null,
    fechaCorta: fechaCorta(r.ultimaFechaLocal, r.hoyLocal),
    estadoInfo: ESTADOS[r.estado],
  }));
  const total = rows[0]?.totalFiltrado ?? 0;
  const resumen = resumenResult.recordset[0];

  return {
    rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    resumen: {
      total: resumen.total || 0,
      pausados: resumen.pausados || 0,
      revision: resumen.revision || 0,
      reclamo: resumen.reclamo || 0,
      pedido: resumen.pedido || 0,
      intencion: resumen.intencion || 0,
      consulta: resumen.consulta || 0,
    },
    filtros: { q: q || '', estado: f.estado || '', bot: bot === 'pausado' || bot === 'activo' ? bot : '' },
  };
}

// Conversación completa de un número (los últimos MAX_MENSAJES_CHAT), más el estado
// del interruptor. null si ese número nunca le escribió a este Cliente.
async function obtenerChat(clienteId, userId) {
  const r = await ejecutar('dbo.usp_Portal_ChatObtener', {
    clienteId: [sql.Int, clienteId],
    userId: [sql.NVarChar(100), userId],
    max: [sql.Int, MAX_MENSAJES_CHAT],
  });
  const [mensajes, chatRows] = r.recordsets;
  const chatResult = { recordset: chatRows };
  const mensajesResult = { recordset: mensajes };

  const chat = chatResult.recordset[0];
  if (!chat) return null;
  return {
    ...chat,
    numero: formatearNumero(chat.userId),
    nombreVisible: chat.nombre || chat.nombrePerfil || null,
    estadoInfo: ESTADOS[chat.estado],
    estadoAutoInfo: ESTADOS[chat.estadoAuto],
    // WhatsApp solo deja mandar texto libre hasta 24 h después del último mensaje del cliente.
    ventanaAbierta: chat.minutosDesdeCliente != null && chat.minutosDesdeCliente < VENTANA_MINUTOS,
    ventanaRestante: chat.minutosDesdeCliente != null ? Math.max(0, VENTANA_MINUTOS - chat.minutosDesdeCliente) : 0,
    mensajes: mensajesResult.recordset,
  };
}

// Pausa o reactiva el bot para un número. El bot lo lee en cada mensaje entrante
// (y otra vez antes de mandar la respuesta), así que el cambio corta al instante.
// Al reactivar un chat pausado, el procedure corta el historial que ve Claude
// (Chats.historialDesdeId): arranca de cero desde ahí, para que no relea un
// "quiero hablar con una persona" ya atendido y se vuelva a pausar solo.
// Devuelve false si ese número no tiene mensajes con este Cliente.
async function setBotChat(clienteId, userId, activo, actualizadoPor) {
  const r = await ejecutar('dbo.usp_Portal_ChatBotSet', {
    clienteId: [sql.Int, clienteId],
    userId: [sql.NVarChar(100), userId],
    activo: [sql.Bit, activo],
    por: [sql.NVarChar(255), actualizadoPor ? String(actualizadoPor).slice(0, 255) : null],
  });
  return Boolean(r.recordset[0]?.ok);
}

// Estado elegido a mano (null = volver al automático). false = número sin mensajes
// con este Cliente o estado inválido.
async function setEstadoManual(clienteId, userId, estado, por) {
  if (estado != null && !ESTADOS_MANUALES.includes(estado)) return false;
  const r = await ejecutar('dbo.usp_Portal_ChatEstadoManual', {
    clienteId: [sql.Int, clienteId],
    userId: [sql.NVarChar(100), userId],
    estado: [sql.NVarChar(20), estado ?? null],
    por: [sql.NVarChar(255), por ? String(por).slice(0, 255) : null],
  });
  return Boolean(r.recordset[0]?.ok);
}

// Nombre propio para un número (vacío = volver a mostrar el de WhatsApp o el número).
// Si el chat todavía no tiene fila en Chats (chats de antes de que existiera la
// tabla), se crea con el bot activo, que es como ya venía funcionando.
async function setNombreChat(clienteId, userId, nombre) {
  const result = await ejecutar('dbo.usp_Portal_ChatNombreSet', {
    clienteId: [sql.Int, clienteId],
    userId: [sql.NVarChar(100), userId],
    nombre: [sql.NVarChar(100), nombre ? String(nombre).trim().slice(0, 100) : null],
  });
  return Boolean(result.recordset[0]?.ok);
}

// Huella barata de la bandeja para el polling de la página de Chats: el id del
// último mensaje (sube con cada mensaje nuevo, de cualquier chat) más cuántos
// chats tienen el bot pausado. Si cambia, la página se vuelve a pedir.
async function huellaBandeja(clienteId) {
  const result = await ejecutar('dbo.usp_Portal_ChatsHuella', { clienteId: [sql.Int, clienteId] });
  const r = result.recordset[0] || {};
  return `${r.ultimoId || 0}-${r.pausados || 0}-${r.revision || 0}`;
}

// "Humano Solicitado" (Reclamos > Humano Solicitado): Pendiente mientras
// Chats.revisionHumana = 1, Atendido cuando alguien lo marca, le responde desde
// el portal o reactiva el bot. El bot sigue pausado al atenderlo: se reactiva aparte.
const ESTADOS_HUMANO = ['pendiente', 'atendido'];

// Devuelve true si cambió (false = no tenía un pedido de persona o ya estaba así).
async function setEstadoHumano(clienteId, userId, estado, por) {
  if (!ESTADOS_HUMANO.includes(estado)) return false;
  const r = await ejecutar('dbo.usp_Portal_HumanoSolicitadoEstado', {
    clienteId: [sql.Int, clienteId],
    userId: [sql.NVarChar(100), userId],
    estado: [sql.NVarChar(20), estado],
    por: [sql.NVarChar(255), por ? String(por).slice(0, 255) : null],
  });
  return (r.recordset[0]?.cambiados || 0) > 0;
}

function atenderRevision(clienteId, userId, por) {
  return setEstadoHumano(clienteId, userId, 'atendido', por);
}

// Etiqueta de cada fila en la bandeja de Atención Humana (mismo formato que ESTADOS).
const ESTADOS_HUMANO_INFO = {
  pendiente: { label: 'Pendiente', clase: 'badge-revision' },
  atendido: { label: 'Atendido', clase: 'badge-success' },
};

// Bandeja de Atención Humana: las filas salen con la misma forma que listarChats
// para que el frontend use la misma lista y la misma conversación.
async function listarHumanoSolicitado(clienteId, { page = 1, estado, q } = {}) {
  const f = filtrosDe({ q });
  const r = await ejecutar('dbo.usp_Portal_HumanoSolicitadoListar', {
    clienteId: [sql.Int, clienteId],
    estado: [sql.NVarChar(20), ESTADOS_HUMANO.includes(estado) ? estado : null],
    q: [sql.NVarChar(60), f.q],
    qDigitos: [sql.NVarChar(60), f.qDigitos],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const totales = r.recordsets[0][0] || {};
  const rows = r.recordsets[1].map(row => ({
    ...row,
    numero: formatearNumero(row.userId),
    nombreVisible: row.nombre || row.nombrePerfil || null,
    fechaCorta: row.ultimaFechaLocal ? fechaCorta(row.ultimaFechaLocal, row.hoyLocal) : '',
    estadoInfo: ESTADOS_HUMANO_INFO[row.estado],
  }));
  return {
    rows,
    resumen: { total: totales.total || 0, pendiente: totales.pendientes || 0, atendido: totales.atendidos || 0 },
    estados: ESTADOS_HUMANO_INFO,
    page,
    totalPages: Math.max(1, Math.ceil((rows[0]?.totalFiltrado || 0) / PAGE_SIZE)),
  };
}

// Bandeja de Reclamos: un chat por número con sus reclamos (Escalamientos). El
// estado del chat es el de su reclamo más atrasado. Misma forma que listarChats.
const ESTADOS_RECLAMO_INFO = {
  pendiente: { label: 'Pendiente', clase: 'badge-danger' },
  en_proceso: { label: 'En Proceso', clase: 'badge-info' },
  resuelto: { label: 'Resuelto', clase: 'badge-success' },
};

async function listarReclamosBandeja(clienteId, { page = 1, estado, q } = {}) {
  const f = filtrosDe({ q });
  const r = await ejecutar('dbo.usp_Portal_ReclamosBandeja', {
    clienteId: [sql.Int, clienteId],
    estado: [sql.NVarChar(20), ESTADOS_RECLAMO_INFO[estado] ? estado : null],
    q: [sql.NVarChar(60), f.q],
    qDigitos: [sql.NVarChar(60), f.qDigitos],
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const [totalesRows, filas, reclamos] = r.recordsets;
  const t = totalesRows[0] || {};
  const rows = filas.map(row => ({
    ...row,
    numero: formatearNumero(row.userId),
    nombreVisible: row.nombre || row.nombrePerfil || null,
    fechaCorta: row.ultimaFechaLocal ? fechaCorta(row.ultimaFechaLocal, row.hoyLocal) : '',
    estadoInfo: ESTADOS_RECLAMO_INFO[row.estado],
    listaReclamos: reclamos.filter(e => e.userId === row.userId),
  }));
  return {
    rows,
    resumen: { total: t.total || 0, pendiente: t.pendiente || 0, en_proceso: t.en_proceso || 0, resuelto: t.resuelto || 0 },
    estados: ESTADOS_RECLAMO_INFO,
    page,
    totalPages: Math.max(1, Math.ceil((rows[0]?.totalFiltrado || 0) / PAGE_SIZE)),
  };
}

module.exports = { ESTADOS, ESTADOS_MANUALES, listarChats, obtenerChat, setBotChat, setEstadoManual, setNombreChat, atenderRevision, setEstadoHumano, listarHumanoSolicitado, listarReclamosBandeja, huellaBandeja };
