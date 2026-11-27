// Recorre el portal en Chrome headless contra fake-server.js.
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:3197';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const resultados = [];
const ok = (nombre, cond, extra = '') => { resultados.push(`${cond ? 'OK  ' : 'FAIL'} ${nombre}${extra ? ' — ' + extra : ''}`); };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--no-sandbox', '--window-size=1500,950', '--disable-features=PasswordLeakDetection,PasswordManagerOnboarding,PasswordCheck', '--password-store=basic'],
    defaultViewport: { width: 1500, height: 950 },
  });
  const page = await browser.newPage();
  const errores = [];
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', e => errores.push('PAGEERROR ' + e.message));
  page.on('dialog', d => d.dismiss());
  page.on('response', r => { if (r.status() >= 400) errores.push('HTTP ' + r.status() + ' ' + r.request().method() + ' ' + r.url()); });

  const shot = name => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const texto = () => page.evaluate(() => document.body.innerText);
  const toasts = () => page.evaluate(() => [...document.querySelectorAll('.toast-text')].map(t => t.textContent));
  const clickText = async (sel, txt) => {
    await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.click())); await sleep(250);
    const els = await page.$$(sel);
    for (const el of els) {
      const t = await el.evaluate(e => e.textContent.trim());
      if (t.includes(txt)) { await el.click(); return true; }
    }
    throw new Error(`No encontré ${sel} con "${txt}"`);
  };
  const esperarTexto = async (txt, ms = 6000) => {
    const fin = Date.now() + ms;
    while (Date.now() < fin) { if ((await texto()).toLowerCase().includes(txt.toLowerCase())) return true; await sleep(150); }
    return false;
  };

  try {
    // ── Login ──
    await page.goto(`${BASE}/clientes/1/chats`, { waitUntil: 'networkidle2' });
    ok('sin sesión manda al login', page.url().endsWith('/login'));
    await shot('01-login');
    await page.click('button[type=submit]');
    await sleep(300);
    ok('login vacío muestra toast de campo', (await toasts()).some(t => t.includes('Falta Completar "Email"')), JSON.stringify(await toasts()));
    await page.type('input[name=email]', 'admin@test.com');
    await page.type('input[name=password]', 'mal');
    await page.click('button[type=submit]');
    ok('login incorrecto muestra error', await esperarTexto('Email o contraseña incorrectos'));
    await page.$eval('input[name=password]', e => { e.value = ''; });
    await page.type('input[name=password]', 'admin');
    await page.click('button[type=submit]');
    await page.waitForFunction(() => location.pathname === '/clientes/1/chats', { timeout: 5000 });
    ok('login vuelve a la página que pedía', true);

    // ── Chats ──
    await esperarTexto('Luciano');
    await sleep(400);
    await shot('02-chats');
    await clickText('button.chat-item', 'Luciano');
    await esperarTexto('Todo bien, gracias');
    await sleep(400);
    await shot('03-chat-abierto');
    ok('URL con ?chat=', page.url().includes('chat=5491132101982'));

    // Tiempo real: entra un mensaje de otro número.
    await fetch('http://localhost:3198/inject?user=59811222333&texto=' + encodeURIComponent('Hola, tienen talle L?'));
    const llego = await esperarTexto('Hola, tienen talle L?', 7000);
    ok('mensaje nuevo aparece solo en la lista (tiempo real)', llego);
    const primero = await page.$eval('.chat-items .chat-item', e => e.textContent);
    ok('el chat nuevo queda arriba de todo', primero.includes('talle L'), primero.slice(0, 60));
    await shot('04-tiempo-real');
    // Mensaje en el chat abierto.
    await fetch('http://localhost:3198/inject?user=5491132101982&texto=' + encodeURIComponent('Busco una remera'));
    ok('mensaje nuevo aparece en la conversación abierta', await esperarTexto('Busco una remera', 7000));

    // Responder a mano.
    await page.type('.chat-composer textarea', 'Hola Luciano, te paso precios');
    await page.keyboard.press('Enter');
    ok('enviar respuesta: toast', await esperarTexto('Mensaje Enviado Y Bot Pausado En Este Chat'));
    ok('enviar respuesta: aparece la burbuja', await esperarTexto('Hola Luciano, te paso precios'));
    ok('enviar respuesta: se pausó el bot', await esperarTexto('Bot pausado'));
    ok('caja vacía después de enviar', (await page.$eval('.chat-composer textarea', e => e.value)) === '');
    await sleep(500);
    await shot('05-respondido');

    // Interruptor del bot del chat.
    await page.click('.chat-header .bot-toggle');
    ok('reactivar bot del chat', await esperarTexto('Bot Reactivado En Este Chat'));

    // Nombre del contacto.
    await page.click('.chat-nombre .icon-btn');
    await page.$eval('.chat-nombre-form input', e => { e.select(); });
    await page.keyboard.type('Luchi Cliente');
    await page.keyboard.press('Enter');
    ok('guardar nombre del contacto', await esperarTexto('Nombre Guardado'));
    ok('nombre nuevo en la lista', await esperarTexto('Luchi Cliente'));

    // Filtros y búsqueda.
    await clickText('button.chip', 'Bot Pausado');
    await sleep(600);
    ok('filtro Bot Pausado en la URL', page.url().includes('bot=pausado'));
    await clickText('button.chip', 'Todos');
    await page.type('.chat-search input', 'Patricio');
    await sleep(900);
    ok('búsqueda en vivo', page.url().includes('q=Patricio') && (await page.$$('.chat-items .chat-item')).length === 1);
    await page.$eval('.chat-search input', e => { e.value = ''; });
    await page.goto(`${BASE}/clientes/1/mensajes?chat=59894422029`, { waitUntil: 'networkidle2' });
    ok('link viejo /mensajes redirige a chats', page.url().includes('/chats?chat=59894422029'));
    ok('chat con ventana cerrada muestra aviso de 24 hs', await esperarTexto('Pasaron más de 24 hs'));

    // ── Pedidos ──
    await page.click('a[href="/clientes/1/pedidos"]');
    await esperarTexto('PEDIDO DE PRUEBA SHOPIFY');
    await sleep(300);
    await shot('06-pedidos');
    await page.click('.icon-btn[title="Ver detalle"]');
    ok('detalle del pedido', await esperarTexto('Precio unitario'));
    await sleep(300);
    await shot('07-pedido-detalle');
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.click('.notas-cell .icon-btn');
    await page.waitForSelector('dialog[open] textarea');
    await page.$eval('dialog[open] textarea', e => e.select());
    await page.keyboard.type('Llamar antes');
    await clickText('dialog[open] button', 'Guardar');
    ok('guardar notas', await esperarTexto('Notas Guardadas'));
    // Cambiar a entregado (estado final): pide confirmación.
    const selects = await page.$$('select.badge-select');
    await selects[0].select('entregado');
    await page.waitForSelector('dialog[open]');
    ok('estado final pide confirmación', await esperarTexto('es un estado final'));
    await shot('08-confirmar-final');
    await clickText('dialog[open] button', 'Cancelar');
    await sleep(300);
    ok('cancelar no cambia el estado', (await page.$eval('select.badge-select', e => e.value)) !== 'entregado');
    await page.click('.shopify-cell .icon-btn');
    ok('reintentar envío a Shopify (toast)', await esperarTexto('No Se Pudo Enviar A Shopify'));

    // ── Artículos (con Shopify) ──
    await page.click('a[href="/clientes/1/articulos"]');
    await esperarTexto('Remera Básica');
    ok('artículos con Shopify: botón Sincronizar', await esperarTexto('Sincronizar con Shopify'));
    await clickText('button', 'Sincronizar con Shopify');
    ok('sync: termina', await esperarTexto('Catálogo sincronizado', 6000));
    await shot('09-sync');
    await clickText('dialog[open] button', 'Cerrar');
    // Stock de artículo manual.
    const stock = await page.$('tr:nth-child(2) .stock-input');
    await stock.click({ clickCount: 3 });
    await stock.type('7');
    await page.click('tr:nth-child(2) .stock-form button');
    ok('guardar stock', await esperarTexto('Stock Actualizado'));
    await page.goto(`${BASE}/clientes/1/articulos/1/editar`, { waitUntil: 'networkidle2' });
    ok('editar artículo de Shopify vuelve a la lista', await esperarTexto('Este Artículo Se Edita En Shopify') && page.url().endsWith('/articulos'));

    // ── Mi Negocio ──
    await page.click('a[href="/clientes/1/negocio"]');
    await esperarTexto('Lo que el bot sabe');
    await clickText('.tips button', 'Horarios');
    await sleep(200);
    ok('idea agregada al texto', (await page.$eval('.editor-card textarea', e => e.value)).includes('Horarios de atención: '));
    await page.click('a[href="/clientes/1/pedidos"]');
    ok('salir con cambios sin guardar pide confirmación', await esperarTexto('¿Salir sin guardar?'));
    await shot('10-salir-sin-guardar');
    await clickText('dialog[open] button', 'Cancelar');
    await sleep(300);
    ok('se queda en Mi Negocio', page.url().endsWith('/negocio'));
    await clickText('.editor-card button', 'Guardar');
    ok('guardar contexto', await esperarTexto('Información Guardada'));
    await page.click('.bot-switch .bot-toggle');
    ok('apagar bot general', await esperarTexto('Bot Apagado'));
    ok('menú lateral refleja bot apagado', await page.$eval('.sidebar-negocio', e => e.classList.contains('is-off')));
    await shot('11-negocio');
    await page.click('.bot-switch .bot-toggle');
    await esperarTexto('Bot Encendido');
    await clickText('.segmentado button', 'No responde');
    ok('chats nuevos (admin)', await esperarTexto('Los Chats Nuevos Arrancan Sin Respuesta'));

    // ── Integraciones conectado ──
    await page.click('a[href="/clientes/1/integraciones"]');
    await esperarTexto('Prueba Luchi');
    await sleep(300);
    await shot('12-integraciones-conectado');
    ok('integraciones: stats', await esperarTexto('Pedidos enviados'));
    await page.goto(`${BASE}/clientes/1/integraciones?sync=11111111-2222-3333-4444-555555555555`, { waitUntil: 'networkidle2' });
    ok('?sync= vencido muestra error sin romper', await esperarTexto('No se pudo sincronizar'));
    await clickText('dialog[open] button', 'Cerrar');
    await sleep(300);
    ok('cerrar saca ?sync= de la URL', !page.url().includes('sync='));

    // ── Consultas ──
    // (Reclamos es una bandeja que sale de usp_Portal_ReclamosBandeja, sin stub acá:
    // el cambio de estado de un reclamo se prueba por API.)
    await page.click('a[href="/clientes/1/consultas"]');
    ok('consultas', await esperarTexto('no lo encontró'));
    await shot('14-consultas');

    // ── Admin: otro cliente sin Shopify ──
    await page.goto(`${BASE}/clientes`, { waitUntil: 'networkidle2' });
    await esperarTexto('Luma Uruguay');
    await shot('15-clientes');
    await clickText('a', 'Entrar');
    await page.goto(`${BASE}/clientes/2/articulos`, { waitUntil: 'networkidle2' });
    await esperarTexto('Taza');
    ok('cliente sin Shopify: Importar Excel', await esperarTexto('Importar Excel'));
    ok('sidebar muestra el cliente que se ve', await esperarTexto('Luma Uruguay'));
    await clickText('button', 'Importar Excel');
    await page.waitForSelector('dialog[open] .dropzone');
    const tmp = path.join(__dirname, 'prueba.xlsx'); fs.writeFileSync(tmp, 'PK contenido falso de excel'); // un .xlsx es un ZIP: el servidor exige que empiece con PK
    const input = await page.$('dialog[open] input[type=file]');
    await input.uploadFile(tmp);
    await sleep(200);
    await shot('16-importar');
    await clickText('dialog[open] button', 'Subir');
    ok('importación con errores termina', await esperarTexto('Importación con errores', 6000));
    ok('link para descargar errores', Boolean(await page.$('dialog[open] a[href$="errores.xlsx"]')));
    await shot('17-importar-resultado');
    await clickText('dialog[open] button', 'Cerrar');
    await clickText('a', 'Nuevo artículo');
    await page.waitForSelector('input[name=nombre]');
    await clickText('button', 'Crear artículo');
    await sleep(200);
    ok('form artículo valida obligatorios', (await toasts()).some(t => t.includes('Falta Completar "Nombre"')));
    await page.type('input[name=nombre]', 'Llavero');
    await page.type('input[name=precio]', '150');
    await clickText('button', 'Crear artículo');
    ok('crear artículo', await esperarTexto('Artículo Creado Correctamente') && await esperarTexto('Llavero'));
    await page.goto(`${BASE}/clientes/2/integraciones`, { waitUntil: 'networkidle2' });
    ok('integraciones sin app: asistente admin', await esperarTexto('Creá la app en Shopify'));
    await shot('18-integraciones-asistente');
    ok('bot apagado: banner en chats', await (async () => { await page.goto(`${BASE}/clientes/2/chats`, { waitUntil: 'networkidle2' }); return esperarTexto('El bot está apagado para todos los chats'); })());

    // ── Admin: formularios ──
    await page.goto(`${BASE}/clientes/nuevo`, { waitUntil: 'networkidle2' });
    await page.type('input[name=razonSocial]', 'Otro');
    await page.type('input[name=cuit]', '20123456789');
    await page.type('input[name=telefono]', '123');
    await clickText('button', 'Crear cliente');
    ok('cliente duplicado muestra error', await esperarTexto('Ya existe un Cliente con ese CUIT'));
    await page.goto(`${BASE}/usuarios`, { waitUntil: 'networkidle2' });
    await esperarTexto('cliente@test.com');
    await shot('19-usuarios');
    await page.goto(`${BASE}/usuarios/2/editar`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('select[name=clienteId]');
    ok('editar usuario carga cliente', (await page.$eval('select[name=clienteId]', e => e.value)) === '1');
    await page.select('select[name=rol]', 'admin');
    ok('rol admin oculta Cliente', !(await page.$('select[name=clienteId]')));

    // ── Logout + usuario cliente ──
    await page.click('.btn-logout');
    await page.waitForFunction(() => location.pathname === '/login');
    ok('logout', true);
    // Login por fetch: el formulario con la contraseña "cliente" dispara el aviso
    // de contraseña filtrada de Chrome, que bloquea el mouse en el navegador de prueba.
    await page.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'portal' }, body: JSON.stringify({ email: 'cliente@test.com', password: 'cliente' }) }));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => location.pathname === '/clientes/1/inicio', { timeout: 5000 });
    ok('cliente entra a su Inicio', true);
    ok('cliente no ve Administración', !(await texto()).includes('Administración'));
    await page.goto(`${BASE}/clientes/2/chats`, { waitUntil: 'networkidle2' });
    await sleep(300);
    ok('cliente no entra a otro cliente', !page.url().includes('/clientes/2'), page.url());
    await page.goto(`${BASE}/usuarios`, { waitUntil: 'networkidle2' });
    await sleep(300);
    ok('cliente no entra a Usuarios', !page.url().endsWith('/usuarios'), page.url());
    await page.goto(`${BASE}/clientes/1/integraciones`, { waitUntil: 'networkidle2' });
    ok('cliente no ve credenciales', !(await texto()).includes('Credenciales de la app'));

    // ── Celular ──
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(`${BASE}/clientes/1/chats`, { waitUntil: 'networkidle2' });
    await sleep(400);
    await shot('20-movil-lista');
    const tocar = async sel => { const b = await (await page.$(sel)).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    await tocar('button.chat-item');
    await sleep(700);
    ok('móvil: abre el chat', page.url().includes('chat='));
    await shot('21-movil-chat');
    await tocar('.chat-back');
    await sleep(300);
    ok('móvil: volver a la lista', !page.url().includes('chat='));
  } catch (err) {
    ok('EXCEPCIÓN', false, err.stack);
    await shot('zz-error');
  }

  console.log(resultados.join('\n'));
  console.log('\nErrores de consola:', errores.length ? '\n' + errores.join('\n') : 'ninguno');
  await browser.close();
})();
