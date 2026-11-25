import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Form from '../components/Form.jsx';
import { Breadcrumb, ErrorCarga, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';

export default function UsuarioForm() {
  const { id } = useParams();
  const editando = Boolean(id);
  useTitulo(editando ? 'Editar usuario' : 'Nuevo usuario');
  const usuarioApi = useApi(editando ? `/usuarios/${id}` : null);
  const clientesApi = useApi('/usuarios/clientes-activos');
  const navigate = useNavigate();
  const avisar = useAvisar();
  const [errorForm, setErrorForm] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [rol, setRol] = useState('cliente');

  const editar = usuarioApi.data?.usuario;
  useEffect(() => { if (editar) setRol(editar.rol); }, [editar]);

  const error = usuarioApi.error || clientesApi.error;
  if (error && !(clientesApi.data && (!editando || editar))) return <ErrorCarga error={error} onReintentar={() => { usuarioApi.reload(); clientesApi.reload(); }} />;
  if (!clientesApi.data || (editando && !editar)) return <div className="card form-card"><span className="skeleton" style={{ width: '60%' }} /></div>;

  const enviar = async (e) => {
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setEnviando(true);
    setErrorForm(null);
    try {
      avisar(await api(editando ? `/usuarios/${id}` : '/usuarios', { method: editando ? 'PUT' : 'POST', body }));
      navigate('/usuarios');
    } catch (err) {
      setErrorForm(err.message);
      setEnviando(false);
    }
  };

  return (
    <>
      <Breadcrumb to="/usuarios">Usuarios</Breadcrumb>
      <div className="topbar"><h1>{editando ? 'Editar usuario' : 'Nuevo usuario'}</h1></div>

      {errorForm && <div className="alert alert-error">{errorForm}</div>}

      <div className="card form-card">
        <Form onSubmit={enviar} key={editar?.id || 'nuevo'}>
          <label>
            Email
            <input type="email" name="email" defaultValue={editar?.email || ''} required autoFocus autoComplete="off" />
          </label>
          <label>
            Contraseña {editando && <span className="field-hint">(dejar en blanco para no cambiarla)</span>}
            <input type="password" name="password" required={!editando} autoComplete="new-password" />
          </label>
          <label>
            Rol
            <select name="rol" value={rol} onChange={e => setRol(e.target.value)}>
              <option value="cliente">Cliente</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          {rol !== 'admin' && (
            <label>
              Cliente
              <select name="clienteId" defaultValue={editar?.clienteId || ''} required>
                <option value="">-- Seleccionar --</option>
                {clientesApi.data.clientes.map(c => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
              </select>
            </label>
          )}
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </Form>
      </div>
    </>
  );
}
