import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import { Empty, ErrorCarga, PageHead, Pagination, Stat, Stats, TablaCargando, useTitulo } from '../components/ui.jsx';
import { useApi } from '../lib/api.js';
import { numero, query } from '../lib/format.js';

const NIVELES = { info: 'Info', warn: 'Aviso', error: 'Error' };
const ORIGENES = { bot: 'Bot', portal: 'Portal' };

const miles = n => Number(n || 0).toLocaleString('es-AR');
// USD con los decimales que hagan falta: una llamada de Haiku cuesta fracciones de centavo.
const usd = n => {
  const v = Number(n || 0);
  if (!v) return 'US$ 0';
  return `US$ ${v.toLocaleString('es-AR', { minimumFractionDigits: v < 0.01 ? 6 : 4, maximumFractionDigits: v < 0.01 ? 6 : 4 })}`;
};
const ms = n => (n == null ? null : n < 1000 ? `${n} ms` : `${(n / 1000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} s`);

// Todo lo que registran el bot y el portal en la tabla Logs (solo admin). Las
// fechas ya vienen en hora de Argentina. Se borran solos a los 7 días.
export default function Logs() {
  useTitulo('Logs');
  const [params, setParams] = useSearchParams();
  const filtros = {
    origen: params.get('origen') || '',
    nivel: params.get('nivel') || '',
    clienteId: params.get('clienteId') || '',
    evento: params.get('evento') || '',
    q: params.get('q') || '',
    page: params.get('page') || '',
  };
  const { data, error, loading, reload } = useApi(`/logs${query(filtros)}`);
  const clientes = useApi('/usuarios/clientes-activos');
  const [busqueda, setBusqueda] = useState(filtros.q);
  useEffect(() => setBusqueda(filtros.q), [filtros.q]);

  const cambiar = (cambios) => {
    const nuevos = new URLSearchParams(params);
    Object.entries({ ...cambios, page: '' }).forEach(([k, v]) => (v ? nuevos.set(k, v) : nuevos.delete(k)));
    setParams(nuevos);
  };

  const t = data?.totales;
  const tokensEntrada = t ? t.inputTokens + t.cacheLecturaTokens + t.cacheEscrituraTokens : null;

  return (
    <>
      <PageHead titulo="Logs" sub={`Todo lo que pasa en el bot y en el portal, en hora de Argentina. Se guardan ${data?.diasRetencion ?? 7} días y después se borran solos.`}>
        <button type="button" className="btn btn-outline" onClick={reload} disabled={loading}><Icon name="refresh" /> Actualizar</button>
      </PageHead>

      <Stats>
        <Stat icono="wallet" tono="success" valor={t ? usd(t.costoUsd) : null} texto="gastado en Claude (con este filtro)" cargando={!data} />
        <Stat icono="arrowUp" valor={tokensEntrada == null ? null : miles(tokensEntrada)} texto={t ? `tokens de entrada (${miles(t.cacheLecturaTokens)} desde caché)` : 'tokens de entrada'} cargando={!data} />
        <Stat icono="send" valor={t ? miles(t.outputTokens) : null} texto="tokens de salida" cargando={!data} />
        <Stat icono="list" valor={data ? miles(data.total) : null} texto="registros" cargando={!data} />
      </Stats>

      <div className="card logs-filtros">
        <form onSubmit={e => { e.preventDefault(); cambiar({ q: busqueda.trim() }); }} className="logs-busqueda">
          <Icon name="search" />
          <input type="search" value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar texto, número, email o modelo…" aria-label="Buscar en los logs" />
        </form>
        <select value={filtros.evento} onChange={e => cambiar({ evento: e.target.value })} aria-label="Evento">
          <option value="">Todos los eventos</option>
          {(data?.eventos || []).map(ev => <option key={ev} value={ev}>{ev}</option>)}
        </select>
        <select value={filtros.origen} onChange={e => cambiar({ origen: e.target.value })} aria-label="Origen">
          <option value="">Bot y portal</option>
          {Object.entries(ORIGENES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filtros.nivel} onChange={e => cambiar({ nivel: e.target.value })} aria-label="Nivel">
          <option value="">Todos los niveles</option>
          {Object.entries(NIVELES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filtros.clienteId} onChange={e => cambiar({ clienteId: e.target.value })} aria-label="Cliente">
          <option value="">Todos los clientes</option>
          {(clientes.data?.clientes || []).map(c => <option key={c.id} value={c.id}>{c.razonSocial}</option>)}
        </select>
      </div>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={6} filas={10} />
          : !data.rows.length ? (
            <Empty icono="list" titulo="Sin registros">No hay logs que coincidan con el filtro.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="tabla-logs">
                  <thead>
                    <tr><th className="col-fecha">Fecha</th><th>Nivel</th><th>Evento</th><th>Quién</th><th>Claude / duración</th><th>Detalle</th></tr>
                  </thead>
                  <tbody>
                    {data.rows.map(l => (
                      <tr key={l.id} className={`log-${l.nivel}`}>
                        <td className="col-fecha log-fecha">{l.fecha}</td>
                        <td><span className={`tag log-nivel log-nivel-${l.nivel}`}>{NIVELES[l.nivel] || l.nivel}</span></td>
                        <td>
                          <button type="button" className="log-evento" title="Filtrar por este evento" onClick={() => cambiar({ evento: l.evento })}>{l.evento}</button>
                          <small className="log-origen">{ORIGENES[l.origen] || l.origen}</small>
                        </td>
                        <td>
                          <div className="log-quien">
                            {l.razonSocial && <span>{l.razonSocial}</span>}
                            {l.userId && <small>{numero(l.userId)}</small>}
                            {l.usuario && <small>{l.usuario}</small>}
                            {!l.razonSocial && !l.userId && !l.usuario && <span className="muted">Sistema</span>}
                          </div>
                        </td>
                        <td><Consumo l={l} /></td>
                        <td className="log-detalle"><Detalle texto={l.detalle} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={data.page} totalPages={data.totalPages} />
            </>
          )}
      </div>
    </>
  );
}

// Modelo, tokens y costo (solo en las llamadas a Claude) y cuánto tardó.
function Consumo({ l }) {
  const hayTokens = l.inputTokens != null || l.outputTokens != null;
  if (!l.modelo && !hayTokens && l.duracionMs == null) return <span className="muted">—</span>;
  return (
    <div className="log-consumo">
      {l.modelo && <code>{l.modelo}</code>}
      {hayTokens && (
        <small title="Entrada sin caché · leída de caché · escrita en caché → salida (incluye razonamiento)">
          {miles(l.inputTokens)} + {miles(l.cacheLecturaTokens)} caché + {miles(l.cacheEscrituraTokens)} esc. → {miles(l.outputTokens)}
        </small>
      )}
      {l.costoUsd != null && <strong>{usd(l.costoUsd)}</strong>}
      {l.duracionMs != null && <small>{ms(l.duracionMs)}</small>}
    </div>
  );
}

// Detalle corto en una línea; si es largo (o JSON), se expande al tocarlo.
function Detalle({ texto }) {
  if (!texto) return <span className="muted">—</span>;
  let lindo = texto;
  try { const obj = JSON.parse(texto); if (obj && typeof obj === 'object') lindo = JSON.stringify(obj, null, 2); } catch { /* texto plano */ }
  if (lindo.length <= 140 && !lindo.includes('\n')) return <span>{lindo}</span>;
  return (
    <details>
      <summary>{texto.slice(0, 120)}{texto.length > 120 ? '…' : ''}</summary>
      <pre>{lindo}</pre>
    </details>
  );
}
