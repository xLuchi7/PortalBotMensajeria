import { useToast } from './Toasts.jsx';

// <form> que reemplaza el globo de validación del navegador por un toast que
// nombra el campo que falta (igual que el portal viejo) y marca el campo.
export default function Form({ onSubmit, children, ...props }) {
  const toast = useToast();

  const enviar = (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.checkValidity()) {
      const invalido = form.querySelector(':invalid');
      if (!invalido) return toast('warning', 'Revisá los Campos del Formulario');
      invalido.classList.add('field-invalid');
      invalido.addEventListener('input', () => invalido.classList.remove('field-invalid'), { once: true });
      invalido.focus();
      const label = invalido.closest('label');
      let campo = 'un Campo Obligatorio';
      const primero = label && label.childNodes[0];
      if (primero && primero.nodeType === Node.TEXT_NODE && primero.textContent.trim()) campo = primero.textContent.trim();
      return toast('warning', `Falta Completar "${campo}"`);
    }
    onSubmit?.(e);
  };

  return (
    <form noValidate onSubmit={enviar} {...props}>
      {children}
    </form>
  );
}
