import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Icon from './Icon.jsx';

const ToastContext = createContext(() => {});

// toast('success' | 'warning', 'Texto En Title Case'). Se cierran solos.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const siguienteId = useRef(1);

  const cerrar = useCallback(id => {
    setToasts(ts => ts.map(t => (t.id === id ? { ...t, saliendo: true } : t)));
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 220);
  }, []);

  const toast = useCallback((tipo, mensaje) => {
    if (!mensaje) return;
    const id = siguienteId.current++;
    setToasts(ts => [...ts, { id, tipo: tipo === 'success' ? 'success' : 'warning', mensaje }]);
    setTimeout(() => cerrar(id), 3200);
  }, [cerrar]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.tipo} ${t.saliendo ? 'toast-hide' : ''}`} onClick={() => cerrar(t.id)}>
            <div className="toast-icon"><Icon name={t.tipo === 'success' ? 'check' : 'alertTriangle'} /></div>
            <div className="toast-text">{t.mensaje}</div>
            <div className="toast-progress" />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

// Muestra el resultado de una respuesta de la API ({ tipo, mensaje }) o de un error.
export function useAvisar() {
  const toast = useToast();
  return useCallback((resultadoOError) => {
    if (!resultadoOError) return;
    if (resultadoOError instanceof Error) return toast('warning', resultadoOError.message);
    toast(resultadoOError.tipo || 'success', resultadoOError.mensaje);
  }, [toast]);
}
