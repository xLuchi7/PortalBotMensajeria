import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Icon from '../components/Icon.jsx';
import AprendizajeForm from '../components/AprendizajeForm.jsx';
import { Empty, ErrorCarga, PageHead, PageHelp, Stat, Stats, TablaCargando, useTitulo } from '../components/ui.jsx';
import { useConfirm } from '../components/Confirm.jsx';
import { useAvisar } from '../components/Toasts.jsx';
import { api, useApi } from '../lib/api.js';

// Pares "cuando pregunten X → respondé Y" que el bot suma a sus instrucciones.
export default function Aprendizajes() {
  useTitulo('Aprendizajes');
  const { clienteId } = useParams();
  const { data, error, loading, reload, setData } = useApi(`/clientes/${clienteId}/aprendizajes`);
  const confirmar = useConfirm();
  const avisar = useAvisar();
  const [editando, setEditando] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);

  const activos = data?.rows.filter(a => a.activo).length ?? 0;
  const tope = data?.tope ?? 50;

  const cambiarActivo = async (a) => {
    setGuardandoId(a.id);
    try {
      const r = await api(`/clientes/${clienteId}/aprendizajes/${a.id}/activo`, { method: 'POST', body: { activo: !a.activo } });
      setData(d => ({ ...d, rows: d.rows.map(x => (x.id === a.id ? { ...x, activo: !a.activo } : x)) }));
      avisar(r);
    } catch (err) { avisar(err); }
    setGuardandoId(null);
  };

  const borrar = async (a) => {
    const ok = await confirmar({ titulo: '¿Borrar aprendizaje?', mensaje: `El bot deja de usar «${a.pregunta}». No se puede deshacer.`, boton: 'Borrar' });
    if (!ok) return;
    try { avisar(await api(`/clientes/${clienteId}/aprendizajes/${a.id}/borrar`, { method: 'POST' })); reload(); } catch (err) { avisar(err); }
  };

  return (
    <>
      <PageHead titulo="Aprendizajes" sub="Respuestas que le enseñás al bot para las preguntas que le hacen tus clientes.">
        <button type="button" className="btn btn-primary" onClick={() => setEditando({})} disabled={activos >= tope}
                title={activos >= tope ? `Llegaste al tope de ${tope} activos` : undefined}>
          <Icon name="plus" /> Nuevo aprendizaje
        </button>
      </PageHead>

      <PageHelp titulo="¿Cómo aprende el bot?">
        <p>El bot no aprende solo de los chats: cada vez que responde lee sus instrucciones, lo que cargaste en <Link to={`/clientes/${clienteId}/negocio`}>Mi Negocio</Link> y esta lista. Así nadie le puede &quot;enseñar&quot; algo falso por WhatsApp.</p>
        <p>Cargá acá las preguntas que se repiten y que el bot no sabe contestar. También podés crearlas desde un chat: en tus respuestas en <strong>Atención Humana</strong> aparece <strong>Enseñarle esto al bot</strong>. El bot las usa desde el próximo mensaje.</p>
        <p>Precios, stock y pedidos no hace falta cargarlos: el bot siempre los consulta en tus artículos. Escribí respuestas cortas y generales (sin datos de un cliente en particular). Máximo {tope} activos.</p>
      </PageHelp>

      <Stats>
        <Stat icono="sparkles" tono="success" valor={activos} texto={`activos de ${tope}`} cargando={!data} />
        <Stat icono="list" valor={data?.rows.length} texto="cargados en total" cargando={!data} />
      </Stats>

      <div className={`card ${loading && data ? 'is-loading' : ''}`}>
        {error && !data ? <ErrorCarga error={error} onReintentar={reload} />
          : !data ? <TablaCargando columnas={4} />
          : !data.rows.length ? (
            <Empty icono="sparkles" titulo="Todavía no le enseñaste nada">
              Cargá la primera pregunta frecuente con <strong>Nuevo aprendizaje</strong>.
            </Empty>
          ) : (
            <div className="table-wrap">
              <table className="aprendizajes-tabla">
                <thead>
                  <tr><th>Cuando pregunten</th><th>El bot responde</th><th className="col-center">Activo</th><th /></tr>
                </thead>
                <tbody>
                  {data.rows.map(a => (
                    <tr key={a.id} className={a.activo ? '' : 'is-inactivo'}>
                      <td className="aprendizaje-pregunta">
                        {a.pregunta}
                        <span className="aprendizaje-meta">
                          {a.fecha}{a.usuario ? ` · ${a.usuario}` : ''}
                          {a.origenUserId && <> · <Link to={`/clientes/${clienteId}/chats?chat=${encodeURIComponent(a.origenUserId)}`}>ver chat</Link></>}
                        </span>
                      </td>
                      <td className="aprendizaje-respuesta">{a.respuesta}</td>
                      <td className="col-center">
                        <button type="button" role="switch" aria-checked={a.activo} className="mini-switch" disabled={guardandoId === a.id}
                                aria-label={`${a.activo ? 'Desactivar' : 'Activar'} «${a.pregunta}»`} onClick={() => cambiarActivo(a)}>
                          <span />
                        </button>
                      </td>
                      <td>
                        <div className="cell-actions">
                          <button type="button" className="icon-btn" title="Editar" onClick={() => setEditando(a)}><Icon name="edit" /></button>
                          <button type="button" className="icon-btn danger" title="Borrar" onClick={() => borrar(a)}><Icon name="trash" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <AprendizajeForm clienteId={clienteId} inicial={editando} onClose={() => setEditando(null)} onGuardado={reload} />
    </>
  );
}
