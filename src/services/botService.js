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

async function enviarMensaje({ clienteId, userId, texto, enviadoPor }) {
  if (!envioHabilitado()) return { ok: false, mensaje: 'Envío De Mensajes Sin Configurar' };

  let resp;
  try {
    resp = await fetch(`${config.bot.url}/portal/enviar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.bot.apiToken}` },
      body: JSON.stringify({ clienteId, userId, texto, enviadoPor }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.error('[bot] No se pudo contactar al bot:', err.message);
    return { ok: false, mensaje: 'No Se Pudo Contactar Al Bot, Probá De Nuevo' };
  }

  const data = await resp.json().catch(() => ({}));
  if (resp.ok && data.ok) return { ok: true };
  console.warn(`[bot] /portal/enviar respondió ${resp.status}: ${data.error || 'sin detalle'}`);
  return { ok: false, mensaje: ERRORES[data.error] || 'No Se Pudo Enviar El Mensaje' };
}

module.exports = { envioHabilitado, enviarMensaje };
