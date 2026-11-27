const session = require('express-session');
const { ejecutar, sql } = require('./db');

// Store de express-session en la tabla Sesiones (procedures usp_Portal_Sesion*).
// A diferencia del MemoryStore: las sesiones sobreviven a los deploys y la memoria
// no crece con sesiones vencidas (se purgan cada hora).
//
// Para no ir a la base en cada request:
// - get() se cachea unos segundos por sid (las pestañas piden varias cosas juntas).
// - touch() (renovar el vencimiento) se escribe como mucho cada 5 minutos por sid.

const CACHE_MS = 5 * 1000;
const TOQUE_MS = 5 * 60 * 1000;
const PURGA_MS = 60 * 60 * 1000;
const SEGUNDOS_DEFAULT = 8 * 60 * 60;

const segundosDe = sess => {
  const ms = sess?.cookie?.maxAge ?? (sess?.cookie?.expires ? new Date(sess.cookie.expires) - Date.now() : null);
  return ms > 0 ? Math.ceil(ms / 1000) : SEGUNDOS_DEFAULT;
};

class SesionStore extends session.Store {
  constructor() {
    super();
    this.cache = new Map(); // sid -> { en, datos }
    this.toques = new Map(); // sid -> último touch escrito
    this.purgador = setInterval(() => this.purgar(), PURGA_MS);
    this.purgador.unref();
  }

  recordar(sid, datos) {
    this.cache.set(sid, { en: Date.now(), datos });
    if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value);
  }

  olvidar(sid) {
    this.cache.delete(sid);
    this.toques.delete(sid);
  }

  get(sid, cb) {
    const guardada = this.cache.get(sid);
    if (guardada && Date.now() - guardada.en < CACHE_MS) return cb(null, guardada.datos ? JSON.parse(guardada.datos) : null);
    ejecutar('dbo.usp_Portal_SesionLeer', { sid: [sql.NVarChar(128), sid] })
      .then((r) => {
        const datos = r.recordset[0]?.datos ?? null;
        this.recordar(sid, datos);
        cb(null, datos ? JSON.parse(datos) : null);
      })
      .catch(cb);
  }

  set(sid, sess, cb = () => {}) {
    const datos = JSON.stringify(sess);
    ejecutar('dbo.usp_Portal_SesionGuardar', {
      sid: [sql.NVarChar(128), sid],
      datos: [sql.NVarChar(sql.MAX), datos],
      segundos: [sql.Int, segundosDe(sess)],
    })
      .then(() => {
        this.recordar(sid, datos);
        this.toques.set(sid, Date.now());
        cb(null);
      })
      .catch(cb);
  }

  touch(sid, sess, cb = () => {}) {
    const ultimo = this.toques.get(sid) || 0;
    if (Date.now() - ultimo < TOQUE_MS) return cb(null);
    this.toques.set(sid, Date.now());
    ejecutar('dbo.usp_Portal_SesionTocar', { sid: [sql.NVarChar(128), sid], segundos: [sql.Int, segundosDe(sess)] })
      .then(() => cb(null))
      .catch(cb);
  }

  destroy(sid, cb = () => {}) {
    this.olvidar(sid);
    ejecutar('dbo.usp_Portal_SesionBorrar', { sid: [sql.NVarChar(128), sid] })
      .then(() => cb(null))
      .catch(cb);
  }

  purgar() {
    ejecutar('dbo.usp_Portal_SesionesPurgar')
      .then(r => { if (r.recordset[0]?.borradas) console.log(`[sesiones] ${r.recordset[0].borradas} sesiones vencidas borradas`); })
      .catch(err => console.error('[sesiones] No se pudieron purgar las sesiones vencidas:', err.message));
    const limite = Date.now() - TOQUE_MS;
    for (const [sid, en] of this.toques) if (en < limite) this.toques.delete(sid);
  }
}

module.exports = SesionStore;
