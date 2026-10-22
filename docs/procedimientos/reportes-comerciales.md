# Reportes comerciales y de atención al cliente (CSV, XLSX y PDF)

Etapa 3. Ampliación del backend de reportes (`backend/src/reportes/`) para que Gerencia consulte y exporte indicadores de **Cotizaciones** y de **Atención al Cliente (consultas)**. **No es un segundo motor**: usa el mismo `ReportesService.build` (transacción de solo lectura `REPEATABLE READ`), el mismo documento `{resumen, tabla, totales, notas}`, los mismos renderizadores de CSV, XLSX y PDF, las mismas rutas, el mismo DTO y los mismos límites que los reportes académicos (ver [reportes-academicos.md](reportes-academicos.md)). El panel React todavía no lo consume.

## Qué es y qué no es cada cifra

- **Cotizado no es cobrado.** Un importe es lo que Horus propuso por escrito. El sistema no registra pagos, facturas ni cobranzas, así que **ningún reporte presenta ingresos recibidos ni ventas reales**. «Aceptada» es un registro administrativo (con nota opcional), no prueba de pago; las etiquetas y las notas de cada archivo lo dicen.
- **Nunca se suman monedas distintas.** Soles (PEN) y dólares (USD) tienen sus propias cifras; los importes no llevan fila de totales.
- **Sin datos personales.** Ningún reporte pide ni expone cliente, correo, teléfono, documento, dirección, condiciones, conceptos, asunto, mensaje, notas, respuesta ni responsable. Las hojas de trabajo identifican cada caso por su **número de cotización** o su **ID de consulta**, que se abre en el panel con los permisos de ese módulo.
- **Estados vigentes.** Salvo que se indique lo contrario, los estados son los de al generar el reporte (no se reconstruye el que tenía cada registro en el pasado).

## Reportes (`:tipo`)

Mismas rutas: `GET /api/admin/reportes`, `GET /api/admin/reportes/:tipo` (JSON paginado, `page`/`limit`) y `GET /api/admin/reportes/:tipo/exportar?formato=csv|xlsx|pdf` (`separador=punto_y_coma|coma` solo en CSV).

| `tipo` | Qué muestra | Filtros | `estado` admitido | Período filtra por |
| --- | --- | --- | --- | --- |
| `cotizaciones-por-estado` | Cantidad y % por estado (borrador, enviada, aceptada, rechazada, anulada); abiertas y tasa de aceptación | `desde`, `hasta`, `moneda` | — | Fecha de creación |
| `cotizaciones-vencidas` | Propuestas **enviadas** con vigencia anterior a hoy (Lima), de la más atrasada a la más reciente: número, moneda, importe cotizado, vigencia, días vencida, creada, si tiene consulta de origen; importe vencido por moneda | `desde`, `hasta`, `moneda` | — | **Fecha de vencimiento** (vigencia) |
| `cotizaciones-importes` | Subtotal, descuento, impuesto y total cotizados por moneda y estado; importe en propuestas enviadas (pendientes de respuesta) y aceptadas, por moneda | `desde`, `hasta`, `moneda`, `estado` | `borrador`, `enviada`, `aceptada`, `rechazada`, `anulada` | Fecha de creación |
| `consultas-por-estado` | Consultas por estado (nuevo, en proceso, atendido, archivado), abiertas, cerradas y abiertas con más de 48 h | `desde`, `hasta` | — | Fecha de recepción |
| `consultas-abiertas-antiguas` | Consultas nuevas o en proceso recibidas hace **más de 48 horas**, de la más antigua a la más reciente: ID, estado, origen, recibida, horas abierta | `desde`, `hasta`, `estado` | `nuevo`, `en_proceso` | Fecha de recepción |
| `actividad-comercial` | Serie mensual (Lima): consultas recibidas y cerradas hoy, cotizaciones creadas, creadas desde una consulta y aceptadas hoy | `desde`, `hasta` (sin fechas: últimos 12 meses) | — | Fecha de creación |

Un filtro que el reporte no admite responde **400** (no se ignora). `moneda` es `PEN` o `USD`. Reglas reutilizadas, no reinventadas:

- **Vencida**: estado `enviada` y `validez` anterior a hoy en Lima. Es el criterio de `isExpired`, del filtro `vencida=si` del listado y de HORUS Assistant. Vence-hoy sigue vigente; un borrador con fecha pasada **no** cuenta como vencido.
- **Estado de una consulta**: el del seguimiento si existe y, si no, el de la consulta (`COALESCE(attention_records.estado, contactos.estado)` de la bandeja). El seguimiento se une por `(recurso='messages', registro_id)`, no por el FK histórico `contacto_id`, y un seguimiento de otro recurso (reclamaciones) no cuenta.
- **Antigua**: consulta abierta (nuevo o en proceso) con más de `HORAS_CONSULTA_ANTIGUA` (48 h, `attention-rules.ts`, el mismo valor de la bandeja y de HORUS Assistant) desde que se recibió; 48 h exactas todavía no. Se calcula contra el momento de generar el reporte.
- Las reclamaciones **no** forman parte de estos reportes (solo consultas/mensajes).

## Permisos

**La matriz de roles (`policy.ts`) no cambió** y no hay permisos nuevos. La ruta sigue exigiendo el acceso general a reportes (`reportes_academicos:leer` / `:exportar`, AccessGuard) y el servicio exige además, con el rol vigente de la base, el permiso de lectura del módulo de origen:

| Reporte | Consultar | Exportar |
| --- | --- | --- |
| `cotizaciones-*` | `reportes_academicos:leer` + `cotizaciones:leer` | `reportes_academicos:exportar` + `cotizaciones:leer` |
| `consultas-*` | `reportes_academicos:leer` + `mensajes:leer` + `seguimiento_mensajes:leer` | `reportes_academicos:exportar` + las dos de lectura |
| `actividad-comercial` | `reportes_academicos:leer` + las tres de lectura | `reportes_academicos:exportar` + las tres de lectura |

| Rol | Consultar | Exportar |
| --- | --- | --- |
| Gerente general | Todos | Todos |
| Coordinadora institucional | Todos (tiene todos los permisos de lectura) | Ninguno: `reportes_academicos:exportar` sigue reservado al gerente (decisión ya existente) |
| Secretaría | Ninguno (403): no tiene `reportes_academicos:leer` ni `cotizaciones:leer` | Ninguno (403) |

Cada entrada del catálogo (`GET /admin/reportes`) incluye `ambito: "academico" | "comercial"`, `puede_consultar` y `puede_exportar`. Los reportes académicos no cambian de ámbito ni de requisitos.

**Catálogo filtrado por permisos efectivos.** El catálogo comercial se filtra con el rol vigente: un reporte comercial con `puede_consultar=true` aparece y uno con `puede_consultar=false` se **omite** (por ejemplo, sin `cotizaciones:leer` no aparecen los tres reportes de cotizaciones ni `actividad-comercial`). Los reportes académicos **no** se filtran: siguen listados con sus banderas `puede_consultar` y `puede_exportar` como antes. Con la matriz actual, Gerencia y Coordinación ven los seis comerciales; Secretaría recibe 403 en el catálogo (no tiene `reportes_academicos:leer`). El filtrado es solo una mejora de visibilidad: **no sustituye la autorización**; las rutas de consulta y exportación (CSV, XLSX y PDF) vuelven a verificar los permisos antes de leer datos, y el filtrado no ejecuta consultas de negocio.

**Deuda técnica:** los reportes comerciales todavía reutilizan los permisos `reportes_academicos:leer` / `:exportar` (no existe un permiso comercial propio) y validan adicionalmente, con el rol vigente, los permisos del módulo de origen (`cotizaciones:leer`, `mensajes:leer`, `seguimiento_mensajes:leer`). La comprobación se hace en el servicio **antes de consultar datos**, tanto en la vista JSON como en la exportación a CSV, XLSX y PDF. La matriz de permisos no se modifica en esta etapa.

**Alternativa descartada por ahora** (requiere decisión): un permiso propio `reportes_comerciales:leer/exportar`. Separaría del todo lo comercial de lo académico, pero exige tocar `permissions.ts`, la matriz de `policy.ts`, la clasificación de rutas (la ruta `:tipo` es única) y decidir qué rol lo recibe. Con el modelo actual, quien tenga acceso a reportes pero no al módulo de origen no ve en el catálogo los reportes de esos módulos y recibe 403 si intenta abrirlos o exportarlos directamente.

## Formatos

Los tres formatos renderizan el mismo documento (misma tabla, resumen y notas). Cambio compartido y aditivo: un tipo de columna/indicador `importe` (dos decimales: `1000.50` en CSV y PDF; número real con formato `0.00` en XLSX). Los decimales de un dígito de los reportes académicos no cambian. Nombres de archivo: `horus-reporte-<tipo>-<AAAAMMDD-HHmm>.<ext>`.

## Límites

Los de los reportes académicos (`reportes.limites.ts`): rango máximo de 3660 días, hasta 20 000 filas en CSV/XLSX y 3000 en PDF para las hojas de trabajo (422 con petición de acotar, nunca truncado), 2 exportaciones simultáneas por proceso (429). Los reportes que recorren registros para agregar (consultas, actividad mensual) leen como máximo 20 000 registros por tabla; si el filtro los supera, responden 422 pidiendo acotar el período.

## Pruebas

- `backend/test/reportes-comerciales.test.ts` (27 pruebas, con un doble de Prisma que evalúa período, moneda, estado y vigencia y solo devuelve las columnas pedidas): conteos y agrupaciones, fechas de Lima, vencidas, importes con decimales exactos y sin mezclar monedas, antigüedad (48 h exactas), estado efectivo de consultas, períodos sin registros, permisos por rol y matriz sin cambios, privacidad (ni siquiera se piden columnas personales), CSV/XLSX/PDF de los seis reportes, límites, validación de filtros, regresión académica y catálogo filtrado (la falta de un permiso de módulo se simula retirándolo solo durante la prueba, porque ningún rol de la matriz real lo permite; también comprueba el 403 en JSON, CSV, XLSX y PDF y que el catálogo no consulta datos de negocio).
- Verificación contra **MySQL 8.0.46 real y aislado** (clon temporal, datos ficticios): los mismos datos y resultados esperados, `groupBy` con decimales, fechas `DATE`, unión por `registro_id`, permisos con cuentas reales, 18 archivos (6 reportes × 3 formatos) y ningún dato personal en los CSV; el reporte es de solo lectura (las filas quedan intactas).

Resultados: `tsc --noEmit` y `nest build` sin errores con Node 22.23.3; verificación MySQL 8.0.46 aislada con 0 fallos (previa al filtrado del catálogo, que no toca consultas SQL y no se repitió); tras el filtrado, 96/96 pruebas de reportes comerciales y académicos, `permissions` y `access-guard`.

## Limitaciones

- No hay ingresos, ventas ni cobranzas: el sistema no las registra. Lo que se pueda decir de ventas reales requeriría un módulo de pagos/facturación (migración, fuera de esta etapa).
- No se reconstruye el estado histórico: «aceptadas hoy» o «cerradas hoy» usan el estado vigente. Contar aceptaciones por fecha de aceptación exigiría leer el historial JSON (o columnas de auditoría estructuradas, que ya figuran como mejora con migración en `COTIZACIONES.md`).
- «Responsable», cliente, asunto y origen detallado de la consulta no se exportan por privacidad; ampliarlo sería una decisión explícita.
- El panel React aún no tiene pantalla para estos reportes (frontend fuera de esta etapa).
- No se ejecutó la suite completa ni la prueba de integración de Docker de reportes académicos (`reportes.integration.cjs`).
