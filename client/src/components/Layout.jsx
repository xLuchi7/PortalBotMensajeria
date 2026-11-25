import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useMatch } from 'react-router-dom';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { iniciales } from '../lib/format.js';

// Un solo menú para admin y cliente: el admin lo ve cuando entra a un Cliente
// puntual, el cliente siempre con el suyo. Para sumar una página, agregala acá
// (y la ruta en App.jsx).
const GRUPOS = [
  { titulo: 'Atención', items: [
    { ruta: 'chats', label: 'Chats', icono: 'message' },
    { ruta: 'escalamientos', label: 'Escalamientos', icono: 'alertTriangle' },
    { ruta: 'consultas', label: 'Consultas', icono: 'search' },
  ] },
  { titulo: 'Ventas', items: [
    { ruta: 'pedidos', label: 'Pedidos', icono: 'truck' },
    { ruta: 'articulos', label: 'Artículos', icono: 'package' },
  ] },
  { titulo: 'Configuración', items: [
    { ruta: 'negocio', label: 'Mi Negocio', icono: 'fileText' },
    { ruta: 'integraciones', label: 'Integraciones', icono: 'plug' },
  ] },
];

// Datos del Cliente que se está viendo (nombre y estado del bot): los usan el
// menú y varias páginas. setCliente permite actualizarlo sin volver a pedirlo
// (por ejemplo al prender o apagar el bot en Mi Negocio).
const ClienteContext = createContext({ cliente: null, setCliente: () => {}, recargarCliente: () => {} });

export function useCliente() {
  return useContext(ClienteContext);
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

  // Al cambiar de página, arriba de todo (como cuando se recargaba).
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  // Un usuario cliente solo entra a su propio negocio.
  if (!esAdmin && idEnRuta && idEnRuta !== usuario.clienteId) return <Navigate to="/" replace />;

  const nombreUsuario = esAdmin ? 'Administrador' : (usuario.razonSocial || usuario.email);
  const enAdmin = esAdmin && !idEnRuta;

  return (
    <ClienteContext.Provider value={{ cliente, setCliente, recargarCliente }}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link to="/" className="sidebar-brand">
            <span className="brand-mark"><Icon name="bot" /></span>
            <span className="brand-text"><strong>Portal</strong><small>Tu asistente de ventas</small></span>
          </Link>

          {esAdmin && (
            <>
              <div className="sidebar-section">Administración</div>
              <nav className="sidebar-nav">
                <NavLink to="/clientes" end className={() => (enAdmin && location.pathname.startsWith('/clientes') ? 'active' : '')}>
                  <Icon name="briefcase" /><span className="label">Clientes</span>
                </NavLink>
                <NavLink to="/usuarios">
                  <Icon name="users" /><span className="label">Usuarios</span>
                </NavLink>
              </nav>
            </>
          )}

          {clienteId && (
            <>
              {esAdmin && (
                <div className="sidebar-viendo">
                  <span className="avatar avatar-sm">{cliente ? iniciales(cliente.razonSocial) : '…'}</span>
                  <span><small>Viendo</small>{cliente ? cliente.razonSocial : 'Cargando…'}</span>
                  <Link to="/clientes" className="sidebar-viendo-salir" title="Volver a la lista de clientes" aria-label="Volver a la lista de clientes">
                    <Icon name="x" />
                  </Link>
                </div>
              )}

              {cliente && typeof cliente.botActivo === 'boolean' && (
                <Link
                  to={`/clientes/${clienteId}/negocio`}
                  className={`sidebar-bot ${cliente.botActivo ? 'is-on' : 'is-off'}`}
                  title={cliente.botActivo ? 'El bot está respondiendo. Tocá para ir a apagarlo.' : 'El bot está apagado. Tocá para ir a encenderlo.'}
                >
                  <span className="sidebar-bot-avatar"><Icon name="bot" /><span className="sidebar-bot-dot" /></span>
                  <span className="sidebar-bot-text">
                    <small>Tu asistente</small>
                    <strong>{cliente.botActivo ? 'Respondiendo' : 'Apagado'}</strong>
                  </span>
                  <span className="mini-switch" aria-hidden="true"><span /></span>
                </Link>
              )}

              {GRUPOS.map(g => (
                <div key={g.titulo} className="sidebar-grupo">
                  <div className="sidebar-section">{g.titulo}</div>
                  <nav className="sidebar-nav">
                    {g.items.map(i => (
                      <NavLink key={i.ruta} to={`/clientes/${clienteId}/${i.ruta}`}>
                        <Icon name={i.icono} /><span className="label">{i.label}</span>
                      </NavLink>
                    ))}
                  </nav>
                </div>
              ))}
            </>
          )}

          <div className="sidebar-footer">
            <span className="avatar">{iniciales(nombreUsuario)}</span>
            <div className="sidebar-user">
              <strong>{nombreUsuario}</strong>
              <span>{usuario.email}</span>
            </div>
            <button type="button" className="btn-logout" title="Salir" aria-label="Salir" onClick={logout}>
              <Icon name="logOut" />
            </button>
          </div>
        </aside>

        <main className="main" key={location.pathname}>
          <Outlet />
        </main>
      </div>
    </ClienteContext.Provider>
  );
}
