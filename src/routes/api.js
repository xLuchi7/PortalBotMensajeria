// API JSON del portal: la usa el frontend en React (client/). Cada ruta hace lo
// mismo que hacía la página EJS equivalente; en vez de redirect + toast,
// responde { ok, tipo, mensaje } y el frontend muestra el toast.
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { requireAuth, requireAdmin, resolveClienteAccess } = require('../middleware/requireAuth');
const usuarios = require('../services/usuarioService');
const chats = require('../services/chatService');
const bot = require('../services/botService');
const escalamientos = require('../services/escalamientoService');
const pedidos = require('../services/pedidoService');
const clientes = require('../services/clienteService');
const meta = require('../services/metaService');
const articulos = require('../services/articuloService');
const consultas = require('../services/consultaService');
const inicio = require('../services/inicioService');
const importacion = require('../services/importService');
const shopify = require('../services/shopifyClient');
const shopifyApps = require('../services/shopifyAppService');
const shopifyOAuth = require('../services/shopifyOAuthService');
const shopifySync = require('../services/shopifySyncService');
const shopifyOrders = require('../services/shopifyOrderService');
const avisos = require('../services/avisoService');
const logs = require('../services/logService');
const eventos = require('../services/eventosService');
const aprendizajes = require('../services/aprendizajeService');
const linksCompra = require('../services/linkCompraService');
const dashboard = require('../services/dashboardService');
const metaAds = require('../services/metaAdsService');
const mercadoPago = require('../services/mercadoPagoService');
const oauthState = require('../services/oauthStateService');
const { descifrar } = require('../services/cryptoService');
const { crearLimite } = require('../services/limiteService');
const { memo } = require('../services/cacheCorto');

// Huella de la bandeja: la piden todas las pantallas de chats con cada aviso.
const huellaDe = clienteId => memo(clienteId, 'huella', () => chats.huellaBandeja(clienteId));
const { invalidar: invalidarSesiones } = require('../middleware/requireAuth');

const ES_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const router = express.Router();

// Logs de la API:
// - Todo lo que se loguee durante un request (incluidos los console.error de
//   cualquier servicio) queda con el Cliente, el chat y el usuario del request.
// - Cada request queda registrado con método, ruta, status, duración, IP y (en
//   POST/PUT/DELETE) el body, sin contraseñas ni tokens. Los GET solo si fallan
//   o tardan más de GET_LENTO_MS; los de SIN_LOG (automáticos), nunca.
const GET_LENTO_MS = 1000;
const SIN_LOG = /^\/(sesion|logs|clientes\/\d+\/(contadores|eventos|chats\/novedades|importar\/[^/]+|shopify\/sync\/[^/]+))$/;
const CAMPOS_SECRETOS = /pass|contrase|token|secret|clave|apikey|api_key/i;

// Redacta en cualquier nivel (ej. { app: { clientSecret } }), no solo arriba.
function limpiarParaLog(v, nivel = 0) {
  if (typeof v === 'string') return v.length > 2000 ? `${v.slice(0, 2000)}…` : v;
  if (!v || typeof v !== 'object') return v;
  if (nivel > 4) return '…';
  if (Array.isArray(v)) return v.slice(0, 50).map(x => limpiarParaLog(x, nivel + 1));
  const limpio = {};
  for (const [k, x] of Object.entries(v)) limpio[k] = CAMPOS_SECRETOS.test(k) ? '***' : limpiarParaLog(x, nivel + 1);
  return limpio;
}

function bodyParaLog(body) {
  if (!body || typeof body !== 'object' || !Object.keys(body).length) return undefined;
  return limpiarParaLog(body);
}

router.use((req, res, next) => {
  const ruta = req.path;
  logs.conContexto({
    get clienteId() { return req.clienteId ?? (parseInt(/^\/clientes\/(\d+)/.exec(ruta)?.[1], 10) || null); },
    get userId() {
      const m = /\/chats\/([^/]+)/.exec(ruta);
      if (!m || m[1] === 'novedades') return null;
      try { return decodeURIComponent(m[1]); } catch { return null; }
    },
    get usuario() { return req.session?.usuario?.email ?? null; },
  }, () => {
    if (req.method !== 'GET' || !SIN_LOG.test(ruta)) {
      const inicio = Date.now();
      res.on('finish', () => {
        // Los avisos del bot (uno por mensaje) solo se loguean si fallan.
        if (ruta === '/interno/eventos' && res.statusCode < 400) return;
        // Con el tiempo real, cada mensaje hace que cada pestaña vuelva a pedir sus
        // datos: los GET que salieron bien y rápido no se guardan (solo errores o lentos).
        if (req.method === 'GET' && res.statusCode < 400 && Date.now() - inicio < GET_LENTO_MS) return;
        const nivel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logs.registrar(nivel, `api_${req.method.toLowerCase()}`, {
          duracionMs: Date.now() - inicio,
          detalle: {
            ruta: req.originalUrl,
            status: res.statusCode,
            ip: req.ip,
            navegador: req.get('user-agent')?.slice(0, 200) ?? null,
            body: req.method === 'GET' ? undefined : bodyParaLog(req.body),
            archivo: req.file ? { nombre: req.file.originalname, bytes: req.file.size } : undefined,
          },
        });
      });
    }
    next();
  });
});
// CSRF: todo lo que cambia algo (no GET) tiene que venir del propio frontend.
// - X-Requested-With: lo agrega api() del cliente; otro sitio no puede mandarlo
//   sin permiso CORS (que no damos).
// - Sec-Fetch-Site (lo mandan los navegadores): si dice que viene de otro sitio, no.
// /interno/eventos queda afuera: lo llama el bot con su token, no un navegador.
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || req.path === '/interno/eventos') return next();
  const sitio = req.get('sec-fetch-site');
  if (!req.get('x-requested-with') || (sitio && sitio !== 'same-origin' && sitio !== 'none')) {
    logs.warn('csrf_rechazado', { detalle: { ruta: req.originalUrl, ip: req.ip, origen: req.get('origin') ?? null, sitio: sitio ?? null } });
    return res.status(403).json({ ok: false, tipo: 'warning', mensaje: 'Pedido Rechazado: Recargá La Página' });
  }
  next();
});

// Todos los :id de la API son enteros: cualquier otra cosa es 404 (antes llegaba
// a SQL como texto y terminaba en un 500).
router.param('id', (req, res, next, id) => {
  if (!/^\d{1,10}$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) return res.status(404).json({ ok: false, tipo: 'warning', mensaje: 'No Encontrado' });
  next();
});

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
  fileFilter: (req, file, cb) => {
    if (/\.xlsx$/i.test(file.originalname)) return cb(null, true);
    const err = new Error('Tipo de archivo inválido');
    err.code = 'TIPO_INVALIDO';
    cb(err);
  },
});

// Envuelve un handler async: cualquier error inesperado termina en el handler
// de errores de abajo (500 + mensaje genérico).
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const ok = (res, mensaje, extra = {}) => res.json({ ok: true, tipo: 'success', mensaje, ...extra });
const aviso = (res, mensaje, extra = {}) => res.json({ ok: true, tipo: 'warning', mensaje, ...extra });
const falla = (res, status, mensaje, extra = {}) => res.status(status).json({ ok: false, tipo: 'warning', mensaje, ...extra });

function paginaDe(req) {
  return Math.max(1, parseInt(req.query.page, 10) || 1);
}

function texto(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

const esDuplicado = err => err && (err.number === 2627 || err.number === 2601);

// ── Sesión ──────────────────────────────────────────────────────────────────

// Lo primero que pide el frontend: quién está logueado y el toast pendiente
// (los que deja el flujo de Shopify antes de volver al portal).
router.get('/sesion', (req, res) => {
  const flash = req.session.flash || null;
  delete req.session.flash;
  res.set('Cache-Control', 'no-store');
  res.json({
    usuario: req.session.usuario || null,
    flash,
    shopifyPendiente: Boolean(req.session.shopifyPendiente),
  });
});

// Fuerza bruta: se cuentan los intentos fallidos por IP y por email (15 min).
const fallosPorIp = crearLimite({ max: 10, ventanaMs: 15 * 60 * 1000 });
const fallosPorEmail = crearLimite({ max: 5, ventanaMs: 15 * 60 * 1000 });

router.post('/login', h(async (req, res) => {
  const body = req.body ?? {};
  const email = texto(body.email, 200).trim().toLowerCase();
  const password = texto(body.password, 200);
  if (!email || !password) return falla(res, 400, 'Completá Email Y Contraseña');

  const claveIp = req.ip || 'sin-ip';
  if (fallosPorIp.bloqueado(claveIp) || fallosPorEmail.bloqueado(email)) {
    const minutos = Math.max(fallosPorIp.minutosRestantes(claveIp), fallosPorEmail.minutosRestantes(email));
    logs.warn('login_bloqueado', { detalle: { ip: req.ip, email: ES_EMAIL.test(email) ? email : '(no es un email)' } });
    return falla(res, 429, `Demasiados Intentos: Probá De Nuevo En ${minutos} ${minutos === 1 ? 'Minuto' : 'Minutos'}`);
  }

  try {
    const usuario = await usuarios.autenticar(email, password);
    if (!usuario) {
      fallosPorIp.sumar(claveIp);
      fallosPorEmail.sumar(email);
      // A veces se tipea la contraseña en el campo del email: solo se loguea si parece un email.
      logs.warn('login_fallido', { usuario: ES_EMAIL.test(email) ? email : '(no es un email)', detalle: { ip: req.ip } });
      return falla(res, 401, 'Email o contraseña incorrectos.');
    }
    fallosPorEmail.limpiar(email);
    logs.info('login', { usuario: usuario.email, clienteId: usuario.clienteId ?? null, detalle: { rol: usuario.rol, ip: req.ip } });
    // Sesión nueva al loguearse (evita fijación de sesión); se conserva la
    // tienda de Shopify pendiente si vino desde el link de instalación.
    const shopifyPendiente = req.session.shopifyPendiente;
    const { passwordCambiadaEn, ...datosUsuario } = usuario;
    req.session.regenerate(err => {
      if (err) return falla(res, 500, 'Ocurrió un error, probá de nuevo.');
      req.session.usuario = datosUsuario;
      req.session.passwordMarca = passwordCambiadaEn; // si cambia, requireAuth corta la sesión
      if (shopifyPendiente) req.session.shopifyPendiente = shopifyPendiente;
      res.json({ ok: true, usuario: datosUsuario, shopifyPendiente: Boolean(shopifyPendiente) });
    });
  } catch (err) {
    console.error('[auth] Error al autenticar:', err.message);
    falla(res, 500, 'Ocurrió un error, probá de nuevo.');
  }
}));

router.post('/logout', (req, res) => {
  if (req.session.usuario) logs.info('logout', { usuario: req.session.usuario.email });
  req.session.destroy(() => {
    res.clearCookie(config.sessionCookie);
    res.json({ ok: true });
  });
});

// ── Tiempo real (eventos) ───────────────────────────────────────────────────

// Bot_Mensajeria avisa acá cuando escribe algo en la base (mensaje nuevo,
// reclamo, pedido, revisión humana) y el portal se lo pasa a las pestañas
// abiertas de ese Cliente. Usa el mismo token compartido que /portal/* del bot.
function tokenDelBot(req) {
  const esperado = config.bot.apiToken;
  const recibido = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!esperado || !recibido) return false;
  const a = Buffer.from(esperado);
  const b = Buffer.from(recibido);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/interno/eventos', (req, res) => {
  if (!config.bot.apiToken) return falla(res, 503, 'Falta Configurar BOT_API_TOKEN');
  if (!tokenDelBot(req)) return falla(res, 401, 'No Autorizado');
  const clienteId = parseInt(req.body?.clienteId, 10);
  const tipo = req.body?.tipo;
  if (!clienteId || !eventos.TIPOS.has(tipo)) return falla(res, 400, 'Evento Inválido');
  const userId = typeof req.body.userId === 'string' ? req.body.userId.slice(0, 100) : undefined;
  eventos.emitir(clienteId, tipo, { userId });
  res.json({ ok: true });
});

// De acá para abajo todo requiere login.
router.use(requireAuth);

// Cambios hechos desde el portal: se avisan a las otras pestañas y usuarios del
// mismo Cliente (lo que escribe el bot lo avisa el bot).
const EVENTO_POR_SECCION = { chats: 'chat', escalamientos: 'escalamiento', 'humano-solicitado': 'revision', pedidos: 'pedido' };
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const m = /^\/clientes\/(\d+)\/([^/]+)(?:\/([^/]+))?/.exec(req.path);
  const tipo = m && EVENTO_POR_SECCION[m[2]];
  if (tipo) {
    const conUsuario = m[2] === 'chats' || m[2] === 'humano-solicitado';
    let userId;
    try { userId = conUsuario && m[3] ? decodeURIComponent(m[3]) : undefined; } catch { /* path mal armado */ }
    res.on('finish', () => { if (res.statusCode < 400) eventos.emitir(m[1], tipo, { userId }); });
  }
  next();
});

// El navegador queda escuchando acá (EventSource). Ver eventosService.
router.get('/clientes/:clienteId/eventos', resolveClienteAccess, (req, res) => {
  eventos.suscribir(req.clienteId, req, res);
});

// ── Admin: Clientes ─────────────────────────────────────────────────────────

router.get('/clientes', requireAdmin, h(async (req, res) => {
  res.json(await clientes.listarClientes(paginaDe(req)));
}));

function datosCliente(body) {
  return {
    razonSocial: texto(body.razonSocial, 200).trim(),
    cuit: texto(body.cuit, 20).trim(),
    telefono: texto(body.telefono, 30).trim(),
    email: texto(body.email, 200).trim(),
    zonaHoraria: texto(body.zonaHoraria, 100) || 'Argentina Standard Time',
  };
}

router.post('/clientes', requireAdmin, h(async (req, res) => {
  const datos = datosCliente(req.body ?? {});
  if (!datos.razonSocial || !datos.cuit || !datos.telefono) return falla(res, 400, 'Completá Razón Social, CUIT Y Teléfono');
  if (!(await clientes.zonaHorariaValida(datos.zonaHoraria))) return falla(res, 400, 'Zona Horaria Inválida');

  // Antes de crear el Cliente, buscamos su WABA entre las compartidas con el Tech
  // Provider y la suscribimos — si esto falla no creamos el Cliente, porque sin la
  // suscripción el bot nunca va a recibir sus mensajes (ver historial con Luma Uruguay).
  let wabaId;
  try {
    wabaId = await meta.suscribirClientePorTelefono(datos.telefono);
  } catch (err) {
    return falla(res, 400, err.message);
  }

  try {
    await clientes.crearCliente({ ...datos, wabaId });
  } catch (err) {
    if (esDuplicado(err)) return falla(res, 409, 'Ya existe un Cliente con ese CUIT o teléfono.');
    throw err;
  }
  ok(res, 'Cliente Creado Correctamente');
}));

// Datos del Cliente: los usa el menú (nombre, estado del bot) y el form de edición.
router.get('/clientes/:clienteId', resolveClienteAccess, h(async (req, res) => {
  const cliente = await clientes.obtenerCliente(req.clienteId);
  if (!cliente) return falla(res, 404, 'Cliente No Encontrado');
  res.json({ cliente });
}));

// Inicio: resumen de los últimos 7 o 30 días, lo que necesita atención y la actividad reciente.
router.get('/clientes/:clienteId/contadores', resolveClienteAccess, h(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await memo(req.clienteId, 'contadores', () => inicio.contadores(req.clienteId)));
}));

router.get('/clientes/:clienteId/inicio', resolveClienteAccess, h(async (req, res) => {
  const dias = parseInt(req.query.dias, 10) || 7;
  res.json(await memo(req.clienteId, `inicio:${dias}`, () => inicio.resumen(req.clienteId, dias)));
}));

router.put('/clientes/:clienteId', requireAdmin, resolveClienteAccess, h(async (req, res) => {
  const datos = datosCliente(req.body ?? {});
  if (!datos.razonSocial || !datos.cuit || !datos.telefono) return falla(res, 400, 'Completá Razón Social, CUIT Y Teléfono');
  if (!(await clientes.zonaHorariaValida(datos.zonaHoraria))) return falla(res, 400, 'Zona Horaria Inválida');
  const actual = await clientes.obtenerCliente(req.clienteId);
  if (!actual) return falla(res, 404, 'Cliente No Encontrado');

  // Teléfono nuevo: hay que encontrar y suscribir su WABA, igual que al crear el
  // Cliente; si no, el bot deja de recibir los mensajes de ese número.
  let wabaId = null;
  if (!clientes.mismoTelefono(actual.telefono, datos.telefono)) {
    try {
      wabaId = await meta.suscribirClientePorTelefono(datos.telefono);
    } catch (err) {
      return falla(res, 400, err.message);
    }
  }

  try {
    await clientes.actualizarCliente(req.clienteId, { ...datos, wabaId });
  } catch (err) {
    if (esDuplicado(err)) return falla(res, 409, 'Ya existe otro Cliente con ese CUIT o teléfono.');
    throw err;
  }
  ok(res, 'Cliente Actualizado Correctamente');
}));

router.post('/clientes/:clienteId/desactivar', requireAdmin, resolveClienteAccess, h(async (req, res) => {
  await clientes.desactivarCliente(req.clienteId);
  // Los usuarios de ese Cliente quedan afuera ya, no cuando venza su sesión.
  invalidarSesiones();
  eventos.cerrarCliente(req.clienteId);
  ok(res, 'Cliente Desactivado');
}));

router.post('/clientes/:clienteId/activar', requireAdmin, resolveClienteAccess, h(async (req, res) => {
  await clientes.activarCliente(req.clienteId);
  invalidarSesiones();
  ok(res, 'Cliente Reactivado');
}));

// ── Admin: Usuarios ─────────────────────────────────────────────────────────

router.get('/usuarios', requireAdmin, h(async (req, res) => {
  res.json(await usuarios.listarUsuarios(paginaDe(req)));
}));

router.get('/usuarios/clientes-activos', requireAdmin, h(async (req, res) => {
  res.json({ clientes: await clientes.listarClientesActivos() });
}));

router.get('/usuarios/:id', requireAdmin, h(async (req, res) => {
  const usuario = await usuarios.obtenerUsuario(parseInt(req.params.id, 10) || 0);
  if (!usuario) return falla(res, 404, 'Usuario No Encontrado');
  res.json({ usuario });
}));

function datosUsuario(body) {
  const rol = body.rol === 'admin' ? 'admin' : 'cliente';
  return {
    email: texto(body.email, 200).trim(),
    password: texto(body.password, 200),
    rol,
    clienteId: rol === 'admin' ? null : parseInt(body.clienteId, 10) || null,
  };
}

const PASSWORD_CORTA = `La Contraseña Tiene Que Tener Al Menos ${usuarios.PASSWORD_MIN} Caracteres`;

router.post('/usuarios', requireAdmin, h(async (req, res) => {
  const datos = datosUsuario(req.body ?? {});
  if (!datos.email || !datos.password) return falla(res, 400, 'Completá Email Y Contraseña');
  if (!ES_EMAIL.test(datos.email)) return falla(res, 400, 'Revisá El Email');
  if (datos.password.length < usuarios.PASSWORD_MIN) return falla(res, 400, PASSWORD_CORTA);
  if (datos.rol === 'cliente' && !datos.clienteId) return falla(res, 400, 'Elegí El Cliente Del Usuario');
  try {
    await usuarios.crearUsuario(datos);
  } catch (err) {
    if (esDuplicado(err)) return falla(res, 409, 'Ya existe un usuario con ese email.');
    throw err;
  }
  ok(res, 'Usuario Creado Correctamente');
}));

router.put('/usuarios/:id', requireAdmin, h(async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const datos = datosUsuario(req.body ?? {});
  if (!datos.email) return falla(res, 400, 'Completá El Email');
  if (!ES_EMAIL.test(datos.email)) return falla(res, 400, 'Revisá El Email');
  if (datos.password && datos.password.length < usuarios.PASSWORD_MIN) return falla(res, 400, PASSWORD_CORTA);
  if (datos.rol === 'cliente' && !datos.clienteId) return falla(res, 400, 'Elegí El Cliente Del Usuario');
  if (id === req.session.usuario.id && datos.rol !== 'admin') return falla(res, 400, 'No Podés Quitarte El Rol De Admin');
  let marca;
  try {
    marca = await usuarios.actualizarUsuario(id, datos);
  } catch (err) {
    if (esDuplicado(err)) return falla(res, 409, 'Ya existe un usuario con ese email.');
    throw err;
  }
  // Las sesiones de ese usuario se revisan ya (rol/Cliente nuevos, o se cortan si
  // cambió la contraseña). A uno mismo no se lo desloguea por cambiarse la clave.
  invalidarSesiones(id);
  if (id === req.session.usuario.id) req.session.passwordMarca = marca;
  else eventos.cerrarUsuario(id);
  ok(res, 'Usuario Actualizado Correctamente');
}));

router.delete('/usuarios/:id', requireAdmin, h(async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  if (id === req.session.usuario.id) return falla(res, 400, 'No Podés Borrar Tu Propio Usuario');
  await usuarios.borrarUsuario(id);
  invalidarSesiones(id);
  eventos.cerrarUsuario(id);
  ok(res, 'Usuario Borrado');
}));

// ── Mi Negocio ──────────────────────────────────────────────────────────────

router.get('/clientes/:clienteId/negocio', resolveClienteAccess, h(async (req, res) => {
  const [contexto, telefonoAlertas, horarioBot] = await Promise.all([
    clientes.obtenerContexto(req.clienteId),
    clientes.obtenerTelefonoAlertas(req.clienteId),
    // Si todavía no se corrió el SQL del horario, la página carga igual (sin horario).
    clientes.obtenerHorarioBot(req.clienteId).catch(err => {
      console.warn(`[negocio] No se pudo leer el horario del bot: ${err.message}`);
      return { desde: null, hasta: null };
    }),
  ]);
  res.json({ contexto: contexto || '', telefonoAlertas: telefonoAlertas || '', horarioBot });
}));

router.put('/clientes/:clienteId/negocio', resolveClienteAccess, h(async (req, res) => {
  await clientes.actualizarContexto(req.clienteId, texto(req.body.contextoNegocio, 8000));
  ok(res, 'Información Guardada');
}));

// Número al que el bot le escribe por WhatsApp cuando un chat pasa a revisión
// humana (piden una persona o insultan). Vacío = no se avisa a nadie.
router.put('/clientes/:clienteId/negocio/alertas', resolveClienteAccess, h(async (req, res) => {
  const digitos = texto(req.body.telefonoAlertas, 40).replace(/\D/g, '');
  if (digitos && (digitos.length < 10 || digitos.length > 15)) {
    return falla(res, 400, 'Número Inválido: Poné El Código De País, Ej. +54 9 11 1234-5678');
  }
  await clientes.setTelefonoAlertas(req.clienteId, digitos || null);
  (digitos ? ok : aviso)(res, digitos ? 'Número De Alertas Guardado' : 'Sin Número De Alertas: Nadie Recibe El Aviso Por WhatsApp', { telefonoAlertas: digitos });
}));

// Horario de atención del bot (hora Argentina). Sin horario = responde las 24 hs.
router.put('/clientes/:clienteId/negocio/horario', resolveClienteAccess, h(async (req, res) => {
  const hora = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v ?? '')) ? String(v) : null);
  const conHorario = req.body.activo === true;
  const desde = hora(req.body.desde);
  const hasta = hora(req.body.hasta);
  if (conHorario && (!desde || !hasta)) return falla(res, 400, 'Horario Inválido');
  if (conHorario && desde === hasta) return falla(res, 400, 'La Hora De Inicio Y De Fin No Pueden Ser Iguales');
  await clientes.setHorarioBot(req.clienteId, conHorario ? desde : null, conHorario ? hasta : null);
  const horarioBot = conHorario ? { desde, hasta } : { desde: null, hasta: null };
  ok(res, conHorario ? 'Horario Guardado' : 'El Bot Responde Las 24 Hs', { horarioBot });
}));

// ── Aprendizajes ────────────────────────────────────────────────────────────
// Pares pregunta → respuesta que el bot suma a su system prompt.

router.get('/clientes/:clienteId/aprendizajes', resolveClienteAccess, h(async (req, res) => {
  res.json({ rows: await aprendizajes.listar(req.clienteId), tope: aprendizajes.TOPE_ACTIVOS });
}));

function datosAprendizaje(body) {
  return {
    pregunta: texto(body.pregunta, aprendizajes.MAX_PREGUNTA).trim(),
    respuesta: texto(body.respuesta, aprendizajes.MAX_RESPUESTA).trim(),
  };
}

const MENSAJE_TOPE = `Llegaste Al Tope De ${aprendizajes.TOPE_ACTIVOS} Aprendizajes Activos: Desactivá O Borrá Alguno`;

router.post('/clientes/:clienteId/aprendizajes', resolveClienteAccess, h(async (req, res) => {
  const datos = datosAprendizaje(req.body);
  if (!datos.pregunta || !datos.respuesta) return falla(res, 400, 'Completá La Pregunta Y La Respuesta');
  const origenUserId = texto(req.body.origenUserId, 100) || null;
  const resultado = await aprendizajes.guardar(req.clienteId, { ...datos, origenUserId }, req.session.usuario.email);
  if (resultado === 'tope') return falla(res, 400, MENSAJE_TOPE);
  ok(res, 'Aprendizaje Guardado: El Bot Ya Lo Usa');
}));

router.post('/clientes/:clienteId/aprendizajes/:id', resolveClienteAccess, h(async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const datos = datosAprendizaje(req.body);
  if (!datos.pregunta || !datos.respuesta) return falla(res, 400, 'Completá La Pregunta Y La Respuesta');
  const resultado = await aprendizajes.guardar(req.clienteId, { ...datos, id }, req.session.usuario.email);
  if (resultado === 'no_existe') return falla(res, 404, 'Aprendizaje No Encontrado');
  ok(res, 'Aprendizaje Actualizado');
}));

router.post('/clientes/:clienteId/aprendizajes/:id/activo', resolveClienteAccess, h(async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  const activo = req.body.activo === true;
  const resultado = await aprendizajes.setActivo(req.clienteId, id, activo, req.session.usuario.email);
  if (resultado === 'tope') return falla(res, 400, MENSAJE_TOPE);
  if (resultado === 'no_existe') return falla(res, 404, 'Aprendizaje No Encontrado');
  (activo ? ok : aviso)(res, activo ? 'Aprendizaje Activado' : 'Aprendizaje Desactivado: El Bot Ya No Lo Usa');
}));

router.post('/clientes/:clienteId/aprendizajes/:id/borrar', resolveClienteAccess, h(async (req, res) => {
  const id = parseInt(req.params.id, 10) || 0;
  if (!(await aprendizajes.borrar(req.clienteId, id))) return falla(res, 404, 'Aprendizaje No Encontrado');
  ok(res, 'Aprendizaje Borrado');
}));

// Interruptor general del bot.
router.post('/clientes/:clienteId/negocio/bot', resolveClienteAccess, h(async (req, res) => {
  const activo = req.body.activo === true;
  await clientes.setBotGeneral(req.clienteId, activo);
  const mensaje = activo ? 'Bot Encendido Para Todos Los Chats' : 'Bot Apagado: No Responde A Ningún Chat';
  (activo ? ok : aviso)(res, mensaje, { activo });
}));

// Default para números nuevos (lo cambia cualquier usuario de su Cliente).
router.post('/clientes/:clienteId/negocio/chats-nuevos', resolveClienteAccess, h(async (req, res) => {
  const activo = req.body.activo === true;
  await clientes.setBotChatsNuevos(req.clienteId, activo);
  ok(res, activo ? 'Los Chats Nuevos Arrancan Con El Bot Respondiendo' : 'Los Chats Nuevos Arrancan Sin Respuesta Del Bot', { activo });
}));

// ── Artículos ───────────────────────────────────────────────────────────────

router.get('/clientes/:clienteId/articulos', resolveClienteAccess, h(async (req, res) => {
  const [resultado, shopifyConexion] = await Promise.all([
    articulos.listarArticulos(req.clienteId, {
      page: paginaDe(req),
      q: texto(req.query.q, 100),
      estado: texto(req.query.estado, 20),
    }),
    shopify.obtenerConexionActiva(req.clienteId),
  ]);
  res.json({ ...resultado, shopifyConexion });
}));

// Toda la info guardada del artículo (también los de Shopify), para el modal.
router.get('/clientes/:clienteId/articulos/:id/detalle', resolveClienteAccess, h(async (req, res) => {
  const articulo = await articulos.obtenerDetalle(req.params.id, req.clienteId);
  if (!articulo) return falla(res, 404, 'Artículo No Encontrado');
  res.json({ articulo });
}));

// Con Shopify conectado, los Artículos que vienen de Shopify se editan allá:
// si se tocaran acá, el próximo aviso de Shopify pisaría el cambio igual.
const bloquearSiEsDeShopify = h(async (req, res, next) => {
  const [articulo, conexion] = await Promise.all([
    articulos.obtenerArticulo(parseInt(req.params.id, 10) || 0, req.clienteId),
    shopify.obtenerConexionActiva(req.clienteId),
  ]);
  if (!articulo) return falla(res, 404, 'Artículo No Encontrado');
  if (articulo.origen === 'shopify' && conexion) return falla(res, 409, 'Este Artículo Se Edita En Shopify');
  req.articulo = articulo;
  next();
});

// Número finito >= 0 (precio) o entero >= 0 (stock). null si viene vacío; NaN si es inválido.
function numeroDe(v, { entero = false } = {}) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999999999 || (entero && !Number.isInteger(n))) return NaN;
  return entero ? n : Math.round(n * 100) / 100;
}

// Los largos son los de las columnas de Articulos (si no, SQL corta con error).
function datosArticulo(body) {
  return {
    codigo: texto(body.codigo, 50).trim(),
    nombre: texto(body.nombre, 200).trim(),
    descripcion: texto(body.descripcion, 4000).trim(),
    precio: numeroDe(body.precio),
    usaStock: Boolean(body.usaStock),
  };
}

router.post('/clientes/:clienteId/articulos', resolveClienteAccess, h(async (req, res) => {
  const body = req.body ?? {};
  const datos = datosArticulo(body);
  if (!datos.nombre || datos.precio === null) return falla(res, 400, 'Completá Nombre Y Precio');
  if (Number.isNaN(datos.precio)) return falla(res, 400, 'Revisá El Precio');
  const cantidadInicial = numeroDe(body.cantidadInicial, { entero: true }) ?? 0;
  if (Number.isNaN(cantidadInicial)) return falla(res, 400, 'Revisá La Cantidad: Tiene Que Ser Un Número Entero');
  await articulos.crearArticulo(req.clienteId, { ...datos, cantidadInicial });
  ok(res, 'Artículo Creado Correctamente');
}));

router.get('/clientes/:clienteId/articulos/:id', resolveClienteAccess, bloquearSiEsDeShopify, (req, res) => {
  res.json({ articulo: req.articulo });
});

router.put('/clientes/:clienteId/articulos/:id', resolveClienteAccess, bloquearSiEsDeShopify, h(async (req, res) => {
  const datos = datosArticulo(req.body ?? {});
  if (!datos.nombre || datos.precio === null) return falla(res, 400, 'Completá Nombre Y Precio');
  if (Number.isNaN(datos.precio)) return falla(res, 400, 'Revisá El Precio');
  await articulos.actualizarArticulo(req.articulo.id, req.clienteId, datos);
  ok(res, 'Artículo Actualizado Correctamente');
}));

router.post('/clientes/:clienteId/articulos/:id/stock', resolveClienteAccess, bloquearSiEsDeShopify, h(async (req, res) => {
  const cantidad = numeroDe(req.body?.cantidad, { entero: true });
  if (cantidad === null || Number.isNaN(cantidad)) return falla(res, 400, 'Revisá La Cantidad: Tiene Que Ser Un Número Entero');
  await articulos.actualizarStock(req.articulo.id, req.clienteId, cantidad);
  ok(res, 'Stock Actualizado');
}));

router.post('/clientes/:clienteId/articulos/:id/desactivar', resolveClienteAccess, bloquearSiEsDeShopify, h(async (req, res) => {
  await articulos.desactivarArticulo(req.articulo.id, req.clienteId);
  ok(res, 'Artículo Desactivado');
}));

router.post('/clientes/:clienteId/articulos/:id/activar', resolveClienteAccess, bloquearSiEsDeShopify, h(async (req, res) => {
  await articulos.activarArticulo(req.articulo.id, req.clienteId);
  ok(res, 'Artículo Reactivado');
}));

// Los errores de multer (archivo muy grande, más de un archivo) en español y como 400.
function subirExcel(req, res, next) {
  uploadExcel.single('archivo')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return falla(res, 400, 'El Archivo Pesa Más De 10 MB');
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return falla(res, 400, 'Subí Un Solo Archivo');
    if (err.code === 'TIPO_INVALIDO') return falla(res, 400, 'El Archivo Tiene Que Ser Un Excel (.xlsx)');
    next(err);
  });
}

router.post('/clientes/:clienteId/importar', resolveClienteAccess, h(async (req, res, next) => {
  // Con Shopify conectado, el catálogo lo manda Shopify (la pantalla ni muestra el botón).
  if (await shopify.obtenerConexionActiva(req.clienteId)) return falla(res, 409, 'Con Shopify Conectado, Los Artículos Se Cargan Desde Shopify');
  if (importacion.enCurso(req.clienteId)) return falla(res, 409, 'Ya Hay Una Importación En Curso, Esperá A Que Termine');
  next();
}), subirExcel, h(async (req, res) => {
  if (!req.file) return falla(res, 400, 'No se recibió ningún archivo.');
  // Un .xlsx es un ZIP: tiene que empezar con "PK".
  if (req.file.buffer.length < 4 || req.file.buffer.toString('latin1', 0, 2) !== 'PK') {
    return falla(res, 400, 'El Archivo Tiene Que Ser Un Excel (.xlsx)');
  }
  let filas;
  try {
    filas = await importacion.leerFilas(req.file.buffer);
  } catch (err) {
    // Los errores propios (formato del modelo, demasiadas filas) ya vienen en español;
    // los de ExcelJS (archivo dañado) no se muestran tal cual.
    const propio = /modelo|hoja|filas/i.test(err.message);
    if (!propio) console.warn('[importar] No se pudo leer el Excel:', err.message);
    return falla(res, 400, propio ? err.message : 'No Se Pudo Leer El Archivo: ¿Es Un Excel Válido?');
  }
  if (!filas.length) return falla(res, 400, 'El archivo no tiene filas de datos.');
  const jobId = importacion.crearJob(req.clienteId, filas);
  if (!jobId) return falla(res, 409, 'Ya Hay Una Importación En Curso, Esperá A Que Termine');
  res.json({ ok: true, jobId });
}));

router.get('/clientes/:clienteId/importar/:jobId', resolveClienteAccess, (req, res) => {
  const estado = importacion.obtenerEstado(req.params.jobId, req.clienteId);
  if (!estado) return falla(res, 404, 'Importación no encontrada (puede haber expirado).');
  res.json(estado);
});

router.get('/clientes/:clienteId/importar/:jobId/errores.xlsx', resolveClienteAccess, h(async (req, res) => {
  const buffer = await importacion.generarExcelErrores(req.params.jobId, req.clienteId);
  if (!buffer) return res.status(404).send('No hay errores para esta importación.');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="Errores-Importacion.xlsx"');
  res.send(buffer);
}));

// ── Chats ───────────────────────────────────────────────────────────────────

// Bandeja: lista de chats con filtros + huella para el polling en tiempo real.
router.get('/clientes/:clienteId/chats', resolveClienteAccess, h(async (req, res) => {
  const [resultado, huella] = await Promise.all([
    chats.listarChats(req.clienteId, {
      page: paginaDe(req),
      q: texto(req.query.q, 50),
      estado: req.query.estado,
      bot: req.query.bot,
    }),
    huellaDe(req.clienteId),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ ...resultado, huella, estados: chats.ESTADOS, envioHabilitado: bot.envioHabilitado() });
}));

// Polling: cambia con cada mensaje nuevo o cuando se pausa/reactiva un chat.
router.get('/clientes/:clienteId/chats/novedades', resolveClienteAccess, h(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ huella: await huellaDe(req.clienteId) });
}));

router.get('/clientes/:clienteId/chats/:userId', resolveClienteAccess, h(async (req, res) => {
  const chat = await chats.obtenerChat(req.clienteId, String(req.params.userId).slice(0, 100));
  res.set('Cache-Control', 'no-store');
  if (!chat) return falla(res, 404, 'Chat No Encontrado');
  res.json({ chat });
}));

// Respuesta escrita a mano. La manda Bot_Mensajeria (que tiene el token de
// WhatsApp) y queda guardada en Mensajes con enviadoPor. Si el bot estaba
// activo en ese chat se pausa solo, para que no conteste encima tuyo.
router.post('/clientes/:clienteId/chats/:userId/enviar', resolveClienteAccess, h(async (req, res) => {
  const userId = String(req.params.userId).slice(0, 100);
  const mensaje = typeof req.body.texto === 'string' ? req.body.texto.trim() : '';
  if (!mensaje) return falla(res, 400, 'Escribí Un Mensaje');
  if (mensaje.length > 4096) return falla(res, 400, 'El Mensaje Es Demasiado Largo');

  const chat = await chats.obtenerChat(req.clienteId, userId);
  if (!chat) return falla(res, 404, 'Chat No Encontrado');

  const resultado = await bot.enviarMensaje({ clienteId: req.clienteId, userId, texto: mensaje, enviadoPor: req.session.usuario.email });
  if (!resultado.ok) return falla(res, 400, resultado.mensaje);

  const pausado = chat.botActivo;
  if (pausado) await chats.setBotChat(req.clienteId, userId, false, req.session.usuario.email);
  // Si había pedido una persona, ya lo atendieron (queda Atendido con quién respondió).
  if (chat.revisionHumana) await chats.atenderRevision(req.clienteId, userId, req.session.usuario.email);
  ok(res, pausado ? 'Mensaje Enviado Y Bot Pausado En Este Chat' : 'Mensaje Enviado', { botPausado: pausado });
}));

// Nombre propio para identificar un número (vacío lo borra).
router.post('/clientes/:clienteId/chats/:userId/nombre', resolveClienteAccess, h(async (req, res) => {
  const nombre = texto(req.body.nombre, 100).trim();
  const listo = await chats.setNombreChat(req.clienteId, String(req.params.userId).slice(0, 100), nombre);
  if (!listo) return falla(res, 404, 'Chat No Encontrado');
  ok(res, nombre ? 'Nombre Guardado' : 'Nombre Borrado', { nombre });
}));

// Estado del chat elegido a mano (null o 'auto' = vuelve al calculado).
router.post('/clientes/:clienteId/chats/:userId/estado', resolveClienteAccess, h(async (req, res) => {
  const pedido = req.body.estado;
  const estado = pedido == null || pedido === 'auto' ? null : String(pedido);
  if (estado && !chats.ESTADOS_MANUALES.includes(estado)) return falla(res, 400, 'Estado Inválido');
  const listo = await chats.setEstadoManual(req.clienteId, String(req.params.userId).slice(0, 100), estado, req.session.usuario.email);
  if (!listo) return falla(res, 404, 'Chat No Encontrado');
  ok(res, estado ? `Estado Cambiado A ${chats.ESTADOS[estado].label}` : 'Estado Automático Restablecido', { estado });
}));

// Saca el chat de "Revisión Humana" sin reactivar el bot (ej. lo atendieron por teléfono).
router.post('/clientes/:clienteId/chats/:userId/revision/atender', resolveClienteAccess, h(async (req, res) => {
  const listo = await chats.atenderRevision(req.clienteId, String(req.params.userId).slice(0, 100), req.session.usuario.email);
  if (!listo) return falla(res, 404, 'El Chat No Tenía Un Humano Solicitado');
  ok(res, 'Marcado Como Atendido');
}));

// Pausa / reactiva el bot para un número puntual.
router.post('/clientes/:clienteId/chats/:userId/bot', resolveClienteAccess, h(async (req, res) => {
  const activo = req.body.activo === true;
  // Reactivar el bot da por atendido el pedido de persona (si había uno pendiente).
  if (activo) await chats.atenderRevision(req.clienteId, String(req.params.userId).slice(0, 100), req.session.usuario.email);
  const listo = await chats.setBotChat(req.clienteId, String(req.params.userId).slice(0, 100), activo, req.session.usuario.email);
  if (!listo) return falla(res, 404, 'Chat No Encontrado');
  (activo ? ok : aviso)(res, activo ? 'Bot Reactivado En Este Chat' : 'Bot Pausado: Ya No Le Responde', { activo });
}));

// ── Escalamientos ───────────────────────────────────────────────────────────

router.get('/clientes/:clienteId/escalamientos', resolveClienteAccess, h(async (req, res) => {
  res.json(await escalamientos.listarEscalamientos(req.clienteId, paginaDe(req)));
}));

// Bandeja de la página Reclamos: chats con reclamos + los reclamos de cada uno.
// El estado de cada reclamo se cambia con POST .../escalamientos/:id/estado.
router.get('/clientes/:clienteId/reclamos-bandeja', resolveClienteAccess, h(async (req, res) => {
  const [resultado, huella] = await Promise.all([
    chats.listarReclamosBandeja(req.clienteId, { page: paginaDe(req), estado: req.query.estado, q: texto(req.query.q, 50) }),
    huellaDe(req.clienteId),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ ...resultado, huella, envioHabilitado: bot.envioHabilitado() });
}));

router.post('/clientes/:clienteId/escalamientos/:id/estado', resolveClienteAccess, h(async (req, res) => {
  const estado = req.body?.estado;
  if (!escalamientos.ESTADOS.includes(estado)) return falla(res, 400, 'Estado Inválido');
  const resultado = await escalamientos.actualizarEstado(req.params.id, req.clienteId, estado);
  if (resultado === 'no_existe') return falla(res, 404, 'Reclamo No Encontrado');
  if (resultado === 'final') {
    console.warn(`[escalamientos] Intento de modificar un escalamiento ya resuelto (id=${req.params.id})`);
    return falla(res, 409, 'Escalamiento Ya Resuelto');
  }
  if (resultado !== 'ok') return falla(res, 400, 'Estado Inválido');
  ok(res, 'Estado Actualizado');
}));

// ── Atención Humana (chats que pidieron una persona) ───────────────────────
// La conversación se abre con las rutas de /chats/:userId (historial, enviar, bot).

router.get('/clientes/:clienteId/humano-solicitado', resolveClienteAccess, h(async (req, res) => {
  const [resultado, huella] = await Promise.all([
    chats.listarHumanoSolicitado(req.clienteId, { page: paginaDe(req), estado: req.query.estado, q: texto(req.query.q, 50) }),
    huellaDe(req.clienteId),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ ...resultado, huella, envioHabilitado: bot.envioHabilitado() });
}));

router.post('/clientes/:clienteId/humano-solicitado/:userId/estado', resolveClienteAccess, h(async (req, res) => {
  const estado = req.body.estado;
  if (estado !== 'pendiente' && estado !== 'atendido') return falla(res, 400, 'Estado Inválido');
  const listo = await chats.setEstadoHumano(req.clienteId, String(req.params.userId).slice(0, 100), estado, req.session.usuario.email);
  if (!listo) return falla(res, 404, 'El Chat Ya Estaba En Ese Estado');
  ok(res, estado === 'atendido' ? 'Marcado Como Atendido' : 'Marcado Como Pendiente');
}));

// ── Pedidos ─────────────────────────────────────────────────────────────────

router.get('/clientes/:clienteId/pedidos', resolveClienteAccess, h(async (req, res) => {
  const [resultado, shopifyConexion] = await Promise.all([
    pedidos.listarPedidos(req.clienteId, paginaDe(req)),
    shopify.obtenerConexionActiva(req.clienteId),
  ]);
  res.json({ ...resultado, shopifyConexion });
}));

router.get('/clientes/:clienteId/pedidos/:id/detalle', resolveClienteAccess, h(async (req, res) => {
  const [items, avisosPedido] = await Promise.all([
    pedidos.obtenerDetalle(req.params.id, req.clienteId),
    avisos.listarDePedido(req.clienteId, parseInt(req.params.id, 10) || 0),
  ]);
  res.json({ pedidoId: req.params.id, items, avisos: avisosPedido });
}));

router.post('/clientes/:clienteId/pedidos/:id/notas', resolveClienteAccess, h(async (req, res) => {
  await pedidos.actualizarNotas(req.params.id, req.clienteId, texto(req.body?.notas, 500));
  ok(res, 'Notas Guardadas');
}));

router.post('/clientes/:clienteId/pedidos/:id/estado', resolveClienteAccess, h(async (req, res) => {
  const estado = req.body?.estado;
  // "reclamado" lo pone el bot; a mano solo se elige uno de estos.
  if (!pedidos.ESTADOS_ELEGIBLES.includes(estado)) return falla(res, 400, 'Estado Inválido');
  const conexion = await shopify.obtenerConexionActiva(req.clienteId);
  const resultado = await pedidos.actualizarEstado(req.params.id, req.clienteId, estado, { omitirStock: !!conexion });
  if (resultado === 'no_existe') return falla(res, 404, 'Pedido No Encontrado');
  if (resultado === 'final') {
    console.warn(`[pedidos] Intento de modificar un pedido ya finalizado (id=${req.params.id})`);
    return falla(res, 409, 'Pedido en Estado Final');
  }
  if (resultado === 'solo_solucionado') return falla(res, 409, 'Reclamado Solo Puede Pasar a Solucionado');
  if (resultado !== 'ok') return falla(res, 400, 'Estado Inválido');

  // El estado en el portal ya quedó guardado; lo de Shopify nunca lo revierte.
  const r = conexion
    ? await shopifyOrders.alCambiarEstado(parseInt(req.params.id, 10), req.clienteId, estado)
    : { omitido: true };
  if (r.enviado) return ok(res, `Estado Actualizado Y Enviado A Shopify (${r.orderName})`);
  if (r.cancelado) return ok(res, 'Pedido Cancelado También En Shopify');
  if (r.error && estado === 'cancelado') return aviso(res, 'Cancelado En El Portal, Pero No En Shopify');
  if (r.error) return aviso(res, 'Estado Actualizado, Pero No Se Pudo Enviar A Shopify');
  ok(res, 'Estado Actualizado');
}));

router.post('/clientes/:clienteId/pedidos/:id/shopify/reintentar', resolveClienteAccess, h(async (req, res) => {
  const r = await shopifyOrders.enviarPedido(parseInt(req.params.id, 10), req.clienteId, { reintento: true });
  if (r.enviado) return ok(res, `Pedido Enviado A Shopify (${r.orderName})`);
  if (r.error) return aviso(res, 'No Se Pudo Enviar A Shopify');
  if (r.yaEnviado) return ok(res, 'El Pedido Ya Estaba En Shopify');
  aviso(res, 'Este Pedido No Se Puede Enviar A Shopify Todavía');
}));

// ── Links de compra (el bot manda el checkout de Shopify con el carrito armado) ──

router.get('/clientes/:clienteId/links-compra', resolveClienteAccess, h(async (req, res) => {
  const [resultado, config, conexion] = await Promise.all([
    linksCompra.listar(req.clienteId, { page: paginaDe(req), estado: req.query.estado, dias: req.query.dias }),
    linksCompra.leerConfig(req.clienteId),
    shopify.obtenerConexionActiva(req.clienteId),
  ]);
  res.json({ ...resultado, config: conexion ? config : null, shopDomain: conexion?.shopDomain || null });
}));

router.post('/clientes/:clienteId/links-compra/config', resolveClienteAccess, h(async (req, res) => {
  const activo = req.body?.activo === true;
  if (!(await linksCompra.guardarConfig(req.clienteId, activo))) return falla(res, 409, 'Primero Conectá Tu Tienda De Shopify');
  ok(res, activo ? 'Venta Por Link Activada' : 'Venta Por Link Desactivada', { config: { activo } });
}));

// ── Dashboard (Shopify + Meta Ads + costos) ─────────────────────────────────

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS_DASHBOARD = 366;

function fechaValida(v) {
  if (!FECHA_RE.test(String(v || ''))) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

router.get('/clientes/:clienteId/dashboard', resolveClienteAccess, h(async (req, res) => {
  const desde = fechaValida(req.query.desde);
  const hasta = fechaValida(req.query.hasta);
  if (!desde || !hasta || desde > hasta) return falla(res, 400, 'Revisá Las Fechas');
  if (dashboard.diasEntre(desde, hasta) > MAX_DIAS_DASHBOARD) return falla(res, 400, 'Elegí Un Rango De Hasta Un Año');
  res.set('Cache-Control', 'no-store');
  res.json(await dashboard.datos(req.clienteId, { desde, hasta }));
}));

router.post('/clientes/:clienteId/dashboard/actualizar', resolveClienteAccess, h(async (req, res) => {
  const desde = fechaValida(req.body?.desde) || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await dashboard.actualizar(req.clienteId, desde);
  ok(res, 'Actualizando Datos');
}));

// Costos que Shopify no sabe: comisión del medio de pago, envíos, costos fijos...
router.post('/clientes/:clienteId/dashboard/config', resolveClienteAccess, h(async (req, res) => {
  const b = req.body || {};
  const num = (v, max, { opcional = false } = {}) => {
    if (opcional && (v === '' || v == null)) return null;
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10000) / 10000 : undefined;
  };
  const cfg = {
    comisionPct: num(b.comisionPct, 100),
    comisionFija: num(b.comisionFija, 1e9),
    envioPorOrden: num(b.envioPorOrden, 1e9),
    costoProductoPct: num(b.costoProductoPct, 100, { opcional: true }),
    costosFijosMes: num(b.costosFijosMes, 1e11),
    cotizacionUsd: num(b.cotizacionUsd, 1e9, { opcional: true }),
  };
  if (Object.values(cfg).some(v => v === undefined)) return falla(res, 400, 'Revisá Los Números');
  if (cfg.cotizacionUsd === 0) cfg.cotizacionUsd = null;
  await dashboard.guardarConfig(req.clienteId, cfg);
  ok(res, 'Costos Guardados');
}));

// Cuentas publicitarias que quedaron para elegir después del OAuth (el token
// queda cifrado en la sesión 15 min, nunca va al navegador).
const PENDIENTE_TTL_MS = 15 * 60 * 1000;
function metaPendiente(req) {
  const p = req.session.metaPendiente;
  if (!p || p.clienteId !== req.clienteId || Date.now() - p.t > PENDIENTE_TTL_MS) return null;
  return p;
}

router.post('/clientes/:clienteId/meta-ads/oauth', resolveClienteAccess, h(async (req, res) => {
  if (!metaAds.oauthDisponible()) return falla(res, 409, 'Falta Configurar La App De Meta En El Servidor');
  const state = oauthState.crear('meta', { clienteId: req.clienteId, usuarioId: req.session.usuario.id });
  res.json({ ok: true, url: metaAds.urlAutorizacion({ state, redirectUri: `${oauthState.baseUrl(req)}/meta/callback` }) });
}));

router.get('/clientes/:clienteId/meta-ads/pendiente', resolveClienteAccess, h(async (req, res) => {
  const p = metaPendiente(req);
  res.set('Cache-Control', 'no-store');
  res.json({ cuentas: p ? p.cuentas : [] });
}));

router.post('/clientes/:clienteId/meta-ads', resolveClienteAccess, h(async (req, res) => {
  try {
    let token = req.body?.token;
    let expiraSeg = null;
    if (req.body?.pendiente) {
      const p = metaPendiente(req);
      if (!p) return falla(res, 409, 'Pasó Mucho Tiempo: Volvé A Conectar Con Facebook');
      if (!p.cuentas.some(c => c.id === metaAds.normalizarCuenta(req.body?.adAccountId))) return falla(res, 400, 'Elegí Una De Las Cuentas');
      token = descifrar(p.tokenEnc);
      expiraSeg = p.expiraSeg;
    }
    const info = await metaAds.conectar(req.clienteId, { adAccountId: req.body?.adAccountId, token, expiraSeg });
    if (req.body?.pendiente) delete req.session.metaPendiente;
    const desde = fechaValida(req.body?.desde) || new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    dashboard.sincronizarMeta(req.clienteId, desde, { forzar: true })
      .catch(err => console.warn(`[dashboard] Primera sync de Meta Ads (cliente ${req.clienteId}):`, err.message));
    (info.activa ? ok : aviso)(res, info.activa ? 'Meta Ads Conectado' : 'Conectado, Pero La Cuenta Publicitaria No Está Activa');
  } catch (err) {
    if (err instanceof metaAds.MetaAdsError) return falla(res, 400, 'No Pudimos Conectar Meta Ads', { detalle: err.message });
    throw err;
  }
}));

router.post('/clientes/:clienteId/meta-ads/desconectar', resolveClienteAccess, h(async (req, res) => {
  await metaAds.desconectar(req.clienteId);
  ok(res, 'Meta Ads Desconectado');
}));

// ── Mercado Pago (cobros y comisiones reales para el Dashboard) ─────────────

router.post('/clientes/:clienteId/mercadopago/oauth', resolveClienteAccess, h(async (req, res) => {
  if (!mercadoPago.oauthDisponible()) return falla(res, 409, 'Falta Configurar La App De Mercado Pago En El Servidor');
  const state = oauthState.crear('mp', { clienteId: req.clienteId, usuarioId: req.session.usuario.id });
  res.json({ ok: true, url: mercadoPago.urlAutorizacion({ state, redirectUri: `${oauthState.baseUrl(req)}/mercadopago/callback` }) });
}));

// Access Token de producción pegado a mano.
router.post('/clientes/:clienteId/mercadopago', resolveClienteAccess, h(async (req, res) => {
  try {
    await mercadoPago.conectarManual(req.clienteId, req.body?.token);
  } catch (err) {
    if (err instanceof mercadoPago.MercadoPagoError) return falla(res, 400, 'No Pudimos Conectar Mercado Pago', { detalle: err.message });
    throw err;
  }
  dashboard.sincronizarMp(req.clienteId)
    .catch(err => console.warn(`[dashboard] Primera sync de Mercado Pago (cliente ${req.clienteId}):`, err.message));
  ok(res, 'Mercado Pago Conectado');
}));

router.post('/clientes/:clienteId/mercadopago/desconectar', resolveClienteAccess, h(async (req, res) => {
  await mercadoPago.desconectar(req.clienteId);
  ok(res, 'Mercado Pago Desconectado');
}));

// ── Consultas ───────────────────────────────────────────────────────────────

router.get('/clientes/:clienteId/consultas', resolveClienteAccess, h(async (req, res) => {
  res.json(await consultas.listarConsultas(req.clienteId, paginaDe(req)));
}));

// ── Integraciones (Shopify) ─────────────────────────────────────────────────

// Dominio público con el que se está usando el portal (Railway termina el
// HTTPS en un proxy: requiere app.set('trust proxy')).
function urlPublica(req) {
  return config.appUrl || `${req.protocol}://${req.get('host')}`;
}

router.get('/clientes/:clienteId/integraciones', resolveClienteAccess, h(async (req, res) => {
  const [conexion, resumen, app, avisosConfig, linkCompra] = await Promise.all([
    shopify.obtenerConexion(req.clienteId),
    shopifySync.resumen(req.clienteId),
    shopifyApps.obtenerAppDeCliente(req.clienteId),
    avisos.leerConfig(req.clienteId),
    linksCompra.leerConfig(req.clienteId),
  ]);
  const base = urlPublica(req);
  const esAdmin = req.session.usuario.rol === 'admin';
  res.json({
    conexion,
    resumen,
    avisos: avisosConfig,
    linkCompra,
    // Sin BOT_URL / BOT_API_TOKEN el portal no puede mandar avisos.
    envioMensajes: bot.envioHabilitado(),
    configurado: Boolean(app && !app.secretIlegible),
    // Nunca el secret al navegador; el Client ID solo lo ve el admin.
    app: app && esAdmin ? { clientId: app.clientId, esGeneral: app.clienteId == null, secretIlegible: app.secretIlegible } : null,
    // Lo que el admin pega en el Dev Dashboard de Shopify.
    urlsApp: esAdmin ? {
      appUrl: `${base}/shopify`,
      redirect: `${base}/shopify/callback`,
      webhooks: `${base}/shopify/webhooks`,
      scopes: config.shopify.scopes,
      apiVersion: config.shopify.apiVersion,
    } : null,
    shopPendiente: req.session.shopifyPendiente || '',
  });
}));

// Avisos automáticos por WhatsApp (pago recibido, pedido despachado).
router.post('/clientes/:clienteId/avisos', resolveClienteAccess, h(async (req, res) => {
  const cfg = await avisos.guardarConfig(req.clienteId, req.body || {});
  ok(res, 'Avisos Guardados', { avisos: cfg });
}));

// Solo admin: credenciales de la app (Client ID / secret del Dev Dashboard).
router.post('/clientes/:clienteId/shopify/app', requireAdmin, resolveClienteAccess, h(async (req, res) => {
  const clientId = String(req.body.clientId || '').trim();
  const clientSecret = String(req.body.clientSecret || '').trim();
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(clientId) || clientSecret.length < 16 || /\s/.test(clientSecret)) {
    return falla(res, 400, 'Revisá El Client ID Y El Client Secret');
  }
  await shopifyApps.guardarApp({
    clienteId: req.body.alcance === 'general' ? null : req.clienteId,
    clientId,
    clientSecret,
    appUrl: urlPublica(req),
  });
  ok(res, 'Credenciales De Shopify Guardadas');
}));

// Arma el link de autorización: el frontend manda al navegador ahí (Shopify
// pide aceptar los permisos y vuelve a /shopify/callback).
router.post('/clientes/:clienteId/shopify/conectar', resolveClienteAccess, h(async (req, res) => {
  const app = await shopifyApps.obtenerAppDeCliente(req.clienteId);
  if (!app || !app.clientSecret) return falla(res, 400, 'La Integración Con Shopify No Está Configurada');
  const shop = shopifyOAuth.normalizarShop(req.body.shop);
  if (!shop) return falla(res, 400, 'Revisá La Dirección De La Tienda');
  const otra = await shopify.obtenerConexionPorShop(shop);
  if (otra && otra.clienteId !== req.clienteId) return falla(res, 409, 'Esa Tienda Ya Está Conectada A Otro Cliente');
  const state = shopifyOAuth.crearState({ clienteId: req.clienteId, usuarioId: req.session.usuario.id, shop, appId: app.id });
  res.json({ ok: true, redirect: shopifyOAuth.urlAutorizacion({ app, shop, state }) });
}));

router.post('/clientes/:clienteId/shopify/desconectar', resolveClienteAccess, h(async (req, res) => {
  const conexion = await shopify.obtenerConexion(req.clienteId);
  const app = conexion && await shopifyApps.obtenerApp(conexion.appId);
  if (app) await shopifyOAuth.borrarWebhooks(req.clienteId, app).catch(err => {
    console.warn('[shopify] No se pudieron borrar los webhooks al desconectar:', err.message);
  });
  await shopify.eliminarConexion(req.clienteId);
  ok(res, 'Shopify Desconectado');
}));

router.post('/clientes/:clienteId/shopify/sync', resolveClienteAccess, h(async (req, res) => {
  const conexion = await shopify.obtenerConexionActiva(req.clienteId);
  if (!conexion) return falla(res, 400, 'La tienda no está conectada.');
  res.json({ ok: true, jobId: shopifySync.crearJobSync(req.clienteId) });
}));

router.get('/clientes/:clienteId/shopify/sync/:jobId', resolveClienteAccess, (req, res) => {
  const estado = shopifySync.obtenerEstadoSync(req.params.jobId, req.clienteId);
  if (!estado) return falla(res, 404, 'Sincronización no encontrada (puede haber expirado).');
  res.json(estado);
});

// ── Errores ─────────────────────────────────────────────────────────────────

// ── Logs (solo admin) ───────────────────────────────────────────────────────

router.get('/logs', requireAdmin, h(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await logs.listar({
    page: paginaDe(req),
    origen: req.query.origen,
    nivel: req.query.nivel,
    clienteId: parseInt(req.query.clienteId, 10) || null,
    evento: texto(req.query.evento, 100).trim(),
    q: texto(req.query.q, 100).trim(),
  }));
}));

router.use((req, res) => falla(res, 404, 'No Encontrado'));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  console.error(`[api] ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) return;
  falla(res, 500, 'Ocurrió Un Error, Probá De Nuevo');
});

module.exports = router;
