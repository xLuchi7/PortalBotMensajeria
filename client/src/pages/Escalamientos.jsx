import { useParams, useSearchParams } from 'react-router-dom';
import { CeldaFecha, Contacto, Empty, ErrorCarga, PageHead, PageHelp, Pagination, Stat, Stats, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { api, useApi } from '../lib/api.js';
import { fecha } from '../lib/format.js';

export default function Escalamientos() {
  useTitulo('Escalamientos');
  const { clienteId } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading, reload, setData } = useApi(`/clientes/${clienteId}/escalamientos?page=${paginaDe(params)}`);
  const avisar = useAvisar();
  const confirmar = useConfirm();

  const cambiarEstado = async (e, estado) => {
    if (estado === 'resuelto') {
      const ok = await confirmar({
        titulo: '¿Marcar como resuelto?',
        mensaje: 'Resuelto es un estado final: después no se puede cambiar.',
        boton: 'Marcar resuelto',
        peligro: false,
      });
      if (!ok) return;
    }
    const anterior = e.estado;
    setData(d => ({ ...d, rows: d.rows.map(r => (r.id === e.id ? { ...r, estado } : r)) }));
    try {
      avisar(await api(`/clientes/${clienteId}/escalamientos/${e.id}/estado`, { method: 'POST', body: { estado } }));
    } catch (err) {
      avisar(err);
      setData(d => ({ ...d, rows: d.rows.map(r => (r.id === e.id ? { ...r, estado: anterior } : r)) }));
    }
    reload();
  };

  return (
    <>
      <PageHead titulo="Escalamientos" sub="Casos que el bot te pasó porque necesitan una persona: reclamos, devoluciones o pedidos fuera de lo común." />
      <PageHelp titulo="¿Cómo los manejo?">
        <p>Tocá el número para abrir el chat y hablar con el cliente. Si querés atenderlo vos, pausá el bot en ese chat.</p>
        <p>Cuando lo termines, marcalo <strong>Resuelto</strong> (es un estado final). Si el reclamo está ligado a un pedido, al marcar el pedido como <strong>Solucionado</strong> el escalamiento se resuelve solo.</p>
      </PageHelp>

      <Stats>
        <Stat icono="alertTriangle" tono="danger" valor={data?.pendientes} texto="sin resolver" alerta={data?.pendientes ? 'danger' : null} cargando={!data} />
        <Stat icono="inbox" valor={data?.total} texto="en total" cargando={!data} />
      </Stats>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={4} />
          : !data.rows.length ? (
            <Empty icono="alertTriangle" titulo="Nada pendiente 🎉">Cuando el bot necesite que intervengas, el caso va a aparecer acá.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th className="col-fecha">Fecha</th><th>Cliente</th><th>Motivo</th><th className="col-center">Estado</th></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(e => (
                      <tr key={e.id} className={e.estado === 'resuelto' ? 'row-done' : ''}>
                        <td className="col-fecha"><CeldaFecha {...fecha(e.fecha)} /></td>
                        <td><Contacto clienteId={clienteId} userId={e.userId} nombre={e.contactoNombre} /></td>
                        <td className="cell-motivo">{e.motivo}</td>
                        <td className="col-center">
                          {e.estado === 'resuelto' ? (
                            <span className="badge badge-resuelto">Resuelto</span>
                          ) : (
                            <select value={e.estado} onChange={ev => cambiarEstado(e, ev.target.value)} className={`badge-select badge-${e.estado}`} aria-label="Estado del escalamiento">
                              <option value="pendiente">Pendiente</option>
                              <option value="en_proceso">En proceso</option>
                              <option value="resuelto">Resuelto</option>
                            </select>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} totalPages={data.totalPages} />
            </>
          )}
      </div>
    </>
  );
}
