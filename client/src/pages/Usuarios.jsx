import { Link, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Empty, ErrorCarga, PageHead, Pagination, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';
import { iniciales } from '../lib/format.js';
import { useAuth } from '../lib/auth.jsx';

export default function Usuarios() {
  useTitulo('Usuarios');
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useApi(`/usuarios?page=${paginaDe(params)}`);
  const { usuario: yo } = useAuth();
  const confirmar = useConfirm();
  const avisar = useAvisar();

  const borrar = async (u) => {
    const ok = await confirmar({ titulo: '¿Borrar usuario?', mensaje: `¿Borrar el usuario «${u.email}»? No se puede deshacer.`, boton: 'Borrar' });
    if (!ok) return;
    try { avisar(await api(`/usuarios/${u.id}`, { method: 'DELETE' })); reload(); } catch (err) { avisar(err); }
  };

  return (
    <>
      <PageHead titulo="Usuarios" sub={<>Quién puede entrar al portal. Un usuario <strong>Cliente</strong> solo ve su negocio; un <strong>Admin</strong> ve todos.</>}>
        <Link to="/usuarios/nuevo" className="btn btn-primary"><Icon name="plus" /> Nuevo usuario</Link>
      </PageHead>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={5} />
          : !data.rows.length ? <Empty icono="users">No hay usuarios cargados.</Empty>
          : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Email</th><th className="col-center">Rol</th><th>Cliente</th><th className="col-center">Estado</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(u => (
                      <tr key={u.id}>
                        <td><span className="cell-cliente"><span className="avatar avatar-sm">{iniciales(u.email)}</span>{u.email}{u.id === yo.id && <span className="tag badge-neutral">Vos</span>}</span></td>
                        <td className="col-center"><span className={`badge badge-${u.rol}`}>{u.rol}</span></td>
                        <td>{u.razonSocial || '-'}</td>
                        <td className="col-center"><span className={`badge ${u.activo ? 'badge-activo' : 'badge-inactivo'}`}>{u.activo ? 'Activo' : 'Inactivo'}</span></td>
                        <td>
                          <div className="cell-actions">
                            <Link to={`/usuarios/${u.id}/editar`} className="icon-btn" title="Editar"><Icon name="edit" /></Link>
                            {u.id !== yo.id && (
                              <button type="button" className="icon-btn danger" title="Borrar" onClick={() => borrar(u)}><Icon name="trash" /></button>
                            )}
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
