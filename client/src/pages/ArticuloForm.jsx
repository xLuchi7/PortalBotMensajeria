import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import Form from '../components/Form.jsx';
import { Breadcrumb, ErrorCarga, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';

export default function ArticuloForm() {
  const { clienteId, id } = useParams();
  const editando = Boolean(id);
  useTitulo(editando ? 'Editar artículo' : 'Nuevo artículo');
  const { data, error, reload } = useApi(editando ? `/clientes/${clienteId}/articulos/${id}` : null);
  const navigate = useNavigate();
  const avisar = useAvisar();
  const [errorForm, setErrorForm] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [usaStock, setUsaStock] = useState(true);
  const editar = data?.articulo;
  const volver = `/clientes/${clienteId}/articulos`;

  useEffect(() => { if (editar) setUsaStock(Boolean(editar.usaStock)); }, [editar]);

  // Los artículos de Shopify se editan en Shopify: el servidor lo avisa con 409.
  const bloqueado = error?.status === 409;
  useEffect(() => { if (bloqueado) avisar(error); }, [bloqueado, error, avisar]);
  if (bloqueado) return <Navigate to={volver} replace />;
  if (editando && error && !data) return <ErrorCarga error={error} onReintentar={reload} />;
  if (editando && !editar) return <div className="card form-card"><span className="skeleton" style={{ width: '60%' }} /></div>;

  const enviar = async (e) => {
    const f = new FormData(e.currentTarget);
    const body = {
      nombre: f.get('nombre'),
      codigo: f.get('codigo'),
      descripcion: f.get('descripcion'),
      precio: f.get('precio'),
      usaStock,
      ...(editando ? {} : { cantidadInicial: f.get('cantidadInicial') || 0 }),
    };
    setEnviando(true);
    setErrorForm(null);
    try {
      avisar(await api(editando ? `/clientes/${clienteId}/articulos/${id}` : `/clientes/${clienteId}/articulos`, { method: editando ? 'PUT' : 'POST', body }));
      navigate(volver);
    } catch (err) {
      setErrorForm(err.message);
      setEnviando(false);
    }
  };

  return (
    <>
      <Breadcrumb to={volver}>Artículos</Breadcrumb>
      <div className="topbar"><h1>{editando ? 'Editar artículo' : 'Nuevo artículo'}</h1></div>

      {errorForm && <div className="alert alert-error">{errorForm}</div>}

      <div className="card form-card">
        <Form onSubmit={enviar}>
          <label>
            Nombre
            <input type="text" name="nombre" defaultValue={editar?.nombre || ''} required autoFocus />
          </label>
          <label>
            Código <span className="field-hint">(opcional, SKU interno)</span>
            <input type="text" name="codigo" defaultValue={editar?.codigo || ''} />
          </label>
          <label>
            Descripción <span className="field-hint">(opcional)</span>
            <input type="text" name="descripcion" defaultValue={editar?.descripcion || ''} />
          </label>
          <label>
            Precio
            <input type="number" name="precio" step="0.01" min="0" defaultValue={editar?.precio ?? ''} required inputMode="decimal" />
          </label>
          <label className="check-row">
            <input type="checkbox" checked={usaStock} onChange={e => setUsaStock(e.target.checked)} />
            <span>Usa control de Stock <span className="field-hint">(si lo desmarcás, el bot lo ofrece siempre disponible sin mirar Stock)</span></span>
          </label>
          {!editando && usaStock && (
            <label>
              Stock inicial
              <input type="number" name="cantidadInicial" min="0" defaultValue="0" />
            </label>
          )}
          <button type="submit" className="btn btn-primary" disabled={enviando}>
            {enviando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear artículo'}
          </button>
        </Form>
      </div>
    </>
  );
}
