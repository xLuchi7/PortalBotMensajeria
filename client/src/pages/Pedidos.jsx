import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import { CeldaFecha, Contacto, Empty, ErrorCarga, PageHead, PageHelp, Pagination, Stat, Stats, TablaCargando, paginaDe, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { api, useApi } from '../lib/api.js';
import { useEnVivo } from '../lib/eventos.jsx';
import { fecha, plata, plural } from '../lib/format.js';

const ESTADOS_FINALES = ['entregado', 'cancelado', 'solucionado'];
const ESTADO_LABEL = { pendiente: 'Pendiente', confirmado: 'Confirmado', entregado: 'Entregado', cancelado: 'Cancelado', reclamado: 'Reclamado', solucionado: 'Solucionado' };

// Lo que Shopify nos cuenta del pedido (webhook orders/updated): [texto, tono del badge].
const PAGO = {
  pendiente: ['Pago pendiente', 'warning'],
  parcial: ['Pago parcial', 'warning'],
  pagado: ['Pagado', 'success'],
  reembolsado: ['Reembolsado', 'neutral'],
  anulado: ['Pago anulado', 'danger'],
};
const ENVIO = {
  sin_enviar: ['Sin despachar', 'neutral'],
  parcial: ['Despacho parcial', 'info'],
  despachado: ['Despachado', 'info'],
  entregado: ['Recibido', 'success'],
};
const AVISO_ESTADO = {
  enviado: ['Enviado', 'success'],
  enviando: ['Enviando', 'neutral'],
  fuera_de_ventana: ['No enviado', 'warning'],
  error: ['Error', 'danger'],
};

export default function Pedidos() {
  useTitulo('Pedidos');
  const { clienteId } = useParams();
  const [params] = useSearchParams();
  const { data, error, loading, reload, setData } = useApi(`/clientes/${clienteId}/pedidos?page=${paginaDe(params)}`);
  // Pedidos nuevos del bot o cambios que llegan de Shopify (lib/eventos.jsx).
  useEnVivo(['pedido'], reload);
  const avisar = useAvisar();
  const confirmar = useConfirm();
  const [notas, setNotas] = useState(null); // { id, texto }
  const [detalle, setDetalle] = useState(null); // { id, items, error }
  const [ocupado, setOcupado] = useState(null); // id del pedido que se está guardando

  const conShopify = data?.shopifyConexion;
  const mostrarShopify = conShopify || data?.rows.some(p => p.shopifyEstado);

  const cambiarEstado = async (p, estado) => {
    if (ESTADOS_FINALES.includes(estado)) {
      const ok = await confirmar({
        titulo: `¿Marcar el pedido #${p.id} como ${ESTADO_LABEL[estado]}?`,
        mensaje: `${ESTADO_LABEL[estado]} es un estado final: después no se puede cambiar.${estado === 'cancelado' && p.shopifyOrderId ? ' También se cancela en Shopify.' : ''}`,
        boton: `Marcar ${ESTADO_LABEL[estado]}`,
        peligro: estado === 'cancelado',
      });
      if (!ok) return;
    }
    setOcupado(p.id);
    setData(d => ({ ...d, rows: d.rows.map(r => (r.id === p.id ? { ...r, estado } : r)) }));
    try {
      avisar(await api(`/clientes/${clienteId}/pedidos/${p.id}/estado`, { method: 'POST', body: { estado } }));
    } catch (err) {
      avisar(err);
    }
    setOcupado(null);
    reload();
  };

  const reintentar = async (p) => {
    setOcupado(p.id);
    try { avisar(await api(`/clientes/${clienteId}/pedidos/${p.id}/shopify/reintentar`, { method: 'POST' })); } catch (err) { avisar(err); }
    setOcupado(null);
    reload();
  };

  const guardarNotas = async (e) => {
    e.preventDefault();
    try {
      avisar(await api(`/clientes/${clienteId}/pedidos/${notas.id}/notas`, { method: 'POST', body: { notas: notas.texto } }));
      setData(d => ({ ...d, rows: d.rows.map(r => (r.id === notas.id ? { ...r, notas: notas.texto } : r)) }));
      setNotas(null);
    } catch (err) {
      avisar(err);
    }
  };

  const abrirDetalle = async (p) => {
    setDetalle({ id: p.id, pedido: p, items: null });
    try {
      const r = await api(`/clientes/${clienteId}/pedidos/${p.id}/detalle`);
      setDetalle(d => (d && d.id === p.id ? { ...d, items: r.items, avisos: r.avisos } : d));
    } catch {
      setDetalle(d => (d && d.id === p.id ? { ...d, error: true } : d));
    }
  };

  return (
    <>
      <PageHead titulo="Pedidos" sub="Lo que tus clientes compraron por WhatsApp. Cambiá el estado desde la etiqueta de cada pedido." />
      <PageHelp titulo="¿Cómo funcionan los estados?">
        {conShopify ? (
          <>
            <p>Al pasar un pedido a <strong>Confirmado</strong> se crea en tu tienda de Shopify con el pago pendiente y Shopify descuenta el stock. Si lo cancelás después, también se cancela en Shopify.</p>
            <p>De ahí en más, lo que hagas en Shopify vuelve solo: el pago, el despacho con su seguimiento y las cancelaciones. Cuando lo despachás en Shopify, acá pasa a <strong>Entregado</strong>. Si activaste los avisos en Integraciones, el bot le escribe al cliente.</p>
            <p>Un pedido pasa a <strong>Reclamado</strong> solo cuando el bot detecta un reclamo; al marcarlo <strong>Solucionado</strong> se resuelve el escalamiento asociado (la devolución de stock se maneja en Shopify).</p>
          </>
        ) : (
          <>
            <p>Al marcar un pedido como <strong>Entregado</strong> se descuenta el stock de cada artículo.</p>
            <p>Un pedido pasa a <strong>Reclamado</strong> solo cuando el bot detecta un reclamo; al marcarlo <strong>Solucionado</strong> se devuelve el stock y se resuelve el escalamiento asociado.</p>
          </>
        )}
        <p><strong>Entregado</strong>, <strong>Cancelado</strong> y <strong>Solucionado</strong> son estados finales: después no se pueden cambiar.</p>
      </PageHelp>

      <Stats>
        <Stat icono="truck" valor={data?.total} texto={`${plural(data?.total, 'pedido')} en total`} cargando={!data} />
        <Stat icono="wallet" tono="success" valor={data && plata(data.totalMonto)} texto="vendido por el bot" cargando={!data} />
        <Stat icono="clock" tono="warning" valor={data?.pendientes} texto="esperando confirmación" alerta={data?.pendientes ? 'warning' : null} cargando={!data} />
        <Stat icono="alertTriangle" tono="danger" valor={data?.reclamados} texto="con reclamo" alerta={data?.reclamados ? 'danger' : null} cargando={!data} />
      </Stats>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={7} />
          : !data.rows.length ? (
            <Empty icono="truck" titulo="Todavía no hay pedidos">Cuando un cliente confirme una compra por WhatsApp, el pedido va a aparecer acá.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="col-id">#</th><th className="col-fecha">Fecha</th><th>Cliente</th><th className="col-num">Total</th>
                      <th className="col-center">Estado</th>{mostrarShopify && <th className="col-center">Shopify</th>}<th>Notas</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(p => (
                      <tr key={p.id} className={ocupado === p.id ? 'row-saving' : ''}>
                        <td className="cell-id">#{p.id}</td>
                        <td className="col-fecha"><CeldaFecha {...fecha(p.fecha)} /></td>
                        <td><Contacto clienteId={clienteId} userId={p.userId} nombre={p.contactoNombre} /></td>
                        <td className="col-num"><strong>{plata(p.total)}</strong></td>
                        <td className="col-center"><EstadoPedido pedido={p} onCambiar={e => cambiarEstado(p, e)} deshabilitado={ocupado === p.id} /></td>
                        {mostrarShopify && (
                          <td className="col-center">
                            <CeldaShopify pedido={p} conexion={conShopify} onReintentar={() => reintentar(p)} ocupado={ocupado === p.id} />
                          </td>
                        )}
                        <td>
                          <div className="notas-cell">
                            <span>{p.notas || '-'}</span>
                            <button type="button" className="icon-btn" title="Editar notas" onClick={() => setNotas({ id: p.id, texto: p.notas || '' })}><Icon name="edit" /></button>
                          </div>
                        </td>
                        <td>
                          <button type="button" className="icon-btn" title="Ver detalle" onClick={() => abrirDetalle(p)}><Icon name="eye" /></button>
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

      <Modal open={Boolean(notas)} onClose={() => setNotas(null)}>
        {notas && (
          <form onSubmit={guardarNotas}>
            <h3>Notas del pedido #{notas.id}</h3>
            <textarea rows={5} maxLength={500} placeholder="Sin notas" value={notas.texto} autoFocus
                      onChange={e => setNotas(n => ({ ...n, texto: e.target.value }))} />
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setNotas(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Guardar</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={Boolean(detalle)} onClose={() => setDetalle(null)} wide>
        {detalle && <DetallePedido detalle={detalle} onCerrar={() => setDetalle(null)} />}
      </Modal>
    </>
  );
}

function EstadoPedido({ pedido: p, onCambiar, deshabilitado }) {
  if (ESTADOS_FINALES.includes(p.estado)) {
    return <span className={`badge badge-${p.estado}`}>{ESTADO_LABEL[p.estado]}</span>;
  }
  const opciones = p.estado === 'reclamado'
    ? ['reclamado', 'solucionado']
    : ['pendiente', 'confirmado', 'entregado', 'cancelado'];
  return (
    <select value={p.estado} onChange={e => onCambiar(e.target.value)} disabled={deshabilitado}
            className={`badge-select badge-${p.estado}`} aria-label={`Estado del pedido #${p.id}`}>
      {opciones.map(o => <option key={o} value={o}>{ESTADO_LABEL[o]}</option>)}
    </select>
  );
}

function CeldaShopify({ pedido: p, conexion, onReintentar, ocupado }) {
  if (p.shopifyOrderId) {
    const id = String(p.shopifyOrderId).split('/').pop();
    return (
      <div className="shopify-cell">
        {conexion ? (
          <a href={`https://${conexion.shopDomain}/admin/orders/${id}`} target="_blank" rel="noopener noreferrer"
             title={p.shopifyError || (p.shopifyEstado === 'cancelado' ? 'Cancelado en Shopify' : 'Ver en Shopify')}>
            {p.shopifyOrderName || 'Ver'}<Icon name="externalLink" />
          </a>
        ) : (
          <span>{p.shopifyOrderName || '-'}</span>
        )}
        {p.shopifyError && <span title={p.shopifyError} style={{ color: 'var(--warning)', display: 'inline-flex' }}><Icon name="alertTriangle" /></span>}
        {p.shopifyEstado !== 'cancelado' && <EtiquetasShopify pedido={p} />}
      </div>
    );
  }
  if (p.shopifyEstado === 'error' || p.shopifyEstado === 'enviando') {
    return (
      <div className="shopify-cell">
        {p.shopifyEstado === 'error'
          ? <span className="badge badge-cancelado" style={{ width: 'auto' }} title={p.shopifyError}>Error</span>
          : <span className="field-hint">Enviando…</span>}
        {conexion && (
          <button type="button" className="icon-btn" disabled={ocupado} onClick={onReintentar}
                  title={p.shopifyEstado === 'error' ? `Reintentar envío a Shopify: ${p.shopifyError}` : 'Reintentar envío a Shopify'}>
            <Icon name="refresh" />
          </button>
        )}
      </div>
    );
  }
  return <div className="shopify-cell"><span className="field-hint">-</span></div>;
}

// Pago y envío según Shopify; si hay seguimiento, el camión lleva al link.
function EtiquetasShopify({ pedido: p }) {
  const pago = PAGO[p.shopifyPago];
  const envio = p.shopifyEnvio && p.shopifyEnvio !== 'sin_enviar' ? ENVIO[p.shopifyEnvio] : null;
  if (!pago && !envio) return null;
  return (
    <div className="shopify-etiquetas">
      {pago && <span className={`badge badge-sm badge-${pago[1]}`}>{pago[0]}</span>}
      {envio && (p.trackingUrl ? (
        <a href={p.trackingUrl} target="_blank" rel="noopener noreferrer" className={`badge badge-sm badge-${envio[1]}`}
           title={`Seguir el envío${p.trackingEmpresa ? ` (${p.trackingEmpresa})` : ''}`}>
          <Icon name="truck" />{envio[0]}
        </a>
      ) : (
        <span className={`badge badge-sm badge-${envio[1]}`} title={p.trackingNumero ? `Seguimiento: ${p.trackingNumero}` : undefined}>{envio[0]}</span>
      ))}
    </div>
  );
}

function ShopifyDelPedido({ pedido: p, avisos }) {
  if (!p?.shopifyOrderId) return null;
  const pago = PAGO[p.shopifyPago];
  const envio = ENVIO[p.shopifyEnvio];
  return (
    <div className="pedido-shopify">
      <div className="pedido-shopify-datos">
        <div><span>Pedido en Shopify</span><strong>{p.shopifyOrderName || '-'}</strong></div>
        <div><span>Pago</span><strong>{pago ? pago[0] : 'Sin novedades'}</strong></div>
        <div><span>Envío</span><strong>{envio ? envio[0] : 'Sin novedades'}</strong></div>
        {(p.trackingUrl || p.trackingNumero) && (
          <div>
            <span>Seguimiento{p.trackingEmpresa ? ` · ${p.trackingEmpresa}` : ''}</span>
            <strong>{p.trackingUrl
              ? <a href={p.trackingUrl} target="_blank" rel="noopener noreferrer">{p.trackingNumero || 'Ver envío'} <Icon name="externalLink" /></a>
              : p.trackingNumero}</strong>
          </div>
        )}
      </div>
      {avisos?.length > 0 && (
        <div className="pedido-avisos">
          <div className="pedido-avisos-titulo"><Icon name="send" /> Avisos por WhatsApp</div>
          {avisos.map(a => {
            const [texto, tono] = AVISO_ESTADO[a.estado] || [a.estado, 'neutral'];
            return (
              <div key={a.id} className="pedido-aviso">
                <span>{a.nombre}</span>
                <span className="field-hint">{a.fecha}{a.via === 'plantilla' ? ' · con plantilla' : ''}</span>
                <span className={`badge badge-sm badge-${tono}`} title={a.detalle || undefined}>{texto}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetallePedido({ detalle, onCerrar }) {
  let acumulado = 0;
  return (
    <>
      <h3>Pedido #{detalle.id}</h3>
      <ShopifyDelPedido pedido={detalle.pedido} avisos={detalle.avisos} />
      <div className="table-wrap" style={{ marginBottom: '1.1rem' }}>
        <table>
          <thead>
            <tr><th>Artículo</th><th className="col-center">Cantidad</th><th>Precio unitario</th><th>Subtotal</th><th>Total</th></tr>
          </thead>
          <tbody>
            {detalle.error ? (
              <tr><td colSpan={5}>Ocurrió un error al cargar el detalle.</td></tr>
            ) : !detalle.items ? (
              <tr><td colSpan={5}><span className="skeleton" style={{ width: '70%' }} /></td></tr>
            ) : detalle.items.map((i, n) => {
              acumulado += Number(i.subtotal);
              return (
                <tr key={n}>
                  <td>{i.nombre}</td>
                  <td className="col-center">{i.cantidad}</td>
                  <td>{plata(i.precioUnitario)}</td>
                  <td>{plata(i.subtotal)}</td>
                  <td>{plata(acumulado)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onCerrar}>Cerrar</button>
      </div>
    </>
  );
}
