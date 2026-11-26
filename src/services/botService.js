const config = require('../config');

// Textos para el toast según el error que devuelve Bot_Mensajeria (/portal/enviar).
const ERRORES = {
  fuera_de_ventana: 'Pasaron Más De 24 Hs: WhatsApp No Deja Escribirle Hasta Que Te Vuelva A Escribir',
  sin_numero: 'Todavía No Se Puede Enviar: Falta Que Entre Un Mensaje Nuevo Al Bot',
  chat_inexistente: 'Chat No Encontrado',
  cliente_inexistente: 'Cliente Inactivo',
  whatsapp_error: 'WhatsApp Rechazó El Mensaje, Probá De Nuevo',
  no_autorizado: 'El Portal No Está Autorizado Por El Bot (Revisá BOT_API_TOKEN)',
  sin_configurar: 'Falta Configurar PORTAL_API_TOKEN En El Bot',
};

function envioHabilitado() {
  return Boolean(config.bot.url && config.bot.apiToken);
}

// POST al bot con timeout. Devuelve { ok } o { ok: false, error, mensaje }
// (error = código del bot, ej. 'fuera_de_ventana'; mensaje = texto del toast).
async function llamar(ruta, body) {
  if (!envioHabilitado()) return { ok: false, error: 'sin_configurar_portal', mensaje: 'Envío De Mensajes Sin Configurar' };

  let resp;
  try {
    resp = await fetch(`${config.bot.url}${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bot.apiToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error('[bot] No se pudo contactar al bot:', err.message);
    return { ok: false, error: 'sin_conexion', mensaje: 'No Se Pudo Contactar Al Bot, Probá De Nuevo' };
  }

  const data = await resp.json().catch(() => ({}));
  if (resp.ok && data.ok) return { ok: true };
  console.warn(`[bot] ${ruta} respondió ${resp.status}: ${data.error || 'sin detalle'}${data.detalle ? ` (${data.detalle})` : ''}`);
  return { ok: false, error: data.error || 'desconocido', detalle: data.detalle, mensaje: ERRORES[data.error] || 'No Se Pudo Enviar El Mensaje' };
}

function enviarMensaje({ clienteId, userId, texto, enviadoPor }) {
  return llamar('/portal/enviar', { clienteId, userId, texto, enviadoPor });
}

// Plantilla aprobada por Meta, para avisos fuera de la ventana de 24 h
// (endpoint /portal/plantilla del bot).
function enviarPlantilla({ clienteId, userId, plantilla, idioma, parametros, texto, enviadoPor }) {
  return llamar('/portal/plantilla', { clienteId, userId, plantilla, idioma, parametros, texto, enviadoPor });
}

module.exports = { envioHabilitado, enviarMensaje, enviarPlantilla };
