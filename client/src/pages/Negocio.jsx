import { useEffect, useRef, useState } from 'react';
import { useBlocker, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import BotSwitch from '../components/BotSwitch.jsx';
import { ErrorCarga, PageHead, useTitulo } from '../components/ui.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useCliente } from '../components/Layout.jsx';
import { api, useApi } from '../lib/api.js';

const IDEAS = [
  ['Horarios', 'Horarios de atención: '],
  ['Envíos', 'Envíos (zonas, costos y demora): '],
  ['Formas de pago', 'Formas de pago: '],
  ['Cambios', 'Cambios y devoluciones: '],
  ['Dirección', 'Dirección del local: '],
  ['Promociones', 'Promociones vigentes: '],
  ['Forma de hablar', 'Cómo quiero que hable el bot (tono, emojis, firma): '],
  ['Lo que no hace', 'Lo que NO tiene que hacer el bot: '],
];

export default function Negocio() {
  useTitulo('Mi Negocio');
  const { clienteId } = useParams();
  const { cliente, setCliente } = useCliente();
  const { data, error, reload } = useApi(`/clientes/${clienteId}/negocio`);
  const avisar = useAvisar();
  const [guardandoBot, setGuardandoBot] = useState(false);

  const cambiarBot = async (activo) => {
    setGuardandoBot(true);
    try {
      const r = await api(`/clientes/${clienteId}/negocio/bot`, { method: 'POST', body: { activo } });
      setCliente(c => ({ ...c, botActivo: r.activo }));
      avisar(r);
    } catch (err) { avisar(err); }
    setGuardandoBot(false);
  };

  const cambiarChatsNuevos = async (activo) => {
    if (cliente?.botChatsNuevosActivo === activo) return;
    try {
      const r = await api(`/clientes/${clienteId}/negocio/chats-nuevos`, { method: 'POST', body: { activo } });
      setCliente(c => ({ ...c, botChatsNuevosActivo: r.activo }));
      avisar(r);
    } catch (err) { avisar(err); }
  };

  return (
    <>
      <PageHead titulo="Mi Negocio" sub="Prendé o apagá el bot y contale cómo es tu negocio para que responda como vos." />

      <section className="seccion">
        <h2 className="seccion-titulo"><Icon name="power" /> Estado del bot</h2>
        {cliente ? (
          <BotSwitch
            activo={cliente.botActivo !== false}
            onToggle={cambiarBot}
            guardando={guardandoBot}
            titulo={{ on: 'El bot está respondiendo', off: 'El bot está apagado' }}
            texto={{
              on: 'Contesta solo a todos tus chats, salvo los que pausaste desde Chats.',
              off: 'No le responde a nadie. Los mensajes se siguen guardando y los ves en Chats.',
            }}
          />
        ) : <div className="bot-switch"><span className="skeleton" style={{ width: '50%' }} /></div>}

        {cliente && (
          <div className="ajuste">
            <div className="ajuste-texto">
              <strong>Chats de números nuevos</strong>
              <span>Cuando alguien escribe por primera vez, el bot arranca así en ese chat. No cambia los chats que ya existen.</span>
            </div>
            <div className="segmentado" role="radiogroup" aria-label="Chats de números nuevos">
              <button type="button" role="radio" aria-checked={Boolean(cliente.botChatsNuevosActivo)}
                      className={cliente.botChatsNuevosActivo ? 'active is-on' : ''} onClick={() => cambiarChatsNuevos(true)}>Responde</button>
              <button type="button" role="radio" aria-checked={!cliente.botChatsNuevosActivo}
                      className={cliente.botChatsNuevosActivo ? '' : 'active is-off'} onClick={() => cambiarChatsNuevos(false)}>No responde</button>
            </div>
          </div>
        )}
      </section>

      <section className="seccion">
        <h2 className="seccion-titulo"><Icon name="clock" /> Horario de atención del bot</h2>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <div className="card editor-card"><span className="skeleton" style={{ width: '60%' }} /></div>
          : <HorarioBot clienteId={clienteId} inicial={data.horarioBot} />}
      </section>

      <section className="seccion">
        <h2 className="seccion-titulo"><Icon name="phone" /> Aviso de revisión humana</h2>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <div className="card editor-card"><span className="skeleton" style={{ width: '60%' }} /></div>
          : <TelefonoAlertas clienteId={clienteId} inicial={data.telefonoAlertas || ''} />}
      </section>

      <section className="seccion">
        <h2 className="seccion-titulo"><Icon name="sparkles" /> Lo que el bot sabe de tu negocio</h2>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <div className="card editor-card"><span className="skeleton" style={{ width: '80%' }} /></div>
          : <EditorContexto clienteId={clienteId} inicial={data.contexto || ''} />}
      </section>
    </>
  );
}

// Fuera de este horario (hora de Argentina) el bot no contesta: guarda los mensajes y a la
// hora de inicio responde todo lo que quedó pendiente, leyendo la conversación completa.
const horarioDe = h => ({ activo: Boolean(h?.desde && h?.hasta), desde: h?.desde || '08:00', hasta: h?.hasta || '19:00' });

function HorarioBot({ clienteId, inicial }) {
  const [valor, setValor] = useState(() => horarioDe(inicial));
  const [guardado, setGuardado] = useState(() => horarioDe(inicial));
  const [guardando, setGuardando] = useState(false);
  const avisar = useAvisar();
  const sucio = valor.activo !== guardado.activo || (valor.activo && (valor.desde !== guardado.desde || valor.hasta !== guardado.hasta));
  const cambiar = cambio => setValor(v => ({ ...v, ...cambio }));

  const guardar = async (e) => {
    e.preventDefault();
    if (valor.activo && valor.desde === valor.hasta) {
      avisar({ tipo: 'warning', mensaje: 'La Hora De Inicio Y De Fin No Pueden Ser Iguales' });
      return;
    }
    setGuardando(true);
    try {
      const r = await api(`/clientes/${clienteId}/negocio/horario`, { method: 'PUT', body: valor });
      avisar(r);
      const nuevo = horarioDe(r.horarioBot);
      setValor(nuevo);
      setGuardado(nuevo);
    } catch (err) { avisar(err); }
    setGuardando(false);
  };

  return (
    <div className="card alertas-card">
      <p className="alertas-ayuda">
        Fuera de este horario el bot no responde: los mensajes se guardan (los ves en Chats) y a la hora de inicio
        el bot contesta todo lo que quedó pendiente, leyendo la conversación completa.
      </p>
      <form onSubmit={guardar} className="horario-form">
        <div className="segmentado" role="radiogroup" aria-label="Horario del bot">
          <button type="button" role="radio" aria-checked={!valor.activo} className={valor.activo ? '' : 'active'} onClick={() => cambiar({ activo: false })}>Las 24 hs</button>
          <button type="button" role="radio" aria-checked={valor.activo} className={valor.activo ? 'active' : ''} onClick={() => cambiar({ activo: true })}>En un horario</button>
        </div>
        {valor.activo && (
          <div className="horario-rango">
            <label>De <input type="time" value={valor.desde} onChange={e => cambiar({ desde: e.target.value })} required /></label>
            <label>a <input type="time" value={valor.hasta} onChange={e => cambiar({ hasta: e.target.value })} required /></label>
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={guardando || !sucio}><Icon name="save" /> {guardando ? 'Guardando…' : 'Guardar'}</button>
      </form>
      <p className="alertas-nota">
        Hora de Argentina. Los chats en Atención Humana o con el bot pausado no se responden solos al abrir.
        WhatsApp deja contestar hasta 24 hs después del último mensaje del cliente: lo que tenga más de 24 hs ya no se responde.
      </p>
    </div>
  );
}

// "+54 9 11 5486-8604" a partir de los dígitos guardados (5491154868604).
function lindo(digitos) {
  const d = String(digitos || '').replace(/\D/g, '');
  const m = /^549(11|\d{3,4})(\d{3,4})(\d{4})$/.exec(d);
  if (m) return `+54 9 ${m[1]} ${m[2]}-${m[3]}`;
  return d ? `+${d}` : '';
}

// Número al que el bot le escribe por WhatsApp cuando un chat pasa a revisión
// humana (alguien pide una persona o insulta).
function TelefonoAlertas({ clienteId, inicial }) {
  const [telefono, setTelefono] = useState(lindo(inicial));
  const [guardado, setGuardado] = useState(lindo(inicial));
  const [guardando, setGuardando] = useState(false);
  const avisar = useAvisar();
  const sucio = telefono.trim() !== guardado;

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      const r = await api(`/clientes/${clienteId}/negocio/alertas`, { method: 'PUT', body: { telefonoAlertas: telefono } });
      avisar(r);
      setTelefono(lindo(r.telefonoAlertas));
      setGuardado(lindo(r.telefonoAlertas));
    } catch (err) { avisar(err); }
    setGuardando(false);
  };

  return (
    <div className="card alertas-card">
      <p className="alertas-ayuda">
        Si alguien pide hablar con una persona o insulta, el bot le responde <em>“Esperame un momento que lo estoy consultando”</em>,
        deja de contestar en ese chat y le manda un WhatsApp a este número avisando. En el portal el chat aparece como <strong>Humano Solicitado</strong>.
      </p>
      <form onSubmit={guardar} className="alertas-form">
        <input type="tel" inputMode="tel" value={telefono} onChange={e => setTelefono(e.target.value)}
               placeholder="+54 9 11 1234-5678" aria-label="Número para los avisos" maxLength={30} />
        <button type="submit" className="btn btn-primary" disabled={guardando || !sucio}><Icon name="save" /> {guardando ? 'Guardando…' : 'Guardar'}</button>
      </form>
      <p className="alertas-nota">
        Con código de país. Para que el aviso llegue, ese número tiene que haberle escrito al número del bot en las últimas 24 hs
        (es una regla de WhatsApp); si no, solo llega si el admin configuró la plantilla de alerta. Igual el chat siempre se marca acá en el portal.
      </p>
    </div>
  );
}

function EditorContexto({ clienteId, inicial }) {
  const [texto, setTexto] = useState(inicial);
  const [guardado, setGuardado] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const area = useRef(null);
  const avisar = useAvisar();
  const confirmar = useConfirm();
  const sucio = texto !== guardado;

  // Cambios sin guardar: avisa al cerrar la pestaña o al ir a otra página.
  useEffect(() => {
    const alSalir = e => { if (sucio) e.preventDefault(); };
    window.addEventListener('beforeunload', alSalir);
    return () => window.removeEventListener('beforeunload', alSalir);
  }, [sucio]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => sucio && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    confirmar({
      titulo: '¿Salir sin guardar?',
      mensaje: 'Hiciste cambios en lo que el bot sabe de tu negocio y no los guardaste.',
      boton: 'Salir sin guardar',
    }).then(ok => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirmar]);

  const agregar = (plantilla) => {
    const base = texto.replace(/\s+$/, '');
    const nuevo = (base ? base + '\n' : '') + plantilla;
    setTexto(nuevo);
    requestAnimationFrame(() => {
      const el = area.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nuevo.length, nuevo.length);
      el.scrollTop = el.scrollHeight;
    });
  };

  const guardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    try {
      avisar(await api(`/clientes/${clienteId}/negocio`, { method: 'PUT', body: { contextoNegocio: texto } }));
      setGuardado(texto);
    } catch (err) { avisar(err); }
    setGuardando(false);
  };

  return (
    <div className="negocio-layout">
      <div className="card editor-card">
        <form onSubmit={guardar}>
          <textarea
            ref={area}
            rows={16}
            maxLength={8000}
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); if (sucio) guardar(e); } }}
            placeholder="Ej: Somos un almacén de barrio en Palermo. Atendemos de lunes a sábado de 8 a 21 hs. Hacemos envíos en el día dentro de 20 cuadras. Aceptamos efectivo, transferencia y Mercado Pago. Hablá cercano y con buena onda."
          />
          <div className="editor-footer">
            <span className={`editor-estado ${sucio ? 'is-dirty' : ''}`}>
              {texto.length} caracteres · el bot lo lee antes de cada respuesta
            </span>
            <button type="submit" className="btn btn-primary" disabled={guardando || !sucio}><Icon name="save" /> {guardando ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </form>
      </div>

      <div className="card negocio-tips">
        <div className="negocio-tips-header"><Icon name="sparkles" /> Tocá para agregar</div>
        <p>Cuanto más le cuentes, mejor responde. Tocá una idea y completala.</p>
        <div className="tips">
          {IDEAS.map(([label, plantilla]) => (
            <button key={label} type="button" onClick={() => agregar(plantilla)}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
