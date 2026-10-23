# Activación real de la migración de docentes en horus_db

> **Documento histórico: módulo retirado (simplificación académica, octubre de 2026).** Los cursos los dictan integrantes de la propia empresa, por lo que ya no hay
> administración de docentes: se retiraron `/api/admin/docentes`, `/api/admin/asignaciones-docentes` y los permisos `docentes:*`. Se conservan las tablas
> `docentes` y `docente_asignaciones`, la migración `20261020-docentes`, sus datos y su respaldo. Las sesiones ya no dependen de docentes
> (`asignacion_id` se guarda siempre en NULL). Lo que sigue describe el diseño anterior y no el comportamiento actual.


Fecha: 20 de octubre de 2026, America/Lima. Alcance: **únicamente** la migración `20261020-docentes` (módulo de Docentes y ponentes, solo API) en `127.0.0.1:3306/horus_db`, con autorización expresa del responsable. No se aplicó ninguna otra migración ni se modificaron datos de negocio.

**Estado: COMPLETADA.** `npm run db:migrate` terminó con código 0 y `npm run db:check` con «Esquema compatible».

## 1. Identidad del destino y del código

| Comprobación | Evidencia |
| --- | --- |
| Servidor | MySQL `8.0.46`, `server_uuid` que empieza por `dc5bb32a` (el resto se omite a propósito), servicio `MySQL80`, puerto 3306 (los tres valores coinciden con los esperados) |
| Base efectiva | `horus_db` (la configuración de los scripts apunta a `127.0.0.1:3306/horus_db`; se verificó con `DATABASE()` antes y después) |
| Rama / HEAD | `anderson` / `b4a7705b874e3887983b1c455ba9307cf64dd36a`, igual a `origin/anderson`; árbol de trabajo limpio al inicio y al final |
| Migraciones antes | 15 aplicadas, hasta `20261019-importaciones-academicas` |
| Pendientes antes | Exclusivamente `20261020-docentes` (sin migraciones parciales: las tablas `docentes` y `docente_asignaciones` no existían y el ENUM de `academico_historial` tenía los cuatro valores originales) |
| Cuenta 14 | Activa, `GERENTE_GENERAL`, antes y después. Las otras 13 cuentas siguen inactivas y sin rol; ningún `session_version` cambió (todos en 2) |
| `db:check` previo | Terminó con código 1 y solo reportó diferencias de las dos tablas de docentes y del ENUM; ninguna diferencia ajena |
| CI del commit | El responsable informó de la ejecución 39440962630 en SUCCESS. **No se pudo verificar desde esta sesión** (`gh` sin autenticar); sí se comprobó que HEAD es el commit indicado |

Bases ajenas: no se tocaron `horus_local` (MySQL de Docker), `horus_group` (Laravel) ni ninguna otra. El servidor habitual contiene además diez bases `horus_estudiantes_it_*` y `horus_restore_migtest`, restos de pruebas anteriores; no se modificaron.

## 2. Ventana de mantenimiento

No fue necesario detener ningún servicio: ninguno de los escritores posibles estaba activo. Se comprobó, antes de respaldar y de nuevo justo antes de migrar:

- Ningún proceso de la API NestJS (`dist/main`, `nest`, `start:dev`) ni de Laravel/PHP, ni ngrok. Solo estaba activo el servidor de desarrollo de Vite (no se conecta a MySQL; su proxy `/api` no tenía backend).
- El backend del Docker local usa `DB_HOST=mysql` / `DB_NAME=horus_local` (su propio MySQL 8.4), no el servidor habitual.
- Cero conexiones TCP establecidas con el puerto 3306 y `Threads_connected = 1` (la propia sonda). La cuenta de servicio ve todo el servidor, así que `PROCESSLIST` es concluyente. La única fila ajena era el demonio interno `event_scheduler` (inactivo, 0 eventos definidos).
- No hubo cambios entre el inventario inicial, el respaldo y la migración: las instantáneas (huella SHA-256 de las filas de las 24 tablas persistentes, DDL, columnas, claves foráneas, migraciones y cuentas) fueron idénticas.

**Límite honesto:** la ventana se estableció por **comprobación de ausencia**, no bloqueando el puerto: MySQL escucha en todas las interfaces (`bind_address=*`) y un cliente remoto podría haberse conectado en el intervalo. La migración es aditiva (tablas nuevas y un `MODIFY` de ENUM sobre una tabla vacía), de modo que una escritura concurrente no habría podido perderse ni corromperse. Reabrir los escritores no fue necesario porque no se detuvo ninguno.

## 3. Respaldo inmediato y verificación

Creado con `npm run db:backup` y `npm run uploads:backup`, **fuera del repositorio**, en un directorio privado del perfil de la cuenta del responsable (ACL sin herencia: solo esa cuenta y SYSTEM): `%USERPROFILE%\.horus-respaldos\activacion-docentes-20261020\`.

| Elemento | Resultado |
| --- | --- |
| Base | `horus-horus_db-20261020-150712.sql.gz` (13 267 bytes), 25 tablas y 145 filas persistentes, colación de la base `utf8mb4_0900_ai_ci`, 15 migraciones en el manifiesto |
| SHA-256 | `6af0d5b38114e4cd12fb53d387ea049294ef34cc8625a71317b02e36775c3962`; coincide con el archivo `.sha256` y con `Get-FileHash` calculado de forma independiente |
| Integridad | `db:restore --verify-only`: firma correcta y 39 sentencias permitidas; el gzip se descomprime completo |
| Archivos subidos | `uploads-20261020-150725`: 35 archivos, 17 588 756 bytes, 0 omitidos, 0 desaparecidos; `uploads:restore --verify-only` correcto |

No se reutilizó el respaldo del 19 de octubre. No se publicó nada en Git. Los respaldos **no están cifrados** (los comandos no cifran; pendiente de la política de custodia del responsable) y contienen datos personales y hashes de contraseñas: no moverlos sin cifrar.

## 4. Restauración verificada

Se restauró el respaldo nuevo, tres veces, en una **instancia aislada MySQL 8.0.46** (el mismo ejecutable instalado, `--no-defaults`, directorio de datos temporal, `127.0.0.1:58791`, UUID distinto del habitual, usuario y contraseña efímeros). Un envoltorio abortaba si la conexión no tenía la identidad del clon, de modo que ningún comando de prueba pudiera llegar a `horus_db`.

- `db:restore`: 25 tablas con recuentos verificados y 14 claves foráneas (1 compuesta) sin filas huérfanas.
- Comparación con el origen: **idénticos** datos (huella por tabla, 24 tablas persistentes), columnas (tipo, nulabilidad, valor por defecto, charset, colación, expresión generada), DDL (índices, claves foráneas y 18 CHECK), colación, motor InnoDB, cuentas (id, rol, activo, `session_version`) y migraciones. Solo se normalizó la redundancia documentada `CHARACTER SET utf8mb4` que a veces añade `SHOW CREATE TABLE`.
- Archivos: 35 de 35 restaurados con SHA-256 idéntico al origen.

## 5. Ensayo de la migración en el clon

Sobre copias restauradas del respaldo (nunca en `horus_db`):

| Comprobación | Resultado |
| --- | --- |
| Aplicación | `scripts/migrate.cjs` (el mismo del destino real), código 0, 0,92 s; repetirlo no cambia nada |
| Datos previos | Ninguna fila modificada: las 24 huellas coinciden; solo `horus_migrations` pasa de 15 a 16 filas |
| Estructura | `docentes` y `docente_asignaciones` creadas vacías (InnoDB, `utf8mb4_unicode_ci`); +3 claves foráneas (14 → 17) y +8 CHECK (18 → 26) |
| ENUM de `academico_historial` | `...,'certificado'` → `...,'certificado','docente','asignacion_docente'`; el resto del DDL es idéntico y los registros se conservan (la tabla está vacía) |
| `db:check` | «Esquema compatible» tras migrar; antes solo señalaba las diferencias esperadas |
| Restricciones (SQL directo, 41 comprobaciones, 0 fallos) | DNI y correo únicos (sin distinguir mayúsculas); varios NULL admitidos; DNI de formato inválido, documento incompleto, país distinto de PE, textos en blanco, `activo` y `revision` fuera de rango rechazados; un solo principal activo por edición (también con dos escrituras simultáneas: un ganador y un rechazo); pareja docente/edición única; retiro con motivo obligatorio; clave compuesta que impide sustituir con una asignación de otra edición; `RESTRICT` impide borrar docentes, ediciones o asignaciones referenciadas; el historial acepta los dos valores nuevos y rechaza uno inventado |
| Integridad | Sin filas huérfanas en las tres claves nuevas |
| Compatibilidad | API compilada (`dist/main.js`) contra el clon, con AccessGuard y cuentas **ficticias** del clon: 40 de 40 comprobaciones (permisos de docentes por rol y lecturas de Estudiantes, Ediciones, Matrículas, Reportes, Importaciones, Mensajes, Cotizaciones, Chatbot, Cuentas y catálogo público) |
| Fallo parcial | Con 1, 2 o 3 sentencias aplicadas sin registrar la versión, `db:check` lo detecta y repetir `db:migrate` lo completa. **Una tabla `docentes` preexistente con otra forma no se corrige**: `migrate` termina con 0 y solo `db:check` falla. En `horus_db` esas tablas no existían (comprobado en la puerta final) |
| Reversión manual documentada | Con las tablas vacías: `DROP` de `docente_asignaciones` y `docentes`, `MODIFY` del ENUM a sus cuatro valores y borrado de la fila de `horus_migrations` devuelve el clon a un estado **idéntico** al original (incluida la huella de `horus_migrations`) y permite volver a migrar |

Dos hallazgos menores del propio ensayo, sin relación con el código: los primeros intentos de arrancar la instancia fallaron por la ruta con espacios del argumento `--basedir` (se quitó), y tres comprobaciones de historial fallaron por una fila de prueba mía que no cumplía el CHECK preexistente `academico_historial_origen_chk`; se corrigió el dato de prueba y se repitió toda la batería desde una restauración limpia (41/41).

## 6. Puerta final y activación

Inmediatamente antes de migrar, una sonda de solo lectura exigió y obtuvo: destino, UUID, versión y base correctos; cuenta 14 activa como `GERENTE_GENERAL`; pendiente únicamente `20261020-docentes` con 15 migraciones aplicadas; cero tablas de docentes y ENUM original; ninguna conexión ajena ni evento programado; y `horus_db` idéntica al respaldo. Una primera ejecución de la sonda se detuvo por un criterio demasiado estricto (contaba el demonio `event_scheduler` como cliente); se identificó la conexión, se corrigió el criterio de forma explícita y se repitió antes de continuar.

Se ejecutó `npm run db:migrate` (desde `backend/`): código 0, 2,27 s, sin sentencias adicionales ni reintentos.

## 7. Verificación posterior en horus_db

- `npm run db:check`: **Esquema compatible**, código 0. Versión registrada: `20261020-docentes` (16 migraciones, sin pendientes).
- Tablas creadas: `docentes` y `docente_asignaciones`, **vacías**, InnoDB, `utf8mb4_unicode_ci`. Su DDL, sus columnas, +3 claves foráneas (14 → 17) y +8 CHECK (18 → 26) son idénticos a los del clon ensayado.
- `academico_historial`: ENUM `entidad` ampliado al final con `docente` y `asignacion_docente`; resto del DDL idéntico; sigue vacía.
- Comparación antes/después (huellas de filas de las 24 tablas persistentes, DDL, columnas, colaciones, motor, claves foráneas y cuentas): **la única diferencia en datos previos es la fila nueva de `horus_migrations`**. Cuentas, estudiantes, ediciones, matrículas, certificados, importaciones, mensajes, cotizaciones, atención, chatbot, contenido institucional (cursos, servicios, galería, convenios, ajustes), auditoría y uploads (35 archivos, hashes idénticos a la copia) se conservaron.
- Cuenta 14: activa y `GERENTE_GENERAL`; las otras 13 cuentas sin cambios.
- Claves foráneas: las 14 anteriores conservan sus datos (huellas idénticas); las 3 nuevas están sobre tablas vacías.

### Pruebas HTTP

Se levantó temporalmente la API compilada con su configuración habitual (`.env`, sin mostrar valores) en el puerto 3917 y se detuvo al terminar (puerto liberado, sin procesos sobrantes). Todas las peticiones fueron de solo lectura; **ninguna creó, editó ni asignó docentes**.

| Petición | Resultado real en `horus_db` |
| --- | --- |
| `GET /api/health` | 200 |
| `GET /api/admin/docentes` y las rutas de docentes (`/:id`, `/:id/asignaciones`, `/api/admin/asignaciones-docentes`) sin sesión | 401 (y con un JWT inválido, 401) |
| Rutas de Estudiantes, Ediciones, Matrículas, Reportes y `/admin/me` sin sesión | 401 |
| Catálogo público (`settings`, `cursos`, `servicios`, `preguntas-frecuentes`, `convenios`, `galeria`) | 200; 5 cursos |
| `POST /api/chatbot/message` (una consulta de catálogo) | 200 |
| Errores | Ningún cuerpo filtra SQL, trazas ni nombres de índices |

**No comprobado con cuentas reales durante la activación:** `GET /api/admin/docentes` con Gerencia (200), Coordinación (200), Secretaría (403) y cuenta básica (403). En esa sesión no había sesiones válidas disponibles ni se debían usar contraseñas reales ni forjar tokens. Ese resultado se verificó **solo en el clon con cuentas ficticias** (sección 5: 200 / 200 / 403 / 403 y 401 sin sesión, más 404 para un id inexistente). La verificación con la sesión real de Gerencia se hizo después y se documenta en la sección 7.1.

### 7.1 Verificación posterior con la sesión real de Gerencia General

Hecha **personalmente por el responsable** desde Microsoft Edge, con su sesión real de Gerente General en el panel de Horus Group, mediante una petición `GET` **de solo lectura** (no se creó, editó ni asignó ningún docente). Resultado comunicado por el responsable el 20 de octubre de 2026:

| Dato | Resultado |
| --- | --- |
| Endpoint | `GET /api/admin/docentes` |
| Estado HTTP | 200 |
| Total de docentes | 0 |
| Mensaje | «Acceso autorizado correctamente» |
| Backend | NestJS conectado a `horus_db` |

Qué demuestra: autenticación (sesión JWT válida) y autorización de **Gerencia General** funcionan contra el backend NestJS con `DocentesModule` conectado a `horus_db`, y las tablas de docentes recién migradas responden, vacías, como se esperaba.

Qué **no** demuestra, y alcance de la evidencia:

- **Coordinación y Secretaría** no se probaron con sesiones reales. Sus permisos (Coordinación 200, Secretaría 403, cuenta básica 403) se comprobaron únicamente con **cuentas ficticias en el entorno aislado** (clon de la sección 5).
- Solo se probó una lectura de la lista. No se ejercitaron `POST`, `PUT`, asignaciones ni el detalle por id contra `horus_db`.
- Esta comprobación la ejecutó y la informó el responsable: no fue reproducida ni observada por el asistente, que no volvió a iniciar NestJS ni a conectarse a `horus_db` para documentarla. No se guardó captura ni registro en el repositorio.
- No es una validación de despliegue: no indica qué entorno sirvió el backend más allá de lo comunicado (NestJS conectado a `horus_db`).

Tras las pruebas HTTP, `horus_db` volvió a ser idéntica a la instantánea posterior a la migración; la consulta de chatbot no dejó filas de métricas y las cuotas temporales (`rate_limit_buckets`, excluidas de las huellas por diseño) conservaron su recuento.

## 8. Restablecimiento

No se detuvo ningún servicio, así que no hubo nada que restablecer: el servicio `MySQL80` (PIDs 4800 y 5576), el servidor Vite y los tres contenedores del Docker local siguen como estaban. La API NestJS tampoco estaba en marcha al empezar ni se dejó en marcha. Lo único levantado y retirado fue la API de verificación (puerto 3917) y la instancia aislada (apagada mediante `SHUTDOWN` tras confirmar su UUID y directorio; su directorio de datos, la copia de uploads de prueba y la credencial efímera se eliminaron). Sin procesos Edge `horus-*` sobrantes.

**Pendiente para el responsable:** desplegar el backend de este commit con `DocentesModule` en los entornos que correspondan cuando decida (la migración ya está aplicada en `horus_db`, como exige el orden: migración antes que el código). La API habitual no estaba en marcha durante esta tarea y el asistente no desplegó nada; el responsable arrancó después NestJS contra `horus_db` para la comprobación de la sección 7.1.

## 9. Recuperación disponible

- Los respaldos nuevos (base y uploads) permanecen en el directorio privado indicado. Recuperar es restaurar en otra base `horus_restore_*` (`npm run db:restore`) y decidir la promoción con el responsable; el ejecutor nunca restaura sobre `DB_NAME`.
- **Mientras `docentes`, `docente_asignaciones` y las entradas de historial de docentes estén vacíos**, la reversión manual ensayada en el clon (sección 5) deja la base en su estado original. Requiere autorización expresa, se hace con la API detenida y fracasa por diseño si el historial ya usa los valores nuevos del ENUM. Con datos de docentes, no revertir a mano: restaurar en una base aislada.
- Una ejecución futura interrumpida se completa repitiendo `npm run db:migrate`, tras comprobar `horus_migrations` y `db:check`.

## 10. Riesgos y observaciones

1. La ausencia de escritores se verificó por observación; un cliente remoto en el puerto 3306 (abierto a todas las interfaces) no está bloqueado por ningún control.
2. Los respaldos no están cifrados ni autenticados (el SHA-256 solo detecta daños accidentales).
3. El estado de la CI del commit proviene del responsable.
4. Las pruebas locales usaron Node 24.19.0; el proyecto declara 22.x.
5. Las frases «no se aplicó en ninguna base habitual» de `AGENTS.md` y de `gestion-docentes.md` quedaron obsoletas tras la activación y se actualizaron en el commit de documentación posterior: ahora indican que `20261020-docentes` está aplicada a `horus_db` y que cualquier otra base o entorno debe verificar su propio historial.
6. El servidor habitual conserva diez bases `horus_estudiantes_it_*` y `horus_restore_migtest` de pruebas anteriores, ajenas a esta activación.

## 11. Limitaciones reales de esta activación

1. **Permisos de Coordinación y Secretaría probados solo con cuentas ficticias.** Coordinación 200, Secretaría 403 y cuenta básica 403 se comprobaron únicamente en el clon aislado, no con sesiones reales. Contra `horus_db` se verificaron 401 sin sesión, las lecturas públicas y el chatbot (por el asistente), y Gerencia 200 con la sesión real del responsable (sección 7.1).
2. **Gerencia verificada con sesión real, pero de forma limitada.** El responsable confirmó `GET /api/admin/docentes` = 200, 0 docentes, desde Edge (solo lectura; sección 7.1). Sigue sin probarse con sesión real Coordinación ni Secretaría, ni ninguna escritura contra `horus_db`.
3. **Respaldos no cifrados.** La base y los archivos subidos contienen datos personales y hashes de contraseñas de cuentas; el SHA-256 solo detecta daños accidentales. Pendiente de la política de custodia del responsable.
4. **Ventana por observación.** La ausencia de escritores se comprobó, no se impuso bloqueando el puerto 3306.
5. **Backend sin desplegar.** Durante la activación, el código con `DocentesModule` solo se levantó temporalmente en el puerto 3917 para las pruebas de solo lectura. Después, según el responsable, un backend NestJS conectado a `horus_db` atendió la petición de la sección 7.1; no se ha registrado ningún despliegue en Railway ni en otro entorno.
6. **Alcance de la migración.** Solo `horus_db`. `horus_local`, Railway, `horus_group` y cualquier otra base o instalación deben verificar su propio historial (`npm run db:check`) y seguir el procedimiento de [Gestión de docentes y ponentes](gestion-docentes.md#migración-y-activación), que se conserva (respaldo con `--verify-only`, restauración aislada y ensayo en clon) para futuras instalaciones.

## 12. Git

La activación se hizo con la rama `anderson` en `b4a7705b874e3887983b1c455ba9307cf64dd36a`, sin cambios en `.env`, código, Laravel, React, Login/Register, chatbot, reportes ni permisos, y sin dependencias instaladas. Este documento y la actualización de `AGENTS.md` y `gestion-docentes.md` se publican después en un commit solo de documentación.
