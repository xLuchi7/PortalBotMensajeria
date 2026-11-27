import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { ErrorCarga, useTitulo } from '../components/ui.jsx';
import { useCliente } from '../components/Layout.jsx';
import { useApi } from '../lib/api.js';
import { TIPOS_EVENTO, useEnVivo } from '../lib/eventos.jsx';
import { iniciales, numero, plata, plural, tono } from '../lib/format.js';

// Pantalla de entrada del Cliente: qué hizo el bot por su negocio, qué necesita
// atención y lo último que pasó. Los datos vienen de GET /clientes/:id/inicio y
// se actualizan solos cuando llega un mensaje nuevo (misma huella que Chats).

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_CALOR = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_CALOR_LARGO = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const ESTADO_PEDIDO = { pendiente: 'Pendiente', confirmado: 'Confirmado', entregado: 'Entregado', cancelado: 'Cancelado', reclamado: 'Reclamado', solucionado: 'Solucionado' };
const MINUTOS_POR_RESPUESTA = 1; // estimación conservadora para "tiempo ahorrado"

const entero = n => Math.round(n).toLocaleString('es-AR');

// Métricas que pueden ir en las tarjetas y en el gráfico. `serie` es la columna
// de la serie diaria que se usa para el mini-gráfico y las barras.
const METRICAS = {
  chats: { label: 'Conversaciones', icono: 'message', serie: 'chats', formato: entero, eje: entero,
           ayuda: 'Personas distintas que escribieron en el período.' },
  respuestasBot: { label: 'Respuestas del bot', icono: 'bot', serie: 'respuestas', formato: entero, eje: entero,
                   ayuda: 'Mensajes que el bot contestó solo, sin que intervengas.' },
  pedidos: { label: 'Pedidos', icono: 'truck', serie: 'pedidos', formato: entero, eje: entero,
             ayuda: 'Pedidos que se armaron por WhatsApp en el período.' },
  vendido: { label: 'Vendido por el bot', corto: 'Vendido', icono: 'wallet', serie: 'vendido', formato: plata, eje: compacto,
             ayuda: 'Suma de los pedidos del período, sin contar los cancelados.' },
  nuevos: { label: 'Contactos nuevos', icono: 'userPlus', serie: 'nuevos', formato: entero, eje: entero,
            ayuda: 'Números que le escribieron a tu negocio por primera vez.' },
  consultas: { label: 'Productos consultados', corto: 'Consultas', icono: 'search', serie: 'consultas', formato: entero, eje: entero,
               ayuda: 'Veces que alguien preguntó por un producto de tu catálogo.' },
};

export default function Inicio() {
  useTitulo('Inicio');
  const { clienteId } = useParams();
  const [params, setParams] = useSearchParams();
  const dias = params.get('dias') === '30' ? 30 : 7;
  const { cliente } = useCliente();
  const { data, error, reload } = useApi(`/clientes/${clienteId}/inicio?dias=${dias}`);
  const base = `/clientes/${clienteId}`;
  useResumenEnVivo(reload);
  useAhora(60000); // re-render cada minuto para que "hace X min" no quede viejo

  if (error && !data) return <ErrorCarga error={error} onReintentar={reload} />;

  // Sin pedidos nunca, las tarjetas de Pedidos y Vendido quedarían en 0: se
  // muestran Contactos nuevos y Productos consultados hasta que haya pedidos.
  const tarjetas = data && !data.conPedidos ? ['chats', 'respuestasBot', 'nuevos', 'consultas'] : ['chats', 'respuestasBot', 'pedidos', 'vendido'];
  const metricasGrafico = data && !data.conPedidos ? ['chats', 'respuestasBot', 'consultas'] : ['chats', 'respuestasBot', 'pedidos', 'vendido'];

  // Si el asistente arrancó dentro del período, no hay período anterior con qué
  // comparar: se ocultan las variaciones y los mini-gráficos, y el gráfico
  // empieza el día que arrancó (en vez de mostrar días vacíos).
  const desde = data?.desde || null;
  const sinHistoria = !!data && (!desde || desde >= data.serie[0].dia);
  const recorte = sinHistoria && desde ? desde : null;
  const periodo = recorte ? `desde el ${etiquetaDia(recorte, false)}` : `en los últimos ${dias} días`;

  return (
    <div className="inicio">
      <Hero cliente={cliente} data={data} periodo={periodo} base={base} />

      <div className="inicio-seccion-head">
        <div>
          <h2>Cómo te fue</h2>
          {sinHistoria && desde && (
            <p className="inicio-seccion-sub">
              Tu asistente arrancó el <strong>{etiquetaDia(desde, false)}</strong>. Todavía no hay un período anterior para comparar: las variaciones aparecen solas cuando lo haya.
            </p>
          )}
        </div>
        <div className="segmentado" role="radiogroup" aria-label="Período">
          {[7, 30].map(d => (
            <button key={d} type="button" role="radio" aria-checked={dias === d} className={dias === d ? 'active' : ''}
                    onClick={() => setParams(d === 7 ? {} : { dias: String(d) }, { replace: true })}>
              Últimos {d} días
            </button>
          ))}
        </div>
      </div>

      <div className="kpis">
        {tarjetas.map((clave, i) => (
          <Kpi key={clave} destacado={i === 0} metrica={METRICAS[clave]} dato={data?.kpis[clave]} serie={sinHistoria ? null : data?.serie}
               comparado={sinHistoria ? null : `los ${dias} días anteriores`} />
        ))}
      </div>

      <div className="inicio-grid">
        <Grafico serie={data ? (recorte ? data.serie.filter(s => s.dia >= recorte) : data.serie) : null}
                 periodo={periodo} metricas={metricasGrafico} kpis={data?.kpis} />
        <Atencion atencion={data?.atencion} base={base} botApagado={cliente?.botActivo === false} />
      </div>

      <div className="inicio-grid">
        <MapaCalor calor={data?.calor} periodo={periodo} />
        <Actividad items={data?.actividad} base={base} />
      </div>
    </div>
  );
}

// ── Tiempo real ─────────────────────────────────────────────────────────────

// Recarga el resumen cuando el servidor avisa que algo cambió (lib/eventos.jsx).
// Espera unos segundos para juntar en una sola recarga los avisos que llegan
// seguidos (el mensaje del cliente y la respuesta del bot, por ejemplo).
function useResumenEnVivo(reload) {
  useEnVivo(TIPOS_EVENTO, reload, { esperaMs: 10000 }); // el resumen es pesado: se agrupan los avisos de 10 s
}

function useAhora(cadaMs) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
}

// ── Hero ────────────────────────────────────────────────────────────────────

function saludo() {
  const h = new Date().getHours();
  if (h >= 5 && h < 13) return 'Buen día';
  if (h >= 13 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

function duracion(min) {
  if (min < 60) return `${Math.round(min)} min`;
  const h = min / 60;
  return `${h < 10 ? h.toLocaleString('es-AR', { maximumFractionDigits: 1 }) : Math.round(h)} h`;
}

function segundos(s) {
  if (s < 60) return `${Math.max(1, s)} seg`;
  return `${Math.round(s / 60)} min`;
}

// Porcentaje de mensajes que llegaron de noche (21 a 9 hs) o en domingo.
function fueraDeHorario(calor) {
  let total = 0;
  let fuera = 0;
  calor.forEach((fila, dow) => fila.forEach((n, h) => {
    total += n;
    if (dow === 6 || h < 9 || h >= 21) fuera += n;
  }));
  return total >= 10 ? Math.round((fuera / total) * 100) : null;
}

function Hero({ cliente, data, periodo, base }) {
  const apagado = cliente?.botActivo === false;
  const hoy = data?.hoy;
  let frase;
  if (!hoy) frase = <span className="skeleton skeleton-claro" style={{ width: '60%' }} />;
  else if (apagado) frase = <>Tu asistente está <strong>apagado</strong>: nadie está recibiendo respuestas automáticas.</>;
  else if (hoy.respuestasBot > 0) frase = <>Hoy tu asistente respondió <strong>{hoy.respuestasBot} {plural(hoy.respuestasBot, 'mensaje')}</strong> en <strong>{hoy.chats} {plural(hoy.chats, 'chat')}</strong>.</>;
  else if (hoy.chats > 0) frase = <>Hoy te escribieron en <strong>{hoy.chats} {plural(hoy.chats, 'chat')}</strong>.</>;
  else frase = <>Todavía no hubo mensajes hoy. Tu asistente está listo para atender.</>;

  const ultimo = data?.ultimoMensaje;
  const fuera = data ? fueraDeHorario(data.calor) : null;
  const respuestas = data?.kpis.respuestasBot.valor ?? 0;

  return (
    <section className="inicio-hero">
      <div className="hero-aurora hero-aurora-1" />
      <div className="hero-aurora hero-aurora-2" />
      <div className="hero-puntos" />

      <div className="hero-grid">
        <div className="hero-texto">
          <span className="hero-eyebrow">{saludo()}{cliente ? ',' : ''}</span>
          <h1>{cliente ? cliente.razonSocial : <span className="skeleton skeleton-claro" style={{ width: 220 }} />}</h1>
          <p>{frase}</p>
          {ultimo && (
            <Link to={`${base}/chats?chat=${encodeURIComponent(ultimo.userId)}`} className="hero-vivo">
              <i /> En vivo · <strong>{ultimo.nombre || ultimo.numero}</strong> escribió {hace(ultimo.fecha)}
            </Link>
          )}
        </div>

        {/* Lo que el bot hizo por el negocio, en una tarjeta de vidrio. */}
        <div className="hero-valor">
          <span className="hero-valor-titulo">Tu asistente {periodo}</span>
          <ul className="hero-valor-items">
            <li title="Tiempo típico entre que el cliente escribe y el bot le contesta (la mediana).">
              <span className="hero-valor-icono"><Icon name="clock" /></span>
              <strong>{!data ? '…' : data.velocidad ? segundos(data.velocidad.segundos) : '—'}</strong>
              <small>tarda en responder</small>
            </li>
            <li title={`Estimado en ${MINUTOS_POR_RESPUESTA} minuto por cada respuesta que el bot dio solo.`}>
              <span className="hero-valor-icono"><Icon name="sparkles" /></span>
              <strong>{!data ? '…' : `≈ ${duracion(respuestas * MINUTOS_POR_RESPUESTA)}`}</strong>
              <small>de atención que hizo por vos</small>
            </li>
            <li title="Mensajes de clientes que llegaron entre las 21 y las 9 hs, o en domingo.">
              <span className="hero-valor-icono"><Icon name="moon" /></span>
              <strong>{!data ? '…' : fuera != null ? `${fuera}%` : '24/7'}</strong>
              <small>{fuera != null ? 'llegó de noche o en domingo' : 'atiende siempre, también de noche'}</small>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

// ── KPIs ────────────────────────────────────────────────────────────────────

// Cuenta de 0 al valor al aparecer (y entre valores al cambiar de período).
function useContar(valor) {
  const [mostrado, setMostrado] = useState(valor ?? 0);
  const desde = useRef(0);
  useEffect(() => {
    if (valor == null) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setMostrado(valor); return undefined; }
    const inicio = performance.now();
    const origen = desde.current;
    let frame;
    const paso = (t) => {
      const p = Math.min(1, (t - inicio) / 700);
      const e = 1 - Math.pow(1 - p, 3);
      setMostrado(origen + (valor - origen) * e);
      if (p < 1) frame = requestAnimationFrame(paso);
      else desde.current = valor;
    };
    frame = requestAnimationFrame(paso);
    return () => { cancelAnimationFrame(frame); desde.current = valor; };
  }, [valor]);
  return mostrado;
}

function variacion({ valor, previo }) {
  if (!valor && !previo) return null;
  if (!previo) return { tono: 'sube', texto: 'Nuevo' };
  const pct = Math.round(((valor - previo) / previo) * 100);
  if (pct === 0) return { tono: 'igual', texto: 'Igual' };
  return { tono: pct > 0 ? 'sube' : 'baja', texto: `${pct > 0 ? '+' : ''}${pct}%` };
}

// Mini-gráfico de área con la tendencia del período (decorativo: el número y el
// gráfico grande tienen el dato).
function Sparkline({ valores }) {
  const max = Math.max(...valores);
  if (!valores.length || max <= 0) return <span className="sparkline sparkline-vacia" />;
  const paso = 100 / Math.max(1, valores.length - 1);
  const pts = valores.map((v, i) => [i * paso, 30 - (v / max) * 26]);
  const linea = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  return (
    <svg className="sparkline" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <path d={`${linea} L100,32 L0,32 Z`} className="sparkline-area" />
      <path d={linea} className="sparkline-linea" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// Sin `comparado` (el asistente arrancó dentro del período) la tarjeta muestra
// solo el número y para qué sirve, sin variación ni mini-gráfico.
function Kpi({ metrica: m, dato, serie, comparado, destacado }) {
  const valor = useContar(dato?.valor);
  const v = dato && comparado ? variacion(dato) : null;
  return (
    <div className={`kpi ${destacado ? 'kpi-destacado' : ''}`} title={m.ayuda}>
      <div className="kpi-top">
        <span className="kpi-icono"><Icon name={m.icono} /></span>
        <span className="kpi-titulo">{m.label}</span>
      </div>
      <div className="kpi-medio">
        <strong className="kpi-valor">{dato ? m.formato(Math.round(valor)) : <span className="skeleton skeleton-num" />}</strong>
        {serie && <Sparkline valores={serie.map(s => s[m.serie])} />}
      </div>
      <div className="kpi-pie">
        {!dato ? <span>&nbsp;</span> : !comparado ? (
          <span>{m.ayuda}</span>
        ) : v ? (
          <>
            <span className={`kpi-delta is-${v.tono}`}>
              {v.tono !== 'igual' && <Icon name="trendingUp" />}
              {v.texto}
            </span>
            <span>vs. {comparado}</span>
          </>
        ) : <span>Sin movimiento en el período</span>}
      </div>
    </div>
  );
}

// ── Gráfico ─────────────────────────────────────────────────────────────────

// "$48.900" → "$49k" para las etiquetas del eje.
function compacto(n) {
  if (n >= 1e6) return `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3).toLocaleString('es-AR')}k`;
  return `$${Math.round(n)}`;
}

// Paso "redondo" entre líneas del eje (1, 2, 5 × 10^n), nunca menor a 1: así los
// conteos quedan en enteros (0, 10, 20, 30, 40) y no en 12,5 o 37,5.
function pasoLindo(max, lineas = 4) {
  const crudo = Math.max(1, max / lineas);
  const pot = Math.pow(10, Math.floor(Math.log10(crudo)));
  const f = crudo / pot;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pot;
}

function etiquetaDia(iso, esHoy, largo = false) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (esHoy && !largo) return 'Hoy';
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return largo ? `${esHoy ? 'Hoy' : DIAS_SEMANA[d.getUTCDay()]} ${dd}/${mm}` : `${dd}/${mm}`;
}

function useTamano() {
  const ref = useRef(null);
  const [tam, setTam] = useState({ ancho: 0, alto: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const medir = () => setTam({ ancho: Math.floor(el.clientWidth), alto: Math.floor(el.clientHeight) });
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    medir();
    return () => ro.disconnect();
  }, []);
  return [ref, tam];
}

function Grafico({ serie, periodo, metricas, kpis }) {
  const [elegida, setElegida] = useState('chats');
  const clave = metricas.includes(elegida) ? elegida : 'chats';
  const [hover, setHover] = useState(null);
  const [ref, { ancho, alto }] = useTamano();
  const m = METRICAS[clave];

  const ALTO = Math.max(220, alto);
  const IZQ = 44;
  const ABAJO = 26;
  const ARRIBA = 22;
  const altoPlot = ALTO - ABAJO - ARRIBA;
  const anchoPlot = Math.max(0, ancho - IZQ - 4);

  const valores = serie ? serie.map(s => s[m.serie]) : [];
  const max = Math.max(0, ...valores);
  const paso = pasoLindo(max);
  const tope = paso * 4;
  const n = valores.length || 7;
  const pocos = n <= 10; // con pocos días va la etiqueta de cada uno
  const banda = anchoPlot / n;
  const barra = Math.max(3, Math.min(36, banda - Math.max(2, banda * 0.38)));
  const y = v => ARRIBA + altoPlot - (v / tope) * altoPlot;
  const suma = valores.reduce((a, b) => a + b, 0);
  // Conversaciones: el total son personas distintas (no la suma de cada día, que
  // cuenta dos veces a quien escribió dos días).
  const total = clave === 'chats' && kpis ? kpis.chats.valor : clave === 'respuestasBot' && kpis ? kpis.respuestasBot.valor : suma;
  const cadaCuanto = pocos ? 1 : ancho < 560 ? 7 : 5;

  return (
    <section className="card inicio-card grafico-card">
      <div className="inicio-card-head">
        <div>
          <h3>{m.label} por día</h3>
          <span className="inicio-card-sub">
            {serie ? <><strong>{m.formato(total)}</strong> {clave === 'chats' ? plural(total, 'persona distinta', 'personas distintas') : 'en total'} {periodo}</> : 'Cargando…'}
          </span>
        </div>
        <div className="tabs-mini" role="tablist" aria-label="Qué mostrar">
          {metricas.map(c => (
            <button key={c} type="button" role="tab" aria-selected={clave === c}
                    className={clave === c ? 'active' : ''} onClick={() => { setElegida(c); setHover(null); }}>
              {METRICAS[c].corto || METRICAS[c].label}
            </button>
          ))}
        </div>
      </div>

      <div className="grafico" ref={ref} onMouseLeave={() => setHover(null)}>
        {ancho > 0 && (
          <svg width={ancho} height={ALTO} role="img" aria-label={`${m.label} por día, ${periodo}`}>
            <defs>
              <linearGradient id="grafico-degrade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#a18fff" />
                <stop offset="100%" stopColor="#5b4cf0" />
              </linearGradient>
            </defs>
            {[0, 1, 2, 3, 4].map(i => (
              <g key={i}>
                <line x1={IZQ} x2={ancho} y1={y(paso * i)} y2={y(paso * i)} className={i === 0 ? 'grafico-base' : 'grafico-grilla'} />
                <text x={IZQ - 8} y={y(paso * i)} dy="0.32em" textAnchor="end" className="grafico-eje">{m.eje(paso * i)}</text>
              </g>
            ))}

            {serie && serie.map((s, i) => {
              const v = s[m.serie];
              const x = IZQ + i * banda + (banda - barra) / 2;
              const altoBarra = Math.max(0, y(0) - y(v));
              const r = Math.min(4, barra / 2, altoBarra);
              const esHoy = i === serie.length - 1;
              const mostrarEtiqueta = pocos || esHoy || (serie.length - 1 - i) % cadaCuanto === 0;
              return (
                <g key={`${clave}-${s.dia}`} className={`grafico-barra ${hover === i ? 'is-hover' : ''} ${hover != null && hover !== i ? 'is-dim' : ''} ${esHoy ? 'is-hoy' : ''}`}>
                  {altoBarra > 0 && (
                    <path style={{ animationDelay: `${i * (pocos ? 40 : 12)}ms` }}
                          d={`M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + barra - r} Q${x + barra},${y(v)} ${x + barra},${y(v) + r} V${y(0)} Z`} />
                  )}
                  {pocos && v > 0 && (
                    <text x={x + barra / 2} y={y(v) - 8} textAnchor="middle" className="grafico-valor"
                          style={{ animationDelay: `${300 + i * 40}ms` }}>{m.eje(v)}</text>
                  )}
                  {mostrarEtiqueta && (
                    <text x={x + barra / 2} y={ALTO - 6} textAnchor="middle" className="grafico-eje">{etiquetaDia(s.dia, esHoy)}</text>
                  )}
                  {/* Zona invisible más grande que la barra para que el hover sea fácil. */}
                  <rect x={IZQ + i * banda} y={ARRIBA} width={banda} height={altoPlot} fill="transparent"
                        onMouseEnter={() => setHover(i)} />
                </g>
              );
            })}
          </svg>
        )}

        {serie && suma === 0 && (
          <div className="grafico-vacio"><Icon name="trendingUp" /> Sin {m.label.toLowerCase()} en este período</div>
        )}

        {serie && hover != null && (
          <div className="grafico-tooltip"
               style={{ left: Math.min(Math.max(IZQ + hover * banda + banda / 2, 70), ancho - 70), top: y(serie[hover][m.serie]) }}>
            <small>{etiquetaDia(serie[hover].dia, hover === serie.length - 1, true)}</small>
            <strong>{m.formato(serie[hover][m.serie])}</strong>
          </div>
        )}
      </div>

      {/* Lo mismo en texto, para lectores de pantalla. */}
      <table className="sr-only">
        <caption>{m.label} por día</caption>
        <tbody>{serie?.map(s => <tr key={s.dia}><th>{s.dia}</th><td>{m.formato(s[m.serie])}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

// ── Mapa de calor ───────────────────────────────────────────────────────────

function MapaCalor({ calor, periodo }) {
  const [hover, setHover] = useState(null); // { d, h, x, y }
  const max = calor ? Math.max(0, ...calor.flat()) : 0;
  const total = calor ? calor.flat().reduce((a, b) => a + b, 0) : 0;
  const nivel = n => (n <= 0 || !max ? 0 : Math.max(1, Math.ceil((n / max) * 5)));

  let pico = null;
  let diaPico = null;
  if (calor && total) {
    calor.forEach((fila, d) => fila.forEach((n, h) => { if (!pico || n > pico.n) pico = { d, h, n }; }));
    const porDia = calor.map(f => f.reduce((a, b) => a + b, 0));
    diaPico = porDia.indexOf(Math.max(...porDia));
  }
  const rango = h => `${String(h).padStart(2, '0')} a ${String((h + 1) % 24).padStart(2, '0')} h`;

  return (
    <section className="card inicio-card calor-card">
      <div className="inicio-card-head">
        <div>
          <h3>¿Cuándo te escriben?</h3>
          <span className="inicio-card-sub">Mensajes de tus clientes por día y hora, {periodo}</span>
        </div>
      </div>

      {!calor ? (
        <span className="skeleton" style={{ width: '100%', height: 170, display: 'block' }} />
      ) : (
        <>
          <div className="calor" onMouseLeave={() => setHover(null)}>
            <div className="calor-grilla" role="img" aria-label={`Mensajes por día y hora. Total: ${total}.`}>
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={`h${h}`} className="calor-hora">{h % 3 === 0 ? h : ''}</span>
              ))}
              {calor.map((fila, d) => (
                <div key={d} className="calor-fila">
                  <span className="calor-dia">{DIAS_CALOR[d]}</span>
                  {fila.map((n, h) => (
                    <span key={h} className={`calor-celda nivel-${nivel(n)} ${hover && hover.d === d && hover.h === h ? 'is-hover' : ''}`}
                          onMouseEnter={e => setHover({ d, h, x: e.currentTarget.offsetLeft + e.currentTarget.offsetWidth / 2, y: e.currentTarget.offsetTop })} />
                  ))}
                </div>
              ))}
            </div>
            {hover && (
              <div className="grafico-tooltip" style={{ left: hover.x, top: hover.y }}>
                <small>{DIAS_CALOR_LARGO[hover.d][0].toUpperCase() + DIAS_CALOR_LARGO[hover.d].slice(1)}, {rango(hover.h)}</small>
                <strong>{calor[hover.d][hover.h]} {plural(calor[hover.d][hover.h], 'mensaje')}</strong>
              </div>
            )}
          </div>

          <div className="calor-pie">
            {total ? (
              <div className="calor-datos">
                <span><Icon name="clock" /> Hora pico: <strong>{DIAS_CALOR_LARGO[pico.d]} de {rango(pico.h)}</strong></span>
                <span><Icon name="trendingUp" /> Día con más mensajes: <strong>{DIAS_CALOR_LARGO[diaPico]}</strong></span>
              </div>
            ) : <span className="calor-datos">Todavía no hay mensajes en este período.</span>}
            <div className="calor-leyenda" aria-hidden="true">
              Menos {[0, 1, 2, 3, 4, 5].map(i => <span key={i} className={`calor-celda nivel-${i}`} />)} Más
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// ── Necesita tu atención ────────────────────────────────────────────────────

function hace(iso) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ayer';
  if (d < 30) return `hace ${d} días`;
  return `el ${new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}`;
}

// "2 h 54 min" (más claro que "2,9 h").
function horasMinutos(min) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Cuánto queda para que WhatsApp cierre la ventana de 24 hs de ese chat.
function Queda({ minutos }) {
  const clase = minutos <= 120 ? 'is-urgente' : minutos <= 360 ? 'is-pronto' : '';
  return <span className={`queda ${clase}`}>quedan {horasMinutos(Math.max(1, minutos))}</span>;
}

function Avatar({ item }) {
  return (
    <span className={`chat-avatar inicio-avatar tono-${tono(item.userId)}`}>
      {item.nombre ? iniciales(item.nombre) : <Icon name="user" />}
    </span>
  );
}

function Atencion({ atencion, base, botApagado }) {
  if (!atencion) {
    return (
      <section className="card inicio-card atencion-card">
        <div className="inicio-card-head"><h3>Necesita tu atención</h3></div>
        {[0, 1, 2].map(i => <div key={i} className="atencion-grupo"><span className="skeleton" style={{ width: `${70 - i * 12}%` }} /></div>)}
      </section>
    );
  }
  const { sinResponder, reclamos, pendientes } = atencion;
  const total = sinResponder.total + reclamos.total + pendientes.total;

  return (
    <section className="card inicio-card atencion-card">
      <div className="inicio-card-head">
        <h3>Necesita tu atención</h3>
        {total > 0 && <span className="atencion-total">{total}</span>}
      </div>

      {total === 0 ? (
        <div className="atencion-ok">
          <span><Icon name="checkCircle" /></span>
          <strong>Todo al día</strong>
          <p>No hay chats esperando respuesta, reclamos ni pedidos por confirmar.</p>
        </div>
      ) : (
        <div className="atencion-lista">
          {sinResponder.total > 0 && (
            <div className="atencion-grupo">
              <Link to={`${base}/chats?bot=pausado`} className="atencion-titulo tono-violeta">
                <span className="atencion-icono"><Icon name="message" /></span>
                <span><strong>{sinResponder.total} {plural(sinResponder.total, 'chat')}</strong> {plural(sinResponder.total, 'espera', 'esperan')} tu respuesta</span>
                <span className="atencion-ayuda"
                      title={`${botApagado ? 'El bot está apagado' : 'Tienen el bot pausado'} y el cliente escribió último. Primero los que menos tiempo tienen: WhatsApp deja responder hasta 24 hs después del último mensaje.`}>
                  <Icon name="info" />
                </span>
                <Icon name="arrowRight" className="atencion-flecha" />
              </Link>
              <ul>
                {sinResponder.items.map(i => (
                  <li key={i.userId}>
                    <Link to={`${base}/chats?chat=${encodeURIComponent(i.userId)}`}>
                      <Avatar item={i} />
                      <span className="atencion-item-texto">
                        <strong>{i.nombre || i.numero}</strong>
                        <small>{i.mensaje}</small>
                      </span>
                      <Queda minutos={i.minutosRestantes} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {reclamos.total > 0 && (
            <div className="atencion-grupo">
              <Link to={`${base}/reclamos`} className="atencion-titulo tono-rojo">
                <span className="atencion-icono"><Icon name="alertTriangle" /></span>
                <span><strong>{reclamos.total} {plural(reclamos.total, 'reclamo abierto', 'reclamos abiertos')}</strong></span>
                <Icon name="arrowRight" className="atencion-flecha" />
              </Link>
              <ul>
                {reclamos.items.map(i => (
                  <li key={i.id}>
                    <Link to={`${base}/chats?chat=${encodeURIComponent(i.userId)}`}>
                      <Avatar item={i} />
                      <span className="atencion-item-texto">
                        <strong>{i.nombre || i.numero}</strong>
                        <small>{i.motivo || 'Sin motivo'}</small>
                      </span>
                      <span className="atencion-hace">{hace(i.fecha)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendientes.total > 0 && (
            <div className="atencion-grupo">
              <Link to={`${base}/pedidos`} className="atencion-titulo tono-ambar">
                <span className="atencion-icono"><Icon name="clock" /></span>
                <span><strong>{pendientes.total} {plural(pendientes.total, 'pedido')}</strong> por confirmar</span>
                <Icon name="arrowRight" className="atencion-flecha" />
              </Link>
              <ul>
                {pendientes.items.map(i => (
                  <li key={i.id}>
                    <Link to={`${base}/pedidos`}>
                      <Avatar item={i} />
                      <span className="atencion-item-texto">
                        <strong>Pedido #{i.id}</strong>
                        <small>{i.nombre || i.numero}</small>
                      </span>
                      <span className="atencion-monto">{plata(i.monto)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ── Actividad reciente ──────────────────────────────────────────────────────

// Junta los contactos nuevos seguidos en un solo renglón ("Jorge, Paula y 6 más
// escribieron por primera vez") para que la lista no sea siempre lo mismo.
function agrupar(items, max = 7) {
  const salida = [];
  for (const a of items) {
    const ultimo = salida[salida.length - 1];
    if (a.tipo === 'contacto' && ultimo && (ultimo.tipo === 'contacto' || ultimo.tipo === 'contactos')) {
      if (ultimo.tipo === 'contacto') salida[salida.length - 1] = { tipo: 'contactos', fecha: ultimo.fecha, personas: [ultimo, a] };
      else ultimo.personas.push(a);
    } else {
      salida.push(a);
    }
  }
  return salida.slice(0, max);
}

function Actividad({ items, base }) {
  const filas = items ? agrupar(items) : null;
  return (
    <section className="card inicio-card">
      <div className="inicio-card-head">
        <h3>Actividad reciente</h3>
      </div>
      {!filas ? (
        <div className="actividad">{[0, 1, 2, 3].map(i => <div key={i} className="actividad-item"><span className="skeleton" style={{ width: `${75 - i * 10}%` }} /></div>)}</div>
      ) : !filas.length ? (
        <p className="inicio-vacio">Todavía no hay actividad. Cuando alguien le escriba a tu bot, lo vas a ver acá.</p>
      ) : (
        <ol className="actividad">
          {filas.map((a, n) => {
            if (a.tipo === 'contactos') {
              const nombres = a.personas.map(p => p.nombre || numero(p.userId));
              const resto = nombres.length - 2;
              return (
                <li key={`grupo-${n}`} className="actividad-item">
                  <span className="actividad-icono tono-violeta"><Icon name="userPlus" /></span>
                  <Link to={`${base}/chats`} className="actividad-texto">
                    <span className="actividad-caras">
                      {a.personas.slice(0, 4).map(p => <Avatar key={p.userId} item={p} />)}
                    </span>
                    <strong>{nombres[0]}</strong>, <strong>{nombres[1]}</strong>
                    {resto > 0 && <> y <strong>{resto} más</strong></>} escribieron por primera vez
                  </Link>
                  <span className="actividad-hace">{hace(a.fecha)}</span>
                </li>
              );
            }
            const quien = a.nombre || numero(a.userId);
            let icono, tonoItem, texto, link;
            if (a.tipo === 'pedido') {
              icono = 'truck'; tonoItem = a.detalle === 'cancelado' ? 'gris' : 'violeta'; link = `${base}/pedidos`;
              texto = <><strong>{quien}</strong> hizo el pedido <strong>#{a.id}</strong>{a.monto ? <> por <strong>{plata(a.monto)}</strong></> : null}
                <span className={`badge badge-${a.detalle} actividad-badge`}>{ESTADO_PEDIDO[a.detalle] || a.detalle}</span></>;
            } else if (a.tipo === 'reclamo') {
              icono = 'alertTriangle'; tonoItem = 'rojo'; link = `${base}/reclamos`;
              texto = <><strong>{quien}</strong> hizo un reclamo{a.detalle ? <>: <em>{a.detalle}</em></> : null}</>;
            } else if (a.tipo === 'consulta') {
              icono = 'search'; link = `${base}/consultas`;
              if (!a.articulo) {
                tonoItem = 'gris';
                texto = <><strong>{quien}</strong> buscó <em>“{a.detalle}”</em> <span className="actividad-nota">no está en tu catálogo</span></>;
              } else {
                tonoItem = 'violeta';
                texto = <><strong>{quien}</strong> preguntó por <em>{a.articulo}</em>{a.sinStock ? <span className="actividad-nota is-ambar">sin stock</span> : null}</>;
              }
            } else {
              icono = 'userPlus'; tonoItem = 'violeta'; link = `${base}/chats?chat=${encodeURIComponent(a.userId)}`;
              texto = <><strong>{quien}</strong> escribió por primera vez</>;
            }
            return (
              <li key={`${a.tipo}-${a.id ?? a.userId}-${n}`} className="actividad-item">
                <span className={`actividad-icono tono-${tonoItem}`}><Icon name={icono} /></span>
                <Link to={link} className="actividad-texto">{texto}</Link>
                <span className="actividad-hace">{hace(a.fecha)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
