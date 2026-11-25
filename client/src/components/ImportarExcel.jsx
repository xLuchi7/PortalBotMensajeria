import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Modal from './Modal.jsx';
import { api } from '../lib/api.js';

// Importación de Artículos desde Excel: subir → progreso (polling) → resultado.
export default function ImportarExcel({ clienteId, open, onClose }) {
  const [paso, setPaso] = useState('form'); // form | progreso | resultado
  const [archivo, setArchivo] = useState(null);
  const [error, setError] = useState(null);
  const [estado, setEstado] = useState(null);
  const [jobId, setJobId] = useState(null);
  const [arrastrando, setArrastrando] = useState(false);
  const input = useRef(null);
  const timer = useRef(null);

  useEffect(() => {
    if (open) { setPaso('form'); setArchivo(null); setError(null); setEstado(null); setJobId(null); }
    return () => clearTimeout(timer.current);
  }, [open]);

  const poll = async (id) => {
    try {
      const e = await api(`/clientes/${clienteId}/importar/${id}`);
      setEstado(e);
      if (!e.terminado) timer.current = setTimeout(() => poll(id), 700);
      else setPaso('resultado');
    } catch (err) {
      setEstado({ terminado: true, errorFatal: err.message });
      setPaso('resultado');
    }
  };

  const subir = async (e) => {
    e.preventDefault();
    if (!archivo) return setError('Elegí un archivo .xlsx para subir.');
    setError(null);
    const fd = new FormData();
    fd.append('archivo', archivo);
    try {
      const r = await api(`/clientes/${clienteId}/importar`, { method: 'POST', body: fd });
      setJobId(r.jobId);
      setPaso('progreso');
      setEstado({ procesado: 0, total: 0 });
      poll(r.jobId);
    } catch (err) {
      setError(err.status === 0 ? 'No se pudo conectar con el servidor.' : err.message);
    }
  };

  const elegir = (f) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return setError('El archivo tiene que ser un Excel .xlsx.');
    setError(null);
    setArchivo(f);
  };

  const cerrar = () => {
    if (paso === 'progreso') return;
    onClose(paso === 'resultado');
  };

  const pct = estado?.total ? Math.round((estado.procesado / estado.total) * 100) : 0;
  const sinErrores = estado && !estado.errorFatal && estado.erroresCount === 0;

  return (
    <Modal open={open} onClose={cerrar}>
      {paso === 'form' && (
        <>
          <h3>Importación de Artículos</h3>
          <p className="page-hint" style={{ margin: '0 0 1rem' }}>
            Descargá el Excel modelo y respetá el formato de las columnas (no cambies los encabezados ni el orden). Al subirlo se crean los Artículos nuevos y se actualizan los que ya existan.
          </p>
          <a href="/plantillas/Modelo-Importacion-Articulos.xlsx" className="btn btn-outline btn-file-action" download><Icon name="save" /> Descargar modelo</a>
          <form onSubmit={subir} style={{ marginTop: '1.25rem' }}>
            <div
              className={`dropzone ${arrastrando ? 'is-over' : ''} ${archivo ? 'has-file' : ''}`}
              onClick={() => input.current?.click()}
              onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={e => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files[0]); }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
            >
              <Icon name={archivo ? 'check' : 'upload'} />
              <strong>{archivo ? archivo.name : 'Elegí el archivo o arrastralo acá'}</strong>
              <small>{archivo ? 'Tocá para cambiarlo' : 'Excel .xlsx, hasta 10 MB'}</small>
            </div>
            <input ref={input} type="file" accept=".xlsx" className="file-input-hidden" onChange={e => elegir(e.target.files[0])} />
            {error && <p className="alert alert-error" style={{ marginTop: '1rem' }}>{error}</p>}
            <div className="modal-actions" style={{ marginTop: '1.1rem' }}>
              <button type="button" className="btn btn-outline" onClick={cerrar}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={!archivo}>Subir</button>
            </div>
          </form>
        </>
      )}

      {paso === 'progreso' && (
        <>
          <h3>Importando...</h3>
          <progress value={pct} max={100} style={{ width: '100%' }} />
          <p className="page-hint" style={{ margin: '0.75rem 0 0' }}>{estado?.procesado || 0} de {estado?.total || 0} Artículos procesados</p>
        </>
      )}

      {paso === 'resultado' && estado && (
        <>
          <div className="modal-result">
            <div className={`modal-result-icon ${sinErrores ? 'success' : 'error'}`}><Icon name={sinErrores ? 'check' : 'alertTriangle'} /></div>
            <h3>{estado.errorFatal ? 'No se pudo importar' : sinErrores ? 'Importación exitosa' : 'Importación con errores'}</h3>
            <p className="page-hint" style={{ margin: 0 }}>
              {estado.errorFatal
                ? estado.errorFatal
                : sinErrores
                  ? `Se importaron ${estado.exitosos} Artículos correctamente.`
                  : `${estado.erroresCount} de ${estado.total} Artículos tuvieron un error al importarse. Verificá el Excel para ver los detalles.`}
            </p>
          </div>
          <div className="modal-actions">
            {!sinErrores && !estado.errorFatal && (
              <a className="btn btn-outline" href={`/api/clientes/${clienteId}/importar/${jobId}/errores.xlsx`} download>
                <Icon name="save" /> Descargar Excel de errores
              </a>
            )}
            <button type="button" className="btn btn-primary" onClick={cerrar} autoFocus>Cerrar</button>
          </div>
        </>
      )}
    </Modal>
  );
}
