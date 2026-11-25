import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Icon from './Icon.jsx';
import { numero } from '../lib/format.js';

// Piezas chicas que se repiten en todas las páginas.

// Título de la pestaña del navegador.
export function useTitulo(titulo) {
  useEffect(() => { document.title = titulo ? `${titulo} — Portal de Clientes` : 'Portal de Clientes'; }, [titulo]);
}

export function paginaDe(params) {
  return Math.max(1, parseInt(params.get('page'), 10) || 1);
}

export function PageHead({ titulo, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{titulo}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </div>
  );
}

export function PageHelp({ titulo, children }) {
  return (
    <details className="page-help">
      <summary><Icon name="info" /> {titulo}</summary>
      <div>{children}</div>
    </details>
  );
}

export function Stats({ children }) {
  return <div className="stats">{children}</div>;
}

export function Stat({ icono, tono = 'primary', valor, texto, alerta, cargando }) {
  return (
    <div className={`stat ${alerta ? `stat-alert-${alerta}` : ''}`}>
      <span className={`stat-icon tone-${tono}`}><Icon name={icono} /></span>
      <div>
        <strong>{cargando ? <span className="skeleton skeleton-num" /> : valor}</strong>
        <span>{texto}</span>
      </div>
    </div>
  );
}

export function Empty({ icono, titulo, children }) {
  return (
    <div className="empty-state">
      <Icon name={icono} />
      {titulo && <h3>{titulo}</h3>}
      {children && <p>{children}</p>}
    </div>
  );
}

// Filas grises mientras carga la primera vez (en vez de una pantalla en blanco).
export function TablaCargando({ filas = 6, columnas = 5 }) {
  return (
    <div className="table-wrap">
      <table>
        <tbody>
          {Array.from({ length: filas }, (_, i) => (
            <tr key={i}>
              {Array.from({ length: columnas }, (_, j) => (
                <td key={j}><span className="skeleton" style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorCarga({ error, onReintentar }) {
  return (
    <div className="empty-state">
      <Icon name="alertTriangle" />
      <h3>No pudimos cargar esto</h3>
      <p>{error?.message || 'Ocurrió un error.'}</p>
      {onReintentar && <button type="button" className="btn btn-outline" onClick={onReintentar}><Icon name="refresh" /> Reintentar</button>}
    </div>
  );
}

// Paginado con ?page= en la URL (conserva el resto de los parámetros).
export function Pagination({ page, totalPages, compacto = false }) {
  const [params, setParams] = useSearchParams();
  if (totalPages <= 1) return null;
  const ir = p => {
    const nuevos = new URLSearchParams(params);
    if (p > 1) nuevos.set('page', p); else nuevos.delete('page');
    setParams(nuevos);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return (
    <div className={compacto ? 'inbox-pagination' : 'pagination'}>
      <button type="button" className="btn btn-outline" disabled={page <= 1} onClick={() => ir(page - 1)}>
        &larr;{compacto ? '' : ' Anterior'}
      </button>
      <span className="pagination-info">{compacto ? `${page} / ${totalPages}` : `Página ${page} de ${totalPages}`}</span>
      <button type="button" className="btn btn-outline" disabled={page >= totalPages} onClick={() => ir(page + 1)}>
        {compacto ? '' : 'Siguiente '}&rarr;
      </button>
    </div>
  );
}

// Número (o nombre + número) que abre el chat de esa persona.
export function Contacto({ clienteId, userId, nombre }) {
  return (
    <Link className="contacto" to={`/clientes/${clienteId}/chats?chat=${encodeURIComponent(userId)}`} title="Abrir el chat">
      <Icon name="message" />
      {nombre
        ? <span className="contacto-texto"><strong>{nombre}</strong><small>{numero(userId)}</small></span>
        : numero(userId)}
    </Link>
  );
}

export function CeldaFecha({ dia, hora }) {
  return <div className="cell-fecha"><span>{dia}</span><small>{hora}</small></div>;
}

export function Breadcrumb({ to, children }) {
  return (
    <div className="breadcrumb">
      <Link to={to}><Icon name="arrowLeft" /> {children}</Link>
    </div>
  );
}
