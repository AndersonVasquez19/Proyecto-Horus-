# Contrato React del backend consolidado

Referencia del backend publicado de `anderson`, commit `88b8bdb6e4d4320cbf8c4f63dd316d1cad8339f6`,
revisada el 23 de octubre de 2026.
No describe un despliegue: Railway/Vercel no se han validado ni activado. No se modificó React.

**Actualización 23/10/2026:** `horus_db` local ya tiene las 18 migraciones (Preinscripciones y Horarios) y `db:check`
pasa; el contrato se volvió a comprobar por HTTP real en un MySQL desechable (74 solicitudes) y en lectura sobre
`horus_db`. Cualquier otra base (Railway, `horus_local`) debe migrarse antes de usar Preinscripciones, Ediciones,
Matrículas y Horarios. Guía práctica, ejemplos y API central: [guía para React](guia-react-api-central.md).
Estado operativo y límites: [entrega](entrega-backend-20261023.md) y [activación](activacion-preinscripciones-horarios.md).

## Reglas comunes

- Todas las rutas siguientes llevan el prefijo `/api`. Las administrativas requieren `Authorization: Bearer <token>`.
- Obtener los permisos efectivos del login o `/admin/me`: `user.permisos`, `user.rol`, `acceso.modo = por_roles`.
  Una cuenta activa sin rol puede iniciar sesión, pero no obtiene acceso administrativo.
- Enviar JSON con números y booleanos reales. Los DTO rechazan campos ajenos; omitir un campo no equivale a enviar `null`.
- Solicitar `page=1&limit=20` explícitamente (máximo 100). Las listas académicas usan
  `{ ok: true, items: [...], pagination: { page, limit, total, pages } }`; sin resultados, `items: []` y `pages: 0`.
  Detalles y altas usan `{ ok: true, item: {...} }`, con ampliaciones indicadas abajo. POST normalmente responde 201;
  PUT/PATCH y GET, 200. No recorrer páginas automáticamente salvo exportación explícita.
- `fecha_inicio`/`fecha_fin` de las ediciones son `AAAA-MM-DD` o `null`. Conservar el día de calendario.
  `createdAt`, `updatedAt` y otros instantes no son campos de fecha de calendario.
- Los ejemplos de cuerpo muestran campos concretos; los esquemas de respuesta entre llaves son descriptivos, no JSON para enviar.

## Autenticación

| Método/ruta | Contrato |
| --- | --- |
| POST `/admin/login` | `{ email, password }` → 200 `{ ok, mensaje, token, user: { id, nombre, email, rol, permisos }, acceso: { modo: "por_roles" } }`. |
| GET `/admin/me` | Bearer → 200 `{ ok, user, acceso }`, sin emitir otro token; rol y permisos vigentes leídos del servidor. |
| POST `/admin/register` | Bearer y `cuentas:crear`; `{ nombre, email, password }` → 201 `{ ok, mensaje, user }`, sin token. |
| POST `/admin/signup` | Registro público existente; `{ nombre, email, password, website? }` → 201 `{ ok, mensaje }`, sin token ni rol administrativo. No activar ni ampliar este flujo como parte de la integración académica. |

Los correos se recortan y normalizan a minúsculas. La contraseña conserva sus espacios: 8–72 caracteres y máximo
72 bytes UTF-8. El nombre de registro admite hasta 100 caracteres; `website` es un campo trampa y debe quedar vacío.
No deducir permisos del JWT: el servidor vuelve a consultar la cuenta y comprueba su estado en cada solicitud.
Una respuesta 401 requiere renovar la sesión por el flujo de login; no hay endpoint de refresh ni logout en este controlador.
No incluir tokens en enlaces, descargas ni parámetros de URL.

## Permisos efectivos

G = Gerencia, C = Coordinación, S = Secretaría. La API vuelve a comprobarlos en cada operación.

| Recurso y operación | Permiso | Roles actuales |
| --- | --- | --- |
| Cursos: listar/detalle | `cursos:leer` | G, C, S |
| Cursos: crear/editar/archivar | `cursos:crear` / `editar` / `archivar` | G, C |
| Ediciones: listar/detalle/selectores/horarios GET | `convocatorias:leer` | G, C, S |
| Ediciones: crear | `convocatorias:crear` | G, C |
| Ediciones: editar/abrir/recepción/horarios PUT | `convocatorias:editar` | G, C |
| Ediciones: cerrar o archivar | `convocatorias:cerrar` / `archivar` | G, C |
| Estudiantes: listar/detalle/crear | `estudiantes:leer` / `crear` | G, C, S |
| Estudiantes: editar/archivar | `estudiantes:editar` / `archivar` | G, C |
| Matrículas: listar/detalle/selectores/historial/crear | `matriculas:leer` / `crear` | G, C, S |
| Matrículas: anular | `matriculas:anular` | G, C |
| Matrículas: confirmar cumplimiento | `matriculas:confirmar` | G, C |
| Matrículas: reactivar | `matriculas:anular` y `matriculas:editar` | G, C |
| Preinscripciones: listar/resumen/detalle/historial | `preinscripciones:leer` | G, C, S |
| Preinscripciones: corregir/validar/descartar/desistir | `preinscripciones:editar` | G, C, S |
| Preinscripciones: convertir | `preinscripciones:convertir` | G, C, S |

`preinscripciones:exportar` está reservado a G, pero **no existe un endpoint de exportación de preinscripciones**.
Tampoco existe un PUT genérico de Matrículas aunque la matriz conserve `matriculas:editar`.

## Cursos y capacitaciones

Mismo recurso `/admin/cursos`, separado por `tipo=curso|capacitacion`.

| Método/ruta | Entrada y salida |
| --- | --- |
| GET `/cursos`, `/cursos/:id` | Públicos; solo publicados. Lista paginada o `{ ok, item }`. |
| GET `/admin/cursos`, `/admin/cursos/:id` | Lista/detalle administrativos. Filtros: `page`, `limit`, `search`, `tipo`, `modalidad`, `estado`, `periodo` (`upcoming`, `past`, `unscheduled`). |
| POST `/admin/cursos` | Campos de creación abajo → `{ ok, item }`. |
| PUT `/admin/cursos/:id` | Solo campos modificados; para archivar, `{ "estado": "archivado" }` y permiso de archivar. |
| DELETE `/admin/cursos/:id` | Conservado por compatibilidad, requiere `cursos:eliminar` (G): 409 si existe y 404 si no existe. No ofrecerlo en la interfaz. |

Alta mínima de un curso:

```json
{"titulo":"Curso de ejemplo","slug":"curso-de-ejemplo","descripcion":"Contenido del curso","tipo":"curso","modalidad":"presencial","duracion":"20 horas"}
```

`modalidad` admite `presencial|virtual|hibrida`; modalidad y duración son obligatorias para cursos y opcionales para capacitaciones.
Opcionales: `temario`, `imagen_url`, `fecha_inicio`, `estado` (`borrador|publicado|archivado`), `area`, `certificacion`, `color`, `orden`, `icono`.
Para quitar opcionales usar `limpiar: ["imagen_url", "temario"]` (lista admitida en `UpdateCursoDto`);
no asignar y limpiar el mismo campo ni enviar `null`. No hay `revision` de catálogo enviada por el cliente.
H-03 detecta cambios de la fila durante la operación y responde 409; un formulario antiguo enviado después de finalizar
otro guardado aún puede reemplazar los campos que envíe. Mantener los gestores editoriales fuera del panel según la decisión vigente.

## Ediciones

Base `/admin/convocatorias`. Listado: `page`, `limit`, `search`, `curso_id`, `estado`, `archivo=activos|archivados|todos`.
Los items incluyen la edición, su `revision`, capacidad, datos de recepción y `curso: { id, titulo, tipo, estado }`.

| Método/sufijo | Cuerpo o finalidad |
| --- | --- |
| GET `/`, `/:id` | Lista y detalle. |
| GET `/cursos` | Selector paginado (`page`, `limit`, `search`), incluidos cursos no publicados. |
| POST `/` | `{ curso_id, nombre, fecha_inicio, fecha_fin, capacidad }`. |
| PUT `/:id` | `{ revision, nombre?, fecha_inicio?, fecha_fin?, capacidad? }`. Al menos un cambio; curso inmutable. |
| PUT `/:id/apertura` | `{ revision }`. Apertura explícita de una edición planificada. |
| PUT `/:id/preinscripcion` | `{ revision, estado: "abierta" o "cerrada" }`. Solo recepción; no abre académicamente. |
| PUT `/:id/cierre` | `{ revision, estado: "cerrada" o "cancelada" }`. |
| PUT `/:id/archivo` | `{ revision, archivado: true o false }`. |

Las escrituras devuelven `{ ok, item }` con la revisión resultante. No existe DELETE.
Altas: fechas válidas, fin no anterior al inicio y capacidad entera positiva. Las ediciones nuevas nacen planificadas,
con recepción cerrada y `minimo_apertura=10`: necesitan diez preinscripciones `validada|matriculada` y confirmación
de G/C para abrir. Llegar a diez no abre automáticamente. Ediciones antiguas con mínimo NULL mantienen su regla anterior.
Capacidad NULL bloquea altas/reactivaciones de matrículas; no interpretarla como capacidad ilimitada.

## Estudiantes

Base `/admin/estudiantes`. Lista: `page`, `limit`, `search`, `estado=activos|archivados|todos`.

| Método/sufijo | Cuerpo o finalidad |
| --- | --- |
| GET `/`, `/:id` | Lista y detalle. |
| POST `/` | `{ nombres, apellidos, doc_numero, email?, telefono? }`. |
| PUT `/:id` | `{ revision, nombres?, apellidos?, doc_numero?, email?, telefono? }`. |
| PUT `/:id/archivo` | `{ revision, archivado: true o false }`. |

DNI peruano de exactamente ocho dígitos, tratado como cadena para conservar ceros. El servidor fija `doc_pais=PE`,
`doc_tipo=DNI`; no enviar esos campos. Correo y teléfono opcionales se limpian con `""`; no enviar `null`.
Lista/detalle/escrituras conservan `{ ok, items, pagination }` o `{ ok, item }`. No hay DELETE.

## Matrículas

Base `/admin/matriculas`. Lista: `page`, `limit`, `search`, `curso_id`, `convocatoria_id`, `estudiante_id`, `estado=activa|anulada`.
Cada item incluye `revision`, `estado`, `cumplimiento`, `estudiante` y `convocatoria` con su curso y revisión.

| Método/sufijo | Cuerpo o finalidad |
| --- | --- |
| GET `/`, `/:id` | Lista y detalle. |
| GET `/ediciones` | Selector paginado (`curso_id?`, `search?`); devuelve `ocupados`, `disponibles`, capacidad y revisión. |
| GET `/:id/historial` | Historial paginado (`page`, `limit`). |
| POST `/` | `{ estudiante_id, convocatoria_id, convocatoria_revision }`. |
| PUT `/:id/anulacion` | `{ revision, motivo }`. |
| PUT `/:id/cumplimiento` | `{ revision, cumplimiento: "pendiente" o "cumplido" o "no_cumplido", motivo? }`. |
| PUT `/:id/reactivacion` | `{ revision, convocatoria_revision, motivo }`. |

Las escrituras devuelven `{ ok, item }`. Solo activas consumen cupo. Una pareja estudiante/edición no se duplica aunque
su matrícula esté anulada: usar reactivación con permisos. El motivo es obligatorio al corregir cumplimiento o volverlo
a pendiente. Un certificado histórico vigente bloquea anulación y cambio de cumplimiento (409).
No hay DELETE ni cambio de estudiante/edición de una matrícula existente.

## Preinscripciones

| Método/ruta | Entrada/salida |
| --- | --- |
| GET `/preinscripciones/convocatorias` | `{ ok, items: [{ codigo, nombre, apertura_confirmada, fecha_inicio, fecha_fin, curso: { titulo, tipo, modalidad, duracion } }] }`. Máximo 50 disponibles, orden fecha/id; sin paginación, ids internos, cupos ni datos personales. |
| POST `/preinscripciones` | `{ convocatoria, nombres, apellidos, email, telefono, consentimiento: true, website? }`. `convocatoria` es el código opaco de 32 caracteres hexadecimales. |
| POST `/chatbot/preinscripcion` | Mismo cuerpo más `confirmacion: true`. El servidor fija el canal. |
| GET `/admin/preinscripciones` | Lista paginada. Filtros `convocatoria_id`, `curso_id`, `estado`, `canal`, `search`. |
| GET `/admin/preinscripciones/resumen` | Paginado por edición; filtros `convocatoria_id`, `archivo`, `search`. Items con `convocatoria`, `conteo`, `apertura`, `cupos`. |
| GET `/admin/preinscripciones/:id` | `{ ok, item, matricula, estudiante, coincidencias }`. |
| GET `/admin/preinscripciones/:id/historial` | `{ ok, items, pagination }`; `page`, `limit`. |
| PATCH `/admin/preinscripciones/:id` | `{ revision, nombres?, apellidos?, email?, telefono? }` → `{ ok, item }` actualizado. |
| PUT `/admin/preinscripciones/:id/validacion` | `{ revision }` → `{ ok, item }` actualizado. |
| PUT `/admin/preinscripciones/:id/descarte` | `{ revision, motivo }` → `{ ok, item }` actualizado. |
| PUT `/admin/preinscripciones/:id/desistimiento` | `{ revision, motivo? }` → `{ ok, item }` actualizado. |
| POST `/admin/preinscripciones/:id/conversion` | `{ revision, doc_numero, estudiante_id? }` → `{ ok, item, matricula, estudiante_creado }`. |

Ambos POST públicos responden 201 con el mismo `{ "ok": true, "mensaje": "Recibimos tu preinscripción. El equipo de Horus la revisará." }`,
también ante un duplicado. No identifican a la persona ni devuelven una matrícula. DNI, pagos y comprobantes no forman parte del formulario.
Estados: `recibida|validada|matriculada|desistida|descartada`. La conversión exige validada, edición abierta, cupo e identidad revisada:
el DNI siempre es obligatorio; `estudiante_id` solo confirma al estudiante de ese DNI. Discrepancias devuelven 409 con
`codigo` (`DNI_NO_COINCIDE`, `IDENTIDAD_DISCREPANTE`, `POSIBLE_DUPLICADO`) y nombres de campos en `discrepancias`.
Corregir por las vías auditadas antes de repetir; no hay parámetro para forzar. Motivos sin datos personales.
Cuota pública compartida entre canales e instancias: 5/min por IP y 60/min global; respetar 429 y `Retry-After`.

## Horarios recurrentes

GET/PUT `/admin/convocatorias/:id/horarios`. Respuesta GET de ejemplo:

```json
{"ok":true,"convocatoria":{"id":7,"nombre":"Edición de ejemplo","estado":"abierta","archivada":false,"revision":4,"modificable":true},"zona_horaria":"America/Lima","items":[{"id":12,"dia_semana":1,"dia":"lunes","hora_inicio":"19:00","hora_fin":"21:00"}]}
```

Enviar el **conjunto completo**, sin ids de horarios:

```json
{"revision":4,"horarios":[{"dia_semana":1,"hora_inicio":"19:00","hora_fin":"21:00"},{"dia_semana":6,"hora_inicio":"09:00","hora_fin":"12:00"}]}
```

PUT devuelve la forma de GET más `cambios: true|false`. Un cambio efectivo incrementa en uno la revisión de la edición;
conjunto idéntico y revisión vigente: `cambios: false`, sin incrementar. `horarios: []` elimina el conjunto explícitamente.
Día ISO 1=lunes…7=domingo; máximo 21 tramos por edición, horas `HH:MM` en Lima, sin conversión UTC, fin posterior al inicio y sin cruzar medianoche.
Tramos contiguos se permiten; duplicados y solapamientos no. Cancelada/archivada bloquean edición (409);
una edición cerrada sí permite ajustar sus horarios. Véase el [contrato completo de Horarios](horarios-ediciones.md).

## Revisión y errores

Guardar la revisión de cada respuesta confirmada. Horarios y todas las acciones de la edición comparten `convocatoria.revision`;
estudiantes, matrículas y preinscripciones tienen la suya. Al crear/reactivar una matrícula, `convocatoria_revision` es la revisión
actual de su edición y `revision` (reactivación) es la de la matrícula. No incrementar revisiones localmente por suposición.

| HTTP | Tratamiento |
| --- | --- |
| 400 | Campos, tipos o formato inválidos; conservar borrador y señalar errores. |
| 401 | Sesión ausente/inválida: flujo central de autenticación. |
| 403 | Falta permiso; no cerrar la sesión. |
| 404 | Registro inexistente o edición pública no disponible. |
| 409 | Revisión obsoleta, cupo, identidad o transición bloqueada: conservar borrador, recargar y revisar; no reenviar automáticamente. |
| 422 | Regla de horario: `codigo=HORARIO_INVALIDO|HORARIO_DUPLICADO|HORARIO_SOLAPADO`; mostrar `message` y conflictos cuando existan. |
| 429 | Respetar `Retry-After`; evitar intentos en bucle. |
| 5xx, timeout/red | Aviso seguro, borrador conservado; una escritura puede tener resultado incierto. Comprobar antes de repetir. |

Coexisten `{ ok:false, mensaje }` y `{ statusCode, error, message }` con `message` cadena o lista; algunos añaden `codigo`.
El estado HTTP es la referencia. Reutilizar el lector de errores del panel; no mostrar trazas ni texto interno de un 500.
No se implementa una normalización global H-07.

## Descargas y rutas retiradas

Para reportes: GET `/admin/reportes`, `/admin/reportes/:tipo`, `/admin/reportes/:tipo/exportar?formato=csv|xlsx|pdf`.
Requieren `reportes_academicos:leer` o `exportar`; con datos personales, además `estudiantes:leer` o `exportar`.
Exportar está reservado a G en la matriz actual. Los seis tipos académicos son `estudiantes`, `ediciones`, `ocupacion`,
`matriculas`, `matriculas-por-edicion` y `resumen`. También existen seis reportes comerciales/de atención:
`cotizaciones-por-estado`, `cotizaciones-vencidas`, `cotizaciones-importes`, `consultas-por-estado`,
`consultas-abiertas-antiguas` y `actividad-comercial`, con permisos adicionales de su módulo.
Consumir los tipos y filtros admitidos del catálogo del servidor en vez de inventar opciones.

Consulta JSON: `page`, `limit` y filtros admitidos por cada tipo (`desde`, `hasta`, `curso_id`, `convocatoria_id`,
`estado`, `cumplimiento`, `archivo`, `agrupar`, `moneda`). Fechas `AAAA-MM-DD`; no enviar filtros que el reporte no admite (400).
Exportación: mismo filtro más `formato=csv|xlsx|pdf`; no enviar `page` ni `limit`. Solo CSV admite
`separador=punto_y_coma|coma`; por defecto usa `;` y BOM UTF-8. Máximo 20 000 filas CSV/XLSX o 3 000 PDF;
superar el límite o el rango de 3 660 días responde 422: acotar filtros. Dos exportaciones simultáneas por proceso;
una más responde 429. Estos 422 también existen, además de los conflictos de Horarios descritos arriba.

H-05 expone `Content-Disposition` al origen CORS autorizado. Verificar primero `response.ok`, tratar errores JSON,
después leer `response.headers.get('Content-Disposition')` y convertir el cuerpo exitoso en Blob. Los nombres actuales
usan `attachment; filename="..."`; usar un nombre alternativo y quitar separadores de rutas/caracteres de control.
Liberar el object URL al terminar. No escribir el Bearer en enlaces ni en la URL.

Retiradas: `/admin/sesiones*`, `/admin/convocatorias/:id/sesiones`, `/admin/docentes*`,
`/admin/asignaciones-docentes*`, `/admin/certificados*`; también sus herramientas del asistente y los reportes
`certificados` y `pendientes-certificacion`. No añadir pantallas ni permisos para ellas.
Se conserva provisionalmente GET `/certificados/verificar/:codigo` (público, solo lectura, con cuota) por QR históricos;
no usarlo como base de un nuevo módulo de emisión. Tablas y datos históricos se conservan.

## Restricciones de los DTO

| Campo/recurso | Restricción actual |
| --- | --- |
| Curso: `titulo`, `slug`, `descripcion`/`temario` | Máximos 160, 180 y 20 000 caracteres; slug con minúsculas, dígitos y guiones entre grupos. |
| Curso: `duracion`, `area`, `certificacion`, `imagen_url` | Máximos 120, 80, 150 y 2 048; imagen HTTP(S), upload gestionado o recurso original admitido por el DTO. |
| Edición: `nombre`, `capacidad` | Nombre no vacío, máximo 160; capacidad entera 1–2 147 483 647. |
| Estudiante/preinscripción: `nombres`, `apellidos`, `email`, `telefono` | Máximos 120, 120, 254 y 30. Obligatorios según el alta; en Estudiantes correo/teléfono son opcionales. |
| Teléfono | Al menos un dígito; admite `+`, paréntesis, espacios, punto y guion (`PHONE_PATTERN`). Sin una longitud mínima adicional. |
| Matrícula/preinscripción: `motivo` | No vacío cuando es requerido, máximo 300; los motivos de Preinscripciones rechazan datos personales. |
| IDs y revisiones | IDs enteros positivos hasta 2 147 483 647; revisiones de entrada 1–2 147 483 646. En JSON enviar números, sin comillas. |
| Listas académicas | `page` 1–1 000 000, `limit` 1–100, búsqueda máximo 100. |
| Horarios | Máximo 21 tramos; `dia_semana` entero 1–7 y horas `HH:MM` entre `00:00` y `23:59`. |

No imponer mínimos de texto ajenos a los DTO. Campos obligatorios no aceptan solo espacios; `null`, cadenas vacías y
omisión se manejan por recurso, según las reglas anteriores. Fuente de verdad: DTO y validación de servicio, también
para condiciones entre campos (fechas, modalidad, capacidad y motivos).

## Límites y referencias

Listar ediciones públicas no reserva cupos. H-04 puede recorrer todas las candidatas en lotes de 50 y no ofrece una
instantánea entre lotes; la recepción vuelve a comprobar disponibilidad. No hay matriculación automática ni pagos.
Swagger mantiene cuota por proceso: conservarlo deshabilitado públicamente hasta decidir producción.

Fuentes autoritativas: controladores/DTO/servicios de `backend/src/{catalogo,convocatorias,estudiantes,matriculas,preinscripciones,horarios}`,
`permissions/policy.ts` y `permissions/route-inventory.ts`. Detalles: [Ediciones](gestion-ediciones.md),
[Matrículas](gestion-matriculas.md), [Preinscripciones](gestion-preinscripciones.md) y [Reportes](reportes-academicos.md).
