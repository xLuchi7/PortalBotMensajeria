import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal.jsx';

const ConfirmContext = createContext(async () => false);

// const ok = await confirmar({ titulo, mensaje, boton }) — reemplaza al
// confirmarEliminar() del portal viejo.
export function ConfirmProvider({ children }) {
  const [pedido, setPedido] = useState(null);
  const resolver = useRef(null);

  const confirmar = useCallback(({ titulo = '¿Eliminar?', mensaje, boton = 'Eliminar', peligro = true }) => (
    new Promise(resolve => {
      resolver.current = resolve;
      setPedido({ titulo, mensaje, boton, peligro });
    })
  ), []);

  const responder = valor => {
    resolver.current?.(valor);
    resolver.current = null;
    setPedido(null);
  };

  return (
    <ConfirmContext.Provider value={confirmar}>
      {children}
      <Modal open={Boolean(pedido)} onClose={() => responder(false)}>
        {pedido && (
          <>
            <h3>{pedido.titulo}</h3>
            <p className="page-hint" style={{ margin: '0 0 1.25rem' }}>{pedido.mensaje}</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => responder(false)}>Cancelar</button>
              <button type="button" className={`btn ${pedido.peligro ? 'btn-danger-outline' : 'btn-primary'}`} onClick={() => responder(true)} autoFocus>
                {pedido.boton}
              </button>
            </div>
          </>
        )}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
