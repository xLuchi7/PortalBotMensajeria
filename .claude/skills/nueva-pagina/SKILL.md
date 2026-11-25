---
name: nueva-pagina
description: Use when adding a new page, section, or form to the portal (route + EJS view + nav link + styles), so it follows the existing multi-client conventions.
---

# Página nueva en el portal

1. **Ruta** (en `src/routes/dashboard.js` o un router propio montado en `index.js` antes de `dashboardRoutes`):
   ```js
   router.get('/clientes/:clienteId/cosa', requireAuth, resolveClienteAccess, async (req, res, next) => {
     try {
       const [cliente, datos] = await Promise.all([clientes.obtenerCliente(req.clienteId), servicio.listar(req.clienteId)]);
       res.render('cosa', { usuario: req.session.usuario, cliente, clienteId: req.clienteId, datos });
     } catch (err) { next(err); }
   });
   ```
   POST: validar, llamar al servicio, `setFlash(req, 'success', 'Algo Guardado')` y `res.redirect(...)` (patrón PRG). Solo admin: agregar `requireAdmin`.
2. **Servicio** en `src/services/`: `const pool = await getPool(); pool.request().input('clienteId', sql.Int, clienteId).query(...)`. Siempre filtrar por `clienteId`.
3. **Vista** `src/views/cosa.ejs`: empieza con `<%- include('partials/header') %>`, `<div class="topbar"><h1>…</h1></div>`, `<p class="page-hint">…</p>`, cards `.card`; termina con `<%- include('partials/footer') %>`. Layout con panel lateral: `.negocio-layout` + `.card.negocio-tips`. Botones: `.btn .btn-primary | .btn-outline | .btn-danger-outline`; badges `.badge .badge-activo|pendiente|inactivo`; avisos `.alert .alert-warning|info|error`. Borrar con `confirmarEliminar(msg, form)`.
4. **Nav**: link en `partials/header.ejs` en **ambos** menús (admin "Viendo:" usa `clienteId`, cliente usa `usuario.clienteId`), con `icons.x` y clase `active` por `currentPath`.
5. **Ícono** nuevo: agregar a `src/icons.js` con `wrap('<path …/>')` (estilo stroke 24x24, genérico).
6. **CSS**: sección propia `/* ── Nombre ── */` en `public/style.css` usando las variables de `:root`; reglas mobile en `@media (max-width: 760px)`.
7. Probar el render con la skill `probar-cambios`.
