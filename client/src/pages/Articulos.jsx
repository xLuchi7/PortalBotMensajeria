import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import ImportarExcel from '../components/ImportarExcel.jsx';
import DetalleArticulo, { nivelStock } from '../components/DetalleArticulo.jsx';
import { useShopifySync } from '../components/ShopifySync.jsx';
import { Empty, ErrorCarga, PageHead, PageHelp, Pagination, Stat, Stats, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';
import { plata, plural, query } from '../lib/format.js';

const FILTROS = [
  ['', 'Todos'],
  ['activos', 'Activos'],
  ['agotados', 'Agotados'],
  ['sinFoto', 'Sin foto'],
  ['inactivos', 'Inactivos'],
];

export default function Articulos() {
  useTitulo('Artículos');
  const { clienteId } = useParams();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const estado = params.get('estado') || '';
  const { data, error, loading, reload } = useApi(`/clientes/${clienteId}/articulos${query({ page: paginaDe(params), q, estado })}`);
  const confirmar = useConfirm();
  const avisar = useAvisar();
  const [importando, setImportando] = useState(false);
  const [detalle, setDetalle] = useState(null);
  const [busqueda, setBusqueda] = useState(q);
  const sync = useShopifySync(clienteId, { alTerminar: reload });
  const conShopify = data?.shopifyConexion;

  // El buscador escribe en la URL (?q=) con un respiro, así no se pide en cada tecla.
  useEffect(() => {
    if (busqueda.trim() === q) return;
    const t = setTimeout(() => cambiarParam('q', busqueda.trim()), 300);
    return () => clearTimeout(t);
  }, [busqueda]); // eslint-disable-line react-hooks/exhaustive-deps

  function cambiarParam(clave, valor) {
    const nuevos = new URLSearchParams(params);
    if (valor) nuevos.set(clave, valor); else nuevos.delete(clave);
    nuevos.delete('page');
    setParams(nuevos, { replace: clave === 'q' });
  }

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

  const filtrando = Boolean(q || estado);

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
        <div className={`callout ${conShopify.estado === 'error' ? 'callout-danger' : 'callout-success'}`}>
          <Icon name={conShopify.estado === 'error' ? 'alertTriangle' : 'refresh'} />
          <div>
            Conectado a <strong>{conShopify.nombreTienda || conShopify.shopDomain}</strong>: nombres, precios, fotos y stock se actualizan solos y se editan en Shopify.
            {conShopify.estado === 'error' && conShopify.ultimoError && <div className="callout-detalle">Último error: {conShopify.ultimoError}</div>}
          </div>
        </div>
      ) : data && (
        <PageHelp titulo='¿Qué es "sin control" de stock?'>
          <p>Los artículos <strong>sin control</strong> están siempre disponibles para el bot y no descuentan stock al vender. Ideal para servicios o productos que nunca se te acaban.</p>
        </PageHelp>
      )}

      <Stats>
        <Stat icono="package" valor={data?.total} texto={plural(data?.total, 'artículo')} cargando={!data} />
        <Stat icono="check" tono="success" valor={data?.activos} texto="activos para el bot" cargando={!data} />
        <Stat icono="alertTriangle" tono="danger" valor={data?.agotados} texto={plural(data?.agotados, 'agotado')} cargando={!data} />
        <Stat icono="image" tono="info" valor={data?.conFoto} texto="activos con foto" cargando={!data} />
      </Stats>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        <div className="tabla-toolbar">
          <label className="buscador">
            <Icon name="search" />
            <input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                   placeholder="Buscar por nombre, código, marca, etiqueta…" aria-label="Buscar artículos" />
            {busqueda && <button type="button" className="buscador-limpiar" onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda"><Icon name="x" /></button>}
          </label>
          <div className="tabs-mini" role="tablist" aria-label="Filtrar por estado">
            {FILTROS.map(([valor, texto]) => (
              <button key={valor} type="button" role="tab" aria-selected={estado === valor} className={estado === valor ? 'active' : ''} onClick={() => cambiarParam('estado', valor)}>{texto}</button>
            ))}
          </div>
          {data && filtrando && <span className="tabla-toolbar-info">{data.filtrados} de {data.total}</span>}
        </div>

        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={5} />
          : !data.rows.length ? (
            filtrando
              ? <Empty icono="search" titulo="No encontramos artículos">Probá con otra palabra o sacá el filtro.</Empty>
              : <Empty icono="package" titulo="Tu catálogo está vacío">Cargá tus artículos uno por uno o importalos todos juntos desde un Excel.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="tabla-articulos">
                  <thead>
                    <tr><th>Artículo</th><th className="col-num">Precio</th><th className="col-center">Stock</th><th className="col-center">Estado</th><th /></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(a => (
                      <FilaArticulo key={a.id} a={a} clienteId={clienteId} conexion={conShopify} onAccion={accion} onGuardado={reload} onDetalle={() => setDetalle(a.id)} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} totalPages={data.totalPages} />
            </>
          )}
      </div>

      <ImportarExcel clienteId={clienteId} open={importando} onClose={(huboCambios) => { setImportando(false); if (huboCambios) reload(); }} />
      <DetalleArticulo clienteId={clienteId} articuloId={detalle} conexion={conShopify} onClose={() => setDetalle(null)} />
      {sync.dialogo}
    </>
  );
}

function FilaArticulo({ a, clienteId, conexion, onAccion, onGuardado, onDetalle }) {
  const deShopify = conexion && a.origen === 'shopify';
  const avisar = useAvisar();
  const [stock, setStock] = useState(String(a.stock));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { setStock(String(a.stock)); }, [a.stock]);
  const cambiado = stock !== String(a.stock);
  const nivel = nivelStock(a);
  const fotos = a.imagenes || [];
  const oferta = a.precioComparacion && a.precio != null && a.precioComparacion > a.precio;

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
      <td>
        <div className="art-cell">
          <button type="button" className={`art-thumb ${fotos.length ? '' : 'is-empty'}`} onClick={onDetalle}
                  title={fotos.length ? `Ver ${fotos.length === 1 ? 'la foto' : `las ${fotos.length} fotos`}` : 'Sin foto: ver info'}>
            {fotos.length ? <img src={fotos[0]} alt="" loading="lazy" /> : <Icon name="image" />}
            {fotos.length > 1 && <span className="art-thumb-count">+{fotos.length - 1}</span>}
          </button>
          <div className="art-info">
            <button type="button" className="art-nombre" onClick={onDetalle}>{a.nombre}</button>
            <div className="art-meta">
              {a.codigo && <span className="cell-codigo">{a.codigo}</span>}
              {a.marca && <span>{a.marca}</span>}
              {a.origen === 'shopify' && <span className="badge badge-shopify">Shopify</span>}
            </div>
          </div>
        </div>
      </td>
      <td className="col-num">
        {a.precio != null ? <strong className="art-precio">{plata(a.precio)}</strong> : <span className="muted">—</span>}
        {oferta && <span className="art-precio-antes">{plata(a.precioComparacion)}</span>}
      </td>
      <td className="col-center">
        {!deShopify && a.usaStock ? (
          <form onSubmit={guardarStock} className="stock-form">
            <input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} aria-label={`Stock de ${a.nombre}`}
                   className={`stock-input ${Number(stock) <= 0 ? 'is-empty' : ''} ${cambiado ? 'is-dirty' : ''}`} />
            <button type="submit" className={`icon-btn ${cambiado ? 'icon-btn-ok' : ''}`} title="Guardar stock" disabled={guardando || !cambiado}><Icon name="save" /></button>
          </form>
        ) : (
          <span className={`stock-pill ${nivel.clase}`}>{nivel.texto}</span>
        )}
      </td>
      <td className="col-center"><span className={`badge ${a.activo ? 'badge-activo' : 'badge-inactivo'}`}>{a.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <div className="cell-actions">
          <button type="button" className="icon-btn" title="Ver toda la info" onClick={onDetalle}><Icon name="info" /></button>
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
