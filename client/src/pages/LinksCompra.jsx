import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { CeldaFecha, Contacto, Empty, ErrorCarga, PageHead, PageHelp, Pagination, Stat, Stats, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';
import { useEnVivo } from '../lib/eventos.jsx';
import { fecha, plata, plural } from '../lib/format.js';

// Estado del link: [texto, tono del badge, explicación].
const ESTADO = {
  enviado: ['Sin comprar', 'neutral', 'El bot mandó el link y la persona todavía no terminó la compra'],
  comprado: ['Pago pendiente', 'warning', 'Hizo la compra en la tienda y falta el pago'],
  pagado: ['Pagado', 'success', 'Compra pagada en la tienda'],
  cancelado: ['Cancelado', 'danger', 'La orden se canceló en Shopify'],
};
const ENVIO = { parcial: 'Despacho parcial', despachado: 'Despachado', entregado: 'Recibido' };
const PERIODOS = [[7, '7 días'], [30, '30 días'], [90, '90 días'], [null, 'Todo']];

function porcentaje(parte, total) {
  return total ? `${Math.round((parte / total) * 100)}%` : '-';
}

export default function LinksCompra() {
  useTitulo('Links de Compra');
  const { clienteId } = useParams();
  const [params, setParams] = useSearchParams();
  const estado = ESTADO[params.get('estado')] ? params.get('estado') : '';
  const dias = ['7', '30', '90'].includes(params.get('dias')) ? Number(params.get('dias')) : null;
  const query = new URLSearchParams({ page: paginaDe(params), ...(estado ? { estado } : {}), ...(dias ? { dias } : {}) });
  const { data, error, loading, reload } = useApi(`/clientes/${clienteId}/links-compra?${query}`);
  // Links nuevos del bot y compras que llegan de Shopify (lib/eventos.jsx).
  useEnVivo(['pedido'], reload);
  const [detalle, setDetalle] = useState(null);

  const cambiar = (cambios) => {
    const nuevos = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) nuevos.set(k, v); else nuevos.delete(k);
    }
    nuevos.delete('page');
    setParams(nuevos, { replace: true });
  };

  const r = data?.resumen;
  const sinShopify = data && !data.config;
  const periodo = dias ? `en los últimos ${dias} días` : 'en total';

  return (
    <>
      <PageHead titulo="Links de Compra" sub="Los pedidos que el bot cerró mandando el link de tu tienda, y cuáles terminaron en una compra pagada." />
      <PageHelp titulo="¿Cómo funciona?">
        <p>Cuando un cliente confirma lo que quiere por WhatsApp, el bot le manda un link a tu tienda de Shopify con el carrito <strong>ya armado</strong>. Ahí completa sus datos de envío y paga, sin tener que buscar los productos.</p>
        <p>Cada link queda registrado acá como <strong>Sin comprar</strong>. Cuando la persona termina la compra, Shopify nos avisa y pasa a <strong>Pago pendiente</strong> o directo a <strong>Pagado</strong>, con el número de pedido de tu tienda. Si cancelás la orden en Shopify, acá queda <strong>Cancelado</strong>.</p>
        <p>La venta por link se prende y se apaga en <Link to={`/clientes/${clienteId}/integraciones`}>Integraciones</Link>. El despacho y el seguimiento se manejan en Shopify, como cualquier venta de tu tienda.</p>
      </PageHelp>

      {sinShopify && (
        <div className="alert alert-info">Para vender con link de compra, conectá tu tienda de Shopify en <Link to={`/clientes/${clienteId}/integraciones`}>Integraciones</Link>.</div>
      )}
      {data?.config && !data.config.activo && (
        <div className="alert alert-warning">La venta por link está apagada: el bot está tomando los pedidos como antes (en Pedidos). Activala en <Link to={`/clientes/${clienteId}/integraciones`}>Integraciones</Link>.</div>
      )}

      <div className="links-toolbar">
        <div className="segmentado" role="radiogroup" aria-label="Período">
          {PERIODOS.map(([d, label]) => (
            <button key={label} type="button" role="radio" aria-checked={dias === d} className={dias === d ? 'active' : ''}
                    onClick={() => cambiar({ dias: d ? String(d) : '' })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <Stats>
        <Stat icono="link" valor={r?.links} texto={`${plural(r?.links, 'link enviado', 'links enviados')} ${periodo}`} cargando={!r} />
        <Stat icono="shoppingBag" tono="warning" valor={r?.comprados} texto={`${plural(r?.comprados, 'compra hecha', 'compras hechas')} · ${porcentaje(r?.comprados, r?.links)} de los links`} cargando={!r} />
        <Stat icono="checkCircle" tono="success" valor={r?.pagados} texto={`${plural(r?.pagados, 'compra pagada', 'compras pagadas')} · ${porcentaje(r?.pagados, r?.links)} de conversión`} cargando={!r} />
        <Stat icono="wallet" tono="success" valor={r && plata(r.montoPagado)} texto={r?.montoPendiente ? `cobrado · ${plata(r.montoPendiente)} por cobrar` : 'cobrado con links'} cargando={!r} />
      </Stats>

      <div className="chip-row links-filtros">
        <button type="button" className={`chip ${!estado ? 'active' : ''}`} onClick={() => cambiar({ estado: '' })}>
          Todos <span>{r ? r.links : '·'}</span>
        </button>
        {Object.entries(ESTADO).map(([clave, [label]]) => {
          const n = r ? { enviado: r.sinComprar, comprado: r.comprados - r.pagados, pagado: r.pagados, cancelado: r.cancelados }[clave] : null;
          return (
            <button key={clave} type="button" className={`chip ${estado === clave ? 'active' : ''}`}
                    onClick={() => cambiar({ estado: estado === clave ? '' : clave })}>
              {label} <span>{n ?? '·'}</span>
            </button>
          );
        })}
      </div>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={6} />
          : !data.rows.length ? (
            <Empty icono="link" titulo={estado || dias ? 'No hay links con este filtro' : 'Todavía no hay links de compra'}>
              {estado || dias ? 'Probá con otro período o estado.' : 'Cuando un cliente confirme un pedido por WhatsApp, el bot le va a mandar el link de tu tienda y lo vas a ver acá.'}
            </Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="col-id">#</th><th className="col-fecha">Enviado</th><th>Cliente</th><th>Artículos</th>
                      <th className="col-num">Total</th><th className="col-center">Estado</th><th className="col-center">Shopify</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(l => (
                      <tr key={l.id}>
                        <td className="cell-id">#{l.id}</td>
                        <td className="col-fecha"><CeldaFecha {...fecha(l.fecha)} /></td>
                        <td><Contacto clienteId={clienteId} userId={l.userId} nombre={l.contactoNombre} /></td>
                        <td><ResumenItems items={l.items} unidades={l.unidades} /></td>
                        <td className="col-num">
                          <strong>{plata(l.totalCompra ?? l.total)}</strong>
                          {l.totalCompra != null && Number(l.totalCompra) !== Number(l.total) && (
                            <small className="links-total-link" title="Total de los productos que mandó el bot (sin envío ni descuentos)">link: {plata(l.total)}</small>
                          )}
                        </td>
                        <td className="col-center"><EstadoLink link={l} /></td>
                        <td className="col-center"><OrdenShopify link={l} shopDomain={data.shopDomain} /></td>
                        <td>
                          <button type="button" className="icon-btn" title="Ver detalle" onClick={() => setDetalle(l)}><Icon name="eye" /></button>
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

      {detalle && <DetalleLink link={detalle} clienteId={clienteId} onCerrar={() => setDetalle(null)} />}
    </>
  );
}

function ResumenItems({ items, unidades }) {
  if (!items?.length) return <span className="field-hint">-</span>;
  const primero = items[0];
  return (
    <div className="links-items" title={items.map(i => `${i.cantidad}x ${i.nombre}`).join('\n')}>
      <span>{primero.cantidad}x {primero.nombre}</span>
      {items.length > 1 && <small>y {items.length - 1} más · {unidades} {plural(unidades, 'unidad', 'unidades')}</small>}
    </div>
  );
}

function EstadoLink({ link: l }) {
  const [texto, tono, ayuda] = ESTADO[l.estado] || [l.estado, 'neutral', ''];
  return <span className={`badge badge-${tono}`} title={ayuda}>{texto}</span>;
}

function OrdenShopify({ link: l, shopDomain }) {
  if (!l.shopifyOrderId) return <span className="field-hint">-</span>;
  const id = String(l.shopifyOrderId).split('/').pop();
  const envio = l.estado !== 'cancelado' ? ENVIO[l.shopifyEnvio] : null;
  return (
    <div className="shopify-cell">
      {shopDomain ? (
        <a href={`https://${shopDomain}/admin/orders/${id}`} target="_blank" rel="noopener noreferrer" title="Ver en Shopify">
          {l.shopifyOrderName || 'Ver'}<Icon name="externalLink" />
        </a>
      ) : <span>{l.shopifyOrderName || '-'}</span>}
      {envio && <div className="shopify-etiquetas"><span className="badge badge-sm badge-info">{envio}</span></div>}
    </div>
  );
}

function DetalleLink({ link: l, clienteId, onCerrar }) {
  const avisar = useAvisar();
  let acumulado = 0;
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(l.url);
      avisar({ tipo: 'success', mensaje: 'Link Copiado' });
    } catch {
      avisar({ tipo: 'warning', mensaje: 'No Se Pudo Copiar El Link' });
    }
  };
  return (
    <Modal open onClose={onCerrar} wide>
      <h3>Link de compra #{l.id}</h3>
      <div className="pedido-shopify">
        <div className="pedido-shopify-datos">
          <div><span>Estado</span><strong>{(ESTADO[l.estado] || [l.estado])[0]}</strong></div>
          <div><span>Enviado</span><strong>{l.fecha}</strong></div>
          {l.fechaCompra && <div><span>Compra</span><strong>{l.fechaCompra}</strong></div>}
          {l.fechaPago && <div><span>Pago</span><strong>{l.fechaPago}</strong></div>}
          {l.shopifyOrderName && <div><span>Pedido en Shopify</span><strong>{l.shopifyOrderName}</strong></div>}
          {l.totalCompra != null && <div><span>Total cobrado</span><strong>{plata(l.totalCompra)}{l.moneda ? ` ${l.moneda}` : ''}</strong></div>}
        </div>
      </div>
      <div className="table-wrap" style={{ marginBottom: '1rem' }}>
        <table>
          <thead>
            <tr><th>Artículo</th><th className="col-center">Cantidad</th><th>Precio unitario</th><th>Subtotal</th><th>Total</th></tr>
          </thead>
          <tbody>
            {(l.items || []).map((i, n) => {
              const subtotal = Number(i.precio) * Number(i.cantidad);
              acumulado += subtotal;
              return (
                <tr key={n}>
                  <td>{i.nombre}</td>
                  <td className="col-center">{i.cantidad}</td>
                  <td>{plata(i.precio)}</td>
                  <td>{plata(subtotal)}</td>
                  <td>{plata(acumulado)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="field-hint">Precios del momento en que el bot mandó el link (sin envío). Lo que se cobró de verdad es el total del pedido en Shopify.</p>
      <div className="links-url">
        <code>{l.url}</code>
        <button type="button" className="icon-btn" title="Copiar link" onClick={copiar}><Icon name="copy" /></button>
      </div>
      <div className="modal-actions">
        <Link className="btn btn-outline" to={`/clientes/${clienteId}/chats?chat=${encodeURIComponent(l.userId)}`}><Icon name="message" /> Ver chat</Link>
        <button type="button" className="btn btn-primary" onClick={onCerrar}>Cerrar</button>
      </div>
    </Modal>
  );
}
