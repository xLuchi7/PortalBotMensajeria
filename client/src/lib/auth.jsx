import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useToast } from '../components/Toasts.jsx';

const AuthContext = createContext(null);

// Quién está logueado. Al abrir el portal se pregunta a /api/sesion, que además
// trae el toast pendiente (los que deja el flujo de Shopify al volver).
export function AuthProvider({ children }) {
  const [sesion, setSesion] = useState({ cargando: true, usuario: null, shopifyPendiente: false });
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    api('/sesion')
      .then(data => {
        setSesion({ cargando: false, usuario: data.usuario, shopifyPendiente: data.shopifyPendiente });
        if (data.flash) toast(data.flash.type, data.flash.message);
      })
      .catch(() => setSesion({ cargando: false, usuario: null, shopifyPendiente: false }));
  }, [toast]);

  // Cualquier llamada que vuelva 401 (sesión vencida) manda al login.
  useEffect(() => {
    const alVencer = () => {
      setSesion(s => (s.usuario ? { ...s, usuario: null } : s));
      toast('warning', 'Tu Sesión Venció, Volvé A Ingresar');
      navigate('/login', { replace: true });
    };
    window.addEventListener('portal:sesion-vencida', alVencer);
    return () => window.removeEventListener('portal:sesion-vencida', alVencer);
  }, [navigate, toast]);

  const login = useCallback(async (email, password) => {
    const data = await api('/login', { method: 'POST', body: { email, password } });
    setSesion({ cargando: false, usuario: data.usuario, shopifyPendiente: data.shopifyPendiente });
    return data;
  }, []);

  const logout = useCallback(async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    setSesion({ cargando: false, usuario: null, shopifyPendiente: false });
    navigate('/login', { replace: true });
  }, [navigate]);

  return <AuthContext.Provider value={{ ...sesion, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

// Adónde va cada usuario al entrar.
export function inicioDe(usuario, shopifyPendiente) {
  if (!usuario) return '/login';
  if (usuario.rol === 'admin') return '/clientes';
  // Vino desde el link de instalación de Shopify: se lo lleva a terminar la conexión.
  if (shopifyPendiente) return `/clientes/${usuario.clienteId}/integraciones`;
  return `/clientes/${usuario.clienteId}/chats`;
}
