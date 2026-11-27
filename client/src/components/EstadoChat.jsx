import { useState } from 'react';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { useAvisar } from './Toasts.jsx';
import { api } from '../lib/api.js';

// Estados que se pueden elegir a mano (mismas claves que ESTADOS en chatService).
const OPCIONES = [
  { valor: 'reclamo', label: 'Reclamo Abierto', clase: 'badge-danger', ayuda: 'Tiene un problema o reclamo sin resolver.' },
  { valor: 'pedido', label: 'Pedido Realizado', clase: 'badge-success', ayuda: 'Ya hizo un pedido.' },
  { valor: 'intencion', label: 'Intención De Compra', clase: 'badge-info', ayuda: 'Consultó productos que tenés y puede comprar.' },
  { valor: 'consulta', label: 'Solo Consulta', clase: 'badge-neutral', ayuda: 'Preguntó algo, sin intención de compra por ahora.' },
];

// Lápiz al lado del estado del chat: abre un modal para elegirlo a mano o
// volver al automático (el que calcula el sistema con pedidos, reclamos, etc.).
export default function EstadoChat({ base, chat, setChat, onCambio }) {
  const avisar = useAvisar();
  const [abierto, setAbierto] = useState(false);
  const [elegido, setElegido] = useState('auto');
  const [guardando, setGuardando] = useState(false);

  const abrir = () => { setElegido(chat.estadoManual || 'auto'); setAbierto(true); };

  const guardar = async (e) => {
    e.preventDefault();
    if (elegido === (chat.estadoManual || 'auto')) { setAbierto(false); return; }
    setGuardando(true);
    try {
      const r = await api(`${base}/estado`, { method: 'POST', body: { estado: elegido } });
      avisar(r);
      setAbierto(false);
      // La conversación y la bandeja se vuelven a pedir (badge, filtros y contadores).
      setChat(c => {
        if (c.revisionHumana) return { ...c, estadoManual: r.estado };
        const o = OPCIONES.find(x => x.valor === r.estado);
        return {
          ...c,
          estadoManual: r.estado,
          estado: o ? o.valor : c.estadoAuto,
          estadoInfo: o ? { label: o.label, clase: o.clase } : c.estadoAutoInfo,
        };
      });
      onCambio();
    } catch (err) { avisar(err); }
    setGuardando(false);
  };

  const auto = chat.estadoAutoInfo;

  return (
    <>
      <button type="button" className="icon-btn icon-btn-sm chat-estado-editar" title="Cambiar el estado del chat" aria-label="Cambiar el estado del chat" onClick={abrir}>
        <Icon name="edit" />
      </button>
      <span className={`tag ${chat.estadoInfo.clase}`} title={chat.estadoManual && chat.estado !== 'revision' ? `Elegido a mano${chat.estadoManualPor ? ` por ${chat.estadoManualPor}` : ''}` : undefined}>
        {chat.estadoInfo.label}
      </span>

      <Modal open={abierto} onClose={() => !guardando && setAbierto(false)} className="modal-estado-chat">
        <form onSubmit={guardar}>
          <h3>Estado del chat</h3>
          <p className="page-hint" style={{ margin: '0 0 1rem' }}>
            Se usa para los filtros y los contadores de la bandeja. Si lo elegís a mano queda fijo hasta que vuelvas a Automático.
          </p>

          <div className="estado-opciones" role="radiogroup" aria-label="Estado del chat">
            <label className={`estado-opcion estado-auto ${elegido === 'auto' ? 'is-on' : ''}`}>
              <input type="radio" name="estado" value="auto" checked={elegido === 'auto'} onChange={() => setElegido('auto')} />
              <span className="estado-punto"><Icon name="refresh" /></span>
              <span className="estado-texto">
                <strong>Automático</strong>
                <small>Según pedidos, reclamos y consultas{auto ? `. Hoy sería: ${auto.label}` : ''}.</small>
              </span>
            </label>
            {OPCIONES.map(o => (
              <label key={o.valor} className={`estado-opcion estado-${o.valor} ${elegido === o.valor ? 'is-on' : ''}`}>
                <input type="radio" name="estado" value={o.valor} checked={elegido === o.valor} onChange={() => setElegido(o.valor)} />
                <span className="estado-punto" />
                <span className="estado-texto">
                  <strong>{o.label}</strong>
                  <small>{o.ayuda}</small>
                </span>
              </label>
            ))}
          </div>

          {chat.revisionHumana && (
            <p className="estado-nota"><Icon name="alertTriangle" /> Mientras espere a una persona se va a seguir viendo como <strong>Humano Solicitado</strong>.</p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={() => setAbierto(false)} disabled={guardando}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
