const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const usuarios = require('../services/usuarioService');
const clientes = require('../services/clienteService');
const { setFlash } = require('../services/flash');

const router = express.Router();
router.use(requireAuth, requireAdmin);

router.get('/usuarios', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const resultado = await usuarios.listarUsuarios(page);
    res.render('usuarios', { usuario: req.session.usuario, ...resultado });
  } catch (err) {
    next(err);
  }
});

router.get('/usuarios/nuevo', async (req, res, next) => {
  try {
    const clientesActivos = await clientes.listarClientesActivos();
    res.render('usuario-form', {
      usuario: req.session.usuario,
      clientesActivos,
      editar: null,
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/usuarios/nuevo', async (req, res, next) => {
  try {
    const { email, password, rol, clienteId } = req.body;
    await usuarios.crearUsuario({ email, password, rol, clienteId: clienteId || null });
    setFlash(req, 'success', 'Usuario Creado Correctamente');
    res.redirect('/usuarios');
  } catch (err) {
    if (err.number === 2627 || err.number === 2601) {
      const clientesActivos = await clientes.listarClientesActivos();
      return res.render('usuario-form', {
        usuario: req.session.usuario,
        clientesActivos,
        editar: null,
        error: 'Ya existe un usuario con ese email.',
      });
    }
    next(err);
  }
});

router.get('/usuarios/:id/editar', async (req, res, next) => {
  try {
    const [editar, clientesActivos] = await Promise.all([
      usuarios.obtenerUsuario(req.params.id),
      clientes.listarClientesActivos(),
    ]);
    if (!editar) return res.status(404).send('Usuario no encontrado.');
    res.render('usuario-form', { usuario: req.session.usuario, clientesActivos, editar, error: null });
  } catch (err) {
    next(err);
  }
});

router.post('/usuarios/:id/editar', async (req, res, next) => {
  try {
    const { email, password, rol, clienteId } = req.body;
    await usuarios.actualizarUsuario(req.params.id, { email, rol, clienteId: clienteId || null, password });
    setFlash(req, 'success', 'Usuario Actualizado Correctamente');
    res.redirect('/usuarios');
  } catch (err) {
    next(err);
  }
});

router.post('/usuarios/:id/borrar', async (req, res, next) => {
  try {
    await usuarios.borrarUsuario(req.params.id);
    setFlash(req, 'success', 'Usuario Borrado');
    res.redirect('/usuarios');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
