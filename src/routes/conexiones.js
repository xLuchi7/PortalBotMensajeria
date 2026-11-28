const express = require('express');
const metaAds = require('../services/metaAdsService');
const mercadoPago = require('../services/mercadoPagoService');
const dashboard = require('../services/dashboardService');
const oauthState = require('../services/oauthStateService');
const { cifrar } = require('../services/cryptoService');
const { setFlash } = require('../services/flash');

// Vuelta de los OAuth del Dashboard (Meta Ads y Mercado Pago). Las navega el
// navegador: terminan en un redirect al Dashboard con un toast en la sesión
// (lo lee /api/sesion). El inicio está en routes/api.js (.../oauth).

const router = express.Router();

const alDashboard = (res, clienteId, extra = '') => res.redirect(`/clientes/${clienteId}/dashboard${extra}`);

// La sesión tiene que ser la misma persona que inició la conexión (el state lo ata).
function validar(req, res, proveedor) {
  const datos = oauthState.leer(proveedor, req.query.state);
  const { usuario } = req.session;
  if (!datos) {
    if (usuario) {
      setFlash(req, 'warning', 'El Link De Conexión Venció, Probá De Nuevo');
      res.redirect('/');
    } else {
      res.redirect('/login');
    }
    return null;
  }
  if (!usuario) { res.redirect('/login'); return null; }
  const puedeVer = usuario.rol === 'admin' || usuario.clienteId === datos.clienteId;
  if (usuario.id !== datos.usuarioId || !puedeVer) { res.redirect('/'); return null; }
  return datos;
}

router.get('/meta/callback', async (req, res) => {
  const datos = validar(req, res, 'meta');
  if (!datos) return;
  const { clienteId } = datos;
  if (req.query.error || !req.query.code) {
    setFlash(req, 'warning', 'No Se Conectó Meta Ads');
    return alDashboard(res, clienteId);
  }
  try {
    const { token, expiraSeg } = await metaAds.canjearCodigo({ code: String(req.query.code), redirectUri: `${oauthState.baseUrl(req)}/meta/callback` });
    const cuentas = await metaAds.cuentasDe(token);
    if (!cuentas.length) {
      setFlash(req, 'warning', 'Tu Usuario De Facebook No Tiene Cuentas Publicitarias');
      return alDashboard(res, clienteId);
    }
    if (cuentas.length === 1) {
      const info = await metaAds.conectar(clienteId, { adAccountId: cuentas[0].id, token, expiraSeg });
      dashboard.sincronizarMeta(clienteId, new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10), { forzar: true })
        .catch(err => console.warn(`[dashboard] Primera sync de Meta Ads (cliente ${clienteId}):`, err.message));
      setFlash(req, info.activa ? 'success' : 'warning', info.activa ? 'Meta Ads Conectado' : 'Conectado, Pero La Cuenta Publicitaria No Está Activa');
      return alDashboard(res, clienteId);
    }
    // Varias cuentas: el Dashboard abre el selector (el token queda cifrado en la sesión).
    req.session.metaPendiente = { clienteId, tokenEnc: cifrar(token), expiraSeg, cuentas, t: Date.now() };
    return alDashboard(res, clienteId, '?meta=elegir');
  } catch (err) {
    console.warn(`[meta-ads] Falló la conexión por OAuth (cliente ${clienteId}):`, err.message);
    setFlash(req, 'warning', 'No Se Pudo Conectar Con Meta, Probá De Nuevo');
    return alDashboard(res, clienteId);
  }
});

router.get('/mercadopago/callback', async (req, res) => {
  const datos = validar(req, res, 'mp');
  if (!datos) return;
  const { clienteId } = datos;
  if (req.query.error || !req.query.code) {
    setFlash(req, 'warning', 'No Se Conectó Mercado Pago');
    return alDashboard(res, clienteId);
  }
  try {
    await mercadoPago.canjearCodigo(clienteId, { code: String(req.query.code), redirectUri: `${oauthState.baseUrl(req)}/mercadopago/callback` });
    dashboard.sincronizarMp(clienteId)
      .catch(err => console.warn(`[dashboard] Primera sync de Mercado Pago (cliente ${clienteId}):`, err.message));
    setFlash(req, 'success', 'Mercado Pago Conectado');
  } catch (err) {
    console.warn(`[mercadopago] Falló la conexión por OAuth (cliente ${clienteId}):`, err.message);
    setFlash(req, 'warning', 'No Se Pudo Conectar Con Mercado Pago, Probá De Nuevo');
  }
  return alDashboard(res, clienteId);
});

module.exports = router;
