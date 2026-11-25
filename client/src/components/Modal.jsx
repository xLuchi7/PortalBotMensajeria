import { useEffect, useRef } from 'react';

// <dialog> nativo (mismo estilo .modal de siempre) controlado por `open`.
// Escape o tocar afuera llaman a onClose.
export default function Modal({ open, onClose, wide = false, children, className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'modal-wide' : ''} ${className}`.trim()}
      onCancel={e => { e.preventDefault(); onClose?.(); }}
      onMouseDown={e => {
        // Solo si el clic cae en el fondo oscuro, no en el padding del cuadro.
        if (e.target !== ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const afuera = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
        if (afuera) onClose?.();
      }}
    >
      {open && children}
    </dialog>
  );
}
