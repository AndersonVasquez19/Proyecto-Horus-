# Activación de Sesiones y Preinscripciones: ensayo en clon y procedimiento definitivo

> **Actualización (23 de octubre de 2026):** la parte de **Sesiones ya no se activará**: la migración `20261020-sesiones-academicas` está retirada (no se aplica) y el
> módulo se eliminó del código. Lo relativo a `20261020-preinscripciones` sigue vigente; ahora `db:migrate` aplicará después `20261023-convocatoria-horarios`
> (ver [Horarios de las ediciones](horarios-ediciones.md), sección «Activación en una base real»). Donde este documento hable de activar sesiones, descríbelo como histórico.

Fecha de redacción: 20 de octubre de 2026 (America/Lima). Alcance: las migraciones `20261020-sesiones-academicas` y `20261020-preinscripciones`.

**Estado: PREPARACIÓN. Ninguna de las dos migraciones se ha aplicado a `horus_db`, `horus_local` ni a otra base habitual.** Este documento recoge el resultado del ensayo en un clon aislado de MySQL 8.0.46 y fija el procedimiento de activación, recuperación y detención. **No autoriza ejecutar `db:migrate` sobre `horus_db`**: esa autorización es posterior, separada y expresa (sección 9, punto P11).

Documentos relacionados: [Gestión de preinscripciones](gestion-preinscripciones.md), [Horarios y sesiones académicas](horarios-sesiones-academicas.md), [Respaldo y restauración](backup-restauracion.md) y, como precedente, [Activación real de Docentes](activacion-docentes-mysql-real.md).

**Conciliación de evidencias (segunda revisión, 20 de octubre de 2026).** La primera redacción de este documento se apoyó solo en los archivos del directorio privado del ensayo y afirmaba que la reversión manual «no se ha ejecutado ni ensayado». **Esa afirmación era errónea:** la reversión manual **sí se ejecutó** en un clon desechable durante el ensayo (16 comprobaciones, 16 correctas; ver 0.1 y 8.7), pero su salida **no se guardó** en el directorio privado: solo queda el script y el registro de la sesión que la ejecutó. La falta de un archivo se había interpretado como falta de ejecución. Esta revisión contrasta el informe original con tres fuentes (los archivos del directorio privado, los scripts del ensayo que siguen en disco y la transcripción de la sesión que lo hizo) y separa lo **ejecutado con evidencia archivada**, lo **ejecutado sin evidencia archivada** y lo **no ejecutado** (sección 0.1). No se repitió ninguna prueba, no se tocó ninguna base de datos y no se modificó ningún respaldo.

**Cierre de evidencias (tercera revisión, 20 de octubre de 2026, noche).** Con autorización expresa para crear un respaldo nuevo y ensayar exclusivamente en clones aislados (sin migrar `horus_db`), se repitieron en un clon nuevo de MySQL 8.0.46 las pruebas que solo constaban en el registro de sesión y se archivó la salida completa de cada una en un directorio privado nuevo (sección 0.3). **Resultado: las 14 evidencias pedidas quedaron archivadas y el escenario de recuperación terminó 15 de 15 tras corregir una expectativa errónea del arnés; ninguna prueba falló por causa de las migraciones.** Siguen siendo resultados de un clon, no afirmaciones sobre una migración real: `horus_db` no se migró y conserva sus 16 migraciones (sus huellas previa, posterior al respaldo y final son idénticas). Los apartados anteriores se conservan como historia del ensayo original y llevan una nota *Cierre* donde el cierre los actualiza.

## 0. Cómo leer la evidencia

Cada afirmación lleva una de estas marcas:

| Marca | Significado |
| --- | --- |
| **[Evidencia]** | Hay un archivo del ensayo (en el directorio privado de respaldos del responsable, fuera del repositorio) que lo respalda y se revisó al redactar este documento. |
| **[Evidencia de cierre]** | Se ejecutó en el cierre del 20 de octubre (noche) y su salida completa está archivada, con cabecera, código de salida y SHA-256, en `%USERPROFILE%\.horus-respaldos\cierre-evidencias-20261020\` (sección 0.3). Es un resultado **del clon**, no de `horus_db`. |
| **[Registro de sesión]** | La prueba **se ejecutó**, pero **no hay archivo en el directorio privado**. Consta en la transcripción de la sesión que hizo el ensayo (archivo JSONL del perfil local de Claude Code, fuera del repositorio) y en el script que la ejecutó (carpeta temporal de esa sesión, volátil). Es un registro secundario: no está firmado, puede borrarse y no sustituye a un archivo de evidencia. |
| **[Comprobado hoy]** | Se verificó el 20 de octubre de 2026 con una consulta o comando **de solo lectura** en la primera redacción de este documento. La segunda revisión (conciliación) **no volvió a consultar ninguna base de datos**: solo releyó archivos, scripts, la transcripción y Git. |
| **[Comunicado]** | Lo informó el responsable y no hay archivo que lo respalde en lo revisado. |
| **[Pendiente]** | No consta en ninguna fuente revisada; debe completarse antes de pedir la autorización. |
| **[No ejecutado]** | No hay ejecución ni registro de que se hiciera. No se da por probado. |

Los resultados sin ninguna fuente no se inventan: se marcan como [Pendiente] o [No ejecutado] (secciones 0.1 y 11). Un resultado con solo [Registro de sesión] es **creíble pero no verificable por un tercero**: para aprobar la activación conviene archivar su salida (0.2).

No se copian aquí datos personales, contraseñas ni contenido de los respaldos. Solo aparecen nombres de archivo, tamaños, huellas SHA-256 de los archivos, recuentos y nombres de tablas.

### 0.1 Qué se ejecutó realmente en el ensayo

Fuentes revisadas hoy, todas de solo lectura:

1. **Directorio privado del ensayo:** 12 archivos más la copia de archivos subidos (no se abrió ningún `.sql.gz` ni archivo subido).
2. **Scripts del ensayo:** 30 archivos `.cjs` y de texto en la carpeta temporal de la sesión que hizo el ensayo (`…\Temp\claude\…\7782afce-…\scratchpad\`), fuera del repositorio. Es una ubicación **volátil**: nada garantiza que persista. Hoy existen; el script de reversión (`reversion.cjs`, 8 966 bytes, SHA-256 que empieza por `a03d06f3e09b3ba0`) está fechado a las 21:53:59 de Lima y la transcripción registra su salida a las 21:54:22, antes del informe final de las 21:57.
3. **Transcripción de esa sesión** (`7782afce-ebfb-4618-a2ad-6645ebf46a25.jsonl`, en el perfil local de Claude Code): se consultó con búsquedas de fragmentos cortos, con las credenciales y claves redactadas. Contiene las salidas impresas de cada comando.

El clon (instancia temporal de MySQL, su directorio de datos, sus credenciales efímeras y la copia de uploads) se apagó con `SHUTDOWN` y se eliminó al terminar [informe original; en la segunda revisión se comprobó que no queda ninguna carpeta `horus-ensayo-*` en la carpeta temporal ni los procesos del clon (PID 24304 y 21616), y que solo siguen los dos procesos `mysqld` del servicio real (PID 4800 y 5576), Comprobado hoy]. Por eso **no se puede volver a inspeccionar el clon**: solo quedan los archivos y registros de esta sección.

#### A. Ejecutado y respaldado por archivo en el directorio privado

| Prueba | Archivo | Qué demuestra |
| --- | --- | --- |
| Respaldo e integridad del archivo | `horus-horus_db-20261021-022934.sql.gz`, `.sha256`, `.manifest.json` | SHA-256 coincidente; 27 tablas, 16 migraciones, servidor `8.0.46` (sección 2) |
| Copia de archivos subidos | `uploads-20261021-023007\manifest.json` y `.sha256` | 35 archivos, 17 588 756 bytes |
| Restauración equivalente al origen | `huella-origen-0-previa.json` frente a `huella-clon-ref-0-restaurado.json` | Única diferencia: `rate_limit_buckets` (sección 2) |
| Migración y datos originales intactos | `huella-clon-ref-1-migrado.json`, `huella-clon-ref-2-final.json` | 25 de 25 tablas idénticas; el clon de referencia no recibió escrituras después de migrar (sección 3) |
| `horus_db` sin cambios durante el ensayo | `huella-origen-0-previa.json`, `…-1-postrespaldo.json`, `…-2-final.json` | Tres huellas idénticas |
| `db:check` previo contra el origen | `dbcheck-origen.txt` | 94 diferencias (sección 5) |
| 98 pruebas funcionales | `func-test-salida.txt` | 98 correctas, 0 fallos; es la última de varias ejecuciones (sección 5) |
| Siete cortes de migración | `parciales-salida.txt` | Tabla de la sección 7 |
| Puerto del clon (indirecto) | `func-test-salida.txt` | Las conexiones de la API de prueba fueron a `127.0.0.1:60906`, nunca al 3306 |

#### B. Ejecutado, pero sin evidencia archivada (solo [Registro de sesión])

> **Cierre:** todas las pruebas de esta tabla se repitieron en el cierre con la salida archivada (0.3). La tabla se conserva como historia del ensayo original: lo que describe ya no es el estado de la evidencia.

| Prueba | Resultado que consta en el registro de sesión | Script (SHA-256, primeros 16) |
| --- | --- | --- |
| Identidad del clon | MySQL `8.0.46`; `server_uuid` empieza por `c655e2a4` (distinto del real, `dc5bb32a`); `127.0.0.1:60906`; `--no-defaults`; directorio de datos temporal propio; `sql_mode` global idéntico al del origen | `clon.cjs` (`017ecf39611e66b3`) |
| Guardia de identidad | Bloquea el puerto 3306 y `localhost:60906` antes de enviar paquetes; solo conecta a `127.0.0.1:60906`. El informe original añade que rechaza otro host, un UUID erróneo y el UUID del origen | `guard.cjs` |
| `--verify-only` del respaldo | «firma SHA-256 correcta y 41 sentencias permitidas», código 0 | comando `db:restore` |
| `db:restore` en `horus_restore_ref` | 41 sentencias; recuentos verificados en 27 tablas; integridad referencial verificada en 17 claves foráneas (2 compuestas), sin huérfanas | comando `db:restore` |
| `db:migrate` y `db:check` posteriores | `db:migrate` código 0 (2,10 s); `db:check` «Esquema compatible» (0,52 s); segundo `db:migrate` código 0 (0,27 s); segundo `db:check` compatible | comandos `db:migrate` y `db:check` |
| Orden real de las sentencias | CREATE `sesiones` → ENUM del historial → registro de Sesiones → ALTER `matriculas` → CREATE `preinscripciones` → CREATE historial → ALTER `convocatorias` → registro de Preinscripciones | `orden.cjs` (`eb4bd189e5f33cbf`) |
| Migración sobre un clon con datos ficticios previos | 12 comprobaciones correctas: migración y `db:check` compatibles; filas de las otras 26 tablas conservadas; las 2 ediciones previas quedan con `minimo_apertura` NULL, recepción cerrada y código NULL; cuentas idénticas; tablas nuevas vacías; una preinscripción convertida y una sesión sobre filas previas funcionan | `datos.cjs` (`5a43b43449054a7f`) |
| 66 sondas SQL de restricciones | 66 correctas, 0 fallos (CHECK, UNIQUE, FK compuestas, RESTRICT, ENUM, colación, correo vigente único) | `restr.cjs` (`a78bc5fcbc83852d`) |
| Prisma frente al esquema | Clon migrado: 29 de 29 modelos sin `P2021`/`P2022`. Clon sin migrar: 25 de 29 (`P2021` en `Sesion`, `Preinscripcion` y `PreinscripcionHistorial`; `P2022` en `Convocatoria`) [informe original para el detalle de los 4 modelos] | `prisma-modelos.cjs` |
| **Reversión manual** | 16 comprobaciones correctas, 0 fallos (detalle en 8.7) | `reversion.cjs` (`a03d06f3e09b3ba0`) |
| Tabla `sesiones` preexistente con otra forma | `db:migrate` termina en código 0 sin corregirla; `db:check` falla (código 1, 32 líneas sobre `sesiones`) | `reversion.cjs` |
| Recuperación desde el respaldo original en otro clon | 14 correctas y 1 «falla» del arnés (ver 7.1) | `recuperar.cjs` (`ccf3ce71e8806e05`) |

#### C. No ejecutado

> **Cierre:** tras el cierre sigue sin ejecutarse todo lo de esta lista **salvo** la reversión sobre una base con filas académicas previas, que se ensayó (0.3, evidencia 12). La lista actualizada está al final de 0.3.

- Fallo por falta de privilegios de la cuenta de migración (P18).
- Espera por bloqueos de metadatos (`lock_wait_timeout`).
- Corte dentro del `ALTER` de `convocatorias` (es una sola sentencia atómica; no hay estado intermedio observable).
- Tabla preexistente con otra forma para `preinscripciones` o `preinscripciones_historial` (solo se ensayó con `sesiones`).
- Reversión sobre una base que ya tenía filas académicas previas (matrículas, estudiantes, ediciones): la reversión se ensayó sobre una base de partida sin filas académicas. El clon con datos ficticios se usó para migrar, no para revertir.
- Reversión en MySQL 8.4, en `horus_db` o en `horus_local` (esto último está prohibido).
- `npm test`, las suites de integración del repositorio, los smokes de frontend, la compilación desde el código fuente con Node 22.x y la CI del commit.
- `TRUSTED_PROXY_CIDRS` real, OpenAI, Resend, Railway, los límites de preinscripción por hora, por subred y global, y los permisos con sesiones reales de Coordinación y Secretaría.

### 0.2 Qué conviene repetir para tener evidencia archivada

**Cierre (0.3): los seis puntos de esta lista se repitieron el 20 de octubre (noche), con autorización expresa, en un clon nuevo y sobre un respaldo nuevo, con la salida archivada.** El texto que sigue es el original de la segunda revisión. Todas las pruebas de la tabla B se ejecutaron, pero un tercero no puede comprobarlas. Antes de pedir la autorización de `db:migrate` (sección 11) conviene repetirlas **en un clon nuevo, sobre el respaldo nuevo de P7/P8**, guardando la salida completa de cada comando en el directorio privado (por ejemplo con `tee`) y archivando los scripts junto a ellas:

1. Identidad del clon (`server_uuid`, puerto, `sql_mode`) y salida de `--verify-only` y de `db:restore`.
2. `db:check` posterior y comparación del conjunto de nombres de `horus_migrations` (P14).
3. Batería de 66 sondas SQL de restricciones.
4. Reversión manual con tablas vacías, con la secuencia exacta de 8.7 y comparación de huellas antes y después.
5. Recuperación desde el respaldo (14 de 15 comprobaciones correctas; la restante falló por una expectativa errónea del arnés y se verificó aparte, ver 7.1).
6. Migración con datos ficticios previos.

La batería funcional y los cortes parciales ya tienen archivo. Si cambia el commit, la versión de MySQL o la huella de `horus_db`, se aplica además la regla de repetición de la sección 9.

### 0.3 Cierre de evidencias (tercera revisión): resultados observados

**Qué es.** El 20 de octubre de 2026, de las 22:56 a las 23:08 (America/Lima), con autorización expresa para crear un respaldo nuevo, verificarlo y ensayar **solo en clones aislados**, se repitieron las pruebas de la tabla B de 0.1 y los puntos de 0.2. **Qué no es:** todo lo que sigue se observó en clones desechables restaurados desde un respaldo. **No es una afirmación sobre una migración real.** `horus_db` no se migró: solo se leyó (sonda, huellas y `db:check`, de solo lectura) y se respaldó con `db:backup`, que únicamente lee.

**Dónde está la evidencia [Evidencia de cierre].** Directorio privado, fuera del repositorio y de OneDrive: `%USERPROFILE%\.horus-respaldos\cierre-evidencias-20261020\` (ACL solo para el usuario del responsable y SYSTEM). Contiene `respaldo-nuevo\` (base y archivos subidos), `salidas\` (48 archivos numerados 01 a 48; cada uno con cabecera —comando, hora UTC y carpeta—, la salida íntegra, el código de salida y el SHA-256 de la salida), `scripts\` (los scripts exactos que se usaron, ya fuera de la carpeta temporal volátil), las huellas `*.json` y `INDICE-SHA256.txt` (SHA-256 de los 138 archivos; el de ese índice empieza por `105a77e7d6451957`). No se abrió el contenido del respaldo, no se imprimió ninguna credencial ni dato personal y no se tocó ningún respaldo anterior (sus recuentos de archivos y bytes son los mismos que antes de empezar). Las cifras de abajo se comprobaron contra esos archivos. En lo sucesivo, «salida NN» es el archivo `salidas\NN-*.txt`.

#### Identidad del servidor real y del clon del cierre

| Dato | Servidor real (`horus_db`) | Clon del cierre |
| --- | --- | --- |
| Versión | `8.0.46` | `8.0.46`, con el mismo `mysqld.exe` del servicio |
| `server_uuid` | empieza por `dc5bb32a` (igual que el registrado en la activación de Docentes, que solo guarda el prefijo); los scripts comprobaron además el valor completo con el que fijó el arnés del ensayo original, y coincide, sin imprimirlo | empieza por `b15e8b8b`: distinto |
| Puerto e interfaces | `3306`; el servicio escucha en `::` (`bind_address = *`) | `63261`, solo `127.0.0.1`. La salida 11 registra `bind_address = 127.0.0.1`. Además, desde el sistema operativo (consola de la sesión; **esta salida no se archivó**) su único socket en escucha era `127.0.0.1:63261` y ninguno estaba en `0.0.0.0` ni en `::` |
| Directorio de datos | `C:\ProgramData\MySQL\MySQL Server 8.0\Data\` | Propio, en una carpeta temporal (`horus-ensayo-<hex>\data\`); eliminado al terminar |
| Arranque | Servicio `MySQL80` | `--no-defaults`, `--mysqlx=OFF`, `--local-infile=0`, `--skip-log-bin`, `--event-scheduler=OFF` |
| `sql_mode` y otras variables | `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`; `lower_case_table_names = 1`; `utf8mb4` / `utf8mb4_0900_ai_ci`; `max_allowed_packet` 64 MB (salida 09) | Idénticos (salida 11) |
| Diferencias conocidas | `log_bin = ON`, `event_scheduler = ON` (0 eventos definidos) | `log_bin` y `event_scheduler` apagados |
| Credencial | Ninguna se cambió | Efímera y aleatoria, guardada solo en la carpeta temporal del clon, eliminada con ella |
| Guardia de destino | — | Toda conexión de los scripts pasó por una guardia: antes de enviar un paquete exige host `127.0.0.1` y el puerto del clon; después, UUID, puerto y directorio de datos. Salidas 12 y 13: el destino `127.0.0.1:3306`, `localhost`, otro puerto y «sin configuración» se bloquearon con el mensaje exacto de la guardia; un UUID esperado igual al del real se rechaza al arrancar |
| API y servicios externos | — | No se arrancó la API ni ningún otro servicio. Los procesos hijos recibieron `OPENAI_API_KEY` y `RESEND_API_KEY` vacías y `CHATBOT_AI_ENABLED=false`; no hubo conexión a OpenAI, Resend ni correo |

Fin del ensayo: el clon se apagó con `SHUTDOWN` tras confirmar su identidad (salida 45) y su carpeta se eliminó (salida 46). Se comprobó después (primero por consola y luego, archivado, en la salida 48) que no queda ninguna carpeta `horus-ensayo-*`, ningún socket en `63261` ni procesos de Edge `horus-*` (no se usó navegador), y que solo siguen los dos procesos `mysqld` del servicio real. Su registro de errores (6 líneas: arranque, un aviso de certificado autofirmado) está en la salida 44.

#### Respaldo nuevo [Evidencia de cierre]

| Elemento | Resultado |
| --- | --- |
| Base | `respaldo-nuevo\horus-horus_db-20261021-035744.sql.gz` (13 748 bytes; la marca está en UTC: 20 de octubre, 22:57 en Lima). Creado con el mismo código que `npm run db:backup` (`node scripts/backup.cjs --dir=<privado>`), código de salida 0 (salida 04) |
| SHA-256 | `a978a9a1269e58b17809f749489bb9b93a41b0e9d724cf448b9c2d4a46a3f822`. Coincide con el archivo `.sha256` y con un `Get-FileHash` independiente |
| `--verify-only` | Código 0: «Respaldo íntegro: firma SHA-256 correcta y 41 sentencias permitidas» (salida 06) |
| Manifiesto | 27 tablas, 148 filas (146 volcadas: `rate_limit_buckets` conserva su estructura pero no sus 2 filas, por diseño), 16 migraciones, servidor `8.0.46`, colación `utf8mb4_0900_ai_ci` |
| Archivos subidos | `respaldo-nuevo\uploads-20261021-035809`: 35 archivos, 17 588 756 bytes, creado y verificado por el propio comando (salida 07); `uploads:restore --verify-only` correcto (salida 08) |
| Permisos del archivo | Solo el usuario del responsable y SYSTEM |

**Hallazgo.** Este respaldo tiene **exactamente el mismo SHA-256** que el del ensayo original (`…-20261021-022934`, tomado 1 h 28 min antes). Es lo esperable: el volcado es determinista y no incluye la hora (esta consta en el nombre y en el manifiesto), y concuerda con una `horus_db` que no cambió. Pero significa que **no aporta una verificación independiente**: es un segundo archivo con el mismo contenido. Tampoco sustituye a P7: el respaldo de la ventana de activación debe tomarse en la ventana.

#### Resultados por evidencia

Todas las pruebas son de **clon**. «Real» se refiere a lecturas de solo lectura de `horus_db`.

| N.º | Evidencia pedida | Resultado observado | Salida |
| --- | --- | --- | --- |
| 1 | `db:backup` y `--verify-only` | Respaldo creado (código 0; 27 tablas, 146 filas volcadas); `--verify-only` código 0; copia de archivos subidos y su verificación correctas | 04, 06, 07, 08 |
| 2 | `db:restore` en el clon | Código 0: 41 sentencias; recuentos verificados en 27 tablas; integridad referencial verificada en 17 claves foráneas (2 compuestas), sin filas huérfanas | 14 |
| 3 | Origen frente a clon | **Idénticos** en el contenido (hash por tabla), motor, colación, DDL, columnas, claves foráneas, CHECK, índices, migraciones y las 14 cuentas. Única diferencia conocida: `rate_limit_buckets` (2 filas en el real, 0 en el clon; 148 frente a 146 en total) | 05, 15, 16 |
| 4 | `db:check` antes de migrar | Código 1 con **94 líneas**, idénticas línea por línea en el real, en el clon y en `dbcheck-origen.txt` del ensayo original; ninguna línea ajena a las dos migraciones | 17, 18 |
| 5 | `db:migrate` en el clon | Código 0, «Migraciones aplicadas…» (0,94 s). Segunda ejecución: código 0 (0,21 s), sin cambios | 19, 23 |
| 6 | Las 18 entradas de `horus_migrations` | 18 filas, **exactamente** las 18 de la sección 4 y las de `versions` de `migrate.cjs`; `20261020-sesiones-academicas` se registra antes que `20261020-preinscripciones` | 21 |
| 7 | `db:check` después de migrar | «Esquema compatible: tablas, columnas, tipos, nulabilidad e indices unicos», código 0; igual tras la segunda migración | 20, 24 |
| 8 | Pruebas SQL | **66 comprobaciones, 66 correctas, 0 fallos.** Desglose real: 3 pasos de preparación (restauración, migración, `db:check`), 62 sondas con código de error esperado (13 debían tener éxito; 49 debían fallar: 28 con 3819 de CHECK, 7 con 1452, 5 con 1451, 5 con 1265 y 4 con 1062) y 1 comprobación del índice `matriculas_id_relaciones_uq`. El ensayo original las llamó «66 sondas»; son 62 más 4 comprobaciones | 31 |
| 9 | Conservación de registros | 25 de 25 tablas originales con el **mismo contenido** antes y después de migrar (por hash); `horus_migrations` pasa de 16 a 18; 14 cuentas idénticas; tras la segunda migración, huella idéntica a la primera | 26, 27, 28 |
| 10 | Migración con datos académicos ficticios previos | 12 de 12 correctas: 3 estudiantes, 2 ediciones, 3 matrículas, 1 docente con asignación y 2 filas de historial se conservaron; las ediciones previas quedan con `minimo_apertura` NULL, recepción cerrada y código NULL; las tablas nuevas, vacías; una preinscripción convertida y una sesión sobre filas previas funcionaron (con `ROLLBACK`) | 32 |
| 11 | Recuperación | Reproducción **sin cambios** del escenario original: 14 de 15, falla la misma comprobación (salida 33). Era un error de la expectativa (nota 1). Con esa única línea corregida, ejecución completa: **15 de 15** | 33, 34, 35 |
| 12 | Reversión | Escenario original (tablas nuevas vacías; también con datos, que la bloquean): 16 de 16. Nuevo, con filas académicas previas: 13 de 13 (la primera ejecución dio 11 de 12 por un error de mi propia comprobación; nota 2) | 36, 37, 38 |
| 13 | Esquema antes y después | 97 diferencias, **todas aditivas**: +3 tablas; columnas 304 → 354 (+50) y dos ENUM de `academico_historial` ampliados; índices 113 → 132; claves foráneas 17 → 23 (19 → 28 columnas de clave); CHECK 26 → 43 (todos `ENFORCED = YES`). El DDL solo cambia en `academico_historial`, `convocatorias`, `matriculas` y las tres tablas nuevas | 30 |
| 14 | Restauración de uploads | `uploads:restore` a una carpeta nueva: 35 archivos; **35 de 35 con SHA-256 idéntico** a los de `backend/uploads`; rechazo al restaurar sobre una carpeta con archivos, sin sobrescribir | 35 |

`horus_db` durante todo el ensayo: la sonda de solo lectura, antes y después, dio los mismos resultados (16 migraciones, 27 tablas, ninguna tabla, columna, índice ni ENUM nuevos, `Threads_connected = 1`, 0 eventos, sin candado de migración), y las tres huellas (previa, posterior al respaldo y final) son idénticas entre sí y a la del ensayo original (salidas 01, 02, 03, 05, 39, 40, 41 y 42). Sobre los escritores: la sonda inicial y la final muestran solo la propia sonda y el demonio `event_scheduler`. Al empezar (consola, no archivada) no había conexiones TCP establecidas al 3306 ni procesos `node`, `php` ni `ngrok`; al terminar se repitió la comprobación y sí se archivó (salida 48). No se vigiló de forma continua entre ambos momentos.

#### Notas sobre la lectura de los resultados

1. **La falla de la recuperación era un error de la expectativa.** La comprobación «Sin `--yes` solo informa y no crea nada» esperaba código de salida 0. `restore.cjs` (línea 60) trata la falta de `--yes` como una negativa deliberada: lanza el error «Repite el comando con --yes para confirmar» y el comando termina con código 1. La salida 34 lo demuestra: código 1, ese mensaje, y la base no existe antes ni después. Se corrigió **únicamente** esa línea del arnés (pasó a exigir código 1, la mención de `--yes` y que no se cree la base); el resto de la lógica y de las expectativas no cambió, y las diferencias frente a los scripts originales están en la salida 47. La aplicación se comporta de forma segura; lo que falló fue la prueba. Una discrepancia menor de documentación, **no corregida aquí** por estar fuera de alcance: `backup-restauracion.md` dice «Sin `--yes` solo informa de lo que haría» sin precisar el código de salida.
2. **Primera ejecución del script nuevo de reversión con datos previos (salida 37: 11 correctas y 1 falla).** La comprobación final comparaba el hash de toda la tabla `convocatorias` antes y después de migrar y volver a migrar; como esa tabla gana tres columnas, ese hash cambia siempre. Era un error de mi script (el único nombre de tabla distinta que informaba era `convocatorias`), no de los datos. Se corrigió comparando las columnas originales y comprobando los valores neutros de las nuevas (NULL, `cerrada`, NULL); la repetición (salida 38) dio 13 de 13. La salida 37 se conserva a propósito.
3. **Alcance del script de reversión original.** No comprobaba el `sql_mode` de la sesión (condición 6 de 8.7). El script nuevo sí lo hace (`STRICT_TRANS_TABLES` presente en la sesión que ejecuta el DDL; salidas 37 y 38).
4. **Origen de los scripts.** Son los del ensayo original (sus copias, sin modificar, siguen en la carpeta temporal de esa sesión), copiados al directorio privado. Cuatro (`reversion`, `recuperar`, `datos`, `restr`) solo cambiaron las rutas para usar el respaldo nuevo; la única excepción de lógica es la línea de la nota 1. Se añadieron `probe-origen2`, `migraciones-set`, `esquema-diff`, `conservacion-tablas`, `guardia-directa`, `sin-yes`, `run-logged` y `reversion-con-datos-previos`. Dependen de rutas absolutas de este equipo.
5. **No se repitieron las 98 pruebas HTTP** (no estaba pedido salvo que cambiara el entorno o el esquema): el commit sigue siendo `ea402c4`, las migraciones no cambiaron, el esquema resultante es el mismo que el del ensayo original según las huellas, y no se arrancó ninguna API. Sus límites (riesgo C: `dist` previo y Node 24) siguen vigentes.

#### Lo que sigue sin ejecutarse tras el cierre [No ejecutado]

- **Siguen solo como [Registro de sesión]** (ejecutados en el ensayo original, no repetidos en el cierre porque no estaban entre las 14 evidencias pedidas): Prisma frente al esquema (29 de 29 modelos sin `P2021` ni `P2022` en el clon migrado) y el orden exacto de las sentencias de las dos migraciones (`orden.cjs`). Del orden solo se repitió, con archivo, que `sesiones-academicas` se registra antes que `preinscripciones` (salida 21).
- Fallo por falta de privilegios de la cuenta de migración (P18) y privilegios de la cuenta del backend sobre las tablas nuevas.
- Espera por bloqueos de metadatos (`lock_wait_timeout`), tráfico concurrente y tiempos de ejecución bajo carga.
- Corte dentro del `ALTER` de `convocatorias` (es una sola sentencia atómica) y tabla preexistente con otra forma para `preinscripciones` o `preinscripciones_historial` (solo `sesiones`, salida 36).
- Fallo a mitad de la reversión, reversión en MySQL 8.4 y reversión con datos nuevos en las tablas nuevas (esta última, prohibida por el procedimiento).
- Reversión, migración o cualquier DDL sobre `horus_db`: no se hizo, ni está autorizado.
- `npm test`, las integraciones del repositorio, los smokes del frontend, la compilación con Node 22.x, la CI del commit (P2), `TRUSTED_PROXY_CIDRS` real (P17), OpenAI, Resend, Railway, los límites de preinscripción por hora, por subred y global, y los permisos con sesiones reales de Coordinación y Secretaría.
- Todo se hizo con la credencial administrativa del clon: no demuestra los privilegios de la cuenta real.

#### Condiciones que siguen abiertas para activar la base real

Este cierre deja el **ensayo** con la evidencia archivada que pedía la sección 11, punto 2; lo que ese punto dejaba pendiente (la confirmación de la CI) sigue abierto. **No concede ni sustituye ninguna autorización.** Para pedir la activación de `horus_db` siguen abiertas, además de la lista de la sección 9:

1. La autorización expresa y separada para `db:migrate` (P11), posterior a P1–P10, que nombre commit, base, ventana y respaldo.
2. `backend/tsconfig.json` modificado en el árbol de trabajo (12.3, punto 1): resolverlo o aceptarlo por escrito. No se tocó.
3. CI aprobada para el SHA exacto (P2), `TRUSTED_PROXY_CIDRS` (P17) y privilegios de MySQL (P18).
4. En la ventana: P1–P10 vuelven a verificarse, con un **respaldo nuevo tomado en la ventana** (P7) restaurado en un clon (P8). El respaldo de este cierre no vale para la activación.
5. Regla de repetición (sección 9): si cambia el commit, la versión o el `server_uuid` de MySQL o la huella de `horus_db`, se repite el ensayo completo.
6. El responsable acepta los riesgos A (credencial administrativa y MySQL en todas las interfaces) y B (respaldos sin cifrar), y que, con datos nuevos, la recuperación es restaurar un respaldo en una base aislada, no revertir a mano.

## 1. Identidad del servidor real y del clon

| Dato | Servidor real (`horus_db`) | Clon de ensayo |
| --- | --- | --- |
| Versión de MySQL | `8.0.46` [Comprobado hoy] | `8.0.46` [Registro de sesión]; el manifiesto del respaldo registra `8.0.46` como versión de origen [Evidencia] |
| `server_uuid` | empieza por `dc5bb32a` [Comprobado hoy]; coincide con el de la activación de Docentes. El valor completo se compara en el momento de la activación, no se guarda aquí | empieza por `c655e2a4`, distinto del real [Registro de sesión]. **No consta en ningún archivo del directorio privado**; solo se conservan los 8 primeros caracteres |
| Servicio y puerto | `MySQL80`, en ejecución, puerto `3306` [Comprobado hoy] | `127.0.0.1:60906`: instancia temporal con el mismo `mysqld.exe`, `--no-defaults` y directorio de datos propio, ya apagada y eliminada [Registro de sesión]. El puerto consta además de forma indirecta en `func-test-salida.txt`: la API de prueba solo se comunicó con direcciones `127.0.0.1` (clon incluido) y nunca con el puerto 3306 [Evidencia] |
| Interfaces | `bind_address = *`; el servicio escucha en `::` (todas las interfaces) [Comprobado hoy] | Solo loopback: `bind_address = 127.0.0.1` [Registro de sesión] (ver riesgo D para la API de prueba) |
| Base | `horus_db` (la sonda de solo lectura devolvió `DATABASE() = horus_db`) [Comprobado hoy] | `horus_restore_ref` (clon de referencia que solo se migró y se comparó); su huella final es idéntica a la posterior a migrar, luego no recibió escrituras [Evidencia]. El resto de las pruebas (funcionales, fallos parciales, restricciones, datos ficticios, reversión y recuperación) se hizo en otras bases `horus_restore_*` de la **misma** instancia temporal, no en instancias separadas [Registro de sesión] |
| `sql_mode` del real | `STRICT_TRANS_TABLES`, `ONLY_FULL_GROUP_BY`, `NO_ZERO_DATE`, entre otros; `time_zone = SYSTEM`; `read_only = 0` [Comprobado hoy] | `@@global.sql_mode` idéntico al medido en el origen durante el ensayo: `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION` [Registro de sesión]. Una primera instancia (puerto 60390) se descartó vacía antes de restaurar nada. Con un `sql_mode` no estricto, un `MODIFY` de ENUM sobre filas que usan valores quitados convertiría el valor en cadena vacía en lugar de fallar (ver 8.7) |
| Código | Rama `anderson`, commit `ea402c480f473073f5cd8e2d5523cec05dd3c598`, igual a `origin/anderson` [Comprobado hoy] | El mismo `migrate.cjs` y `check-database.cjs` del repositorio |
| Árbol de trabajo | Una modificación **ajena a esta tarea** en `backend/tsconfig.json` (ver sección 12.3) [Comprobado hoy] | — |

> **Cierre:** la columna «Clon de ensayo» describe el clon del ensayo original (UUID `c655e2a4`, puerto 60906), ya eliminado. El clon del cierre (UUID `b15e8b8b`, puerto 63261, también eliminado) se describe, con archivo, en 0.3. Los datos del servidor real se volvieron a comprobar en el cierre sin diferencias (salidas 01 y 39).

Estado de `horus_db` a la hora de redactar [Comprobado hoy]: 16 migraciones registradas, la última `20261020-docentes`; las tres tablas nuevas (`sesiones`, `preinscripciones`, `preinscripciones_historial`) **no existen**; `convocatorias` no tiene `minimo_apertura`, `preinscripcion_estado` ni `codigo_publico`; no existe el índice `matriculas_id_relaciones_uq`; el ENUM `academico_historial.entidad` no contiene `sesion`; `convocatorias`, `matriculas`, `estudiantes`, `docentes`, `docente_asignaciones` y `academico_historial` tienen **0 filas**; `admin_users` tiene 14. Solo había una conexión adicional (el demonio interno `event_scheduler`), `Threads_connected = 1` y 0 eventos definidos.

## 2. Resultado del respaldo y de la restauración

### Respaldo del ensayo [Evidencia]

Directorio privado fuera del repositorio: `%USERPROFILE%\.horus-respaldos\ensayo-sesiones-preinscripciones-20261020\` (ACL sin otros principales que el propio usuario y SYSTEM; no está bajo OneDrive) [Comprobado hoy].

| Elemento | Resultado |
| --- | --- |
| Base | `horus-horus_db-20261021-022934.sql.gz` (13 748 bytes; la marca está en UTC: 20 de octubre, 21:29 en Lima) |
| SHA-256 del archivo | `a978a9a1269e58b17809f749489bb9b93a41b0e9d724cf448b9c2d4a46a3f822`; **coincide** con el archivo `.sha256` y con un `Get-FileHash` calculado hoy de forma independiente [Comprobado hoy] |
| Manifiesto | 27 tablas, 148 filas (146 volcadas: `rate_limit_buckets` conserva su estructura pero no sus 2 filas, por diseño), 16 migraciones, servidor `8.0.46`, colación de la base `utf8mb4_0900_ai_ci` |
| Archivos subidos | `uploads-20261021-023007`: 35 archivos, 17 588 756 bytes (las mismas cifras de la activación de Docentes); el SHA-256 del manifiesto coincide con su `.sha256` [Comprobado hoy] |
| `--verify-only` y mensajes de `db:restore` | [Registro de sesión]: `--verify-only` dio «firma SHA-256 correcta y 41 sentencias permitidas» (código 0) y `uploads:restore --verify-only` también fue correcto. La salida de esos comandos **no está guardada en el directorio**; la equivalencia de la restauración sí se apoya en archivos: la comparación de huellas de abajo |

> **Cierre:** el cierre creó un respaldo nuevo (mismo SHA-256, sección 0.3), lo verificó y lo restauró de nuevo en un clon con salida archivada. Ese respaldo tampoco sirve para la activación.

Este respaldo es el **del ensayo**. No sirve como respaldo previo de la activación real: cualquier cambio posterior a las 21:29 de Lima no estaría en él (sección 9, P7).

### Restauración [Evidencia]

Se restauró en la base `horus_restore_ref` del clon. La huella del clon restaurado (`huella-clon-ref-0-restaurado.json`) se comparó con la del origen (`huella-origen-0-previa.json`) campo por campo [Comprobado hoy]. **Única diferencia:** `rate_limit_buckets` pasa de 2 a 0 filas (146 frente a 148 en total), que es lo esperado porque el respaldo no vuelca las cuotas temporales. Coinciden las huellas de filas de las otras 25 tablas persistentes (más `horus_migrations`), el DDL de las 27 tablas, las columnas, las claves foráneas (19), los CHECK (26), los índices (139; 87 únicos), las colaciones por tabla, el motor InnoDB, los valores de AUTO_INCREMENT, las cuentas (id, activo, rol y `session_version`) y las 16 migraciones.

Mensajes de `db:restore` en `horus_restore_ref` [Registro de sesión]: «Restauradas 41 sentencias», recuentos verificados en 27 tablas e integridad referencial verificada en 17 claves foráneas (2 compuestas, es decir, las 19 columnas de la huella), sin filas huérfanas.

## 3. Comparación de datos antes y después de migrar

Resultado de comparar `huella-origen-0-previa.json` con `huella-clon-ref-1-migrado.json` [Comprobado hoy sobre la evidencia]:

| Aspecto | Antes (origen) | Después (clon migrado) |
| --- | --- | --- |
| Tablas originales: filas y huella de contenido | 25 | **25 de 25 idénticas** |
| Filas en total (`total_filas`) | 148 | 148 |
| Migraciones registradas | 16 | 18 |
| Tablas nuevas | — | `sesiones`, `preinscripciones`, `preinscripciones_historial`, todas con 0 filas, InnoDB, `utf8mb4_unicode_ci` |
| DDL que cambia | — | solo `academico_historial` (dos ENUM), `convocatorias` (3 columnas, 1 índice, 2 CHECK) y `matriculas` (1 índice único). El DDL de las otras 24 tablas originales (incluidas `horus_migrations` y `rate_limit_buckets`) es idéntico |
| Columnas de claves foráneas (según la huella) | 19 | 28 (+9: 6 claves nuevas, 2 de ellas compuestas) |
| CHECK | 26 | 43 (+17: 8 de `sesiones`, 4 de `preinscripciones`, 3 del historial, 2 de `convocatorias`) |
| Índices únicos | 87 | 95 |
| Índices | 139 | 174 |
| Cuentas | 14 (solo la 14 activa, `GERENTE_GENERAL`; `session_version` 2 en todas) | idénticas |

Las huellas del origen antes, justo después del respaldo y al terminar el ensayo son idénticas entre sí, y las del clon migrado y la final del clon también [Comprobado hoy sobre la evidencia]: **`horus_db` no cambió durante el ensayo** y el clon de referencia no recibió escrituras. El ensayo no leyó datos de filas, solo huellas.

**Migración con datos académicos previos [Registro de sesión].** Como `horus_db` no tiene filas académicas, el ensayo repitió la migración en otra base restaurada del mismo respaldo a la que antes se añadieron datos ficticios (3 estudiantes, 2 ediciones, 3 matrículas, 1 docente con su asignación y 2 filas de historial). Las 12 comprobaciones fueron correctas: todas las filas se conservaron, las ediciones previas quedaron con `minimo_apertura` NULL, recepción cerrada y código NULL, las cuentas no cambiaron, las tablas nuevas quedaron vacías y una preinscripción convertida y una sesión sobre filas previas funcionaron (las claves compuestas nuevas son operativas). Esto cubre en MySQL 8.0.46 la variante que antes se daba por no ensayada (ver «Otros riesgos residuales», punto 1); la salida no está archivada.

Observación: `SELECT name FROM horus_migrations ORDER BY name` lista `20261020-preinscripciones` **antes** de `20261020-sesiones-academicas` por orden alfabético. No refleja el orden de aplicación, que es el del arreglo `versions` (sección 4). Para ver el orden real, ordenar por `applied_at` y, a igualdad, usar la lista de la sección 4.

## 4. Orden exacto de las migraciones

`backend/scripts/migrate.cjs` aplica en el orden del arreglo `versions` todas las que no estén en `horus_migrations`; **no permite elegir una**. Hoy `versions` tiene 18 entradas [Comprobado hoy]:

```text
 1 20260909-create-catalogo                  10 20261014-admin-rol
 2 20260921-create-cotizaciones              11 20261014-admin-auditoria
 3 20261002-complete-institutional           12 20261015-academico-estructura
 4 20261002-original-design                  13 20261016-academico-solo-dni
 5 20261002-create-convenios                 14 20261018-convocatorias-capacidad
 6 20261003-remove-otros-category            15 20261019-importaciones-academicas
 7 20261009-chatbot-metrics                  16 20261020-docentes            <- registrada en horus_db
 8 20261010-newsletter-default-novedades     17 20261020-sesiones-academicas <- PENDIENTE (primera)
 9 20261011-cotizaciones-idempotencia        18 20261020-preinscripciones    <- PENDIENTE (segunda)
```

Mecánica del ejecutor (verificada leyendo `migrate.cjs`): toma `GET_LOCK('horus_catalogo_migrations', 10)`; crea `horus_migrations` si falta; para cada versión no registrada ejecuta las sentencias del `.sql` partiendo por `;` y **después** inserta la fila en `horus_migrations`. El DDL de MySQL confirma implícitamente: no hay transacción que envuelva una migración. Cualquier interrupción deja un prefijo de sentencias aplicado y la versión sin registrar.

| # | Migración | Sentencias en orden | Efecto |
| --- | --- | --- | --- |
| 17 | `20261020-sesiones-academicas` | (1) `CREATE TABLE IF NOT EXISTS sesiones`; (2) `ALTER TABLE academico_historial MODIFY entidad ENUM(... ,'sesion')`; (3) `ALTER TABLE academico_historial MODIFY operacion ENUM(... ,'reprogramacion')` | Tabla nueva y vacía; los dos ENUM solo ganan un valor al final. Requiere `docente_asignaciones` (ya existe en `horus_db`) |
| 18 | `20261020-preinscripciones` | (1) `ALTER TABLE matriculas ADD UNIQUE KEY matriculas_id_relaciones_uq`; (2) `CREATE TABLE IF NOT EXISTS preinscripciones`; (3) `CREATE TABLE IF NOT EXISTS preinscripciones_historial`; (4) `ALTER TABLE convocatorias ADD COLUMN ×3, ADD UNIQUE KEY, ADD CONSTRAINT ×2 (CHECK)` | Dos tablas nuevas y vacías, un índice en `matriculas` y tres columnas con valores neutros en `convocatorias` (`NULL`, `'cerrada'`, `NULL`). No inserta ni modifica filas |

Tolerancias de `migrate.cjs` para repetir una ejecución interrumpida:

- `20261020-sesiones-academicas`: ninguna es necesaria (`CREATE ... IF NOT EXISTS` y `MODIFY` de ENUM son idempotentes).
- `20261020-preinscripciones`: se omiten únicamente los errores 1060 (columna duplicada), 1061 (índice duplicado) y 3822 (CHECK duplicado). No oculta una estructura incorrecta: `db:check` compara después la estructura real. El ensayo ejercitó estas tolerancias (sección 7).

El mensaje de error de `db:migrate` ante un fallo es **genérico** («No se pudo aplicar la migración. Revisa conexión, permisos y esquema de MySQL.») y no imprime el número de error de MySQL. Para saber qué falló hay que mirar `db:check` y `horus_migrations` (sección 8), no el mensaje.

## 5. Pruebas funcionales y SQL en el clon

### Funcionales (HTTP con la API compilada y cuentas ficticias del clon) [Evidencia]

`func-test-salida.txt`: **98 comprobaciones, 98 correctas, 0 fallos** (es la última de varias ejecuciones; ver la nota tras la lista). Cubren:

- Inicio de sesión de las cuatro cuentas ficticias (Gerencia, Coordinación, Secretaría y sin rol) y su matriz de permisos.
- Lecturas sin error de esquema de ediciones, matrículas, docentes y reportes; apertura de una edición anterior sin preinscripciones (`minimo_apertura NULL`).
- Alta de edición nueva con `minimo_apertura = 10`, recepción cerrada y código público opaco; recepción abierta por Coordinación; listado público sin identificadores internos, cupos ni conteos.
- Preinscripción por formulario y por chatbot (canal fijado por el servidor), 11 rechazos de validación (400), 404 uniforme, trampa para robots, duplicados con idéntica respuesta, recepción cerrada.
- Mínimo de apertura: 11 recibidas no permiten abrir; 9 validadas tampoco; con 10 la edición no se abre sola; una descartada deja de contar; Coordinación abre con 10.
- Conversión a matrícula (estudiante nuevo, reconversión rechazada, DNI de otro estudiante bloqueado sin escribir nada, DNI inválido, solicitud sin validar, edición no abierta, cuenta sin rol).
- Sesiones: docente y asignación, sesión con hora de Lima y UTC calculado, choque de docente (409), sesión contigua permitida, enlace sin HTTPS (400), reprogramar con y sin motivo, cancelar con motivo, calendario de la edición, uso de los ENUM nuevos en el historial (`sesion`, `creacion`, `reprogramacion`, `cambio_estado`).
- Límites de frecuencia: 5 por minuto y por IP (5 aceptadas y luego 429), cuota compartida entre formulario y chatbot, hashes en lugar de IP en `rate_limit_buckets`, login 10 por minuto.
- Ninguna respuesta 5xx en toda la batería; el registro de Nest (925 líneas) sin errores `P2021`/`P2022` ni de esquema.
- Red: la API de la última ejecución escuchó solo en `127.0.0.1`, sus conexiones salientes fueron solo hacia el clon (sin OpenAI, Resend ni otros) y nunca habló con el puerto 3306.

**Nota sobre las ejecuciones previas [Registro de sesión].** La batería no pasó a la primera. La primera ejecución dio 94 correctas y 3 fallos, y la siguiente 97 y 1; el archivo solo conserva la última (98/0). Según el registro, los fallos se debieron a expectativas del arnés (códigos 400 frente a 422 y un cuerpo con campo ajeno en la prueba de cuota compartida), a que la API de prueba escuchaba en todas las interfaces (riesgo D) y a que el límite por minuto es de **ventana fija**: una ráfaga que cruza el cambio de minuto reinicia el contador, y un envío alternando canales dio 201 en lugar de 429. Se ajustó el arnés, no la aplicación (el árbol de trabajo no tiene cambios en `backend/src/`, Comprobado hoy). La ventana fija es una característica de la aplicación, no un fallo de la prueba, y no se reverificó en esta revisión.

### SQL (restricciones, índices, claves y CHECK)

> **Cierre:** el `db:check` posterior (código 0, salidas 20 y 24) y la batería SQL (66 comprobaciones: 3 de preparación, 62 sondas y 1 de índice, 0 fallos; salida 31) se repitieron con salida archivada (0.3). La integración con MySQL 8.4 sigue sin ser el motor del servidor real.

- **`db:check` previo contra `horus_db`** [Evidencia + Comprobado hoy]: código 1 con **94 diferencias**, todas atribuibles a las dos migraciones (columnas, tipos de ENUM, claves primarias, índices, claves foráneas y CHECK que faltan). La salida de hoy es **idéntica** línea a línea a `dbcheck-origen.txt`.
- **`db:check` posterior en el clon migrado:** [Registro de sesión] «Esquema compatible: tablas, columnas, tipos, nulabilidad e indices unicos», código 0 (0,52 s), y de nuevo código 0 tras un segundo `db:migrate` (idempotencia). Su salida **no está guardada en el directorio privado**; la corroboran archivos: los cortes de la sección 7 (cada final de `db:migrate` + `db:check` terminó con código 0) y la huella del clon migrado (estructura completa y recuentos).
- **Prisma frente al esquema** [Registro de sesión]: en el clon migrado los 29 modelos respondieron sin `P2021` ni `P2022`; en un clon sin migrar fallaron 4 (`P2021` en `Sesion`, `Preinscripcion` y `PreinscripcionHistorial`, `P2022` en `Convocatoria`), lo que confirma que las migraciones deben ir antes del código.
- **Batería de restricciones por SQL directo** (únicos, CHECK, clave compuesta, `RESTRICT`, columna generada): [Registro de sesión] **66 sondas, 66 correctas, 0 fallos**, ejecutadas con `restr.cjs` en una base restaurada y migrada del clon 8.0.46, cada una dentro de una transacción con `ROLLBACK` y comparando el número de error de MySQL con el esperado (por ejemplo 3819 para CHECK, 1062 para UNIQUE, 1452 para clave foránea, 1265 para ENUM). **No hay salida guardada en el directorio del ensayo**: el resultado es verificable solo por la transcripción y por el script. El solapamiento de sesiones lo impone el servicio, no MySQL, y no forma parte de esas sondas. Como cobertura adicional existen las integraciones `sesiones.integration.cjs` y `preinscripciones.integration.cjs` en un MySQL **8.4** desechable (17/17 en Sesiones según la sección de pruebas de cierre de [Horarios y sesiones](horarios-sesiones-academicas.md); no se revisó aquí el resultado de la de Preinscripciones), que **no** es la versión del servidor real (8.0.46).

## 6. Comprobaciones de permisos

Resultado en el clon con cuentas ficticias [Evidencia]:

| Ruta | Gerencia | Coordinación | Secretaría | Sin rol | Sin sesión |
| --- | --- | --- | --- | --- | --- |
| `GET /api/admin/sesiones` | 200 | 200 | **403** | 403 | 401 |
| `GET /api/admin/preinscripciones` | 200 | 200 | 200 | 403 | 401 |

Además: la Secretaría no puede crear, ver el detalle, editar ni cambiar el estado de una sesión, ni listar sesiones de una edición (todo 403); no puede habilitar la recepción de una edición (403) y sí validar, descartar y convertir preinscripciones; una cuenta sin rol no convierte (403); `preinscripciones:exportar` queda reservado a Gerencia y sin ruta que lo exija.

**Permisos de MySQL (aparte, no cubiertos por el ensayo HTTP):** el backend usa una sola credencial (`DB_USER`) para todo (público, chatbot y administrativo). Para activar hay que comprobar que la cuenta con la que se ejecuta `db:migrate` puede `CREATE`, `ALTER`, `INDEX` y `REFERENCES`, y que la cuenta del backend podrá leer y escribir las tres tablas nuevas. Hoy no se ha verificado: es el punto P18 y depende del riesgo A. El ensayo en el clon usó credenciales efímeras, de modo que **no demuestra** los privilegios de la cuenta real.

**No comprobado con sesiones reales:** como en la activación de Docentes, los permisos de Coordinación y Secretaría solo se prueban con cuentas ficticias. Contra `horus_db` solo se podrán verificar, sin escribir, el 401 sin sesión y la lectura de Gerencia con la sesión real del responsable.

## 7. Pruebas de fallos parciales [Evidencia]

`parciales-salida.txt`: siete cortes sobre copias del respaldo. En cada uno se interrumpió `db:migrate` tras una sentencia, se ejecutó `db:check`, se repitió `db:migrate` y se volvió a ejecutar `db:check`. Formato de la columna de estado: migraciones registradas / tablas nuevas existentes.

| Corte | Estado tras el fallo | `db:check` | `db:migrate` | `db:check` | Resultado |
| --- | --- | --- | --- | --- | --- |
| 1 | tras `CREATE sesiones` (16/1) | código 1 (60 dif.) | 0 | 0 | idéntico al clon migrado de referencia |
| 2 | + ENUM `entidad` (16/1) | código 1 (59) | 0 | 0 | idéntico |
| 3 | `sesiones` completa **sin registrar** (16/1) | código 1 (58) | 0 | 0 | idéntico |
| 4 | `sesiones` registrada + `ALTER matriculas` (17/1) | código 1 (57) | 0 | 0 | idéntico |
| 5 | + `CREATE preinscripciones` (17/2) | código 1 (24) | 0 | 0 | idéntico |
| 6 | + `CREATE preinscripciones_historial` (17/3) | código 1 (6) | 0 | 0 | idéntico |
| 7 | `preinscripciones` completa **sin registrar** (17/3) | **código 0 (0 dif.)** | 0 | 0 | idéntico; **`db:check` no lo detecta**: solo falta la marca en `horus_migrations` |

Conclusiones que se derivan y sobre las que se apoya la sección 8:

1. Los cortes 1–6 se detectan con `db:check` (código 1) y se completan repitiendo `db:migrate`.
2. El corte 7 demuestra el riesgo E: una migración **completamente aplicada pero no registrada** pasa `db:check` con código 0. Solo `horus_migrations` la delata.
3. Al repetir `db:migrate` desde los cortes 4 a 7 se ejercitó la tolerancia 1061 (índice duplicado de `matriculas`); desde el corte 7, además, la 3822 (CHECK duplicado de `convocatorias`). Se deduce de qué sentencias ya estaban aplicadas en cada corte; la salida no registra los errores tolerados.

Nota sobre el archivo: el pie de `parciales-salida.txt` dice «Todos los cortes se detectan con db:check», lo cual es inexacto para el corte 7, que su propia fila declara no detectado. Vale lo que dice la fila.

**No se ensayó** (y no debe darse por probado): el fallo por falta de privilegios, la espera por bloqueos de metadatos, un corte dentro del `ALTER` de `convocatorias` (es una sola sentencia atómica en InnoDB 8.0; no hay estado intermedio observable) y una tabla preexistente con otra forma para `preinscripciones` o `preinscripciones_historial`. Sí se ensayaron, aunque sin archivo (7.1 y 8.7): una tabla `sesiones` preexistente con otra forma y la reversión manual. La versión anterior de este documento los daba por no ensayados; era un error.

### 7.1 Otros ensayos del mismo día [Registro de sesión]

> **Cierre:** la recuperación se repitió con salida archivada (0.3, evidencia 11). La reproducción sin cambios dio otra vez 14 de 15 (salida 33); la falla era la expectativa «`db:restore` sin `--yes` sale con código 0», incorrecta porque el comando se niega a propósito con código 1 y sin crear nada (salida 34). Con esa sola línea corregida, la ejecución completa dio **15 de 15** (salida 35). Ya existe, por tanto, una ejecución con 15 de 15, que el texto siguiente (original) negaba.

**Tabla `sesiones` preexistente con otra forma.** En una base restaurada se creó `sesiones` con dos columnas (`id`, `titulo`) y se ejecutó `db:migrate`: terminó en código 0 **sin corregirla** (`CREATE TABLE IF NOT EXISTS`) y `db:check` falló con código 1 y 32 líneas sobre `sesiones`. Confirma lo descrito en 8.5 para esta tabla. No se probó con las dos tablas de Preinscripciones.

**Recuperación desde el respaldo original en otro clon** (`recuperar.cjs`): 15 comprobaciones, 14 correctas.

- Restauración limpia en un clon nuevo, idéntica al origen (huella tomada tras el respaldo; `rate_limit_buckets` excluida por diseño).
- Rechazos de `db:restore`: sobre una base que ya tiene tablas (la base no cambia), con destino igual a `DB_NAME` y con destino sin el prefijo `horus_restore_`. `--verify-only` rechaza una copia con un byte alterado (en una carpeta temporal; el original conserva su SHA-256).
- Ese clon, al migrarlo, quedó idéntico al clon migrado de referencia, y `db:check` fue compatible.
- `uploads:restore`: `--verify-only` correcto; 35 de 35 archivos restaurados en una carpeta nueva con SHA-256 idéntico a los de `backend/uploads`; rechazo de restaurar sobre una carpeta con archivos.
- La comprobación restante falló por una expectativa errónea del arnés: esperaba código 0 al ejecutar `db:restore` **sin** `--yes`, pero el comando sale con código 1 («Repite el comando con --yes para confirmar»). Se verificó aparte que no crea la base. El script no se repitió completo después de esa verificación, de modo que no existe una ejecución con 15 de 15.

## 8. Procedimiento de recuperación

Regla general: **ante cualquier fallo, detenerse, no repetir `db:migrate` de inmediato y diagnosticar primero.** Ninguna acción de recuperación se ejecuta sin autorización expresa del responsable, con la API detenida y con el respaldo nuevo (P7) disponible.

### 8.1 Qué comprobar cuando `db:migrate` falla

1. Anotar el código de salida y la hora. No reintentar.
2. Confirmar que el proceso terminó y que no queda una sesión con `GET_LOCK('horus_catalogo_migrations')` ni un `ALTER` esperando: `SELECT IS_USED_LOCK('horus_catalogo_migrations');` y `SHOW PROCESSLIST;` (solo lectura). No terminar procesos ajenos.
3. Ejecutar `npm run db:check` (solo lectura) y guardar la salida.
4. Leer `horus_migrations` (8.2).
5. Comprobar la identidad (`DATABASE()`, versión, `server_uuid`) por si la conexión apuntaba a otra parte.
6. Clasificar el caso (8.3) antes de actuar.

Causas habituales: conexión o privilegios (el mensaje genérico no las distingue), bloqueo de metadatos por una transacción abierta sobre `matriculas` o `convocatorias` (el `ALTER` puede quedar esperando mucho tiempo: `lock_wait_timeout` por defecto es de un año), tabla homónima incompatible (8.5), o el candado de migración retenido por otra ejecución («Otra migración está en ejecución»).

### 8.2 Cómo examinar `horus_migrations`

Consultas de solo lectura:

```sql
SELECT name, applied_at FROM horus_migrations ORDER BY applied_at, name;
SELECT COUNT(*) FROM horus_migrations;
```

Comparar con la lista de 18 nombres de la sección 4 (no solo el recuento). Estados esperables:

| `horus_migrations` | Significado |
| --- | --- |
| 16 filas, sin `sesiones` ni `preinscripciones` | Estado de partida, o fallo antes de terminar `sesiones` |
| 17 filas (con `sesiones`, sin `preinscripciones`) | `sesiones` terminó y se registró; falló `preinscripciones` |
| 18 filas | Ambas registradas; ejecutar `db:check` y la verificación posterior |
| Un nombre desconocido, duplicado imposible (clave primaria) o ausencia de una anterior | Anomalía: **detener**; no es un caso del ensayo |

La tabla por sí sola no prueba que la estructura exista. Y `db:check` no lee `horus_migrations` (riesgo E). Hay que cruzar ambas fuentes.

### 8.3 Esquema incompleto frente a migración aplicada pero no registrada

Filtrar las líneas de `db:check` por migración:

- **Sesiones:** líneas que empiezan por `sesiones` y las dos de `academico_historial.entidad` / `academico_historial.operacion`.
- **Preinscripciones:** líneas de `preinscripciones`, `preinscripciones_historial`, `convocatorias` (`minimo_apertura`, `preinscripcion_estado`, `codigo_publico`, `convocatorias_codigo_publico_uq`, `convocatorias_minimo_chk`, `convocatorias_codigo_chk`) y `matriculas: falta índice matriculas_id_relaciones_uq`.

| Observación para esa migración | Diagnóstico |
| --- | --- |
| `db:check` aún lista diferencias suyas, falte o no su fila | **Esquema incompleto** (cortes 1–6). Completar según 8.4 |
| `db:check` no lista ninguna suya **y su fila falta** en `horus_migrations` | **Aplicada completa pero no registrada** (cortes 3 y 7) |
| `db:check` no lista ninguna suya y su fila existe | Aplicada y registrada |
| `db:check` lista diferencias suyas **y su fila existe** | Anomalía (alguien alteró la estructura o registró a mano): **detener** |
| Aparecen diferencias de otras tablas o de columnas «no previstas» | Algo ajeno o una tabla incompatible (8.5): **detener** |

Contar diferencias ayuda como contraste, no como criterio: el ensayo mostró 60, 59, 58, 57, 24 y 6 diferencias en los distintos cortes y 94 en la base de partida.

### 8.4 Cuándo es seguro completar una migración

Se puede completar **repitiendo `npm run db:migrate`** (nunca con `INSERT` manual en `horus_migrations` ni ejecutando a mano las sentencias) solo si se cumplen **todas**:

1. Autorización expresa del responsable para ese reintento, tras presentarle el diagnóstico.
2. API y cualquier otro escritor detenidos; sin conexiones ajenas (P6) y sin candado retenido.
3. Respaldo nuevo verificado (P7), tomado **después** del fallo y antes del reintento, para conservar el estado exacto intermedio.
4. El diagnóstico de 8.3 es «esquema incompleto» o «aplicada pero no registrada», y `db:check` no muestra nada ajeno a esas dos migraciones.
5. Las tablas nuevas que ya existen están vacías y son las esperadas (8.5 y 8.6).
6. El caso corresponde a uno de los cortes ensayados (sección 7). Si el estado no se parece a ninguno, detener.

Tras el reintento: `db:check` con «Esquema compatible», 18 filas en `horus_migrations` y la verificación de datos de P13–P15.

### 8.5 Tabla preexistente incompatible

`CREATE TABLE IF NOT EXISTS` **no corrige** una tabla existente con otra forma: `db:migrate` termina con código 0 y registra la versión; solo `db:check` lo delata. Además `db:check` no compara el valor por defecto, el juego de caracteres ni la colación de la tabla (solo columnas, tipos, nulabilidad, índices, claves, CHECK, columna generada y motor InnoDB).

- Antes de migrar (P5): confirmar que `sesiones`, `preinscripciones` y `preinscripciones_historial` **no existen**. Hoy no existen [Comprobado hoy]. Si alguna existe en el momento de la activación, **detener**.
- Si se descubre después de migrar: no ejecutar `DROP` ni `RENAME` por iniciativa propia. Contar filas (solo recuentos), respaldar, restaurar el respaldo en un clon y analizar allí qué es la tabla y de dónde viene. Si está vacía y es un resto de una prueba, quitarla y repetir es una decisión del responsable con ensayo previo en el clon; si tiene filas, ver 8.6.
- Este caso se ensayó **solo con `sesiones`** (tabla de dos columnas): `db:migrate` terminó en código 0 sin corregirla y `db:check` falló con código 1 [Registro de sesión, 7.1]; antes se ensayó también con Docentes. **No se ensayó** con `preinscripciones` ni `preinscripciones_historial`: tratarlo como no probado para ellas.

### 8.6 Las tablas nuevas ya contienen información

Las tablas deben estar vacías al migrar y al revertir. Si no lo están (porque el backend con el código nuevo se arrancó antes de migrar con éxito, o por escritura manual):

1. Detener los escritores y no ejecutar ninguna reversión ni `DROP`.
2. Sacar un respaldo nuevo del estado actual.
3. Medir solo con recuentos (`COUNT(*)` por tabla, por estado y por fecha). `preinscripciones` contiene nombres, correos y teléfonos: **no volcarlos ni copiarlos** a documentos, mensajes ni registros.
4. Decidir con el responsable. Opciones realistas: seguir adelante (completar o dejar la migración) conservando los datos, o restaurar en un clon y analizar. **Borrar o revertir con datos no es una opción de este procedimiento.**
5. Una migración interrumpida que se completa solo agrega estructura; no modifica filas. Aun así, con filas presentes se detiene hasta que alguien las revise.

### 8.7 Reversión manual: qué se ensayó, cuándo es aplicable y cuándo está prohibida

> **ADVERTENCIA: USO RESTRINGIDO.**
>
> 1. La reversión manual **solo es aplicable cuando se cumplen todas sus condiciones previas** (más abajo), comprobadas con recuentos de solo lectura inmediatamente antes de ejecutarla.
> 2. **Está prohibido utilizarla de forma indiscriminada**, y en particular como forma de «deshacer» una activación una vez que existen datos nuevos. Borra tablas y columnas enteras: con datos, destruye información académica y personal (las preinscripciones contienen nombres, correos y teléfonos) que solo se recupera desde un respaldo.
> 3. Con datos nuevos **no se revierte a mano**: se detiene todo, se restaura un respaldo en una base aislada y se decide con el responsable (8.6 y 8.8).
> 4. No es la respuesta a un fallo de `db:migrate`. Primero se diagnostica (8.1 a 8.3); lo previsto es **completar** repitiendo `db:migrate` en los casos ensayados (8.4), no revertir.
> 5. No se ejecuta contra `horus_db` ni `horus_local` sin autorización expresa y específica del responsable.

**Cierre:** la reversión se repitió con la salida archivada (0.3, evidencia 12; salidas 36 a 38): 16 de 16 con las tablas nuevas vacías (incluido el bloqueo de las validaciones cuando hay datos) y 13 de 13 sobre una base con filas académicas ficticias previas, con el `sql_mode` estricto de la sesión comprobado. Los resultados son de clones 8.0.46. **Sigue sin poder aplicarse a `horus_db` sin autorización expresa y específica** y solo con todas las condiciones de abajo. La tabla siguiente describe el ensayo original.

**Estado de la evidencia.** La reversión **sí se ejecutó** en un clon desechable. No se había documentado bien porque no dejó archivo:

| Aspecto | Resultado |
| --- | --- |
| Ejecución | Una vez, el 20 de octubre de 2026 entre las 21:53 y las 21:54 de Lima, con `reversion.cjs` (SHA-256 que empieza por `a03d06f3e09b3ba0`), en la instancia temporal `127.0.0.1:60906` (`server_uuid` que empieza por `c655e2a4`), sobre bases `horus_restore_rev` (tablas nuevas vacías) y `horus_restore_revdatos` (con datos). Nunca contra `horus_db` ni `horus_local` [Registro de sesión] |
| Evidencia archivada | **Ninguna** del resultado: no hay archivo de salida en el directorio privado. Existen el script (carpeta temporal volátil) y la salida impresa en la transcripción. Los archivos de **referencia** con los que se comparó sí están archivados: `huella-clon-ref-0-restaurado.json`, `huella-clon-ref-1-migrado.json` y `dbcheck-origen.txt` |
| Resultado | 16 comprobaciones, 16 correctas, 0 fallos, código de salida 0 [Registro de sesión] |

Qué se comprobó, en orden:

1. **Con tablas nuevas vacías:** restaurar el respaldo, migrar (código 0), las validaciones previas devolvieron cero bloqueos, las 9 sentencias de abajo se ejecutaron sin error, y el estado resultante fue **idéntico** a la huella del respaldo restaurado (`huella-clon-ref-0-restaurado.json`) en datos, DDL, columnas, claves foráneas, CHECK, índices, migraciones y cuentas. `db:check` señaló exactamente las mismas 94 líneas que `dbcheck-origen.txt`. Al volver a migrar (código 0) y ejecutar `db:check` (compatible), la huella quedó idéntica a la del clon migrado de referencia (`huella-clon-ref-1-migrado.json`), salvo `applied_at`.
2. **Con datos:** sobre otra base migrada se insertaron una edición con mínimo y código público, una preinscripción y una fila de historial con `entidad = 'sesion'` y `operacion = 'reprogramacion'`. Las validaciones previas dieron tres bloqueos (historial con valores nuevos del ENUM, preinscripciones con filas y ediciones con datos en las columnas nuevas) y **detuvieron la reversión sin ejecutar DDL**. Además, un `MODIFY` forzado del ENUM de `entidad` falló por diseño con el error 1265 y no cambió nada (huellas idénticas antes y después). Eso demuestra que las validaciones y el ENUM protegen contra el uso incorrecto; **no** demuestra que forzar el resto de la secuencia con datos sea inocuo: no se probó y destruiría los datos.

**Límites del ensayo (no deben darse por probados):**

- La base de partida no tenía filas académicas previas (ni estudiantes, ni ediciones, ni matrículas): se ensayó solo con las tablas nuevas y las columnas nuevas vacías. **Cierre:** el caso con filas académicas ficticias previas se ensayó después (salida 38; las tablas nuevas, vacías).
- Se hizo en una instancia 8.0.46 temporal con credencial administrativa; no prueba los privilegios de la cuenta real (P18) ni el comportamiento con bloqueos de metadatos, tráfico concurrente o tiempos de ejecución.
- La secuencia no se ejecutó dentro de una transacción (el DDL de MySQL confirma implícitamente), así que un fallo a mitad dejaría un estado intermedio. No se ensayó un fallo a mitad de la reversión: si ocurre, se detiene y se diagnostica, no se continúa a mano.
- Las validaciones del script no comprobaban el `sql_mode`; el clon tenía el modo estricto del origen por construcción. **Cierre:** el script nuevo sí lo comprueba (salidas 37 y 38).
- No se ensayó en MySQL 8.4.

Condiciones previas, todas obligatorias (recuentos de solo lectura):

1. Autorización expresa y específica; API detenida; respaldo nuevo verificado (P7).
2. `sesiones`, `preinscripciones` y `preinscripciones_historial`: 0 filas cada una.
3. `academico_historial`: 0 filas con `entidad = 'sesion'` o `operacion = 'reprogramacion'`.
4. `convocatorias`: ninguna fila con `minimo_apertura IS NOT NULL`, `codigo_publico IS NOT NULL` ni `preinscripcion_estado <> 'cerrada'`. El alta de ediciones por la API fija `minimo_apertura = 10` y un código público, así que **cualquier edición creada con el código nuevo ya impide la reversión**.
5. Las dos versiones (`20261020-sesiones-academicas` y `20261020-preinscripciones`) constan en `horus_migrations`. Si no, no es una reversión sino una migración incompleta: 8.3 y 8.4.
6. `sql_mode` de la sesión con `STRICT_TRANS_TABLES` o `STRICT_ALL_TABLES`, de modo que un `MODIFY` de ENUM falle en lugar de vaciar valores (no la comprobaba el script del ensayo).
7. Los tipos originales de los dos ENUM se leen de una copia **sin migrar** del mismo respaldo (como hizo el ensayo) y se comparan con los literales de abajo; si difieren, se detiene.
8. Ensayo previo **con evidencia archivada**: antes de usar la reversión sobre cualquier base real, repetirla en un clon restaurado del respaldo nuevo (P7/P8) guardando la salida y la comparación de huellas. El ensayo del 20 de octubre cuenta como ejecutado, no como evidencia archivada (0.1, tabla B). **Cierre:** para este ensayo la condición se cumplió en un clon del respaldo de cierre (salidas 36 a 38). Para la base real sigue exigiéndose repetirla en un clon del respaldo de la ventana (P7/P8).

**Orden correcto: inverso al de aplicación y respetando dependencias de claves foráneas.**

Dependencias: `preinscripciones_historial` → `preinscripciones` → (`convocatorias`, `matriculas` mediante `matriculas_id_relaciones_uq`, `admin_users`); `sesiones` → (`convocatorias`, `docente_asignaciones`). Las dos migraciones son independientes entre sí, pero no se revierte una sola cuando `db:migrate` volvería a aplicarla en la siguiente ejecución.

Las **9 sentencias ensayadas**, en el orden en que se ejecutaron [Registro de sesión; derivadas del script `reversion.cjs`]. Primero **Preinscripciones** (migración 18):

```sql
DROP TABLE `preinscripciones_historial`;   -- hijo: primero
DROP TABLE `preinscripciones`;             -- libera las FK hacia convocatorias, matriculas y admin_users
ALTER TABLE `convocatorias`
  DROP CHECK `convocatorias_minimo_chk`, DROP CHECK `convocatorias_codigo_chk`,
  DROP INDEX `convocatorias_codigo_publico_uq`,
  DROP COLUMN `minimo_apertura`, DROP COLUMN `preinscripcion_estado`, DROP COLUMN `codigo_publico`;
ALTER TABLE `matriculas` DROP INDEX `matriculas_id_relaciones_uq`;   -- solo tras borrar preinscripciones (la FK compuesta lo usa)
DELETE FROM horus_migrations WHERE name = '20261020-preinscripciones';
```

Después **Sesiones** (migración 17):

```sql
DROP TABLE `sesiones`;
ALTER TABLE `academico_historial` MODIFY `entidad` ENUM('estudiante','convocatoria','matricula','certificado','docente','asignacion_docente') NOT NULL;
ALTER TABLE `academico_historial` MODIFY `operacion` ENUM('creacion','edicion','archivado','restauracion','cambio_estado','anulacion','confirmacion','emision','sustitucion') NOT NULL;
DELETE FROM horus_migrations WHERE name = '20261020-sesiones-academicas';
```

Notas sobre estas sentencias:

- En el ensayo, los tipos de los dos ENUM no se escribieron a mano: se leyeron de `information_schema` en una copia del mismo respaldo sin migrar. Los literales de arriba coinciden con los de las migraciones `20261015-academico-estructura` y `20261020-docentes` (releídas hoy), pero la comprobación contra una copia sin migrar sigue siendo la condición 7.
- El `ALTER` de `convocatorias` es **una sola sentencia** con los seis cambios. La versión anterior de este documento proponía otra secuencia, con los dos CHECK, el índice y las tres columnas en `ALTER` separados (12 sentencias en total). **Esa variante nunca se ensayó y se retira**; vale la de arriba, que es la ensayada.
- Se conserva la restricción de no tocar las columnas `capacidad` y similares de `20261018-convocatorias-capacidad`.
- Tras ejecutarla en un clon, la comprobación es la del ensayo: huella idéntica a la previa a migrar, `db:check` con las 94 diferencias esperadas, nueva migración (código 0) y huella idéntica a la del clon migrado de referencia.

### 8.8 Cómo restaurar un respaldo en un clon nuevo

La restauración **nunca** se hace sobre `DB_NAME` (el comando lo impide) y el destino debe llamarse `horus_restore_<nombre>`. Para que el clon sea verdaderamente aislado y no solo otra base del mismo servidor:

1. `npm run db:restore -- --file=<ruta del .sql.gz> --verify-only` (no se conecta). Debe confirmar firma y sentencias permitidas.
2. Levantar una instancia aislada del **mismo ejecutable MySQL 8.0.46**: `--no-defaults`, directorio de datos temporal propio, **solo loopback** (`127.0.0.1`), puerto distinto de 3306 y de cualquier servicio existente, usuario y contraseña efímeros que no se escriben en archivos del repositorio. Evitar rutas con espacios en `--basedir` (provocó fallos en la activación de Docentes). Configurar el mismo `sql_mode` que el servidor real.
3. Antes de ejecutar nada contra el clon, una guarda que **aborte** si `@@server_uuid` es el del real o `@@port` es 3306. Los comandos del procedimiento solo se lanzan a través de esa guarda.
4. `npm run db:restore -- --file=<...> --target=horus_restore_<nombre> --yes` con `DB_HOST`, `DB_PORT`, `DB_USER` y `DB_PASS` apuntando al clon. El éxito exige código 0, recuentos verificados y la línea de integridad referencial sin filas huérfanas.
5. Comparar huellas contra el origen (filas y contenido por tabla, DDL, columnas, claves, CHECK, índices, colaciones, motor, AUTO_INCREMENT, cuentas y migraciones). Diferencia aceptable y conocida: `rate_limit_buckets` sin filas.
6. En el clon (con `DB_NAME=horus_restore_<nombre>`), `db:check` debe mostrar las diferencias esperadas de un esquema anterior (94 en el estado actual) y `db:migrate` + `db:check` deben terminar en «Esquema compatible».
7. Restaurar los archivos subidos con `uploads:restore` en una carpeta nueva y comparar los 35 SHA-256.
8. Al terminar: apagar la instancia con `SHUTDOWN` tras confirmar su identidad, borrar solo su directorio de datos, su copia de uploads y su credencial efímera. No borrar respaldos ni nada que no se haya creado en esa ejecución.

Una restauración parcial deja una base incompleta que hay que eliminar a mano (no se reintenta sobre ella); una restauración fallida conserva el destino para revisarlo y nunca debe promoverse.

## 9. Lista de verificación para la activación real

**Regla única: la ausencia, el fallo o la duda sobre cualquiera de estas comprobaciones detiene el procedimiento.** No hay comprobaciones opcionales. Se registra el resultado de cada una con fecha y hora; no se copian valores sensibles (UUID completo, credenciales, datos personales).

La columna «Hoy» indica lo que ya se pudo ver al redactar este documento; **no sustituye** la verificación en el momento de la activación.

| Id | Comprobación obligatoria | Cómo verificarla (solo lectura) | Resultado exigido | Hoy |
| --- | --- | --- | --- | --- |
| P1 | Rama `anderson` y commit `ea402c4` | `git branch --show-current`; `git rev-parse HEAD`; `git status --short` | Rama `anderson`, HEAD `ea402c480f473073f5cd8e2d5523cec05dd3c598`, igual a `origin/anderson`. Sin cambios sin revisar en `backend/scripts/`, `backend/migrations/`, `backend/src/` ni `backend/prisma/`. La modificación de `backend/tsconfig.json` debe resolverse o aceptarse por escrito (12.3) | HEAD correcto; `tsconfig.json` modificado: **abierto** |
| P2 | CI aprobada para ese commit | Número de ejecución y conclusión `success` de `Backend`, `Frontend` e `Integración (MySQL efímero)` (incluidos los pasos `sesiones` y `preinscripciones`) | `success` para el SHA exacto, anotado por el responsable | **No verificado**: `gh` no está autenticado en esta sesión; lo informa el responsable |
| P3 | `server_uuid` y versión de MySQL | `SELECT @@version, LEFT(@@server_uuid, 8);` | `8.0.46` y prefijo `dc5bb32a`; el valor completo coincide con el registrado en la activación de Docentes | Coincide |
| P4 | Base `horus_db` y puerto 3306 | `SELECT DATABASE(), @@port;` y comprobar `DB_HOST`/`DB_NAME` sin mostrar credenciales | `horus_db`, `3306`, anfitrión local esperado. Ningún `.env` apunta a Railway ni a otra base | `horus_db`, `3306` |
| P5 | Solo dos migraciones pendientes y nada preexistente | `SELECT name FROM horus_migrations;` frente a la lista de la sección 4; existencia de las 3 tablas, columnas, índice y ENUM nuevos | 16 filas hasta `20261020-docentes`; pendientes exactamente `sesiones-academicas` y `preinscripciones`; **ninguna** tabla, columna, índice ni ENUM nuevo preexiste | Cumple |
| P6 | Escritores y conexiones activas | `SHOW PROCESSLIST;` `Threads_connected`; procesos NestJS/PHP/ngrok; conexiones TCP establecidas a 3306; eventos | Solo la propia sonda y el demonio `event_scheduler`; `Threads_connected = 1`; ninguna API ni cliente; 0 eventos. Se repite justo antes de respaldar y justo antes de migrar. Toda conexión desconocida detiene todo | Cumple (1 sesión, 0 eventos) |
| P7 | Respaldo **nuevo** previo a la migración | `db:backup` y `uploads:backup` en la ventana, después de P6, en un directorio privado; `--verify-only`; SHA-256 calculado aparte; manifiesto con 16 migraciones y `8.0.46` | Respaldo creado, verificado y emparejado con su copia de archivos. **No se reutiliza el del ensayo** (`…-20261021-022934`) | El respaldo de cierre (0.3) existe y está verificado, pero **no sirve para la activación**: falta el de la ventana |
| P8 | Restauración comprobada en clon | Procedimiento 8.8 aplicado **a ese respaldo nuevo** | Huellas idénticas salvo `rate_limit_buckets`; `db:restore` con integridad referencial correcta; ver además la regla de repetición abajo | Hecha con el respaldo de cierre (0.3, salidas 14 a 35); se repite con el de la ventana |
| P9 | `db:check` previo | `npm run db:check` desde `backend/` | Código **1** con exactamente las diferencias esperadas de las dos migraciones (94 hoy). Cualquier línea ajena, o código 0, detiene | Idéntico al del ensayo y al del clon (0.3, salidas 17 y 18) |
| P10 | Huella previa de `horus_db` | Huella de filas y contenido por tabla, DDL, columnas, claves, CHECK, índices, colaciones, AUTO_INCREMENT, cuentas y migraciones, tomada justo antes y justo después del respaldo | Idénticas entre sí y a la del respaldo (salvo `rate_limit_buckets`) | Tomada tres veces en el cierre (previa, posterior al respaldo y final), idénticas entre sí y a la del ensayo (0.3, salidas 02, 05 y 40) |
| P11 | **Autorización separada** para `db:migrate` | Mensaje expreso del responsable que nombre commit, base, ventana y respaldo | Existe, es posterior a P1–P10 y refiere a este documento. **Sin ella no se ejecuta `db:migrate`** | No concedida |
| P12 | Ejecución de `db:migrate` | `npm run db:migrate` desde `backend/`, una sola vez, con la API detenida | Código 0 y mensaje «Migraciones aplicadas». Ante cualquier otro resultado: sección 8, sin reintento automático | — |
| P13 | `db:check` posterior | `npm run db:check` | Código 0 y «Esquema compatible» | — |
| P14 | Las 18 versiones en `horus_migrations` | Comparar el conjunto de nombres con la lista de la sección 4 (no solo el recuento) | 18 filas, exactamente esas 18, con `20261020-sesiones-academicas` y `20261020-preinscripciones` registradas. **No lo comprueba `db:check`** (riesgo E) | — |
| P15 | Conservación de datos originales | Huella posterior frente a la previa (P10) | Las 25 tablas originales con filas y contenido idénticos; solo cambia `horus_migrations` (+2 filas); DDL distinto únicamente en `academico_historial`, `convocatorias` y `matriculas`; las 14 cuentas, la activa con `GERENTE_GENERAL` y `session_version 2`; 35 archivos subidos sin cambios | — |
| P16 | Restricciones e índices | Recuento de claves, CHECK e índices y comprobación nominal en `information_schema` | Mismo patrón del ensayo: columnas de FK 19→28, CHECK 26→43 (todos `ENFORCED = YES`), únicos 87→95, índices 139→174; `vigente_email` STORED GENERATED; las tres tablas nuevas con 0 filas, InnoDB y `utf8mb4_unicode_ci` | — |
| P17 | `TRUSTED_PROXY_CIDRS` | Comprobar presencia y validez **sin mostrar el valor** en el entorno donde corra el backend | Enumera exactamente los proxies reales (Railway/Caddy) del entorno, confirmados por el proveedor. Si falta o es dudoso, no se arranca el backend ni se expone ninguna ruta pública (ver gestión de preinscripciones, §6.1 y §12) | **No verificado** |
| P18 | Conectividad y permisos de MySQL | Privilegios de la cuenta de `db:migrate` (`CREATE`, `ALTER`, `INDEX`, `REFERENCES`) y de la cuenta del backend sobre las tablas nuevas; conectividad desde el entorno del backend | Ambos confirmados antes (privilegios) y después (acceso a las tablas nuevas), sin mostrar credenciales | **No verificado** |
| P19 | Arranque del backend solo después de migrar | Orden: P13–P16 correctos → `npm run build` nuevo del commit con Node 22.x → arranque. Verificación inicial solo de lectura: `GET /api/health`; 401 sin sesión en `/api/admin/sesiones` y `/api/admin/preinscripciones`; `GET /api/preinscripciones/convocatorias` con lista vacía | Ningún `P2021`/`P2022` en el registro. **No** enviar preinscripciones de prueba a la base real | — |

**Regla de repetición del ensayo.** El ensayo completo no se repite si, el día de la activación, **todo** esto es cierto: mismo commit, misma versión y `server_uuid` de MySQL, y la huella de `horus_db` (sin `rate_limit_buckets`) igual a `huella-origen-0-previa.json`. Si cambia cualquiera, hay que repetir el ensayo completo (restauración, migración, `db:check` y fallos parciales) en un clon nuevo. La restauración del respaldo nuevo (P8) se hace siempre. Esta regla es una propuesta que debe aprobar el responsable.

## 10. Riesgos residuales

### A. Credencial administrativa y MySQL expuesto en todas las interfaces

Según el responsable, MySQL se usa con una credencial administrativa, y hoy el servicio escucha en todas las interfaces (`bind_address = *`, escucha en `::`) [Comprobado hoy]. Consecuencias: cualquier equipo de la red que alcance el puerto 3306 puede intentar autenticarse; un fallo de ejecución en la API tendría el alcance de una credencial con privilegios de administración; no se puede **imponer** la ventana sin escritores (solo comprobar su ausencia). La migración es aditiva, de modo que una escritura concurrente no se perdería ni corrompería, pero el riesgo permanece.

Endurecimiento propuesto para una tarea posterior **que no forma parte de esta** (ni se cambió ninguna credencial, usuario, servicio ni regla de firewall aquí):

1. Dos usuarios dedicados: uno para migraciones (`CREATE`, `ALTER`, `INDEX`, `REFERENCES`, `DROP` solo si se decide) usado de forma puntual, y uno de aplicación con `SELECT`, `INSERT`, `UPDATE`, `DELETE` limitados a `horus_db`. Retirar la credencial administrativa de los archivos de entorno de la aplicación.
2. Limitar el acceso de red: `bind-address` a loopback, o regla de firewall que permita 3306 solo desde las direcciones necesarias, o ambas. Cualquier cambio de `bind_address` exige reiniciar el servicio (interrupción) y debe ensayarse antes.
3. Exigir TLS para las conexiones no locales y rotar la credencial administrativa después de comprobar dónde se ha usado.
4. A más largo plazo, usuarios separados para el chatbot y para el alta pública (ya descrito en [Gestión de preinscripciones](gestion-preinscripciones.md#7-aislamiento-del-chatbot)).
5. Ensayar en un clon, con plan de vuelta atrás documentado, y con autorización expresa.

### B. Respaldos sin cifrar

Los respaldos no están cifrados [Comunicado; coincide con la documentación]. El `.sql.gz` contiene datos de las cuentas administrativas (identificadores, correos y hashes de contraseñas); el SHA-256 solo detecta daños accidentales y **no autentica el origen**. Hasta que exista una política oficial:

- Mantenerlos únicamente en el directorio privado del responsable (hoy `%USERPROFILE%\.horus-respaldos\`, con ACL solo para su usuario y SYSTEM, fuera de OneDrive [Comprobado hoy]); **no subirlos a la nube ni moverlos**, no enviarlos por canales no corporativos y no incluirlos en Git.
- Designar un custodio y registrar quién puede leer y restaurar. Comprobar si el volumen está cifrado (BitLocker u otro): no consta.
- Cifrar antes de cualquier traslado o copia externa, con la herramienta que apruebe Horus y con la clave guardada **por separado**. Guardar el SHA-256 en un lugar distinto si se necesita autenticidad.
- Retención y destrucción segura: **[PENDIENTE DE APROBACIÓN]** (cuántas copias, cuánto tiempo, quién destruye). No se borra ningún respaldo en esta tarea, incluidos los tres directorios existentes (`activacion-academica-20261019`, `activacion-docentes-20261020` y el del ensayo).

### C. Las pruebas HTTP usaron un `dist` existente y Node 24

Las pruebas HTTP del clon se ejecutaron con el `dist` existente, que el informe del ensayo describe como más reciente que `src` pero **sin recompilar** (eso no prueba que corresponda al código fuente de `ea402c4`), y con Node **24.19.0** [Registro de sesión; el Node local de hoy es esa versión]. La CI del commit ya comprobó Node 22 (el proyecto declara 22.x) con MySQL 8.4 [Comunicado; no verificado hoy]. Por tanto:

- Los resultados del clon prueban el esquema 8.0.46 y el comportamiento de **un** build previo; **no prueban** que el código fuente de `ea402c4`, compilado con Node 22, se comporte igual.
- La migración **no depende de `dist`**: `migrate.cjs` y `check-database.cjs` usan solo `scripts/` y `migrations/`. El riesgo recae en el arranque del backend, no en la migración.
- Mitigación (P19): `npm run build` nuevo del commit con Node 22.x antes de arrancar, y, preferiblemente antes de pedir la autorización, repetir la batería funcional en un clon con ese build. La modificación sin confirmar de `backend/tsconfig.json` (12.3) podría alterar el build y debe aclararse antes de compilar.

### D. La API de pruebas escuchó brevemente en todas las interfaces

Hallazgo del informe original del ensayo: en las primeras ejecuciones la API de pruebas escuchó durante unos minutos en todas las interfaces (`::`), con datos ficticios y sin ser el puerto del clon [Registro de sesión]. Causa verificable en el código: `backend/src/main.ts` llama a `app.listen(port)` sin dirección, por lo que Node escucha en `::`/`0.0.0.0`; no hay variable de entorno que limite la dirección. La última ejecución sí se comprobó escuchando solo en `127.0.0.1:49874` [Evidencia: `func-test-salida.txt`]. El mecanismo fue el arnés: `guard.cjs` (líneas 62 a 66) sustituye `net.Server.prototype.listen` en el proceso de prueba para forzar el enlace a loopback, sin tocar el código de la aplicación [script volátil, releído hoy]. No hay constancia de ninguna conexión externa en esa ventana, ni forma de comprobarla ahora.

Requisitos para todo entorno temporal futuro (API, MySQL aislado o servidor de pruebas): **escuchar únicamente en loopback**, con una verificación obligatoria **antes** de enviar tráfico (sockets en escucha de ese proceso solo en `127.0.0.1`/`::1`); si aparece `0.0.0.0` o `::`, se detiene y no se continúa. Con el código actual eso se consigue desde el entorno (por ejemplo un contenedor publicado como `127.0.0.1:<puerto>:<puerto>`), no desde la aplicación. Una mejora en código (`app.listen(port, host)`) queda como propuesta fuera de esta tarea. Las cuentas del clon eran ficticias.

### E. El historial de migraciones se comprueba aparte de `db:check`

`check-database.cjs` **no lee `horus_migrations`**. El corte 7 del ensayo lo demuestra: una migración aplicada completa y sin registrar da código 0. A la inversa, registrar a mano una versión no hace que `db:check` falle por eso. Por tanto, tras migrar son obligatorias las dos cosas: `db:check` con código 0 **y** la comparación del conjunto de 18 nombres (P14). Un script o una mejora de `db:check` queda fuera del alcance (no se modifica ningún script).

### Otros riesgos residuales

1. **Base de partida casi vacía.** `horus_db` no tiene ediciones, matrículas ni estudiantes [Comprobado hoy], de modo que los `ALTER` de `matriculas` y `convocatorias` se ejecutarán sobre tablas vacías, igual que en el ensayo de las migraciones del respaldo. Si al activar hay filas, los `ALTER` son aditivos (índice sobre `id`, columnas con valor neutro) y no debieran fallar. Esa variante **sí se ensayó** en el clon 8.0.46 con datos ficticios previos (sección 3, 12 comprobaciones correctas, [Registro de sesión]) y la integración del 8.4 también migra desde una base con datos; lo que no se ensayó con datos es la **reversión**.
2. **8.0.46 frente a 8.4.** Toda la integración automatizada y la CI usan MySQL 8.4; el servidor real es 8.0.46. El ensayo en el clon cubre esa diferencia solo en lo que se ha registrado (sección 5).
3. **Evidencia archivada: cerrada en el cierre del 20 de octubre (noche), ver 0.3.** Texto previo al cierre, que ya no describe el estado actual: la reversión manual (8.7), la batería de 66 sondas SQL (sección 5), la identidad del clon, `--verify-only`, `db:restore` y el `db:check` posterior **se ejecutaron**, pero su resultado solo consta en el registro de sesión y en scripts volátiles, no en el directorio privado (0.1, tabla B). La reversión además se ensayó solo con tablas nuevas vacías y sin filas académicas previas.
4. **DDL no transaccional y bloqueos de metadatos** (8.1): una conexión o transacción olvidada sobre `matriculas` o `convocatorias` puede dejar el `ALTER` esperando; no se terminan procesos ajenos.
5. **Partición por `;`:** `migrate.cjs` separa las sentencias con `;`. Un punto y coma dentro de un literal de una migración futura rompería la ejecución. Hoy ningún literal de estas dos migraciones lo contiene.
6. **CI no verificada** desde esta sesión (P2).
7. **Datos personales tras el arranque.** Las rutas públicas de preinscripción solo aceptan datos para ediciones con la recepción abierta, y toda edición nace con la recepción cerrada y `horus_db` no tiene ediciones; aun así quedan pendientes el aviso de privacidad, el plazo legal de retención y `TRUSTED_PROXY_CIDRS` (decisión 1 de [Gestión de preinscripciones §11](gestion-preinscripciones.md#11-decisiones-de-negocio-pendientes-no-inventadas)). No se debe abrir ninguna recepción real antes de resolverlos.
8. **Permisos de Coordinación y Secretaría** solo probados con cuentas ficticias (sección 6).
9. **El respaldo del ensayo envejece.** No debe reutilizarse para la activación ni para una recuperación posterior a esa fecha. Lo mismo vale para el respaldo de cierre.
10. **El respaldo de cierre no es una verificación independiente.** Tiene el mismo SHA-256 que el del ensayo (0.3): confirma que `horus_db` no cambió entre las dos tomas, pero son dos copias del mismo contenido. Ninguno de los dos cubre cambios posteriores.
11. **La evidencia es verificable solo con acceso al directorio privado.** Los scripts del arnés se archivaron junto a las salidas (con SHA-256), pero dependen de rutas absolutas de este equipo y de los scripts originales del repositorio en `ea402c4`. Si cambian `migrate.cjs`, `check-database.cjs`, `restore.cjs` o las migraciones, la evidencia deja de corresponder al código y hay que repetirla (regla de repetición, sección 9).
12. **Diferencias entre el clon y el servidor real.** El clon tuvo `log_bin` y `event_scheduler` apagados y una credencial administrativa propia; el real los tiene encendidos (con 0 eventos definidos) y usa la suya. El DDL de la activación quedará en el registro binario del servidor real, algo que el ensayo no ejercitó.
13. **Documentación inconsistente fuera de este documento.** `backup-restauracion.md` dice que `db:restore` sin `--yes` «solo informa», pero el comando termina con código 1. No cambia la seguridad (no crea nada); conviene precisarlo en un commit de documentación posterior.
14. **Pruebas HTTP del ensayo original sin repetir.** No se repitieron en el cierre (0.3, nota 5); sus límites (riesgo C) siguen vigentes.

## 11. Condiciones de aprobación y criterios para detener

### Para poder pedir la autorización de `db:migrate` sobre `horus_db` deben cumplirse todas

1. El responsable ha revisado este documento y confirmado su contenido, incluidas las marcas [Comunicado] y [Registro de sesión].
2. Las lagunas están cerradas o aceptadas por escrito. **Cierre (0.3): las lagunas de evidencia que describe este punto se cerraron con salida archivada; sigue pendiente la confirmación de la CI.** El texto original continúa: La identidad del clon (`c655e2a4`, puerto 60906, `sql_mode`) ya consta en el registro de sesión, pero **no en un archivo**; la batería SQL de 66 sondas, la reversión manual, `--verify-only`, `db:restore` y el `db:check` posterior se ejecutaron **sin salida archivada** (0.1, tabla B y 0.2). Queda pendiente la confirmación de la CI del SHA `ea402c4`. El responsable decide si acepta el registro de sesión como evidencia suficiente o si exige repetirlas con la salida archivada.
3. La modificación de `backend/tsconfig.json` está resuelta o aceptada, y el árbol de trabajo está en el estado que se quiere desplegar.
4. P1–P10 verificados en la ventana de mantenimiento, con el respaldo nuevo (P7) restaurado en un clon (P8).
5. El responsable ha decidido qué se hace ante un fallo y asume que, si hay datos académicos nuevos, la recuperación es **restaurar un respaldo en una base aislada**, no revertir a mano.
6. El responsable ha decidido el estado de la reversión manual (8.7): ensayada en clones con evidencia archivada (16 de 16 con tablas nuevas vacías y 13 de 13 con filas académicas previas; 0.3), pero **solo en clones 8.0.46 y con credencial administrativa**. Aun disponible, solo se aplica si se cumplen todas sus condiciones previas, con autorización expresa y específica, y nunca de forma indiscriminada con datos nuevos. Antes de usarla sobre una base real se repite en un clon del respaldo de la ventana (condición 8 de 8.7).
7. Existe la autorización separada y expresa (P11).

### Se detiene la intervención, sin continuar ni «arreglar sobre la marcha», si ocurre cualquiera de estas

1. Falta, falla o no puede verificarse cualquier comprobación obligatoria de la sección 9.
2. El commit, la rama, la versión de MySQL, el `server_uuid`, el puerto o la base no coinciden con lo esperado.
3. Hay una conexión, un proceso, un evento programado o un cliente remoto desconocido, o aparece un candado de migración retenido.
4. `horus_migrations` no tiene exactamente las 16 filas de partida, o `db:check` previo muestra una línea ajena a las dos migraciones, o muestra código 0.
5. Existe alguna de las tres tablas nuevas, alguna de las columnas, el índice o el valor de ENUM que debían faltar.
6. El respaldo nuevo no verifica, no coincide con la huella o no se restaura bien en el clon.
7. `db:migrate` termina con código distinto de 0, se queda esperando o aparece un 503 neutro de esquema pendiente tras migrar.
8. `db:check` posterior no termina en «Esquema compatible», o faltan filas en `horus_migrations`, o cambia el contenido de una tabla original.
9. Alguna tabla nueva contiene filas antes de arrancar el backend.
10. `TRUSTED_PROXY_CIDRS`, la conectividad o los privilegios de MySQL no están confirmados al arrancar el backend.
11. Un secreto o un dato personal se expone por accidente: detener, avisar en el momento y recomendar rotar.

Ante una parada: no reintentar, no borrar nada, conservar el estado, tomar respaldo si no se hizo, registrar el diagnóstico (8.1–8.3) y pedir instrucciones.

## 12. Verificación documental

### 12.1 Concordancia con los scripts

| Elemento | Resultado |
| --- | --- |
| `migrate.cjs`: 18 versiones, orden `docentes` → `sesiones-academicas` → `preinscripciones`, tolerancias 1060/1061/3822 solo en `preinscripciones`, candado `horus_catalogo_migrations`, inserción del registro tras las sentencias | Coincide con las secciones 4 y 7 |
| `check-database.cjs`: esperado por tabla, columnas, ENUM, índices, claves foráneas, CHECK, columna generada `vigente_email`, motor InnoDB; **no** lee `horus_migrations`, no compara valores por defecto ni juego de caracteres de tabla | Coincide; origen de los riesgos E y de 8.5 |
| `package.json` del backend: `db:migrate`, `db:check`, `db:backup`, `db:restore`, `uploads:backup`, `uploads:restore` | Existen con esos nombres |
| `backend/migrations/20261020-sesiones-academicas.sql` (3 sentencias, 8 CHECK) y `20261020-preinscripciones.sql` (4 sentencias, 9 CHECK: 4 + 3 en sus tablas y 2 en `convocatorias`) | Coincide con los recuentos de las huellas (8 + 9 = +17 CHECK) |
| Recuentos del ensayo: 18 migraciones; fks 19→28; CHECK 26→43; únicos 87→95; índices 139→174 | Coherentes con el contenido de las migraciones |

### 12.2 Concordancia con los documentos

| Documento | Concuerda | No concuerda o está desactualizado |
| --- | --- | --- |
| [Gestión de preinscripciones](gestion-preinscripciones.md) §8 | Cuatro sentencias; tolerancias 1060/1061/3822; las dos migraciones pendientes; nunca el código antes que las migraciones; `TRUSTED_PROXY_CIDRS` antes de exponer; orden previsto (respaldo, ensayo, detener backend, `db:migrate`, `db:check`, proxies, arranque) | Sigue diciendo «probados en un MySQL 8.4 desechable» y no menciona el ensayo en el clon 8.0.46 ni este documento |
| [Horarios y sesiones](horarios-sesiones-academicas.md), «Migración y activación» | Tres sentencias; idempotencia; `db:check` señala los ENUM; reversión manual de la tabla y los ENUM con autorización (coincide con 8.7) | (a) Dice que la migración de sesiones es la «última de `versions`»: ya no, la última es `preinscripciones`. (b) Dice que `db:check` previo debe señalar «únicamente» `sesiones` y los dos ENUM: con las dos migraciones pendientes son 94 diferencias que incluyen `preinscripciones`, `convocatorias` y `matriculas`. (c) Su orden de activación (pasos 1–7) no considera la segunda migración ni `horus_migrations`. Este documento prevalece para esta activación conjunta |
| [Gestión de docentes](gestion-docentes.md) línea 13 | — | Dice que `20261020-docentes` es «última de `versions`»: desactualizado, por la misma razón |
| [Respaldo y restauración](backup-restauracion.md) | Nombres de comandos y banderas; patrón `horus_restore_<nombre>`; destino nunca igual a `DB_NAME`; verificación de integridad referencial; `rate_limit_buckets` sin datos; cifrado, custodia y retención aún pendientes (riesgo B) | — |
| [Activación real de Docentes](activacion-docentes-mysql-real.md) | Identidad del servidor (8.0.46, prefijo `dc5bb32a`, `MySQL80`, 3306); estructura de la puerta final; cifras de la copia de archivos (35 archivos, 17 588 756 bytes); 16 migraciones y 14 cuentas | Las cifras del respaldo difieren (25 tablas/145 filas frente a 27 tablas/148 filas) de forma coherente: +2 tablas de docentes y +1 fila de `horus_migrations` |

No se modificó ningún documento existente: las discrepancias anteriores quedan **señaladas, no corregidas**, porque la tarea solo autoriza crear este documento. Convendría actualizarlas en un commit de documentación posterior, con la activación real ya hecha.

### 12.3 Contradicciones y bloqueos que quedan abiertos

1. **`backend/tsconfig.json` modificado en el árbol de trabajo** (quita `baseUrl` y `moduleResolution` y añade espacios al final de una línea). No es de esta tarea y **no se tocó**. Afecta a la compilación (riesgo C) y a la condición de «árbol limpio» de P1. Debe resolverlo quien lo modificó.
2. **[Cerrado en el cierre, 0.3] Evidencia del ensayo incompleta (no inexistente):** texto previo al cierre: no hay archivo con la identidad del clon, la salida de `--verify-only` y de `db:restore`, la salida del `db:check` posterior, la batería SQL de 66 sondas ni la reversión manual. Todas se ejecutaron y constan en el registro de sesión (0.1, tabla B). Pendiente: archivarlas repitiéndolas o decidir que el registro basta.
3. **[Cerrado en el cierre, 0.3: reversión repetida con evidencia archivada, también con filas académicas previas]** Texto previo al cierre: **reversión manual ensayada una vez, sin evidencia archivada** y solo con las tablas nuevas vacías y sin filas académicas previas (8.7). Su estado corregido sustituye a la afirmación anterior de este documento («no se ha ejecutado ni ensayado»). La documentación de [Horarios y sesiones](horarios-sesiones-academicas.md) la menciona solo para Sesiones y en prosa; la de Preinscripciones se derivó invirtiendo la migración y no figura en [Gestión de preinscripciones](gestion-preinscripciones.md).
4. **CI no verificable** desde esta sesión.
5. **8.0.46 frente a 8.4:** las pruebas automatizadas no usan el motor del servidor real.

## 13. Qué se hizo y qué no al redactar este documento

**Hecho (solo lectura):** lectura de `migrate.cjs`, `check-database.cjs`, `database.cjs`, las dos migraciones y la documentación enumerada; estado de Git; listado y lectura de los archivos de texto y de huellas del directorio del ensayo (no se abrió ningún `.sql.gz` ni archivo subido); cálculo de SHA-256 del respaldo y del manifiesto de archivos; consulta de ACL; una sonda de solo lectura contra `horus_db` en sesión `READ ONLY` (identidad, migraciones, existencia de objetos nuevos, recuentos, sesiones activas) y `npm run db:check`, que no modifica datos.

**No hecho:** ninguna migración, respaldo ni restauración nuevos; ninguna escritura en `horus_db` ni `horus_local`; no se abrió ni modificó `.env`; no se tocaron configuración de MySQL, firewall, servicios, credenciales, scripts, código, `backend/tsconfig.json`, frontend ni chatbot; no se arrancó ningún servicio; no se borró ningún respaldo; no se hizo commit ni push. **En la primera redacción** no se ejecutó ninguna reversión; **en la conciliación tampoco** (el ensayo del 20 de octubre sí la ejecutó, en un clon, ver 8.7).

### 13.1 Qué se hizo en la conciliación de evidencias (segunda revisión)

**Hecho (solo lectura, más la edición de este documento):**

- Lectura de este documento y listado, con tamaños y fechas, del directorio privado del ensayo; lectura de los archivos de texto (`parciales-salida.txt`, `func-test-salida.txt`) y de la clave de columnas de las huellas. No se abrió ningún `.sql.gz`, ningún archivo subido ni el contenido de ningún respaldo, y no se modificó nada en ese directorio.
- Lectura de dos scripts del ensayo (`reversion.cjs`, `recuperar.cjs`), búsquedas puntuales en otros tres, y cálculo de SHA-256 de nueve scripts del arnés, todo en su carpeta temporal.
- Consulta de fragmentos de la transcripción de la sesión del ensayo y de la sesión que redactó este documento, con redacción automática de claves y contraseñas. No se imprimió ninguna credencial.
- Lectura de las migraciones `20261015-academico-estructura`, `20261020-docentes` y `20261020-sesiones-academicas` solo para confirmar los literales de los ENUM, y búsquedas de texto en `gestion-preinscripciones.md`.
- Inspección de Git: rama, HEAD, `origin/anderson` (con `git ls-remote`), estado, diferencia de `backend/tsconfig.json` y lista de stashes.
- Comprobación de que no quedan carpetas `horus-ensayo-*` en la carpeta temporal ni los procesos del clon (listado de procesos `mysqld`, sin tocarlos).

**No hecho:** ninguna conexión a ninguna base de datos (ni `horus_db`, ni `horus_local`, ni clon alguno); ninguna restauración, migración, reversión ni respaldo; ningún servidor arrancado; no se tocó `.env`, el backend, el frontend ni `backend/tsconfig.json`; no se copió ni movió ningún script o salida al directorio privado; no hay commit ni push.

### 13.2 Qué se hizo en el cierre de evidencias (tercera revisión)

**Hecho (con autorización expresa para el respaldo nuevo y los ensayos en clones aislados):**

- Verificaciones iniciales de solo lectura: rama `anderson`, HEAD `ea402c4`, dos migraciones pendientes, destino `127.0.0.1:3306/horus_db`, UUID (prefijo `dc5bb32a`), versión `8.0.46`, tablas, ausencia de escritores y de candado de migración (salidas 01 a 03). Línea base de Git, de los dos stashes y de los respaldos anteriores, para comprobar al final que nada cambió.
- Respaldo nuevo de la base (`db:backup`, que solo lee) y de los archivos subidos (`uploads:backup`), con `--verify-only`, SHA-256 independiente y manifiesto, en un directorio privado nuevo.
- Una instancia aislada de MySQL 8.0.46 (mismo ejecutable, solo `127.0.0.1`, puerto distinto del 3306, directorio de datos propio, UUID propio, credencial efímera, guardia de identidad antes de cada conexión), y en ella: restauraciones, migraciones, `db:check`, huellas, 66 comprobaciones SQL, migración con datos ficticios, recuperación, reversiones y restauración de uploads (secciones 0.3 y salidas 04 a 47).
- Apagado y eliminación del clon, comprobación de restos y de lo preservado (salida 48), índice SHA-256 de todo lo archivado.
- Corrección de **una** línea del arnés de recuperación (expectativa errónea, 0.3 nota 1) y de **una** comprobación de un script nuevo mío (nota 2). No se cambió ningún archivo del repositorio salvo este documento.
- Actualización de este documento (único archivo del repositorio modificado en el cierre).

**No hecho:**

- Ninguna migración, DDL, reversión, escritura ni cambio sobre `horus_db`, `horus_local` ni el puerto 3306 (solo lecturas y `db:backup`). No se tocó `horus_local`.
- No se mostró ni modificó `.env` (solo lo cargan, como siempre, los scripts del repositorio al conectarse al servidor real); no se tocaron `MySQL80`, su firewall, credenciales, scripts, código, `backend/tsconfig.json`, frontend ni chatbot. No se conectó a OpenAI ni a Resend con datos restaurados.
- No se arrancó la API ni se repitieron las 98 pruebas HTTP. No se ejecutaron `npm test`, builds ni smokes.
- No se usó `git reset`, `git clean` ni `git restore`; no se tocaron los stashes; no se eliminó ningún respaldo anterior; no hay commit ni push.
