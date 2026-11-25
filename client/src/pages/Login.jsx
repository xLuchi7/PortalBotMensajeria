import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Form from '../components/Form.jsx';
import { inicioDe, useAuth } from '../lib/auth.jsx';

// Puntitos violetas y celestes que suben despacio detrás de la tarjeta.
function Particulas() {
  const ref = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const colores = ['124, 108, 255', '167, 139, 250', '96, 165, 250', '255, 255, 255'];
    const azar = (min, max) => Math.random() * (max - min) + min;
    let particulas = [];
    let frame;

    const ajustar = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    const crear = () => ({
      x: azar(0, canvas.width),
      y: azar(0, canvas.height),
      r: azar(0.6, 2.2),
      a: azar(0.12, 0.55),
      vx: azar(-0.12, 0.12),
      vy: azar(-0.22, -0.05),
      color: colores[Math.floor(Math.random() * colores.length)],
    });
    const dibujar = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particulas) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.a})`;
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        if (p.y + p.r < 0) { p.y = canvas.height + p.r; p.x = azar(0, canvas.width); }
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
      }
      frame = requestAnimationFrame(dibujar);
    };

    ajustar();
    particulas = Array.from({ length: 90 }, crear);
    window.addEventListener('resize', ajustar);
    dibujar();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', ajustar); };
  }, []);

  return <canvas ref={ref} className="login-particulas" aria-hidden="true" />;
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
      <div className="login-glow login-glow-1" />
      <div className="login-glow login-glow-2" />
      <div className="login-grid" aria-hidden="true" />
      <Particulas />

      <div className="login-card">
        <div className="login-badge"><Icon name="bot" /></div>
        <h1 className="login-title">Portal de Clientes</h1>
        <div className="login-subtitle">Ingresá para gestionar tu negocio</div>

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
                     placeholder="••••••••" onKeyDown={revisarMayusculas} onKeyUp={revisarMayusculas} onBlur={() => setMayusculas(false)} />
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
            {enviando ? <><span className="spinner spinner-sm" /> Ingresando…</> : 'Ingresar'}
          </button>
        </Form>
      </div>

      <footer className="login-footer">
        <Icon name="message" /> Pedidos, chats y consultas de tu bot de WhatsApp, en un solo lugar
      </footer>
    </div>
  );
}
