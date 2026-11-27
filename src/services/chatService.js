const { getPool, ejecutar, sql } = require('./db');
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

// Una fila por chat (clienteId + userId) con su último mensaje, el estado y si el
// bot está pausado para ese número. Sin fila en Chats = bot activo.
// estadoAuto = el calculado; estado = el que se muestra (Humano Solicitado >
// elegido a mano > calculado).
const CHATS_CTE = `
  WITH ult AS (
    SELECT userId, MAX(id) AS ultId, COUNT(*) AS cantidad
    FROM Mensajes
    WHERE clienteId = @clienteId
    GROUP BY userId
  ),
  calculo AS (
    SELECT
      u.userId, u.ultId, u.cantidad,
      m.content AS ultimoMensaje, m.role AS ultimoRol, m.platform, m.esError AS ultimoEsError, m.enviadoPor AS ultimoEnviadoPor,
      CAST(m.createdAt AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria AS datetime2) AS ultimaFechaLocal,
      CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria AS date) AS hoyLocal,
      CAST(ISNULL(ch.botActivo, 1) AS bit) AS botActivo,
      ch.nombre, ch.nombrePerfil,
      CAST(ISNULL(ch.revisionHumana, 0) AS bit) AS revisionHumana, ch.revisionHumanaMotivo, ch.revisionHumanaEn,
      ch.estadoManual,
      CASE
        WHEN EXISTS (SELECT 1 FROM Escalamientos e WHERE e.clienteId = @clienteId AND e.userId = u.userId AND e.estado <> 'resuelto' AND e.motivo NOT LIKE '[[]Revisión humana]%') THEN 'reclamo'
        WHEN EXISTS (SELECT 1 FROM Pedidos p WHERE p.clienteId = @clienteId AND p.userId = u.userId) THEN 'pedido'
        WHEN EXISTS (SELECT 1 FROM ConsultasArticulo ca WHERE ca.clienteId = @clienteId AND ca.userId = u.userId AND ca.encontrado = 1) THEN 'intencion'
        ELSE 'consulta'
      END AS estadoAuto
    FROM ult u
    JOIN Mensajes m ON m.id = u.ultId
    JOIN Clientes c ON c.id = @clienteId
    LEFT JOIN Chats ch ON ch.clienteId = @clienteId AND ch.userId = u.userId
  ),
  bandeja AS (
    SELECT b.*,
      CASE
        WHEN b.revisionHumana = 1 THEN 'revision'
        WHEN b.estadoManual IN ('reclamo', 'pedido', 'intencion', 'consulta') THEN b.estadoManual
        ELSE b.estadoAuto
      END AS estado
    FROM calculo b
  )
`;

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
  const pool = await getPool();
  const offset = (page - 1) * PAGE_SIZE;
  const f = filtrosDe({ q, estado, bot });

  const [rowsResult, resumenResult] = await Promise.all([
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('q', sql.NVarChar, f.q)
      .input('qDigitos', sql.NVarChar, f.qDigitos)
      .input('estado', sql.NVarChar, f.estado)
      .input('bot', sql.Bit, f.bot)
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, PAGE_SIZE)
      .query(`${CHATS_CTE}
        SELECT *, COUNT(*) OVER () AS totalFiltrado
        FROM bandeja
        WHERE (@q IS NULL OR nombre LIKE @q OR nombrePerfil LIKE @q OR userId LIKE @q OR userId LIKE @qDigitos)
          AND (@estado IS NULL OR estado = @estado)
          AND (@bot IS NULL OR botActivo = @bot)
        ORDER BY ultId DESC
        OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
      `),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .query(`${CHATS_CTE}
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN botActivo = 0 THEN 1 ELSE 0 END) AS pausados,
          SUM(CASE WHEN estado = 'revision' THEN 1 ELSE 0 END) AS revision,
          SUM(CASE WHEN estado = 'reclamo' THEN 1 ELSE 0 END) AS reclamo,
          SUM(CASE WHEN estado = 'pedido' THEN 1 ELSE 0 END) AS pedido,
          SUM(CASE WHEN estado = 'intencion' THEN 1 ELSE 0 END) AS intencion,
          SUM(CASE WHEN estado = 'consulta' THEN 1 ELSE 0 END) AS consulta
        FROM bandeja
      `),
  ]);

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
  const pool = await getPool();
  const [mensajesResult, chatResult] = await Promise.all([
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('userId', sql.NVarChar, userId)
      .input('max', sql.Int, MAX_MENSAJES_CHAT)
      .query(`
        SELECT * FROM (
          SELECT TOP (@max)
            m.id, m.role, m.content, m.esError, m.platform, m.enviadoPor,
            FORMAT(m.createdAt AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'HH:mm') AS hora,
            FORMAT(m.createdAt AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'dd/MM/yyyy') AS dia
          FROM Mensajes m
          JOIN Clientes c ON c.id = m.clienteId
          WHERE m.clienteId = @clienteId AND m.userId = @userId
          ORDER BY m.id DESC
        ) ultimos
        ORDER BY id ASC
      `),
    pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('userId', sql.NVarChar, userId)
      .query(`${CHATS_CTE}
        SELECT ch.userId, ch.cantidad, ch.platform, ch.botActivo, ch.estado, ch.estadoAuto, ch.estadoManual, ch.nombre, ch.nombrePerfil,
          x.estadoManualPor,
          FORMAT(x.estadoManualEn AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'dd/MM/yyyy HH:mm') AS estadoManualEn,
          ch.revisionHumana, ch.revisionHumanaMotivo,
          FORMAT(ch.revisionHumanaEn AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'dd/MM/yyyy HH:mm') AS revisionHumanaFecha,
          x.botActualizadoPor,
          FORMAT(x.botActualizadoEn AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'dd/MM/yyyy HH:mm') AS botActualizadoEn,
          (SELECT DATEDIFF(MINUTE, MAX(mu.createdAt), SYSUTCDATETIME()) FROM Mensajes mu
            WHERE mu.clienteId = @clienteId AND mu.userId = ch.userId AND mu.role = 'user') AS minutosDesdeCliente
        FROM bandeja ch
        JOIN Clientes c ON c.id = @clienteId
        LEFT JOIN Chats x ON x.clienteId = @clienteId AND x.userId = ch.userId
        WHERE ch.userId = @userId
      `),
  ]);

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
  const pool = await getPool();
  const result = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('userId', sql.NVarChar, userId)
    .input('nombre', sql.NVarChar, nombre ? String(nombre).trim().slice(0, 100) : null)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM Mensajes WHERE clienteId = @clienteId AND userId = @userId)
        SELECT CAST(0 AS bit) AS ok;
      ELSE
      BEGIN
        MERGE Chats WITH (HOLDLOCK) AS t
        USING (SELECT @clienteId AS clienteId, @userId AS userId) AS s
          ON t.clienteId = s.clienteId AND t.userId = s.userId
        WHEN MATCHED THEN UPDATE SET nombre = @nombre
        WHEN NOT MATCHED THEN INSERT (clienteId, userId, botActivo, nombre) VALUES (@clienteId, @userId, 1, @nombre);
        SELECT CAST(1 AS bit) AS ok;
      END
    `);
  return Boolean(result.recordset[0]?.ok);
}

// Huella barata de la bandeja para el polling de la página de Chats: el id del
// último mensaje (sube con cada mensaje nuevo, de cualquier chat) más cuántos
// chats tienen el bot pausado. Si cambia, la página se vuelve a pedir.
async function huellaBandeja(clienteId) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query(`
      SELECT
        (SELECT MAX(id) FROM Mensajes WHERE clienteId = @clienteId) AS ultimoId,
        (SELECT COUNT(*) FROM Chats WHERE clienteId = @clienteId AND botActivo = 0) AS pausados,
        (SELECT COUNT(*) FROM Chats WHERE clienteId = @clienteId AND revisionHumana = 1) AS revision
    `);
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
