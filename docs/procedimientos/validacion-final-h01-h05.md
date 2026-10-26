# Validación final de H-01 a H-05

2026-10-23 (America/Lima). Worktree `Proyecto-Horus-estabilizacion-backend`;
rama `fix/backend-estabilizacion-h01-h05`; HEAD/base `8869e2c`.
No se integran ramas, no se hace commit/push y no se modifica el directorio de Claude.

## Resultado de las correcciones

| Hallazgo | Comportamiento comprobado |
| --- | --- |
| H-01 | Swagger protegido exige contraseña correcta, cuenta activa y uno de los tres roles administrativos vigentes; rechaza sin rol y rol desconocido. Se prueban UI, JSON y YAML por HTTP. |
| H-02 | La cuota reserva intentos antes de autenticar: una ráfaga admite cinco verificaciones en vuelo; las demás reciben 429 con Retry-After. Los resultados tardíos no reactivan ventanas vencidas. |
| H-03 | Comparación completa de la instantánea bajo bloqueo de fila, dentro de READ COMMITTED. Resultado MySQL documentado abajo. |
| H-04 | El listado sigue buscando después de las primeras 50 candidatas llenas, conserva orden y devuelve hasta 50 disponibles sin exponer IDs internos. Pruebas con persistencia simulada. |
| H-05 | CORS expone Content-Disposition al origen permitido y conserva orígenes exactos, credenciales y restricciones existentes. |

## Node y pruebas

Node **22.23.3** ya estaba disponible en:
`C:\Users\PCT40T\AppData\Local\npm-cache\_npx\52027bd8fc0022aa\node_modules\node\bin\node.exe`.
Se antepuso esa carpeta a PATH únicamente en los procesos propios. No se cambian instalaciones globales,
dependencias, lockfiles ni el entorno del proceso de Claude.

- Tipos: `node node_modules/typescript/bin/tsc --noEmit --incremental false`, salida 0.
- Build: `npm run build`, salida 0; sin conexión a MySQL ni migraciones.
- Regresiones: los siete archivos indicados en el informe inicial, **82/82**, sin fallos ni omisiones.
- Suite general: **808/808**, salida 0, cero fallos, canceladas u omitidas (289,35 segundos).

Las pruebas TypeScript usan `TS_NODE_TRANSPILE_ONLY=true` después de comprobar tipos por separado;
se conserva siempre `-r ./test/isolate-env.cjs`. Los logs están en `backend/.validation-h01-h05/`.

## Los dos fallos generales

La fixture `build-output.test.ts`, sus cuatro archivos de configuración y el servicio de Cotizaciones
coinciden con HEAD; no son modificaciones de H-01 a H-05.

La fixture de compilación pasó con Node 22 en la primera repetición aislada (10,24 segundos para toda
la prueba, que ejecuta tres builds) y dentro de la suite completa (12,82 segundos). Una repetición posterior
con Node 24.19.0 también pasó, en 24,07 segundos; ambos tests del archivo quedaron aprobados.
Se mantienen los límites originales: 10 segundos por build y 30 segundos por prueba. El timeout previo
es una intermitencia de ejecución de una fixture preexistente, sensible al entorno/carga; no se reproduce
en estas ejecuciones ni puede atribuirse exclusivamente a Node 24. No se modifica producción ni el timeout.

La prueba de autorización de `cotizaciones-pdf.test.ts` falló de nuevo con Node 22 antes de corregirla:
su expresión regular esperaba LF y el archivo inspeccionado usa CRLF. Se permite `\r?\n` en ambos
saltos, conservando las mismas comprobaciones sobre el método `pdf`. Es un defecto preexistente de
portabilidad de la prueba, no un fallo de autorización ni una regresión del servicio. Cambio de una línea;
no se normalizan archivos completos ni se modifica código de producción de Cotizaciones.

## MySQL H-03: aislamiento y alcance

Runner nuevo: `backend/test/run-catalogo-isolated.cjs`, separado del runner académico compartido.
Antes de ejecutarlo se verificó que:

1. Solo utiliza la imagen local `mysql:8.4`; no descarga imágenes ni inicia Compose.
2. Crea un nombre aleatorio `horus-h03-<hex>`,
   con etiqueta `horus.test=h03`, contraseña aleatoria y volumen anónimo nuevo, sin montajes del host.
3. Publica únicamente MySQL en `127.0.0.1` con puerto asignado por Docker; comprueba HostIp en inspect.
4. No lee `.env` y pasa al hijo un entorno cerrado con credenciales ficticias generadas para ese contenedor.
5. Compara el UUID por conexión TCP con el obtenido mediante `docker exec` en el ID recién creado.
6. La prueba comprueba UUID, MySQL 8.4, antigüedad menor a cinco minutos y ausencia de bases de usuario
   antes de crear `horus_h03_<hex>`. Aplica solo las dos sentencias versionadas que definen `cursos`.
7. El cierre valida ID, nombre, etiqueta y montajes; elimina exclusivamente ese ID con su volumen anónimo.
   No ejecuta DROP ni retira contenedores o volúmenes preexistentes.

La prueba usa el controlador administrativo real, ValidationPipe, CatalogoService compilado y dos clientes
Prisma/adaptadores reales contra MySQL. Solo retiene las lecturas iniciales para reproducir la carrera;
las transacciones, bloqueos, relecturas y escrituras son reales. La autenticación está sustituida en un
módulo Nest de prueba: esto no constituye evidencia de JWT, permisos ni AppModule completo.

Casos: seis carreras de cambio de tipo frente a limpieza de modalidad/duración (200/409 y fila coherente),
dos títulos concurrentes con updatedAt idéntico y conflicto de slug con rollback completo seguido de
una escritura válida. El reloj JS se fija solo dentro del caso de igualdad de updatedAt y se restaura en finally.

Resultado final: **4/4 pruebas aprobadas** (tres subpruebas y su contenedora), cero fallos/omisiones,
salida 0. Se verificaron seis carreras de campos relacionados, el 409 con updatedAt idéntico,
la integridad final y el rollback completo por slug duplicado. Destino final: `127.0.0.1:58618`,
MySQL 8.4, UUID `fbee9fff-cf0a-11f1-bb81-4ee23ac19a8e`, contenedor
`horus-h03-5b22ba8ece503b3b4e07d832`. Contenedor y volumen retirados al terminar.

Las dos ejecuciones iniciales de la fixture fallaron con 500: Nest seguía instanciando el guard
del controlador y faltaba una estrategia Passport `jwt`. La segunda ejecución habilitó diagnóstico
y confirmó `Unknown authentication strategy "jwt"`. Se corrigió exclusivamente la fixture registrando
una estrategia ficticia en su proceso. No se cambió producción para corregir el montaje de pruebas.
Los tres contenedores propios se retiraron con sus volúmenes; se conservan los logs de fallo y el log final.

## Inventario exclusivo para el parche

| Archivo | Cambio propio |
| --- | --- |
| `backend/src/common/security.ts` | H-01, H-02 y H-05 |
| `backend/src/catalogo/catalogo.service.ts` | H-03 |
| `backend/src/preinscripciones/preinscripciones-public.service.ts` | H-04 |
| `backend/test/security-headers.test.ts` | Regresiones de roles, concurrencia de cuota y CORS |
| `backend/test/institutional-fixes.test.ts` | Adaptación del doble a la transacción de Catálogo |
| `backend/test/original-content.test.ts` | Adaptación del doble a la transacción de Catálogo |
| `backend/test/cotizaciones-pdf.test.ts` | Corrección portátil LF/CRLF |
| `backend/test/catalogo-concurrency.test.ts` (nuevo) | Regresiones aisladas de H-03 |
| `backend/test/preinscripciones-editions.test.ts` (nuevo) | Regresiones aisladas de H-04 |
| `backend/test/catalogo-concurrency.integration.cjs` (nuevo) | HTTP, Prisma y MySQL real para H-03 |
| `backend/test/run-catalogo-isolated.cjs` (nuevo) | Contenedor propio, identidad y limpieza controlada |
| `docs/procedimientos/estabilizacion-backend-h01-h07.md` (nuevo) | Informe inicial, límites y referencia a este cierre |
| `docs/procedimientos/validacion-final-h01-h05.md` (nuevo) | Este informe final |

Son **7 archivos existentes y 6 nuevos**, sin migraciones, React ni GitHub Actions.
El árbol también conserva la instantánea académica previa de Claude: no debe incluirse en el parche ni
atribuirse a H-01 a H-05. Los seis archivos originales de las correcciones coinciden con HEAD en su copia
base, normalizando únicamente saltos de línea para la comparación. Se comprobaron por SHA-256 otros
**370 archivos existentes** del backend/documentación frente al inventario inicial, sin diferencias inesperadas.

Artefacto: `backend/.validation-h01-h05/horus-estabilizacion-h01-h05.patch` dentro de este worktree.
El parche y los logs son artefactos de entrega, no código para integrar. El parche se genera solo con
el inventario anterior y se verifica inversamente contra este worktree; no incluye la simplificación académica.

## Integración posterior con Claude (no ejecutada)

> **Actualización (2026-10-23):** la integración se ejecutó después sobre `anderson`, sin stage ni commit, aplicando
> este parche completo tras `git apply --check` sin conflictos. Sesiones quedó retirada y la sustituye Horarios; las
> menciones a Sesiones de este documento describen el estado previo.

No hacer merge global ni aplicar nada sobre `anderson`. Cuando Claude termine, crear un worktree de
integración separado con la versión acordada de su trabajo y preservar cualquier cambio sin commit.
Comparar primero los archivos del inventario con la base y revisar sus nuevas reglas de bloqueo.

No hay solapamiento directo con archivos de Sesiones/Horarios en este parche. Los posibles puntos de
conflicto son `catalogo.service.ts` (bloqueo inicial del curso), `preinscripciones-public.service.ts`
(disponibilidad y contrato público), `common/security.ts` (configuración HTTP compartida), los dobles de
Catálogo de `institutional-fixes.test.ts`/`original-content.test.ts` y pruebas de seguridad/Cotizaciones
si Claude también las modifica. Es un análisis de superficies compartidas, no una afirmación de conflictos
actuales: no se inspeccionó ni modificó su trabajo en curso.

Orden lógico de revisión/aplicación: (1) seguridad H-01/H-02/H-05 y su prueba; (2) Catálogo H-03, dobles y
regresiones/MySQL; (3) listado H-04 y su prueba; (4) ajuste LF/CRLF; (5) documentación. El artefacto es un
único parche: comprobarlo y aplicarlo completo en el worktree de integración evita estados intermedios.
Si falla la comprobación, reconciliar manualmente; no usar `--reject` para dejar una integración parcial.

```powershell
# Solo en el futuro worktree de integración, nunca en anderson ni en el directorio de Claude.
$parcheHorus = 'C:\Users\PCT40T\Documents\Proyecto-Horus-estabilizacion-backend\backend\.validation-h01-h05\horus-estabilizacion-h01-h05.patch'
git apply --check -- $parcheHorus
git apply -- $parcheHorus
```

Tras integrar, bajo Node 22 y desde backend: tipos, `npm run build`, los siete archivos de regresión,
los dos archivos de fallos generales y `npm test` con isolate-env. Después `node test/run-catalogo-isolated.cjs`
(requiere autorización vigente para su contenedor propio) y las pruebas aisladas de Horarios que entregue
Claude. Revisar especialmente orden de bloqueo curso → recursos académicos y contratos de disponibilidad.
Terminar con `git diff --check` y revisión del inventario. La validación actual no certifica la combinación futura.

## Límites de Swagger, React y Git

Swagger protegido conserva HTTPS y los tres roles administrativos. La cuota es memoria por proceso:
no se comparte entre réplicas y se borra al reiniciar; la IP depende del trust proxy ya configurado.
Las peticiones sin Basic válido no disparan una comprobación bcrypt y conservan el comportamiento existente.
El modo de desarrollo mantiene el acceso local. No se probó un navegador Swagger ni un proxy/despliegue real,
ni se auditó/completó el esquema OpenAPI de todos los módulos. Estos cambios no filtran el documento por rol
ni conceden acceso a los endpoints de la API.

React no cambia. Debe conservar errores antes de generar Blob, leer Content-Disposition con nombre alternativo
y recargar/revisar ante 409 del Catálogo, sin reintentar automáticamente el borrador. H-03 detecta cambios durante
la operación: un formulario abierto que se envía después de otra operación completada todavía puede sobrescribir
campos explícitos porque no envía una revisión. H-04 no es una instantánea entre lotes y listar no reserva cupo.

No se valida H-04 contra MySQL ni se afirma haber probado todas las interacciones de bloqueo con los futuros
Horarios. Se conservan estos límites, sin ampliar el alcance ni tocar bases habituales, Railway o Vercel.

Git permanece en `fix/backend-estabilizacion-h01-h05`, HEAD `8869e2c`, sin cambios en el índice,
sin commits ni pushes. El árbol conserva tanto los cambios propios inventariados como la instantánea
académica previa; no se debe tratar todo `git status` como trabajo de esta entrega. El parche queda
sin seguimiento dentro de `.validation-h01-h05/`; los logs están ignorados por la regla existente `*.log`.
`git diff --check`, comprobación de sintaxis de los dos CJS nuevos y comprobación inversa del parche
terminan sin errores. La comparación del inventario Docker conserva todos los IDs preexistentes;
no queda ningún contenedor con etiqueta `horus.test=h03`.
