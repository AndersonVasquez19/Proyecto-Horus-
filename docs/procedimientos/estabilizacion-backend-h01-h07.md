# Estabilización del backend: H-01 a H-07

Fecha: 2026-10-23. Base Git: `anderson`, `8869e2c789e9b213d5c08a7e4c49a7c648360dd3`.
Trabajo propio en `fix/backend-estabilizacion-h01-h05`, directorio
`C:\Users\PCT40T\Documents\Proyecto-Horus-estabilizacion-backend`.

La sección de verificación de este documento conserva la ejecución inicial y sus limitaciones de aquel momento.
La validación final, el inventario definitivo y el procedimiento de integración están en
[Validación final de H-01 a H-05](validacion-final-h01-h05.md).

> **Nota de integración (2026-10-23):** este parche se integró en `anderson` junto con la retirada de Sesiones y la
> incorporación de Horarios independientes ([horarios-ediciones.md](horarios-ediciones.md)). El módulo y la API de
> Sesiones ya no existen: las secciones H-06 y la fila «Conflicto horario de Sesiones» de H-07 describen el estado
> anterior y se conservan solo como registro histórico. Las tablas y su SQL histórico no se eliminaron. H-06 y H-07 no
> se implementan. El orden de bloqueo vigente es curso → edición (Horarios), compatible con el bloqueo de H-03.

Se copió como base de verificación la simplificación académica sin commit visible en el directorio original al comenzar,
incluido `common/pdf-format.ts`. Esa instantánea es trabajo previo de Claude: no forma parte de estas correcciones.
No se modificó el directorio original, su índice, rama ni stashes. No se integró trabajo de vuelta a `anderson`.

## Correcciones y compatibilidad

| Hallazgo | Causa | Corrección |
| --- | --- | --- |
| H-01 | Basic comprobaba contraseña y cuenta activa, pero no rol. | `common/security.ts`: cuenta con `activo === true` y rol de `permissions/roles.ts`: `GERENTE_GENERAL`, `COORDINADORA_INSTITUCIONAL` o `SECRETARIA`. Sin rol, rol desconocido, inactiva o credenciales incorrectas: 401. Se conserva HTTPS y la protección compartida de UI, recursos, JSON y YAML. No se modifica AccessGuard ni su matriz. |
| H-02 | Cada solicitud leía el contador antes de esperar la autenticación y sobrescribía el incremento de otras solicitudes. | Reserva síncrona de cuota; fallos más comprobaciones en vuelo no pueden superar cinco por IP/ventana de 60 segundos. Un éxito reinicia los fallos sin borrar reservas ajenas. Una respuesta tardía no revive un cubo vencido ni altera el actual. 429 y `Retry-After` conservados. |
| H-03 | Se validaba la combinación tipo/modalidad/duración antes de una escritura sin control del estado leído. | Para cursos y capacitaciones: transacción READ COMMITTED, `SELECT id FROM cursos WHERE id = ? FOR UPDATE`, lectura actual y comparación exacta de la fila con la instantánea validada. Si cambió: 409, sin escribir. Después de la comparación, el bloqueo protege la escritura hasta el commit. Sin migraciones. |
| H-04 | `take: 50` antes de filtrar ediciones abiertas llenas ocultaba candidatos posteriores. | Lecturas por cursor de hasta 50 candidatos; se conserva el orden fecha/id y se detiene al reunir 50 disponibles o agotar candidatos. Mismos filtros, conteo exclusivo de matrículas activas y respuesta `{ ok, items }`; el id interno del cursor no se expone. |
| H-05 | CORS no exponía `Content-Disposition`. | `exposedHeaders: ['Content-Disposition']`; mismos orígenes exactos, cabeceras permitidas y credenciales. |

H-03 protege la carrera entre la lectura inicial del servicio y su escritura. No incorpora una revisión enviada por React:
un formulario antiguo guardado después de finalizar otra petición todavía puede reemplazar campos que envíe expresamente.
El 409 es conservador: cualquier cambio de la fila durante la operación exige recargar y revisar.
No se usa solamente `updatedAt`: su precisión en este esquema es de segundos. Servicios y FAQ conservan su comportamiento.
Las escrituras SQL externas pueden saltarse reglas del servicio; no se afirma protección general frente a ellas.

H-02 sigue usando memoria por proceso: reinicios borran la cuota y varias réplicas tienen cuotas independientes.
La IP depende del `trust proxy` existente. No se incorpora Redis ni se cambia esa configuración.
El modo de desarrollo de Swagger conserva el acceso local existente; la autorización Basic afecta al modo protegido.

H-04 acota cada consulta y los resultados, pero puede recorrer todos los candidatos si casi ninguno tiene cupos.
No se afirma una instantánea transaccional entre lotes: cambios concurrentes de fechas/estados pueden alterar el recorrido.
El registro público vuelve a validar disponibilidad y cupos; aparecer en el listado no reserva una plaza.

## Nota para React

La descarga autorizada entre orígenes ya permite leer:

```ts
const disposition = response.headers.get('Content-Disposition');
const filename = /filename="([^"]+)"/i.exec(disposition ?? '')?.[1] ?? 'descarga';
```

Los reportes actuales emiten nombres ASCII con `filename="..."`. Usar un nombre alternativo y tratar siempre el nombre como
texto; si un endpoint incorpora `filename*` en el futuro, interpretar también esa variante. El token y los permisos de
exportación siguen siendo necesarios; exponer la cabecera no autoriza una descarga. Conservar el manejo de errores antes
de convertir la respuesta a Blob. Un 409 del catálogo exige recargar y revisar, sin reintento automático del mismo borrador.

## H-06: historial de sesiones (documentación, sin cambio de comportamiento)

`sesiones.history.ts` inserta en `academico_historial`, entidad `sesion`, dentro de la misma transacción que la escritura.
Guarda id de sesión, actor, rol del momento, operación, revisión, motivo y nombres de campos; no sus valores completos.
Creación, edición, reprogramación y cambio de estado son operaciones distintas. Una edición sin cambios efectivos no añade
historial. Reprogramar exige motivo y almacena anterior/nuevo como etiqueta de fecha y horas de Lima; los cambios de estado
guardan estados anterior/nuevo. La cancelación conserva sesión y motivo. Las tablas y relaciones históricas se conservan.

La API de sesiones ofrece listado, detalle, listado por edición y escrituras; no ofrece consulta de ese historial ni lo
incluye en el detalle. Por eso su existencia en persistencia no equivale a una funcionalidad de consulta disponible para
React. No hay valores anteriores/nuevos de todos los campos para reconstruir una versión completa. Una consulta futura
necesita decidir permisos, paginación y privacidad antes de añadir una ruta. No se modificaron Sesiones ni sus contratos.

## H-07: errores HTTP (documentación, sin normalización global)

Coexisten estos cuerpos; el estado HTTP es la referencia para decidir cómo actuar:

| Origen | Forma existente |
| --- | --- |
| Excepción Nest con cadena, incluido parte de Sesiones | `{ statusCode, message, error }` |
| ValidationPipe | `{ statusCode: 400, message: string[], error: 'Bad Request' }` |
| Excepción con objeto en catálogo, autenticación o AccessGuard | `{ ok: false, mensaje }` (el estado se transporta en HTTP) |
| Middleware de Swagger | `{ ok: false, mensaje }`, con challenge en 401 y `Retry-After` en 429 |
| Conflicto horario de Sesiones | `{ statusCode: 409, error: 'Conflict', codigo: 'CONFLICTO_HORARIO', conflictos, message }` |

No hay un filtro global propio que homogeneice esas formas. React debe admitir `mensaje`, `message` cadena o lista,
y mantener su alternativa segura para errores inesperados; no mostrar SQL, trazas ni mensajes internos.
401 indica autenticación ausente/inválida; 403, falta de permiso o HTTPS requerido por Swagger; 409, conflicto;
422 se conserva para reglas que ya lo usan; 429, cuota; 503, indisponibilidad traducida por cada módulo.
Unificar el cuerpo requeriría revisar consumidores y pruebas: queda expresamente fuera de esta implementación.

## Verificación y límites

Se reprodujeron siete fallos antes de corregirlos: dos del catálogo, dos del listado, uno de roles, uno de cuota y uno CORS.
La ejecución inicial de los tres archivos de regresión dio 14 aprobadas y 7 fallidas, sin errores de compilación.
Después, los siete archivos relacionados dieron 82 aprobadas y cero fallidas.

Resultado final: TypeScript (incluidos los tests) sin errores; `npm run build` con salida 0, generando Prisma 6.19.3
sin conexión a base de datos; `git diff --check` sin errores. La suite general terminó con **808 pruebas: 806 aprobadas,
2 fallidas, 0 omitidas/canceladas**. Repetir solo los dos archivos afectados dio **15 pruebas: 13 aprobadas y 2 fallidas**:

- `build-output.test.ts`, «production rebuilds preserve the running development modules»: `spawnSync ... ETIMEDOUT`
  en el build de la fixture, cuyo límite existente es 10 segundos. También falla al repetir sin otra compilación activa.
  No se amplió el timeout; la compilación normal del backend sí terminó correctamente.
- `cotizaciones-pdf.test.ts:201`, «Autorización: no existe restricción por registro…»: la expresión regular de inspección
  de código espera LF y devuelve `null` al leer `cotizaciones.service.ts` con CRLF. Comprobación aislada: hay CRLF,
  la expresión no coincide con el texto original y sí coincide al normalizar CRLF a LF en memoria. No es una denegación
  de autorización HTTP ni un fallo del renderizado; las otras 12 pruebas del PDF pasan. Los dos tests y el servicio
  inspeccionado coinciden con HEAD y no se modificaron. No se normalizaron archivos ajenos para ocultar el fallo.

La salida de la suite se conserva en `%TEMP%\horus-estabilizacion-suite.log`. El árbol final conserva seis archivos propios
modificados y tres nuevos, además de la instantánea académica inicial. Se verificaron por SHA-256 **371 archivos protegidos**
del backend y documentación, sin cambios inesperados. Los seis originales correspondientes en el directorio de Claude
siguen coincidiendo byte a byte con su copia inicial. Rama/HEAD originales permanecen en `anderson`/`8869e2c`.

Desde `backend/` se ejecutan:

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
$env:TS_NODE_TRANSPILE_ONLY = 'true'
node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/security-headers.test.ts test/catalogo-concurrency.test.ts test/preinscripciones-editions.test.ts test/catalogo.test.ts test/preinscripciones.test.ts test/institutional-fixes.test.ts test/original-content.test.ts
npm test
node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/build-output.test.ts test/cotizaciones-pdf.test.ts
Remove-Item Env:TS_NODE_TRANSPILE_ONLY
git diff --check
```

`TS_NODE_TRANSPILE_ONLY` evita repetir la comprobación completa de tipos en cada proceso de pruebas; la comprobación de tipos
se ejecuta por separado sin esa opción. No omitir `isolate-env.cjs`. Las pruebas HTTP usan Nest/Express y cuentas ficticias;
la persistencia del catálogo y preinscripciones se simula. No se conectó a MySQL, Docker, correo ni producción.
Se reutilizaron dependencias existentes copiadas al worktree; no se instalaron ni actualizaron paquetes.
El entorno disponible usa Node 24.19.0, mientras el proyecto requiere 22.x: repetir en Node 22 antes de integrar.

Pendiente, solo con autorización e infraestructura desechable: verificar dos conexiones MySQL independientes modificando
el mismo curso (tipo frente a limpieza y título frente a título), comprobar un éxito y un 409 y la fila final válida;
repetir con `updatedAt` dentro del mismo segundo. Verificar rollback ante fallo/slug duplicado, desaparición de fila y
orden de bloqueo frente a Ediciones/Matrículas/Sesiones. Para el listado, sembrar exclusivamente fixtures ficticias con
más de 50 ediciones llenas/disponibles, fechas nulas e iguales y matrículas activas/anuladas; comprobar límite y orden.
No dirigir estas pruebas a `horus_db`, `horus_local`, `horus_group` ni otra base habitual.

## Integración posterior, no ejecutada

No hacer un merge global de esta rama: el árbol incluye una instantánea ajena sin commit.
Aplicar únicamente el parche propio preparado para esta entrega, primero con `git apply --check`, desde un worktree de
integración actualizado de `anderson`. Si los archivos cambiaron, reconciliar manualmente con la versión de Claude.
El artefacto es `%TEMP%\horus-estabilizacion-h01-h05.patch`; se preparó sin stage/commit y se comprueba con
`git apply --reverse --check` contra el trabajo terminado. Aplicarlo posteriormente requiere revisar la base actual:

```powershell
git apply --check -- "$env:TEMP\horus-estabilizacion-h01-h05.patch"
git apply -- "$env:TEMP\horus-estabilizacion-h01-h05.patch"
```

El parche debe contener exclusivamente:

- `backend/src/common/security.ts`
- `backend/src/catalogo/catalogo.service.ts`
- `backend/src/preinscripciones/preinscripciones-public.service.ts`
- `backend/test/security-headers.test.ts`
- `backend/test/institutional-fixes.test.ts` y `backend/test/original-content.test.ts` (adaptación de dobles a la transacción)
- `backend/test/catalogo-concurrency.test.ts` y `backend/test/preinscripciones-editions.test.ts` (nuevos)
- Este documento (nuevo).

Los archivos propios no figuraban entre los modificados de Claude al iniciar. Puede haber conflictos posteriores en catálogo,
preinscripciones o configuración de seguridad; comparar la base antes de aplicar. Repetir tipos, suite, build,
`git diff --check` y, cuando esté autorizado, las verificaciones desechables anteriores. No se modificó GitHub Actions,
no se reactivó CI, no se hizo commit ni push ni despliegue.
