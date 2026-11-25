import Icon from './Icon.jsx';

// Interruptor del bot (general en Mi Negocio, o por chat en compacto).
// `onToggle(nuevoValor)` guarda; mientras tanto se muestra "guardando".
export default function BotSwitch({ activo, onToggle, guardando = false, compacto = false, titulo, texto, ayuda }) {
  return (
    <div
      className={`bot-switch ${compacto ? 'bot-switch-compacto' : ''} ${activo ? 'is-on' : 'is-off'} ${guardando ? 'is-saving' : ''}`}
      title={ayuda || undefined}
    >
      {!compacto && <div className="bot-switch-icon"><Icon name="bot" /></div>}
      <div className="bot-switch-body">
        <div className="bot-switch-title">{activo ? titulo.on : titulo.off}</div>
        <div className="bot-switch-text">{activo ? texto.on : texto.off}</div>
      </div>
      <button
        type="button"
        className="bot-toggle"
        role="switch"
        aria-checked={activo}
        aria-label={activo ? 'Apagar el bot' : 'Encender el bot'}
        disabled={guardando}
        onClick={() => onToggle(!activo)}
      >
        {!compacto && (
          <>
            <span className="bot-toggle-label bot-toggle-on">Responde</span>
            <span className="bot-toggle-label bot-toggle-off">No Responde</span>
          </>
        )}
        <span className="bot-toggle-knob" />
      </button>
    </div>
  );
}
