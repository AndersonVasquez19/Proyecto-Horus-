# Entrega del backend consolidado

## Cierre documental definitivo local (23/10/2026)

La **etapa B de separación MySQL está ejecutada y verificada**: NestJS utiliza `horus_app`@`localhost` y
`horus_migrator`@`localhost` queda reservado para mantenimiento explícito. Privilegios efectivos y resultados
en [el cierre de cuentas MySQL](privilegios-mysql-propuesta.md): 29/29 sondas SQL, 21/21 y 20/20 comprobaciones
HTTP, arranque normal con 7/7 respuestas esperadas, `db:check` y respaldo verificado. La guía React se revisó y
conserva los contratos vigentes. Este cierre solo modifica documentación; no repite operaciones contra MySQL.

Siguen pendientes de infraestructura la protección de credenciales (transferencia al gestor del responsable,
conservando intacto el archivo privado hasta entonces), los respaldos cifrados y la revisión de firewall/escucha.
Railway/Vercel y otras bases no quedan validados por el cierre local. Las secciones siguientes son evidencia
histórica de las operaciones anteriores: sus pendientes de activación y separación no describen el estado local actual.

## Cierre: activación local y entrega para React (23/10/2026, tarde)

Rama `anderson`, base `6f9e233` (código de aplicación igual a `88b8bdb`). Autorizadas: las dos migraciones sobre
`horus_db` y commits locales. No autorizados y no realizados: cambios de cuentas/privilegios MySQL, edición de `.env`,
push, despliegues, React, `main` y CI. **No se modificó código de producción.**

| Área | Estado |
| --- | --- |
| `horus_db` | **Activada**: 18 migraciones, 30 tablas, `db:check` 0, datos originales intactos, 22 FK sin huérfanos. Detalle en [activación](activacion-preinscripciones-horarios.md). |
| API sobre `horus_db` | Arranque del AppModule compilado en 6,7 s con `PublicRateLimitGuard` y `AccessGuard`; 14 lecturas correctas (health, públicas, 401 sin token, retiradas 404, Swagger 404) y **0 tablas modificadas**. |
| Cuentas y roles | Comprobado por HTTP real en MySQL desechable (ver abajo). `horus_db` ya tiene **un gerente activo**: no requiere inicialización. |
| Privilegios MySQL | **Cerrado después en la etapa B del 23/10/2026**: API con `horus_app`, mantenimiento con `horus_migrator`; ver [privilegios efectivos](privilegios-mysql-propuesta.md). |
| Guía React y API central | [Guía para React y API central](guia-react-api-central.md); contrato completo en [contrato React](contrato-react-backend-consolidado.md). |
| Railway/Vercel | Preparado y documentado, **no desplegado**. Producción no está lista. |

### Ensayo funcional HTTP (MySQL 8.0.46 desechable)

Servidor propio con UUID distinto de `horus_db`. Se restauró el respaldo posterior a la activación y coincidió
exactamente con `horus_db`. El flujo funcional usó una **base nueva** (`db:init` → `db:migrate` → `db:check`: 18
migraciones, 30 tablas, cero cuentas creadas automáticamente) y una cuenta de aplicación con la matriz mínima de 27
tablas (denegaciones 1142 de DDL, `horus_migrations`, escritura de certificados y borrado de auditoría).
**74/74 solicitudes con el estado esperado**, personas y credenciales ficticias:

- Registro público sin rol (201); campo `rol` en el registro rechazado (400); login sin rol con `permisos: []`; 403 en rutas administrativas.
- Primer gerente por terminal: `admin:assign-role --listar`, simulación y `--apply` con destino y `server_uuid`;
  la sesión anterior pasa a 401 y el nuevo login trae `GERENTE_GENERAL`. Un segundo gerente sin
  `--permitir-otro-gerente` se rechaza. Sobre la copia de `horus_db` la simulación se negó porque ya existe un gerente.
- «Roles y usuarios»: lista sin contraseñas; `rol_actual` obsoleto 409; rol inválido 400; asignación de `SECRETARIA`
  con revocación (401) y permisos nuevos tras el login; la secretaria recibe 403 en `/admin/users`, al intentar
  hacerse gerente y al crear cursos; el gerente no puede cambiar su propio rol ni desactivarse (409); desactivar
  impide el login y reactivar deja la cuenta sin rol. Auditoría: altas, activación, desactivación y roles (panel y terminal).
- Académico: curso, edición nueva (`planificada`, recepción cerrada, mínimo 10), Horarios (cambio, idempotencia
  `cambios:false`, 409 por revisión, 422 `HORARIO_SOLAPADO`), recepción, apertura sin mínimo 409, ediciones públicas
  sin ids, preinscripción web y chatbot, validación e historial, estudiante (409 por revisión), matrícula en edición
  planificada 409, selectores y listas.
- Reportes JSON y exportación CSV/XLSX/PDF con `Content-Disposition: attachment; filename="…"` y
  `Access-Control-Expose-Headers: Content-Disposition`; 403 sin rol; cotizaciones; verificación pública de certificado
  inexistente 404; rutas retiradas 404; Swagger 404; CORS permite el origen local y no un origen ajeno.

Este ensayo no prueba correo real, OpenAI, navegador, React, proxy ni Railway/Vercel.

### Validación de este cierre (Node 22.23.3)

| Comprobación | Resultado |
| --- | --- |
| `tsc --noEmit --incremental false` | Salida 0. |
| `npm run build` | Salida 0. |
| AccessGuard HTTP, MySQL 8.0.46 desechable | **28/28** al primer intento; sin el timeout de arranque observado antes. |
| Horarios, MySQL 8.0.46 desechable | **14/14**. |
| Preinscripciones, MySQL 8.0.46 desechable | **27/27**. |
| Ensayo funcional HTTP (base nueva, cuenta mínima) | **74/74**. |
| Lecturas sobre `horus_db` activada | **14/14**, 0 tablas modificadas. |
| `db:check` en `horus_db` y en el ensayo | Salida 0. |
| `npm test` (suite unitaria completa, `isolate-env.cjs`) | **804/804**, sin fallos, cancelaciones ni omisiones (535 s; más lento que los 159 s anteriores, sin fallos asociados). |

Las suites de integración no se modificaron ni se ampliaron sus timeouts. E3.6 no se reprodujo en esta sesión;
su causa sigue sin demostrarse y se mantiene documentada como posible intermitencia.
Evidencia privada: `%USERPROFILE%\.horus-respaldos\activacion-real-20261023-ad9bf238\`.

## Misión final: preparación de activación y separación de privilegios

23 de octubre de 2026, America/Lima. Esta sección registra la nueva operación sobre el backend publicado
`88b8bdb6e4d4320cbf8c4f63dd316d1cad8339f6`. Se confirmó por `git ls-remote` su coincidencia con
`origin/anderson`; el árbol inicial estaba limpio. No se modifica código de aplicación, React, configuración real
ni CI. La autorización de publicación del registro histórico inferior **no se reutiliza para esta misión**.
El encargo actual permite preparar el commit local documental; no se hace push ni despliegue.

| Área | Estado de esta misión |
| --- | --- |
| Desarrollo backend | Código consolidado y publicado en el commit anterior; sin nuevas funcionalidades. |
| Activación MySQL local | **Pendiente de aprobación separada (etapa C)**. `horus_db` conserva 16 migraciones. |
| Privilegios MySQL | Separación ensayada en un clon 8.0.46; **sin cambios de cuentas o secretos reales**. Transición pendiente de etapa D. |
| Integración React | Responsabilidad del compañero; sin modificaciones. |
| Despliegue | Responsabilidad del compañero; sin ejecución ni reactivación de CI automática. |

### Destino, respaldo y recuperación

Identidad comprobada: `127.0.0.1:3306/horus_db`, MySQL **8.0.46**, UUID
`dc5bb32a-a7b2-11f1-913f-14b5cd19372a`, **27 tablas InnoDB y 148 filas**.
Las 16 migraciones registradas coinciden con las primeras 16 de la secuencia vigente. Faltan exclusivamente:

1. `20261020-preinscripciones`.
2. `20261023-convocatoria-horarios`.

Sesiones sigue retirada y no se aplicará; se conservan Docentes, Certificados y sus datos históricos.
`db:check` del origen devuelve 1 solo por las estructuras pendientes. La comprobación de integridad del origen
verificó **17 claves foráneas sin huérfanos**.

El respaldo nuevo del **23/10/2026 a las 15:28** contiene esquema y las 148 filas, incluidas las cuotas efímeras.
Se verificaron firma SHA-256, manifiesto y sentencias; la restauración en otro MySQL **8.0.46** desechable
recuperó exactamente **27 tablas, 148 filas y 16 migraciones**, con huellas idénticas por tabla e integridad referencial.
Su archivo, firma completa, ACL y comandos están en [Activación y recuperación](activacion-preinscripciones-horarios.md).

En el clon, la cuenta restringida de mantenimiento aplicó ambas migraciones, alcanzó **18 migraciones y 30 tablas**,
pasó `db:check`, conservó los datos originales y repitió la migración sin cambios. Una cuenta con solo SELECT
respaldó el clon actualizado; su restauración también coincidió exactamente. No se usa el servidor real para pruebas.
Los servidores nativos propios se detienen al finalizar; no se eliminan recursos Docker ni worktrees antiguos.

Una lectura posterior confirmó las mismas 148 filas y el mismo DDL del origen, además del hash inalterado de
`backend/.env`. La muestra no tenía otras conexiones a `horus_db`; **no acredita una ventana futura sin escritores**.
Antes de una activación aprobada deben repetirse identidad y huellas; si cambiaron los datos, repetir respaldo y restauración.

**Activación real: sin fecha, no ejecutada.** MySQL DDL tiene commits implícitos: ante fallo parcial, mantener
detenidos los escritores, conservar evidencia e inspeccionar el esquema. No reintentar a ciegas, editar migraciones
históricas ni restaurar encima del origen. La recuperación comprobada restaura en una base aislada nueva;
una reparación o cambio de destino real requiere otra autorización.

### Comprobaciones de esta misión

Se usó **Node 22.23.3** instalado en caché, sin instalar dependencias ni cambiar lockfiles. Node 24 permanece
como versión predeterminada del shell; Node 22 se selecciona únicamente en los procesos propios.

| Comprobación | Resultado nuevo |
| --- | --- |
| TypeScript, `tsc --noEmit --incremental false` | Salida 0. |
| `npm run build` | Salida 0; sin migraciones de la base real. |
| Cotizaciones PDF, prueba aislada con `isolate-env.cjs` | **14/14**, sin fallos ni omisiones. |
| API con cuenta MySQL sin DDL, clon 8.0.46 | **48/48 comprobaciones HTTP sin instrumentación**, después de otra pasada instrumentada 48/48; AppModule y guards reales. |
| SQL de cuentas restringidas | Migración y repetición, check/backup SELECT, restauración exacta y **14 denegaciones** aprobadas. Matriz de aplicación limitada a las operaciones usadas en cada una de 27 tablas. |
| AccessGuard, suite existente 8.0.46 | Primer intento: **timeout de arranque**. Repetición aislada: **28/28**, cero fallos u omisiones; sin cambiar el límite de 60 s. |
| Horarios, suite existente 8.0.46 | **14/14**, cero fallos, cancelaciones u omisiones. |
| Preinscripciones, suite existente 8.0.46 | **27/27**, cero fallos, cancelaciones u omisiones. |

El ensayo HTTP comprende login/JWT, 401/403, CRUD, catálogo, Cursos, Ediciones, Horarios, Estudiantes, Matrículas,
ambos canales de Preinscripciones, reportes JSON/CSV/XLSX/PDF, verificación pública de certificado ficticio y su
bloqueo histórico de matrícula. Comprueba revisión obsoleta, apertura sin mínimo y duplicados (409), solapamiento
(422), rutas retiradas 404 y Swagger deshabilitado. Usa personas y credenciales ficticias solo en el clon; no envía
correo ni invoca OpenAI. Las escrituras de prueba nunca apuntan a `horus_db`.

Las **804/804 unitarias**, 82 regresiones H-01 a H-05 y las otras pasadas de la consolidación inferior son
**evidencia histórica**; no presentar sus cifras como una repetición completa de esta misión.

La lectura final de las **16:01 (America/Lima)** volvió a comprobar DDL, las 148 filas, las 16 migraciones,
las 17 claves foráneas sin huérfanos y `.env` sin cambios. No había otras conexiones en esa muestra.
Se confirmó después que no quedaba ningún proceso MySQL de los servidores creados por esta misión.
El cierre local solo comprende estos cuatro procedimientos. Se revisan diff, finales CRLF y ausencia de secretos,
y se exige `git diff --check` antes del commit. Los dos stashes históricos permanecen intactos.

### Seguridad, incidencias y límites

- La cuenta habitual mantiene privilegios administrativos globales y `GRANT OPTION`; **la aplicación real todavía
  no usa una cuenta mínima**. MySQL escucha en `*`; no se comprobó acceso exterior ni firewall, ni se cambió su escucha.
- La propuesta separa aplicación y mantenimiento por proceso. Una cuenta real adicional de respaldo es opcional;
  solo se justifica si se necesita automatización de lectura. Plantillas, pruebas y reversión en
  [Privilegios MySQL](privilegios-mysql-propuesta.md). No revocar la credencial anterior antes de revisar sus consumidores.
  La matriz final retira UPDATE/DELETE de historiales e importaciones y DELETE de entidades conservadas;
  su repetición HTTP sin instrumentación también pasó **48/48**. Se conserva DELETE para la retención oportunista del chatbot.
- En el arnés privado se reprodujo autenticación 1045 por heredar la clave RSA de otra instancia; se corrigió la
  variable del proceso de ensayo. Se normalizó además la clave pública del clon a PEM antes de pasarla al entorno.
  No se modificaron credenciales reales ni código de producción por estas incidencias del arnés.
- El primer arranque del ensayo HTTP excedió 30 s y el primer AccessGuard existente excedió su espera de 60 s.
  El arranque instrumentado posterior completó importación, conexión y SELECT en unos 16,4 s y aprobó sus peticiones.
  **No demuestra la causa de los timeouts anteriores**. Se conservan sus fallos; no se aumentan timeouts ni se desactivan guards.
- Los respaldos están fuera del repositorio, con ACL de operador/SYSTEM. No se ha acreditado cifrado ni copia externa.
  El respaldo de base no sustituye al respaldo separado de archivos subidos.
- La verificación pública histórica de Certificados sigue provisional hasta comprobar sus QR en todos los entornos.
  Swagger conserva cuota por proceso y debe permanecer deshabilitado públicamente.

La evidencia privada nueva está en `%USERPROFILE%\.horus-respaldos\mision-final-20261023-a6421ba2\`.
No se incluyen allí secretos reales nuevos ni se publican sus respaldos, logs o datos personales en Git.
Las aprobaciones pendientes son independientes: primero migraciones sobre el UUID/base indicados y, después de
verificarlas, creación de cuentas y cambio de secretos/configuración real. Una aprobación no autoriza la otra.

## Registro de la consolidación y publicación anteriores

23 de octubre de 2026, America/Lima. Rama `anderson`, base `8869e2c789e9b213d5c08a7e4c49a7c648360dd3`.
La solicitud de esta operación autoriza commits y push normal a `origin/anderson`; mantiene prohibidas la activación
real de MySQL, los cambios de cuentas/privilegios, React, Actions y los despliegues.
Esta autorización sustituye la falta de autorización Git indicada en el [cierre técnico anterior](cierre-backend-20261023.md).

## Resultado y alcance

Código consolidado: simplificación académica, Horarios independientes y correcciones H-01 a H-05 previamente integradas.
Se conservan los datos/modelos históricos de Docentes y Certificados, el bloqueo de matrículas con certificado vigente
y la verificación pública histórica. Sesiones queda retirada, con su SQL histórico conservado. No se reaplica el parche antiguo.

La única corrección nueva de código es del **lector PDF de pruebas**, sin cambios del generador de producción:
una expresión regular retiraba un byte comprimido `0x0d` cuando confundía ese byte con el delimitador LF anterior a
`endstream`. La prueba perdía el texto de una página y denunciaba una cabecera ausente. La primera suite dio
802/803 y la repetición aislada 13/13; el arnés privado reprodujo el defecto con fecha fija, comprobando que reponer
el CR permitía descomprimir el flujo. Una nueva regresión falló antes de corregir el lector; ahora lee la longitud
`/Length` declarada por pdfkit y aprueba con delimitadores LF y CRLF. No se relajan comprobaciones ni timeouts.

Documentación completada: autenticación, DTO, reportes/exportaciones, nombres de descarga, revisión y errores para React;
activación de las dos migraciones y recuperación ante DDL parcial; separación de cuentas, acceso y rotación MySQL.
Se corrigió además una nota histórica de CI que todavía hablaba de Sesiones activa y de Horarios sin ejecutar.
No se modificó `.github/workflows/ci.yml`.

## Validación

Node **22.23.3** ya instalado en caché; se antepuso a PATH solo en los procesos propios. Sin instalaciones ni cambios
de dependencias/lockfiles. Las pruebas mantienen `test/isolate-env.cjs`; `TS_NODE_TRANSPILE_ONLY=true` se usa después
de comprobar los tipos de aplicación y tests por separado.

| Comprobación | Evidencia |
| --- | --- |
| TypeScript, `tsc --noEmit --incremental false` | Ejecutado, salida 0; repetido tras la corrección del test. |
| `npm run build` | Ejecutado, salida 0; Prisma 6.19.3 generado, sin migrar/conectar MySQL. |
| `npm test`, suite final | **804/804**, cero fallos/omisiones/cancelaciones; 158,74 s. |
| Cotizaciones PDF, archivo aislado después de corregir | **14/14**, cero fallos/omisiones/cancelaciones. |
| H-01 a H-05, siete archivos de regresión | Evidencia anterior íntegra **82/82**, también incluidos en la suite final. |
| Horarios, MySQL 8.4 y 8.0.46 | Evidencia anterior íntegra **14/14 en cada versión**. |
| Preinscripciones, MySQL 8.4 y 8.0.46 | Evidencia anterior íntegra **27/27 en cada versión**, incluye H-04 por HTTP real. |
| AccessGuard, MySQL 8.4 | Evidencia anterior íntegra **28/28**. |
| Ciclo E3.6 sin base, dos ejecuciones aisladas | Evidencia anterior íntegra **7/7 en cada ejecución**; no se reproduce el timeout histórico. |
| Restauración/migración en clon 8.0.46 | Evidencia anterior íntegra: 18 migraciones, esquema compatible, datos originales conservados, repetición idempotente y roundtrip de backup. |
| Inventario, secretos, índice y whitespace | Revisión de rutas previstas, comparación SHA-256 y `git diff --check`/`--cached --check` sin errores. |

Se verificaron por SHA-256 los **66 artefactos** del cierre anterior. De las 106 rutas de su instantánea inicial,
solo Preinscripciones integración tenía el cambio H-04 posterior, que está cubierto por aquellos logs finales.
El resto del código de producción coincide; la reparación nueva modifica exclusivamente un test.
Por ello no se repiten integraciones costosas que no recibieron cambios relevantes. No se suman suites solapadas.
H-03 conserva su evidencia anterior 4/4 en MySQL 8.4, descrita en [Validación H-01 a H-05](validacion-final-h01-h05.md).
No se ejecutan nuevas integraciones independientes de Estudiantes, Ediciones, Matrículas o Reportes: se conserva
la evidencia previa y la cobertura de compatibilidad de Preinscripciones. No hay validación nueva de React, navegador,
correo real, OpenAI, proxy ni producción.

E3.6 conserva el límite de 60 s y la implementación. Las repeticiones documentadas explican unos 30 s de espera
del adaptador/pool, pero **no demuestran la causa del exceso histórico de 60 s**. Si reaparece, capturar tiempos
de importación, conexión, SELECT y salida. Swagger mantiene cuota por proceso; conservarlo deshabilitado públicamente.
H-06/H-07 y una herramienta de Horarios para el asistente quedan fuera del alcance.

## Commits y publicación

| Commit | Contenido |
| --- | --- |
| `8e9ed2ecf2e1a5c2511d259296c514605ba3a07c` | Simplificación académica y Horarios con migración, permisos, pruebas y documentación dependientes. |
| `7139e55545723cc5b7abffacdb47ef6d61990afc` | H-01 a H-05, sus regresiones y prueba HTTP real H-04. |
| `a12c298b74d8828877a9a00b6b002ad82f5d11f0` | Reparación del lector PDF de pruebas y regresión CR. |
| Commit que contiene este documento | Contratos, activación, privilegios y entrega final. El hash completo se informa al finalizar la operación. |

Simplificación y Horarios comparten AppModule, modelos, inventario y permisos: se consolidan juntos para conservar
su coherencia. Los archivos mixtos se preparan por versión revisada desde las copias previas; no se modifica el árbol
de trabajo para separarlos. Se revisa cada índice y no se utiliza `git add .`, amend, rebase, force push ni otra rama.

El remoto estaba exactamente en la base al hacer fetch. Publicación autorizada exclusivamente mediante
`git push origin anderson:anderson`, tras comprobar de nuevo que `origin/anderson` sigue siendo antecesor.
La comprobación final compara `git rev-parse HEAD` con `git ls-remote origin refs/heads/anderson` y exige igualdad;
su resultado y el cuarto hash se entregan en el informe de sesión. La CI automática continúa aplazada.

## MySQL y operaciones pendientes

Lectura actual: `horus_db`, MySQL **8.0.46**, UUID `dc5bb32a-a7b2-11f1-913f-14b5cd19372a`,
**27 tablas y 16 migraciones**. No existen todavía las tres tablas nuevas; faltan únicamente
`20261020-preinscripciones` y `20261023-convocatoria-horarios`. No está registrada la migración retirada de Sesiones.
La cuenta configurada mantiene privilegios administrativos globales y `GRANT OPTION`: el endurecimiento **no está aplicado**.
No se muestran cuentas, credenciales ni salida completa de grants.

- [Activación y recuperación](activacion-preinscripciones-horarios.md): comandos exactos, identidad, ventana sin
  escritores, respaldo nuevo privado/verificado y restauración aislada antes de `npm run db:migrate`; después,
  `npm run db:check`, 18 migraciones y comparación de los datos originales. Todo permanece detenido hasta autorización.
- [Privilegios MySQL](privilegios-mysql-propuesta.md): aplicación sin DDL, migrador independiente, respaldo de lectura,
  excepciones de certificados/auditoría, red privada, variables por proceso, cifrado y rotación. Requiere ensayo de
  privilegios efectivos en clon y autorización antes de crear/modificar cuentas reales.
- [Contrato React](contrato-react-backend-consolidado.md): endpoints, permisos, estados, DTO, límites, revisión,
  409/422, CORS/Content-Disposition y rutas retiradas. No incluye implementación React ni despliegue.

El respaldo previo está verificado y conservado; no se toma otro porque no se activa el origen.
La ACL privada no equivale a cifrado ni a una copia externa: la política de almacenamiento y el respaldo fresco
de la futura ventana siguen siendo requisitos operativos. La verificación pública de certificados permanece
hasta comprobar su dependencia en todos los entornos y autorizar su retirada.

## Conservación y límites de la entrega

Antes de preparar commits se copiaron y verificaron los 87 archivos existentes entre 109 rutas pendientes, junto
con índice, parches binarios y estado Git, en
`%USERPROFILE%\.horus-respaldos\publicacion-backend-20261023\`, con ACL del operador/SYSTEM.
También se comprobó el respaldo independiente de Claude: **36 archivos, 2 065 476 bytes**, legibles.
Logs nuevos y reproducción PDF ficticia permanecen privados y fuera del repositorio.

Los dos stashes históricos se conservan sin aplicar ni eliminar:
`2599fb8558830d6d11f49a7ced757d89dd8f9116` y `cc173cc52d26611facaf85c58987142487428470`.
No se modifican los otros worktrees. Se mantiene el inventario de **11 contenedores y 117 volúmenes Docker**;
esta operación no crea ni inicia contenedores.

No se ejecutan migraciones ni escrituras de datos reales, CREATE USER/GRANT/REVOKE/ALTER USER, rotaciones,
despliegues, cambios React, cambios de main, Actions ni activación de CI. No se publican respaldos, logs o secretos.

**Código:** consolidado y validado; publicación sujeta a la comprobación remota final indicada arriba.
**Base local activada:** no, faltan las dos migraciones y el endurecimiento autorizado.
**Producción operativa:** no, integración React y despliegue corresponden al compañero.
