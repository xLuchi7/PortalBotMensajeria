import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Empty, ErrorCarga, PageHead, Pagination, Stat, Stats, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';
import { iniciales, numero, plural } from '../lib/format.js';

export default function Clientes() {
  useTitulo('Clientes');
  const [params] = useSearchParams();
  const page = paginaDe(params);
  const { data, error, loading, reload } = useApi(`/clientes?page=${page}`);
  const confirmar = useConfirm();
  const avisar = useAvisar();

  const desactivar = async (c) => {
    const ok = await confirmar({
      titulo: '¿Desactivar cliente?',
      mensaje: `¿Desactivar a «${c.razonSocial}»? Deja de poder usar el bot y el portal, pero no se borra su historial.`,
      boton: 'Desactivar',
    });
    if (!ok) return;
    try { avisar(await api(`/clientes/${c.id}/desactivar`, { method: 'POST' })); reload(); } catch (err) { avisar(err); }
  };

  const activar = async (c) => {
    try { avisar(await api(`/clientes/${c.id}/activar`, { method: 'POST' })); reload(); } catch (err) { avisar(err); }
  };

  return (
    <>
      <PageHead titulo="Clientes" sub="Los negocios que usan el bot. Entrá a cualquiera para ver sus chats, pedidos y configuración.">
        <Link to="/clientes/nuevo" className="btn btn-primary"><Icon name="plus" /> Nuevo cliente</Link>
      </PageHead>

      <Stats>
        <Stat icono="briefcase" valor={data?.total} texto={plural(data?.total, 'cliente')} cargando={!data} />
        <Stat icono="check" tono="success" valor={data?.activos} texto="activos" cargando={!data} />
      </Stats>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={6} />
          : !data.rows.length ? <Empty icono="briefcase">No hay clientes cargados.</Empty>
          : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Razón social</th><th>CUIT</th><th>Teléfono</th><th>Email</th><th className="col-center">Estado</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(c => (
                      <tr key={c.id} className={!c.activo ? 'row-inactive' : ''}>
                        <td>
                          <Link to={`/clientes/${c.id}/chats`} className="cell-cliente">
                            <span className="avatar avatar-sm">{iniciales(c.razonSocial)}</span><strong>{c.razonSocial}</strong>
                          </Link>
                        </td>
                        <td className="nowrap">{c.cuit}</td>
                        <td className="nowrap">{numero(c.telefono)}</td>
                        <td>{c.email || '-'}</td>
                        <td className="col-center"><span className={`badge ${c.activo ? 'badge-activo' : 'badge-inactivo'}`}>{c.activo ? 'Activo' : 'Inactivo'}</span></td>
                        <td>
                          <div className="cell-actions">
                            <Link to={`/clientes/${c.id}/chats`} className="btn btn-accent btn-sm">Entrar <Icon name="arrowLeft" className="icon-flip" /></Link>
                            <Link to={`/clientes/${c.id}/editar`} className="icon-btn" title="Editar"><Icon name="edit" /></Link>
                            {c.activo
                              ? <button type="button" className="icon-btn danger" title="Desactivar" onClick={() => desactivar(c)}><Icon name="trash" /></button>
                              : <button type="button" className="icon-btn" title="Reactivar" onClick={() => activar(c)}><Icon name="refresh" /></button>}
                          </div>
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
