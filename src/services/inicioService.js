const { ejecutar, sql } = require('./db');
const { numero: formatearNumero } = require('../viewHelpers');

// Página de Inicio: un resumen de lo que hizo el bot en los últimos `dias` días
// (comparado con los `dias` anteriores), series diarias para el gráfico y los
// mini-gráficos, el mapa de calor de cuándo escriben, lo que necesita atención y
// la actividad reciente. Todo de solo lectura.
//
// Las fechas se guardan en UTC; los cortes de día y hora se hacen en la zona
// horaria del Cliente (un "día" es de 00:00 a 23:59 en su hora local).
const PERIODOS = [7, 30];
const VENTANA_MINUTOS = 24 * 60;

async function resumen(clienteId, dias) {
  dias = PERIODOS.includes(dias) ? dias : 7;
  // Las 10 partes del resumen salen de usp_Portal_InicioResumen (un recordset cada una).
  const result = await ejecutar('dbo.usp_Portal_InicioResumen', {
    clienteId: [sql.Int, clienteId],
    dias: [sql.Int, dias],
    ventana: [sql.Int, VENTANA_MINUTOS],
  });

  const [totales, nuevosRows, velocidadRows, serieRows, calorRows, reclamos, pendientes, sinResponder, actividad, ultimoRows] = result.recordsets;
  const t = totales[0];
  const n = nuevosRows[0] || {};
  const vel = velocidadRows[0];

  // Series con todos los días del período, aunque no haya datos.
  const porDia = new Map(serieRows.map(r => [r.dia, r]));
  const hoyLocal = new Date(`${t.hoy}T00:00:00Z`);
  const serie = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoyLocal);
    d.setUTCDate(d.getUTCDate() - i);
    const clave = d.toISOString().slice(0, 10);
    const r = porDia.get(clave) || {};
    serie.push({
      dia: clave,
      chats: r.chats || 0,
      respuestas: r.respuestas || 0,
      pedidos: r.pedidos || 0,
      vendido: Number(r.vendido || 0),
      nuevos: r.nuevos || 0,
      consultas: r.consultas || 0,
    });
  }

  // Mapa de calor como matriz 7 × 24 (lunes a domingo, 0 a 23 hs).
  const calor = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of calorRows) calor[r.dow][r.hora] = r.n;

  const contacto = r => ({ ...r, nombre: r.nombre || null, numero: formatearNumero(r.userId), total: undefined });
  const ultimo = ultimoRows[0];

  return {
    dias,
    periodos: PERIODOS,
    hoy: { chats: t.chatsHoy, respuestasBot: t.respuestasBotHoy },
    // Primer día con mensajes (hora local). Si cae dentro del período, no hay
    // período anterior con qué comparar.
    desde: t.desde || null,
    conPedidos: t.pedidosHistoricos > 0,
    kpis: {
      chats: { valor: t.chats, previo: t.chatsPrevio },
      respuestasBot: { valor: t.respuestasBot, previo: t.respuestasBotPrevio },
      pedidos: { valor: t.pedidos, previo: t.pedidosPrevio },
      vendido: { valor: Number(t.vendido), previo: Number(t.vendidoPrevio) },
      consultas: { valor: t.consultas, previo: t.consultasPrevio },
      nuevos: { valor: n.nuevos || 0, previo: n.nuevosPrevio || 0 },
    },
    velocidad: vel && vel.muestras ? { segundos: Math.round(Number(vel.medianaMs) / 1000), muestras: vel.muestras } : null,
    serie,
    calor,
    atencion: {
      reclamos: { total: reclamos[0]?.total || 0, items: reclamos.map(contacto) },
      pendientes: { total: pendientes[0]?.total || 0, items: pendientes.map(r => ({ ...contacto(r), monto: Number(r.monto) })) },
      sinResponder: { total: sinResponder[0]?.total || 0, items: sinResponder.map(contacto) },
    },
    actividad: actividad.map(r => ({ ...contacto(r), monto: r.monto != null ? Number(r.monto) : null })),
    ultimoMensaje: ultimo ? contacto(ultimo) : null,
  };
}

// Números chiquitos del menú lateral: chats que esperan respuesta de una persona
// (mismo criterio que "Necesita tu atención"), reclamos abiertos y pedidos por
// confirmar. Liviano porque se pide seguido.
async function contadores(clienteId) {
  const r = await ejecutar('dbo.usp_Portal_InicioContadores', {
    clienteId: [sql.Int, clienteId],
    ventana: [sql.Int, VENTANA_MINUTOS],
  });
  return { ...r.recordsets[0][0], revisionChats: r.recordsets[1] };
}

module.exports = { resumen, contadores, PERIODOS };
