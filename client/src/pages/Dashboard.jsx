import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import Modal from '../components/Modal.jsx';
import Form from '../components/Form.jsx';
import { ErrorCarga, PageHead, PageHelp, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { api, useApi } from '../lib/api.js';
import { useEnVivo } from '../lib/eventos.jsx';

// Dashboard de rentabilidad: ventas de la tienda de Shopify + inversión en Meta
// Ads + lo que se queda Mercado Pago + los costos que carga el negocio = cuánto
// se gana de verdad. Todo en dólares (el servidor convierte día por día). Los datos
// vienen de GET /clientes/:id/dashboard (el servidor sincroniza en segundo plano
// y avisa con el evento 'pedido' cuando entra algo nuevo).

// ── Formatos ────────────────────────────────────────────────────────────────

// Todo el Dashboard está en dólares.
const signo = n => (n < 0 ? '−' : '');
const US = 'US$';
function dinero(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e6) return `${signo(n)}${US} ${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 2 })} M`;
  return `${signo(n)}${US} ${a.toLocaleString('es-AR', { minimumFractionDigits: a < 1000 ? 2 : 0, maximumFractionDigits: a < 1000 ? 2 : 0 })}`;
}
function dineroCorto(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${signo(n)}${US}${(a / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
  if (a >= 1e3) return `${signo(n)}${US}${(a / 1e3).toLocaleString('es-AR', { maximumFractionDigits: a >= 1e4 ? 0 : 1 })}k`;
  return `${signo(n)}${US}${Math.round(a)}`;
}
const cotizacionTexto = n => n.toLocaleString('es-AR', { maximumFractionDigits: n >= 100 ? 0 : 2 });
const entero = n => (n == null ? '–' : Math.round(n).toLocaleString('es-AR'));
const enteroCorto = n => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M` : Math.abs(n) >= 1e4 ? `${Math.round(n / 1e3)}k` : entero(n));
const porc = n => (n == null ? '–' : `${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`);
const veces = n => (n == null ? '–' : `${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`);

const DIAS_SEMANA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const fechaCorta = iso => { const d = new Date(`${iso}T12:00:00Z`); return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`; };
const fechaLarga = iso => { const d = new Date(`${iso}T12:00:00Z`); return `${DIAS_SEMANA[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`; };

function hace(iso) {
  if (!iso) return null;
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

// ── Fechas ──────────────────────────────────────────────────────────────────

function hoyIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function sumarDias(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function rangoDe(clave) {
  const hoy = hoyIso();
  const [a, m] = hoy.split('-').map(Number);
  switch (clave) {
    case 'hoy': return [hoy, hoy];
    case 'ayer': return [sumarDias(hoy, -1), sumarDias(hoy, -1)];
    case '30': return [sumarDias(hoy, -29), hoy];
    case '90': return [sumarDias(hoy, -89), hoy];
    case 'mes': return [`${hoy.slice(0, 8)}01`, hoy];
    case 'mesPasado': {
      const ini = new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 10);
      const fin = new Date(Date.UTC(a, m - 1, 0)).toISOString().slice(0, 10);
      return [ini, fin];
    }
    default: return [sumarDias(hoy, -6), hoy];
  }
}
const PRESETS = [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7', '7 días'], ['30', '30 días'], ['mes', 'Este mes'], ['mesPasado', 'Mes pasado'], ['90', '90 días']];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── Métricas ────────────────────────────────────────────────────────────────
// bueno: si que suba es bueno ('sube'), malo ('baja') o ninguna de las dos (null).
// pp: la variación va en puntos porcentuales (para porcentajes).

const M = {
  ventas: { label: 'Facturación', fmt: dinero, bueno: 'sube', ayuda: 'Lo que cobraste en el período: total de las órdenes (con envío e impuestos) menos reembolsos. No cuenta las canceladas.' },
  ordenes: { label: 'Órdenes', fmt: entero, bueno: 'sube', ayuda: 'Órdenes de tu tienda en el período, sin las canceladas.' },
  inversion: { label: 'Inversión publicitaria', fmt: dinero, bueno: null, ayuda: 'Lo que gastaste en anuncios de Meta (Facebook e Instagram).' },
  ganancia: { label: 'Ganancia', fmt: dinero, bueno: 'sube', ayuda: 'Facturación menos impuestos, costo de productos, envíos, comisiones (las reales de Mercado Pago, si está conectado), publicidad y costos fijos. Lo que te queda en el bolsillo.' },
  margen: { label: 'Margen de ganancia', fmt: porc, bueno: 'sube', pp: true, ayuda: 'Qué parte de cada venta es ganancia (ganancia ÷ facturación).' },
  roas: { label: 'ROAS', fmt: veces, bueno: 'sube', ayuda: 'Facturación ÷ inversión publicitaria: cuánto vendiste por cada US$ 1 en anuncios (todas las ventas, no solo las que Meta se atribuye).' },
  roasEquilibrio: { label: 'ROAS de equilibrio', fmt: veces, bueno: 'baja', ayuda: 'El ROAS mínimo para no perder plata con la publicidad, según tus costos. Si tu ROAS queda por debajo, los anuncios te cuestan más de lo que te dejan.' },
  cpa: { label: 'Costo por orden', fmt: dinero, bueno: 'baja', ayuda: 'Inversión publicitaria ÷ órdenes (CPA): cuánto te cuesta en anuncios conseguir cada venta.' },
  ventasNetas: { label: 'Facturación neta', fmt: dinero, bueno: 'sube', ayuda: 'Facturación sin impuestos ni lo que cobraste de envío: lo que dejaron los productos.' },
  ticket: { label: 'Ticket promedio', fmt: dinero, bueno: 'sube', ayuda: 'Facturación ÷ órdenes: cuánto gasta en promedio cada compra.' },
  unidades: { label: 'Unidades vendidas', fmt: entero, bueno: 'sube', ayuda: 'Productos vendidos (sin los devueltos).' },
  ventasWhatsapp: { label: 'Vendido por WhatsApp', fmt: dinero, bueno: 'sube', ayuda: 'Órdenes que salieron del bot: links de compra y pedidos del portal enviados a Shopify.' },
  descuentos: { label: 'Descuentos', fmt: dinero, bueno: null, ayuda: 'Descuentos y cupones aplicados en las órdenes.' },
  reembolsado: { label: 'Reembolsos', fmt: dinero, bueno: 'baja', ayuda: 'Plata devuelta a clientes en órdenes del período.' },
  costoProductos: { label: 'Costo de productos', fmt: dinero, bueno: null, ayuda: 'Lo que te costaron los productos vendidos, según el costo cargado en Shopify (o el % por defecto de tus costos).' },
  comisiones: { label: 'Comisiones de pago', fmt: dinero, bueno: 'baja', ayuda: 'Lo que cobran los medios de pago. Con Mercado Pago conectado es lo que te cobró de verdad; el % de Costos se aplica solo a lo que no pasó por Mercado Pago.' },
  costoEnvios: { label: 'Costos de envío', fmt: dinero, bueno: null, ayuda: 'Lo que te cuestan los envíos, según el costo por orden que cargaste en Costos.' },
  canceladas: { label: 'Canceladas', fmt: entero, bueno: 'baja', ayuda: 'Órdenes canceladas en el período (no suman en ningún otro número).' },
  impresiones: { label: 'Impresiones', fmt: entero, bueno: 'sube', ayuda: 'Veces que se mostraron tus anuncios.' },
  clics: { label: 'Clics', fmt: entero, bueno: 'sube', ayuda: 'Clics en tus anuncios.' },
  ctr: { label: 'CTR', fmt: porc, bueno: 'sube', pp: true, ayuda: 'Clics ÷ impresiones: qué tan atractivos son tus anuncios.' },
  cpc: { label: 'Costo por clic', fmt: dinero, bueno: 'baja', ayuda: 'Inversión ÷ clics.' },
  cpm: { label: 'CPM', fmt: dinero, bueno: 'baja', ayuda: 'Lo que cuesta mostrar tus anuncios 1.000 veces.' },
  comprasMeta: { label: 'Compras según Meta', fmt: entero, bueno: 'sube', ayuda: 'Compras que Meta le atribuye a tus anuncios (con su pixel).' },
  roasMeta: { label: 'ROAS según Meta', fmt: veces, bueno: 'sube', ayuda: 'Valor de las compras que Meta se atribuye ÷ inversión. Suele ser distinto del ROAS real.' },
  conversaciones: { label: 'Conversaciones iniciadas', fmt: entero, bueno: 'sube', ayuda: 'Chats de WhatsApp o Messenger que arrancaron desde un anuncio.' },
  costoConversacion: { label: 'Costo por conversación', fmt: dinero, bueno: 'baja', ayuda: 'Inversión ÷ conversaciones iniciadas desde anuncios.' },
  cobradoMp: { label: 'Cobrado con Mercado Pago', fmt: dinero, bueno: 'sube', ayuda: 'Pagos aprobados en tu cuenta de Mercado Pago (sin lo devuelto).' },
  costoMp: { label: 'Se quedó Mercado Pago', fmt: dinero, bueno: 'baja', ayuda: 'Comisión, costo de cuotas y retenciones: la diferencia entre lo que pagó el cliente y lo que te llegó.' },
  netoMp: { label: 'Te llegó', fmt: dinero, bueno: 'sube', ayuda: 'Lo cobrado menos lo que se quedó Mercado Pago: la plata que entra de verdad a tu cuenta.' },
  comisionMpPct: { label: 'Comisión efectiva', fmt: porc, bueno: 'baja', pp: true, ayuda: 'Qué parte de cada cobro se queda Mercado Pago (se quedó ÷ cobrado). Sube con las cuotas sin interés.' },
  pagosMp: { label: 'Pagos aprobados', fmt: entero, bueno: 'sube', ayuda: 'Cantidad de cobros aprobados en Mercado Pago.' },
  ticketMp: { label: 'Cobro promedio', fmt: dinero, bueno: 'sube', ayuda: 'Cobrado ÷ pagos aprobados.' },
  devueltoMp: { label: 'Devuelto y contracargos', fmt: dinero, bueno: 'baja', ayuda: 'Plata devuelta a compradores o perdida por contracargos en Mercado Pago.' },
};

const SECCIONES = [
  { id: 'principales', titulo: 'Métricas principales', icono: 'sparkles', metricas: ['ventas', 'ordenes', 'inversion', 'ganancia', 'margen', 'roas', 'roasEquilibrio', 'cpa'] },
  { id: 'tienda', titulo: 'Tienda', icono: 'shoppingBag', metricas: ['ventasNetas', 'ticket', 'unidades', 'ventasWhatsapp', 'descuentos', 'reembolsado', 'costoProductos', 'comisiones'] },
  { id: 'meta', titulo: 'Meta Ads', icono: 'megaphone', metricas: ['inversion', 'impresiones', 'ctr', 'cpc', 'comprasMeta', 'roasMeta', 'conversaciones', 'costoConversacion'] },
  { id: 'mp', titulo: 'Mercado Pago', icono: 'wallet', metricas: ['cobradoMp', 'costoMp', 'netoMp', 'comisionMpPct', 'pagosMp', 'ticketMp', 'devueltoMp', 'comisiones'] },
];
const FILTROS = [['todas', 'Todas'], ['principales', 'Métricas principales'], ['resultado', 'Resultado'], ['tienda', 'Tienda'], ['meta', 'Meta Ads'], ['mp', 'Mercado Pago']];
const CLAVE_OCULTAS = 'portal.dashboardOcultas';

function variacion(m, valor, previo) {
  if (valor == null || previo == null) return null;
  if (m.pp) {
    const d = (valor - previo) * 100;
    if (Math.abs(d) < 0.05) return { texto: '=', tono: 'igual' };
    const bien = m.bueno == null ? null : (d > 0) === (m.bueno === 'sube');
    return { texto: `${d > 0 ? '+' : '−'}${Math.abs(d).toLocaleString('es-AR', { maximumFractionDigits: 1 })} pp`, tono: bien == null ? 'neutro' : bien ? 'bien' : 'mal' };
  }
  if (!previo) return valor ? { texto: 'Nuevo', tono: 'neutro' } : null;
  const pct = ((valor - previo) / Math.abs(previo)) * 100;
  if (Math.abs(pct) < 0.5) return { texto: '=', tono: 'igual' };
  const bien = m.bueno == null ? null : (pct > 0) === (m.bueno === 'sube');
  const n = Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)).toLocaleString('es-AR') : Math.abs(pct).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  return { texto: `${pct > 0 ? '+' : '−'}${n}%`, tono: bien == null ? 'neutro' : bien ? 'bien' : 'mal' };
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  useTitulo('Dashboard');
  const { clienteId } = useParams();
  const [params, setParams] = useSearchParams();
  const avisar = useAvisar();

  const preset = params.get('rango') || (params.get('desde') ? null : '7');
  const [desdeDef, hastaDef] = rangoDe(preset || '7');
  const desde = !preset && FECHA_RE.test(params.get('desde') || '') ? params.get('desde') : desdeDef;
  const hasta = !preset && FECHA_RE.test(params.get('hasta') || '') ? params.get('hasta') : hastaDef;
  const filtro = FILTROS.some(([f]) => f === params.get('ver')) ? params.get('ver') : 'todas';

  const { data, error, loading, reload } = useApi(`/clientes/${clienteId}/dashboard?desde=${desde}&hasta=${hasta}`);
  useEnVivo(['pedido'], reload);

  // Mientras el servidor sincroniza (primera vez, o "Actualizar"), se vuelve a pedir cada unos segundos.
  const sincronizando = Boolean(data?.sincronizando?.shopify || data?.sincronizando?.meta || data?.sincronizando?.mercadoPago);
  const completandoCot = Boolean(data?.cotizacion?.completando);
  useEffect(() => {
    if (!sincronizando && !completandoCot) return undefined;
    const t = setTimeout(reload, sincronizando ? 4000 : 6000);
    return () => clearTimeout(t);
  }, [sincronizando, completandoCot, data, reload]);

  // Vuelta del OAuth de Meta con varias cuentas publicitarias: se abre el selector.
  const elegirCuentaMeta = params.get('meta') === 'elegir';
  const [modal, setModal] = useState(() => (elegirCuentaMeta ? 'meta' : null)); // 'costos' | 'meta' | 'mp'
  const [ocultas, setOcultas] = useState(() => {
    try { return JSON.parse(localStorage.getItem(CLAVE_OCULTAS)) || []; } catch { return []; }
  });
  const alternarSeccion = (id) => setOcultas((prev) => {
    const nuevas = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    try { localStorage.setItem(CLAVE_OCULTAS, JSON.stringify(nuevas)); } catch { /* modo privado */ }
    return nuevas;
  });

  const cambiar = (cambios) => {
    const nuevos = new URLSearchParams(params);
    for (const [k, v] of Object.entries(cambios)) {
      if (v) nuevos.set(k, v); else nuevos.delete(k);
    }
    setParams(nuevos, { replace: true });
  };
  const elegirPreset = clave => cambiar({ rango: clave === '7' ? '' : clave, desde: '', hasta: '' });
  const elegirFechas = (d, h) => {
    if (!FECHA_RE.test(d) || !FECHA_RE.test(h)) return;
    const [a, b] = d <= h ? [d, h] : [h, d];
    cambiar({ rango: '', desde: a, hasta: b });
  };

  const cerrarModal = () => {
    setModal(null);
    if (elegirCuentaMeta) cambiar({ meta: '' });
  };

  const actualizar = async () => {
    try { avisar(await api(`/clientes/${clienteId}/dashboard/actualizar`, { method: 'POST', body: { desde: data?.rango.previoDesde } })); setTimeout(reload, 1500); } catch (err) { avisar(err); }
  };

  const ver = id => (filtro === 'todas' || filtro === id);
  const sinNada = data && !data.shopify && !data.meta && !data.mercadoPago;

  return (
    <div className="dash">
      <PageHead titulo="Dashboard" sub="Cuánto vendés, cuánto invertís en publicidad y cuánto ganás de verdad. Todo en dólares.">
        <button type="button" className="btn btn-outline" onClick={() => setModal('costos')}><Icon name="sliders" /> Costos</button>
        <BotonConexion label="Meta Ads" icono="megaphone" conexion={data?.meta} onClick={() => setModal('meta')} />
        <BotonConexion label="Mercado Pago" icono="wallet" conexion={data?.mercadoPago} onClick={() => setModal('mp')} />
      </PageHead>

      <PageHelp titulo="¿De dónde salen estos números?">
        <p><strong>Ventas y productos</strong> salen de tu tienda de Shopify (las órdenes de todos los canales: web, WhatsApp, punto de venta…). <strong>La inversión en publicidad</strong> sale de tu cuenta publicitaria de Meta y <strong>las comisiones reales</strong>, de tu cuenta de Mercado Pago. Todo se actualiza solo.</p>
        <p><strong>Todo está en dólares.</strong> Lo que se vende en otra moneda se pasa con la cotización de cada día (o con una cotización fija, si la cargás en Costos).</p>
        <p>Para que la <strong>ganancia</strong> sea real, cargá el costo de cada producto en Shopify (campo “Costo por artículo”), conectá Mercado Pago y completá en <strong>Costos</strong> lo que falta: lo que te cuesta cada envío y tus gastos fijos del mes.</p>
        <p>Cada número se compara con el período anterior de la misma duración. En verde lo que mejoró, en rojo lo que empeoró.</p>
      </PageHelp>

      <div className="dash-toolbar">
        <div className="dash-filtros chip-row" role="tablist" aria-label="Secciones">
          {FILTROS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filtro === id} className={`chip ${filtro === id ? 'active' : ''}`}
                    onClick={() => cambiar({ ver: id === 'todas' ? '' : id })}>{label}</button>
          ))}
        </div>
        <SelectorFechas desde={desde} hasta={hasta} preset={preset} onPreset={elegirPreset} onFechas={elegirFechas} />
      </div>

      <EstadoDatos data={data} sincronizando={sincronizando} onActualizar={actualizar} clienteId={clienteId} />

      {error && !data ? <div className="card"><ErrorCarga error={error} onReintentar={reload} /></div>
        : sinNada ? <Bienvenida clienteId={clienteId} onMeta={() => setModal('meta')} onMp={() => setModal('mp')} />
        : (
          <div className={`dash-cuerpo ${loading && data ? 'is-recargando' : ''}`}>
            <Avisos data={data} clienteId={clienteId} onCostos={() => setModal('costos')} onMeta={() => setModal('meta')} onMp={() => setModal('mp')} />

            {ver('principales') && (
              <Seccion seccion={SECCIONES[0]} data={data} oculta={ocultas.includes('principales')} onAlternar={alternarSeccion} />
            )}

            {ver('resultado') && (
              <div className="dash-resultado">
                <Grafico data={data} />
                <Cascada data={data} />
              </div>
            )}
            {ver('resultado') && data && <Conclusiones data={data} />}

            {ver('tienda') && (
              <Seccion seccion={SECCIONES[1]} data={data} oculta={ocultas.includes('tienda')} onAlternar={alternarSeccion}
                       vacia={data && !data.shopify ? <SinShopify clienteId={clienteId} /> : null}>
                <div className="dash-dos">
                  <Productos data={data} />
                  <Canales data={data} />
                </div>
              </Seccion>
            )}

            {ver('meta') && (
              <Seccion seccion={SECCIONES[2]} data={data} oculta={ocultas.includes('meta')} onAlternar={alternarSeccion}
                       vacia={data && !data.meta ? <SinMeta onConectar={() => setModal('meta')} /> : null}>
                <Campanias data={data} />
              </Seccion>
            )}

            {ver('mp') && (
              <Seccion seccion={SECCIONES[3]} data={data} oculta={ocultas.includes('mp')} onAlternar={alternarSeccion}
                       vacia={data && !data.mercadoPago ? <SinMp onConectar={() => setModal('mp')} /> : null}>
                <MediosMp data={data} />
              </Seccion>
            )}
          </div>
        )}

      <Modal open={modal === 'costos'} onClose={cerrarModal} wide>
        {modal === 'costos' && data && <FormCostos clienteId={clienteId} data={data} onClose={cerrarModal} onGuardado={reload} />}
      </Modal>
      <Modal open={modal === 'meta'} onClose={cerrarModal} wide>
        {modal === 'meta' && <FormMeta clienteId={clienteId} data={data} elegir={elegirCuentaMeta} desde={data?.rango.previoDesde} onClose={cerrarModal} onGuardado={reload} />}
      </Modal>
      <Modal open={modal === 'mp'} onClose={cerrarModal} wide>
        {modal === 'mp' && <FormMp clienteId={clienteId} data={data} onClose={cerrarModal} onGuardado={reload} />}
      </Modal>
    </div>
  );
}

// ── Barra de fechas ─────────────────────────────────────────────────────────

function SelectorFechas({ desde, hasta, preset, onPreset, onFechas }) {
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState(desde);
  const [h, setH] = useState(hasta);
  const ref = useRef(null);
  useEffect(() => { setD(desde); setH(hasta); }, [desde, hasta]);
  useEffect(() => {
    if (!abierto) return undefined;
    const cerrar = (e) => { if (!ref.current?.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', cerrar);
    return () => document.removeEventListener('mousedown', cerrar);
  }, [abierto]);
  const etiqueta = desde === hasta ? fechaLarga(desde) : `${fechaCorta(desde)} – ${fechaCorta(hasta)} ${hasta.slice(0, 4)}`;

  return (
    <div className="dash-fechas" ref={ref}>
      <button type="button" className="btn btn-outline dash-fechas-boton" aria-expanded={abierto} onClick={() => setAbierto(a => !a)}>
        <Icon name="calendar" /> {etiqueta}
      </button>
      {abierto && (
        <div className="dash-fechas-panel">
          <div className="dash-presets">
            {PRESETS.map(([clave, label]) => (
              <button key={clave} type="button" className={preset === clave ? 'active' : ''}
                      onClick={() => { onPreset(clave); setAbierto(false); }}>{label}</button>
            ))}
          </div>
          <div className="dash-fechas-custom">
            <label>Desde<input type="date" value={d} max={h} onChange={e => setD(e.target.value)} /></label>
            <label>Hasta<input type="date" value={h} min={d} max={hoyIso()} onChange={e => setH(e.target.value)} /></label>
            <button type="button" className="btn btn-primary" onClick={() => { onFechas(d, h); setAbierto(false); }}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function EstadoDatos({ data, sincronizando, onActualizar, clienteId }) {
  useAhora(30000);
  if (!data) return <div className="dash-estado"><span className="skeleton" style={{ width: 220 }} /></div>;
  const s = data.shopify;
  const m = data.meta;
  const p = data.mercadoPago;
  const c = data.cotizacion || {};
  return (
    <div className="dash-estado">
      {s && (
        <span className={`dash-fuente ${s.ultimoError ? 'is-error' : ''}`} title={s.ultimoError || `${entero(s.ordenes)} órdenes guardadas`}>
          <span className="dash-punto" /> Shopify{s.nombreTienda ? ` · ${s.nombreTienda}` : ''}
          <small>{data.sincronizando.shopify ? (s.ordenes ? `trayendo órdenes… (${entero(s.ordenes)})` : 'trayendo órdenes…') : s.ultimoError ? 'con error' : hace(s.ultimaSync) || 'pendiente'}</small>
        </span>
      )}
      {m && (
        <span className={`dash-fuente ${m.estado === 'error' ? 'is-error' : ''}`} title={m.ultimoError || m.nombreCuenta || ''}>
          <span className="dash-punto" /> Meta Ads{m.nombreCuenta ? ` · ${m.nombreCuenta}` : ''}
          <small>{data.sincronizando.meta ? 'actualizando…' : m.estado === 'error' ? 'con error' : hace(m.ultimaSync) || 'pendiente'}</small>
        </span>
      )}
      {p && (
        <span className={`dash-fuente ${p.estado === 'error' ? 'is-error' : ''}`} title={p.ultimoError || `${entero(p.pagos)} pagos guardados`}>
          <span className="dash-punto" /> Mercado Pago{p.nickname ? ` · ${p.nickname}` : ''}
          <small>{data.sincronizando.mercadoPago ? (p.pagos ? `trayendo pagos… (${entero(p.pagos)})` : 'trayendo pagos…') : p.estado === 'error' ? 'con error' : hace(p.ultimaSync) || 'pendiente'}</small>
        </span>
      )}
      {!s && <Link to={`/clientes/${clienteId}/integraciones`} className="dash-fuente is-off"><span className="dash-punto" /> Shopify sin conectar</Link>}
      {c.moneda && c.valor && (
        <span className="dash-fuente is-cotizacion" title={c.fija ? 'Cotización fija (la cargaste en Costos)' : 'Cotización del día: cada día se convierte con la suya'}>
          US$ 1 = {cotizacionTexto(c.valor)} {c.moneda}
          <small>{c.completando ? 'completando días…' : c.fija ? 'fija' : 'automática'}</small>
        </span>
      )}
      <button type="button" className="icon-btn dash-actualizar" onClick={onActualizar} disabled={sincronizando} title="Traer lo último de Shopify, Meta y Mercado Pago">
        <span className={sincronizando ? 'girando' : ''}><Icon name="refresh" /></span>
      </button>
    </div>
  );
}

function useAhora(cadaMs) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set(x => x + 1), cadaMs); return () => clearInterval(t); }, [cadaMs]);
}

// ── Avisos ──────────────────────────────────────────────────────────────────

function Avisos({ data, clienteId, onCostos, onMeta, onMp }) {
  if (!data) return null;
  const lista = [];
  if (data.shopify?.ultimoError) {
    lista.push(<>No pudimos traer las órdenes de Shopify: {data.shopify.ultimoError} <Link to={`/clientes/${clienteId}/integraciones`}>Ver Integraciones</Link></>);
  }
  if (data.meta?.estado === 'error') lista.push(<>Meta Ads: {data.meta.ultimoError || 'no pudimos traer el gasto.'} <button type="button" className="link-btn" onClick={onMeta}>Reconectar</button></>);
  if (data.avisos.includes('metaVence')) {
    lista.push(<>El acceso a Meta Ads vence pronto. <button type="button" className="link-btn" onClick={onMeta}>Volvé a conectar con Facebook</button> para que no se corte.</>);
  }
  if (data.mercadoPago?.estado === 'error') lista.push(<>Mercado Pago: {data.mercadoPago.ultimoError || 'no pudimos traer los pagos.'} <button type="button" className="link-btn" onClick={onMp}>Reconectar</button></>);
  if (data.avisos.includes('sinCotizacion')) {
    lista.push(<>No conseguimos la cotización del dólar para <strong>{data.cotizacion.sinCotizacion.join(', ')}</strong>: esos montos no están convertidos. Cargá una cotización fija en <button type="button" className="link-btn" onClick={onCostos}>Costos</button>.</>);
  }
  if (data.avisos.includes('sinCosto')) {
    lista.push(<>Hay productos vendidos <strong>sin costo cargado en Shopify</strong>: la ganancia está inflada. Cargá el “Costo por artículo” en Shopify o un % de costo por defecto en <button type="button" className="link-btn" onClick={onCostos}>Costos</button>.</>);
  }
  if (data.avisos.includes('historiaCorta')) {
    lista.push(<>Tenemos órdenes desde el <strong>{fechaLarga(data.shopify.primeraFecha)}</strong>: Shopify solo deja ver los últimos 60 días si la app no tiene el permiso <code>read_all_orders</code>. Lo anterior a esa fecha sale en cero.</>);
  }
  if (!lista.length) return null;
  return (
    <div className="dash-avisos">
      {lista.map((a, i) => <div key={i} className="alert alert-warning">{a}</div>)}
    </div>
  );
}

// ── Tarjetas ────────────────────────────────────────────────────────────────

function Seccion({ seccion, data, oculta, onAlternar, vacia, children }) {
  return (
    <section className={`dash-seccion ${oculta ? 'is-oculta' : ''}`}>
      <div className="dash-seccion-head">
        <h2><span className={`dash-seccion-icono is-${seccion.id}`}><Icon name={seccion.icono} /></span> {seccion.titulo}</h2>
        <button type="button" className="icon-btn" onClick={() => onAlternar(seccion.id)} title={oculta ? 'Mostrar' : 'Ocultar'} aria-expanded={!oculta}>
          <Icon name={oculta ? 'eye' : 'eyeOff'} />
        </button>
      </div>
      {!oculta && (vacia || (
        <>
          <div className="dash-tarjetas">
            {seccion.metricas.map(clave => <Tarjeta key={clave} clave={clave} data={data} />)}
          </div>
          {children}
        </>
      ))}
    </section>
  );
}

function Tarjeta({ clave, data }) {
  const m = M[clave];
  const valor = data?.totales.actual[clave];
  const previo = data?.totales.previo[clave];
  const v = data ? variacion(m, valor, previo) : null;
  const negativo = clave === 'ganancia' && valor < 0;
  return (
    <div className="dash-tarjeta">
      <div className="dash-tarjeta-top">
        <span className="dash-tarjeta-titulo">{m.label}</span>
        <span className="dash-info" tabIndex={0} aria-label={m.ayuda}><Icon name="info" /><span className="dash-tip" role="tooltip">{m.ayuda}</span></span>
      </div>
      <div className="dash-tarjeta-valor">
        {data ? <strong className={negativo ? 'is-negativo' : ''}>{m.fmt(valor)}</strong> : <span className="skeleton skeleton-num" />}
        {v && <span className={`dash-delta is-${v.tono}`} title={`Período anterior: ${m.fmt(previo)}`}>{v.texto}</span>}
      </div>
      {data && <Sparkline valores={data.serie.map(s => s[clave] ?? 0)} />}
    </div>
  );
}

function Sparkline({ valores }) {
  const max = Math.max(...valores);
  // Base en el mínimo (no en 0): así se ve la tendencia también en CTR, ROAS, etc.
  const min = Math.min(...valores);
  if (valores.length < 2 || max === min) return <div className="dash-spark is-vacia" />;
  const paso = 100 / (valores.length - 1);
  const pts = valores.map((v, i) => [i * paso, 4 + (1 - (v - min) / (max - min)) * 30]);
  // Curva suave (Catmull-Rom → Bézier) para que se lea como tendencia, no como dato exacto.
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i - 1] || pts[i];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[i + 2] || pts[i + 1];
    d += ` C${x1 + (x2 - x0) / 6},${y1 + (y2 - y0) / 6} ${x2 - (x3 - x1) / 6},${y2 - (y3 - y1) / 6} ${x2},${y2}`;
  }
  return (
    <svg className="dash-spark" viewBox="0 0 100 38" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L100,38 L0,38 Z`} className="dash-spark-area" />
      <path d={d} className="dash-spark-linea" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Gráfico grande ──────────────────────────────────────────────────────────

const VISTAS_GRAFICO = {
  plata: {
    label: 'Plata', fmt: dinero, eje: dineroCorto,
    series: [
      { clave: 'ventas', label: 'Facturación', color: 'var(--serie-1)' },
      { clave: 'inversion', label: 'Inversión en ads', color: 'var(--serie-2)' },
      { clave: 'ganancia', label: 'Ganancia', color: 'var(--serie-3)' },
    ],
  },
  roas: {
    label: 'ROAS', fmt: veces, eje: n => `${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}x`,
    series: [
      { clave: 'roas', label: 'ROAS', color: 'var(--serie-1)' },
      { clave: 'roasEquilibrio', label: 'ROAS de equilibrio', color: 'var(--serie-2)', punteada: true },
    ],
  },
  ordenes: {
    label: 'Órdenes', fmt: entero, eje: enteroCorto,
    series: [
      { clave: 'ordenes', label: 'Órdenes', color: 'var(--serie-1)' },
      { clave: 'ordenesWhatsapp', label: 'Por WhatsApp', color: 'var(--serie-3)' },
    ],
  },
};

function useTamano() {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => setAncho(Math.floor(el.clientWidth));
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    medir();
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

// Paso "redondo" (1, 2, 2,5, 5 × 10^n) para las líneas del eje.
function pasoLindo(rango, lineas = 4) {
  const crudo = rango / lineas || 1;
  const pot = Math.pow(10, Math.floor(Math.log10(crudo)));
  const f = crudo / pot;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * pot;
}

function Grafico({ data }) {
  const [vista, setVista] = useState('plata');
  const [hover, setHover] = useState(null);
  const [ref, ancho] = useTamano();
  const v = VISTAS_GRAFICO[vista];
  const serie = data?.serie || [];
  const series = v.series.filter(s => vista !== 'plata' || s.clave !== 'inversion' || data?.meta);

  const ALTO = 300, IZQ = 58, DER = 12, ARRIBA = 16, ABAJO = 28;
  const anchoPlot = Math.max(0, ancho - IZQ - DER);
  const altoPlot = ALTO - ARRIBA - ABAJO;
  const valores = serie.flatMap(p => series.map(s => p[s.clave]).filter(x => x != null));
  const maxV = Math.max(0, ...valores);
  const minV = Math.min(0, ...valores);
  const paso = pasoLindo(maxV - minV || 1);
  const tope = Math.max(paso, Math.ceil(maxV / paso) * paso);
  const piso = Math.floor(minV / paso) * paso;
  const lineas = [];
  for (let t = piso; t <= tope + paso / 2; t += paso) lineas.push(Math.round(t * 1e6) / 1e6);
  const n = serie.length;
  const x = i => IZQ + (n <= 1 ? anchoPlot / 2 : (i * anchoPlot) / (n - 1));
  const y = val => ARRIBA + altoPlot - ((val - piso) / (tope - piso || 1)) * altoPlot;
  const cadaCuanto = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(anchoPlot / 64))));

  const camino = (clave) => {
    let d = '';
    let abierto = false;
    serie.forEach((p, i) => {
      const val = p[clave];
      if (val == null) { abierto = false; return; }
      d += `${abierto ? 'L' : 'M'}${x(i).toFixed(1)},${y(val).toFixed(1)} `;
      abierto = true;
    });
    return d;
  };

  const mover = (e) => {
    if (!n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - IZQ;
    const i = n <= 1 ? 0 : Math.round((px / anchoPlot) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const totalVista = clave => data?.totales.actual[clave];

  return (
    <section className="card dash-grafico">
      <div className="dash-card-head">
        <div>
          <h3>Evolución por día</h3>
          <div className="dash-leyenda">
            {series.map(s => (
              <span key={s.clave}><i style={{ background: s.color }} className={s.punteada ? 'is-punteada' : ''} /> {s.label} <strong>{data ? v.fmt(totalVista(s.clave)) : ''}</strong></span>
            ))}
          </div>
        </div>
        <div className="tabs-mini" role="tablist" aria-label="Qué mostrar">
          {Object.entries(VISTAS_GRAFICO).map(([clave, x]) => (
            <button key={clave} type="button" role="tab" aria-selected={vista === clave} className={vista === clave ? 'active' : ''}
                    onClick={() => { setVista(clave); setHover(null); }}>{x.label}</button>
          ))}
        </div>
      </div>

      <div className="dash-grafico-area" ref={ref} onMouseMove={mover} onMouseLeave={() => setHover(null)}>
        {ancho > 0 && data && (
          <svg width={ancho} height={ALTO} role="img" aria-label={`Evolución por día: ${series.map(s => s.label).join(', ')}`}>
            <defs>
              <linearGradient id="dash-degrade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5b4cf0" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#5b4cf0" stopOpacity="0" />
              </linearGradient>
            </defs>
            {lineas.map(t => (
              <g key={t}>
                <line x1={IZQ} x2={ancho - DER} y1={y(t)} y2={y(t)} className={t === 0 ? 'grafico-base' : 'grafico-grilla'} />
                <text x={IZQ - 8} y={y(t)} dy="0.32em" textAnchor="end" className="grafico-eje">{v.eje(t)}</text>
              </g>
            ))}
            {serie.map((p, i) => (i % cadaCuanto === 0 || i === n - 1) && (n - 1 - i) % cadaCuanto === 0 && (
              <text key={p.fecha} x={x(i)} y={ALTO - 8} textAnchor="middle" className="grafico-eje">{fechaCorta(p.fecha)}</text>
            ))}
            {n > 1 && series[0] && (
              <path d={`${camino(series[0].clave)} L${x(n - 1)},${y(Math.max(piso, 0))} L${x(0)},${y(Math.max(piso, 0))} Z`} fill="url(#dash-degrade)" className="dash-area" />
            )}
            {series.map(s => (
              <path key={s.clave} d={camino(s.clave)} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round"
                    strokeDasharray={s.punteada ? '6 5' : undefined} className="dash-linea" />
            ))}
            {n <= 1 && series.map(s => serie[0]?.[s.clave] != null && (
              <circle key={s.clave} cx={x(0)} cy={y(serie[0][s.clave])} r="5" fill={s.color} stroke="#fff" strokeWidth="2" />
            ))}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={ARRIBA} y2={ARRIBA + altoPlot} className="dash-cursor" />
                {series.map(s => serie[hover][s.clave] != null && (
                  <circle key={s.clave} cx={x(hover)} cy={y(serie[hover][s.clave])} r="4.5" fill={s.color} stroke="#fff" strokeWidth="2" />
                ))}
              </g>
            )}
          </svg>
        )}
        {!data && <div className="dash-grafico-cargando"><span className="spinner" /></div>}
        {data && hover != null && (
          <div className="dash-tooltip" style={{ left: Math.min(Math.max(x(hover), 110), ancho - 110) }}>
            <small>{fechaLarga(serie[hover].fecha)}</small>
            {series.map(s => (
              <div key={s.clave}><i style={{ background: s.color }} /> {s.label}<strong>{v.fmt(serie[hover][s.clave])}</strong></div>
            ))}
          </div>
        )}
      </div>

      <table className="sr-only">
        <caption>Evolución por día</caption>
        <thead><tr><th>Día</th>{series.map(s => <th key={s.clave}>{s.label}</th>)}</tr></thead>
        <tbody>{serie.map(p => <tr key={p.fecha}><th>{p.fecha}</th>{series.map(s => <td key={s.clave}>{v.fmt(p[s.clave])}</td>)}</tr>)}</tbody>
      </table>
    </section>
  );
}

// ── De la facturación a la ganancia ─────────────────────────────────────────

function Cascada({ data }) {
  const t = data?.totales.actual;
  const filas = t ? [
    { label: 'Facturación', valor: t.ventas, tipo: 'total' },
    { label: 'Impuestos', valor: -t.impuestos },
    { label: 'Costo de productos', valor: -t.costoProductos },
    { label: 'Envíos', valor: -t.costoEnvios },
    ...(data.mercadoPago
      ? [{ label: 'Mercado Pago (real)', valor: -t.comisionesMp }, { label: 'Otras comisiones de pago', valor: -t.comisionesOtros }]
      : [{ label: 'Comisiones de pago', valor: -t.comisiones }]),
    { label: 'Publicidad', valor: -t.inversion },
    { label: 'Costos fijos', valor: -t.costosFijos },
  ].filter(f => f.tipo || Math.abs(f.valor) >= 0.005) : [];
  const base = t ? Math.max(t.ventas, 1) : 1;

  return (
    <section className="card dash-cascada">
      <div className="dash-card-head"><h3>¿A dónde va cada venta?</h3></div>
      {!t ? <div className="dash-cascada-cargando">{[1, 2, 3, 4, 5].map(i => <span key={i} className="skeleton" />)}</div> : (
        <>
          <ul>
            {filas.map(f => (
              <li key={f.label} className={f.tipo === 'total' ? 'is-total' : ''}>
                <div className="dash-cascada-fila">
                  <span>{f.label}</span>
                  <strong>{dinero(f.valor)}</strong>
                </div>
                <div className="dash-barra"><span style={{ width: `${Math.min(100, (Math.abs(f.valor) / base) * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
          <div className={`dash-cascada-resultado ${t.ganancia < 0 ? 'is-negativo' : ''}`}>
            <span>{t.ganancia < 0 ? 'Pérdida' : 'Ganancia'}</span>
            <strong>{dinero(t.ganancia)}</strong>
            <small>{t.ventas ? `${porc(t.margen)} de lo facturado` : 'Sin ventas en el período'}</small>
          </div>
        </>
      )}
    </section>
  );
}

// ── Conclusiones automáticas ────────────────────────────────────────────────

function Conclusiones({ data }) {
  const items = useMemo(() => {
    const { actual: a, previo: p } = data.totales;
    const lista = [];
    const cambio = (x, y) => (y ? ((x - y) / Math.abs(y)) * 100 : null);

    const cv = cambio(a.ventas, p.ventas);
    if (cv != null && Math.abs(cv) >= 5) {
      lista.push({ tono: cv > 0 ? 'bien' : 'mal', texto: <>La facturación {cv > 0 ? 'subió' : 'bajó'} <strong>{Math.abs(Math.round(cv))}%</strong> contra el período anterior ({dinero(p.ventas)} → {dinero(a.ventas)}).</> });
    }
    if (a.inversion > 0 && a.roas != null && a.roasEquilibrio != null) {
      if (a.roas >= a.roasEquilibrio) {
        lista.push({ tono: 'bien', texto: <>Tu ROAS (<strong>{veces(a.roas)}</strong>) está arriba del de equilibrio (<strong>{veces(a.roasEquilibrio)}</strong>): la publicidad te está dejando plata. Por cada US$ 1 en anuncios vendiste {dinero(a.roas)}.</> });
      } else {
        lista.push({ tono: 'mal', texto: <>Tu ROAS (<strong>{veces(a.roas)}</strong>) está por debajo del de equilibrio (<strong>{veces(a.roasEquilibrio)}</strong>): con estos costos, la publicidad cuesta más de lo que deja. Revisá las campañas que menos venden.</> });
      }
    }
    if (a.ventasWhatsapp > 0 && a.ventas > 0) {
      lista.push({ tono: 'neutro', texto: <>El bot de WhatsApp generó <strong>{dinero(a.ventasWhatsapp)}</strong> ({porc(a.ventasWhatsapp / a.ventas)} de lo facturado) en {entero(a.ordenesWhatsapp)} {a.ordenesWhatsapp === 1 ? 'orden' : 'órdenes'}.</> });
    }
    const ct = cambio(a.ticket ?? 0, p.ticket ?? 0);
    if (ct != null && Math.abs(ct) >= 8 && a.ordenes >= 3) {
      lista.push({ tono: ct > 0 ? 'bien' : 'mal', texto: <>El ticket promedio {ct > 0 ? 'subió' : 'bajó'} a <strong>{dinero(a.ticket)}</strong> ({ct > 0 ? '+' : '−'}{Math.abs(Math.round(ct))}%).</> });
    }
    const top = data.productos[0];
    if (top && a.ventas > 0) {
      lista.push({ tono: 'neutro', texto: <>Tu producto estrella fue <strong>{top.titulo}</strong>: {entero(top.unidades)} {top.unidades === 1 ? 'unidad' : 'unidades'} y {porc(top.ventas / a.ventas)} de las ventas.</> });
    }
    if (a.cobradoMp > 0 && a.comisionMpPct != null) {
      lista.push({ tono: 'neutro', texto: <>Mercado Pago se quedó con <strong>{dinero(a.costoMp)}</strong>: el <strong>{porc(a.comisionMpPct)}</strong> de lo que cobraste por ahí.</> });
    }
    if (a.ganancia < 0 && a.ventas > 0) {
      lista.push({ tono: 'mal', texto: <>En este período <strong>perdiste {dinero(-a.ganancia)}</strong>. Mirá en “¿A dónde va cada venta?” qué costo pesa más.</> });
    }
    return lista.slice(0, 4);
  }, [data]);

  if (!items.length) return null;
  return (
    <section className="card dash-conclusiones">
      <h3><Icon name="sparkles" /> Lo que tenés que saber</h3>
      <ul>{items.map((it, i) => <li key={i} className={`is-${it.tono}`}>{it.texto}</li>)}</ul>
    </section>
  );
}

// ── Tienda ──────────────────────────────────────────────────────────────────

function Productos({ data }) {
  const lista = data?.productos || [];
  const max = Math.max(1, ...lista.map(p => p.ventas));
  return (
    <section className="card dash-tabla-card">
      <div className="dash-card-head"><h3>Productos más vendidos</h3></div>
      {!data ? <div className="dash-cascada-cargando">{[1, 2, 3, 4].map(i => <span key={i} className="skeleton" />)}</div>
        : !lista.length ? <p className="dash-vacio">Sin ventas en el período.</p> : (
          <div className="table-wrap">
            <table className="dash-tabla">
              <thead><tr><th>Producto</th><th className="col-num">Unid.</th><th className="col-num">Ventas</th><th className="col-num">Margen</th></tr></thead>
              <tbody>
                {lista.map(p => (
                  <tr key={p.titulo}>
                    <td>
                      <div className="dash-producto">
                        <span title={p.titulo}>{p.titulo}</span>
                        <div className="dash-barra is-fina"><span style={{ width: `${(p.ventas / max) * 100}%` }} /></div>
                      </div>
                    </td>
                    <td className="col-num">{entero(p.unidades)}</td>
                    <td className="col-num"><strong>{dinero(p.ventas)}</strong></td>
                    <td className="col-num">
                      <span className={`dash-margen ${p.margen != null && p.margen < 0.15 ? 'is-bajo' : ''}`} title={p.costoParcial ? 'Algunas ventas no tienen costo cargado en Shopify' : `Costo: ${dinero(p.costo)}`}>
                        {p.margen == null ? 'Sin costo' : `${porc(p.margen)}${p.costoParcial ? '*' : ''}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

const NOMBRE_CANAL = {
  whatsapp: 'WhatsApp (bot)', web: 'Tienda online', pos: 'Punto de venta', shopify_draft_order: 'Pedido manual',
  iphone: 'App de Shopify', android: 'App de Shopify', instagram: 'Instagram', facebook: 'Facebook', otro: 'Otros',
};

function Canales({ data }) {
  const lista = data?.canales || [];
  const total = lista.reduce((a, c) => a + c.ventas, 0) || 1;
  return (
    <section className="card dash-canales">
      <div className="dash-card-head"><h3>Ventas por canal</h3></div>
      {!data ? <div className="dash-cascada-cargando">{[1, 2, 3].map(i => <span key={i} className="skeleton" />)}</div>
        : !lista.length ? <p className="dash-vacio">Sin ventas en el período.</p> : (
          <ul>
            {lista.map(c => (
              <li key={c.canal} className={c.canal === 'whatsapp' ? 'is-whatsapp' : ''}>
                <div className="dash-cascada-fila">
                  <span>{c.canal === 'whatsapp' && <Icon name="message" />} {NOMBRE_CANAL[c.canal] || c.canal}</span>
                  <strong>{dinero(c.ventas)}</strong>
                </div>
                <div className="dash-barra"><span style={{ width: `${(c.ventas / total) * 100}%` }} /></div>
                <small>{porc(c.ventas / total)} · {entero(c.ordenes)} {c.ordenes === 1 ? 'orden' : 'órdenes'}</small>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

function SinShopify({ clienteId }) {
  return (
    <div className="card dash-conectar">
      <span className="dash-conectar-icono"><Icon name="shoppingBag" /></span>
      <div>
        <h3>Conectá tu tienda de Shopify</h3>
        <p>Con la tienda conectada vas a ver acá tus ventas, productos más vendidos, canales y la ganancia de cada período.</p>
      </div>
      <Link className="btn btn-primary" to={`/clientes/${clienteId}/integraciones`}>Ir a Integraciones</Link>
    </div>
  );
}

// ── Meta Ads ────────────────────────────────────────────────────────────────

function SinMeta({ onConectar }) {
  return (
    <div className="card dash-conectar">
      <span className="dash-conectar-icono is-meta"><Icon name="megaphone" /></span>
      <div>
        <h3>Conectá tu cuenta publicitaria de Meta</h3>
        <p>Así sumamos lo que invertís en anuncios de Facebook e Instagram y calculamos tu ROAS, tu costo por venta y tu ganancia real.</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onConectar}>Conectar Meta Ads</button>
    </div>
  );
}

function Campanias({ data }) {
  const lista = data?.campanias || [];
  return (
    <section className="card dash-tabla-card">
      <div className="dash-card-head"><h3>Campañas del período</h3></div>
      {!data ? <div className="dash-cascada-cargando">{[1, 2, 3].map(i => <span key={i} className="skeleton" />)}</div>
        : !lista.length ? <p className="dash-vacio">Sin gasto en anuncios en el período.</p> : (
          <div className="table-wrap">
            <table className="dash-tabla">
              <thead>
                <tr>
                  <th>Campaña</th><th className="col-num">Inversión</th><th className="col-num">Impresiones</th><th className="col-num">CTR</th>
                  <th className="col-num">Compras</th><th className="col-num">ROAS Meta</th><th className="col-num">Conversaciones</th><th className="col-num">Costo/conv.</th>
                </tr>
              </thead>
              <tbody>
                {lista.map(c => (
                  <tr key={c.id}>
                    <td><span className="dash-campania" title={c.nombre}>{c.nombre}</span></td>
                    <td className="col-num"><strong>{dinero(c.gasto)}</strong></td>
                    <td className="col-num">{entero(c.impresiones)}</td>
                    <td className="col-num">{porc(c.ctr)}</td>
                    <td className="col-num">{entero(c.compras)}</td>
                    <td className="col-num">{veces(c.roas)}</td>
                    <td className="col-num">{entero(c.conversaciones)}</td>
                    <td className="col-num">{c.conversaciones ? dinero(c.costoConversacion) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

// ── Mercado Pago ────────────────────────────────────────────────────────────

const NOMBRE_MEDIO = {
  credit_card: 'Tarjeta de crédito', debit_card: 'Tarjeta de débito', account_money: 'Dinero en cuenta', ticket: 'Efectivo (Abitab, Redpagos, Rapipago…)',
  bank_transfer: 'Transferencia', prepaid_card: 'Tarjeta prepaga', digital_currency: 'Mercado Crédito', digital_wallet: 'Billetera digital', atm: 'Cajero', otro: 'Otros',
};

function SinMp({ onConectar }) {
  return (
    <div className="card dash-conectar">
      <span className="dash-conectar-icono is-mp"><Icon name="wallet" /></span>
      <div>
        <h3>Conectá tu cuenta de Mercado Pago</h3>
        <p>Traemos cada cobro con lo que te cobró Mercado Pago (comisión, cuotas y retenciones) para que la ganancia sea la real, no un % estimado.</p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onConectar}>Conectar Mercado Pago</button>
    </div>
  );
}

function MediosMp({ data }) {
  const lista = data?.mediosMp || [];
  return (
    <section className="card dash-tabla-card">
      <div className="dash-card-head"><h3>Cuánto te cobra cada medio de pago</h3></div>
      {!data ? <div className="dash-cascada-cargando">{[1, 2, 3].map(i => <span key={i} className="skeleton" />)}</div>
        : !lista.length ? <p className="dash-vacio">Sin cobros en el período.</p> : (
          <div className="table-wrap">
            <table className="dash-tabla">
              <thead><tr><th>Medio de pago</th><th className="col-num">Pagos</th><th className="col-num">Cobrado</th><th className="col-num">Se quedó MP</th><th className="col-num">Comisión</th></tr></thead>
              <tbody>
                {lista.map(m => (
                  <tr key={m.tipo}>
                    <td>{NOMBRE_MEDIO[m.tipo] || m.tipo}</td>
                    <td className="col-num">{entero(m.pagos)}</td>
                    <td className="col-num"><strong>{dinero(m.cobrado)}</strong></td>
                    <td className="col-num">{dinero(m.costo)}</td>
                    <td className="col-num"><span className={`dash-margen ${m.pct != null && m.pct > 0.08 ? 'is-bajo' : ''}`}>{porc(m.pct)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  );
}

// Botón del encabezado: muestra si la fuente está conectada (o con error).
function BotonConexion({ label, icono, conexion, onClick }) {
  const estado = !conexion ? 'is-off' : conexion.estado === 'error' ? 'is-error' : 'is-on';
  return (
    <button type="button" className={`btn btn-outline dash-boton-conexion ${estado}`} onClick={onClick}
            title={!conexion ? `Conectar ${label}` : conexion.estado === 'error' ? `${label} con error` : `${label} conectado`}>
      <Icon name={icono} /> {label} <span className="dash-punto" />
    </button>
  );
}

// ── Sin nada conectado ──────────────────────────────────────────────────────

function Bienvenida({ clienteId, onMeta, onMp }) {
  return (
    <div className="card dash-bienvenida">
      <span className="dash-bienvenida-icono"><Icon name="barChart" /></span>
      <h2>Tu tablero de rentabilidad</h2>
      <p>Juntamos las ventas de tu tienda, lo que invertís en publicidad y lo que te cobra Mercado Pago para que sepas, día a día y en dólares, cuánto ganás de verdad.</p>
      <div className="dash-pasos">
        <Link to={`/clientes/${clienteId}/integraciones`} className="dash-paso">
          <span>1</span><div><strong>Conectá Shopify</strong><small>Ventas, órdenes y productos</small></div><Icon name="arrowRight" />
        </Link>
        <button type="button" className="dash-paso" onClick={onMeta}>
          <span>2</span><div><strong>Conectá Meta Ads</strong><small>Inversión en Facebook e Instagram</small></div><Icon name="arrowRight" />
        </button>
        <button type="button" className="dash-paso" onClick={onMp}>
          <span>3</span><div><strong>Conectá Mercado Pago</strong><small>Comisiones reales de cada cobro</small></div><Icon name="arrowRight" />
        </button>
      </div>
    </div>
  );
}

// ── Formularios ─────────────────────────────────────────────────────────────

const aTexto = v => (v == null ? '' : String(v));

function FormCostos({ clienteId, data, onClose, onGuardado }) {
  const avisar = useAvisar();
  const c = data.config;
  const [f, setF] = useState({
    comisionPct: aTexto(c.comisionPct), comisionFija: aTexto(c.comisionFija), envioPorOrden: aTexto(c.envioPorOrden),
    costoProductoPct: aTexto(c.costoProductoPct), costosFijosMes: aTexto(c.costosFijosMes), cotizacionUsd: aTexto(c.cotizacionUsd),
  });
  const [guardando, setGuardando] = useState(false);
  const campo = k => ({ value: f[k], onChange: e => setF(x => ({ ...x, [k]: e.target.value.replace(',', '.') })), inputMode: 'decimal' });
  const monedaLocal = data.cotizacion?.moneda;
  const conMp = Boolean(data.mercadoPago);

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try {
      avisar(await api(`/clientes/${clienteId}/dashboard/config`, { method: 'POST', body: f }));
      onGuardado();
      onClose();
    } catch (err) { avisar(err); }
    setGuardando(false);
  };

  return (
    <Form onSubmit={guardar} className="dash-form">
      <h3>Tus costos</h3>
      <p className="dash-form-intro">Lo que Shopify no sabe y hace falta para calcular la ganancia real. <strong>Los montos van en dólares.</strong> Todo es opcional: lo que dejes en 0 no se descuenta.</p>
      <fieldset>
        <legend>Medio de pago</legend>
        {conMp && <p className="dash-form-nota"><Icon name="check" /> Mercado Pago está conectado: usamos lo que te cobró de verdad. Esto se aplica solo a lo que cobres por otros medios.</p>}
        <div className="dash-form-grid">
          <label>Comisión (%)<input type="number" min="0" max="100" step="0.01" placeholder="Ej: 5,9" {...campo('comisionPct')} /><span className="field-hint">{conMp ? 'De las ventas que no pasan por Mercado Pago' : 'De cada venta (Mercado Pago, Shopify Payments…)'}</span></label>
          <label>Fijo por orden (US$)<input type="number" min="0" step="0.01" placeholder="0" {...campo('comisionFija')} /><span className="field-hint">Si el medio de pago cobra un monto fijo</span></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Productos y envíos</legend>
        <div className="dash-form-grid">
          <label>Costo de envío por orden (US$)<input type="number" min="0" step="0.01" placeholder="0" {...campo('envioPorOrden')} /><span className="field-hint">Lo que te cobra el correo, en promedio</span></label>
          <label>Costo por defecto (% del precio)<input type="number" min="0" max="100" step="0.1" placeholder="Ej: 40" {...campo('costoProductoPct')} /><span className="field-hint">Para productos sin “Costo por artículo” en Shopify</span></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Fijos y cotización</legend>
        <div className="dash-form-grid">
          <label>Costos fijos por mes (US$)<input type="number" min="0" step="1" placeholder="0" {...campo('costosFijosMes')} /><span className="field-hint">Sueldos, alquiler, apps… se reparte por día</span></label>
          {monedaLocal && (
            <label>US$ 1 = ¿cuántos {monedaLocal}?<input type="number" min="0" step="0.0001" placeholder={data.cotizacion.valor && !data.cotizacion.fija ? `Automática (hoy ${cotizacionTexto(data.cotizacion.valor)})` : 'Automática'} {...campo('cotizacionUsd')} /><span className="field-hint">Vacío = la cotización de cada día. Cargala solo si querés usar una fija.</span></label>
          )}
        </div>
      </fieldset>
      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </Form>
  );
}

// Pide la URL de autorización y navega (el servidor arma el state firmado).
async function irAOauth(path, avisar, setYendo) {
  setYendo(true);
  try {
    const r = await api(path, { method: 'POST' });
    window.location.assign(r.url);
  } catch (err) {
    avisar(err);
    setYendo(false);
  }
}

function FormMeta({ clienteId, data, elegir, desde, onClose, onGuardado }) {
  const avisar = useAvisar();
  const confirmar = useConfirm();
  const conectada = data?.meta;
  const oauth = data?.oauth?.meta;
  const [cuenta, setCuenta] = useState(conectada ? `act_${conectada.adAccountId}` : '');
  const [token, setToken] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [yendo, setYendo] = useState(false);
  const [detalle, setDetalle] = useState(conectada?.ultimoError || '');
  const pendientes = useApi(elegir ? `/clientes/${clienteId}/meta-ads/pendiente` : null);
  const cuentas = pendientes.data?.cuentas || [];
  const [elegida, setElegida] = useState('');
  useEffect(() => { if (cuentas.length && !elegida) setElegida(cuentas[0].id); }, [cuentas, elegida]);

  const conectar = async (body) => {
    if (guardando) return;
    setGuardando(true);
    setDetalle('');
    try {
      avisar(await api(`/clientes/${clienteId}/meta-ads`, { method: 'POST', body: { ...body, desde } }));
      onGuardado();
      onClose();
    } catch (err) {
      setDetalle(err.data?.detalle || '');
      avisar(err);
    }
    setGuardando(false);
  };

  const desconectar = async () => {
    const si = await confirmar({ titulo: 'Desconectar Meta Ads', mensaje: 'Se borra el gasto en anuncios guardado. Podés volver a conectar la cuenta cuando quieras.', boton: 'Desconectar' });
    if (!si) return;
    try { avisar(await api(`/clientes/${clienteId}/meta-ads/desconectar`, { method: 'POST' })); onGuardado(); onClose(); } catch (err) { avisar(err); }
  };

  // Vuelta del OAuth con varias cuentas: elegir cuál.
  if (elegir) {
    return (
      <Form onSubmit={() => conectar({ adAccountId: elegida, pendiente: true })} className="dash-form">
        <h3>Elegí la cuenta publicitaria</h3>
        <p className="dash-form-intro">Tu usuario de Facebook tiene varias cuentas. ¿De cuál traemos el gasto en anuncios?</p>
        {pendientes.loading && !pendientes.data ? <p><span className="spinner" /></p>
          : !cuentas.length ? <div className="alert alert-warning">Pasó mucho tiempo desde que conectaste. Volvé a tocar “Conectar con Facebook”.</div>
          : (
            <div className="dash-cuentas" role="radiogroup">
              {cuentas.map(c => (
                <label key={c.id} className={`dash-cuenta ${elegida === c.id ? 'is-activa' : ''}`}>
                  <input type="radio" name="cuenta" value={c.id} checked={elegida === c.id} onChange={() => setElegida(c.id)} />
                  <span><strong>{c.nombre}</strong><small>act_{c.id} · {c.moneda}{c.negocio ? ` · ${c.negocio}` : ''}{c.activa ? '' : ' · inactiva'}</small></span>
                </label>
              ))}
            </div>
          )}
        {detalle && <div className="alert alert-error">{detalle}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={guardando || !elegida}>{guardando ? 'Conectando…' : 'Conectar esta cuenta'}</button>
        </div>
      </Form>
    );
  }

  return (
    <Form onSubmit={() => conectar({ adAccountId: cuenta, token })} className="dash-form">
      <h3>{conectada ? 'Cuenta de Meta Ads' : 'Conectar Meta Ads'}</h3>
      {conectada && (
        <div className={`dash-meta-estado ${conectada.estado === 'error' ? 'is-error' : ''}`}>
          <strong>{conectada.nombreCuenta || `act_${conectada.adAccountId}`}</strong>
          <span>{conectada.moneda} · {conectada.estado === 'error' ? 'con error' : `actualizado ${hace(conectada.ultimaSync) || 'pendiente'}`}{conectada.tokenExpira ? ` · el acceso vence ${fechaLarga(conectada.tokenExpira.slice(0, 10))}` : ''}</span>
        </div>
      )}
      {oauth && (
        <div className="dash-oauth">
          <button type="button" className="btn btn-primary dash-oauth-boton" disabled={yendo} onClick={() => irAOauth(`/clientes/${clienteId}/meta-ads/oauth`, avisar, setYendo)}>
            <Icon name="megaphone" /> {yendo ? 'Abriendo Facebook…' : conectada ? 'Volver a conectar con Facebook' : 'Conectar con Facebook'}
          </button>
          <span className="field-hint">Entrás con tu usuario de Facebook, aceptás el permiso para ver tus anuncios y listo.</span>
        </div>
      )}
      <details className="dash-ayuda-token" open={!oauth}>
        <summary>{oauth ? 'Conectar a mano (ID de cuenta + token)' : 'Datos de la cuenta'}</summary>
        <label>
          ID de la cuenta publicitaria
          <input value={cuenta} onChange={e => setCuenta(e.target.value)} placeholder="act_1234567890" autoComplete="off" />
          <span className="field-hint">Está en el Administrador de anuncios, arriba a la izquierda (o en la URL: <code>act=…</code>).</span>
        </label>
        <label>
          Token de acceso {conectada?.tokenPropio && <span className="field-hint">(dejalo vacío para seguir usando el guardado)</span>}
          <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder={conectada?.tokenPropio ? '••••••••••••' : 'EAAG…'} autoComplete="off" />
        </label>
        <ol>
          <li>Entrá a <strong>business.facebook.com</strong> → Configuración del negocio → <strong>Usuarios del sistema</strong>.</li>
          <li>Creá un usuario del sistema (o usá uno que ya tengas) y asignale tu <strong>cuenta publicitaria</strong> con permiso para ver el rendimiento.</li>
          <li>Tocá <strong>Generar token</strong>, elegí la app, marcá el permiso <code>ads_read</code> y copiá el token (los de usuario del sistema no vencen).</li>
        </ol>
        <div className="modal-actions is-inline">
          <button type="submit" className="btn btn-outline" disabled={guardando || !cuenta.trim()}>{guardando ? 'Probando conexión…' : 'Conectar con estos datos'}</button>
        </div>
      </details>
      {detalle && <div className="alert alert-error">{detalle}</div>}
      <div className="modal-actions">
        {conectada && <button type="button" className="btn btn-danger-outline dash-desconectar" onClick={desconectar}>Desconectar</button>}
        <button type="button" className="btn btn-outline" onClick={onClose}>Cerrar</button>
      </div>
    </Form>
  );
}

function FormMp({ clienteId, data, onClose, onGuardado }) {
  const avisar = useAvisar();
  const confirmar = useConfirm();
  const conectada = data?.mercadoPago;
  const oauth = data?.oauth?.mercadoPago;
  const [token, setToken] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [yendo, setYendo] = useState(false);
  const [detalle, setDetalle] = useState(conectada?.ultimoError || '');

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    setDetalle('');
    try {
      avisar(await api(`/clientes/${clienteId}/mercadopago`, { method: 'POST', body: { token } }));
      onGuardado();
      onClose();
    } catch (err) {
      setDetalle(err.data?.detalle || '');
      avisar(err);
    }
    setGuardando(false);
  };

  const desconectar = async () => {
    const si = await confirmar({ titulo: 'Desconectar Mercado Pago', mensaje: 'Se borran los pagos guardados y la ganancia vuelve a usar el % de comisión de Costos.', boton: 'Desconectar' });
    if (!si) return;
    try { avisar(await api(`/clientes/${clienteId}/mercadopago/desconectar`, { method: 'POST' })); onGuardado(); onClose(); } catch (err) { avisar(err); }
  };

  return (
    <Form onSubmit={guardar} className="dash-form">
      <h3>{conectada ? 'Cuenta de Mercado Pago' : 'Conectar Mercado Pago'}</h3>
      <p className="dash-form-intro">Solo leemos tus cobros: cuánto pagó cada cliente, cuánto se quedó Mercado Pago y cuánto te llegó. No podemos mover plata ni cobrar nada.</p>
      {conectada && (
        <div className={`dash-meta-estado ${conectada.estado === 'error' ? 'is-error' : ''}`}>
          <strong>{conectada.nickname || conectada.email || 'Cuenta conectada'}</strong>
          <span>
            {entero(conectada.pagos)} pagos{conectada.primeraFecha ? ` desde el ${fechaLarga(conectada.primeraFecha)}` : ''} · {conectada.estado === 'error' ? 'con error' : `actualizado ${hace(conectada.ultimaSync) || 'pendiente'}`}
          </span>
        </div>
      )}
      {oauth && (
        <div className="dash-oauth">
          <button type="button" className="btn btn-primary dash-oauth-boton" disabled={yendo} onClick={() => irAOauth(`/clientes/${clienteId}/mercadopago/oauth`, avisar, setYendo)}>
            <Icon name="wallet" /> {yendo ? 'Abriendo Mercado Pago…' : conectada ? 'Volver a conectar con Mercado Pago' : 'Conectar con Mercado Pago'}
          </button>
          <span className="field-hint">Entrás con tu cuenta de Mercado Pago, autorizás y volvés acá.</span>
        </div>
      )}
      <details className="dash-ayuda-token" open={!oauth}>
        <summary>{oauth ? 'Conectar a mano (Access Token)' : 'Access Token de tu cuenta'}</summary>
        <label>
          Access Token de producción
          <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="APP_USR-…" autoComplete="off" />
        </label>
        <ol>
          <li>Entrá a <strong>mercadopago.com.ar/developers</strong> con la cuenta de Mercado Pago del negocio (la que recibe los cobros) y tocá <strong>Integraciones</strong>, arriba a la derecha.</li>
          <li>Tocá <strong>Crear aplicación</strong> → <strong>Crear manualmente</strong> (en el panel de integración).</li>
          <li>En <strong>Elegí una solución para integrar</strong> elegí <strong>Checkout Pro</strong> (no “Plataformas de e-commerce”, aunque vendas con Shopify).</li>
          <li>En <strong>Tipo de API</strong> dejá <strong>Preferences</strong>. Ponele un nombre (ej. “Portal”), aceptá los términos y tocá <strong>Crear aplicación</strong>.</li>
          <li>En la aplicación, andá a <strong>Credenciales</strong> → <strong>Producción</strong> → <strong>Activar ambiente de producción</strong>. Completá el rubro y la web del negocio, aceptá la Declaración de Privacidad y los Términos y tocá <strong>Activar</strong>.</li>
          <li>Con <strong>Producción</strong> seleccionado, copiá el <strong>Access Token</strong> (empieza con <code>APP_USR-</code>) y pegalo acá arriba.</li>
        </ol>
        <p className="field-hint">Da igual cómo cobre tu tienda: el token solo sirve para leer los pagos de la cuenta, no se usa para cobrar.</p>
        <div className="modal-actions is-inline">
          <button type="submit" className="btn btn-outline" disabled={guardando || !token.trim()}>{guardando ? 'Probando conexión…' : 'Conectar con este token'}</button>
        </div>
      </details>
      {detalle && <div className="alert alert-error">{detalle}</div>}
      <div className="modal-actions">
        {conectada && <button type="button" className="btn btn-danger-outline dash-desconectar" onClick={desconectar}>Desconectar</button>}
        <button type="button" className="btn btn-outline" onClick={onClose}>Cerrar</button>
      </div>
    </Form>
  );
}
