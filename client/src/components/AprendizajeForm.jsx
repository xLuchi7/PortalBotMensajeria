import { useState } from 'react';
import Modal from './Modal.jsx';
import Form from './Form.jsx';
import { useAvisar } from './Toasts.jsx';
import { api } from '../lib/api.js';

// Alta/edición de un aprendizaje (pregunta → respuesta que el bot suma a su prompt).
// Se usa en la página Aprendizajes y desde el chat ("Enseñarle esto al bot"),
// donde llega precargado con el mensaje del cliente y la respuesta que se le dio.
// `inicial` = null cierra el modal; con `id` edita, sin `id` crea.
export default function AprendizajeForm({ clienteId, inicial, onClose, onGuardado }) {
  return (
    <Modal open={Boolean(inicial)} onClose={onClose}>
      {inicial && <Formulario clienteId={clienteId} inicial={inicial} onClose={onClose} onGuardado={onGuardado} />}
    </Modal>
  );
}

function Formulario({ clienteId, inicial, onClose, onGuardado }) {
  const avisar = useAvisar();
  const [pregunta, setPregunta] = useState(inicial.pregunta || '');
  const [respuesta, setRespuesta] = useState(inicial.respuesta || '');
  const [guardando, setGuardando] = useState(false);
  const desdeChat = Boolean(inicial.origenUserId) && !inicial.id;

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try {
      const ruta = inicial.id ? `/clientes/${clienteId}/aprendizajes/${inicial.id}` : `/clientes/${clienteId}/aprendizajes`;
      avisar(await api(ruta, { method: 'POST', body: { pregunta, respuesta, origenUserId: inicial.origenUserId || null } }));
      onGuardado?.();
      onClose();
    } catch (err) { avisar(err); }
    setGuardando(false);
  };

  return (
    <Form onSubmit={guardar} className="aprendizaje-form">
      <h3>{inicial.id ? 'Editar aprendizaje' : 'Enseñarle algo al bot'}</h3>
      {desdeChat && (
        <p className="aprendizaje-nota">
          Lo precargamos con lo que preguntó el cliente y lo que le respondiste. <strong>Generalizalo</strong> para que sirva
          para cualquier cliente y sacá nombres, teléfonos o datos de este pedido en particular.
        </p>
      )}
      <label>
        Cuando pregunten
        <textarea rows={2} maxLength={300} required autoFocus value={pregunta} onChange={e => setPregunta(e.target.value)}
                  placeholder="Ej: ¿Hacen envíos al interior?" />
        <span className="field-hint">{pregunta.length}/300</span>
      </label>
      <label>
        El bot responde
        <textarea rows={4} maxLength={1000} required value={respuesta} onChange={e => setRespuesta(e.target.value)}
                  placeholder="Ej: Sí, enviamos a todo el país por Andreani. Tarda de 3 a 5 días hábiles y el costo se calcula al confirmar el pedido." />
        <span className="field-hint">{respuesta.length}/1000</span>
      </label>
      <div className="modal-actions">
        <button type="button" className="btn btn-outline" onClick={onClose}>Cancelar</button>
        <button type="submit" className="btn btn-primary" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </Form>
  );
}
