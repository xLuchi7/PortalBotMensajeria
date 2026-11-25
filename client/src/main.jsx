import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { ToastProvider } from './components/Toasts.jsx';
import { ConfirmProvider } from './components/Confirm.jsx';
import { AuthProvider } from './lib/auth.jsx';
import App from './App.jsx';
import './styles.css';

// Router "de datos" (necesario para avisar antes de salir con cambios sin
// guardar); las rutas en sí están en App.jsx.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    ),
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
