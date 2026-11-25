import icons from '../lib/icons.js';

// Íconos SVG inline (lib/icons.js). Se renderiza el <svg> directo, sin
// envoltorio, así los estilos de .icon del CSS siguen aplicando igual.
const internos = Object.fromEntries(
  Object.entries(icons).map(([nombre, svg]) => [nombre, svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')])
);

export default function Icon({ name, className = '' }) {
  const inner = internos[name];
  if (!inner) return null;
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
