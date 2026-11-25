import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Form from '../components/Form.jsx';
import { inicioDe, useAuth } from '../lib/auth.jsx';

export default function Login() {
  const { usuario, shopifyPendiente, login } = useAuth();
  const location = useLocation();
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [verPassword, setVerPassword] = useState(false);

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

  return (
    <div className="login-shell">
      <div className="login-glow login-glow-1" />
      <div className="login-glow login-glow-2" />
      <div className="login-card">
        <div className="login-badge"><Icon name="bot" /></div>
        <h1 className="login-title">Portal de Clientes</h1>
        <p className="login-subtitle">Ingresá para gestionar tu negocio</p>

        {error && <div className="alert alert-error">{error}</div>}

        <Form onSubmit={enviar}>
          <label>
            Email
            <div className="input-icon-wrap">
              <span className="input-icon"><Icon name="mail" /></span>
              <input type="email" name="email" required autoFocus autoComplete="username" />
            </div>
          </label>
          <label>
            Contraseña
            <div className="input-icon-wrap">
              <span className="input-icon"><Icon name="lock" /></span>
              <input type={verPassword ? 'text' : 'password'} name="password" required autoComplete="current-password" />
              <button type="button" className="input-ver" onClick={() => setVerPassword(v => !v)}
                      title={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'} aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}>
                <Icon name="eye" />
              </button>
            </div>
          </label>
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? <><span className="spinner spinner-sm" /> Ingresando…</> : 'Ingresar'}
          </button>
        </Form>
      </div>
    </div>
  );
}
