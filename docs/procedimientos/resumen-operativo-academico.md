# Resumen operativo: Preinscripciones y Certificados

> **Actualización (simplificación académica, octubre de 2026):** el bloque `certificados` se retiró de `GET /admin/stats?vista=operativa` (la respuesta conserva
> `academico`, `mensajes` y `preinscripciones`). Desaparecen `certificadosStats`, `PENDING_CERTIFICATION_WHERE`/`READY_STUDENT_WHERE` y el permiso `certificados:leer`.
> Lo que este documento dice sobre certificados describe el diseño anterior. El frontend no consumía ese bloque.

Complementa la sección «Resumen operativo» de [separacion-panel-contenido.md](separacion-panel-contenido.md). No hay endpoint, tabla ni migración nuevos: se amplió `GET /api/admin/stats?vista=operativa`.

## 1. Para qué sirve

Es la primera pantalla del panel. Responde, de un vistazo, «¿cómo va la operación académica hoy?»: cuánta gente quiere entrar a un curso, cuántas solicitudes esperan revisión y cuántos alumnos ya terminaron y esperan su certificado.

## 2. Qué muestra

Además de lo que ya mostraba (`academico`, `mensajes`), la respuesta incluye dos bloques nuevos, solo con números enteros:

| Bloque | Indicador | Significado |
| --- | --- | --- |
| `preinscripciones` | `total` | Todas las solicitudes de ediciones no archivadas |
| | `vigentes` | recibida + validada + matriculada (`ESTADOS_VIGENTES`, la misma definición del módulo) |
| | `recibidas` | Solicitudes aún sin revisar |
| | `pendientesRevision` | Recibidas cuya edición todavía admite validar (planificada o abierta, sin archivar). Es la cola de trabajo real |
| | `validadas` | Aprobadas, aún sin matrícula |
| | `convertidas` | Estado `matriculada` (ya son matrícula) |
| | `descartadas` / `desistidas` | Rechazadas por la administración / el solicitante desistió |
| `certificados` | `vigentes` / `anulados` | Certificados según su estado |
| | `sustituidos` | Subconjunto de los anulados que ya tienen un certificado nuevo |
| | `pendientesCertificacion` | Matrículas que ya cumplieron y aún no tienen certificado vigente |
| | `listosParaEmitir` | De las pendientes, las que tienen DNI completo |
| | `requierenCorreccion` | De las pendientes, las que no se pueden emitir hasta corregir el DNI |

Si la base aún no tiene las tablas (migraciones pendientes), el bloque llega como `null` («no disponible»): nunca se inventan ceros. Cualquier otro error se propaga como error.

## 3. De dónde salen los datos

- Preinscripciones: tabla `preinscripciones` (+ estado y archivo de su edición).
- Certificados: tabla `certificados` y, para los pendientes, `matriculas` con su estudiante y edición.
- Las reglas se **importan**, no se copian: `ESTADOS_VIGENTES` (preinscripciones) y `PENDING_CERTIFICATION_WHERE` / `READY_STUDENT_WHERE` (certificados). El reporte «Pendientes de certificación» usa esas mismas constantes, así que ambos dan el mismo número.
- Código: `backend/src/admin/stats/stats.academic.ts`.

## 4. Cómo se calculan

- Cada bloque usa agrupaciones y conteos (`groupBy` / `count`) ejecutados en paralelo: 2 consultas para preinscripciones y 4 para certificados, sin recorrer registros uno a uno (sin N+1).
- Pendiente de certificación = matrícula `activa` + cumplimiento `cumplido` + **ningún** certificado vigente + edición no cancelada.
- Listo para emitir = pendiente + DNI peruano completo. La emisión real vuelve a validar con `checkEmission`.
- `requierenCorreccion = pendientes − listos`; `listos` nunca supera a `pendientes` aunque los datos cambien entre dos lecturas.
- Alcance: el resumen es una foto del momento (no tiene filtros de fecha ni de curso). Todo el bloque de preinscripciones usa el mismo alcance (ediciones no archivadas).

**El mínimo de 10 preinscripciones no se interpreta como permiso para abrir una edición.** El resumen no calcula ni muestra «ediciones listas para abrir»: confirmar la apertura sigue siendo una decisión administrativa en Ediciones.

## 5. Quién puede consultarlo

La ruta exige `estadisticas:leer`: Gerente General y Coordinadora Institucional. Ambos ya tienen `preinscripciones:leer` y `certificados:leer`. Secretaría no tiene `estadisticas:leer` y no puede verlo. No se tocó la matriz de roles. Una prueba comprueba estas tres cosas.

## 6. Cómo evita contar mal

- Una matrícula con un certificado anulado y ningún vigente **sigue** pendiente (hay que reemitir); una anulada y sustituida **ya no** (tiene vigente).
- No cuenta matrículas anuladas, con cumplimiento pendiente o no cumplido, ni de ediciones canceladas.
- Un certificado anulado por sustitución cuenta como anulado y como sustituido, nunca como vigente.
- Las solicitudes recibidas en ediciones cerradas o canceladas no se cuentan como trabajo pendiente (no se pueden validar), aunque sí figuran en `recibidas`.
- No hay datos personales: las consultas solo cuentan, nunca seleccionan nombres, correos, teléfonos ni DNI.

## 7. Cómo explicarlo al jurado

> «El Resumen operativo es el tablero de la gerencia. Antes mostraba estudiantes, ediciones y matrículas. Ahora también dice cuántas personas pidieron entrar a un curso y cuántas solicitudes esperan revisión, y cuántos alumnos ya cumplieron y están esperando su certificado, separando los que se pueden emitir hoy de los que falta corregir un dato. Son solo cifras: nadie ve nombres ni DNI. Usa las mismas reglas que los módulos y que el reporte de certificación, por eso los números coinciden. Y aunque haya diez preinscritos, el sistema no abre solo la edición: eso lo decide una persona.»

## Pruebas y límites

- `backend/test/stats-academic.test.ts` (10 pruebas) y `stats-operational.test.ts` (2): conteos por estado, exclusión de no elegibles, anulados y sustituidos, matrículas sin certificado vigente, coherencia con el reporte, permisos, ausencia de datos personales y valores vacíos o tabla inexistente. Usan una base **simulada en memoria**.
- **Pendiente con MySQL real:** que los filtros (`none`, `isNot`, relaciones) devuelvan lo mismo en MySQL que en el intérprete de las pruebas, y los tiempos con volumen. No se ejecutó nada contra MySQL.
