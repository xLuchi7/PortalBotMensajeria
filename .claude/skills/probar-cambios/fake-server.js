// Levanta el index.js real del portal con todos los servicios de datos
// reemplazados por versiones en memoria (nunca toca la base real).
// Uso: node fake-server.js <ruta-del-repo>
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const root = process.argv[2];

process.env.SESSION_SECRET = 'test-secret-1234567890';
process.env.PORT = '3197';
process.env.DB_SERVER = 'fake';
process.env.BOT_URL = 'http://fake-bot';
process.env.BOT_API_TOKEN = 'x';

function stub(rel, exports) {
  const file = path.resolve(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}

// ── Estado en memoria ────────────────────────────────────────────────────────
const clientes = [
  { id: 1, razonSocial: 'Cliente de Prueba', cuit: '20123456789', telefono: '59899111222', email: 'prueba@test.com', activo: true, zonaHoraria: 'Montevideo Standard Time', botActivo: true, botChatsNuevosActivo: true, contexto: 'Somos una tienda de ropa.' },
  { id: 2, razonSocial: 'Luma Uruguay', cuit: '20999888777', telefono: '59899333444', email: null, activo: true, zonaHoraria: 'Montevideo Standard Time', botActivo: false, botChatsNuevosActivo: false, contexto: '' },
];
const usuarios = [
  { id: 1, email: 'admin@test.com', password: 'admin', rol: 'admin', clienteId: null, activo: true },
  { id: 2, email: 'cliente@test.com', password: 'cliente', rol: 'cliente', clienteId: 1, activo: true },
];
let msgId = 100;
const mensajes = []; // { id, clienteId, userId, role, content, enviadoPor, esError, at }
const chatsMeta = new Map(); // `${clienteId}|${userId}` → { botActivo, nombre, nombrePerfil, por }
function addMsg(clienteId, userId, role, content, enviadoPor = null, minutosAtras = 0) {
  mensajes.push({ id: ++msgId, clienteId, userId, role, content, enviadoPor, esError: false, at: new Date(Date.now() - minutosAtras * 60000) });
}
addMsg(1, '5491132101982', 'user', 'Hola!! estaba buscando productos', null, 30);
addMsg(1, '5491132101982', 'assistant', '¡Hola! Qué bueno. ¿Qué producto estás buscando?', null, 29);
addMsg(1, '5491132101982', 'user', 'Hola test, todo bien?', null, 10);
addMsg(1, '5491132101982', 'assistant', 'Todo bien, gracias! Decime qué producto buscás.', null, 9);
addMsg(1, '5491128773915', 'user', 'Hola', null, 60);
addMsg(1, '5491128773915', 'user', '¿Hacen envíos a Córdoba?', null, 59);
addMsg(1, '5491128773915', 'assistant', 'Sí, enviamos por Andreani, tarda de 3 a 5 días hábiles.', 'admin@test.com', 58);
addMsg(1, '59894422029', 'user', 'Gracias', null, 60 * 26);
addMsg(1, '59894422029', 'assistant', '¡De nada! Que tengas buen día.', null, 60 * 26);
addMsg(1, '59898970017', 'user', 'Me llegó roto', null, 60 * 25);
addMsg(1, '59898970017', 'assistant', 'Ya quedó registrado tu caso. En breve te contactan.', null, 60 * 25);
chatsMeta.set('1|5491132101982', { botActivo: true, nombre: 'Luciano', nombrePerfil: 'Luchi Sessarego' });
chatsMeta.set('1|5491128773915', { botActivo: false, nombre: null, nombrePerfil: 'Patricio Sessarego', por: 'admin@test.com' });

const pedidos = [
  { id: 11, clienteId: 1, userId: '5491132101982', estado: 'pendiente', total: 2500, notas: 'PEDIDO DE PRUEBA SHOPIFY', shopifyOrderId: null, shopifyEstado: null },
  { id: 10, clienteId: 1, userId: '59894422029', estado: 'confirmado', total: 1200, notas: null, shopifyOrderId: 'gid://shopify/Order/555', shopifyOrderName: '#1001', shopifyEstado: 'enviado' },
  { id: 9, clienteId: 1, userId: '59898970017', estado: 'reclamado', total: 800, notas: null, shopifyOrderId: null, shopifyEstado: 'error', shopifyError: 'Variante sin stock' },
  { id: 8, clienteId: 1, userId: '59894422029', estado: 'entregado', total: 300, notas: 'Entregado en mano', shopifyOrderId: null, shopifyEstado: null },
];
// Fotos de prueba: SVG en data URL (no dependen de internet).
const foto = (color, texto) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/><text x="300" y="320" font-size="64" text-anchor="middle" fill="#fff" font-family="sans-serif">${texto}</text></svg>`)}`;
const articulos = [
  { id: 1, clienteId: 1, codigo: 'REM-001', nombre: 'Remera Básica - M', descripcion: 'Remera de algodón peinado.\nCorte regular.', precio: 1250, precioComparacion: 1500, activo: true, usaStock: true, stock: 8, origen: 'shopify', shopifyProductId: 'gid://shopify/Product/1',
    imagenes: [foto('#5b4cf0', 'Frente'), foto('#16a34a', 'Espalda'), foto('#d97706', 'Detalle')], marca: 'Luma', tipoProducto: 'Remeras', categoria: 'Ropa > Remeras',
    etiquetas: 'algodón, verano', colecciones: 'Novedades, Básicos', opciones: [{ nombre: 'Talle', valor: 'M' }], codigoBarras: '7790001', costo: 600, urlTienda: 'https://tienda.test/products/remera',
    shopifyActualizado: '2026-11-25T10:00:00Z', fechaAlta: '2026-11-01T10:00:00Z',
    shopifyDatos: { producto: { title: 'Remera Básica', handle: 'remera-basica', status: 'ACTIVE', publishedAt: '2026-11-02T10:00:00Z', createdAt: '2026-11-01T10:00:00Z', totalInventory: 20, tracksInventory: true, seo: { title: 'Remera Básica', description: 'La remera de siempre' }, options: [{ name: 'Talle', values: ['S', 'M', 'L'] }], metafields: [{ namespace: 'custom', key: 'material', value: 'Algodón 100%' }] }, variante: { title: 'M', inventoryPolicy: 'DENY', availableForSale: true, taxable: true, inventoryItem: { requiresShipping: true, countryCodeOfOrigin: 'UY', measurement: { weight: { value: 0.2, unit: 'KILOGRAMS' } } }, metafields: [] }, imagenes: [] } },
  { id: 2, clienteId: 1, codigo: null, nombre: 'Gorra', descripcion: '', precio: 900, activo: true, usaStock: true, stock: 0, origen: 'manual' },
  { id: 3, clienteId: 2, codigo: 'X1', nombre: 'Taza', descripcion: 'Taza blanca', precio: 500, activo: true, usaStock: true, stock: 4, origen: 'manual' },
  { id: 4, clienteId: 2, codigo: null, nombre: 'Envío', descripcion: '', precio: 300, activo: false, usaStock: false, stock: 0, origen: 'manual' },
];
const escalamientos = [
  { id: 1, clienteId: 1, userId: '59898970017', motivo: 'Producto llegó roto', estado: 'pendiente' },
  { id: 2, clienteId: 1, userId: '59894422029', motivo: 'Consulta de devolución', estado: 'resuelto' },
];
let conexion1 = { clienteId: 1, appId: 1, shopDomain: 'prueba-luchi.myshopify.com', nombreTienda: 'Prueba Luchi', moneda: 'UYU', estado: 'activa', ultimaSync: new Date(), ultimoError: null };

const fechaTxt = d => `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${d.toLocaleTimeString('es-AR', { hour12: false })}`;
const pag = (arr, page, size = 25) => ({ rows: arr.slice((page - 1) * size, page * size), total: arr.length, page, pageSize: size, totalPages: Math.max(1, Math.ceil(arr.length / size)) });
const numero = require(path.resolve(root, 'src/viewHelpers')).numero;
const contactoNombre = (c, u) => { const m = chatsMeta.get(`${c}|${u}`); return m ? (m.nombre || m.nombrePerfil) : null; };

class EstadoFinalError extends Error {}

// ── Servicios falsos ─────────────────────────────────────────────────────────
// Lo que no tiene stub propio y consulta la base recibe un resultado vacío (ej.
// avisoService.leerConfig, listarDePedido), en vez de romper con un 500.
const vacio = () => ({ recordset: [], recordsets: [[]], rowsAffected: [0] });
const requestFalso = () => { const r = { input: () => r, query: async () => vacio(), batch: async () => vacio(), execute: async () => vacio() }; return r; };
stub('src/services/db.js', { sql: require(path.resolve(root, 'node_modules/mssql')), getPool: async () => ({ request: requestFalso }), ejecutar: async () => vacio() });
// Sesiones en memoria (el real las guarda en la tabla Sesiones).
stub('src/services/sesionStore.js', require(path.resolve(root, 'node_modules/express-session')).MemoryStore);

let aprId = 0;
const aprendizajes = []; // { id, clienteId, pregunta, respuesta, activo, origenUserId, fecha, usuario }
stub('src/services/aprendizajeService.js', {
  TOPE_ACTIVOS: 3, MAX_PREGUNTA: 300, MAX_RESPUESTA: 1000, // tope bajo para probarlo
  async listar(clienteId) { return aprendizajes.filter(a => a.clienteId === clienteId).sort((a, b) => b.activo - a.activo || b.id - a.id); },
  async guardar(clienteId, { id, pregunta, respuesta, origenUserId }, usuario) {
    if (!id) {
      if (aprendizajes.filter(a => a.clienteId === clienteId && a.activo).length >= 3) return 'tope';
      aprendizajes.push({ id: ++aprId, clienteId, pregunta, respuesta, activo: true, origenUserId, fecha: fechaTxt(new Date()).slice(0, 17), usuario });
      return 'ok';
    }
    const a = aprendizajes.find(x => x.id === id && x.clienteId === clienteId);
    if (!a) return 'no_existe';
    Object.assign(a, { pregunta, respuesta, usuario });
    return 'ok';
  },
  async setActivo(clienteId, id, activo, usuario) {
    const a = aprendizajes.find(x => x.id === id && x.clienteId === clienteId);
    if (!a) return 'no_existe';
    if (activo && aprendizajes.filter(x => x.clienteId === clienteId && x.activo && x.id !== id).length >= 3) return 'tope';
    Object.assign(a, { activo, usuario });
    return 'ok';
  },
  async borrar(clienteId, id) {
    const i = aprendizajes.findIndex(x => x.id === id && x.clienteId === clienteId);
    if (i < 0) return false;
    aprendizajes.splice(i, 1);
    return true;
  },
});

stub('src/services/usuarioService.js', {
  PASSWORD_MIN: 10,
  async autenticar(email, password) {
    const u = usuarios.find(x => x.email === email && x.password === password && x.activo);
    if (!u) return null;
    const c = clientes.find(x => x.id === u.clienteId);
    return { id: u.id, clienteId: u.clienteId, email: u.email, rol: u.rol, razonSocial: c ? c.razonSocial : null, passwordCambiadaEn: u.passwordCambiadaEn ?? null };
  },
  // Lo que mira requireAuth: usuario borrado/inactivo, Cliente inactivo, contraseña cambiada.
  async estadoSesion(id) {
    const u = usuarios.find(x => x.id === id);
    if (!u) return null;
    const c = clientes.find(x => x.id === u.clienteId);
    return { id: u.id, email: u.email, rol: u.rol, clienteId: u.clienteId, razonSocial: c ? c.razonSocial : null,
      activo: Boolean(u.activo) && (!c || c.activo), passwordCambiadaEn: u.passwordCambiadaEn ?? null };
  },
  async listarUsuarios(page) { return pag(usuarios.map(u => ({ ...u, password: undefined, razonSocial: clientes.find(c => c.id === u.clienteId)?.razonSocial })), page); },
  async obtenerUsuario(id) { const u = usuarios.find(x => x.id === id); return u ? { id: u.id, email: u.email, rol: u.rol, clienteId: u.clienteId, activo: u.activo } : null; },
  async crearUsuario(d) { if (usuarios.some(u => u.email === d.email)) { const e = new Error('dup'); e.number = 2627; throw e; } usuarios.push({ id: usuarios.length + 1, activo: true, ...d }); },
  async actualizarUsuario(id, d) {
    const u = usuarios.find(x => x.id === id);
    Object.assign(u, { email: d.email, rol: d.rol, clienteId: d.clienteId }, d.password ? { password: d.password, passwordCambiadaEn: new Date().toISOString() } : {});
    return u.passwordCambiadaEn ?? null;
  },
  async borrarUsuario(id) { const i = usuarios.findIndex(x => x.id === id); if (i >= 0) usuarios.splice(i, 1); },
});

stub('src/services/clienteService.js', {
  async listarClientes(page) { return { ...pag(clientes, page), activos: clientes.filter(c => c.activo).length }; },
  async listarClientesActivos() { return clientes.filter(c => c.activo).map(c => ({ id: c.id, razonSocial: c.razonSocial })); },
  async obtenerCliente(id) { const c = clientes.find(x => x.id === Number(id)); if (!c) return null; const { contexto, ...resto } = c; return resto; },
  async setBotGeneral(id, a) { clientes.find(x => x.id === id).botActivo = a; },
  async setBotChatsNuevos(id, a) { clientes.find(x => x.id === id).botChatsNuevosActivo = a; },
  async crearCliente(d) { if (clientes.some(c => c.cuit === d.cuit)) { const e = new Error('dup'); e.number = 2627; throw e; } clientes.push({ id: clientes.length + 1, activo: true, botActivo: true, botChatsNuevosActivo: true, contexto: '', ...d }); },
  async actualizarCliente(id, d) { Object.assign(clientes.find(x => x.id === Number(id)), d); },
  async obtenerContexto(id) { return clientes.find(x => x.id === id).contexto; },
  async actualizarContexto(id, t) { clientes.find(x => x.id === id).contexto = t; },
  async desactivarCliente(id) { clientes.find(x => x.id === Number(id)).activo = false; },
  async activarCliente(id) { clientes.find(x => x.id === Number(id)).activo = true; },
  async obtenerTelefonoAlertas(id) { return clientes.find(x => x.id === Number(id))?.telefonoAlertas ?? null; },
  async setTelefonoAlertas(id, t) { clientes.find(x => x.id === Number(id)).telefonoAlertas = t; },
  async zonaHorariaValida(z) { return typeof z === 'string' && /Standard Time$/.test(z); },
  mismoTelefono: (a, b) => String(a || '').replace(/\D/g, '') === String(b || '').replace(/\D/g, ''),
});

const ESTADOS = {
  reclamo: { label: 'Reclamo Abierto', clase: 'badge-danger' },
  pedido: { label: 'Pedido Realizado', clase: 'badge-success' },
  intencion: { label: 'Intención De Compra', clase: 'badge-info' },
  consulta: { label: 'Solo Consulta', clase: 'badge-neutral' },
};
function bandeja(clienteId) {
  const porUser = new Map();
  mensajes.filter(m => m.clienteId === clienteId).forEach(m => porUser.set(m.userId, [...(porUser.get(m.userId) || []), m]));
  return [...porUser.entries()].map(([userId, ms]) => {
    const u = ms[ms.length - 1];
    const meta = chatsMeta.get(`${clienteId}|${userId}`) || {};
    const estado = escalamientos.some(e => e.clienteId === clienteId && e.userId === userId && e.estado !== 'resuelto') ? 'reclamo'
      : pedidos.some(p => p.clienteId === clienteId && p.userId === userId) ? 'pedido' : 'consulta';
    const hoy = new Date().toDateString() === u.at.toDateString();
    return {
      userId, ultId: u.id, cantidad: ms.length, ultimoMensaje: u.content, ultimoRol: u.role, ultimoEsError: false, ultimoEnviadoPor: u.enviadoPor,
      botActivo: meta.botActivo !== false, nombre: meta.nombre || null, nombrePerfil: meta.nombrePerfil || null, estado,
      numero: numero(userId), nombreVisible: meta.nombre || meta.nombrePerfil || null,
      fechaCorta: hoy ? u.at.toTimeString().slice(0, 5) : 'Ayer', estadoInfo: ESTADOS[estado], _ms: ms, _meta: meta,
    };
  }).sort((a, b) => b.ultId - a.ultId);
}
stub('src/services/chatService.js', {
  ESTADOS,
  async listarChats(clienteId, { page = 1, q, estado, bot } = {}) {
    const todos = bandeja(clienteId);
    let rows = todos;
    if (q) rows = rows.filter(r => (r.nombreVisible || '').toLowerCase().includes(q.toLowerCase()) || r.userId.includes(q.replace(/\D/g, '') || '@@'));
    if (estado && ESTADOS[estado]) rows = rows.filter(r => r.estado === estado);
    if (bot === 'pausado') rows = rows.filter(r => !r.botActivo);
    const cuenta = k => todos.filter(r => r.estado === k).length;
    return {
      ...pag(rows.map(({ _ms, _meta, ...r }) => r), page),
      resumen: { total: todos.length, pausados: todos.filter(r => !r.botActivo).length, reclamo: cuenta('reclamo'), pedido: cuenta('pedido'), intencion: cuenta('intencion'), consulta: cuenta('consulta') },
      filtros: { q: q || '', estado: estado || '', bot: bot || '' },
    };
  },
  async obtenerChat(clienteId, userId) {
    const r = bandeja(clienteId).find(x => x.userId === userId);
    if (!r) return null;
    const ultCliente = [...r._ms].reverse().find(m => m.role === 'user');
    const minutos = ultCliente ? Math.floor((Date.now() - ultCliente.at) / 60000) : null;
    return {
      userId, cantidad: r.cantidad, platform: 'whatsapp', botActivo: r.botActivo, estado: r.estado, nombre: r.nombre, nombrePerfil: r.nombrePerfil,
      botActualizadoPor: r._meta.por || null, botActualizadoEn: r.botActivo ? null : '25/11/2026 12:00', minutosDesdeCliente: minutos,
      numero: r.numero, nombreVisible: r.nombreVisible, estadoInfo: r.estadoInfo,
      ventanaAbierta: minutos != null && minutos < 1440, ventanaRestante: minutos != null ? Math.max(0, 1440 - minutos) : 0,
      mensajes: r._ms.map(m => ({ id: m.id, role: m.role, content: m.content, esError: false, enviadoPor: m.enviadoPor, hora: m.at.toTimeString().slice(0, 5), dia: m.at.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) })),
    };
  },
  async setBotChat(clienteId, userId, activo, por) {
    if (!mensajes.some(m => m.clienteId === clienteId && m.userId === userId)) return false;
    const k = `${clienteId}|${userId}`; chatsMeta.set(k, { ...(chatsMeta.get(k) || {}), botActivo: activo, por }); return true;
  },
  async setNombreChat(clienteId, userId, nombre) {
    if (!mensajes.some(m => m.clienteId === clienteId && m.userId === userId)) return false;
    const k = `${clienteId}|${userId}`; chatsMeta.set(k, { botActivo: true, ...(chatsMeta.get(k) || {}), nombre: nombre || null }); return true;
  },
  async atenderRevision() { return true; },
  async huellaBandeja(clienteId) {
    const ms = mensajes.filter(m => m.clienteId === clienteId);
    const pausados = [...chatsMeta.entries()].filter(([k, v]) => k.startsWith(`${clienteId}|`) && v.botActivo === false).length;
    return `${ms.length ? Math.max(...ms.map(m => m.id)) : 0}-${pausados}`;
  },
});

// Contadores del menú (el resumen de Inicio sigue sin stub: esa página no se prueba acá).
stub('src/services/inicioService.js', {
  PERIODOS: [7, 30],
  async contadores(clienteId) {
    return {
      chats: [...chatsMeta.entries()].filter(([k, v]) => k.startsWith(`${clienteId}|`) && v.botActivo === false).length,
      escalamientos: escalamientos.filter(e => e.clienteId === clienteId && e.estado !== 'resuelto').length,
      pedidos: pedidos.filter(p => p.clienteId === clienteId && p.estado === 'pendiente').length,
      revision: 0,
      revisionChats: [],
    };
  },
  async resumen() { throw new Error('inicioService.resumen sin stub en fake-server'); },
});

// Alta de Clientes: sin esto se llamaba a la API real de Meta con el token del .env.
stub('src/services/metaService.js', {
  async suscribirClientePorTelefono(telefono) {
    if (String(telefono).replace(/\D/g, '').startsWith('000')) throw new Error('No encontramos ninguna Cuenta de WhatsApp Business con ese teléfono (fake).');
    return 'waba-fake';
  },
});

stub('src/services/botService.js', {
  envioHabilitado: () => true,
  async enviarMensaje({ clienteId, userId, texto, enviadoPor }) { addMsg(clienteId, userId, 'assistant', texto, enviadoPor); return { ok: true }; },
});

stub('src/services/escalamientoService.js', {
  ESTADOS: ['pendiente', 'en_proceso', 'resuelto'],
  async listarEscalamientos(clienteId, page) {
    const rows = escalamientos.filter(e => e.clienteId === clienteId).map(e => ({ ...e, fecha: fechaTxt(new Date()), contactoNombre: contactoNombre(clienteId, e.userId) }));
    return { ...pag(rows, page), pendientes: rows.filter(e => e.estado !== 'resuelto').length };
  },
  async actualizarEstado(id, clienteId, estado) {
    const e = escalamientos.find(x => x.id === Number(id) && x.clienteId === clienteId);
    if (!e) return 'no_existe';
    if (e.estado === 'resuelto') return 'final';
    e.estado = estado;
    return 'ok';
  },
});

stub('src/services/pedidoService.js', {
  ESTADOS_ELEGIBLES: ['pendiente', 'confirmado', 'entregado', 'cancelado', 'solucionado'],
  async listarPedidos(clienteId, page) {
    const rows = pedidos.filter(p => p.clienteId === clienteId).map(p => ({ ...p, fecha: fechaTxt(new Date()), contactoNombre: contactoNombre(clienteId, p.userId) }));
    return { ...pag(rows, page), totalMonto: rows.reduce((a, p) => a + p.total, 0), pendientes: rows.filter(p => p.estado === 'pendiente').length, reclamados: rows.filter(p => p.estado === 'reclamado').length };
  },
  async obtenerDetalle(id) { return [{ nombre: 'Remera Básica - M', cantidad: 1, precioUnitario: 1250, subtotal: 1250 }, { nombre: 'Gorra', cantidad: 1, precioUnitario: 1250, subtotal: 1250 }].slice(0, Number(id) % 2 ? 2 : 1); },
  async actualizarEstado(id, clienteId, estado) {
    const p = pedidos.find(x => x.id === Number(id) && x.clienteId === clienteId);
    if (!p) return 'no_existe';
    if (p.estado === 'reclamado') { if (estado !== 'solucionado') return 'solo_solucionado'; p.estado = estado; return 'ok'; }
    if (['entregado', 'cancelado', 'solucionado'].includes(p.estado)) return 'final';
    if (estado === 'solucionado') return 'invalido';
    p.estado = estado;
    return 'ok';
  },
  async actualizarNotas(id, clienteId, notas) { pedidos.find(x => x.id === Number(id)).notas = notas || null; },
});

stub('src/services/articuloService.js', {
  async listarArticulos(clienteId, { page = 1, q = '', estado = '' } = {}) {
    const todos = articulos.filter(a => a.clienteId === clienteId);
    const filtros = { activos: a => a.activo, inactivos: a => !a.activo, agotados: a => a.activo && a.usaStock && a.stock <= 0, sinFoto: a => a.activo && !a.imagenes?.length };
    const rows = todos
      .filter(a => !q || q.toLowerCase().split(/\s+/).every(p => [a.nombre, a.codigo, a.marca, a.etiquetas].join(' ').toLowerCase().includes(p)))
      .filter(filtros[estado] || (() => true))
      .map(a => ({ imagenes: [], opciones: [], ...a }));
    return { ...pag(rows, page), total: todos.length, filtrados: rows.length, activos: todos.filter(a => a.activo).length,
      agotados: todos.filter(filtros.agotados).length, conFoto: todos.filter(a => a.activo && a.imagenes?.length).length };
  },
  async obtenerDetalle(id, clienteId) { const a = articulos.find(x => x.id === Number(id) && x.clienteId === clienteId); return a ? { imagenes: [], opciones: [], shopifyDatos: null, ...a } : null; },
  async obtenerArticulo(id, clienteId) { return articulos.find(a => a.id === Number(id) && a.clienteId === clienteId) || null; },
  async crearArticulo(clienteId, d) { articulos.push({ id: articulos.length + 1, clienteId, activo: true, origen: 'manual', stock: Number(d.cantidadInicial) || 0, ...d, precio: Number(d.precio) }); },
  async actualizarArticulo(id, clienteId, d) { Object.assign(articulos.find(a => a.id === Number(id)), d, { precio: Number(d.precio) }); },
  async actualizarStock(id, clienteId, c) { articulos.find(a => a.id === Number(id)).stock = Number(c); },
  async desactivarArticulo(id) { articulos.find(a => a.id === Number(id)).activo = false; },
  async activarArticulo(id) { articulos.find(a => a.id === Number(id)).activo = true; },
});

stub('src/services/consultaService.js', {
  async listarConsultas(clienteId, page) {
    const rows = [
      { id: 1, tipo: 'articulo', userId: '5491132101982', detalle: 'remera', articuloNombre: 'Remera Básica - M', sinStock: false },
      { id: 2, tipo: 'articulo', userId: '59894422029', detalle: 'zapatillas', articuloNombre: null, sinStock: false },
      { id: 3, tipo: 'articulo', userId: '59894422029', detalle: 'gorra', articuloNombre: 'Gorra', sinStock: true },
      { id: 4, tipo: 'pedido', userId: '59898970017', pedidoId: 9, pedidoEstado: 'reclamado' },
    ].map(c => ({ ...c, fecha: fechaTxt(new Date()), contactoNombre: contactoNombre(clienteId, c.userId) }));
    return { ...pag(rows, page), sinStock: 1 };
  },
});

const jobs = new Map();
stub('src/services/importService.js', {
  enCurso: () => null,
  async leerFilas(buf) { if (buf.length < 10) throw new Error('El archivo no es un Excel válido.'); return [1, 2, 3, 4, 5]; },
  crearJob(clienteId, filas) {
    const id = crypto.randomUUID(); const job = { clienteId, total: filas.length, procesado: 0, exitosos: 0, errores: 0, terminado: false }; jobs.set(id, job);
    const t = setInterval(() => { job.procesado++; if (job.procesado === 3) job.errores++; else job.exitosos++; if (job.procesado >= job.total) { job.terminado = true; clearInterval(t); } }, 300);
    return id;
  },
  obtenerEstado(id, clienteId) { const j = jobs.get(id); if (!j || j.clienteId !== clienteId) return null; return { total: j.total, procesado: j.procesado, terminado: j.terminado, exitosos: j.exitosos, erroresCount: j.errores, errorFatal: null }; },
  async generarExcelErrores() { return Buffer.from('fake-xlsx'); },
});

stub('src/services/shopifyClient.js', {
  async obtenerConexion(clienteId) { return clienteId === 1 ? conexion1 : null; },
  async obtenerConexionActiva(clienteId) { return clienteId === 1 && conexion1 && conexion1.estado !== 'desinstalada' ? conexion1 : null; },
  async obtenerConexionPorShop(shop) { return conexion1 && conexion1.shopDomain === shop ? conexion1 : null; },
  async eliminarConexion() { conexion1 = null; },
});
stub('src/services/shopifyAppService.js', {
  async obtenerAppDeCliente(clienteId) { return clienteId === 1 ? { id: 1, clienteId: 1, clientId: 'abcdef1234567890abcd', clientSecret: 'secret', secretIlegible: false } : null; },
  async obtenerApp() { return { id: 1, clienteId: 1, clientId: 'abcdef1234567890abcd', clientSecret: 'secret' }; },
  async guardarApp() {},
});
const realOAuth = { normalizarShop: s => { let v = String(s || '').trim().toLowerCase(); if (!v.includes('.')) v += '.myshopify.com'; return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(v) ? v : null; } };
stub('src/services/shopifyOAuthService.js', {
  ...realOAuth,
  esShopValido: s => Boolean(realOAuth.normalizarShop(s)),
  crearState: () => 'state',
  leerState: () => null,
  urlAutorizacion: ({ shop }) => `https://${shop}/admin/oauth/authorize?fake=1`,
  async borrarWebhooks() {},
  async appQueFirmo() { return null; },
});
const syncJobs = new Map();
stub('src/services/shopifySyncService.js', {
  async resumen() { return { articulosShopify: 1, pedidosEnviados: 1, pedidosConError: 1, articulosManuales: 1 }; },
  crearJobSync(clienteId) {
    const id = crypto.randomUUID(); const j = { clienteId, total: 4, procesado: 0, terminado: false, creados: 1, actualizados: 3, desactivados: 0, erroresCount: 0, errores: [] }; syncJobs.set(id, j);
    const t = setInterval(() => { j.procesado++; if (j.procesado >= j.total) { j.terminado = true; clearInterval(t); } }, 250);
    return id;
  },
  obtenerEstadoSync(id, clienteId) { const j = syncJobs.get(id); return j && j.clienteId === clienteId ? j : null; },
  iniciarSyncPeriodica() {},
});
stub('src/services/shopifyOrderService.js', {
  async alCambiarEstado(id, clienteId, estado) {
    const p = pedidos.find(x => x.id === id);
    if (estado === 'confirmado') { p.shopifyOrderId = 'gid://shopify/Order/777'; p.shopifyOrderName = '#1002'; p.shopifyEstado = 'enviado'; return { enviado: true, orderName: '#1002' }; }
    if (estado === 'cancelado' && p.shopifyOrderId) { p.shopifyEstado = 'cancelado'; return { cancelado: true }; }
    return { omitido: true };
  },
  async enviarPedido(id) { const p = pedidos.find(x => x.id === id); return p.shopifyOrderId ? { omitido: true, yaEnviado: true } : { error: 'Sigue sin stock' }; },
});
stub('src/services/shopifyWebhookService.js', { handler: (req, res) => res.sendStatus(200), verificarFirma: () => true });

// ── Control para las pruebas: simular un mensaje entrante ────────────────────
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/inject') {
    const cliente = Number(u.searchParams.get('cliente') || 1);
    addMsg(cliente, u.searchParams.get('user'), 'user', u.searchParams.get('texto'));
    require(path.resolve(root, 'src/services/eventosService')).emitir(cliente, 'mensaje', { userId: u.searchParams.get('user') });
    return res.end('ok');
  }
  res.statusCode = 404; res.end();
}).listen(3198);

process.chdir(root);
require(path.resolve(root, 'index.js'));
