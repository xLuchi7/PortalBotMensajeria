const { getPool, sql } = require('./db');
const bot = require('./botService');

// Avisos automáticos por WhatsApp que dispara Shopify (pago recibido, pedido
// despachado…). Los manda Bot_Mensajeria: dentro de la ventana de 24 h como
// texto normal; fuera de ella solo con una plantilla aprobada por Meta, si el
// Cliente cargó su nombre. Cada aviso tiene una clave única por Cliente
// (ej. "envio:pedido:123") para no mandarlo nunca dos veces, y queda en
// AvisosWhatsApp como historial.

const ENVIADO_POR = 'Aviso automático';
const IDIOMA_DEFAULT = 'es_AR';

// Qué avisos existen. `parametros` son los {{1}}, {{2}}… de la plantilla de Meta,
// en el orden que se explica en Integraciones.
const TIPOS = {
  pago: {
    nombre: 'Pago recibido',
    parametros: d => [d.orderName],
  },
  envio: {
    nombre: 'Pedido despachado',
    parametros: d => [d.orderName, d.trackingUrl || d.trackingNumero || 'sin número de seguimiento'],
  },
};

function configVacia() {
  const cfg = { idioma: IDIOMA_DEFAULT };
  for (const tipo of Object.keys(TIPOS)) cfg[tipo] = { activo: false, plantilla: '' };
  return cfg;
}

// Se guarda solo lo conocido, con nombres de plantilla válidos para Meta.
function limpiarConfig(entrada = {}) {
  const cfg = configVacia();
  const idioma = String(entrada.idioma || '').trim();
  if (/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)) cfg.idioma = idioma;
  for (const tipo of Object.keys(TIPOS)) {
    const t = entrada[tipo] || {};
    const plantilla = String(t.plantilla || '').trim().toLowerCase();
    cfg[tipo] = {
      activo: Boolean(t.activo),
      plantilla: /^[a-z0-9_]{1,512}$/.test(plantilla) ? plantilla : '',
    };
  }
  return cfg;
}

async function leerConfig(clienteId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .query('SELECT avisosConfig FROM Clientes WHERE id = @clienteId');
  const crudo = r.recordset[0]?.avisosConfig;
  if (!crudo) return configVacia();
  try {
    return limpiarConfig(JSON.parse(crudo));
  } catch {
    return configVacia();
  }
}

async function guardarConfig(clienteId, entrada) {
  const cfg = limpiarConfig(entrada);
  const pool = await getPool();
  await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('cfg', sql.NVarChar(sql.MAX), JSON.stringify(cfg))
    .query('UPDATE Clientes SET avisosConfig = @cfg WHERE id = @clienteId');
  return cfg;
}

// Reserva la clave. Si ya existía, otro webhook (o un reintento de Shopify) ya
// mandó este aviso.
async function reservar(pool, { clienteId, userId, tipo, clave, pedidoId, articuloId }) {
  try {
    const r = await pool
      .request()
      .input('clienteId', sql.Int, clienteId)
      .input('userId', sql.NVarChar(100), userId)
      .input('tipo', sql.NVarChar(30), tipo)
      .input('clave', sql.NVarChar(150), clave)
      .input('pedidoId', sql.Int, pedidoId ?? null)
      .input('articuloId', sql.Int, articuloId ?? null)
      .query(`
        INSERT INTO AvisosWhatsApp (clienteId, userId, tipo, clave, pedidoId, articuloId, estado)
        OUTPUT INSERTED.id
        VALUES (@clienteId, @userId, @tipo, @clave, @pedidoId, @articuloId, 'enviando')
      `);
    return r.recordset[0].id;
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) return null; // clave duplicada
    throw err;
  }
}

async function cerrar(pool, id, { estado, via = null, detalle = null }) {
  await pool
    .request()
    .input('id', sql.Int, id)
    .input('estado', sql.NVarChar(30), estado)
    .input('via', sql.NVarChar(20), via)
    .input('detalle', sql.NVarChar(1000), detalle ? String(detalle).slice(0, 1000) : null)
    .query('UPDATE AvisosWhatsApp SET estado = @estado, via = @via, detalle = @detalle WHERE id = @id');
}

/**
 * Manda un aviso si el Cliente lo tiene activado. Nunca tira: los avisos son un
 * extra y no pueden romper el procesamiento del webhook.
 * datos: lo que usan el texto y los parámetros de la plantilla (orderName, trackingUrl…).
 */
async function avisar({ clienteId, userId, tipo, clave, pedidoId = null, articuloId = null, texto, datos = {} }) {
  try {
    if (!TIPOS[tipo] || !userId) return { omitido: true };
    const cfg = await leerConfig(clienteId);
    if (!cfg[tipo].activo) return { omitido: true };

    const pool = await getPool();
    const id = await reservar(pool, { clienteId, userId, tipo, clave, pedidoId, articuloId });
    if (!id) return { duplicado: true };

    if (!bot.envioHabilitado()) {
      await cerrar(pool, id, { estado: 'error', detalle: 'El portal no tiene configurado el envío de mensajes (BOT_URL / BOT_API_TOKEN).' });
      return { error: true };
    }

    const r = await bot.enviarMensaje({ clienteId, userId, texto, enviadoPor: ENVIADO_POR });
    if (r.ok) {
      await cerrar(pool, id, { estado: 'enviado', via: 'texto' });
      return { enviado: true };
    }
    if (r.error !== 'fuera_de_ventana') {
      await cerrar(pool, id, { estado: 'error', detalle: r.mensaje });
      return { error: true };
    }

    // Pasaron más de 24 h desde que la persona escribió: solo con plantilla.
    const plantilla = cfg[tipo].plantilla;
    if (!plantilla) {
      await cerrar(pool, id, { estado: 'fuera_de_ventana', detalle: 'Pasaron más de 24 hs y no hay plantilla cargada.' });
      return { fueraDeVentana: true };
    }
    const p = await bot.enviarPlantilla({
      clienteId, userId, plantilla, idioma: cfg.idioma, parametros: TIPOS[tipo].parametros(datos), texto, enviadoPor: ENVIADO_POR,
    });
    if (p.ok) {
      await cerrar(pool, id, { estado: 'enviado', via: 'plantilla' });
      return { enviado: true };
    }
    await cerrar(pool, id, { estado: 'error', via: 'plantilla', detalle: p.detalle || p.mensaje });
    return { error: true };
  } catch (err) {
    console.error(`[avisos] No se pudo mandar el aviso ${clave} (cliente ${clienteId}):`, err.message);
    return { error: true };
  }
}

async function listarDePedido(clienteId, pedidoId) {
  const pool = await getPool();
  const r = await pool
    .request()
    .input('clienteId', sql.Int, clienteId)
    .input('pedidoId', sql.Int, pedidoId)
    .query(`
      SELECT a.id, a.tipo, a.estado, a.via, a.detalle,
        FORMAT(a.fechaAlta AT TIME ZONE 'UTC' AT TIME ZONE c.zonaHoraria, 'dd/MM/yyyy, HH:mm') AS fecha
      FROM AvisosWhatsApp a JOIN Clientes c ON c.id = a.clienteId
      WHERE a.clienteId = @clienteId AND a.pedidoId = @pedidoId
      ORDER BY a.id
    `);
  return r.recordset.map(a => ({ ...a, nombre: TIPOS[a.tipo]?.nombre || a.tipo }));
}

module.exports = { TIPOS, leerConfig, guardarConfig, avisar, listarDePedido };
