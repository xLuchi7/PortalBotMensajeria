import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Form from '../components/Form.jsx';
import { Breadcrumb, ErrorCarga, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { useCliente } from '../components/Layout.jsx';
import { api, useApi } from '../lib/api.js';
import timezones from '../lib/timezones.js';

export default function ClienteForm() {
  const { clienteId } = useParams();
  const editando = Boolean(clienteId);
  useTitulo(editando ? 'Editar cliente' : 'Nuevo cliente');
  const { data, error, reload } = useApi(editando ? `/clientes/${clienteId}` : null);
  const { recargarCliente } = useCliente();
  const navigate = useNavigate();
  const avisar = useAvisar();
  const [errorForm, setErrorForm] = useState(null);
  const [enviando, setEnviando] = useState(false);

  if (editando && error && !data) return <ErrorCarga error={error} onReintentar={reload} />;
  const editar = data?.cliente;
  if (editando && !editar) return <div className="card form-card"><span className="skeleton" style={{ width: '60%' }} /></div>;

  const enviar = async (e) => {
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setEnviando(true);
    setErrorForm(null);
    try {
      const r = await api(editando ? `/clientes/${clienteId}` : '/clientes', { method: editando ? 'PUT' : 'POST', body });
      avisar(r);
      if (editando) recargarCliente();
      navigate('/clientes');
    } catch (err) {
      setErrorForm(err.message);
      setEnviando(false);
    }
  };

  return (
    <>
      <Breadcrumb to="/clientes">Clientes</Breadcrumb>
      <div className="topbar"><h1>{editando ? 'Editar cliente' : 'Nuevo cliente'}</h1></div>

      {errorForm && <div className="alert alert-error">{errorForm}</div>}

      <div className="card form-card">
        <Form onSubmit={enviar}>
          <label>
            Razón social
            <input type="text" name="razonSocial" defaultValue={editar?.razonSocial || ''} required autoFocus />
          </label>
          <label>
            CUIT
            <input type="text" name="cuit" defaultValue={editar?.cuit || ''} required />
          </label>
          <label>
            Teléfono de WhatsApp Business <span className="field-hint">(el bot lo usa para identificar al Cliente; se guardan solo los dígitos)</span>
            <input type="text" name="telefono" defaultValue={editar?.telefono || ''} required inputMode="tel" />
          </label>
          <label>
            Email <span className="field-hint">(opcional)</span>
            <input type="email" name="email" defaultValue={editar?.email || ''} />
          </label>
          <label>
            Zona horaria <span className="field-hint">(para mostrar fechas en el portal)</span>
            <select name="zonaHoraria" defaultValue={editar?.zonaHoraria || 'Argentina Standard Time'}>
              {timezones.map(tz => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear cliente'}
          </button>
        </Form>
      </div>
    </>
  );
}
