const express = require('express');
const usuarios = require('../services/usuarioService');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.usuario) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const usuario = await usuarios.autenticar(email, password);
    if (!usuario) {
      return res.render('login', { error: 'Email o contraseña incorrectos.' });
    }

    req.session.usuario = usuario;
    res.redirect('/');
  } catch (err) {
    console.error('[auth] Error al autenticar:', err.message);
    res.render('login', { error: 'Ocurrió un error, probá de nuevo.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
