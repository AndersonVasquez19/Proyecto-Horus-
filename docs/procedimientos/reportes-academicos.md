# Reportes académicos (CSV, XLSX y PDF)

> **Actualización (simplificación académica, octubre de 2026):** los reportes `certificados` y `pendientes-certificacion` se retiraron (quedan seis reportes
> académicos: `estudiantes`, `ediciones`, `ocupacion`, `matriculas`, `matriculas-por-edicion` y `resumen`; el catálogo los lista antes de los comerciales).
> Pedirlos responde 400/404 como cualquier tipo desconocido. Donde el documento nombre certificados describe el diseño anterior.

> Etapa 3: el mismo motor también sirve reportes comerciales y de atención al cliente (cotizaciones y consultas). Ver [reportes-comerciales.md](reportes-comerciales.md). Los reportes de este documento no cambian.

Backend NestJS/Prisma/MySQL de solo lectura en `backend/src/reportes/`. El panel React todavía **no** lo consume: este documento es el contrato para diseñar después las tarjetas, los filtros y los botones de descarga. No hay tablas ni migraciones nuevas; los reportes leen `estudiantes`, `convocatorias` (ediciones), `matriculas` y `cursos`.

## Principio de diseño

Cada solicitud construye **un único documento de reporte** (metadatos, resumen, tabla y totales) dentro de una transacción de solo lectura `REPEATABLE READ`. La consulta JSON y los tres formatos son representaciones de ese mismo documento, así que muestran las mismas filas, el mismo resumen y los mismos totales. Las pruebas lo comprueban celda por celda entre JSON, CSV y XLSX, y por filas, totales e indicadores en el PDF.

## Endpoints y permisos

Prefijo `/api`, JWT y AccessGuard global. La matriz de roles **no cambia**: se usan los permisos ya definidos `reportes_academicos:leer` y `reportes_academicos:exportar`.

| Método y ruta | Permiso (AccessGuard) | Comprobación adicional en el servicio (rol vigente) | Respuesta |
| --- | --- | --- | --- |
| GET `/admin/reportes` | `reportes_academicos:leer` | — | Catálogo con lo que la cuenta puede hacer con cada reporte |
| GET `/admin/reportes/:tipo` | `reportes_academicos:leer` | Repite el permiso base. `estudiantes` exige `estudiantes:leer`; `matriculas`, además, `matriculas:leer`; `certificados`, `certificados:leer` y `estudiantes:leer`; `pendientes-certificacion`, `matriculas:leer`, `certificados:leer` y `estudiantes:leer` | JSON con la tabla paginada |
| GET `/admin/reportes/:tipo/exportar?formato=csv\|xlsx\|pdf` | `reportes_academicos:exportar` | Repite el permiso base. `estudiantes` y `matriculas` exigen `estudiantes:exportar`; `certificados` y `pendientes-certificacion`, además, `certificados:leer` | Archivo adjunto |

| Rol | Consultar (JSON) | Exportar (archivos) |
| --- | --- | --- |
| Gerente general | Todos | Todos |
| Coordinadora institucional | Todos (incluidos estudiantes y matrículas) | Ninguno: `reportes_academicos:exportar` sigue siendo una decisión pendiente en `policy.ts` |
| Secretaría | Ninguno (403) | Ninguno (403) |
| Cuenta sin rol | 403 con el mensaje de cuenta básica | 403 |
| Sin sesión | 401 | 401 |

El rol se lee de la base en cada solicitud, no del JWT. Ocultar un botón en React no protege nada; el backend vuelve a decidir siempre.

## Reportes (`:tipo`)

| `tipo` | Título | Filtros admitidos | `estado` admitido | Datos personales |
| --- | --- | --- | --- | --- |
| `estudiantes` | Estudiantes registrados | `desde`, `hasta`, `estado` | `activos`, `inactivos`, `todos` | Sí (nombre, DNI, correo y teléfono) |
| `ediciones` | Ediciones académicas | `desde`, `hasta`, `curso_id`, `convocatoria_id`, `estado`, `archivo` | `planificada`, `abierta`, `cerrada`, `cancelada` | No |
| `ocupacion` | Ocupación de cupos | igual que `ediciones` | igual que `ediciones` | No |
| `matriculas` | Matrículas vigentes y anuladas | `desde`, `hasta`, `curso_id`, `convocatoria_id`, `estado`, `cumplimiento` | `activa`, `anulada` | Sí (nombre y DNI) |
| `matriculas-por-edicion` | Matrículas por curso o edición | `desde`, `hasta`, `curso_id`, `convocatoria_id`, `agrupar` | — | No |
| `certificados` | Certificados emitidos | `desde`, `hasta`, `curso_id`, `convocatoria_id`, `estado` | `vigente`, `anulado` | Sí (nombre y DNI copiados al emitir) |
| `pendientes-certificacion` | Pendientes de certificación | `desde`, `hasta`, `curso_id`, `convocatoria_id` | — | Sí (nombre y DNI) |
| `resumen` | Resumen general por período | `desde`, `hasta` | — | No |

Contenido de cada reporte:

- **estudiantes**: ID, apellidos, nombres, DNI, correo, teléfono, estado (Activo/Inactivo), fecha de registro y matrículas vigentes. Resumen: total, activos, inactivos (archivados), con matrícula vigente y sin DNI. Sin fila de totales.
- **ediciones**: ID, curso, tipo, edición, inicio, fin, estado, archivada, capacidad, vigentes, anuladas y disponibles. Resumen por estado, archivadas y matrículas vigentes y anuladas. Fila «Total».
- **ocupacion**: ID, curso, edición, estado, inicio, capacidad, vigentes, disponibles y «Ocupación (%)». Resumen: ediciones con y sin capacidad, capacidad total, cupos ocupados y disponibles, ocupación global, ediciones completas y matrículas vigentes. Fila «Total».
- **matriculas**: ID, fecha de matrícula, apellidos, nombres, DNI, curso, edición, estado (Vigente/Anulada) y cumplimiento. Resumen por estado y cumplimiento. Sin fila de totales.
- **matriculas-por-edicion**: con `agrupar=edicion` (por defecto): curso, edición, inicio, estado de la edición, vigentes, anuladas y total. Con `agrupar=curso`: curso, tipo, ediciones, vigentes, anuladas y total. Fila «Total».
- **certificados**: ID, fecha de emisión, código de verificación, apellidos, nombres, DNI, curso, edición, estado (Vigente/Anulado), fecha de anulación y si fue sustituido. Resumen: total, vigentes, anulados y anulados por sustitución. No incluye el motivo de anulación ni quién emitió o anuló. Sin fila de totales. Detalle y explicación: [Reportes de certificación](reportes-certificacion.md).
- **pendientes-certificacion**: ID de matrícula, fecha de confirmación del cumplimiento, apellidos, nombres, DNI, curso, edición, certificados anulados anteriores y «Situación» («Lista para emitir» o el motivo por el que la emisión la rechazaría). Resumen: pendientes, listos para emitir, sin DNI completo y con un certificado anulado anterior. Sin fila de totales. Detalle: [Reportes de certificación](reportes-certificacion.md).
- **resumen**: indicadores del período (estudiantes y matrículas registrados, vigentes y anuladas, ediciones que inician) e indicadores **al generar** (estudiantes activos e inactivos, ediciones abiertas y su ocupación). La tabla es la serie mensual (mes, estudiantes registrados, matrículas registradas, vigentes y anuladas) con fila «Total».

Las ediciones activas se cuentan con el mismo criterio que el Resumen del panel (`OPEN_EDITIONS_WHERE` de `StatsService`: abierta y no archivada).

## Filtros

Todos son opcionales y se validan antes de consultar. `forbidNonWhitelisted`: un parámetro desconocido responde 400. Si un filtro existe pero no se aplica al reporte, también responde 400, porque nunca se ignora en silencio.

| Parámetro | Formato | Significado |
| --- | --- | --- |
| `desde`, `hasta` | `AAAA-MM-DD` | Días de Perú (America/Lima, UTC-5 fijo), ambos incluidos. `desde > hasta` → 400; más de 3660 días → 400 |
| `curso_id`, `convocatoria_id` | entero ≥ 1 | Inexistente → 404 |
| `estado` | según el reporte | Valor de otro reporte → 400 con los valores admitidos |
| `cumplimiento` | `pendiente`, `cumplido`, `no_cumplido` | Solo `matriculas` |
| `archivo` | `activos`, `archivados`, `todos` | Solo ediciones/ocupación. Sin él se incluyen todas: un reporte es histórico |
| `agrupar` | `edicion` (defecto), `curso` | Solo `matriculas-por-edicion` |
| `page`, `limit` | `limit` 1–100 (defecto 20) | Solo en la consulta JSON; en `exportar` responden 400 |
| `formato` | `csv`, `xlsx`, `pdf` | Obligatorio en `exportar` |
| `separador` | `punto_y_coma` (defecto), `coma` | Solo CSV; con otro formato, 400 |

El período se aplica de esta forma:

- **estudiantes**: por la fecha de registro del estudiante.
- **matriculas** y **matriculas-por-edicion**: por la fecha de registro de la matrícula.
- **certificados**: por la fecha de emisión del certificado. **pendientes-certificacion**: por la fecha en que se confirmó el cumplimiento.
- **ediciones** y **ocupacion**: por superposición del período con `[fecha_inicio, fecha_fin]`; las ediciones sin fechas quedan fuera cuando se indica un período.
- **resumen**: sin fechas, usa los últimos 12 meses, incluido el actual; sin `hasta`, termina hoy.

Los estados (vigente/anulada, activo/inactivo, estado de la edición) son los **vigentes al generar** el reporte, porque la base no guarda en qué fecha cambió cada estado.

## Respuesta JSON

```json
{
  "ok": true,
  "reporte": {
    "tipo": "ocupacion",
    "titulo": "Ocupación de cupos",
    "descripcion": "Capacidad, matrículas vigentes, cupos disponibles y porcentaje de ocupación por edición.",
    "institucion": "Horus Group SRL",
    "generado_at": "2026-10-19T15:30:00.000Z",
    "generado_local": "2026-10-19 10:30",
    "periodo": { "desde": null, "hasta": null, "etiqueta": "Todo el historial" },
    "filtros": [{ "clave": "curso_id", "etiqueta": "Curso", "valor": "Instalación de cámaras y CCTV" }],
    "resumen": [{ "clave": "ocupacion", "etiqueta": "Ocupación global (%)", "valor": 40, "tipo": "decimal" }],
    "tabla": {
      "titulo": "Ocupación",
      "columnas": [{ "clave": "capacidad", "titulo": "Capacidad", "tipo": "entero", "ancho": 10 }],
      "filas": [{ "id": 12, "curso": "…", "capacidad": 3, "vigentes": 2, "disponibles": 1, "ocupacion": 66.7 }],
      "totales": { "id": "Total", "capacidad": 10, "vigentes": 5, "disponibles": 6, "ocupacion": 40 },
      "total_filas": 4
    },
    "notas": ["Solo las matrículas vigentes ocupan cupo. …"],
    "datos_personales": false
  },
  "pagination": { "page": 1, "limit": 20, "total": 4, "pages": 1 }
}
```

- `tabla.filas` es la página pedida. `resumen`, `totales` y `total_filas` cubren **todo** el filtro.
- `columnas[].tipo` puede ser `texto`, `entero`, `decimal` (un decimal; los porcentajes vienen como 66.7 = 66,7 %), `fecha` (`AAAA-MM-DD`) o `fecha_hora` (`AAAA-MM-DD HH:mm`, hora de Lima). Con él, React puede alinear y formatear sin conocer cada reporte.
- `valor: null` en el resumen significa «no aplica» (por ejemplo, ocupación sin ninguna capacidad definida). En las filas, `null` es un dato ausente: no se inventan ceros.
- La fila `totales` usa la primera columna para la etiqueta «Total» y `null` en las columnas que no se suman.

Catálogo (`GET /admin/reportes`): `{ ok, formatos: ['csv','xlsx','pdf'], limites: { filas_exportacion: { csv: 20000, xlsx: 20000, pdf: 3000 }, filas_por_pagina: 100 }, reportes: [{ tipo, titulo, descripcion, filtros, estados, datos_personales, puede_consultar, puede_exportar }] }`.

## Archivos exportados

| Formato | Content-Type | Estructura |
| --- | --- | --- |
| CSV | `text/csv; charset=utf-8` | UTF-8 con BOM, CRLF y comillas según RFC 4180. Separador `;` por defecto (ver abajo). Primero la tabla (encabezados, filas y «Total» si existe); tras una línea vacía, los metadatos (reporte, institución, generado el, período, filtros, filas), el resumen y las notas. Fechas ISO y decimales con punto |
| XLSX | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | Libro Office Open XML auténtico (ZIP), sin dependencias. Hoja «Resumen» (encabezado institucional, generado el, período, filtros, filas, indicadores y notas) y hoja de datos con encabezado navy/dorado fijo, autofiltro, anchos de columna, fechas reales `dd/mm/aaaa [hh:mm]`, números como números y una fila vacía antes de «Total» para que el autofiltro y la ordenación no la mezclen. Configurado para imprimir en A4 horizontal con encabezados repetidos |
| PDF | `application/pdf` | A4 (horizontal con más de 6 columnas). Banda institucional en cada página, título, fecha de generación, período, filtros y número de filas, indicadores en tarjetas, tabla con encabezado repetido tras cada salto, filas que no se parten, celdas con ajuste de línea (como máximo 4 líneas y luego elipsis), fila «Total», notas y pie «Página X de Y». Aviso «Confidencial» si hay datos personales |

Cabeceras: `Content-Disposition: attachment; filename="horus-reporte-<tipo>-<AAAAMMDD-HHmm>.<ext>"` (ASCII, hora de Lima), `Content-Length`, `Cache-Control: no-store` y `X-Content-Type-Options: nosniff`.

**Separador del CSV.** Excel abre el CSV con el separador de lista de Windows, que en es-PE es `;`. Se comprobó con Excel en es-PE: con comas, cada fila queda en una sola columna. Por eso el valor por defecto es `punto_y_coma`; `separador=coma` sirve para herramientas que esperan el CSV clásico o para Windows en otras configuraciones (por ejemplo en-US).

**Fórmulas maliciosas.** En CSV, todo texto que empiece por `=`, `+`, `-`, `@` (también en ancho completo), tabulación o salto de línea se prefija con `'`, el mismo criterio que el CSV del panel. Se aplica también a metadatos y filtros. En XLSX el texto se escribe como cadena (`inlineStr`), que Excel nunca evalúa, con `quotePrefix`; el libro no contiene ninguna fórmula. En PDF no hay fórmulas y el texto se muestra literal.

**Caracteres.** Los tres formatos retiran los caracteres de control no válidos. El PDF usa las fuentes estándar Helvetica (WinAnsi): tildes, ñ, ü, ¿, ¡, «» y € se conservan; los signos fuera de ese juego se normalizan (NFKC) o se muestran como `?`.

**Limitaciones conocidas.** Al abrir el CSV, Excel convierte el DNI `01234567` en número y pierde el cero inicial, y puede mostrar `####` en una columna de fecha y hora estrecha. El XLSX conserva el DNI como texto y ajusta los anchos, así que para trabajar en Excel conviene recomendar XLSX.

## Límites y errores

| Situación | HTTP | Mensaje (español, sin detalles internos) |
| --- | --- | --- |
| Parámetro inválido, desconocido o no aplicable; período invertido o mayor de 3660 días | 400 | Explica el filtro o el valor admitido |
| Sin sesión o sesión revocada | 401 | — |
| Sin permiso del reporte o sin permiso de datos personales | 403 | Genérico o «Tu rol no puede consultar/exportar reportes con datos personales de estudiantes.» |
| Curso o edición inexistentes | 404 | «El curso no existe.» / «La edición no existe.» |
| Más filas que el máximo del formato (CSV/XLSX 20 000, PDF 3 000) o del cálculo (20 000) | 422 | «El reporte tiene N filas y el máximo para el formato PDF es 3000. Acota el período o los filtros.» No se genera ningún archivo ni se trunca |
| Más de 2 exportaciones simultáneas en el proceso | 429 | «Hay otras exportaciones en curso. Inténtalo de nuevo en unos segundos.» |
| Esquema académico pendiente, transacción de más de 30 s o pool agotado | 503 | Mensaje neutro |

Memoria: el archivo se genera completo en memoria antes de responder, así que un error nunca entrega un archivo a medias. El tamaño está acotado por los límites (medido: CSV + XLSX de 3005 filas en ~0,5 s; PDF de 3000 filas, 105 páginas, 260 KiB en ~1 s). Las tablas grandes (estudiantes y matrículas) se leen por lotes de 1000 dentro de la misma transacción. Los valores están en `backend/src/reportes/reportes.limites.ts`.

Privacidad: el módulo no escribe en la base (lo comprueba la integración con `CHECKSUM TABLE`) ni registra filtros, filas o datos personales en los logs. Las descargas no se auditan todavía; requeriría ampliar `admin_auditoria` con una migración (ver «Pendientes»).

## Guía para el panel React

1. Al abrir la sección, cargar `GET /admin/reportes` con `panelRequest`. Mostrar solo los reportes con `puede_consultar` y el botón de descarga solo con `puede_exportar`. Aun así, tratar los 403 del backend.
2. Construir los filtros a partir de `filtros` y `estados` del catálogo. Para elegir curso y edición se pueden reutilizar `GET /admin/convocatorias/cursos` y `GET /admin/matriculas/ediciones` (exigen sus propios permisos de lectura).
3. Vista previa: `GET /admin/reportes/:tipo?…&page=&limit=`. Dibujar las tarjetas con `reporte.resumen` (`tipo: 'decimal'` → un decimal y «%» si el título lo indica; `null` → «No aplica»), la tabla con `reporte.tabla.columnas` y `filas`, y la fila `totales` al final. Cancelar la solicitud anterior al cambiar un filtro (AbortController), para que una respuesta antigua no pise la actual.
4. Descarga: `GET /admin/reportes/:tipo/exportar?formato=…&<mismos filtros>` con el token en `Authorization`, leer la respuesta como `Blob` y guardarla con un enlace temporal (`URL.createObjectURL`, liberado después). El nombre puede tomarse de `Content-Disposition`, porque en producción (Caddy) y en desarrollo (proxy de Vite) es el mismo origen. Si alguna vez se sirve entre orígenes, habría que exponer esa cabecera en CORS (`exposedHeaders`), que hoy no se expone; también se puede construir con `horus-reporte-<tipo>-…`.
5. Estados: bloquear el botón mientras dura la descarga (evitar dobles clics), mostrar los mensajes 400/403/404/422/429 del backend en línea y nunca el texto de un 500. Un 422 invita a acotar el período y un 429 a reintentar más tarde. No guardar datos del reporte en `localStorage`.
6. Al declarar la sección en `PANEL_SECTIONS`, usar `reportes_academicos:leer` (es el permiso del GET), como pide `test:panel-access`.

## Pruebas

| Comando (desde `backend/`) | Qué cubre |
| --- | --- |
| `npm test` (incluye `test/reportes.test.ts`) | Validación de filtros y formatos; días de Lima; permisos por rol y datos personales; catálogo; lectura por lotes en `REPEATABLE READ`; límites 422 y 429; ediciones, ocupación (capacidad nula, división por cero), agrupaciones y resumen; reportes vacíos; 404 y 503 sin texto interno; CSV (BOM, CRLF, escapes, `;`/`,`, fórmulas, controles); XLSX (paquete OOXML, partes, estilos, autofiltro, panel fijo, fechas reales, sin fórmulas, `quotePrefix`); PDF (estructura, A4, metadatos, tildes, paginación, encabezado repetido, filas sin partir, vacío); coherencia CSV ↔ XLSX celda a celda; 20 000 filas dentro del límite |
| `npm run build` y `node test/run-academic-isolated.cjs reportes` | HTTP real con el AppModule compilado contra un MySQL 8.4 desechable propio (Docker, imagen local `mysql:8.4`): 401/403 por rol, 400/404, días de Lima, valores calculados, coherencia JSON ↔ CSV ↔ XLSX ↔ PDF en 9 combinaciones de reporte y filtros, fórmulas, separador, solo lectura (`CHECKSUM TABLE`), 422 por volumen, PDF de 3000 filas y ausencia de datos personales en los logs. Con `REPORTES_MUESTRAS_DIR=<carpeta>` guarda los archivos descargados (datos ficticios) como ejemplos. La CI lo ejecuta en el job `integration` |

`access-guard-http.integration.cjs` cuenta las tres rutas nuevas en su barrido: gerente +3, coordinación +2, secretaría y cuenta básica +0.

## Dependencias

- `pdfkit` 0.17.2 (MIT; árbol MIT salvo `@swc/helpers` Apache-2.0 y `tslib` 0BSD; `png-js` no declara licencia en npm) y `@types/pdfkit` 0.17.6 (desarrollo), instaladas con autorización y versión exacta.
- El XLSX no usa dependencias: `exceljs` se descartó porque añadía 193 paquetes y avisos de `npm audit`. El ZIP se genera con `zlib` de Node y un CRC-32 propio.

## Pendientes y decisiones

- **Exportación para la coordinadora**: `reportes_academicos:exportar` y `estudiantes:exportar` siguen siendo solo del gerente (decisión pendiente en `policy.ts`). Concederlos es un cambio de matriz con sus pruebas.
- **Auditoría de descargas**: registrar quién exportó qué requiere una migración (nuevo valor de operación en `admin_auditoria`); no se hizo para no crear cambios de esquema.
- **Estados históricos**: «vigente/anulada a una fecha» exigiría reconstruirlos desde `academico_historial`; hoy se informa el estado actual.
- **Certificados**: los reportes `certificados` y `pendientes-certificacion` ya existen (ver [Reportes de certificación](reportes-certificacion.md)). Sus consultas solo se han probado con Prisma simulado: falta ejecutarlas contra un MySQL desechable (`node test/run-academic-isolated.cjs reportes`, tras `npm run build`), cuya lista de tipos ya los incluye.
