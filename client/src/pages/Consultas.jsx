import { useParams, useSearchParams } from 'react-router-dom';
import { CeldaFecha, Contacto, Empty, ErrorCarga, PageHead, Pagination, Stat, Stats, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useApi } from '../lib/api.js';
import { fecha } from '../lib/format.js';

const ESTADO_LABEL = { pendiente: 'Pendiente', confirmado: 'Confirmado', entregado: 'Entregado', cancelado: 'Cancelado', reclamado: 'Reclamado', solucionado: 'Solucionado' };

export default function Consultas() {
  useTitulo('Consultas');
  const { clienteId } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useApi(`/clientes/${clienteId}/consultas?page=${paginaDe(params)}`);

  return (
    <>
      <PageHead titulo="Consultas" sub="Qué buscan tus clientes y quién preguntó por su pedido. Ideal para detectar productos que te faltan." />

      <Stats>
        <Stat icono="search" valor={data?.total} texto="consultas" cargando={!data} />
        <Stat icono="package" tono="warning" valor={data?.sinStock} texto="pidieron algo sin stock" alerta={data?.sinStock ? 'warning' : null} cargando={!data} />
      </Stats>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={5} />
          : !data.rows.length ? (
            <Empty icono="search" titulo="Todavía no hay consultas">Cada vez que alguien busque un producto o pregunte por su pedido, lo vas a ver acá.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th className="col-fecha">Fecha</th><th>Cliente</th><th className="col-center">Tipo</th><th>Detalle</th><th className="col-center">Estado</th></tr>
                  </thead>
                  <tbody>
                    {data.rows.map((c, i) => (
                      <tr key={`${c.tipo}-${c.id ?? i}`}>
                        <td className="col-fecha"><CeldaFecha {...fecha(c.fecha)} /></td>
                        <td><Contacto clienteId={clienteId} userId={c.userId} nombre={c.contactoNombre} /></td>
                        <td className="col-center">
                          {c.tipo === 'articulo'
                            ? <span className="badge badge-info">Artículo</span>
                            : <span className="badge badge-warning">Pedido</span>}
                        </td>
                        <td>
                          {c.tipo === 'articulo' ? (
                            <>
                              Buscó <strong>"{c.detalle}"</strong>{' '}
                              <span className="muted">→ {c.articuloNombre || 'no lo encontró'}</span>
                            </>
                          ) : (
                            <>Consultó el estado de sus pedidos{c.pedidoId ? ` — Pedido #${c.pedidoId}` : ''}</>
                          )}
                        </td>
                        <td className="col-center">
                          {c.tipo === 'articulo'
                            ? (c.sinStock ? <span className="badge badge-danger">Sin stock</span> : null)
                            : c.pedidoEstado
                              ? <span className={`badge badge-${c.pedidoEstado}`}>{ESTADO_LABEL[c.pedidoEstado] || c.pedidoEstado}</span>
                              : <span className="badge badge-danger">Sin pedidos</span>}
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
