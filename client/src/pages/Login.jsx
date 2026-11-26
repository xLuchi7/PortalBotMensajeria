import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Form from '../components/Form.jsx';
import { inicioDe, useAuth } from '../lib/auth.jsx';

// Panel izquierdo: marca, mensaje y una vista de ejemplo de lo que hace el
// portal (un chat del bot, un pedido y un número del día). Es ilustrativo,
// no son datos reales. En pantallas chicas se oculta.
function Vitrina() {
  return (
    <aside className="login-vitrina" aria-hidden="true">
      <div className="vitrina-aurora vitrina-aurora-1" />
      <div className="vitrina-aurora vitrina-aurora-2" />
      <div className="vitrina-aurora vitrina-aurora-3" />
      <div className="vitrina-puntos" />

      <div className="vitrina-marca">
        <span className="vitrina-logo"><Icon name="bot" /></span>
        Portal de Clientes
      </div>

      <div className="vitrina-cuerpo">
        <h2 className="vitrina-titulo">
          Tu bot vende por WhatsApp.<br />
          <span>Vos lo ves todo desde acá.</span>
        </h2>
        <p className="vitrina-texto">
          Pedidos, chats, consultas y stock de tu negocio en un solo lugar, en tiempo real.
        </p>

        <div className="vitrina-escena">
          <div className="demo demo-chat">
            <div className="demo-chat-head">
              <span className="demo-avatar">MG</span>
              <div>
                <strong>Martina G.</strong>
                <small><i className="demo-online" /> en línea</small>
              </div>
            </div>
            <div className="demo-globo demo-globo-in">Hola! ¿Tienen la campera negra en talle M?</div>
            <div className="demo-globo demo-globo-out">¡Sí! Nos quedan 3. ¿Te la reservo para hoy?</div>
            <div className="demo-globo demo-globo-in demo-escribiendo"><i /><i /><i /></div>
          </div>

          <div className="demo demo-pedido">
            <span className="demo-pedido-icono"><Icon name="check" /></span>
            <div>
              <strong>Pedido #1042 confirmado</strong>
              <small>Campera negra M · $48.900</small>
            </div>
          </div>

          <div className="demo demo-stat">
            <small>Pedidos hoy</small>
            <strong>24</strong>
            <span className="demo-stat-sube"><Icon name="arrowUp" /> 18%</span>
            <div className="demo-barras">
              {[38, 52, 44, 66, 58, 80, 100].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}
            </div>
          </div>
        </div>
      </div>

      <ul className="vitrina-chips">
        <li><Icon name="package" /> Pedidos</li>
        <li><Icon name="message" /> Chats</li>
        <li><Icon name="inbox" /> Consultas</li>
        <li><Icon name="shoppingBag" /> Shopify</li>
      </ul>
    </aside>
  );
}

export default function Login() {
  const { usuario, shopifyPendiente, login } = useAuth();
  const location = useLocation();
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [verPassword, setVerPassword] = useState(false);
  const [mayusculas, setMayusculas] = useState(false);

  useEffect(() => { document.title = 'Ingresar — Portal de Clientes'; }, []);

  // Ya logueado (o recién logueado): si venía de un link puntual (ej. un chat)
  // vuelve ahí; si no, a su inicio.
  if (usuario) {
    const desde = location.state?.desde;
    const puedeVolver = desde && desde !== '/' && (usuario.rol === 'admin' || desde.startsWith(`/clientes/${usuario.clienteId}/`));
    return <Navigate to={puedeVolver ? desde : inicioDe(usuario, shopifyPendiente)} replace />;
  }

  const enviar = async (e) => {
    const datos = new FormData(e.currentTarget);
    setEnviando(true);
    setError(null);
    try {
      await login(datos.get('email'), datos.get('password'));
    } catch (err) {
      setError(err.message);
      setEnviando(false);
    }
  };

  const revisarMayusculas = (e) => setMayusculas(e.getModifierState?.('CapsLock') ?? false);

  return (
    <div className="login-shell">
      <Vitrina />

      <main className="login-lado">
        <div className="login-form">
          {/* En celular no se ve la vitrina: la marca va arriba del formulario. */}
          <div className="login-marca-movil">
            <span className="vitrina-logo"><Icon name="bot" /></span>
            Portal de Clientes
          </div>

          <h1 className="login-title">Ingresá a tu cuenta</h1>
          <p className="login-subtitle">Usá el email y la contraseña que te dio tu administrador.</p>

          {error && (
            <div className="login-error" role="alert">
              <Icon name="alert" />
              <span>{error}</span>
            </div>
          )}

          <Form onSubmit={enviar} onInput={() => error && setError(null)}>
            <label>
              Email
              <div className="input-icon-wrap">
                <span className="input-icon"><Icon name="mail" /></span>
                <input type="email" name="email" required autoFocus autoComplete="username" placeholder="vos@tunegocio.com" />
              </div>
            </label>
            <label>
              Contraseña
              <div className="input-icon-wrap">
                <span className="input-icon"><Icon name="lock" /></span>
                <input type={verPassword ? 'text' : 'password'} name="password" required autoComplete="current-password"
                       onKeyDown={revisarMayusculas} onKeyUp={revisarMayusculas} onBlur={() => setMayusculas(false)} />
                <button type="button" className="input-ver" onClick={() => setVerPassword(v => !v)}
                        title={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'} aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}>
                  <Icon name={verPassword ? 'eyeOff' : 'eye'} />
                </button>
              </div>
            </label>
            {mayusculas && (
              <div className="login-mayusculas"><Icon name="arrowUp" /> Bloq Mayús está activado</div>
            )}
            <button type="submit" className="btn btn-primary login-btn" disabled={enviando}>
              {enviando ? <><span className="spinner spinner-sm" /> Ingresando…</> : <>Ingresar <Icon name="arrowLeft" className="login-btn-flecha" /></>}
            </button>
          </Form>

          <p className="login-ayuda">
            <Icon name="info" />
            <span>¿Te olvidaste la contraseña? Pedile al administrador de tu cuenta que te la restablezca.</span>
          </p>
        </div>

        <footer className="login-pie">© {new Date().getFullYear()} Portal de Clientes</footer>
      </main>
    </div>
  );
}
