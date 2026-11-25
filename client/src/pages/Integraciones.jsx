import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Form from '../components/Form.jsx';
import { useShopifySync } from '../components/ShopifySync.jsx';
import { ErrorCarga, useTitulo } from '../components/ui.jsx';
import { useAvisar, useToast } from '../components/Toasts.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useCliente } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api, useApi } from '../lib/api.js';
import { plural } from '../lib/format.js';

const ESTADO = {
  activa: ['Conectado', 'badge-activo'],
  error: ['Requiere atención', 'badge-pendiente'],
  desinstalada: ['Desinstalada', 'badge-inactivo'],
};

// Misma lógica que normalizarShop() del servidor: muestra a qué tienda va.
function normalizarShop(v) {
  let s = String(v || '').trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (m) s = m[1];
  s = s.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  if (!s.includes('.')) s += '.myshopify.com';
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(s) ? s : null;
}

export default function Integraciones() {
  useTitulo('Integraciones');
  const { clienteId } = useParams();
  const [params, setParams] = useSearchParams();
  const { usuario } = useAuth();
  const { cliente } = useCliente();
  const { data, error, reload } = useApi(`/clientes/${clienteId}/integraciones`);
  const sync = useShopifySync(clienteId, {
    alTerminar: () => {
      // Saca ?sync= de la URL para que recargar no reabra el diálogo.
      if (params.get('sync')) setParams({}, { replace: true });
      reload();
    },
  });

  // Al volver de Shopify recién conectado, el servidor arranca la primera
  // sincronización y manda ?sync=<job> para mostrar el progreso.
  const syncJob = params.get('sync');
  const yaSeguido = useRef(null);
  useEffect(() => {
    if (syncJob && /^[0-9a-f-]{36}$/i.test(syncJob) && yaSeguido.current !== syncJob) {
      yaSeguido.current = syncJob;
      sync.seguir(syncJob);
    }
  }, [syncJob, sync]);

  const esAdmin = usuario.rol === 'admin';

  if (error && !data) return <ErrorCarga error={error} onReintentar={reload} />;

  const conexion = data?.conexion;
  const conectado = conexion && conexion.estado !== 'desinstalada';
  const configurado = data?.configurado;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Integraciones</h1>
          <p className="page-sub">Conectá las herramientas que ya usás. Con Shopify conectado, el bot vende con tu catálogo, precios y stock reales, y los pedidos que confirmás acá aparecen solos en tu tienda.</p>
        </div>
      </div>

      <div className="negocio-layout">
        <div className="card integracion-card">
          <div className="integracion-head">
            <div className="integracion-logo"><Icon name="shoppingBag" /></div>
            <div>
              <h2>Shopify</h2>
              <p>{conectado ? (conexion.nombreTienda || conexion.shopDomain) : 'Catálogo, stock y pedidos sincronizados con tu tienda'}</p>
            </div>
            {conexion && ESTADO[conexion.estado] && <span className={`badge ${ESTADO[conexion.estado][1]}`}>{ESTADO[conexion.estado][0]}</span>}
          </div>

          {!data ? (
            <div style={{ padding: '1rem 0' }}><span className="skeleton" style={{ width: '70%' }} /><br /><span className="skeleton" style={{ width: '45%', marginTop: '0.6rem' }} /></div>
          ) : !configurado && esAdmin ? (
            <AsistenteAdmin clienteId={clienteId} cliente={cliente} data={data} onGuardado={reload} />
          ) : !configurado ? (
            <EsperandoHabilitacion />
          ) : !conectado ? (
            <Conectar clienteId={clienteId} conexion={conexion} shopPendiente={data.shopPendiente} />
          ) : (
            <Conectado clienteId={clienteId} conexion={conexion} resumen={data.resumen} onSync={sync.iniciar} sincronizando={sync.sincronizando} onCambio={reload} />
          )}

          {data && configurado && esAdmin && data.app && (
            <details className="ayuda ayuda-admin">
              <summary><Icon name="key" /> Credenciales de la app (solo admin)</summary>
              <p>App {data.app.esGeneral ? 'general, para todos los clientes' : 'personalizada de este cliente'} · Client ID <code>{data.app.clientId}</code></p>
              <div className="copy-list">
                <Copiable etiqueta="URL de la app" valor={data.urlsApp.appUrl} />
                <Copiable etiqueta="URL de redireccionamiento" valor={data.urlsApp.redirect} />
              </div>
              <p className="field-hint">Si reemplazás las credenciales, las tiendas conectadas con la app anterior tienen que reconectar.</p>
              <FormCredenciales clienteId={clienteId} cliente={cliente} app={data.app} onGuardado={reload} />
            </details>
          )}
        </div>

        <div className="card negocio-tips">
          {data && !configurado && esAdmin ? (
            <>
              <div className="negocio-tips-header"><Icon name="fileText" /> ¿Qué distribución elijo?</div>
              <ul>
                <li><strong>Personalizada</strong>: una app por cliente, sin revisión de Shopify. Ideal para los primeros clientes</li>
                <li><strong>Pública (unlisted)</strong>: una sola app para todos. Requiere que Shopify la apruebe una vez (App Review)</li>
                <li>Podés empezar con personalizadas y sumar la pública después: los clientes ya conectados siguen funcionando</li>
                <li>Cada tienda es del cliente: el portal solo accede a lo que el cliente acepta</li>
              </ul>
            </>
          ) : (
            <>
              <div className="negocio-tips-header"><Icon name="fileText" /> Cómo funciona</div>
              <ul>
                <li>Cada producto y variante de Shopify aparece en Artículos y el bot lo ofrece por WhatsApp</li>
                <li>Precios, stock y productos nuevos se actualizan solos al cambiarlos en Shopify</li>
                <li>Al pasar un pedido a <strong>Confirmado</strong>, se crea en Shopify con el pago pendiente y descuenta stock</li>
                <li>Si cancelás un pedido ya enviado, también se cancela en Shopify y vuelve el stock</li>
                <li>Los artículos de Shopify se editan en Shopify, no acá</li>
              </ul>
            </>
          )}
        </div>
      </div>

      {sync.dialogo}
    </>
  );
}

function Copiable({ etiqueta, valor }) {
  const toast = useToast();
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    navigator.clipboard.writeText(valor)
      .then(() => { toast('success', 'Copiado'); setCopiado(true); setTimeout(() => setCopiado(false), 1500); })
      .catch(() => toast('warning', 'No Se Pudo Copiar'));
  };
  return (
    <div className="copy-row">
      <span className="copy-label">{etiqueta}</span>
      <code>{valor}</code>
      <button type="button" className={`icon-btn ${copiado ? 'icon-btn-ok' : ''}`} title="Copiar" onClick={copiar}><Icon name={copiado ? 'check' : 'copy'} /></button>
    </div>
  );
}

function AsistenteAdmin({ clienteId, cliente, data, onGuardado }) {
  const { urlsApp, app } = data;
  const esLocal = /localhost|127\.0\.0\.1/.test(urlsApp.appUrl);
  const nombre = cliente ? cliente.razonSocial : 'este cliente';
  return (
    <>
      {app && app.secretIlegible && (
        <div className="alert alert-warning">Las credenciales guardadas ya no se pueden leer (cambió la clave del servidor). Volvé a pegar el Client secret en el paso 5.</div>
      )}
      <p className="wizard-intro">Configurá una vez la app de Shopify para <strong>{nombre}</strong>. Después el cliente conecta su tienda solo, con un botón. Tarda unos 5 minutos.</p>

      {esLocal && (
        <div className="alert alert-warning">Estás abriendo el portal desde <strong>localhost</strong>: sirve solo para probar con una tienda de desarrollo. Shopify no puede mandar avisos automáticos (cambios de precio y stock) a tu compu, así que vas a tener que usar <strong>Sincronizar ahora</strong>. Para el cliente real, hacé estos pasos entrando al portal desde la dirección de Railway.</div>
      )}

      <ol className="wizard">
        <li>
          <h3>Creá la app en Shopify</h3>
          <p>Entrá al Dev Dashboard con tu cuenta de Shopify, andá a <strong>Apps</strong> y tocá <strong>Crear app</strong>. Ponele un nombre que reconozcas, por ejemplo <em>Portal Mensajería{cliente ? ` – ${cliente.razonSocial}` : ''}</em>.</p>
          <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener noreferrer" className="btn btn-outline"><Icon name="externalLink" /> Abrir Dev Dashboard</a>
        </li>
        <li>
          <h3>Completá el formulario de la app</h3>
          <p>En la misma pantalla de <strong>Crear app</strong>, copiá cada dato con el botón y pegalo en el campo que dice a la izquierda:</p>
          <div className="copy-list">
            <Copiable etiqueta="URL de la app" valor={urlsApp.appUrl} />
            <Copiable etiqueta="URL de redireccionamiento" valor={urlsApp.redirect} />
            <Copiable etiqueta="Alcances" valor={urlsApp.scopes} />
            <Copiable etiqueta="Versión de la API de webhooks" valor={urlsApp.apiVersion} />
          </div>
          <p className="field-hint">Dejá <strong>sin tildar</strong> “Incrustar app en el panel de control de Shopify” y “Usar flujo de instalación heredado”. Después tocá <strong>Crear app</strong> (arriba a la derecha).</p>
        </li>
        <li>
          <h3>Distribución (solo si la tienda es de otra organización)</h3>
          <p>Si la app la creaste desde una cuenta de <strong>Partner</strong> para la tienda de un cliente, en el <strong>Inicio</strong> de la app vas a ver la tarjeta <strong>Distribución</strong>: tocá <strong>Seleccionar método de distribución</strong>, elegí <strong>Personalizada</strong> y confirmá. <em>No se puede cambiar después.</em></p>
          <p>En esa misma tarjeta tocá <strong>Administrar enlace de instalación personalizado</strong>, escribí la tienda del cliente (la que termina en <em>.myshopify.com</em>) y tocá <strong>Generar enlace</strong>. No hace falta mandar ese enlace: el cliente conecta desde acá, con el botón del portal.</p>
          <p className="field-hint">Si la tarjeta Distribución no aparece, la app y la tienda son de la misma organización (por ejemplo, tu tienda de desarrollo, o una app creada desde la cuenta del propio cliente): salteá este paso.</p>
        </li>
        <li>
          <h3>Cargá la IP del servidor (solo para tiendas de otra organización)</h3>
          <p>Desde el 20/11/2026 Shopify exige esto para apps personalizadas instaladas en tiendas que no son de tu organización. En la app: <strong>Configuración → Lista de IP permitidas → Administrar</strong>.</p>
          <p>Pegá la IP fija de salida del portal. En Railway la activás en el servicio: <strong>Settings → Networking → Static Outbound IPs</strong> (requiere plan Pro). Después en Shopify tildá <strong>Aplicar la lista de IP permitidas</strong> y guardá.</p>
          <p className="field-hint">Para probar con tu propia tienda de desarrollo no hace falta.</p>
        </li>
        <li>
          <h3>Pegá las credenciales acá</h3>
          <p>En <strong>Configuración</strong> de la app están el <strong>ID de cliente</strong> (Client ID) y el <strong>Secreto</strong> (Client secret). Copialos y pegalos abajo.</p>
          <FormCredenciales clienteId={clienteId} cliente={cliente} app={app} onGuardado={onGuardado} />
        </li>
      </ol>
      <p className="field-hint">El teléfono del comprador viaja en la nota del pedido de Shopify. No hace falta pedir permisos extra de datos de clientes.</p>
    </>
  );
}

// Solo admin. Carga/reemplaza el Client ID y secret de la app de Shopify.
function FormCredenciales({ clienteId, cliente, app, onGuardado }) {
  const avisar = useAvisar();
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e) => {
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    setEnviando(true);
    try {
      avisar(await api(`/clientes/${clienteId}/shopify/app`, { method: 'POST', body }));
      form.querySelector('input[name="clientSecret"]').value = '';
      onGuardado();
    } catch (err) { avisar(err); }
    setEnviando(false);
  };
  return (
    <Form onSubmit={enviar} className="shopify-app-form">
      <div className="opciones-alcance">
        <label className="opcion-card">
          <input type="radio" name="alcance" value="cliente" defaultChecked={!app || !app.esGeneral} />
          <span>
            <strong>Solo para {cliente ? cliente.razonSocial : 'este cliente'}</strong>
            <small>Distribución personalizada. Sin revisión de Shopify: funciona hoy. Una app por cliente.</small>
          </span>
        </label>
        <label className="opcion-card">
          <input type="radio" name="alcance" value="general" defaultChecked={Boolean(app && app.esGeneral)} />
          <span>
            <strong>Para todos los clientes</strong>
            <small>App pública (unlisted) aprobada por Shopify. Se carga una sola vez y cada cliente conecta con un clic.</small>
          </span>
        </label>
      </div>
      <label>Client ID
        <input type="text" name="clientId" required autoComplete="off" spellCheck="false" minLength={16}
               placeholder="Ej. 3f9c1a…" defaultValue={app ? app.clientId : ''} />
      </label>
      <label>Client secret
        <input type="password" name="clientSecret" required autoComplete="new-password" spellCheck="false" minLength={16}
               placeholder={app ? 'Pegalo de nuevo para reemplazarlo' : 'Se guarda cifrado'} />
      </label>
      <button type="submit" className="btn btn-primary" disabled={enviando}><Icon name="save" /> {enviando ? 'Guardando…' : 'Guardar credenciales'}</button>
    </Form>
  );
}

function EsperandoHabilitacion() {
  return (
    <>
      <ol className="pasos-conexion">
        <li className="activo"><span>1</span>Habilitamos Shopify</li>
        <li><span>2</span>Conectás tu tienda</li>
        <li><span>3</span>¡Listo!</li>
      </ol>
      <div className="espera-box">
        <div className="espera-icon"><Icon name="plug" /></div>
        <h3>Falta que habilitemos Shopify en tu cuenta</h3>
        <p>Es un paso que hace el equipo del portal (Shopify lo exige por seguridad). Pasale a tu contacto la dirección de tu tienda, la que termina en <strong>.myshopify.com</strong>.</p>
        <p style={{ marginTop: '0.6rem' }}>Cuando esté habilitado, en esta misma pantalla vas a ver el botón <strong>Conectar con Shopify</strong>: escribís tu tienda, aceptás los permisos en Shopify y listo.</p>
      </div>
    </>
  );
}

// Manda al navegador a Shopify a aceptar los permisos (vuelve a /shopify/callback).
async function irAShopify(clienteId, shop, avisar, setEnviando) {
  setEnviando(true);
  try {
    const r = await api(`/clientes/${clienteId}/shopify/conectar`, { method: 'POST', body: { shop } });
    window.location.href = r.redirect;
  } catch (err) {
    avisar(err);
    setEnviando(false);
  }
}

function Conectar({ clienteId, conexion, shopPendiente }) {
  const avisar = useAvisar();
  const [shop, setShop] = useState(shopPendiente || (conexion ? conexion.shopDomain : ''));
  const [enviando, setEnviando] = useState(false);
  const normalizado = useMemo(() => normalizarShop(shop), [shop]);

  return (
    <>
      {conexion && conexion.estado === 'desinstalada' && (
        <div className="alert alert-warning">La app se desinstaló desde Shopify. Volvé a conectar para seguir sincronizando.</div>
      )}

      <ol className="pasos-conexion">
        <li className="activo"><span>1</span>Escribí tu tienda</li>
        <li><span>2</span>Aceptá en Shopify</li>
        <li><span>3</span>¡Listo!</li>
      </ol>

      <Form onSubmit={() => {
        if (normalizado === null) return avisar(new Error('Revisá La Dirección De La Tienda'));
        irAShopify(clienteId, shop, avisar, setEnviando);
      }}>
        <label>Dirección de tu tienda
          <div className="integracion-form">
            <input type="text" name="shop" required placeholder="mitienda.myshopify.com" autoComplete="off" spellCheck="false"
                   value={shop} onChange={e => setShop(e.target.value)} />
            <button type="submit" className="btn btn-primary" disabled={enviando}>
              {enviando ? <><span className="spinner spinner-sm" /> Abriendo Shopify…</> : <><Icon name="plug" /> Conectar con Shopify</>}
            </button>
          </div>
        </label>
        <p className={`shop-preview ${normalizado ? 'ok' : normalizado === null ? 'mal' : ''}`} aria-live="polite">
          {normalizado ? `Vamos a conectar ${normalizado}` : normalizado === null ? 'Esa dirección no parece de Shopify. Tiene que terminar en .myshopify.com' : ''}
        </p>
      </Form>

      <details className="ayuda">
        <summary>¿Dónde encuentro la dirección de mi tienda?</summary>
        <p>Entrá a tu admin de Shopify y mirá la barra del navegador. Si dice <code>admin.shopify.com/store/<strong>mitienda</strong></code>, escribí <strong>mitienda</strong>. También podés pegar la dirección completa: la reconocemos sola.</p>
      </details>
      <details className="ayuda">
        <summary>¿Qué permisos pide y por qué?</summary>
        <ul>
          <li><strong>Ver productos</strong>: para que el bot ofrezca tu catálogo con precios reales.</li>
          <li><strong>Ver inventario</strong>: para no vender lo que no tenés.</li>
          <li><strong>Crear y ver pedidos</strong>: para cargar en tu tienda los pedidos que confirmás acá, sin duplicarlos.</li>
        </ul>
        <p>No tocamos tus pagos, tus clientes ni la configuración de tu tienda. Podés desconectar cuando quieras.</p>
      </details>
      <details className="ayuda">
        <summary>¿Quién tiene que hacerlo?</summary>
        <p>La persona dueña de la tienda, o alguien de tu equipo con permiso para instalar apps en Shopify.</p>
      </details>
    </>
  );
}

function Conectado({ clienteId, conexion, resumen, onSync, sincronizando, onCambio }) {
  const avisar = useAvisar();
  const confirmar = useConfirm();
  const [reconectando, setReconectando] = useState(false);
  const ultimaSync = conexion.ultimaSync
    ? new Date(conexion.ultimaSync).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    : 'En curso…';

  const desconectar = async () => {
    const ok = await confirmar({
      titulo: '¿Desconectar Shopify?',
      mensaje: 'El bot va a seguir usando los artículos que ya están cargados, pero dejan de actualizarse solos y los pedidos ya no se envían a la tienda.',
      boton: 'Desconectar',
    });
    if (!ok) return;
    try { avisar(await api(`/clientes/${clienteId}/shopify/desconectar`, { method: 'POST' })); } catch (err) { avisar(err); }
    onCambio();
  };

  return (
    <>
      {conexion.estado === 'error' && (
        <div className="alert alert-warning">
          {conexion.ultimoError || 'Hubo un problema con la conexión.'}
          <div>
            <button type="button" className="btn btn-primary" style={{ marginTop: '0.6rem' }} disabled={reconectando}
                    onClick={() => irAShopify(clienteId, conexion.shopDomain, avisar, setReconectando)}>
              <Icon name="refresh" /> Reconectar
            </button>
          </div>
        </div>
      )}

      <div className="integracion-stats">
        <div className="integracion-stat"><span>Artículos de Shopify</span><strong>{resumen.articulosShopify}</strong></div>
        <div className="integracion-stat"><span>Pedidos enviados</span><strong>{resumen.pedidosEnviados}</strong></div>
        <div className="integracion-stat"><span>Última sincronización</span><strong style={{ fontSize: '0.9rem' }}>{ultimaSync}</strong></div>
      </div>

      {resumen.pedidosConError > 0 && (
        <div className="alert alert-warning">
          {resumen.pedidosConError} {plural(resumen.pedidosConError, 'pedido')} no se {resumen.pedidosConError === 1 ? 'pudo' : 'pudieron'} enviar a Shopify.{' '}
          <Link to={`/clientes/${clienteId}/pedidos`}>Revisalos en Pedidos</Link> para reintentar.
        </div>
      )}
      {resumen.articulosManuales > 0 && (
        <div className="alert alert-info">
          Tenés {resumen.articulosManuales} {plural(resumen.articulosManuales, 'artículo')} {plural(resumen.articulosManuales, 'cargado')} a mano que no {resumen.articulosManuales === 1 ? 'existe' : 'existen'} en Shopify. El bot los sigue ofreciendo, pero esos pedidos no se van a poder enviar a la tienda: desactivalos o creálos en Shopify con el mismo SKU.
        </div>
      )}

      <div className="integracion-actions">
        <button type="button" className="btn btn-primary" onClick={onSync} disabled={sincronizando}><Icon name="refresh" /> Sincronizar ahora</button>
        <a href={`https://${conexion.shopDomain}/admin`} target="_blank" rel="noopener noreferrer" className="btn btn-outline"><Icon name="externalLink" /> Abrir mi tienda</a>
        <button type="button" className="btn btn-danger-outline" onClick={desconectar}>Desconectar</button>
      </div>
    </>
  );
}
