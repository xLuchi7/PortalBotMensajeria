import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ImportarExcel from '../components/ImportarExcel.jsx';
import { useShopifySync } from '../components/ShopifySync.jsx';
import { Empty, ErrorCarga, PageHead, PageHelp, Pagination, Stat, Stats, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';
import { plata, plural } from '../lib/format.js';

export default function Articulos() {
  useTitulo('Artículos');
  const { clienteId } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading, reload } = useApi(`/clientes/${clienteId}/articulos?page=${paginaDe(params)}`);
  const confirmar = useConfirm();
  const avisar = useAvisar();
  const [importando, setImportando] = useState(false);
  const sync = useShopifySync(clienteId, { alTerminar: reload });
  const conShopify = data?.shopifyConexion;

  const accion = async (a, que) => {
    if (que === 'desactivar') {
      const ok = await confirmar({
        titulo: '¿Desactivar artículo?',
        mensaje: `¿Desactivar «${a.nombre}»? No aparecerá más para el bot ni en el catálogo, pero se conserva el historial.`,
        boton: 'Desactivar',
      });
      if (!ok) return;
    }
    try { avisar(await api(`/clientes/${clienteId}/articulos/${a.id}/${que}`, { method: 'POST' })); } catch (err) { avisar(err); }
    reload();
  };

  return (
    <>
      <PageHead titulo="Artículos" sub="Tu catálogo: es lo que el bot ofrece y vende. Solo usa los artículos activos.">
        {data && (conShopify ? (
          <button type="button" className="btn btn-accent" onClick={sync.iniciar} disabled={sync.sincronizando}><Icon name="refresh" /> Sincronizar con Shopify</button>
        ) : (
          <>
            <button type="button" className="btn btn-accent" onClick={() => setImportando(true)}><Icon name="upload" /> Importar Excel</button>
            <Link to={`/clientes/${clienteId}/articulos/nuevo`} className="btn btn-primary"><Icon name="plus" /> Nuevo artículo</Link>
          </>
        ))}
      </PageHead>

      {conShopify ? (
        <div className="callout callout-success"><Icon name="refresh" /><div>Conectado a <strong>{conShopify.nombreTienda || conShopify.shopDomain}</strong>: nombres, precios y stock se actualizan solos y se editan en Shopify.</div></div>
      ) : data && (
        <PageHelp titulo='¿Qué es "sin control" de stock?'>
          <p>Los artículos <strong>sin control</strong> están siempre disponibles para el bot y no descuentan stock al vender. Ideal para servicios o productos que nunca se te acaban.</p>
        </PageHelp>
      )}

      <Stats>
        <Stat icono="package" valor={data?.total} texto={plural(data?.total, 'artículo')} cargando={!data} />
        <Stat icono="check" tono="success" valor={data?.activos} texto="activos para el bot" cargando={!data} />
      </Stats>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={6} />
          : !data.rows.length ? (
            <Empty icono="package" titulo="Tu catálogo está vacío">Cargá tus artículos uno por uno o importalos todos juntos desde un Excel.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Código</th><th>Nombre</th><th className="col-num">Precio</th><th className="col-center">Stock</th><th className="col-center">Estado</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(a => (
                      <FilaArticulo key={a.id} a={a} clienteId={clienteId} conexion={conShopify} onAccion={accion} onGuardado={reload} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} totalPages={data.totalPages} />
            </>
          )}
      </div>

      <ImportarExcel clienteId={clienteId} open={importando} onClose={(huboCambios) => { setImportando(false); if (huboCambios) reload(); }} />
      {sync.dialogo}
    </>
  );
}

function FilaArticulo({ a, clienteId, conexion, onAccion, onGuardado }) {
  const deShopify = conexion && a.origen === 'shopify';
  const avisar = useAvisar();
  const [stock, setStock] = useState(String(a.stock));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setStock(String(a.stock)); }, [a.stock]);
  const cambiado = stock !== String(a.stock);

  const guardarStock = async (e) => {
    e.preventDefault();
    if (stock === '' || Number(stock) < 0) return avisar(new Error('El Stock Tiene Que Ser 0 O Más'));
    setGuardando(true);
    try { avisar(await api(`/clientes/${clienteId}/articulos/${a.id}/stock`, { method: 'POST', body: { cantidad: stock } })); onGuardado(); }
    catch (err) { avisar(err); }
    setGuardando(false);
  };

  return (
    <tr className={!a.activo ? 'row-inactive' : ''}>
      <td>{a.codigo ? <span className="cell-codigo">{a.codigo}</span> : <span className="muted">—</span>}</td>
      <td><strong className="cell-nombre">{a.nombre}</strong>{a.origen === 'shopify' && <span className="badge badge-shopify">Shopify</span>}</td>
      <td className="col-num">{a.precio != null ? plata(a.precio) : '-'}</td>
      <td className="col-center">
        {deShopify ? (
          <span className={a.usaStock ? 'stock-readonly' : 'field-hint'}>{a.usaStock ? a.stock : 'sin control'}</span>
        ) : a.usaStock ? (
          <form onSubmit={guardarStock} className="stock-form">
            <input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} aria-label={`Stock de ${a.nombre}`}
                   className={`stock-input ${Number(stock) <= 0 ? 'is-empty' : ''} ${cambiado ? 'is-dirty' : ''}`} />
            <button type="submit" className={`icon-btn ${cambiado ? 'icon-btn-ok' : ''}`} title="Guardar stock" disabled={guardando || !cambiado}><Icon name="save" /></button>
          </form>
        ) : (
          <span className="field-hint">sin control</span>
        )}
      </td>
      <td className="col-center"><span className={`badge ${a.activo ? 'badge-activo' : 'badge-inactivo'}`}>{a.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <div className="cell-actions">
          {deShopify ? (
            <a href={`https://${conexion.shopDomain}/admin/products/${String(a.shopifyProductId || '').split('/').pop()}`} target="_blank" rel="noopener noreferrer" className="icon-btn" title="Editar en Shopify"><Icon name="externalLink" /></a>
          ) : (
            <>
              <Link to={`/clientes/${clienteId}/articulos/${a.id}/editar`} className="icon-btn" title="Editar"><Icon name="edit" /></Link>
              {a.activo
                ? <button type="button" className="icon-btn danger" title="Desactivar" onClick={() => onAccion(a, 'desactivar')}><Icon name="trash" /></button>
                : <button type="button" className="icon-btn" title="Reactivar" onClick={() => onAccion(a, 'activar')}><Icon name="refresh" /></button>}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
