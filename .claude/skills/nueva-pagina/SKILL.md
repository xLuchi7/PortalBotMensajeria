---
name: nueva-pagina
description: Use when adding a new page, section, or form to the portal (API route + React page + nav link + styles), so it follows the existing multi-client conventions.
---

# Página nueva en el portal

1. **API** en `src/routes/api.js` (ya tiene `requireAuth` para todo lo de abajo de `/login`):
   ```js
   router.get('/clientes/:clienteId/cosa', resolveClienteAccess, h(async (req, res) => {
     res.json(await servicio.listar(req.clienteId, paginaDe(req)));
   }));
   router.post('/clientes/:clienteId/cosa/:id/algo', resolveClienteAccess, h(async (req, res) => {
     if (!valido) return falla(res, 400, 'Revisá El Dato');
     await servicio.hacer(req.params.id, req.clienteId, req.body.dato);
     ok(res, 'Algo Guardado');            // o aviso(res, '...') para un toast amarillo
   }));
   ```
   Solo admin: agregar `requireAdmin` antes de `resolveClienteAccess`. Nunca mandar secretos o tokens en la respuesta.
2. **Servicio** en `src/services/`: `const pool = await getPool(); pool.request().input('clienteId', sql.Int, clienteId).query(...)`. Siempre filtrar por `clienteId`.
3. **Página** `client/src/pages/Cosa.jsx`:
   ```jsx
   const { clienteId } = useParams();
   const [params] = useSearchParams();
   const { data, error, loading, reload } = useApi(`/clientes/${clienteId}/cosa?page=${paginaDe(params)}`);
   const avisar = useAvisar();
   const hacer = async () => { try { avisar(await api(`/clientes/${clienteId}/cosa/1/algo`, { method: 'POST', body: { dato } })); reload(); } catch (err) { avisar(err); } };
   ```
   Estructura: `useTitulo('Cosa')`, `<PageHead titulo sub>`, `<PageHelp>` para ayuda larga, `<Stats><Stat …/></Stats>`, `.card` con `ErrorCarga` / `TablaCargando` / `Empty` / tabla + `<Pagination>`. Formularios con `<Form onSubmit>` (inputs `required` → toast "Falta Completar"). Borrar/estados finales con `await confirmar({ titulo, mensaje, boton })` (`useConfirm`). Links internos con `<Link>`.
   Clases: `.btn .btn-primary | .btn-outline | .btn-danger-outline | .btn-accent`, `.icon-btn`, badges `.badge .badge-activo|pendiente|inactivo`, avisos `.alert .alert-warning|info|error`, panel lateral `.negocio-layout` + `.card.negocio-tips`.
4. **Ruta** en `client/src/App.jsx` (dentro de `clientes/:clienteId` o envuelta en `<Privada admin>`).
5. **Menú**: agregar el ítem a `GRUPOS` en `client/src/components/Layout.jsx` (sirve para admin y cliente).
6. **Ícono** nuevo: agregar a `client/src/lib/icons.js` con `wrap('<path …/>')` (estilo stroke 24x24, genérico, sin logos de marcas) y usar `<Icon name="nuevo" />`.
7. **CSS**: sección propia `/* ── Nombre ── */` en `client/src/styles.css` usando las variables de `:root`; reglas mobile en `@media (max-width: 760px)`.
8. `npm run build` y probar con la skill `probar-cambios`.
