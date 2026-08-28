// Mensaje de una sola vez que sobrevive a un redirect (via session) y se
// consume en el siguiente render, para mostrar un toast de éxito/error/warning
// después de una acción sin tener que convertir el flujo a AJAX.
function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

module.exports = { setFlash };
