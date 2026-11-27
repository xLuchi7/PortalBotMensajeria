import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import BotSwitch from '../components/BotSwitch.jsx';
import EstadoChat from '../components/EstadoChat.jsx';
import AprendizajeForm from '../components/AprendizajeForm.jsx';
import { Pagination, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useCliente } from '../components/Layout.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api, useApi } from '../lib/api.js';
import { useEnVivo } from '../lib/eventos.jsx';
import { iniciales, plural, query, tono } from '../lib/format.js';


// La misma bandeja sirve para dos páginas: Chats (todos) y Atención Humana
// (modo="humano": solo los chats que pidieron hablar con una persona, con su
// estado Pendiente / Atendido). La conversación y el envío son los mismos.
const MODOS = {
  chats: {
    titulo: 'Chats',
    sub: 'Todas las conversaciones de tus clientes. Abrí un chat para leerlo, responder vos o pausar el bot.',
    lista: '/chats',
    vacio: 'Todavía no hay chats.',
  },
  humano: {
    titulo: 'Atención Humana',
    sub: 'Chats donde pidieron hablar con una persona. El bot quedó pausado: leé lo que pasó y respondele desde acá.',
    lista: '/humano-solicitado',
    vacio: 'Nadie pidió hablar con una persona todavía.',
    estadoDefault: 'pendiente',
    vacioDefault: 'No hay chats pendientes de atender 🎉',
  },
  reclamos: {
    titulo: 'Reclamos',
    sub: 'Reclamos, devoluciones o pedidos fuera de lo común que registró el bot. Leé el chat, respondele y cambiá el estado de cada reclamo.',
    lista: '/reclamos-bandeja',
    vacio: 'No hay reclamos todavía 🎉',
    estadoDefault: 'pendiente',
    vacioDefault: 'No hay reclamos pendientes 🎉',
  },
};

export default function Chats({ modo = 'chats' }) {
  const m = MODOS[modo];
  useTitulo(m.titulo);
  const { clienteId } = useParams();
  const [params, setParams] = useSearchParams();
  const { cliente } = useCliente();
  // Atención Humana y Reclamos abren en "Pendientes": sin ?estado se usa el
  // default, y "Todos" queda explícito en la URL (?estado=todos).
  const TODOS = m.estadoDefault ? 'todos' : '';
  const estadoUrl = params.get('estado');
  const filtros = {
    q: params.get('q') || '',
    estado: estadoUrl === null ? (m.estadoDefault || '') : estadoUrl === 'todos' ? '' : estadoUrl,
    bot: params.get('bot') || '',
    page: params.get('page') || '',
  };
  const chatId = params.get('chat') || '';

  const lista = useApi(`/clientes/${clienteId}${m.lista}${query(filtros)}`);
  const chat = useApi(chatId ? `/clientes/${clienteId}/chats/${encodeURIComponent(chatId)}` : null);
  const datos = lista.data;

  // Cambia parámetros de la URL conservando el resto (filtros, chat abierto).
  const cambiar = useCallback((cambios) => {
    const nuevos = new URLSearchParams(params);
    Object.entries(cambios).forEach(([k, v]) => (v ? nuevos.set(k, v) : nuevos.delete(k)));
    setParams(nuevos);
  }, [params, setParams]);

  const nuevos = useTiempoReal({ clienteId, huella: datos?.huella, lista, chat, filas: datos?.rows, titulo: m.titulo });

  useEnVivo(['escalamiento', 'pedido'], () => { if (modo === 'reclamos') lista.reload(); });

  const hayFiltro = filtros.q || filtros.estado || filtros.bot;
  const resumen = datos?.resumen;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{m.titulo}</h1>
          <p className="page-sub">{m.sub}</p>
        </div>
        {resumen && (
          <div className="page-actions">
            <span className="pill"><span className="live-dot" title="Se actualiza solo" /><strong>{resumen.total}</strong> {plural(resumen.total, 'chat')}</span>
            {modo !== 'chats' && resumen.pendiente > 0 && (
              <button type="button" className="pill pill-danger pill-btn" onClick={() => cambiar({ estado: filtros.estado === 'pendiente' ? TODOS : 'pendiente', page: '' })}>
                <Icon name="user" /> <strong>{resumen.pendiente}</strong> {plural(resumen.pendiente, 'pendiente')}
              </button>
            )}
            {resumen.pausados > 0 && (
              <button type="button" className="pill pill-danger pill-btn" onClick={() => cambiar({ bot: filtros.bot === 'pausado' ? '' : 'pausado', page: '' })}>
                <Icon name="pause" /> <strong>{resumen.pausados}</strong> con el bot pausado
              </button>
            )}
          </div>
        )}
      </div>

      {cliente && cliente.botActivo === false && (
        <div className="bot-banner">
          <Icon name="power" />
          <div><strong>El bot está apagado para todos los chats.</strong> Nadie está recibiendo respuestas automáticas.</div>
          <Link to={`/clientes/${clienteId}/negocio`} className="btn btn-outline">Encenderlo en Mi Negocio</Link>
        </div>
      )}

      <div className="chat-filtros">
        <Buscador valor={filtros.q} onBuscar={q => cambiar({ q, page: '' })} />
        <div className="chip-row">
          <button type="button" className={`chip ${!filtros.estado && !filtros.bot ? 'active' : ''}`} onClick={() => cambiar({ estado: TODOS, bot: '', page: '' })}>
            Todos <span>{resumen ? resumen.total : '·'}</span>
          </button>
          {Object.entries(datos?.estados || {}).map(([clave, e]) => (
            <button key={clave} type="button" className={`chip chip-${clave} ${filtros.estado === clave ? 'active' : ''}`}
                    onClick={() => cambiar({ estado: filtros.estado === clave ? TODOS : clave, page: '' })}>
              {e.label} <span>{resumen?.[clave] ?? '·'}</span>
            </button>
          ))}
          {resumen && modo === 'chats' && (
            <button type="button" className={`chip chip-pausado ${filtros.bot === 'pausado' ? 'active' : ''}`}
                    onClick={() => cambiar({ bot: filtros.bot === 'pausado' ? '' : 'pausado', page: '' })}>
              <Icon name="pause" /> Bot Pausado <span>{resumen.pausados}</span>
            </button>
          )}
        </div>
      </div>

      <div className={`inbox card ${chatId ? 'has-chat' : ''}`}>
        <aside className="inbox-list">
          <div className="inbox-list-head">
            <span><Icon name="inbox" /> Conversaciones</span>
            {datos && <small>{datos.rows.length ? `${datos.rows.length} en esta página` : ''}</small>}
          </div>
          {!datos ? (
            <ListaCargando />
          ) : !datos.rows.length ? (
            <div className="empty-state">
              <Icon name="inbox" />
              <p>{!hayFiltro ? m.vacio : !filtros.q && !filtros.bot && filtros.estado === m.estadoDefault ? m.vacioDefault : 'No hay chats con ese filtro.'}</p>
              {hayFiltro && <button type="button" className="btn btn-outline btn-sm" onClick={() => cambiar({ q: '', estado: TODOS, bot: '', page: '' })}>Ver todos</button>}
              {/* Si quedó en una página que ya no existe, el paginador vuelve solo a la última. */}
              <Pagination page={datos.page} totalPages={datos.totalPages} compacto />
            </div>
          ) : (
            <>
              <div className="chat-items">
                {datos.rows.map(c => (
                  <ItemChat key={c.userId} c={c} activo={chatId === c.userId} nuevo={nuevos.has(c.userId)}
                            onAbrir={() => cambiar({ chat: c.userId })} />
                ))}
              </div>
              <Pagination page={datos.page} totalPages={datos.totalPages} compacto />
            </>
          )}
        </aside>

        <section className={`inbox-panel ${chat.data ? (chat.data.chat.botActivo ? 'bot-on' : 'bot-off') : ''}`}>
          {chatId ? (
            chat.error && !chat.data ? (
              <div className="empty-state inbox-empty">
                <Icon name="inbox" />
                <p>No encontramos ese chat.</p>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => cambiar({ chat: '' })}>Volver a la lista</button>
              </div>
            ) : !chat.data ? (
              <ConversacionCargando />
            ) : (
              <Conversacion
                key={chatId}
                clienteId={clienteId}
                chat={chat.data.chat}
                botGeneralApagado={cliente && cliente.botActivo === false}
                envioHabilitado={datos?.envioHabilitado}
                onCerrar={() => cambiar({ chat: '' })}
                onCambio={() => { chat.reload(); lista.reload(); }}
                humano={modo === 'humano' ? datos?.rows.find(r => r.userId === chatId) : null}
                reclamos={modo === 'reclamos' ? datos?.rows.find(r => r.userId === chatId)?.listaReclamos : null}
                onReclamo={() => lista.reload()}
                setChat={fn => chat.setData(d => ({ ...d, chat: fn(d.chat) }))}
              />
            )
          ) : (
            modo === 'humano' ? <ComoFuncionaHumano /> : modo === 'reclamos' ? <ComoFuncionaReclamos /> : <ComoFunciona />
          )}
        </section>
      </div>
    </>
  );
}

// ── Tiempo real ─────────────────────────────────────────────────────────────
// El servidor avisa cuando hay novedades (lib/eventos.jsx); se confirma con la
// huella (una query chiquita) y, si cambió, recarga la lista y el chat abierto. Devuelve los chats que cambiaron
// para resaltarlos, y con la pestaña en segundo plano cuenta los mensajes
// nuevos en el título.
function useTiempoReal({ clienteId, huella, lista, chat, filas, titulo }) {
  const huellaRef = useRef(huella);
  const anteriores = useRef(null);
  const [nuevos, setNuevos] = useState(() => new Set());
  const sinLeer = useRef(0);
  const recargar = useRef(null);
  recargar.current = () => { lista.reload(); if (chat.data || chat.loading) chat.reload(); };

  useEffect(() => { if (huella) huellaRef.current = huella; }, [huella]);

  // Compara la lista nueva con la anterior para saber qué chats cambiaron.
  useEffect(() => {
    if (!filas) return;
    const antes = anteriores.current;
    anteriores.current = new Map(filas.map(f => [f.userId, f.ultId]));
    if (!antes) return;
    const cambiados = filas.filter(f => antes.get(f.userId) !== f.ultId);
    if (!cambiados.length) return;
    setNuevos(new Set(cambiados.map(f => f.userId)));
    const delCliente = cambiados.filter(f => f.ultimoRol === 'user').length;
    if (document.hidden && delCliente) {
      sinLeer.current += delCliente;
      document.title = `(${sinLeer.current}) ${titulo} — Portal de Clientes`;
    }
    const t = setTimeout(() => setNuevos(new Set()), 2600);
    return () => clearTimeout(t);
  }, [filas]);

  // Cuando el servidor avisa (o al volver a la pestaña), confirma con la huella
  // que de verdad cambió algo antes de recargar. Los avisos "chat" (alguien cambió
  // el nombre, el estado o el bot de un chat desde el portal) no mueven la huella:
  // esos recargan directo.
  useEnVivo(['mensaje', 'chat', 'revision'], async (eventos) => {
    if (eventos.some(e => e.tipo === 'chat')) { recargar.current(); return; }
    try {
      const r = await api(`/clientes/${clienteId}/chats/novedades`);
      if (huellaRef.current && r.huella !== huellaRef.current) {
        huellaRef.current = r.huella;
        recargar.current();
      }
    } catch {
      // Sin red: se reintenta con el próximo aviso.
    }
  });

  useEffect(() => {
    const alVolver = () => {
      if (document.hidden) return;
      sinLeer.current = 0;
      document.title = `${titulo} — Portal de Clientes`;
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [titulo]);

  return nuevos;
}

// ── Lista ───────────────────────────────────────────────────────────────────

// Busca mientras escribís (con una pausa corta), y también con Enter.
function Buscador({ valor, onBuscar }) {
  const [texto, setTexto] = useState(valor);
  const onBuscarRef = useRef(onBuscar);
  onBuscarRef.current = onBuscar;
  useEffect(() => { setTexto(valor); }, [valor]);
  useEffect(() => {
    if (texto === valor) return undefined;
    const t = setTimeout(() => onBuscarRef.current(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto, valor]);
  return (
    <form className="chat-search" onSubmit={e => { e.preventDefault(); onBuscar(texto.trim()); }} role="search">
      <Icon name="search" />
      <input type="search" value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar por nombre o número" autoComplete="off" aria-label="Buscar chats" />
    </form>
  );
}

function Avatar({ userId, nombre, grande = false }) {
  return (
    <div className={`chat-avatar ${grande ? 'chat-avatar-lg' : ''} tono-${tono(userId)}`}>
      {nombre ? iniciales(nombre) : <Icon name="user" />}
    </div>
  );
}

// Panel vacío: explica en tres pasos cómo se usa la bandeja.
function ComoFunciona() {
  return (
    <div className="como-funciona">
      <div className="como-funciona-icono"><Icon name="message" /></div>
      <h2>Elegí un chat de la lista</h2>
      <p>Vas a ver toda la conversación y vas a poder decidir quién responde.</p>
      <ol className="como-funciona-pasos">
        <li className="paso-verde">
          <span className="paso-icono"><Icon name="bot" /></span>
          <div><strong>El bot responde solo</strong><small>Mientras está activo, contesta cada mensaje de ese número.</small></div>
        </li>
        <li className="paso-rojo">
          <span className="paso-icono"><Icon name="pause" /></span>
          <div><strong>Pausalo para atender vos</strong><small>Con el interruptor de arriba del chat. Los chats pausados se marcan en rojo.</small></div>
        </li>
        <li className="paso-violeta">
          <span className="paso-icono"><Icon name="send" /></span>
          <div><strong>Respondé desde acá</strong><small>WhatsApp deja escribirle hasta 24 hs después de su último mensaje.</small></div>
        </li>
      </ol>
    </div>
  );
}

// Panel vacío de Atención Humana.
function ComoFuncionaHumano() {
  return (
    <div className="como-funciona">
      <div className="como-funciona-icono"><Icon name="user" /></div>
      <h2>Elegí un chat de la lista</h2>
      <p>Vas a ver toda la conversación para entender qué pasó antes de responder.</p>
      <ol className="como-funciona-pasos">
        <li className="paso-rojo">
          <span className="paso-icono"><Icon name="pause" /></span>
          <div><strong>El bot se pausó solo</strong><small>Cuando piden una persona (o insultan) le dice que espere y deja de contestar en ese chat.</small></div>
        </li>
        <li className="paso-violeta">
          <span className="paso-icono"><Icon name="send" /></span>
          <div><strong>Respondé desde acá</strong><small>Al mandarle un mensaje, el chat pasa a Atendido solo.</small></div>
        </li>
        <li className="paso-verde">
          <span className="paso-icono"><Icon name="bot" /></span>
          <div><strong>Reactivá el bot al terminar</strong><small>Con el interruptor de arriba del chat. También lo da por atendido.</small></div>
        </li>
      </ol>
    </div>
  );
}

// Panel vacío de Reclamos.
function ComoFuncionaReclamos() {
  return (
    <div className="como-funciona">
      <div className="como-funciona-icono"><Icon name="alertTriangle" /></div>
      <h2>Elegí un chat de la lista</h2>
      <p>Arriba del chat vas a ver sus reclamos, y abajo toda la conversación para entender qué pasó.</p>
      <ol className="como-funciona-pasos">
        <li className="paso-rojo">
          <span className="paso-icono"><Icon name="alertTriangle" /></span>
          <div><strong>Leé el reclamo</strong><small>El bot lo registró con un resumen del motivo.</small></div>
        </li>
        <li className="paso-violeta">
          <span className="paso-icono"><Icon name="send" /></span>
          <div><strong>Respondé desde acá</strong><small>Si querés atenderlo vos, pausá el bot en ese chat.</small></div>
        </li>
        <li className="paso-verde">
          <span className="paso-icono"><Icon name="check" /></span>
          <div><strong>Cambiá el estado</strong><small>Pendiente, En proceso o Resuelto (final). Si el reclamo es de un pedido, al marcar el pedido Solucionado se resuelve solo.</small></div>
        </li>
      </ol>
    </div>
  );
}

// Reclamos del chat abierto, con su estado (Resuelto es final: pide confirmación).
function ReclamosDelChat({ clienteId, reclamos, onCambio }) {
  const avisar = useAvisar();
  const confirmar = useConfirm();
  const [estados, setEstados] = useState({});

  const cambiar = async (r, estado) => {
    if (estado === 'resuelto') {
      const ok = await confirmar({
        titulo: '¿Marcar como resuelto?',
        mensaje: 'Resuelto es un estado final: después no se puede cambiar.',
        boton: 'Marcar resuelto',
        peligro: false,
      });
      if (!ok) return;
    }
    setEstados(e => ({ ...e, [r.id]: estado }));
    try {
      avisar(await api(`/clientes/${clienteId}/escalamientos/${r.id}/estado`, { method: 'POST', body: { estado } }));
    } catch (err) {
      avisar(err);
      setEstados(e => ({ ...e, [r.id]: undefined }));
    }
    onCambio();
  };

  return (
    <div className="chat-reclamos">
      {reclamos.map(r => {
        const estado = estados[r.id] || r.estado;
        return (
          <div key={r.id} className={`chat-reclamo is-${estado}`}>
            <Icon name={estado === 'resuelto' ? 'check' : 'alertTriangle'} />
            <div className="chat-revision-texto">
              <strong>Reclamo{r.pedidoId ? ` · Pedido #${r.pedidoId}` : ''}</strong>
              <span>{r.motivo}{r.fecha && ` · ${r.fecha.slice(0, 17)}`}</span>
            </div>
            {estado === 'resuelto' ? (
              <span className="badge badge-resuelto">Resuelto</span>
            ) : (
              <select value={estado} onChange={ev => cambiar(r, ev.target.value)} className={`badge-select badge-${estado}`} aria-label="Estado del reclamo">
                <option value="pendiente">Pendiente</option>
                <option value="en_proceso">En proceso</option>
                <option value="resuelto">Resuelto</option>
              </select>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ItemChat({ c, activo, nuevo, onAbrir }) {
  const quien = c.ultimoRol === 'user' ? null : c.ultimoEsError ? 'Error:' : c.ultimoEnviadoPor ? 'Vos:' : 'Bot:';
  return (
    <button type="button" onClick={onAbrir} aria-current={activo ? 'true' : undefined}
            className={`chat-item ${activo ? 'active' : ''} ${c.botActivo ? '' : 'is-paused'} ${nuevo && !activo ? 'is-new' : ''} ${c.ultimoRol === 'user' ? 'is-from-client' : ''}`}>
      <div className="chat-item-avatar">
        <Avatar userId={c.userId} nombre={c.nombreVisible} />
        <span className={`chat-avatar-estado ${c.botActivo ? 'on' : 'off'}`} title={c.botActivo ? 'El bot responde este chat' : 'Bot pausado: respondés vos'}>
          <Icon name={c.botActivo ? 'bot' : 'pause'} />
        </span>
      </div>
      <div className="chat-item-body">
        <div className="chat-item-top">
          <span className="chat-item-numero">{c.nombreVisible || c.numero}</span>
          <span className="chat-item-fecha">
            {c.ultimoRol === 'user' && <span className="chat-item-espera" title="El cliente escribió último" />}
            {c.fechaCorta}
          </span>
        </div>
        <div className="chat-item-preview">
          {quien && <span className="chat-item-quien">{quien}</span>}
          {c.ultimoMensaje}
        </div>
        <div className="chat-item-tags">
          <span className={`tag ${c.estadoInfo.clase}`}>{c.estadoInfo.label}</span>
          <span className="tag tag-pausado"><Icon name="pause" /> Bot Pausado</span>
          {c.nombreVisible && <span className="chat-item-tel">{c.numero}</span>}
        </div>
      </div>
    </button>
  );
}

function ListaCargando() {
  return (
    <div className="chat-items">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="chat-item chat-item-skeleton">
          <div className="chat-avatar skeleton-circle" />
          <div className="chat-item-body">
            <span className="skeleton" style={{ width: '55%' }} />
            <span className="skeleton" style={{ width: '85%', marginTop: '0.5rem' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ConversacionCargando() {
  return (
    <div className="chat-thread">
      {[60, 45, 70, 35].map((w, i) => (
        <div key={i} className={`burbuja ${i % 2 ? 'burbuja-bot' : 'burbuja-cliente'} burbuja-skeleton`} style={{ width: `${w}%` }}>
          <span className="skeleton" style={{ width: '90%' }} />
        </div>
      ))}
    </div>
  );
}

// ── Conversación ────────────────────────────────────────────────────────────

function Conversacion({ clienteId, chat, botGeneralApagado, envioHabilitado, onCerrar, onCambio, setChat, humano, reclamos, onReclamo }) {
  const { usuario } = useAuth();
  const avisar = useAvisar();
  const [guardandoBot, setGuardandoBot] = useState(false);
  const [ensenar, setEnsenar] = useState(null);
  const base = `/clientes/${clienteId}/chats/${encodeURIComponent(chat.userId)}`;

  const cambiarBot = async (activo) => {
    setGuardandoBot(true);
    try {
      const r = await api(`${base}/bot`, { method: 'POST', body: { activo } });
      setChat(c => ({ ...c, botActivo: r.activo, botActualizadoPor: usuario.email, botActualizadoEn: null }));
      avisar(r);
      onCambio();
    } catch (err) { avisar(err); }
    setGuardandoBot(false);
  };

  // Saca el chat de "Revisión Humana" sin reactivar el bot.
  const marcarAtendido = async () => {
    try {
      avisar(await api(`${base}/revision/atender`, { method: 'POST' }));
      setChat(c => ({ ...c, revisionHumana: false }));
      onCambio();
    } catch (err) { avisar(err); }
  };

  // Atención Humana: un chat ya atendido se puede volver a abrir.
  const volverAPendiente = async () => {
    try {
      avisar(await api(`/clientes/${clienteId}/humano-solicitado/${encodeURIComponent(chat.userId)}/estado`, { method: 'POST', body: { estado: 'pendiente' } }));
      setChat(c => ({ ...c, revisionHumana: true }));
      onCambio();
    } catch (err) { avisar(err); }
  };

  const ayudaBot = chat.botActivo
    ? 'El bot contesta solo cada mensaje de este número. Pausalo si querés atenderlo vos.'
    : `El bot no le contesta nada a este número hasta que lo actives. Los mensajes nuevos se siguen viendo acá.${chat.botActualizadoEn ? ` Pausado el ${chat.botActualizadoEn}${chat.botActualizadoPor ? ` por ${chat.botActualizadoPor}` : ''}.` : ''}`;

  return (
    <>
      <header className="chat-header">
        <button type="button" className="chat-back" aria-label="Volver a los chats" onClick={onCerrar}><Icon name="arrowLeft" /></button>
        <Avatar userId={chat.userId} nombre={chat.nombreVisible} grande />
        <div className="chat-header-info">
          <NombreContacto base={base} chat={chat} setChat={setChat} onCambio={onCambio} />
          <span className="chat-header-sub">
            {chat.nombreVisible && <>{chat.numero} · </>}
            {chat.nombre && chat.nombrePerfil && chat.nombre !== chat.nombrePerfil && (
              <><span title="Nombre de su perfil de WhatsApp">“{chat.nombrePerfil}”</span> · </>
            )}
            {chat.cantidad} {plural(chat.cantidad, 'mensaje')}
            <EstadoChat base={base} chat={chat} setChat={setChat} onCambio={onCambio} />
          </span>
        </div>
        <BotSwitch
          compacto
          activo={chat.botActivo}
          onToggle={cambiarBot}
          guardando={guardandoBot}
          titulo={{ on: 'Bot respondiendo', off: 'Bot pausado' }}
          texto={{ on: 'Contesta solo en este chat', off: 'Respondés vos' }}
          ayuda={ayudaBot}
        />
      </header>
      {botGeneralApagado && (
        <div className="chat-aviso"><Icon name="power" /> El bot está apagado en general: no responde en ningún chat, tampoco en este. <Link to={`/clientes/${clienteId}/negocio`}>Encenderlo</Link></div>
      )}
      {chat.revisionHumana && (
        <div className="chat-revision" role="alert">
          <Icon name="alertTriangle" />
          <div className="chat-revision-texto">
            <strong>Humano solicitado</strong>
            <span>
              {chat.revisionHumanaMotivo || 'Pidió hablar con una persona.'}
              {chat.revisionHumanaFecha && ` · ${chat.revisionHumanaFecha}`}
              {' · '}El bot le dijo que espere y quedó pausado. Respondele vos; cuando termines, reactivá el bot.
            </span>
          </div>
          <button type="button" className="btn btn-sm btn-outline" onClick={marcarAtendido}><Icon name="check" /> Marcar atendido</button>
        </div>
      )}
      {reclamos?.length > 0 && <ReclamosDelChat clienteId={clienteId} reclamos={reclamos} onCambio={onReclamo} />}
      {humano && !chat.revisionHumana && (
        <div className="chat-revision chat-atendido" role="status">
          <Icon name="check" />
          <div className="chat-revision-texto">
            <strong>Atendido</strong>
            <span>
              {humano.motivo || 'Pidió hablar con una persona.'}
              {(humano.atendidaPor || humano.atendidaEn) && <> · Lo atendió {humano.atendidaPor || 'tu equipo'}{humano.atendidaEn && ` el ${humano.atendidaEn.slice(0, 17)}`}</>}
            </span>
          </div>
          <button type="button" className="btn btn-sm btn-outline" onClick={volverAPendiente}><Icon name="alertTriangle" /> Volver a pendiente</button>
        </div>
      )}

      <div className={`chat-estado-barra ${chat.botActivo ? 'on' : 'off'}`}>
        <span className="chat-estado-texto">
          <Icon name={chat.botActivo ? 'bot' : 'pause'} />
          {chat.botActivo ? 'El bot está atendiendo este chat' : 'Estás atendiendo vos: el bot no responde en este chat'}
        </span>
        <span className="chat-leyenda" aria-label="Colores de los mensajes">
          <span className="ley-cliente">Cliente</span>
          <span className="ley-bot">Bot</span>
          <span className="ley-humano">Vos / tu equipo</span>
        </span>
      </div>

      <Hilo mensajes={chat.mensajes} miEmail={usuario.email}
            onEnsenar={(pregunta, respuesta) => setEnsenar({ pregunta, respuesta, origenUserId: chat.userId })} />
      <AprendizajeForm clienteId={clienteId} inicial={ensenar} onClose={() => setEnsenar(null)} />

      {!envioHabilitado ? (
        <div className="chat-composer-off">Para responder desde acá falta configurar BOT_URL y BOT_API_TOKEN en el portal.</div>
      ) : !chat.ventanaAbierta ? (
        <div className="chat-composer-off"><Icon name="lock" /> Pasaron más de 24 hs desde su último mensaje: WhatsApp no deja escribirle hasta que te vuelva a escribir.</div>
      ) : (
        <Composer base={base} chat={chat} onEnviado={onCambio} />
      )}
    </>
  );
}

function NombreContacto({ base, chat, setChat, onCambio }) {
  const avisar = useAvisar();
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(chat.nombre || '');
  const input = useRef(null);

  useEffect(() => { if (editando) { input.current?.focus(); input.current?.select(); } }, [editando]);

  const guardar = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`${base}/nombre`, { method: 'POST', body: { nombre } });
      avisar(r);
      setChat(c => ({ ...c, nombre: r.nombre || null, nombreVisible: r.nombre || c.nombrePerfil || null }));
      setEditando(false);
      onCambio();
    } catch (err) { avisar(err); }
  };

  if (!editando) {
    return (
      <div className="chat-nombre">
        <strong>{chat.nombreVisible || chat.numero}</strong>
        <button type="button" className="icon-btn icon-btn-sm" title={chat.nombre ? 'Cambiar el nombre' : 'Ponerle un nombre'}
                onClick={() => { setNombre(chat.nombre || ''); setEditando(true); }}>
          <Icon name="edit" />
        </button>
      </div>
    );
  }
  return (
    <form className="chat-nombre-form" onSubmit={guardar} onKeyDown={e => { if (e.key === 'Escape') setEditando(false); }}>
      <input ref={input} type="text" maxLength={100} value={nombre} onChange={e => setNombre(e.target.value)}
             placeholder={chat.nombrePerfil ? `En WhatsApp: ${chat.nombrePerfil}` : 'Ej: Juan de Palermo'} aria-label="Nombre del contacto" />
      <button type="submit" className="icon-btn icon-btn-sm icon-btn-ok" title="Guardar"><Icon name="check" /></button>
      <button type="button" className="icon-btn icon-btn-sm" title="Cancelar" onClick={() => setEditando(false)}><Icon name="x" /></button>
    </form>
  );
}

// Lo que preguntó el cliente antes de la respuesta `i`: sus mensajes seguidos
// más cercanos hacia atrás, para precargar "Enseñarle esto al bot".
function preguntaAntes(mensajes, i) {
  let j = i - 1;
  while (j >= 0 && mensajes[j].role !== 'user') j--;
  const partes = [];
  while (j >= 0 && mensajes[j].role === 'user') partes.unshift(mensajes[j--].content);
  return partes.join(' ').slice(0, 300);
}

// Conversación: arranca abajo de todo, como en WhatsApp. Si llega un mensaje y
// estabas abajo, baja sola; si subiste a leer algo viejo, no te mueve.
function Hilo({ mensajes, miEmail, onEnsenar }) {
  const ref = useRef(null);
  const estabaAbajo = useRef(true);
  const [hayNuevosAbajo, setHayNuevosAbajo] = useState(false);
  const ultimoId = mensajes.length ? mensajes[mensajes.length - 1].id : null;
  const ultimoIdPrevio = useRef(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const primeraVez = ultimoIdPrevio.current === null;
    const llegoAlgo = !primeraVez && ultimoId !== ultimoIdPrevio.current;
    ultimoIdPrevio.current = ultimoId;
    if (primeraVez || estabaAbajo.current) {
      el.scrollTop = el.scrollHeight;
      setHayNuevosAbajo(false);
    } else if (llegoAlgo) {
      setHayNuevosAbajo(true);
    }
  }, [ultimoId]);

  const alScrollear = () => {
    const el = ref.current;
    estabaAbajo.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (estabaAbajo.current) setHayNuevosAbajo(false);
  };

  const bajar = () => {
    const el = ref.current;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setHayNuevosAbajo(false);
  };

  let diaAnterior = null;
  return (
    <div className="chat-thread-wrap">
      <div className="chat-thread" ref={ref} onScroll={alScrollear}>
        {mensajes.map((m, i) => {
          const separador = m.dia !== diaAnterior;
          diaAnterior = m.dia;
          const clase = m.role === 'user' ? 'burbuja-cliente' : m.enviadoPor ? 'burbuja-humano' : 'burbuja-bot';
          return (
            <Fragment key={m.id}>
              {separador && <div className="chat-dia"><span>{m.dia}</span></div>}
              <div className={`burbuja ${clase} ${m.esError ? 'burbuja-error' : ''}`}>
                {m.role !== 'user' && m.enviadoPor && (
                  <span className="burbuja-autor"><Icon name="user" /> {m.enviadoPor === miEmail ? 'Vos' : m.enviadoPor}</span>
                )}
                {m.role !== 'user' && !m.enviadoPor && <span className="burbuja-autor"><Icon name="bot" /> Bot</span>}
                <div className="burbuja-texto">{m.content}</div>
                <span className="burbuja-hora">
                  {m.role !== 'user' && m.enviadoPor && onEnsenar && (
                    <button type="button" className="burbuja-ensenar" title="Guardar esta respuesta para que el bot la use con otros clientes"
                            onClick={() => onEnsenar(preguntaAntes(mensajes, i), String(m.content || '').slice(0, 1000))}>
                      <Icon name="sparkles" /> Enseñarle esto al bot
                    </button>
                  )}
                  {m.hora}
                </span>
              </div>
            </Fragment>
          );
        })}
      </div>
      {hayNuevosAbajo && (
        <button type="button" className="chat-nuevos-abajo" onClick={bajar}>Mensajes nuevos ↓</button>
      )}
    </div>
  );
}

// Caja para responder: Enter envía, Shift+Enter baja de línea, crece con el texto.
function Composer({ base, chat, onEnviado }) {
  const avisar = useAvisar();
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const area = useRef(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  const enviar = async (e) => {
    e?.preventDefault();
    if (!texto.trim() || enviando) return;
    setEnviando(true);
    try {
      avisar(await api(`${base}/enviar`, { method: 'POST', body: { texto } }));
      setTexto('');
      onEnviado();
    } catch (err) { avisar(err); }
    setEnviando(false);
    area.current?.focus();
  };

  return (
    <form className="chat-composer" onSubmit={enviar}>
      <textarea
        ref={area}
        rows={1}
        maxLength={4096}
        value={texto}
        onChange={e => setTexto(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) enviar(e); }}
        placeholder="Escribí tu respuesta… (Enter envía, Shift+Enter baja de línea)"
        aria-label="Tu respuesta"
      />
      <button type="submit" className="btn btn-primary" disabled={enviando || !texto.trim()}>
        {enviando ? <span className="spinner spinner-sm" /> : <Icon name="send" />} Enviar
      </button>
      <div className="chat-composer-hint">
        {chat.botActivo && <>Al enviar, el bot se pausa en este chat para no contestar encima tuyo · </>}
        Podés escribirle por {Math.floor(chat.ventanaRestante / 60)} h {chat.ventanaRestante % 60} min más
      </div>
    </form>
  );
}
