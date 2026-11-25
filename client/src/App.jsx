import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { inicioDe, useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Clientes from './pages/Clientes.jsx';
import ClienteForm from './pages/ClienteForm.jsx';
import Usuarios from './pages/Usuarios.jsx';
import UsuarioForm from './pages/UsuarioForm.jsx';
import Chats from './pages/Chats.jsx';
import Escalamientos from './pages/Escalamientos.jsx';
import Consultas from './pages/Consultas.jsx';
import Pedidos from './pages/Pedidos.jsx';
import Articulos from './pages/Articulos.jsx';
import ArticuloForm from './pages/ArticuloForm.jsx';
import Negocio from './pages/Negocio.jsx';
import Integraciones from './pages/Integraciones.jsx';
import NoEncontrada from './pages/NoEncontrada.jsx';

function PantallaCarga() {
  return <div className="pantalla-carga"><span className="spinner" /></div>;
}

// Páginas que requieren estar logueado (y, si `admin`, ser admin).
function Privada({ admin = false, children }) {
  const { usuario } = useAuth();
  const location = useLocation();
  if (!usuario) return <Navigate to="/login" replace state={{ desde: location.pathname + location.search }} />;
  if (admin && usuario.rol !== 'admin') return <Navigate to="/" replace />;
  return children;
}

function Inicio() {
  const { usuario, shopifyPendiente } = useAuth();
  return <Navigate to={inicioDe(usuario, shopifyPendiente)} replace />;
}

// La página se llamaba "Mensajes": los links viejos siguen andando.
function RedirMensajes() {
  const { clienteId } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/clientes/${clienteId}/chats${search}`} replace />;
}

export default function App() {
  const { cargando } = useAuth();
  if (cargando) return <PantallaCarga />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Privada><Layout /></Privada>}>
        <Route index element={<Inicio />} />

        <Route path="clientes" element={<Privada admin><Clientes /></Privada>} />
        <Route path="clientes/nuevo" element={<Privada admin><ClienteForm /></Privada>} />
        <Route path="clientes/:clienteId/editar" element={<Privada admin><ClienteForm /></Privada>} />
        <Route path="usuarios" element={<Privada admin><Usuarios /></Privada>} />
        <Route path="usuarios/nuevo" element={<Privada admin><UsuarioForm /></Privada>} />
        <Route path="usuarios/:id/editar" element={<Privada admin><UsuarioForm /></Privada>} />

        <Route path="clientes/:clienteId">
          <Route index element={<Navigate to="chats" replace />} />
          <Route path="chats" element={<Chats />} />
          <Route path="mensajes" element={<RedirMensajes />} />
          <Route path="escalamientos" element={<Escalamientos />} />
          <Route path="consultas" element={<Consultas />} />
          <Route path="pedidos" element={<Pedidos />} />
          <Route path="articulos" element={<Articulos />} />
          <Route path="articulos/nuevo" element={<ArticuloForm />} />
          <Route path="articulos/:id/editar" element={<ArticuloForm />} />
          <Route path="negocio" element={<Negocio />} />
          <Route path="integraciones" element={<Integraciones />} />
        </Route>

        <Route path="*" element={<NoEncontrada />} />
      </Route>
    </Routes>
  );
}
