const config = require('../config');

const BASE = `https://graph.facebook.com/${config.meta.apiVersion}`;
const MAX_PAGINAS = 20; // tope de seguridad, no debería haber tantas WABAs compartidas
const TIMEOUT_MS = 15 * 1000;

function normalizeTelefono(telefono) {
  return (telefono || '').replace(/\D/g, '');
}

async function graphFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${config.meta.whatsappToken}`, ...options.headers },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || `Error ${res.status} llamando a la API de Meta`;
    throw new Error(msg);
  }
  return data;
}

// Recorre las WABAs compartidas con el Business del Tech Provider (todas las que
// algún cliente conectó vía Embedded Signup) hasta encontrar una cuyo número de
// WhatsApp coincida con el teléfono del Cliente que se está cargando.
async function buscarWabaIdPorTelefono(telefonoNormalizado) {
  // Los números de cada WABA vienen en la misma respuesta (field expansion): una
  // llamada por página en vez de una por WABA.
  let url = `${BASE}/${config.meta.businessId}/client_whatsapp_business_accounts?fields=id,phone_numbers{display_phone_number}&limit=100`;
  let paginas = 0;

  while (url && paginas < MAX_PAGINAS) {
    paginas++;
    const pagina = await graphFetch(url);
    for (const waba of pagina.data || []) {
      const coincide = (waba.phone_numbers?.data || []).some(n => normalizeTelefono(n.display_phone_number) === telefonoNormalizado);
      if (coincide) return waba.id;
    }
    url = pagina.paging?.next || null;
  }
  return null;
}

// Sin esto, el bot nunca recibe los webhooks de esa WABA aunque el Embedded
// Signup haya terminado "bien" del lado del cliente (ver historial con Luma Uruguay).
async function suscribirWaba(wabaId) {
  const data = await graphFetch(`${BASE}/${wabaId}/subscribed_apps`, { method: 'POST' });
  if (!data?.success) throw new Error('Meta no confirmó la suscripción al WABA.');
}

// Busca la WABA de este teléfono entre las compartidas con el Tech Provider y la
// suscribe. Tira un error (sin side effects) si el cliente todavía no completó el
// Embedded Signup con este número — el llamador no debe crear el Cliente en ese caso.
async function suscribirClientePorTelefono(telefono) {
  const telefonoNormalizado = normalizeTelefono(telefono);
  const wabaId = await buscarWabaIdPorTelefono(telefonoNormalizado);
  if (!wabaId) {
    throw new Error(
      'No encontramos ninguna Cuenta de WhatsApp Business con ese teléfono entre las conectadas al Tech Provider. ' +
      'Confirmá que el cliente ya completó el Embedded Signup antes de cargarlo acá.'
    );
  }
  await suscribirWaba(wabaId);
  return wabaId;
}

module.exports = { suscribirClientePorTelefono };
