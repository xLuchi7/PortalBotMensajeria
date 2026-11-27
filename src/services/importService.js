const crypto = require('crypto');
const ExcelJS = require('exceljs');
const articulos = require('./articuloService');

const COLUMNAS_ESPERADAS = ['Nombre', 'Codigo', 'Descripcion', 'Precio', 'Usa Control de Stock', 'Stock'];
const JOB_TTL_MS = 20 * 60 * 1000;
const MAX_FILAS = 5000;

// Jobs en memoria: alcanza porque son de corta duración (minutos) y este proceso
// es la única instancia del Portal. Si Railway redeploya en medio de una
// importación, el cliente ve el progreso cortarse -- aceptable, es una acción en
// primer plano que el usuario está mirando, no un proceso de fondo desatendido.
const jobs = new Map();
const jobPorCliente = new Map(); // una importación a la vez por Cliente

// ExcelJS devuelve objetos para celdas con formato enriquecido, fórmulas,
// hipervínculos o errores (antes terminaban como "[object Object]").
function valorCelda(v) {
  if (v == null) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== 'object') return v;
  if (Array.isArray(v.richText)) return v.richText.map(r => r.text ?? '').join('');
  if ('result' in v) return valorCelda(v.result); // fórmula: se usa el valor calculado
  if ('text' in v) return valorCelda(v.text); // hipervínculo
  if ('error' in v) return null;
  return String(v);
}

// Lee el archivo subido y devuelve las filas crudas (sin validar todavía). Tira si
// el encabezado no coincide con el modelo -- eso rechaza el archivo entero antes de
// procesar nada, en vez de generar cientos de errores fila por fila sin sentido.
async function leerFilas(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('El archivo no tiene ninguna hoja.');

  if (ws.actualRowCount - 1 > MAX_FILAS) {
    throw new Error(`El archivo tiene demasiadas filas (máximo ${MAX_FILAS}). Dividilo en varios archivos.`);
  }

  const headerRow = ws.getRow(1).values.slice(1).map(v => (valorCelda(v) ?? '').toString().trim());
  const headerOk = COLUMNAS_ESPERADAS.every((col, i) => headerRow[i] === col);
  if (!headerOk) {
    throw new Error(`El archivo no respeta el formato del modelo. Se esperaban las columnas: ${COLUMNAS_ESPERADAS.join(', ')}.`);
  }

  const filas = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = row.values.slice(1).map(valorCelda);
    if (values.every(v => v === null || v === undefined || v === '')) return;
    filas.push({
      nombre: values[0],
      codigo: values[1],
      descripcion: values[2],
      precio: values[3],
      usaStockTexto: values[4],
      stock: values[5],
    });
  });

  return filas;
}

function validarFila(fila) {
  const nombre = (fila.nombre ?? '').toString().trim();
  if (!nombre) return { error: 'Falta el Nombre.' };
  if (nombre.length > 200) return { error: 'El Nombre tiene más de 200 caracteres.' };

  const codigo = fila.codigo != null && fila.codigo !== '' ? fila.codigo.toString().trim() : null;
  if (codigo && codigo.length > 50) return { error: 'El Código tiene más de 50 caracteres.' };
  const descripcion = fila.descripcion != null && fila.descripcion !== '' ? fila.descripcion.toString().trim() : null;

  let precio = null;
  if (fila.precio !== null && fila.precio !== undefined && fila.precio !== '') {
    precio = Number(fila.precio);
    if (!Number.isFinite(precio) || precio < 0 || precio > 999999999) return { error: 'El Precio no es un número válido.' };
  }

  const usaStockTexto = (fila.usaStockTexto ?? '').toString().trim().toLowerCase();
  if (!['si', 'sí', 'no'].includes(usaStockTexto)) {
    return { error: '"Usa Control de Stock" debe ser Si o No.' };
  }
  const usaStock = usaStockTexto === 'si' || usaStockTexto === 'sí';

  let stock = 0;
  if (fila.stock !== null && fila.stock !== undefined && fila.stock !== '') {
    stock = Number(fila.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 2147483647) return { error: 'El Stock debe ser un número entero mayor o igual a 0.' };
  }

  return { ok: true, datos: { nombre, codigo, descripcion, precio, usaStock, stock } };
}

// Match por Código si la fila lo trae; si no, por Nombre. No toca "activo" -- si el
// Artículo estaba desactivado, la importación no lo reactiva solo.
// El Stock siempre se pisa con lo que diga el Excel, tanto al crear como al
// actualizar -- decisión explícita: la importación es la fuente de verdad del stock.
// Todo en usp_Portal_ArticuloGuardar (@importar = 1), en una transacción.

async function procesarImportacion(jobId, filas) {
  const job = jobs.get(jobId);
  for (let i = 0; i < filas.length; i++) {
    const filaCruda = filas[i];
    const numeroFila = i + 2; // fila 1 es el encabezado

    const validacion = validarFila(filaCruda);
    if (!validacion.ok) {
      job.errores.push({ fila: numeroFila, datos: filaCruda, error: validacion.error });
      job.procesado++;
      continue;
    }

    try {
      await articulos.importarArticulo(job.clienteId, validacion.datos);
      job.exitosos++;
    } catch (err) {
      console.error(`[importar] Fila ${numeroFila} (cliente ${job.clienteId}):`, err.message);
      job.errores.push({ fila: numeroFila, datos: filaCruda, error: 'No se pudo guardar esta fila.' });
    }
    job.procesado++;
  }

  job.terminado = true;
}

// null si ya hay una importación corriendo para este Cliente.
function enCurso(clienteId) {
  const jobId = jobPorCliente.get(clienteId);
  return jobId && jobs.has(jobId) && !jobs.get(jobId).terminado ? jobId : null;
}

function crearJob(clienteId, filas) {
  if (enCurso(clienteId)) return null;
  const jobId = crypto.randomUUID();
  jobPorCliente.set(clienteId, jobId);
  jobs.set(jobId, {
    clienteId,
    total: filas.length,
    procesado: 0,
    exitosos: 0,
    errores: [],
    terminado: false,
  });

  procesarImportacion(jobId, filas)
    .catch((err) => {
      console.error(`[importar] Falló la importación (cliente ${clienteId}):`, err.message);
      const job = jobs.get(jobId);
      if (job) job.errorFatal = 'No se pudo terminar la importación. Probá de nuevo.';
    })
    .finally(() => {
      const job = jobs.get(jobId);
      if (job) job.terminado = true;
      // El TTL cuenta desde que terminó, no desde que empezó.
      setTimeout(() => {
        jobs.delete(jobId);
        if (jobPorCliente.get(clienteId) === jobId) jobPorCliente.delete(clienteId);
      }, JOB_TTL_MS).unref();
    });

  return jobId;
}

function obtenerEstado(jobId, clienteId) {
  const job = jobs.get(jobId);
  if (!job || job.clienteId !== clienteId) return null;
  return {
    total: job.total,
    procesado: job.procesado,
    terminado: job.terminado,
    exitosos: job.exitosos,
    erroresCount: job.errores.length,
    errorFatal: job.errorFatal ?? null,
  };
}

async function generarExcelErrores(jobId, clienteId) {
  const job = jobs.get(jobId);
  if (!job || job.clienteId !== clienteId || !job.errores.length) return null;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Errores');
  ws.columns = [
    { header: 'Nombre', key: 'nombre', width: 18 },
    { header: 'Codigo', key: 'codigo', width: 18 },
    { header: 'Descripcion', key: 'descripcion', width: 18 },
    { header: 'Precio', key: 'precio', width: 18 },
    { header: 'Usa Control de Stock', key: 'usaStock', width: 18 },
    { header: 'Stock', key: 'stock', width: 18 },
    { header: 'Error', key: 'error', width: 18 },
  ];

  ws.addRows(
    job.errores.map(({ datos, error }) => ({
      nombre: datos.nombre ?? '',
      codigo: datos.codigo ?? '',
      descripcion: datos.descripcion ?? '',
      precio: datos.precio ?? '',
      usaStock: datos.usaStockTexto ?? '',
      stock: datos.stock ?? '',
      error,
    }))
  );

  // Mismo estilo que usan en el resto de las herramientas del negocio: encabezado
  // azul en negrita, todas las celdas con borde fino, filas pares con banda gris,
  // ancho de columna según el contenido más largo, filtro y encabezado congelado.
  ws.columns.forEach(column => {
    let maxLength = 0;
    column.eachCell({ includeEmpty: true }, cell => {
      const cellValue = cell.value != null ? cell.value.toString() : '';
      maxLength = Math.max(maxLength, cellValue.length);
    });
    column.width = maxLength + 6;
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };

  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F75B5' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  });

  ws.eachRow((row, rowNumber) => {
    row.eachCell(cell => {
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    if (rowNumber > 1 && rowNumber % 2 === 0) {
      row.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      });
    }
  });

  ws.getColumn('precio').numFmt = '"$"#,##0.00';
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  return wb.xlsx.writeBuffer();
}

module.exports = { leerFilas, crearJob, enCurso, obtenerEstado, generarExcelErrores };
