const { getPool, sql } = require('./db');
const { numero: formatearNumero } = require('../viewHelpers');

// Página de Inicio: un resumen de lo que hizo el bot en los últimos `dias` días
// (comparado con los `dias` anteriores), series diarias para el gráfico y los
// mini-gráficos, el mapa de calor de cuándo escriben, lo que necesita atención y
// la actividad reciente. Todo de solo lectura.
//
// Las fechas se guardan en UTC; los cortes de día y hora se hacen en la zona
// horaria del Cliente (un "día" es de 00:00 a 23:59 en su hora local).
const PERIODOS = [7, 30];
const VENTANA_MINUTOS = 24 * 60;

// Respuesta del bot = mensaje que no es del cliente, no lo mandó una persona desde
// el portal y no es un error.
const ES_RESPUESTA_BOT = "role <> 'user' AND enviadoPor IS NULL AND ISNULL(esError, 0) = 0";

async function resumen(clienteId, dias) {
  dias = PERIODOS.includes(dias) ? dias : 7;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('dias', sql.Int, dias)
    .input('ventana', sql.Int, VENTANA_MINUTOS)
    .query(`
      DECLARE @tz sysname = (SELECT zonaHoraria FROM Clientes WHERE id = @clienteId);
      DECLARE @hoy date = CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE @tz AS date);
      -- Medianoche local del primer día de cada período, pasada a UTC.
      DECLARE @iniActual datetime2 = CAST(CAST(CAST(DATEADD(DAY, 1 - @dias, @hoy) AS datetime2) AT TIME ZONE @tz AT TIME ZONE 'UTC' AS datetimeoffset) AS datetime2);
      DECLARE @iniPrevio datetime2 = CAST(CAST(CAST(DATEADD(DAY, 1 - 2 * @dias, @hoy) AS datetime2) AT TIME ZONE @tz AT TIME ZONE 'UTC' AS datetimeoffset) AS datetime2);
      DECLARE @iniHoy datetime2 = CAST(CAST(CAST(@hoy AS datetime2) AT TIME ZONE @tz AT TIME ZONE 'UTC' AS datetimeoffset) AS datetime2);

      -- 1) Totales del período actual y del anterior.
      SELECT
        CONVERT(char(10), @hoy, 23) AS hoy,
        (SELECT CONVERT(char(10), CAST(MIN(createdAt) AT TIME ZONE 'UTC' AT TIME ZONE @tz AS date), 23) FROM Mensajes WHERE clienteId = @clienteId) AS desde,
        (SELECT COUNT(DISTINCT userId) FROM Mensajes WHERE clienteId = @clienteId AND createdAt >= @iniActual) AS chats,
        (SELECT COUNT(DISTINCT userId) FROM Mensajes WHERE clienteId = @clienteId AND createdAt >= @iniPrevio AND createdAt < @iniActual) AS chatsPrevio,
        (SELECT COUNT(*) FROM Mensajes WHERE clienteId = @clienteId AND createdAt >= @iniActual AND ${ES_RESPUESTA_BOT}) AS respuestasBot,
        (SELECT COUNT(*) FROM Mensajes WHERE clienteId = @clienteId AND createdAt >= @iniPrevio AND createdAt < @iniActual AND ${ES_RESPUESTA_BOT}) AS respuestasBotPrevio,
        (SELECT COUNT(*) FROM Pedidos WHERE clienteId = @clienteId AND fechaAlta >= @iniActual) AS pedidos,
        (SELECT COUNT(*) FROM Pedidos WHERE clienteId = @clienteId AND fechaAlta >= @iniPrevio AND fechaAlta < @iniActual) AS pedidosPrevio,
        (SELECT ISNULL(SUM(total), 0) FROM Pedidos WHERE clienteId = @clienteId AND fechaAlta >= @iniActual AND estado <> 'cancelado') AS vendido,
        (SELECT ISNULL(SUM(total), 0) FROM Pedidos WHERE clienteId = @clienteId AND fechaAlta >= @iniPrevio AND fechaAlta < @iniActual AND estado <> 'cancelado') AS vendidoPrevio,
        (SELECT COUNT(*) FROM Pedidos WHERE clienteId = @clienteId) AS pedidosHistoricos,
        (SELECT COUNT(*) FROM VConsultas WHERE clienteId = @clienteId AND fechaAlta >= @iniActual) AS consultas,
        (SELECT COUNT(*) FROM VConsultas WHERE clienteId = @clienteId AND fechaAlta >= @iniPrevio AND fechaAlta < @iniActual) AS consultasPrevio,
        (SELECT COUNT(DISTINCT userId) FROM Mensajes WHERE clienteId = @clienteId AND createdAt >= @iniHoy) AS chatsHoy,
        (SELECT COUNT(*) FROM Mensajes WHERE clienteId = @clienteId AND createdAt >= @iniHoy AND ${ES_RESPUESTA_BOT}) AS respuestasBotHoy;

      -- 2) Contactos nuevos: números cuyo primer mensaje cae en cada período.
      SELECT
        ISNULL(SUM(CASE WHEN primero >= @iniActual THEN 1 ELSE 0 END), 0) AS nuevos,
        ISNULL(SUM(CASE WHEN primero >= @iniPrevio AND primero < @iniActual THEN 1 ELSE 0 END), 0) AS nuevosPrevio
      FROM (SELECT MIN(createdAt) AS primero FROM Mensajes WHERE clienteId = @clienteId GROUP BY userId) p;

      -- 3) Velocidad: mediana de segundos entre un mensaje del cliente y la
      --    respuesta del bot que le sigue en ese mismo chat (período actual).
      WITH m AS (
        SELECT role, createdAt,
          LEAD(role) OVER (PARTITION BY userId ORDER BY id) AS sigRole,
          LEAD(enviadoPor) OVER (PARTITION BY userId ORDER BY id) AS sigPor,
          LEAD(esError) OVER (PARTITION BY userId ORDER BY id) AS sigError,
          LEAD(createdAt) OVER (PARTITION BY userId ORDER BY id) AS sigFecha
        FROM Mensajes
        WHERE clienteId = @clienteId AND createdAt >= @iniActual
      )
      SELECT TOP 1
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY DATEDIFF_BIG(MILLISECOND, createdAt, sigFecha)) OVER () AS medianaMs,
        COUNT(*) OVER () AS muestras
      FROM m
      WHERE role = 'user' AND sigRole <> 'user' AND sigPor IS NULL AND ISNULL(sigError, 0) = 0;

      -- 4) Series diarias del período actual (los días sin datos se completan en JS).
      SELECT CONVERT(char(10), dia, 23) AS dia,
        SUM(chats) AS chats, SUM(respuestas) AS respuestas, SUM(pedidos) AS pedidos,
        SUM(vendido) AS vendido, SUM(nuevos) AS nuevos, SUM(consultas) AS consultas
      FROM (
        SELECT d.dia, COUNT(DISTINCT m.userId) AS chats,
          SUM(CASE WHEN m.role <> 'user' AND m.enviadoPor IS NULL AND ISNULL(m.esError, 0) = 0 THEN 1 ELSE 0 END) AS respuestas,
          0 AS pedidos, CAST(0 AS decimal(18, 2)) AS vendido, 0 AS nuevos, 0 AS consultas
        FROM Mensajes m
        CROSS APPLY (SELECT CAST(m.createdAt AT TIME ZONE 'UTC' AT TIME ZONE @tz AS date) AS dia) d
        WHERE m.clienteId = @clienteId AND m.createdAt >= @iniActual
        GROUP BY d.dia
        UNION ALL
        SELECT d.dia, 0, 0, COUNT(*), ISNULL(SUM(CASE WHEN p.estado <> 'cancelado' THEN p.total END), 0), 0, 0
        FROM Pedidos p
        CROSS APPLY (SELECT CAST(p.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE @tz AS date) AS dia) d
        WHERE p.clienteId = @clienteId AND p.fechaAlta >= @iniActual
        GROUP BY d.dia
        UNION ALL
        SELECT d.dia, 0, 0, 0, 0, COUNT(*), 0
        FROM (SELECT MIN(createdAt) AS primero FROM Mensajes WHERE clienteId = @clienteId GROUP BY userId) n
        CROSS APPLY (SELECT CAST(n.primero AT TIME ZONE 'UTC' AT TIME ZONE @tz AS date) AS dia) d
        WHERE n.primero >= @iniActual
        GROUP BY d.dia
        UNION ALL
        SELECT d.dia, 0, 0, 0, 0, 0, COUNT(*)
        FROM VConsultas v
        CROSS APPLY (SELECT CAST(v.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE @tz AS date) AS dia) d
        WHERE v.clienteId = @clienteId AND v.fechaAlta >= @iniActual
        GROUP BY d.dia
      ) x
      GROUP BY dia;

      -- 5) Mapa de calor: mensajes de clientes por día de la semana (0 = lunes)
      --    y hora local. 1900-01-01 fue lunes, así no depende de DATEFIRST.
      SELECT x.dow, x.hora, COUNT(*) AS n
      FROM Mensajes m
      CROSS APPLY (SELECT CAST(m.createdAt AT TIME ZONE 'UTC' AT TIME ZONE @tz AS datetime2) AS l) t
      CROSS APPLY (SELECT DATEDIFF(DAY, '19000101', t.l) % 7 AS dow, DATEPART(HOUR, t.l) AS hora) x
      WHERE m.clienteId = @clienteId AND m.role = 'user' AND m.createdAt >= @iniActual
      GROUP BY x.dow, x.hora;

      -- 6) Reclamos abiertos.
      SELECT COUNT(*) OVER () AS total, e.id, e.userId, e.motivo, e.fechaAlta AS fecha, COALESCE(ch.nombre, ch.nombrePerfil) AS nombre
      FROM Escalamientos e
      LEFT JOIN Chats ch ON ch.clienteId = e.clienteId AND ch.userId = e.userId
      WHERE e.clienteId = @clienteId AND e.estado <> 'resuelto' AND e.motivo NOT LIKE '[[]Revisión humana]%'
      ORDER BY e.id DESC
      OFFSET 0 ROWS FETCH NEXT 3 ROWS ONLY;

      -- 7) Pedidos esperando confirmación.
      SELECT COUNT(*) OVER () AS total, p.id, p.userId, p.total AS monto, p.fechaAlta AS fecha, COALESCE(ch.nombre, ch.nombrePerfil) AS nombre
      FROM Pedidos p
      LEFT JOIN Chats ch ON ch.clienteId = p.clienteId AND ch.userId = p.userId
      WHERE p.clienteId = @clienteId AND p.estado = 'pendiente'
      ORDER BY p.id DESC
      OFFSET 0 ROWS FETCH NEXT 3 ROWS ONLY;

      -- 8) Chats que esperan respuesta de una persona: el último mensaje es del
      --    cliente, el bot no le va a contestar (pausado en ese chat o apagado en
      --    general) y todavía se le puede escribir (ventana de 24 hs de WhatsApp).
      --    Primero los que tienen menos tiempo para responder.
      WITH ult AS (
        SELECT userId, MAX(id) AS ultId FROM Mensajes
        WHERE clienteId = @clienteId AND createdAt >= DATEADD(MINUTE, -@ventana, SYSUTCDATETIME())
        GROUP BY userId
      )
      SELECT COUNT(*) OVER () AS total, u.userId, m.content AS mensaje, m.createdAt AS fecha,
        @ventana - DATEDIFF(MINUTE, m.createdAt, SYSUTCDATETIME()) AS minutosRestantes,
        COALESCE(ch.nombre, ch.nombrePerfil) AS nombre
      FROM ult u
      JOIN Mensajes m ON m.id = u.ultId
      JOIN Clientes c ON c.id = @clienteId
      LEFT JOIN Chats ch ON ch.clienteId = @clienteId AND ch.userId = u.userId
      WHERE m.role = 'user' AND (ISNULL(ch.botActivo, 1) = 0 OR ISNULL(c.botActivo, 1) = 0)
      ORDER BY m.createdAt ASC
      OFFSET 0 ROWS FETCH NEXT 4 ROWS ONLY;

      -- 9) Actividad reciente: pedidos, reclamos, consultas de productos y
      --    contactos nuevos. En las consultas, detalle = lo que buscó y
      --    articulo = el artículo que encontró el bot (NULL si no lo tenía).
      WITH primeros AS (
        SELECT userId, MIN(createdAt) AS fecha FROM Mensajes WHERE clienteId = @clienteId GROUP BY userId
      )
      SELECT TOP 40 a.tipo, a.id, a.userId, a.detalle, a.monto, a.articulo, a.sinStock, a.fecha, COALESCE(ch.nombre, ch.nombrePerfil) AS nombre
      FROM (
        SELECT TOP 40 'pedido' AS tipo, CAST(id AS nvarchar(20)) AS id, userId, CAST(estado AS nvarchar(400)) AS detalle, total AS monto,
          CAST(NULL AS nvarchar(200)) AS articulo, CAST(NULL AS bit) AS sinStock, fechaAlta AS fecha
        FROM Pedidos WHERE clienteId = @clienteId ORDER BY fechaAlta DESC
        UNION ALL
        SELECT TOP 40 'reclamo', CAST(id AS nvarchar(20)), userId, CAST(motivo AS nvarchar(400)), NULL, NULL, NULL, fechaAlta
        FROM Escalamientos WHERE clienteId = @clienteId AND motivo NOT LIKE '[[]Revisión humana]%' ORDER BY fechaAlta DESC
        UNION ALL
        SELECT TOP 40 'consulta', CAST(id AS nvarchar(20)), userId, CAST(detalle AS nvarchar(400)), NULL, articuloNombre, sinStock, fechaAlta
        FROM VConsultas WHERE clienteId = @clienteId AND tipo = 'articulo' ORDER BY fechaAlta DESC
        UNION ALL
        SELECT TOP 40 'contacto', NULL, userId, NULL, NULL, NULL, NULL, fecha
        FROM primeros ORDER BY fecha DESC
      ) a
      LEFT JOIN Chats ch ON ch.clienteId = @clienteId AND ch.userId = a.userId
      ORDER BY a.fecha DESC;

      -- 10) Último mensaje de un cliente (para el "en vivo" del encabezado).
      SELECT TOP 1 m.userId, m.createdAt AS fecha, COALESCE(ch.nombre, ch.nombrePerfil) AS nombre
      FROM Mensajes m
      LEFT JOIN Chats ch ON ch.clienteId = m.clienteId AND ch.userId = m.userId
      WHERE m.clienteId = @clienteId AND m.role = 'user'
      ORDER BY m.id DESC;
    `);

  const [totales, nuevosRows, velocidadRows, serieRows, calorRows, reclamos, pendientes, sinResponder, actividad, ultimoRows] = result.recordsets;
  const t = totales[0];
  const n = nuevosRows[0] || {};
  const vel = velocidadRows[0];

  // Series con todos los días del período, aunque no haya datos.
  const porDia = new Map(serieRows.map(r => [r.dia, r]));
  const hoyLocal = new Date(`${t.hoy}T00:00:00Z`);
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoyLocal);
    d.setUTCDate(d.getUTCDate() - i);
    const clave = d.toISOString().slice(0, 10);
    const r = porDia.get(clave) || {};
    serie.push({
      dia: clave,
      chats: r.chats || 0,
      respuestas: r.respuestas || 0,
      pedidos: r.pedidos || 0,
      vendido: Number(r.vendido || 0),
      nuevos: r.nuevos || 0,
      consultas: r.consultas || 0,
    });
  }

  // Mapa de calor como matriz 7 × 24 (lunes a domingo, 0 a 23 hs).
  const calor = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of calorRows) calor[r.dow][r.hora] = r.n;

  const contacto = r => ({ ...r, nombre: r.nombre || null, numero: formatearNumero(r.userId), total: undefined });
  const ultimo = ultimoRows[0];

  return {
    dias,
    periodos: PERIODOS,
    hoy: { chats: t.chatsHoy, respuestasBot: t.respuestasBotHoy },
    // Primer día con mensajes (hora local). Si cae dentro del período, no hay
    // período anterior con qué comparar.
    desde: t.desde || null,
    conPedidos: t.pedidosHistoricos > 0,
    kpis: {
      chats: { valor: t.chats, previo: t.chatsPrevio },
      respuestasBot: { valor: t.respuestasBot, previo: t.respuestasBotPrevio },
      pedidos: { valor: t.pedidos, previo: t.pedidosPrevio },
      vendido: { valor: Number(t.vendido), previo: Number(t.vendidoPrevio) },
      consultas: { valor: t.consultas, previo: t.consultasPrevio },
      nuevos: { valor: n.nuevos || 0, previo: n.nuevosPrevio || 0 },
    },
    velocidad: vel && vel.muestras ? { segundos: Math.round(Number(vel.medianaMs) / 1000), muestras: vel.muestras } : null,
    serie,
    calor,
    atencion: {
      reclamos: { total: reclamos[0]?.total || 0, items: reclamos.map(contacto) },
      pendientes: { total: pendientes[0]?.total || 0, items: pendientes.map(r => ({ ...contacto(r), monto: Number(r.monto) })) },
      sinResponder: { total: sinResponder[0]?.total || 0, items: sinResponder.map(contacto) },
    },
    actividad: actividad.map(r => ({ ...contacto(r), monto: r.monto != null ? Number(r.monto) : null })),
    ultimoMensaje: ultimo ? contacto(ultimo) : null,
  };
}

// Números chiquitos del menú lateral: chats que esperan respuesta de una persona
// (mismo criterio que "Necesita tu atención"), reclamos abiertos y pedidos por
// confirmar. Liviano porque se pide seguido.
async function contadores(clienteId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('ventana', sql.Int, VENTANA_MINUTOS)
    .query(`
      WITH ult AS (
        SELECT userId, MAX(id) AS ultId FROM Mensajes
        WHERE clienteId = @clienteId AND createdAt >= DATEADD(MINUTE, -@ventana, SYSUTCDATETIME())
        GROUP BY userId
      )
      SELECT
        (SELECT COUNT(*)
         FROM ult u
         JOIN Mensajes m ON m.id = u.ultId
         JOIN Clientes c ON c.id = @clienteId
         LEFT JOIN Chats ch ON ch.clienteId = @clienteId AND ch.userId = u.userId
         WHERE m.role = 'user' AND (ISNULL(ch.botActivo, 1) = 0 OR ISNULL(c.botActivo, 1) = 0)) AS chats,
        (SELECT COUNT(*) FROM Escalamientos WHERE clienteId = @clienteId AND estado <> 'resuelto') AS escalamientos,
        (SELECT COUNT(*) FROM Pedidos WHERE clienteId = @clienteId AND estado = 'pendiente') AS pedidos,
        (SELECT COUNT(*) FROM Chats WHERE clienteId = @clienteId AND revisionHumana = 1) AS revision;

      -- Chats en revisión humana, para el aviso de arriba de todo en el portal.
      SELECT TOP 5 ch.userId, COALESCE(ch.nombre, ch.nombrePerfil) AS nombre, ch.revisionHumanaMotivo AS motivo
      FROM Chats ch
      WHERE ch.clienteId = @clienteId AND ch.revisionHumana = 1
      ORDER BY ch.revisionHumanaEn DESC;
    `);
  return { ...r.recordsets[0][0], revisionChats: r.recordsets[1] };
}

module.exports = { resumen, contadores, PERIODOS };
