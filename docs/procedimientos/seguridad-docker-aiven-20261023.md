# Seguridad Docker y preparación Aiven — entrega local

**Preparación del 23/10/2026; continuación del 24/10/2026, America/Lima. Rama `anderson`; base `b55091f76ad8c817d60d5327dba5430485ee3c0b`.**

Se corrigieron las vulnerabilidades altas de las dependencias Node y se construyó una imagen nueva.
**No se declara la imagen libre de vulnerabilidades ni aprobada para publicación:** npm conserva un aviso moderado
de SSE propagado a tres paquetes y Scout conserva ocho avisos altos de Debian, clasificados individualmente
en el [anexo Debian](debian-imagen-backend-20261024.md). No se publicó en GHCR, no se desplegó en Azure
y no se conectó a Aiven ni a las bases MySQL reales del proyecto; sí se usaron servidores MySQL desechables.

La propuesta operativa está en [Preparación segura de Aiven](aiven-mysql-preparacion-segura.md).
El [anexo de dependencias](seguridad-backend-dependencias-20261023.md) identifica cada paquete y los **59 avisos únicos**
del inventario npm inicial. Los [contadores de evidencia](evidencias-seguridad-backend-20261023.json) se conservan sin secretos.
La [guía GHCR](imagen-backend-azure-ghcr.md) identifica ahora la candidata r4 y conserva los ensayos anteriores como históricos;
su procedimiento futuro no autoriza ejecutarlo.

## Auditorías iniciales y finales

| Comprobación | Inicial de esta sesión | Final |
| --- | --- | --- |
| npm, producción y desarrollo | 29 paquetes: 15 altos, 11 moderados, 3 bajos | 3 moderados; 0 altos/críticos/bajos |
| npm, producción | 17 paquetes: 11 altos, 6 moderados | 3 moderados; 0 altos/críticos/bajos, ejecutado dentro de la imagen final |
| Scout, imagen completa | 119 avisos únicos: 39 altos, 39 medios, 41 bajos; 120 ubicaciones/resultados SARIF | 52 avisos únicos: 8 altos, 6 medios, 38 bajos; 52 resultados SARIF |
| Scout, cobertura | 559 paquetes indexados | 371 paquetes indexados |

Son unidades distintas: paquetes npm afectados, avisos de Scout y ubicaciones SARIF **no se suman**.
La auditoría histórica de la imagen anterior tenía 10 altos/6 moderados de npm; las consultas nuevas devolvieron
11 altos/6 moderados. Se conservan las respuestas originales de cada consulta, sin ajustar contadores para hacerlas coincidir.
Las versiones y las bases de avisos cambian; cualquier publicación futura exige otro escaneo del digest exacto.

## Correcciones y compatibilidad

Se conserva NestJS **10.4.22**, Prisma/cliente/adaptador **6.19.3**, MySQL y todos los contratos de negocio.
No se ejecutó `npm audit fix --force`, no se desactivaron validaciones ni se modificaron migraciones o React.

| Paquete | Antes → después | Dependencia que lo introduce y motivo |
| --- | --- | --- |
| `body-parser` | 1.20.8 → **1.20.9** | Nest platform-express y Express; override común para cubrir ambos caminos. GHSA-27r3-jxmh-p828. |
| `multer` | 2.0.2 → 2.5.0 | platform-express fija su versión; override en ese padre para corregir avisos de multipart. |
| `mariadb` | 3.4.5 → 3.5.4 | El adaptador Prisma fija 3.4.5; override en el adaptador. Corrige TLS, hostname y procesamiento de paquetes manteniendo la mayor 3. |
| `nodemailer` | 6.10.1 → 10.2.1 | Dependencia directa. Las ramas anteriores conservan avisos; actualización mayor deliberada y acotada al transporte/composición usados. |
| `@types/nodemailer` | 6.4.17 → 8.0.2 | Tipos publicados compatibles con las llamadas utilizadas; TypeScript y composición en memoria verificados. |
| `file-type` | 20.4.1 → 21.3.4 | Nest common fija una versión vulnerable; override específico. ESM mediante import dinámico de Nest, compatible con Node 22. |
| `deepmerge-ts` | 7.1.5 → 8.0.2 | Prisma CLI → @prisma/config; no existe parche del aviso inicial en la mayor 7. Se conserva Prisma 6 y se verifica generación/build. |
| `lodash` | 4.17.21 → 4.18.1 | Config, Swagger y herramientas; misma mayor 4. |
| `js-yaml` | 4.1.0 → 4.3.2 | Swagger/herramientas; override limitado a la mayor 4. |
| `ajv` | 8.12.0 → 8.20.0 | Angular devkit/schema-utils; solo se modifica la rama 8, se conserva la rama 6. |
| `picomatch` | 4.0.1 → 4.0.7 | Angular devkit; se conserva la rama 2 de chokidar. |
| `brace-expansion` | 1.1.18/2.1.4 → 1.1.21/2.1.7 | minimatch/glob; cada rama conserva su mayor. |
| `glob`, `webpack` | 10.4.5/5.97.1 → 10.5.0/5.112.2 | Nest CLI; overrides específicos, fuera del runtime. |
| `tmp` | 0.0.33 → 0.2.7 | CLI → inquirer → external-editor; conserva las operaciones utilizadas por external-editor, build verificado. |

Los cambios mayores de Nodemailer, file-type, deepmerge-ts y tmp responden a avisos concretos; no se actualizaron los
frameworks en bloque. El anexo distingue exposición potencial, presencia en producción y herramientas de desarrollo.
No se probaron todos los exploits: la ausencia de avisos npm se contrasta con las regresiones funcionales enumeradas abajo.

**body-parser:** se reprodujo el [aviso oficial](https://github.com/advisories/GHSA-27r3-jxmh-p828) en Node 22:
un gzip válido seguido de bytes sobrantes provocó un error no capturado y terminó el proceso.
La nueva prueba usa un proceso separado, comprueba JSON válido y que el servidor siga respondiendo después del cuerpo malformado.
Con 1.20.8 falla por `Z_DATA_ERROR`; con 1.20.9 pasa. No se altera el contrato de cuerpos comprimidos.

**Moderado residual npm:** [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75),
inyección de delimitadores en `SseStream` de Nest Core. Su parche publicado es 11.1.18; no hay parche en Nest 10.
No se encontró `@Sse` ni uso de `SseStream` en `backend/src`. Esta evaluación de no exposición es estática y debe revisarse
si se añaden eventos SSE. npm lo propaga a `platform-express` y `swagger`: tres paquetes, un aviso de origen.
No se falsea la versión de Core ni se salta a Nest 11/Express 5 para ocultar el contador.

## Imagen r2 y endurecimiento anterior al cierre

Etiqueta local nueva: **`horus-aca-backend:security-20261023-r2`**. `r1` fue una candidata intermedia distinta.
No se sobrescribió la etiqueta anterior `20261023-b55091f76ad8-3b0e09106d0b`.

```text
OCI index: sha256:0710bf09aefdd00b1b3f0c64d37af43077205fde99e56cf98871e3b84cfd8b1b
Manifest linux/amd64: sha256:04af544d48365d251012de2e7b729aac3847249ddf0f0c9c4968f49a77cab378
Config: sha256:0c75e506424401a671efef3dac06d06016e0310f869e1e7b2e008ae5bbe6a2f2
```

El label de revisión identifica el HEAD de partida: estos cambios locales todavía no tienen commit.
La imagen está construida para **linux/amd64**, Node **22.23.4**, con ambas etapas fijadas a
`node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.

Cambios del Dockerfile:

- Actualización de los paquetes Debian disponibles durante el build y limpieza de índices apt.
- Runtime con `USER node` por defecto, sin npm/npx/Yarn globales en el sistema final.
- Prune de desarrollo/peers y copia del manifiesto/lock resultante del builder. npm conserva Prisma CLI y TypeScript por
  sus peers opcionales; **se auditan y se conservan**, sin borrarlos manualmente. Nest CLI está ausente del runtime.
- No hay inicialización, migración ni creación de cuentas en build o arranque. Los scripts de mantenimiento siguen siendo explícitos.

Tamaño informado por Docker: **799 413 630 bytes**; incluye capas compartidas y no equivale a la descarga comprimida de GHCR.
Retirar gestores del sistema final no elimina sus bytes de las capas anteriores de la base; por ello también se revisaron las capas.
El digest fija el resultado probado. `apt-get upgrade` depende del repositorio en el momento del build:
una reconstrucción exige una nueva etiqueta, una nueva inspección y un nuevo escaneo.

`USER node` hace que un montaje con propietario root pueda impedir escribir uploads. Preparar permisos del almacenamiento
externo; no suponer que Azure podrá usar el fallback root del CMD. No se cambió Compose ni se reiniciaron servicios existentes.

## Avisos de sistema operativo y discrepancias

El nuevo Scout del **24/10/2026** sobre el mismo digest conserva **8 altos, 6 medios y 38 bajos**;
los ocho altos tienen `fixed_version: not fixed` para Debian 12. Se contrastaron `dpkg-query`, fstab,
SUID de mount/umount, disponibilidad de `nsenter --join-cgroup`, ausencia de `Pod::Text`, zlib de Node
y enlace dinámico, además de los ocho registros Debian y sus avisos upstream.

El [anexo Debian](debian-imagen-backend-20261024.md) recoge **CVE, paquete/binario, versión completa instalada,
rango afectado, exposición observada y mitigación individual**. Distingue vulnerabilidades presentes con
precondiciones ausentes, componentes/funciones ausentes y discrepancias de rango. No se han suprimido avisos.
La política `cap-drop ALL`/`no-new-privileges` pertenece al ensayo; debe comprobarse en Azure y no se presume
por `USER node`. Aceptar el riesgo o seleccionar una base corregida sigue siendo una decisión pendiente.

Los seis medios de Scout incluyen cuatro de Debian y dos de Node. Uno de estos últimos,
[CVE-2024-29409](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c), es una discrepancia verificable:
GitHub declara corregida la rama 10 desde **10.4.16**, y está instalada **10.4.22** con validación por firma binaria.
El otro es el aviso SSE real ya descrito. No se añadieron ignores ni filtros para retirar ninguno del escaneo.
Quedan también 38 bajos; el inventario completo se conserva como SARIF en la evidencia local.

Antes de exposición pública: revisar las clasificaciones y riesgos restantes, y elegir un parche/base compatible
o aceptar explícitamente el riesgo. El contador npm sin altos no autoriza por sí solo la publicación de la imagen.

## Secretos y límites de la comprobación

Se recorrieron **13 capas, 22 565 archivos regulares y 547 806 004 bytes** de la imagen guardada.
No se encontraron archivos `.env` del proyecto, respaldos del proyecto, variables de imagen con secretos ni patrones
de tokens GitHub/OpenAI/AWS del proyecto. No se leyó `backend/.env` ni se incorporaron certificados Aiven al build.
Se preservaron las exclusiones adicionales de `.dockerignore` que ya estaban modificadas antes de esta tarea.

Las seis coincidencias de formato de clave privada se comprobaron por SHA-256 contra la base pública fijada o dependencias
reinstaladas con `npm ci`: `libgnutls`, documentación de npm en una capa anterior y ejemplos README de dotenv.
No se imprimieron sus contenidos ni se clasificaron como secretos propios. Un detector de patrones no certifica
ausencia absoluta de secretos arbitrarios; la conclusión está limitada a estas firmas y a las copias explícitas del Dockerfile.

## Verificación ejecutada

Se trabajó en una copia temporal sin `.env`, con Node **22.23.3** en Windows y dependencias instaladas por el lockfile nuevo.
El Node 24 global no se utilizó para las pruebas de compatibilidad. No se reemplazó `node_modules` del workspace original:
su servidor de desarrollo permanece con las dependencias anteriores hasta una reinstalación y reinicio posteriores autorizados.

| Prueba | Resultado |
| --- | --- |
| `npm ci`, Prisma generate 6.19.3 | Correctos en copia aislada y build Linux. |
| `tsc --noEmit --incremental false` | Repetido el 24/10 con Node 22.23.3 en la copia aislada: salida 0. |
| `npm run build` | Correcto en Windows aislado y en Docker Linux amd64; generación Prisma y Nest build repetidos el 24/10: salida 0. |
| Regresión body-parser y composición Nodemailer | 2/2; MIME texto/HTML/PDF en memoria, sin SMTP real. |
| Sonda TLS: configuración insegura/incompleta | 1/1, sin red. |
| Suite unitaria completa | **807/807**, 0 fallos, 0 omitidas, 0 canceladas, 0 TODO; salida 0 en **230410,1147 ms**, Node 22.23.3, el 24/10. Archivo completo `unit-tests-complete-repeat-20261024.log`. |
| Integraciones MySQL completas, repetidas el 24/10 | **15 archivos, 205/205**, 0 fallos, 0 omitidas, 0 canceladas y 0 TODO; cada archivo con MySQL 8.4.11 nuevo, UUID comprobado por conexión y docker exec, y contenedor propio retirado. |
| Scripts administrativos / preparación AccessGuard | **12/12 y 9/9**. |
| Esquema académico / colación de respaldos | **20/20 y 6/6**. Incluye recuperación, integridad y rechazo de estructuras incompatibles. |
| Concurrencia de Catálogo (H-03) | **4/4**, con dos clientes Prisma y HTTP; la estrategia JWT está sustituida en ese fixture. La autorización real se acredita por separado con AccessGuard HTTP. |
| Prisma / AccessGuard HTTP / Ediciones | 19/19, 28/28 y 10/10, respectivamente; HTTP y persistencia reales en MySQL desechable. |
| Matrículas / Preinscripciones / Horarios | 16/16, 27/27 y 14/14; cada suite con servidor propio y UUID comprobado. |
| Reportes / conservación de Docentes y retirada de Sesiones | 10/10 y 7/7. CSV/XLSX de 3005 estudiantes y PDF de 3000 filas incluidos. |
| Estudiantes / Importaciones | **8/8 y 15/15**, repetidas el 24/10 con plantillas/datos exclusivamente desechables. |
| Imagen final: CA correcta y negativas | mysql2 y conector del adaptador aceptan CA correcta; CA, DNS y UUID incorrectos rechazados. PrismaService se comprueba también con TLS inválido. |
| Imagen final: 18 migraciones / PK / privilegios | MySQL 8.4.11 propio, TLS obligatorio, PK obligatoria, migrador sin DROP; init, migrate dos veces y db:check correctos; 30 tablas. |
| Imagen final: respaldo y recuperación | Backup firmado, verify-only y restore en `horus_restore_*` propio correctos; sin datos de negocio reales. |
| API final y recursos | Repetido el 24/10: **1 CPU / 2 GiB** comprobados por Docker inspect y lectura de `cpu.max`/`memory.max`; UID 1000, PID 1 sin capacidades, TLS y cuenta con concesiones sobre 27 tablas. |
| Smoke HTTP final | Health 200, cuenta sin sesión 401, Swagger 404, catálogo vacío 200; 100 health concurrentes correctos. Login real con bcrypt, JWT/sesión y consulta de 3000 estudiantes ficticios correctos. |
| Negocio dentro de la imagen limitada | CSV: **3000 filas, 199579 bytes, 198 ms**; XLSX: **3000 filas, 102854 bytes, 108 ms**; PDF: **3000 filas, 286867 bytes, 1026 ms**. Exportaciones secuenciales por HTTP con TLS a MySQL desechable; se comprobaron conteos CSV y firmas de XLSX/PDF. |
| Memoria / parada | En el ensayo del 24/10: **136,9 MiB / 2 GiB** después de exportar; pico de todo el cgroup **184414208 bytes (175,87 MiB)**, incluido el proceso auxiliar de comprobación. Parada con salida 0, sin OOM; contenedores y red propios retirados. |
| npm final dentro de la imagen | Repetido el 24/10: 0 altos/críticos y 3 moderados; salida 1 por los avisos. Auditor npm montado temporalmente en solo lectura; no se reinstaló npm en la imagen. La auditoría de la copia completa repite esos contadores. |
| Docker Scout final | Repetido el 24/10: 8 altos, 6 medios, 38 bajos, 371 paquetes. Escaneo sin exclusiones. |

Incidencias de verificación conservadas: la copia inicial no incluía RAILWAY.md y una prueba unitaria documental falló por ENOENT;
se copió el documento sin modificarlo. Se comprobaron por hash los directorios `src`, `scripts`, `test`, `prisma` y `migrations`
de la copia, además de los manifiestos; RAILWAY.md coincide con el original y no hay `.env` en la copia.
Se añadió allí el Dockerfile que faltaba, sin modificarlo. El npm de una distribución temporal antigua estaba incompleto
(`MODULE_NOT_FOUND`); se ejecutó directamente el comando Node que define `npm test`, con el mismo Node 22 y precargas.
La primera repetición completa del 24/10 dio **806/807**, 1 fallo por `ETIMEDOUT` en la compilación del fixture
`build-output.test.ts` al límite de 10 s, en 315742,1244 ms. El archivo solo pasó **2/2**, con esa prueba en 6981,8273 ms;
la siguiente suite completa pasó **807/807** en 230410,1147 ms. Se conserva el fallo y se informa como intermitencia:
no se demostró su causa ni se modificaron código, expectativas o límites para ocultarlo.
Los 806 tests de la ejecución original del 23/10 no incluían todavía la prueba nueva de configuración de la sonda TLS.
El primer MySQL desechable del runner de importaciones no inició dentro de su
ventana; el siguiente ensayo arrancó con tmpfs. Un arnés privado intentó reutilizar un servidor entre suites y Matrículas
rechazó correctamente que no estuviera recién creado y vacío: se repite cada suite en su contenedor propio.
Otro control privado esperaba que npm retirara Prisma/TypeScript; la inspección mostró que conserva esos peers.
Se corrigió esa expectativa del arnés de inventario, sin borrar paquetes ni debilitar pruebas de negocio.
Scout informó un bloqueo de archivo temporal durante la limpieza de la candidata r1; el informe final de r2 terminó correctamente.

En la ampliación del 24/10, el arnés temporal común exportaba `DB_NAME=mysql` también a Catálogo.
`ConfigService` priorizó esa variable sobre la base propia del fixture y sus tres casos respondieron 500
por ausencia de `cursos` en la base `mysql` del contenedor desechable. Se conservó el log fallido
`fresh-catalogo-concurrency.integration.cjs.log`; se limitó la variable del arnés al caso Prisma, sin tocar
el proyecto, y la repetición independiente de Catálogo pasó **4/4**. No se cambiaron las aserciones 200/409.

Comando completo repetido desde `validation/backend` de la copia temporal (equivale al script `npm test`):

```powershell
# Node 22.23.3 seleccionado explícitamente, sin usar el Node 24 global.
node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register 'test/*.test.ts'
```

Para las integraciones se conservó el arnés de continuación `run-verification-20261024.cjs` fuera de Git.
Se ejecutó una vez por cada uno de los 15 archivos `test/*.integration.cjs`, en serie y con un MySQL nuevo por archivo.
El resumen `integrations-fresh-20261024.json` registra archivo, log seleccionado, SHA-256, contadores y duración;
retiene la referencia al pase de Catálogo después de corregir su entorno, sin borrar el registro fallido anterior.
Las suites de Estudiantes usan una plantilla creada únicamente en su servidor desechable; no leen `horus_db` ni `horus_local`.

El ensayo final de imagen es `verify-image-tls-20261024.cjs`, log `image-tls-capacity-20261024.log`, salida 0.
Repite CA correcta y negativas de CA/hostname/UUID, rechazo de TLS inválido por PrismaService, 18 migraciones,
30 tablas con PK, migrador sin DROP, idempotencia y respaldo → verificación → restauración propios.
Después añade exclusivamente datos ficticios a ese servidor y prueba la API bajo los límites indicados.
Esto confirma el funcionamiento local de la imagen con **1 CPU / 2 GiB** en esos casos, sin regresiones detectadas
en la suite comprobada. No dimensiona carga sostenida, exportaciones simultáneas, uploads o IA, ni demuestra
conexión Aiven, persistencia Azure, pull privado o despliegue remoto. No se ejecutaron smokes de navegador ni QA Laravel.

Los contenedores/redes propios del ensayo TLS se retiraron tras verificar nombre y label. Los ejecutores de integración
retiran exclusivamente sus propios contenedores y volúmenes anónimos. Se conservan las imágenes nuevas y los artefactos
temporales de evidencia; no se tocaron los tres contenedores `horus-local`, sus volúmenes ni imágenes ajenas.

## Requisitos previos para Azure Container Apps

La [configuración oficial de contenedores](https://learn.microsoft.com/en-us/azure/container-apps/containers)
admite la combinación prevista **1 vCPU / 2 GiB** en Consumption. Preparar, sin ejecutar el despliegue:

1. Aprobar el riesgo residual y la publicación del digest exacto. GHCR debe ser privado; etiqueta nueva, nunca la anterior.
   Comprobar el digest remoto después de una publicación autorizada y fijarlo en Azure; el digest local no prueba un push.
2. Credencial GHCR de lectura separada del publicador, almacenada como secreto del registro. No introducir tokens en build,
   variables de aplicación ni archivos versionados. Verificar la visibilidad efectiva del paquete y la caducidad del token.
3. Secretos independientes: `DB_USER=horus_app`, `DB_PASS`, `DB_SSL=true`, contenido de `DB_SSL_CA`, JWT propio;
   hostname/puerto/base Aiven comprobados. No poner credenciales de migrador ni token de Aiven en la API.
4. `NODE_ENV=production`, `DB_SYNC=false`, `SWAGGER_ENABLED=false`, `CORS_ORIGINS` con orígenes HTTPS exactos,
   `PORT=3000`, ingress HTTPS y target port coincidente. Configurar `TRUSTED_PROXY_CIDRS` solo con evidencia del proxy real.
5. [Probes de inicio, disponibilidad y vida](https://learn.microsoft.com/en-us/azure/container-apps/health-probes)
   en `/api/health`. El SELECT inicial valida MySQL; el health público no comprueba la base en cada solicitud.
6. Volumen persistente compartido de uploads en `/data/uploads`, `UPLOAD_DIR` explícito y permisos para UID 1000;
   copia externa coordinada con SQL. El disco efímero del contenedor no es persistencia.
7. Limitar inicialmente réplicas y concurrencia: pool Prisma de dos conexiones por réplica, límite Free de 76 con margen
   para mantenimiento, conexiones internas y revisiones simultáneas. El smoke no dimensiona tráfico de negocio.
8. Configurar salida DNS/TCP al endpoint Aiven y protección de entrada según las capacidades verificadas del plan;
   Free no ofrece VPC ni IP estática del servicio. Vigilar cuota de disco y desconexiones.
9. Correo y OpenAI permanecen sin prueba real. Habilitarlos exige su configuración y verificación propias;
   no enviar correo ni copiar claves locales implícitamente. Ninguna migración debe programarse al arrancar.

## Estado y pendientes

Trabajo conservado **solo en local**, sin stage, commit ni push. Los cambios previos en `.dockerignore` y el documento
de imagen anterior se preservaron. No se cambiaron ramas, stashes, React, datos, usuarios remotos ni credenciales reales.

Pendientes materiales: resolución/aceptación de avisos residuales; soporte efectivo de granular grants de este servicio Free;
aprovisionamiento y grants Aiven; CA, hostname y UUID reales; ensayo remoto autorizado; retención/RPO/RTO y cifrado externo;
permisos del volumen Azure; dimensionamiento de carga sostenida/concurrente y otros flujos bajo los recursos previstos;
publicación privada GHCR y despliegue autorizados.

## Inventario exacto del trabajo local

Los **14 archivos** que estaban modificados o sin seguimiento al comenzar esta continuación se conservaron.
Se añade únicamente el anexo Debian; total comprobado **15 archivos respecto a HEAD**, ninguno en stage.

| Estado respecto a HEAD | Archivo | Cambio acumulado / intervención del 24/10 |
| --- | --- | --- |
| Modificado | `backend/.dockerignore` | 26 exclusiones adicionales de credenciales y datos; preexistente, conservado. |
| Modificado | `backend/Dockerfile` | Base fijada por digest, apt upgrade, USER node, retiro de gestores globales, prune y manifiestos del builder; preexistente, conservado. |
| Modificado | `backend/package.json` | Nodemailer/tipos y overrides de seguridad de la tabla anterior; preexistente, conservado. |
| Modificado | `backend/package-lock.json` | Resoluciones exactas de las dependencias anteriores; preexistente, conservado. |
| Modificado | `backend/scripts/database.cjs` | `verifyIdentity: true` para mysql2 con TLS; preexistente, conservado. |
| Nuevo | `backend/scripts/check-mysql-tls.cjs` | Sonda explícita de solo lectura con CA, hostname y UUID, ambos conectores; preexistente, conservada. |
| Nuevo | `backend/test/compressed-body-security.test.ts` | Regresión HTTP de body-parser en proceso separado; preexistente, conservada. |
| Nuevo | `backend/test/mysql-tls-probe.test.ts` | Rechazos de configuración de la sonda antes de red; preexistente, conservada. |
| Nuevo | `backend/test/nodemailer-compatibility.test.ts` | Composición MIME con adjunto en memoria; preexistente, conservada. |
| Nuevo | `docs/procedimientos/aiven-mysql-preparacion-segura.md` | Preparación de cuentas/grants/TLS/migraciones/recuperación, sin ejecutar en Aiven. |
| Nuevo | `docs/procedimientos/evidencias-seguridad-backend-20261023.json` | Contadores, digest y evidencia de continuación sin secretos. |
| Nuevo | `docs/procedimientos/imagen-backend-azure-ghcr.md` | Guía histórica conservada; añadida referencia r2 y procedimiento futuro GHCR para su digest exacto. |
| Nuevo | `docs/procedimientos/seguridad-backend-dependencias-20261023.md` | Inventario inicial y final de Node y 59 avisos originales; preexistente, conservado. |
| Nuevo | `docs/procedimientos/seguridad-docker-aiven-20261023.md` | Esta entrega, resultados, incidencias, inventario y límites actualizados. |
| Nuevo | `docs/procedimientos/debian-imagen-backend-20261024.md` | Añadido en esta continuación: ocho CVE, versiones, exposición y mitigación. |

Fuera de Git se conservan logs, SARIF y arneses de esta continuación en
`%TEMP%\horus-security-aiven-20261023\`. Los certificados y contraseñas de los ensayos son ficticios
y no deben incorporarse al repositorio. No se sustituyó node_modules del workspace, no se tocaron
credenciales, migraciones SQL, frontend, Laravel, stashes ni otros worktrees. No hay cambios de workflows.

## Cierre de seguridad solicitado el 24/10/2026

**Preparación local completada; publicación y exposición pública condicionadas.** No se hicieron stage,
commit, push, operaciones Aiven, cambios de secretos ni despliegues. El inventario sigue siendo exactamente
el de 15 archivos anterior. Todos corresponden al alcance backend/seguridad/DevOps/documentación.
Los 15 ya estaban modificados al comenzar este cierre; se revisaron y preservaron. En esta continuación
se modificaron únicamente Dockerfile y cinco documentos/evidencias de este mismo inventario.

### Cambios de esta revisión

- Mitigación Docker: retirada de SUID/SGID de los archivos regulares de `/usr/bin` y `/usr/sbin`.
  Justificación: la API no usa elevación y Container Apps no expone el securityContext de Kubernetes.
  Evita depender exclusivamente de `no-new-privileges`/cap-drop del ensayo Docker. No corrige las versiones
  vulnerables ni reduce los contadores Scout. No se cambió Node, Debian, Nest, Prisma ni otra dependencia adicional.
- Aiven: 27 GRANT completos por tabla; alcance del migrador ajustado a `partial_revokes` para evitar que
  `_` actúe como comodín; preflight, ramas vacía/existente, salidas de detención, copia externa y reversión.
  Proyecto/servicio antiguos quedan como referencias pendientes de reconfirmación, no identidades verificadas.
- GHCR/Azure: candidata r4 por digest, PAT publicador/lector separados, YAML privado con secretRef,
  ingress inicialmente interno, probes, almacenamiento UID 1000, costos y tráfico/reversión por revisión.
  Los documentos distinguen configuración propuesta de prueba remota. No se modificó React.

### Evidencia nueva del cierre

| Comprobación ejecutada | Resultado |
| --- | --- |
| Build Docker final r4, linux/amd64 | Salida 0; builder y apt actualizado reutilizados desde caché, retirada de SUID/SGID comprobada. Etiqueta exclusiva `security-20261024-r4-67ad23fa0935`, ID guardado mediante --iidfile. |
| Identidad r4 | Índice `sha256:aa5213974af6704ec7addc19f6dfd6b23a7f223c5e1dc0da2eae0f0fb971ff35`; manifiesto `sha256:ad01e0b9880b661c4544d20315f26cd7209081233747c4ea073872845493dc5c`. Imagen 800332888 bytes según Docker. |
| Pruebas afectadas, Node 22.23.3 Linux | **47/47**, 0 fallos, canceladas, omitidas y TODO; salida 0; 329546,475161 ms. Siete archivos: body-parser, sonda TLS, Nodemailer, proveedores/confiabilidad de correo, seguridad de despliegue y respaldo de uploads. Sin SMTP, Aiven ni datos reales. |
| TypeScript, misma copia aislada | `tsc --noEmit --incremental false`: salida 0. No se instaló ni reemplazó node_modules del workspace. |
| Imagen r4: TLS, PK y mantenimiento | CA correcta aceptada por ambos conectores; CA/hostname/UUID incorrectos rechazados y TLS inválido rechazado por PrismaService. Init, 18 migraciones, repetición, db:check y 30 PK correctos en MySQL propio 8.4.11. Todas las ejecuciones por ID inmutable. |
| Alcance del GRANT por esquema | Con partial_revokes=OFF, lectura permitida en `horus_scope_fixture` y denegada en `horusXscopeXfixture` con el patrón escapado. Solo tablas/cuentas ficticias en el MySQL desechable. No se creó ni consultó horus_db. |
| Respaldo/restauración r4 | Firma/contenido y restauración en destino propio nuevo correctos. No hubo restauración sobre una base real. |
| Imagen r4: seguridad y HTTP | UID 1000, sin ejecutables SUID/SGID en las dos rutas, CapEff cero, 1 CPU/2 GiB comprobados por cgroups. Health 200, protegido 401, Swagger 404, catálogo vacío 200; 100 health concurrentes correctos. Escritura temporal de uploads correcta en el directorio de imagen. |
| Imagen r4: negocio | Login bcrypt/JWT, sesión, consulta de 3000 estudiantes ficticios y exportación HTTP CSV/XLSX/PDF correctos. CSV 199579 bytes/322 ms; XLSX 102905 bytes/265 ms; PDF 286933 bytes/1236 ms. Conteo CSV y firmas XLSX/PDF comprobados. |
| Memoria/parada r4 | 163,7 MiB observados tras exportar; pico cgroup 199897088 bytes (190,64 MiB), incluido auxiliar de comprobación. Salida 0 sin OOM. Recursos desechables propios retirados, existentes preservados. |
| npm sobre manifiestos extraídos de r4 por ID | **3 moderados, 0 altos/críticos**, salida 1 esperada. Auditor externo Node 22; no se instaló npm en runtime. stdout JSON y stderr separados por el arnés, sin mezclar avisos del wrapper PowerShell. |
| Scout r4 | **8 altos, 6 medios, 38 bajos**, 371 paquetes; SARIF completo, sin supresiones, salida 0. Sin aviso de limpieza bloqueada en esta repetición; se conserva la incidencia de r3. |
| Secretos: imagen completa r4 | 14 capas, 22576 archivos regulares, 548444748 bytes recorridos. Sin variables secretas de imagen ni hallazgos nuevos: las seis coincidencias de formato de clave coinciden por hash con la clasificación previa de base pública/documentación dotenv/npm. |
| Alcance y secretos: 15 archivos | Sin credenciales del proyecto, entorno, claves, dumps, builds ni binarios incluidos. La cabecera vacía de clave privada del test TLS es un fixture negativo sin material de clave. Lockfile y JSON de evidencia son entregables deliberados; los logs/SARIF/tar quedan fuera de Git. |
| Evidencia completa previa | SHA-256 de los seis artefactos registrados y de los 15 logs de integración coincidentes. Confirmados **807/807** y **205/205** en los logs previos; no se presentan como suites completas ejecutadas de nuevo en este cierre. |
| Correspondencia de la copia probada | 340 archivos comparados de src/scripts/test/prisma/migrations y configuración/manifiestos, sin diferencias. El Dockerfile cambia solo por la mitigación conservada en r4; los documentos no forman parte de esas suites. |

La validación nueva utiliza las dependencias ya preparadas en la copia temporal, montada sin escritura
y sin `.env`; Node 24 del host se usa únicamente para orquestar/verificar artefactos, no para las pruebas
de compatibilidad. Un primer comando de inspección SUID desde PowerShell falló por comillas; se repitió
con argumentos directos y con aserciones dentro del arnés, ambos correctos. No se cambiaron expectativas
ni límites de las pruebas. No se repitió navegador/React ni se validó el montaje Azure Files.

Incidencia conservada: se detuvo el cliente del primer build r3 al quedar sin progreso en apt, pero
su subproceso buildx continuó y sobrescribió la etiqueta r3 después del otro build. El control final de
digest detectó la discrepancia. No se publica ni se aprueba r3; se construyó r4 con nombre exclusivo,
se fijó el ID desde --iidfile y se repitieron sobre ese ID todo el ensayo de imagen, npm, Scout y capas.
El digest de la etiqueta final se comprobó antes y después. No se atribuye evidencia a una etiqueta mutable
que cambió durante la operación. Los logs de ambos builds anteriores se conservan para investigación.

Artefactos de este cierre: `%TEMP%\horus-security-close-67ad23fa0935\`, fuera de Git.
Incluye `review-summary.json`, logs de tipos/pruebas y los intentos r3. La carpeta `final/` contiene
`image-id.txt`, `docker-build.log`, `image.log`, `npm.json`, `scout.sarif`, `secret-scan.json`, imagen
exportada y arnés adaptado `verify-image.cjs`, que ejecuta por ID inmutable. Los secretos de ensayo
son ficticios y no se incorporan a la entrega. El expediente JSON versionable incluye hashes, no secretos.

### Riesgo residual y límites de aprobación

Los [ocho altos Debian](debian-imagen-backend-20261024.md) siguen abiertos: seis util-linux/libmount/libblkid,
uno perl/Pod::Text y uno zlib. Su anexo distingue rutas/precondiciones ausentes y discrepancias de rango.
Retirar SUID/SGID mitiga vías locales de montaje; no equivale a instalar un parche. No hay base/backport
corregido compatible confirmado en este cierre y no se mezclaron distribuciones para cambiar el contador.

Los tres moderados npm son el mismo aviso SSE [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75),
propagado a core/platform-express/swagger. El parche publicado es 11.1.18; Nest 10 no tiene parche verificado.
No hay uso SSE en src. Conservar Nest 10 evita una migración mayor transversal para un camino no utilizado;
revisar antes de introducir SSE. Persisten además seis medios y 38 bajos Scout. Ningún aviso fue suprimido.

Compatibilidad Free: [la documentación Aiven](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier)
admite este diseño de bajo volumen con 1 nodo, 1 GB de disco/RAM y 76 conexiones; no ofrece VPC, IP fija,
fork ni SLA. La [API de usuarios](https://aiven.io/docs/products/mysql/howto/manage-service-users)
documenta mysql_grants vacío, pero exige soporte del servicio. No hay comprobación remota ni garantía
de esa capacidad en el servicio concreto. No se declara Free listo para operación de producción con SLA.
Plan de copias, capacidad real, RPO/RTO, red, privilegios gestionados, proxy y almacenamiento siguen pendientes.

**Recomendación:** código e imagen preparados para revisión y commits autorizados; despliegue condicionado
a resolver o aceptar explícitamente el riesgo, activar Aiven de forma controlada y comprobar GHCR/Azure.
El smoke no dimensiona carga sostenida, exportaciones simultáneas, correo, IA ni disponibilidad de Free.
La configuración USER node cambia respecto al Dockerfile original: los volúmenes root-only de otros
destinos requieren preparar permisos; no se autoriza desplegar esta imagen en Railway como efecto lateral.

### Cuatro commits locales autorizados el 24/10/2026

La autorización posterior al cierre permite crear únicamente estos cuatro grupos, sin `git add .`,
en `anderson` y con el inventario exacto de 15 archivos. Todos describen el delta completo acumulado
respecto a HEAD, incluido el trabajo anterior conservado; no se atribuye todo a esta continuación.
Las afirmaciones anteriores de «sin stage/commit» y los campos falsos del JSON describen las
instantáneas de los ensayos anteriores a esta autorización. No se reconstruye ni publica la imagen
por crear estos commits. Se conservan los dos stashes, los worktrees y las demás ramas.

La guía Aiven incorpora el [siguiente procedimiento de solo lectura](aiven-mysql-preparacion-segura.md#siguiente-procedimiento-privilegios-disponibles-solo-lectura),
preparado sin conectar al servicio ni modificar cuentas. Esta autorización no acepta los riesgos
residuales ni permite push, publicación, despliegue o exposición pública.

| Orden / mensaje propuesto | Archivos exactos |
| --- | --- |
| 1. `fix(deps): corregir dependencias vulnerables del backend` | backend/package.json; backend/package-lock.json; backend/test/compressed-body-security.test.ts; backend/test/nodemailer-compatibility.test.ts |
| 2. `fix(db): verificar identidad TLS en mantenimiento MySQL` | backend/scripts/database.cjs; backend/scripts/check-mysql-tls.cjs; backend/test/mysql-tls-probe.test.ts |
| 3. `security(docker): endurecer la imagen Node 22 sin privilegios` | backend/Dockerfile; backend/.dockerignore |
| 4. `docs(devops): preparar Aiven GHCR y Azure con riesgos residuales` | docs/procedimientos/aiven-mysql-preparacion-segura.md; docs/procedimientos/debian-imagen-backend-20261024.md; docs/procedimientos/evidencias-seguridad-backend-20261023.json; docs/procedimientos/imagen-backend-azure-ghcr.md; docs/procedimientos/seguridad-backend-dependencias-20261023.md; docs/procedimientos/seguridad-docker-aiven-20261023.md |

### Autorizaciones pendientes, independientes

1. Push posterior; la autorización actual cubre únicamente los cuatro commits locales anteriores.
2. Resolución o aceptación del riesgo residual para el uso previsto; aprobación de exposición pública separada.
3. Lectura del servicio Aiven real y confirmación de proyecto/servicio/DNS/puerto/CA/UUID/capacidad.
4. Alta y concesiones de horus_app/horus_migrator; ni el código ni un commit autorizan crear cuentas reales.
5. Ventana sin escritores, respaldo fresco verificado/ensayado y activación inicial o migración remota
   del destino reconfirmado. Crear un administrador de aplicación requiere otra autorización.
6. Token publicador/lector y publicación privada del digest GHCR; no incluye permiso de despliegue.
7. Recursos/costos/secretos/volumen y despliegue Azure, primero interno; apertura pública, DNS/proxy/frontend,
   correo y OpenAI se autorizan según su alcance. No se copian secretos locales ni se cambia React aquí.
