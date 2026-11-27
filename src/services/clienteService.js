const { ejecutar, sql } = require('./db');

const PAGE_SIZE = 20;

// Clientes.telefono se guarda solo con dígitos (sin +, espacios ni guiones) —
// es como el bot matchea el número de WhatsApp entrante contra este Cliente.
function normalizePhone(phoneNumber) {
  return (phoneNumber || '').replace(/\D/g, '');
}

async function listarClientes(page = 1) {
  const r = await ejecutar('dbo.usp_Portal_ClientesListar', {
    page: [sql.Int, page],
    pageSize: [sql.Int, PAGE_SIZE],
  });
  const { total, activos } = r.recordsets[0][0];
  return {
    rows: r.recordsets[1],
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    activos,
  };
}

async function listarClientesActivos() {
  return (await ejecutar('dbo.usp_Portal_ClientesActivos')).recordset;
}

// La fila completa (con contextoNegocio, telefonoAlertas y avisosConfig).
async function leerCliente(id) {
  const r = await ejecutar('dbo.usp_Portal_ClienteObtener', { id: [sql.Int, id] });
  return r.recordset[0] ?? null;
}

async function obtenerCliente(id) {
  const c = await leerCliente(id);
  if (!c) return null;
  const { contextoNegocio: _c, telefonoAlertas: _t, avisosConfig: _a, ...datos } = c;
  return datos;
}

// Un solo procedure para los interruptores y datos sueltos del Cliente.
async function setCampo(id, campo, { bit = null, texto = null } = {}) {
  await ejecutar('dbo.usp_Portal_ClienteCampoSet', {
    id: [sql.Int, id],
    campo: [sql.VarChar(30), campo],
    bit: [sql.Bit, bit],
    texto: [sql.NVarChar(sql.MAX), texto],
  });
}

// Interruptor general: con botActivo = 0 el bot no le responde a ningún chat de
// este Cliente (Bot_Mensajeria lo lee en cada mensaje entrante, sin caché).
async function setBotGeneral(id, activo) {
  await setCampo(id, 'botActivo', { bit: activo });
}

// Con qué arranca el bot en el chat de un número que escribe por primera vez.
// Bot_Mensajeria lo aplica al crear la fila en Chats: cambiarlo no toca chats existentes.
async function setBotChatsNuevos(id, activo) {
  await setCampo(id, 'botChatsNuevosActivo', { bit: activo });
}

function datosCliente({ razonSocial, cuit, telefono, email, zonaHoraria, wabaId }) {
  return {
    razonSocial: [sql.NVarChar(200), razonSocial],
    cuit: [sql.NVarChar(20), cuit],
    telefono: [sql.NVarChar(20), normalizePhone(telefono)],
    email: [sql.NVarChar(200), email || null],
    zonaHoraria: [sql.NVarChar(50), zonaHoraria || 'Argentina Standard Time'],
    wabaId: [sql.NVarChar(50), wabaId || null],
  };
}

async function crearCliente(datos) {
  await ejecutar('dbo.usp_Portal_ClienteCrear', datosCliente(datos));
}

// wabaId: solo si cambió el teléfono (se volvió a buscar y suscribir la WABA).
async function actualizarCliente(id, datos) {
  await ejecutar('dbo.usp_Portal_ClienteActualizar', { id: [sql.Int, id], ...datosCliente(datos) });
}

// Una zona inválida rompe todos los AT TIME ZONE de ese Cliente (chats, pedidos, inicio...).
async function zonaHorariaValida(zona) {
  const result = await ejecutar('dbo.usp_Portal_ZonaHorariaValida', { zona: [sql.NVarChar(50), zona] });
  return Boolean(result.recordset[0]?.valida);
}

const mismoTelefono = (a, b) => normalizePhone(a) === normalizePhone(b);

// Texto libre que el propio Cliente escribe sobre su negocio (horarios, políticas,
// cómo quiere que hable el bot, etc.) — claudeService.buildSystemPrompt() en
// Bot_Mensajeria lo suma a las instrucciones generales antes de cada respuesta, así
// que el cambio se aplica al toque, sin redeploy.
async function obtenerContexto(id) {
  return (await leerCliente(id))?.contextoNegocio ?? '';
}

async function actualizarContexto(id, contextoNegocio) {
  await setCampo(id, 'contextoNegocio', { texto: contextoNegocio || null });
}

// Número (solo dígitos) al que Bot_Mensajeria avisa por WhatsApp cuando un chat
// pasa a revisión humana (revisionService.alertar).
async function obtenerTelefonoAlertas(id) {
  return (await leerCliente(id))?.telefonoAlertas ?? null;
}

async function setTelefonoAlertas(id, telefono) {
  await setCampo(id, 'telefonoAlertas', { texto: telefono });
}

// Config de los avisos automáticos (JSON crudo: lo valida avisoService).
async function obtenerAvisosConfig(id) {
  return (await leerCliente(id))?.avisosConfig ?? null;
}

async function setAvisosConfig(id, json) {
  await setCampo(id, 'avisosConfig', { texto: json });
}

// No borramos de verdad: desactivar preserva el historial (Mensajes, Pedidos,
// Escalamientos) y ya corta el acceso del bot y del portal, porque ambos
// filtran por Clientes.activo = 1.
async function desactivarCliente(id) {
  await setCampo(id, 'activo', { bit: false });
}

async function activarCliente(id) {
  await setCampo(id, 'activo', { bit: true });
}

module.exports = {
  listarClientes,
  listarClientesActivos,
  obtenerCliente,
  setBotGeneral,
  setBotChatsNuevos,
  crearCliente,
  actualizarCliente,
  obtenerContexto,
  actualizarContexto,
  obtenerTelefonoAlertas,
  setTelefonoAlertas,
  obtenerAvisosConfig,
  setAvisosConfig,
  desactivarCliente,
  activarCliente,
  zonaHorariaValida,
  mismoTelefono,
};
