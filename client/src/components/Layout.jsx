import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useMatch } from 'react-router-dom';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';
import { useToast } from './Toasts.jsx';
import { useAuth } from '../lib/auth.jsx';
import { iniciales, numero } from '../lib/format.js';
import { EventosContext, TIPOS_EVENTO, useEnVivo, useFuenteEventos } from '../lib/eventos.jsx';

// Un solo menú para admin y cliente: el admin lo ve cuando entra a un Cliente
// puntual, el cliente siempre con el suyo. Para sumar una página, agregala acá
// (y la ruta en App.jsx). `contador` es la clave de GET /contadores que se
// muestra al lado; `alerta` lo pinta de rojo.
const GRUPOS = [
  { titulo: null, items: [
    { ruta: 'inicio', label: 'Inicio', icono: 'home' },
  ] },
  { titulo: 'Atención', items: [
    { ruta: 'chats', label: 'Chats', icono: 'message', contador: 'chats', ayuda: 'esperan tu respuesta' },
    { ruta: 'atencion-humana', label: 'Atención Humana', icono: 'user', contador: 'revision', ayuda: 'piden hablar con una persona', alerta: true },
    { ruta: 'reclamos', label: 'Reclamos', icono: 'alertTriangle', contador: 'escalamientos', ayuda: 'sin resolver', alerta: true },
    { ruta: 'consultas', label: 'Consultas', icono: 'search' },
  ] },
  { titulo: 'Ventas', items: [
    { ruta: 'pedidos', label: 'Pedidos', icono: 'truck', contador: 'pedidos', ayuda: 'por confirmar' },
    { ruta: 'articulos', label: 'Artículos', icono: 'package' },
  ] },
  { titulo: 'Configuración', items: [
    { ruta: 'negocio', label: 'Mi Negocio', icono: 'fileText' },
    { ruta: 'integraciones', label: 'Integraciones', icono: 'plug' },
  ] },
];
const ITEMS = GRUPOS.flatMap(g => g.items);

// En el celular el menú pasa a una barra abajo: estas cuatro y "Más" con el resto.
const TABBAR = ['inicio', 'chats', 'pedidos', 'articulos'];

const CLAVE_COMPACTO = 'portal.menuCompacto';

// Datos del Cliente que se está viendo (nombre y estado del bot): los usan el
// menú y varias páginas. setCliente permite actualizarlo sin volver a pedirlo
// (por ejemplo al prender o apagar el bot en Mi Negocio).
const ClienteContext = createContext({ cliente: null, setCliente: () => {}, recargarCliente: () => {} });

export function useCliente() {
  return useContext(ClienteContext);
}

// Números al lado de Chats, Reclamos y Pedidos (y los chats en revisión
// humana). Se piden al entrar, al cambiar de página y cada vez que el servidor
// avisa que algo cambió (lib/eventos.jsx).
function useContadores(clienteId, pathname, fuente) {
  const [contadores, setContadores] = useState(null);
  const actual = useRef(clienteId);
  actual.current = clienteId;
  const pedir = useCallback(async () => {
    if (!clienteId) return;
    try {
      const c = await api(`/clientes/${clienteId}/contadores`);
      if (actual.current === clienteId) setContadores(c);
    } catch { /* sin red: se reintenta con el próximo aviso */ }
  }, [clienteId]);
  useEffect(() => {
    if (!clienteId) { setContadores(null); return; }
    pedir();
  }, [clienteId, pathname, pedir]);
  useEnVivo(TIPOS_EVENTO, pedir, { fuente });
  return contadores;
}

// Revisión humana: cuando aparece un chat nuevo en revisión avisa con un toast,
// y mientras haya alguno el título de la pestaña lo muestra (se ve aunque estés
// en otra pestaña).
function useAvisoRevision(contadores) {
  const toast = useToast();
  const anterior = useRef(null);
  const n = contadores?.revision || 0;
  useEffect(() => {
    if (contadores == null) return;
    if (anterior.current != null && n > anterior.current) {
      toast('warning', n - anterior.current === 1 ? 'Un Chat Pidió Hablar Con Una Persona' : `${n - anterior.current} Chats Pidieron Hablar Con Una Persona`);
    }
    anterior.current = n;
  }, [contadores, n, toast]);
  useEffect(() => {
    const limpio = document.title.replace(/^\(\d+\) ⚠ /, '');
    document.title = n ? `(${n}) ⚠ ${limpio}` : limpio;
  });
}

// Menú angosto (solo íconos). Se recuerda en este navegador.
function useCompacto() {
  const [compacto, setCompacto] = useState(() => {
    try { return localStorage.getItem(CLAVE_COMPACTO) === '1'; } catch { return false; }
  });
  const alternar = () => setCompacto(c => {
    try { localStorage.setItem(CLAVE_COMPACTO, c ? '0' : '1'); } catch { /* modo privado */ }
    return !c;
  });
  return [compacto, alternar];
}

// El número va con key={n}: al cambiar se vuelve a montar y hace el "pop".
function Contador({ n, alerta, ayuda, className = 'sidebar-contador' }) {
  if (!n) return null;
  return (
    <span key={n} className={`${className} ${alerta ? 'is-alerta' : ''}`} title={ayuda ? `${n} ${ayuda}` : undefined}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

export default function Layout() {
  const { usuario, logout } = useAuth();
  const location = useLocation();
  const match = useMatch('/clientes/:clienteId/*');
  const idEnRuta = match ? parseInt(match.params.clienteId, 10) || null : null;
  const esAdmin = usuario.rol === 'admin';
  const clienteId = esAdmin ? idEnRuta : usuario.clienteId;

  const [cliente, setCliente] = useState(null);
  const recargarCliente = useCallback(() => {
    if (!clienteId) return;
    api(`/clientes/${clienteId}`).then(d => setCliente(d.cliente)).catch(() => {});
  }, [clienteId]);

  useEffect(() => {
    setCliente(c => (c && c.id === clienteId ? c : null));
    recargarCliente();
  }, [clienteId, recargarCliente]);

  const [compacto, alternarCompacto] = useCompacto();
  const [masAbierto, setMasAbierto] = useState(false);

  // Al cambiar de página, arriba de todo (como cuando se recargaba) y se cierra "Más".
  useEffect(() => { window.scrollTo(0, 0); setMasAbierto(false); }, [location.pathname]);

  const fuenteEventos = useFuenteEventos(clienteId);
  const contadores = useContadores(clienteId, location.pathname, fuenteEventos);
  useAvisoRevision(contadores);

  // Un usuario cliente solo entra a su propio negocio.
  if (!esAdmin && idEnRuta && idEnRuta !== usuario.clienteId) return <Navigate to="/" replace />;

  const enAdmin = esAdmin && !idEnRuta;
  const base = clienteId ? `/clientes/${clienteId}` : null;
  // `contador` puede ser una clave o varias (se suman).
  const numero = i => (i.contador && contadores ? [].concat(i.contador).reduce((s, k) => s + (contadores[k] || 0), 0) : 0);
  const botOn = cliente?.botActivo !== false;
  const nombreNegocio = cliente?.razonSocial || (esAdmin ? null : usuario.razonSocial);

  return (
    <ClienteContext.Provider value={{ cliente, setCliente, recargarCliente }}>
      <div className={`app-shell ${compacto ? 'is-compacto' : ''} ${clienteId ? 'con-tabbar' : ''}`}>
        <aside className={`sidebar ${clienteId ? 'con-cliente' : ''}`}>
          <Link to="/" className="sidebar-brand" data-tip="Portal de Clientes">
            <span className="brand-mark"><Icon name="bot" /></span>
            <span className="brand-text"><strong>Portal de Clientes</strong><small>Tu asistente de ventas</small></span>
          </Link>

          {/* El negocio que se está viendo, con el estado del asistente. */}
          {clienteId && (
            <div className={`sidebar-negocio ${cliente && !botOn ? 'is-off' : ''}`}>
              <Link to={`${base}/negocio`} className="sidebar-negocio-link"
                    data-tip={`${nombreNegocio || 'Tu negocio'} · ${botOn ? 'Asistente respondiendo' : 'Asistente apagado'}`}
                    title={compacto ? undefined : botOn ? 'Tu asistente está respondiendo. Configuralo en Mi Negocio.' : 'Tu asistente está apagado. Encendelo en Mi Negocio.'}>
                <span className="sidebar-negocio-avatar">
                  {nombreNegocio ? iniciales(nombreNegocio) : '…'}
                  {cliente && <i className="sidebar-negocio-dot" aria-hidden="true" />}
                </span>
                <span className="sidebar-negocio-texto">
                  <strong>{nombreNegocio || 'Cargando…'}</strong>
                  <small>{!cliente ? ' ' : botOn ? 'Asistente respondiendo' : 'Asistente apagado'}</small>
                </span>
              </Link>
              {esAdmin && (
                <Link to="/clientes" className="sidebar-negocio-salir" title="Volver a la lista de clientes" aria-label="Volver a la lista de clientes">
                  <Icon name="x" />
                </Link>
              )}
            </div>
          )}

          {esAdmin && (
            <div className="sidebar-admin">
              <div className="sidebar-section">Administración</div>
              <nav className="sidebar-nav">
                <NavLink to="/clientes" end data-tip="Clientes" className={() => (enAdmin && location.pathname.startsWith('/clientes') ? 'active' : '')}>
                  <span className="sidebar-icono"><Icon name="briefcase" /></span><span className="label">Clientes</span>
                </NavLink>
                <NavLink to="/usuarios" data-tip="Usuarios">
                  <span className="sidebar-icono"><Icon name="users" /></span><span className="label">Usuarios</span>
                </NavLink>
                <NavLink to="/logs" data-tip="Logs">
                  <span className="sidebar-icono"><Icon name="list" /></span><span className="label">Logs</span>
                </NavLink>
              </nav>
            </div>
          )}

          {clienteId && GRUPOS.map(g => (
            <div key={g.titulo || 'principal'} className="sidebar-grupo">
              {g.titulo && <div className="sidebar-section">{g.titulo}</div>}
              <nav className="sidebar-nav">
                {g.items.map(i => {
                  const n = numero(i);
                  return (
                    <NavLink key={i.ruta} to={`${base}/${i.ruta}`} data-tip={n ? `${i.label} · ${n} ${i.ayuda}` : i.label}>
                      <span className="sidebar-icono">
                        <Icon name={i.icono} />
                        {n > 0 && <span className={`sidebar-punto ${i.alerta ? 'is-alerta' : ''}`} />}
                      </span>
                      <span className="label">{i.label}</span>
                      <Contador n={n} alerta={i.alerta} ayuda={i.ayuda} />
                    </NavLink>
                  );
                })}
              </nav>
            </div>
          ))}

          <button type="button" className="sidebar-colapsar" onClick={alternarCompacto}
                  data-tip="Expandir menú" aria-label={compacto ? 'Expandir menú' : 'Contraer menú'} aria-pressed={compacto}>
            <Icon name="panelLeft" /><span>Contraer menú</span>
          </button>

          <div className="sidebar-footer">
            <span className="avatar">{iniciales(usuario.email)}</span>
            <div className="sidebar-user">
              <strong>{usuario.email}</strong>
              <span>{esAdmin ? 'Administrador' : 'Usuario del negocio'}</span>
            </div>
            <button type="button" className="btn-logout" data-tip="Salir" aria-label="Salir" onClick={logout}>
              <Icon name="logOut" />
            </button>
          </div>
        </aside>

        <main className="main" key={location.pathname}>
          {base && <AvisoRevision base={base} contadores={contadores} />}
          <EventosContext.Provider value={fuenteEventos}><Outlet /></EventosContext.Provider>
        </main>

        {clienteId && (
          <BarraCelular base={base} numero={numero} pathname={location.pathname}
                        masAbierto={masAbierto} setMasAbierto={setMasAbierto} esAdmin={esAdmin} logout={logout} />
        )}
      </div>
    </ClienteContext.Provider>
  );
}

// ── Aviso de revisión humana ────────────────────────────────────────────────

// Franja arriba de cada página mientras haya chats donde el bot se pausó porque
// pidieron una persona o insultaron. Con uno solo lleva directo a ese chat.
function AvisoRevision({ base, contadores }) {
  const n = contadores?.revision || 0;
  if (!n) return null;
  const chats = contadores.revisionChats || [];
  const unico = n === 1 && chats[0];
  const destino = unico ? `${base}/atencion-humana?chat=${encodeURIComponent(chats[0].userId)}` : `${base}/atencion-humana`;
  return (
    <div className="aviso-revision" role="alert">
      <span className="aviso-revision-icono"><Icon name="alertTriangle" /></span>
      <div className="aviso-revision-texto">
        <strong>{n === 1 ? 'Un chat pidió hablar con una persona' : `${n} chats pidieron hablar con una persona`}</strong>
        <span>
          {unico
            ? `${chats[0].nombre || numero(chats[0].userId)}: ${chats[0].motivo || 'pidió hablar con una persona'}. El bot está pausado ahí.`
            : 'Pidieron hablar con una persona o insultaron. El bot está pausado en esos chats.'}
        </span>
      </div>
      <Link to={destino} className="btn btn-sm aviso-revision-btn">{unico ? 'Ir al chat' : 'Ver chats'} <Icon name="arrowRight" /></Link>
    </div>
  );
}

// ── Celular: barra inferior y hoja "Más" ────────────────────────────────────

function BarraCelular({ base, numero, pathname, masAbierto, setMasAbierto, esAdmin, logout }) {
  const resto = ITEMS.filter(i => !TABBAR.includes(i.ruta));
  const masActivo = resto.some(i => pathname.startsWith(`${base}/${i.ruta}`));
  const alertaMas = resto.some(i => numero(i) > 0);

  useEffect(() => {
    if (!masAbierto) return undefined;
    const cerrar = e => { if (e.key === 'Escape') setMasAbierto(false); };
    window.addEventListener('keydown', cerrar);
    return () => window.removeEventListener('keydown', cerrar);
  }, [masAbierto, setMasAbierto]);

  return (
    <>
      <nav className="tabbar" aria-label="Menú principal">
        {TABBAR.map(ruta => {
          const i = ITEMS.find(x => x.ruta === ruta);
          return (
            <NavLink key={ruta} to={`${base}/${ruta}`}>
              <span className="tabbar-icono">
                <Icon name={i.icono} />
                <Contador n={numero(i)} alerta={i.alerta} className="tabbar-contador" />
              </span>
              <span>{i.label}</span>
            </NavLink>
          );
        })}
        <button type="button" className={masActivo || masAbierto ? 'active' : ''} onClick={() => setMasAbierto(true)}
                aria-haspopup="dialog" aria-expanded={masAbierto}>
          <span className="tabbar-icono">
            <Icon name="grid" />
            {alertaMas && <span className="tabbar-punto" />}
          </span>
          <span>Más</span>
        </button>
      </nav>

      {masAbierto && (
        <>
          <div className="hoja-fondo" onClick={() => setMasAbierto(false)} />
          <div className="hoja" role="dialog" aria-label="Más secciones">
            <span className="hoja-agarre" />
            <div className="hoja-grilla">
              {resto.map(i => (
                <NavLink key={i.ruta} to={`${base}/${i.ruta}`}>
                  <Icon name={i.icono} />
                  {i.label}
                  <Contador n={numero(i)} alerta={i.alerta} />
                </NavLink>
              ))}
              {esAdmin && (
                <NavLink to="/clientes" end>
                  <Icon name="briefcase" />
                  Clientes
                </NavLink>
              )}
            </div>
            <button type="button" className="hoja-salir" onClick={logout}>
              <Icon name="logOut" /> Salir
            </button>
          </div>
        </>
      )}
    </>
  );
}
