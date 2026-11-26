import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { ErrorCarga } from './ui.jsx';
import { useApi } from '../lib/api.js';
import { plata } from '../lib/format.js';

// Modal con TODO lo guardado de un artículo: fotos, precios, inventario, datos de
// la tienda online, metacampos y fechas. Lo de Shopify sale de shopifyDatos (el
// JSON completo que guarda el sync).

export function nivelStock(a) {
  if (!a.usaStock) return { clase: 'stock-libre', texto: 'Sin control' };
  if (a.stock <= 0) return { clase: 'stock-bajo', texto: 'Agotado' };
  if (a.stock <= 5) return { clase: 'stock-medio', texto: `${a.stock} u.` };
  return { clase: 'stock-alto', texto: `${a.stock} u.` };
}

const ESTADOS_SHOPIFY = { ACTIVE: 'Activo', DRAFT: 'Borrador', ARCHIVED: 'Archivado', UNLISTED: 'No listado' };
const POLITICA = { DENY: 'No vender sin stock', CONTINUE: 'Seguir vendiendo sin stock' };
const UNIDADES = { KILOGRAMS: 'kg', GRAMS: 'g', POUNDS: 'lb', OUNCES: 'oz' };

function fechaHora(valor) {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

const siNo = (v) => (v == null ? null : v ? 'Sí' : 'No');
const lista = (texto) => String(texto || '').split(',').map(s => s.trim()).filter(Boolean);

export default function DetalleArticulo({ clienteId, articuloId, conexion, onClose }) {
  const { data, error, reload } = useApi(articuloId ? `/clientes/${clienteId}/articulos/${articuloId}/detalle` : null);
  const a = data?.articulo?.id === articuloId ? data.articulo : null;

  return (
    <Modal open={Boolean(articuloId)} onClose={onClose} className="modal-detalle">
      <button type="button" className="modal-cerrar" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button>
      {error && !a ? <ErrorCarga error={error} onReintentar={reload} />
        : !a ? <div className="detalle-cargando"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
        : <Contenido a={a} conexion={conexion} />}
    </Modal>
  );
}

function Contenido({ a, conexion }) {
  const p = a.shopifyDatos?.producto || {};
  const v = a.shopifyDatos?.variante || {};
  const item = v.inventoryItem || {};
  const nivel = nivelStock(a);
  const oferta = a.precioComparacion && a.precio != null && a.precioComparacion > a.precio;
  const margen = a.costo && a.precio ? Math.round(((a.precio - a.costo) / a.precio) * 100) : null;
  const peso = item.measurement?.weight;
  const metacampos = [...(p.metafields || []), ...(v.metafields || [])];
  const urlAdmin = conexion && a.shopifyProductId
    ? `https://${conexion.shopDomain}/admin/products/${String(a.shopifyProductId).split('/').pop()}` : null;

  return (
    <>
      <div className="detalle-top">
        <Galeria fotos={a.imagenes} alts={a.shopifyDatos?.imagenes} nombre={a.nombre} />

        <div className="detalle-resumen">
          <div className="detalle-badges">
            <span className={`badge ${a.activo ? 'badge-activo' : 'badge-inactivo'}`}>{a.activo ? 'Activo para el bot' : 'Inactivo'}</span>
            {a.origen === 'shopify' && <span className="badge badge-shopify">Shopify</span>}
            {oferta && <span className="badge badge-oferta">Oferta</span>}
          </div>
          <h2 className="detalle-nombre">{a.nombre}</h2>
          {(a.marca || a.tipoProducto) && <p className="detalle-sub">{[a.marca, a.tipoProducto].filter(Boolean).join(' · ')}</p>}

          <div className="detalle-precio">
            <strong>{a.precio != null ? plata(a.precio) : '—'}</strong>
            {oferta && <>
              <span className="art-precio-antes">{plata(a.precioComparacion)}</span>
              <span className="detalle-descuento">-{Math.round((1 - a.precio / a.precioComparacion) * 100)}%</span>
            </>}
          </div>

          <div className="detalle-kpis">
            <div><span>Stock</span><strong className={`stock-pill ${nivel.clase}`}>{nivel.texto}</strong></div>
            {a.costo != null && <div><span>Costo</span><strong>{plata(a.costo)}</strong></div>}
            {margen != null && <div><span>Margen</span><strong>{margen}%</strong></div>}
          </div>

          {a.opciones?.length > 0 && (
            <div className="detalle-opciones">
              {a.opciones.map(o => <span key={o.nombre} className="tag"><small>{o.nombre}</small> {o.valor}</span>)}
            </div>
          )}

          <div className="detalle-links">
            {urlAdmin && <a href={urlAdmin} target="_blank" rel="noopener noreferrer" className="btn btn-outline"><Icon name="externalLink" /> Editar en Shopify</a>}
            {a.urlTienda && <a href={a.urlTienda} target="_blank" rel="noopener noreferrer" className="btn btn-outline"><Icon name="shoppingBag" /> Ver en la tienda</a>}
          </div>
        </div>
      </div>

      {a.descripcion && (
        <Seccion titulo="Descripción">
          <p className="detalle-descripcion">{a.descripcion}</p>
        </Seccion>
      )}

      <div className="detalle-grid">
        <Seccion titulo="Identificación">
          <Datos filas={[
            ['SKU', a.codigo && <span className="cell-codigo">{a.codigo}</span>],
            ['Código de barras', a.codigoBarras],
            ['Marca', a.marca],
            ['Tipo de producto', a.tipoProducto],
            ['Categoría', a.categoria],
            ['Producto', a.origen === 'shopify' ? p.title : null],
            ['Variante', v.title && v.title !== 'Default Title' ? v.title : null],
          ]} />
        </Seccion>

        <Seccion titulo="Inventario y envío">
          <Datos filas={[
            ['Stock', a.usaStock ? `${a.stock} unidades` : 'Sin control de stock'],
            ['Stock total del producto', p.totalInventory != null && p.tracksInventory ? `${p.totalInventory} unidades` : null],
            ['Si se agota', POLITICA[v.inventoryPolicy]],
            ['Disponible para la venta', siNo(v.availableForSale)],
            ['Requiere envío', siNo(item.requiresShipping)],
            ['Peso', peso?.value ? `${peso.value} ${UNIDADES[peso.unit] || peso.unit || ''}` : null],
            ['País de origen', item.countryCodeOfOrigin],
            ['Código arancelario (HS)', item.harmonizedSystemCode],
            ['Cobra impuestos', siNo(v.taxable)],
          ]} />
        </Seccion>

        {a.origen === 'shopify' && (
          <Seccion titulo="Tienda online">
            <Datos filas={[
              ['Estado en Shopify', ESTADOS_SHOPIFY[p.status] || p.status],
              ['Publicado', fechaHora(p.publishedAt) || (p.status ? 'No publicado' : null)],
              ['URL', a.urlTienda && <a href={a.urlTienda} target="_blank" rel="noopener noreferrer">{a.urlTienda.replace(/^https?:\/\//, '')}</a>],
              ['Handle', p.handle && <span className="cell-codigo">{p.handle}</span>],
              ['Título SEO', p.seo?.title],
              ['Descripción SEO', p.seo?.description],
              ['Gift card', p.isGiftCard ? 'Sí' : null],
              ['Plantilla', p.templateSuffix],
            ]} />
          </Seccion>
        )}

        <Seccion titulo="Organización">
          <Datos filas={[
            ['Colecciones', lista(a.colecciones).length > 0 && <Chips items={lista(a.colecciones)} />],
            ['Etiquetas', lista(a.etiquetas).length > 0 && <Chips items={lista(a.etiquetas)} />],
            ['Opciones del producto', p.options?.length > 0 && p.options.some(o => o.name !== 'Title') &&
              <div className="detalle-opciones-lista">{p.options.map(o => <div key={o.name}><small>{o.name}:</small> {(o.values || []).join(', ')}</div>)}</div>],
            ['Rango de precios', p.priceRangeV2 && p.priceRangeV2.minVariantPrice?.amount !== p.priceRangeV2.maxVariantPrice?.amount
              ? `${plata(p.priceRangeV2.minVariantPrice.amount)} – ${plata(p.priceRangeV2.maxVariantPrice.amount)}` : null],
          ]} />
        </Seccion>
      </div>

      {metacampos.length > 0 && (
        <Seccion titulo="Metacampos">
          <div className="table-wrap">
            <table className="detalle-tabla">
              <thead><tr><th>Campo</th><th>Valor</th></tr></thead>
              <tbody>
                {metacampos.map(m => (
                  <tr key={`${m.namespace}.${m.key}`}>
                    <td><span className="cell-codigo">{m.namespace}.{m.key}</span></td>
                    <td className="detalle-meta-valor">{m.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Seccion>
      )}

      <Seccion titulo="Fechas">
        <Datos columnas filas={[
          ['Creado en Shopify', fechaHora(p.createdAt)],
          ['Modificado en Shopify', fechaHora(a.shopifyActualizado)],
          ['Alta en el portal', fechaHora(a.fechaAlta)],
          ['Stock actualizado', fechaHora(a.stockActualizado)],
        ]} />
      </Seccion>
    </>
  );
}

function Galeria({ fotos = [], alts = [], nombre }) {
  const [actual, setActual] = useState(0);
  useEffect(() => { setActual(0); }, [fotos]);

  if (!fotos.length) {
    return <div className="galeria galeria-vacia"><Icon name="image" /><span>Sin fotos</span></div>;
  }

  const ir = (delta) => setActual(i => (i + delta + fotos.length) % fotos.length);
  const alt = alts?.find(x => x.url === fotos[actual])?.alt || `Foto ${actual + 1} de ${nombre}`;

  return (
    <div className="galeria" onKeyDown={e => { if (e.key === 'ArrowLeft') ir(-1); if (e.key === 'ArrowRight') ir(1); }}>
      <div className="galeria-principal">
        <img src={fotos[actual]} alt={alt} />
        {fotos.length > 1 && <>
          <button type="button" className="galeria-flecha izq" onClick={() => ir(-1)} aria-label="Foto anterior"><Icon name="arrowLeft" /></button>
          <button type="button" className="galeria-flecha der" onClick={() => ir(1)} aria-label="Foto siguiente"><Icon name="arrowRight" /></button>
          <span className="galeria-contador">{actual + 1} / {fotos.length}</span>
        </>}
      </div>
      {fotos.length > 1 && (
        <div className="galeria-tiras">
          {fotos.map((url, i) => (
            <button type="button" key={url} className={`galeria-mini ${i === actual ? 'is-active' : ''}`} onClick={() => setActual(i)} aria-label={`Ver foto ${i + 1}`}>
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <p className="galeria-nota">El bot manda estas fotos por WhatsApp cuando preguntan por este artículo.</p>
    </div>
  );
}

function Seccion({ titulo, children }) {
  return (
    <section className="detalle-seccion">
      <h4>{titulo}</h4>
      {children}
    </section>
  );
}

function Datos({ filas, columnas = false }) {
  const visibles = filas.filter(([, valor]) => valor != null && valor !== '' && valor !== false);
  if (!visibles.length) return <p className="muted detalle-vacio">Sin datos cargados.</p>;
  return (
    <dl className={`detalle-datos ${columnas ? 'en-columnas' : ''}`}>
      {visibles.map(([etiqueta, valor]) => (
        <div key={etiqueta}><dt>{etiqueta}</dt><dd>{valor}</dd></div>
      ))}
    </dl>
  );
}

function Chips({ items }) {
  return <div className="tags">{items.map(t => <span key={t} className="tag">{t}</span>)}</div>;
}
