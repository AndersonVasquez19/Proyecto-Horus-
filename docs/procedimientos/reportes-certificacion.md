# Reportes de certificación

> **Documento histórico: funcionalidad retirada (simplificación académica, octubre de 2026).** Los certificados se preparan y entregan de forma presencial,
> fuera de la plataforma. Ya no existen la emisión, anulación y sustitución, las rutas `/api/admin/certificados*`, el PDF con QR, el recurso de permisos
> `certificados:*`, los reportes `certificados` y `pendientes-certificacion`, los indicadores del Resumen ni la herramienta de HORUS Assistant. Se conservan
> las tablas, los datos, la migración y el respaldo/restauración, el **bloqueo de matrículas con un certificado vigente** y, de forma provisional,
> `GET /api/certificados/verificar/:codigo` (solo lectura) porque no se pudo comprobar que no existan certificados emitidos con QR en todos los entornos.
> Lo que sigue describe el diseño anterior y no el comportamiento actual.


Dos reportes nuevos dentro del módulo de [Reportes académicos](reportes-academicos.md): **`certificados`** (certificados emitidos) y **`pendientes-certificacion`** (quién falta por certificar). No añaden tablas, migraciones, rutas ni permisos: reutilizan `GET /api/admin/reportes/:tipo` y `GET /api/admin/reportes/:tipo/exportar` y la matriz de roles existente.

## 1. Qué problema resuelve

El flujo académico termina así: matricular → confirmar el cumplimiento → emitir el certificado. Hasta ahora había reportes de estudiantes, ediciones, cupos y matrículas, pero **ninguno del último tramo**:

- No había forma de saber **a quién falta emitirle el certificado** (matrículas con cumplimiento confirmado y sin certificado vigente), ni **por qué** no se puede emitir (por ejemplo, el estudiante no tiene DNI completo).
- No había un listado exportable de **certificados emitidos** con su estado (vigente o anulado) para conciliar, archivar o responder a una auditoría.

## 2. Qué usuarios pueden utilizarlo

| Rol | Consultar (JSON) | Exportar (CSV, XLSX, PDF) |
| --- | --- | --- |
| Gerente general | Ambos reportes | Ambos reportes |
| Coordinadora institucional | Ambos reportes | No (`reportes_academicos:exportar` sigue siendo solo del gerente) |
| Secretaría | No (403): no tiene `reportes_academicos:leer` | No (403) |
| Cuenta sin rol | 403 | 403 |

El servicio vuelve a comprobar el permiso con el rol vigente en la base (no el del JWT). Como los reportes contienen datos personales (nombre y DNI), exigen además: `certificados` → `certificados:leer` y `estudiantes:leer` (exportar: `certificados:leer` y `estudiantes:exportar`); `pendientes-certificacion` → `matriculas:leer`, `certificados:leer` y `estudiantes:leer` (exportar: `certificados:leer` y `estudiantes:exportar`).

## 3. Cómo funciona, paso a paso

1. El panel (o un cliente) pide `GET /api/admin/reportes` y recibe el catálogo con los dos tipos nuevos y si la cuenta puede consultarlos o exportarlos.
2. Pide la consulta: `GET /api/admin/reportes/pendientes-certificacion?curso_id=…&page=1&limit=20`.
3. El controlador valida los filtros (DTO) y el servicio rechaza con 400 cualquier filtro que el reporte no admita.
4. El servicio abre **una transacción de solo lectura** (`REPEATABLE READ`) y construye **un único documento**: resumen + tabla paginada. El resumen cubre todo el filtro, no solo la página.
5. Para `pendientes-certificacion`, cada fila se evalúa con **`checkEmission`**, la misma función que usa la emisión de certificados. Así la columna «Situación» muestra «Lista para emitir» o el mismo motivo que daría la emisión si se intentara hoy. El reporte no puede prometer algo que la emisión rechazaría.
6. Para descargar: `GET /api/admin/reportes/<tipo>/exportar?formato=csv|xlsx|pdf`. Los tres formatos se generan del mismo documento, de modo que muestran las mismas filas.

### `pendientes-certificacion`: qué entra

Una matrícula figura como pendiente si cumple **todo** lo siguiente:

- está **activa**;
- su cumplimiento está confirmado como **cumplido**;
- **no tiene un certificado vigente**;
- su edición **no está cancelada** (una edición cancelada no emite certificados).

Una matrícula cuyo certificado fue anulado y que no tiene otro vigente **sigue apareciendo** como pendiente; la columna «Certificados anulados» muestra que hubo uno anterior. Se ordena de la más antigua a la más reciente por fecha de confirmación (lo que más espera, primero).

Resumen: pendientes, listos para emitir, sin DNI completo (no se pueden emitir) y con un certificado anulado anterior.

### `certificados`: qué entra

Todos los certificados que cumplan los filtros, del más reciente al más antiguo. Los datos del estudiante, curso y edición son **la copia fijada al emitir** (no cambian si luego se edita el estudiante). Resumen: total, vigentes, anulados y anulados por sustitución (con un certificado nuevo). **No** incluye el motivo de anulación ni quién emitió o anuló (son datos internos de la ficha del certificado).

## 4. Archivos que intervienen

| Archivo | Papel |
| --- | --- |
| `backend/src/reportes/reportes.types.ts` | Añade los dos tipos a `REPORT_TYPES` |
| `backend/src/reportes/reportes.dto.ts` | Añade `CERTIFICATE_STATES` (`vigente`, `anulado`) a los estados válidos |
| `backend/src/reportes/reportes.catalogo.ts` | Filtros, estados, permisos y notas de cada reporte |
| `backend/src/reportes/reportes.service.ts` | `certificates` y `pendingCertification` (consultas, resumen y filas) |
| `backend/src/certificados/certificados.rules.ts` | **Sin cambios.** `checkEmission` se reutiliza para la columna «Situación» |
| `backend/test/reportes.test.ts` | 5 pruebas nuevas (ver abajo) |
| `backend/test/reportes.integration.cjs` | Solo añade los dos tipos a la lista que espera el catálogo |
| `backend/src/permissions/route-inventory.ts` | Solo el texto de las notas de las rutas de reportes |

## 5. Endpoints

Los mismos del módulo de reportes (no hay rutas nuevas):

- `GET /api/admin/reportes` — catálogo.
- `GET /api/admin/reportes/certificados` y `GET /api/admin/reportes/pendientes-certificacion` — consulta JSON.
- `GET /api/admin/reportes/certificados/exportar?formato=…` y `GET /api/admin/reportes/pendientes-certificacion/exportar?formato=…` — archivo.

Filtros: `certificados` admite `desde`, `hasta`, `curso_id`, `convocatoria_id` y `estado` (`vigente` o `anulado`); `pendientes-certificacion` admite `desde`, `hasta`, `curso_id` y `convocatoria_id`. Con `desde`/`hasta` el primero filtra por la fecha de emisión y el segundo por la fecha de confirmación del cumplimiento, en días de Lima. Un filtro no admitido o un estado de otro reporte responde 400; un curso o edición inexistente, 404.

## 6. Qué datos consulta (y almacena)

**No almacena nada:** es de solo lectura (no escribe en la base ni registra filtros o datos personales en los logs). Consulta `certificados`, `matriculas`, `estudiantes`, `convocatorias` y `cursos`.

## 7. Validaciones y permisos

- Permiso de AccessGuard `reportes_academicos:leer` / `exportar`, repetido en el servicio con el rol vigente, más los permisos de datos personales indicados arriba.
- Filtros validados antes de consultar; límites del módulo (máximo 3660 días de período, 100 filas por página, 20 000 filas en CSV/XLSX y 3000 en PDF: si se superan, 422 en lugar de truncar).
- Nombres con forma de fórmula (`=`, `+`, `-`, `@`) se neutralizan en CSV y XLSX.
- Errores de esquema o tiempo agotado responden 503 con un mensaje neutro, sin texto interno.

## 8. Relación con otros módulos

- **Matrículas**: el cumplimiento (`cumplido`) lo confirma ese módulo; el reporte lista las matrículas que ya llegaron a ese punto.
- **Certificados**: `checkEmission` es la regla única de emisión; el reporte de emitidos lee la tabla `certificados`.
- **Estudiantes**: el DNI completo es obligatorio para emitir; el reporte lo detecta.
- **Ediciones y cursos**: filtros por `curso_id` y `convocatoria_id`; las ediciones canceladas no entran en los pendientes.
- **Reportes académicos**: usa el mismo documento, las mismas exportaciones, los mismos límites y los mismos permisos.

## 9. Cómo explicarlo al jurado

> «El sistema ya permitía matricular, confirmar que el estudiante cumplió y emitir el certificado con su código QR. Faltaba un tablero para quien administra: **¿a quién todavía le debo un certificado?** y **¿qué certificados ya emitimos?**
>
> El primer reporte es la **lista de pendientes**: toma a los estudiantes que ya cumplieron y todavía no tienen certificado vigente, y para cada uno dice si se le puede emitir hoy o qué falta (por ejemplo, el DNI). Para decirlo usa **la misma regla** que usa el sistema al emitir, así que nunca promete algo que luego se rechace.
>
> El segundo reporte es el **registro de certificados emitidos**, con su estado (vigente o anulado) y si fue reemplazado por otro. Ambos se pueden descargar en Excel, CSV o PDF.
>
> Es **solo lectura**: no modifica la base. Solo lo ven los roles con permiso, y como incluye DNI, descargar es una acción reservada al gerente.»

Preguntas probables del jurado:

- *¿Por qué una matrícula con certificado anulado vuelve a salir como pendiente?* Porque ya no tiene un certificado vigente; la columna «Certificados anulados» indica que hubo uno. Quien administra decide si corresponde emitir otro o sustituir.
- *¿Por qué no se muestra el motivo de la anulación?* Es texto libre y puede contener datos sensibles; sigue disponible en la ficha del certificado, con sus permisos.
- *¿Y si cambio el nombre del estudiante después?* Los certificados emitidos conservan la copia del momento de la emisión; los pendientes muestran los datos actuales porque aún no se emiten.

## Pruebas

| Comando (desde `backend/`) | Qué cubre |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Tipos, incluidos los tests |
| `node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/reportes.test.ts` | Validación de estados y filtros propios (400 sin consultar), permisos por rol (gerente, coordinación, secretaría, sin rol y rol desconocido; consulta y exportación; catálogo), cláusulas `where` exactas (días de Lima, curso, edición, estado, ediciones canceladas excluidas, sin certificado vigente), resumen sobre todo el filtro, ausencia del motivo de anulación en la selección, aplicación de `checkEmission` (con y sin DNI), orden, y coherencia CSV/XLSX con neutralización de fórmulas y límite del PDF |

## Limitaciones y pendientes

- **Solo Prisma simulado.** Las consultas (`none`, `isNot: null`, `_count` filtrado) no se han ejecutado contra MySQL real. Pendiente: `npm run build` y `node test/run-academic-isolated.cjs reportes` (MySQL 8.4 desechable en Docker); su lista de tipos ya incluye los dos reportes nuevos, pero sin datos de certificados no demuestra los conteos.
- **Revisión visual** de los archivos XLSX/PDF generados para estos reportes: no realizada.
- **Secretaría** no puede consultarlos (no tiene `reportes_academicos:leer`); darle acceso a la lista de pendientes es un cambio de matriz que requiere decisión del responsable.
- El panel React aún no consume los reportes.
- «Listos para emitir» cuenta por documento presente (el `CHECK` de MySQL garantiza DNI de 8 dígitos); la columna «Situación» aplica `checkEmission` fila por fila. Coinciden salvo que un estudiante tenga nombres o apellidos en blanco, caso que solo el segundo detecta.
