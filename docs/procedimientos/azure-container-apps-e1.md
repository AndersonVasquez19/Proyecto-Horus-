# Fase E.1 — Preparación de Azure Container Apps

Fecha: 24/10/2026, America/Lima. **Preparación documental; ningún recurso creado, imagen publicada ni riesgo aceptado.**
Arquitectura acordada: React/Vite en Vercel, NestJS/Prisma en Azure Container Apps (ACA), MySQL en Aiven.
Vercel y los datos quedan fuera de esta fase. La migración, los permisos y la conexión Aiven indicados
por el responsable se toman como antecedentes confirmados por él; no se vuelven a ejecutar.

Esta propuesta precisa la configuración económica de E.1 frente al ejemplo anterior de 1 CPU/2 GiB de
[imagen backend/GHCR](imagen-backend-azure-ghcr.md). Conserva esa guía y los cambios de otras fases.

## 1. Estado de la imagen y alcance de la evidencia

| Requisito | Evidencia disponible y conclusión |
| --- | --- |
| Node 22 | `backend/Dockerfile`: dos etapas `node:22-bookworm-slim`, base fijada por digest. El host actual tiene Node 24.19.0; no usarlo para afirmar compatibilidad Node 22. |
| Compilación | `npm ci`, generación Prisma, `npm run build`, poda de desarrollo y copia de `dist`. El cierre r4 documenta build satisfactorio; no se repitió en E.1. No hay migración en build ni arranque. |
| Prisma/MariaDB | Manifiesto: Prisma y adaptador 6.19.3, MariaDB 3.5.4 mediante override. `PrismaService` usa el adaptador, pool de dos conexiones, TLS y `SELECT 1` al iniciar. |
| Sin root | `USER node`, copias con propietario node y eliminación de SUID/SGID en `/usr/bin` y `/usr/sbin`. CMD termina con `exec node`; si se fuerza root, intenta bajar privilegios. No forzar root en ACA. |
| Puerto y HOST | `EXPOSE 3000`, `PORT=3000`; el código actual acepta `HOST=0.0.0.0`. **r4 es anterior al cambio HOST/proxy D.4**: no basta configurar variables en esa imagen. |
| Variables | Se inyectan al ejecutar, sin `.env` en la imagen. `.dockerignore` excluye entornos, CA/llaves, respaldos y credenciales; no elimina `src/uploads`. |
| Apagado | `enableShutdownHooks()` y `PrismaService.onModuleDestroy()` con `$disconnect()`. r4 documenta salida 0 sin OOM. ACA envía SIGTERM y, tras 30 s sin terminar, SIGKILL: medir también con la candidata nueva. |
| Health | `GET /api/health` público devuelve `{ok:true}` sin consultar MySQL. **No hay instrucción Docker HEALTHCHECK**; se configuran probes HTTP de ACA explícitas. No hace falta modificar Dockerfile por ello. |
| Aiven y CA | `DB_SSL=true`, `rejectUnauthorized:true`, `DB_SSL_CA` como contenido PEM con conversión de `\n` a saltos reales. Se lee el contenido, **no una ruta de archivo**. TLS/CA/hostname inválidos fueron rechazados en el ensayo local previo; conexión real Aiven confirmada por el responsable, no repetida aquí. |

Evidencia histórica local: [cierre r4](seguridad-docker-aiven-20261023.md), tabla final: imagen linux/amd64,
UID 1000, health 200, protegido 401, Swagger 404, exportaciones con datos ficticios y parada limpia.
Índice OCI r4: `sha256:aa5213974af6704ec7addc19f6dfd6b23a7f223c5e1dc0da2eae0f0fb971ff35`.
Es una referencia histórica, **no el digest que se autoriza para un futuro despliegue E.1**.

En E.1 se inspeccionaron código, Dockerfile, manifiestos y documentos. Docker CLI existe, pero
`docker image inspect` no pudo conectar al motor Linux; tampoco se pudo inventariar imágenes.
No se arrancó Docker Desktop. Azure CLI no está instalada y no hay conector Azure disponible:
suscripción, créditos, recursos y cuotas reales permanecen sin verificar. No se abrió un entorno real.

**No necesita cambios el Dockerfile para esta preparación. Sí hace falta construir otra candidata con
el código HOST/proxy aprobado, escanearla y validar sus límites antes de publicarla.**

## 2. Ocho avisos altos: revisión de fuentes actuales

Se reconsultaron los ocho trackers Debian el 24/10/2026. Todos siguen clasificando Bookworm como
vulnerable; ninguna de esas fichas confirma una versión corregida para Bookworm. Esto no acredita
el estado del repositorio apt de una imagen futura: hay que inventariar y escanear el resultado nuevo.
Se conservan las adjudicaciones detalladas de [Debian/r4](debian-imagen-backend-20261024.md).

| Aviso / fuente actual | Mitigación o discrepancia documentada en r4 | Corrección disponible según proveedor |
| --- | --- | --- |
| [CVE-2026-53613](https://security-tracker.debian.org/tracker/CVE-2026-53613) | mount sin SUID, fstab sin entradas delegadas; la API no monta discos. Paquete presente. | Tracker: Trixie 2.41.5-0+deb13u1 y sid 2.42.4-1 corregidos; la descripción conserva un caso legacy sin `/proc`. No extrapolar a Bookworm. |
| [CVE-2026-53615](https://security-tracker.debian.org/tracker/CVE-2026-53615) | No se sondean particiones/imágenes de discos ni se delegan dispositivos de bloque. Biblioteca presente. | Upstream 2.41.4; Trixie 2.41.5-0+deb13u1 corregido. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | Sin helpers/hooks de montaje delegados; alcance de backports antiguos no demostrado. | sid 2.42.4-1 corregido; Trixie sigue vulnerable. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | Sin bind mounts autorizados en fstab ni elevación SUID. | sid 2.42.4-1 corregido; Trixie sigue vulnerable. |
| [CVE-2026-78409](https://security-tracker.debian.org/tracker/CVE-2026-78409) | Discrepancia del rango upstream con 2.38; no hay fstab autorizado. No se conoce el kernel efectivo de ACA. Mantener aviso. | sid 2.42.4-1 corregido; Trixie sigue vulnerable. |
| [CVE-2026-78408](https://security-tracker.debian.org/tracker/CVE-2026-78408) | `nsenter --join-cgroup` ausente en el binario inspeccionado de r4. No usar namespaces/cgroups del host. | sid 2.42.4-1 corregido; Trixie sigue vulnerable. |
| [CVE-2026-82560](https://security-tracker.debian.org/tracker/CVE-2026-82560) | Pod::Text ausente en el sistema final r4; perl-base presente no acredita el módulo. | Pod::Text 6.1.1 upstream; tracker mantiene perl/podlators sin corregir en sus ramas indicadas. |
| [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | Discrepancia de rango; Node no enlaza libz del sistema en r4, sin flujo gzwrite identificado. Mantener aviso. | Commit upstream enlazado por Debian; tracker mantiene paquetes sin corregir. |

No mezclar paquetes sid/Trixie con Bookworm ni sustituir bibliotecas a mano. Migrar de base sería otro
cambio con ensayo completo; Trixie por sí sola tampoco elimina los ocho. Retirar SUID/SGID reduce
escaladas locales, pero no corrige bibliotecas. No atribuir a ACA `cap-drop ALL`/`no-new-privileges`
del ensayo Docker: no son campos públicos equivalentes del esquema ACA revisado en la fase anterior.

r4 reportó 8 altos, 6 medios, 38 bajos en Scout y 3 moderados npm. Son contadores históricos; no se
ejecutó un escaneo nuevo en E.1. No suprimir avisos ni interpretar salida 0 de Scout como aprobación.
Publicar incluso en GHCR privado exige autorización y revisión del riesgo; exponer HTTPS exige además
decisión explícita sobre riesgos residuales. **La imagen sigue sin aprobación de exposición pública.**

## 3. Configuración propuesta y recursos

| Ajuste | Propuesta E.1 |
| --- | --- |
| Entorno/perfil | Consumption, Linux/amd64, un contenedor, revisión Single. Sin GPU, Dapr ni componentes auxiliares. |
| CPU/RAM iniciales | **0,25 vCPU / 0,5 GiB**, condicionados al ensayo local nuevo. Alternativa si falla latencia/memoria: 0,5 vCPU / 1 GiB, con revisión del coste. |
| Escala | min=0, max=1; regla HTTP concurrentRequests=10. Es objetivo del escalador, no límite duro de concurrencia. Evitar revisiones antiguas activas. |
| Proceso | HOST=0.0.0.0, PORT=3000, NODE_ENV=production, DB_SYNC=false, SWAGGER_ENABLED=false. |
| Red | Ingress HTTP nativo, transport=auto, targetPort=3000, allowInsecure=false. Sin puertos TCP adicionales. |
| Acceso inicial | external=false: app accesible solo dentro del entorno, sin endpoint público de la app. Esto no exige crear una VNet privada. |
| Acceso público | external=true **solo con autorización específica posterior**. TLS termina en ingress; probe interno HTTP no implica HTTP público permitido. |
| Proxy | TRUSTED_PROXY_HOPS=1 **solo tras confirmar ingress único y ausencia de acceso directo o caminos más cortos**. Omitir TRUSTED_PROXY_CIDRS; no confiar en todos los proxies. Hasta entonces, omitir ambos. |
| Probes | HTTP /api/health: Startup cada 5 s, timeout 3 s, 24 fallos; Readiness cada 10 s, timeout 3 s, 3 fallos; Liveness cada 20 s, timeout 3 s, 3 fallos. |
| IA | CHATBOT_AI_ENABLED=false, ASISTENTE_AI_ENABLED=false para el primer ensayo. No configurar clave OpenAI todavía. |
| Uploads | No configurar UPLOAD_DIR en el smoke limitado a health/lectura. No probar imágenes ni cargas en esa etapa. Antes de uso funcional, almacenamiento persistente y sus permisos requieren preparación/autorización propia. |

Las [combinaciones admitidas](https://learn.microsoft.com/en-us/azure/container-apps/containers#vcpu-and-memory-allocation-requirements)
incluyen 0,25/0,5 y 0,5/1; 1/2 no es obligatorio. El pico cgroup r4 documentado es **190,64 MiB**
(163,7 MiB observados tras exportaciones), con 1 CPU/2 GiB asignados. 512 MiB da unas 2,7 veces ese pico.
Es evidencia suficiente para proponer el ensayo pequeño, no para declarar su capacidad validada.
No hay una medición de CPU sostenida ni carga representativa que permita determinar el mínimo real.
CPU menor puede empeorar bcrypt, generación PDF, inicio y latencia con concurrencia.

Ensayo pendiente: arranque frío, health concurrente, login y exportaciones representativas con datos
ficticios, límite efectivo 0,25/0,5, métricas cgroup/memoria, ausencia de OOM/reinicios y parada <30 s.
Registrar picos y latencias frías/calientes. Si hay presión de memoria o latencia inaceptable para el
flujo acordado, evaluar 0,5/1 y volver a medir; no aumentar timeouts para disimular fallos.

Probes propuestas sobre el endpoint existente: acreditan respuesta del proceso, **no salud continua
de Aiven**. El SELECT 1 de inicialización precede a escuchar HTTP, pero una caída posterior de DB no
hace fallar ese health. No convertir liveness en consulta DB como parte de esta preparación.
Fuentes: [probes](https://learn.microsoft.com/en-us/azure/container-apps/health-probes),
[cierre por SIGTERM](https://learn.microsoft.com/en-us/azure/container-apps/application-lifecycle-management#shutdown).

### Arranque en frío y chatbot

El widget aborta a **22 s** (`frontend/src/components/chatbot/Chatbot.tsx`); la llamada OpenAI del
backend tiene **15 s** (`backend/src/chatbot/chatbot.service.ts`). Pull de imagen, creación de réplica,
inicio Node/Nest y DNS/TLS/pool Aiven se suman antes de responder. Si OpenAI tarda 15 s, quedan menos
de 7 s para todo lo demás, incluida red y consultas. Una imagen r4 de unos 800 MB según Docker puede
agravar un pull sin caché; no equivale exactamente al tamaño comprimido transferido.

Las probes de inicio toleran un arranque más lento, pero **no amplían los 22 s del navegador**.
min=0 es apropiado para pruebas económicas; no garantiza experiencia de chatbot adecuada.
Medir una petición tras escala real a cero y otra caliente antes de elegir min=1. Mantener IA apagada
al principio. Los POST del chatbot registran métricas y pueden purgar registros vencidos: no usarlos
para probar contra Aiven real sin autorización de escritura. No implementar calentadores periódicos.

## 4. Secretos y CA sin trasladar DPAPI

Los valores quedan en el gestor autorizado y en secretos de ACA; no en Git, imagen, argumentos,
transcripciones, capturas ni logs. No se leyó ni modificó ningún `.env` real. Los archivos DPAPI son
artefactos locales Windows: no montarlos, copiarlos a Azure ni incorporarlos a la imagen.

| Variable | Referencia propuesta | Uso |
| --- | --- | --- |
| DB_HOST | secretRef: db-host-v1 | DNS Aiven verificado; no IP que rompa la identidad TLS. |
| DB_PORT | secretRef: db-port-v1 | Puerto del servicio existente, sin asumir 3306. |
| DB_NAME | secretRef: db-name-v1 | Destino ya migrado aprobado por el responsable. |
| DB_USER | secretRef: db-user-v1 | Valor horus_app; nunca administrador/migrador. |
| DB_PASS | secretRef: db-pass-v1 | Credencial existente, sin mostrar ni generar otra en esta fase. |
| DB_SSL | value: 'true' | Obligatorio para este destino. |
| DB_SSL_CA | secretRef: aiven-ca-v1 | **Contenido PEM** de la CA confiable, no ruta Windows/Linux ni base64. |
| JWT_SECRET | secretRef: jwt-v1 | Aleatorio, al menos 32 caracteres; política/versionado aprobados. |
| CORS_ORIGINS | secretRef: cors-v1 | Origen HTTPS exacto de la SPA, sin rutas/barra final ni comodines de previews. |
| OPENAI_API_KEY | secretRef: openai-v1, solo al habilitar IA | CHATBOT_MODEL y, si aplica, ASISTENTE_MODEL son configuración; IA requiere autorización de consumo propia. |
| Correo | Referencias solo del proveedor elegido | Resend: RESEND_API_KEY secreto y RESEND_FROM; Gmail: MAIL_USER/MAIL_PASS. MAIL_PROVIDER explícito; MAIL_NOTIFY_TO opcional. No configurar ambos ni enviar pruebas reales. |

Host/puerto/base/usuario/orígenes no son todos credenciales, pero se usan referencias también para
mantener el inventario de conexión fuera del documento. Para health y lectura no hacen falta correo
ni IA; su omisión deja esas funciones sin servicio y no valida el funcionamiento completo de la API.
No inventar un interruptor MAIL_ENABLED, que el código no consume. DB_RSA_PUBLIC_KEY no sustituye TLS
y no se necesita para este procedimiento con TLS.

Procedimiento en la futura ventana autorizada:

1. Operador identifica destino/identidad y obtiene valores del gestor, sin entregarlos al asistente.
2. Para secretos nativos, introducirlos mediante campos de secreto del portal, sin capturas ni
   exportación de la configuración. Para despliegue declarativo inicial usar una plantilla ARM con
   parámetros **secureString sin defaults ni outputs** para los valores y entrada segura en el portal;
   nunca un JSON/YAML de parámetros con contraseñas. Las variables de contenedor referencian nombres
   con `secretRef`, y `registries.passwordSecretRef` referencia ghcr-read-v1. Verificar esas referencias
   en la revisión antes de confirmar creación. No ejecutar `listSecrets`.
3. Si ya existen Key Vault e identidad administrada aprobados, preferir secretos ACA con `keyVaultUrl`
   versionada e `identity` autorizada. Al crear por primera vez, una identidad asignada por usuario
   puede existir antes que la app; la identidad de sistema aún no existe. Crear Key Vault, identidad
   o permisos no está autorizado por este documento y puede añadir costes.
4. Para CA, obtener la misma CA pública desde la fuente Aiven confiable y comparar su SHA-256 con la
   validada. Puede introducirse PEM multilínea o PEM con `\n` literales: el servicio convierte estos
   últimos. El contenido CA no es una contraseña; no imprimir por ello el conjunto de secretos.
5. Inyectar directamente DB_SSL_CA por secretRef. No montar archivo para este código. Un volumen
   secreto con `DB_SSL_CA=/mnt/secrets/ca.pem` **no funciona**: Prisma recibiría la ruta como CA.
   Si se decide montar la CA, habría que preparar y probar un lector de archivo separado; no hace falta aquí.
6. Verificar presencia/parseo del certificado y TLS desde la revisión sin imprimir valores. No
   desactivar rejectUnauthorized ni usar NODE_TLS_REJECT_UNAUTHORIZED=0. Un fallo bloquea el avance.
7. Conservar nombres versionados para reversión. Cambiar secretos nativos no crea revisión por sí
   mismo: crear/reiniciar la revisión que los consuma de manera controlada. No rotar JWT sin evaluar sesiones.

Los métodos nativos y Key Vault, el volumen secreto y la actualización de revisiones se describen en
[gestión oficial de secretos](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets).
La plantilla segura inicial completa, con destino/digest aprobados, se concreta en la ventana de
despliegue; este documento no es un manifiesto ejecutable ni almacena valores operativos.

## 5. GHCR privado y procedencia de la candidata

Mantener **Private**: es un backend propio con revisión de seguridad pendiente. Comprobar visibilidad
y permisos del paquete existente antes y después de publicar; un nombre propuesto no acredita su estado.
Usar el procedimiento de login `--password-stdin` con carpeta Docker privada y ACL de
[la guía GHCR](imagen-backend-azure-ghcr.md), sustituyendo las referencias r4 por la candidata E.1
aprobada. No reutilizar sus comandos de push con el digest histórico.

Publicador: PAT classic write:packages; Azure: identidad/token **distintos**, PAT classic read:packages
y acceso efectivo al paquete, sin permisos de publicación/borrado. El scope por sí solo no limita
el token a un único paquete: limitar además la identidad y su acceso. Registrar vencimiento/rotación.
La identidad administrada Azure no autentica directamente un pull privado de GHCR.
En ACA: server=ghcr.io, username de la identidad lectora, passwordSecretRef=ghcr-read-v1.
El token del registro no es una variable de entorno de NestJS. No pasarlo en --registry-password,
--secrets ni activar --debug. Ver [autenticación GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

Antes de construir, registrar rama y HEAD aprobados, y hashes de los archivos del contexto revisado.
Hay cambios locales preexistentes: **el SHA de HEAD no describe por sí solo el código construido**.
No cambiar ramas, worktrees ni stashes para preparar E.1. Si el contexto cambia durante la validación,
detenerse y volver a identificarlo. No ejecutar publicación desde un workflow antiguo ni añadir CI/CD.
Una automatización futura requiere workflow manual, entorno protegido y comprobación del SHA aprobado;
eso es una modificación aparte, no una garantía del procedimiento manual actual.

Usar etiqueta única con identificador de candidata; no latest ni sobrescribir etiquetas anteriores.
Registrar ID de configuración, digest del manifiesto linux/amd64 e índice OCI por separado. Después
del push autorizado verificar el digest remoto y la correspondencia con la candidata revisada;
ante una discrepancia no cambiar la referencia automáticamente. Azure debe descargar
`ghcr.io/<propietario>/<paquete>@sha256:<digest-remoto-verificado>`.
Probar pull con la identidad lectora sin heredar la sesión/caché del publicador. No se hizo en E.1.

## 6. Portal: verificaciones antes de crear recursos

No hay sesión Azure disponible en este entorno; la siguiente lista está pendiente, no certificada.
Revisar sin pulsar Crear/Guardar, sin registrar proveedores automáticamente ni solicitar aumentos:

- **Suscripciones:** estado Enabled, tenant/cuenta correctos, permisos y políticas de la organización.
  Comparar IDs en privado; no pegarlos en informes. Cost Management + Billing: créditos, caducidad,
  tipo de oferta, spending limit y acceso a costes. Créditos no equivalen a una cuota disponible.
- **Región:** comprobar disponibilidad de ACA Consumption y cuotas con Azure Container Apps como
  proveedor. Elegir proximidad/latencia al Aiven existente, disponibilidad y precio; East US de la
  estimación inferior es solo ejemplo, no una región decidida. No asumir la ubicación de Aiven.
- **Cuotas:** CPU Consumption regional, límites de entornos y, si existe entorno, CPU/réplicas y
  uso disponible en su página Quotas. Prever 0,25 vCPU y margen para un eventual solapamiento de revisión.
  No pedir ampliación ni habilitar servicios como efecto colateral.
- **Todos los recursos:** filtrar suscripción/región; inventariar grupos, ACA environments/apps,
  revisiones activas, Log Analytics, Storage, Key Vault, redes, IPs/NAT y diagnósticos existentes.
  No reutilizar un recurso compartido sin revisar propietario, finalidad y configuración.
- **Cost Management:** presupuesto concreto aprobado para el grupo de pruebas, moneda, periodo,
  responsables y alertas al 50/80/100 %. Crear presupuesto/alertas solo en la ventana autorizada.
  **Una alerta de presupuesto no detiene el gasto**; fijar responsable y hora de apagado.
- **Logs:** comprobar workspace existente, ingestión por GB, retención, límites diarios y exportación.
  Para el smoke corto proponer “Don't save logs” y log stream sanitizado; conserva menos evidencia.
  Si se requiere histórico, aprobar destino, retención y coste antes de crearlo. No aceptar un workspace
  nuevo por defecto sin revisar el resumen. [Opciones oficiales](https://learn.microsoft.com/en-us/azure/container-apps/log-options).
- **Cómputo y solicitudes:** revisar vCPU-segundos, GiB-segundos, requests, CPU/memoria, reinicios,
  réplicas y latencias. La factura usa recursos asignados mientras corre la réplica, no solo RSS real.
- **Red y otros cargos:** cuantificar salida Azure → Aiven, respuesta Aiven → Azure según su plan,
  salida API → navegadores, pull de GHCR y límites de GitHub Packages. Azure Files, Key Vault,
  NAT, IP dedicada, private endpoint y funciones avanzadas se presupuestan por separado.
  Si Aiven requiere IP fija/allowlist incompatible con la salida actual, detenerse: no ampliar accesos
  ni crear NAT en esta fase. No exigir VNet/Front Door/Application Gateway para el primer ensayo.

Fuentes: [cuotas](https://learn.microsoft.com/en-us/azure/container-apps/quotas),
[presupuestos](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets),
[facturación](https://learn.microsoft.com/en-us/azure/container-apps/billing).

### Estimación orientativa reproducible

Consulta pública a Azure Retail Prices API el 24/10/2026, USD, East US, Consumption/Standard,
sin contrato, descuentos, impuestos ni conversión de moneda. Medidores recuperados:
vCPU activa 0,000024 USD/s; vCPU idle 0,000003 USD/s; memoria activa/idle 0,000003 USD/GiB-s;
requests 0,40 USD/millón. [API pública](https://prices.azure.com/api/retail/prices?currencyCode=USD&$filter=serviceName%20eq%20%27Azure%20Container%20Apps%27%20and%20armRegionName%20eq%20%27eastus%27),
[página de precios](https://azure.microsoft.com/en-us/pricing/details/container-apps/).

Para 0,25 CPU/0,5 GiB, coste bruto = segundos activos × 0,0000075 + segundos idle × 0,00000225.
Los periodos que siguen incluyen arranque y espera de reducción de escala; no solo tiempo en endpoints.

| Escenario, mes de 30 días | Cómputo bruto USD | Con franquicias mensuales completas disponibles, aproximado USD |
| --- | --- | --- |
| min=0, todo el mes a cero | 0 | 0 |
| min=0, 1 hora de réplica activa diaria, total 30 h | 0,81 | 0 |
| min=0, continuamente activa por tráfico, 720 h | 19,44 | 14,04 |
| min=1, teórico 720 h idle | 5,83 | 4,21 |
| min=1, 30 h activas + 690 h idle | 6,40 | 4,21–4,78, según aplicación de franquicias entre medidores |
| min=1, 720 h activas | 19,44 | 14,04 |

Las franquicias son compartidas por **suscripción y mes**: 180 000 vCPU-s, 360 000 GiB-s y 2 millones
de requests. Si otros recursos las consumieron, aplicar la columna bruta. El caso idle puro es un
límite teórico: arranque, peticiones o actividad de CPU/red activan la tarifa normal. min=0 también
puede costar lo mismo que min=1 si nunca llega a cero. Con 0,5 CPU/1 GiB el cómputo bruto se duplica.
En réplica cero no se factura su cómputo; recursos asociados pueden seguir facturando.
Sumar requests fuera de franquicia, transferencia, logs y servicios auxiliares. **No es presupuesto
total ni promesa de gratuidad**, y no confirma saldo o precios del contrato del usuario.

## 7. Secuencia exacta del primer despliegue, para ventanas futuras

Cada paso que publica, crea, cambia un recurso cloud o consume servicios requiere su autorización
específica; esta secuencia no la concede. Si un dato de destino/coste falta, completar ese expediente
antes de preparar el comando definitivo. No ejecutar todo como un script encadenado.

1. **Validación local nueva:** autorización mínima propuesta: iniciar Docker, si hace falta, construir
   candidata linux/amd64 con código HOST/proxy revisado, sin push, y ensayar 0,25 CPU/0,5 GiB con
   MySQL desechable propio y datos ficticios. Nunca cargar `.env` real ni conectar a Aiven. Generar
   Prisma/build dentro de Node 22, inventario de capas/secretos, digest y escaneos OS/npm recientes.
   No repetir la migración real ni la auditoría funcional completa ya cerrada: cubrir cambios y límites nuevos.
2. **Decisión de seguridad:** comparar ocho altos y demás resultados con r4. Si hay parche Bookworm
   verificable, evaluar reconstrucción controlada; si requiere otra base, revisar ese cambio primero.
   Sin corrección, presentar riesgos/controles del digest nuevo para decisión explícita. No publicar
   ni habilitar internet automáticamente por haber pasado un smoke.
3. **Publicación privada, autorización aparte:** verificar identidad/paquete/visibilidad/etiqueta libre,
   usar password-stdin del procedimiento GHCR, publicar exclusivamente candidata aprobada, verificar
   digest remoto y pull con lector read:packages. Detenerse si no coincide. No hacer commit ni push Git.
4. **Entorno de prueba, autorización aparte:** cerrar lista de portal, región, presupuesto/ventana,
   grupo nuevo o existente aprobado y cuotas. Crear grupo solo si está autorizado; crear entorno
   con perfil Consumption, sin Dedicated ni extras, revisar logs y resumen de costes antes de Crear.
   No usar `az containerapp up`, que puede crear/build/publicar recursos implícitamente.
5. **Secretos, autorización aparte:** preparar en el gestor los nombres de la tabla anterior y el
   token lector. En creación declarativa inicial, definir secretos nativos con parámetros secureString
   introducidos por operador en portal, o referencias a Key Vault ya autorizado. No dejar una plantilla
   con contraseñas en disco. Revisar solo nombres/referencias, nunca valores.
6. **App, autorización aparte:** crear app nueva interna en el entorno aprobado, imagen por digest,
   registro privado, variables/probes/recursos de sección 3, min=0/max=1. Aplicar secretos en la misma
   creación; no arrancar una revisión incompleta conectada a un destino por defecto. No sustituir CMD
   por migraciones o scripts de mantenimiento. Confirmar revisión, pull y Ready.
7. **Comprobación interna:** por consola autorizada, consultar localhost:3000/api/health, comprobar
   UID/PID/cgroups y presencia de variables mediante booleanos. Registrar únicamente resultados.
   El arranque ejecuta SELECT 1 de Prisma contra Aiven: junto con TLS estricto, acredita conexión de
   inicialización. Si se necesita confirmación sostenida, ejecutar un único SELECT 1 con el mismo
   PrismaService desde la revisión y salida PASS/FAIL, sin mostrar configuración. No listar tablas,
   filas o grants de nuevo, ni ejecutar migraciones o modificar la base.
8. **HTTPS público, autorización aparte:** tras controles internos y seguridad aprobados, en Ingress
   habilitar acceso externo con allowInsecure=false, mismo targetPort=3000 y transport=auto. Confirmar
   certificado del FQDN Azure sin `-k`, TLS válido y HTTP sin contenido de API (redirigido/rechazado).
   Verificar GET /api/health=200 y cuerpo esperado, /api/admin/me=401 sin sesión, /api/docs=404,
   preflight CORS con origen exacto autorizado y rechazo de un origen ajeno. No cambiar frontend/DNS.
9. **Proxy sin divulgar IP:** inventariar todas las vías, incluidas llamadas dentro del entorno; solo
   habilitar TRUSTED_PROXY_HOPS=1 si no se puede alcanzar directamente NestJS. Para observar la IP
   efectiva se necesita instrumentación temporal protegida de la revisión de prueba: comparar en
   memoria `req.ip` con la IP de prueba conocida por el operador y emitir solo booleanos/HMAC con
   clave efímera privada, nunca IP/socket/cabeceras crudas. No hay actualmente una sonda así: prepararla
   y revisarla antes de esa prueba; no añadir una ruta pública de diagnóstico. Probar dos clientes,
   IPv4/IPv6 y X-Forwarded-For falsificado; el identificador del cliente debe permanecer estable ante
   prefijos falsos y diferenciar clientes. Eliminar instrumentación después y revalidar digest.
   Pruebas de cuota que escriban en Aiven no quedan autorizadas: usar destino desechable o pedir
   autorización de escritura aparte. Véase [proxy Azure](proxy-azure.md).
10. **Arranque frío:** cesar tráfico/monitores, observar réplicas hasta cero y medir primera/segunda
    lectura health. Eso no prueba un POST de chatbot ni la latencia OpenAI. Ensayarlos solo después
    con destino ficticio y permiso de consumo si se usa IA real. No subir timeouts por conveniencia.
11. **Cierre:** min=0 permite reducir por inactividad pero no detiene inmediatamente ni impide reactivar
    por tráfico. Para parada garantizada del ensayo, con autorización, desactivar **cada revisión
    activa de esta app de prueba** en Revisions and replicas; verificar cero réplicas. No poner max=0
    (máximo admitido mínimo 1), ni confundir tráfico 0 % con proceso detenido. Reactivar requiere
    nueva ventana; no eliminar recursos compartidos ni versiones de imagen para ahorrar.
12. **Costes:** revisar grupo y suscripción en Cost Analysis, recursos creados y sus cargos individuales,
    además de GHCR/Aiven. Costes pueden llegar con retraso: comprobar al cierre y al día siguiente.
    Logs/almacenamiento/red pueden persistir tras detener app. Documentar qué se conserva y pedir
    autorización específica para cualquier eliminación posterior.

Fuentes operativas: [ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview),
[escalado](https://learn.microsoft.com/en-us/azure/container-apps/scale-app),
[desactivación](https://learn.microsoft.com/en-us/azure/container-apps/application-lifecycle-management#deactivate).

## 8. Cambios necesarios, bloqueos y siguiente autorización

Esta fase añade **solo este documento**. No necesitan cambios por E.1 Dockerfile, `.env.example`,
fuentes, dependencias ni workflows. Se conservan las modificaciones anteriores y los archivos sin
seguimiento del equipo; no hay commit, push, publicación, despliegue ni modificación de Aiven/MySQL.
Verificación E.1: enlaces locales sin destinos ausentes, UTF-8 sin caracteres de reemplazo y
`git diff --check` sin errores de espacios. El diff del archivo nuevo frente a NUL devuelve 1 por
contenido nuevo, sin diagnósticos de espacios. No se ejecutaron builds ni suites por este cambio documental.

Bloqueos antes del primer despliegue: candidata con HOST/proxy nueva e inventariada; ensayo de
recursos pequeños y escaneo reciente; decisión explícita de seguridad; GHCR privado/lector/digest
verificados; suscripción/créditos/región/cuotas/presupuesto; secretos y CA preparados en destino;
topología efectiva e instrumentación de IP aún no comprobadas. Uploads persistentes, correo e IA
son prerrequisitos para sus funcionalidades, no para el smoke limitado de lectura propuesto.

**Próxima autorización mínima:** iniciar Docker y construir, escanear y ensayar localmente una
candidata E.1 con el código actual aprobado y 0,25 vCPU/0,5 GiB, exclusivamente con recursos
desechables propios y datos ficticios. Sin GHCR, Azure, Aiven, MySQL local real ni cambios de secretos.
Una vez revisado ese resultado se podrá pedir autorización concreta para la publicación privada.
