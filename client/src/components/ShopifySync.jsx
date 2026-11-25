import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';
import { useToast } from './Toasts.jsx';

// Sincronización del catálogo con Shopify (job en el servidor + polling).
// const { iniciar, seguir, dialogo } = useShopifySync(clienteId, { alTerminar })
export function useShopifySync(clienteId, { alTerminar } = {}) {
  const toast = useToast();
  const [estado, setEstado] = useState(null); // null = cerrado
  const timer = useRef(null);
  const activo = useRef(true);

  useEffect(() => {
    activo.current = true;
    return () => { activo.current = false; clearTimeout(timer.current); };
  }, []);

  const poll = useCallback(async (jobId) => {
    let e;
    try {
      e = await api(`/clientes/${clienteId}/shopify/sync/${jobId}`);
    } catch (err) {
      if (activo.current) setEstado({ terminado: true, errorFatal: err.message || 'Se perdió la conexión con el servidor.' });
      return;
    }
    if (!activo.current) return;
    setEstado(e);
    if (!e.terminado) timer.current = setTimeout(() => poll(jobId), 800);
  }, [clienteId]);

  const seguir = useCallback((jobId) => {
    setEstado({ terminado: false, procesado: 0, total: 0 });
    poll(jobId);
  }, [poll]);

  const iniciar = useCallback(async () => {
    try {
      const r = await api(`/clientes/${clienteId}/shopify/sync`, { method: 'POST' });
      seguir(r.jobId);
    } catch {
      toast('warning', 'No Se Pudo Iniciar La Sincronización');
    }
  }, [clienteId, seguir, toast]);

  const cerrar = () => {
    if (estado && !estado.terminado) return; // no se cierra a mitad de camino
    setEstado(null);
    alTerminar?.();
  };

  const dialogo = (
    <Modal open={Boolean(estado)} onClose={cerrar}>
      {estado && (!estado.terminado ? <Progreso estado={estado} /> : <Resultado estado={estado} onCerrar={cerrar} />)}
    </Modal>
  );

  return { iniciar, seguir, dialogo, sincronizando: Boolean(estado && !estado.terminado) };
}

function Progreso({ estado }) {
  const texto = estado.total
    ? `${estado.procesado} de ${estado.total} variantes procesadas`
    : estado.procesado ? `${estado.procesado} variantes procesadas` : 'Leyendo productos de la tienda…';
  return (
    <>
      <h3>Sincronizando con Shopify...</h3>
      {estado.total ? <progress value={estado.procesado} max={estado.total} style={{ width: '100%' }} /> : <progress style={{ width: '100%' }} />}
      <p className="page-hint" style={{ margin: '0.75rem 0 0' }}>{texto}</p>
    </>
  );
}

function Resultado({ estado, onCerrar }) {
  const ok = !estado.errorFatal && !estado.erroresCount;
  let titulo, resumen;
  if (estado.errorFatal) {
    titulo = 'No se pudo sincronizar';
    resumen = estado.errorFatal;
  } else {
    titulo = ok ? 'Catálogo sincronizado' : 'Sincronizado con errores';
    const partes = [`${estado.creados} nuevos`, `${estado.actualizados} actualizados`];
    if (estado.desactivados) partes.push(`${estado.desactivados} desactivados (ya no están en Shopify)`);
    if (estado.erroresCount) partes.push(`${estado.erroresCount} con error`);
    resumen = partes.join(' · ');
  }
  return (
    <>
      <div className="modal-result">
        <div className={`modal-result-icon ${ok ? 'success' : 'error'}`}><Icon name={ok ? 'check' : 'alertTriangle'} /></div>
        <h3>{titulo}</h3>
        <p className="page-hint" style={{ margin: 0 }}>{resumen}</p>
      </div>
      {!estado.errorFatal && estado.errores?.length > 0 && (
        <ul className="page-hint" style={{ maxHeight: 160, overflow: 'auto', fontSize: '0.8rem' }}>
          {estado.errores.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      <div className="modal-actions">
        <button type="button" className="btn btn-primary" onClick={onCerrar} autoFocus>Cerrar</button>
      </div>
    </>
  );
}
