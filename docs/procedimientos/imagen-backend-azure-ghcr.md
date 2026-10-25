# Imagen del backend para Azure Container Apps y GHCR

La configuración de proxy añadida en D.4 se describe en [Proxy HTTP de Azure](proxy-azure.md).
El modo `TRUSTED_PROXY_HOPS=1` es una alternativa excluyente a CIDRs y exige ingress único sin acceso
directo a NestJS. La imagen r4 descrita abajo es anterior a D.4 y no contiene ese cambio.

## Cierre del 24/10/2026: candidata r4 y operación futura

La candidata actual es **`horus-aca-backend:security-20261024-r4-67ad23fa0935`**, índice OCI local
`sha256:aa5213974af6704ec7addc19f6dfd6b23a7f223c5e1dc0da2eae0f0fb971ff35`.
Añade la retirada de SUID/SGID en `/usr/bin` y `/usr/sbin`; no cambia la API, React ni el esquema.
Las secciones r2 y del 23/10 inferiores son históricas. Sus comandos no deben utilizarse para publicar r4.
La etiqueta r3 sufrió una colisión entre dos builds propios y no es una referencia aprobada; r4 se
ensayó de nuevo ejecutando por el ID inmutable guardado por buildx, con etiqueta exclusiva.
La referencia de revisión OCI identifica el HEAD base con el que se construyó la candidata, anterior
a los cuatro commits locales autorizados posteriormente; crear esos commits no cambia la imagen.
El detalle de validación y los grupos autorizados están en [el cierre](seguridad-docker-aiven-20261023.md).

### Publicación privada: ventana separada y autorizada

1. Aprobar inventario, commits y riesgo residual; comprobar que la imagen se corresponde con los
   archivos aprobados y volver a escanear si cambia cualquier contenido o la base. No reconstruir
   silenciosamente para publicar: el resultado sería otra candidata que necesita validación.
2. En GHCR verificar identidad, acceso, paquete y visibilidad efectiva **Private** antes del push.
   Un paquete nuevo es privado por defecto; uno existente debe comprobarse. Reservar etiqueta libre,
   sin sobrescribir versiones. La vinculación OCI al repositorio no sustituye comprobar permisos.
3. Usar PAT classic publicador con `write:packages`, sin delete ni repo innecesarios. El lector Azure
   es otra identidad/token con `read:packages` y acceso al paquete. Registrar caducidad y rotación.
   No crear ningún token durante esta preparación. Ver [documentación GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
4. Autenticar por stdin usando configuración Docker privada fuera del repositorio; no activar
   transcripción ni debug. El ejemplo solicita el secreto sin mostrarlo. No usar el token en argumentos.

```powershell
# SOLO en la ventana de publicación autorizada, con paquete y etiqueta verificados.
$candidate = 'horus-aca-backend:security-20261024-r4-67ad23fa0935'
$expectedDigest = 'sha256:aa5213974af6704ec7addc19f6dfd6b23a7f223c5e1dc0da2eae0f0fb971ff35'
$destination = 'ghcr.io/castope/horus-group-api:20261024-b55091f76ad8-aa5213974af6'
$descriptor = docker image inspect $candidate --format '{{json .Descriptor}}'
if ($LASTEXITCODE -ne 0) { throw 'Falta la imagen candidata.' }
if (($descriptor | ConvertFrom-Json).digest -ne $expectedDigest) { throw 'Candidata distinta.' }
$privateDockerConfig = Join-Path $env:TEMP ('horus-ghcr-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $privateDockerConfig | Out-Null
$operator = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $privateDockerConfig /inheritance:r /grant:r "$($operator):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudo restringir la carpeta privada.' }
$publishCredential = Read-Host 'PAT classic publicador autorizado' -AsSecureString
try {
  [Net.NetworkCredential]::new('', $publishCredential).Password |
    docker --config $privateDockerConfig login ghcr.io --username Castope --password-stdin
  if ($LASTEXITCODE -ne 0) { throw 'Falló login GHCR.' }
  docker tag $candidate $destination
  if ($LASTEXITCODE -ne 0) { throw 'Falló tag local.' }
  docker --config $privateDockerConfig push $destination
  if ($LASTEXITCODE -ne 0) { throw 'Falló push; no continuar a Azure.' }
  docker --config $privateDockerConfig buildx imagetools inspect $destination
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar el digest remoto.' }
} finally {
  docker --config $privateDockerConfig logout ghcr.io
  Remove-Variable publishCredential -ErrorAction SilentlyContinue
}
```

Registrar el digest remoto y compararlo con el aprobado; detenerse ante discrepancias, sin sustituir
la etiqueta ni aprobar otro digest automáticamente. Reconfirmar Private y permisos; probar pull con
la identidad de solo lectura desde un contexto sin caché/autenticación del publicador. Usar en Azure
`ghcr.io/castope/horus-group-api@sha256:<DIGEST_REMOTO_VERIFICADO>`, nunca latest.
Un fallo de Azure no justifica borrar versiones GHCR: conservar la anterior para reversión.

### Azure Container Apps Consumption: configuración y primera revisión

**Procedimiento preparado, no aplicado.** Antes: confirmar suscripción, tenant, grupo, región,
entorno Consumption, cuotas y presupuesto con el responsable. No crear recursos de pago implícitamente.
La creación del entorno, Azure Files y su enlace de almacenamiento requiere autorización propia si no existen.
Usar un recurso nuevo para la primera prueba; si la app ya existe, inventariar configuración/revisiones y
aplicar el procedimiento de actualización inferior sin sustituirla con esta plantilla.

Preparar `horus-aca-private.yaml` **fuera de Git**, en una carpeta privada del operador, a partir del siguiente
modelo. Los marcadores no son valores operativos. Introducir secretos desde el gestor autorizado, sin
imprimir YAML ni respuestas de listSecrets; alternativa: referencias Key Vault con identidad autorizada,
si ya existe esa infraestructura. No pasar contraseñas con `--secrets` o `--registry-password` en argumentos.
Los secretos son de ámbito aplicación y sus cambios no crean una revisión automáticamente; conservar
nombres/versiones anteriores para reversión. Ver [gestión de secretos](https://learn.microsoft.com/en-us/azure/container-apps/manage-secrets).

```yaml
location: <REGION_APROBADA>
name: horus-group-api-dev
properties:
  managedEnvironmentId: <RESOURCE_ID_ENTORNO_CONSUMPTION>
  workloadProfileName: Consumption
  configuration:
    activeRevisionsMode: Single
    ingress:
      external: false
      allowInsecure: false
      targetPort: 3000
      transport: auto
    registries:
      - server: ghcr.io
        username: <IDENTIDAD_GHCR_LECTORA>
        passwordSecretRef: ghcr-read-v1
    secrets:
      - name: ghcr-read-v1
        value: <TOKEN_LECTOR_DEL_GESTOR>
      - name: db-pass-v1
        value: <PASSWORD_HORUS_APP_DEL_GESTOR>
      - name: aiven-ca-v1
        value: <PEM_CA_CON_SALTOS_ESCAPADOS_COMO_\n>
      - name: jwt-v1
        value: <SECRETO_JWT_PROPIO_32_O_MAS_CARACTERES>
  template:
    revisionSuffix: r4-20261024
    containers:
      - name: api
        image: ghcr.io/castope/horus-group-api@sha256:<DIGEST_REMOTO_VERIFICADO>
        resources:
          cpu: 1.0
          memory: 2Gi
        env:
          - {name: NODE_ENV, value: production}
          - {name: PORT, value: '3000'}
          - {name: DB_HOST, value: <DNS_AIVEN_VERIFICADO>}
          - {name: DB_PORT, value: '<PUERTO_AIVEN>'}
          - {name: DB_NAME, value: horus_db}
          - {name: DB_USER, value: horus_app}
          - {name: DB_PASS, secretRef: db-pass-v1}
          - {name: DB_SSL, value: 'true'}
          - {name: DB_SSL_CA, secretRef: aiven-ca-v1}
          - {name: DB_SYNC, value: 'false'}
          - {name: JWT_SECRET, secretRef: jwt-v1}
          - {name: CORS_ORIGINS, value: '<ORIGEN_HTTPS_REACT_APROBADO>'}
          - {name: SWAGGER_ENABLED, value: 'false'}
          - {name: CHATBOT_AI_ENABLED, value: 'false'}
          - {name: UPLOAD_DIR, value: /mnt/horus-uploads}
        volumeMounts:
          - {volumeName: uploads, mountPath: /mnt/horus-uploads}
        probes:
          - type: Startup
            httpGet: {path: /api/health, port: 3000, scheme: HTTP}
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 24
          - type: Readiness
            httpGet: {path: /api/health, port: 3000, scheme: HTTP}
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          - type: Liveness
            httpGet: {path: /api/health, port: 3000, scheme: HTTP}
            periodSeconds: 20
            timeoutSeconds: 3
            failureThreshold: 3
    scale:
      minReplicas: 0
      maxReplicas: 1
      rules:
        - name: http
          http: {metadata: {concurrentRequests: '10'}}
    volumes:
      - name: uploads
        storageType: AzureFile
        storageName: <ENLACE_AZURE_FILES_PREPARADO_EN_EL_ENTORNO>
        mountOptions: uid=1000,gid=1000,file_mode=0600,dir_mode=0700
```

El modelo usa campos del [esquema Container Apps](https://learn.microsoft.com/en-us/azure/templates/microsoft.app/2025-07-01/containerapps).
Los permisos/opciones SMB son una propuesta que requiere prueba en el montaje real; no acreditan persistencia
ni compatibilidad Azure ya probadas. La API arranca como UID 1000 y no puede arreglar un share root-only.
El punto `/mnt/horus-uploads` evita depender del ajuste root del CMD bajo `/data/`. Montar el share desde el
entorno según [Azure Files en Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts).
Comprobar escritura, lectura después de reiniciar/cambiar revisión y respaldo de archivos antes de habilitar uploads.

No añadir `securityContext`, `capDrop` ni `noNewPrivileges` al YAML: no están expuestos en el esquema
Container Apps consultado. Los controles Docker del ensayo no se transfieren automáticamente a Azure.
r4 retira SUID/SGID en la imagen sin depender de esos campos. Inspeccionar UID, CapEff y NoNewPrivs del
proceso real posteriormente; no atribuir controles de AKS a Container Apps.

Estos comandos son para la **ventana Azure autorizada**, después de activar y validar Aiven:

```powershell
$subscription = '<SUBSCRIPCION_APROBADA>'
$resourceGroup = '<GRUPO_APROBADO>'
$environment = '<ENTORNO_CONSUMPTION_APROBADO>'
$app = 'horus-group-api-dev'
az account show --query '{subscription:id,tenant:tenantId}' --output json
if ($LASTEXITCODE -ne 0) { throw 'No se verificó la identidad Azure.' }
# Comparar salida con el expediente aprobado; no cambiar la suscripción por comodidad.
az containerapp env show --subscription $subscription --resource-group $resourceGroup --name $environment --query '{id:id,location:location,profiles:properties.workloadProfiles}' --output json
if ($LASTEXITCODE -ne 0) { throw 'Entorno pendiente; no crearlo automáticamente.' }
az containerapp create --subscription $subscription --resource-group $resourceGroup --name $app --environment $environment --yaml '<RUTA_PRIVADA>\horus-aca-private.yaml' --only-show-errors --output none
if ($LASTEXITCODE -ne 0) { throw 'Falló el despliegue; no habilitar ingreso público.' }
az containerapp revision list --subscription $subscription --resource-group $resourceGroup --name $app --query '[].{name:name,active:properties.active,health:properties.healthState,running:properties.runningState}' --output table
if ($LASTEXITCODE -ne 0) { throw 'No se verificó la revisión.' }
```

Revisar eventos de pull/probes y logs sanitizados. Desde una sesión autorizada en el entorno verificar
`/api/health` 200, `/api/admin/me` 401 sin sesión, Swagger 404, catálogo y esquema con `horus_app`.
El health solo comprueba vida tras el SELECT de arranque; no asegura conectividad continua, grants ni migraciones.
Login real exige una cuenta Horus aprobada: su creación y los datos de smoke remoto son autorizaciones aparte.

Reconfirmar CORS con el origen React y preflight OPTIONS, mantener rutas `/api`, respuestas y Authorization
actuales. Comprobar proxy real y cuotas antes de fijar TRUSTED_PROXY_CIDRS; no usar /0 ni confiar en cualquier
X-Forwarded-For. No modificar React en esta preparación. Si el frontend usa proxy /api de Railway/Caddy,
comprobar su encaminamiento al nuevo destino antes de cambiar DNS o URL pública; una URL Azure por sí sola
no conecta ese frontend. Aprobar ese cambio por separado.

Solo tras aprobar riesgo residual y validación: cambiar `external` a `true` en la configuración revisada y
aplicar `az containerapp update --subscription ... --resource-group ... --name ... --yaml <RUTA_PRIVADA> --output none`.
Conservar `allowInsecure: false`. La primera revisión permanece interna hasta esa autorización.

### Actualizaciones, reversión y costo

En una app existente, registrar digest y revisión estable, configuración y referencias de secretos;
respaldar datos y uploads. Antes de crear una revisión nueva, habilitar modo multiple y fijar el peso
a la revisión anterior por nombre, eliminando la regla implícita latest. Ejemplo **solo autorizado**:

```powershell
# Variables subscription/resourceGroup/app y oldRevision/newRevision verificadas previamente.
az containerapp revision set-mode --subscription $subscription -g $resourceGroup -n $app --mode multiple --output none
if ($LASTEXITCODE -ne 0) { throw 'No se cambió el modo.' }
az containerapp ingress traffic set --subscription $subscription -g $resourceGroup -n $app --revision-weight "$oldRevision=100" --output none
if ($LASTEXITCODE -ne 0) { throw 'No se fijó el tráfico estable.' }
# Actualizar por YAML revisado: conservar traffic con oldRevision=100 y nueva revisión sin tráfico.
# Esperar Ready; probar la nueva revisión mediante etiqueta/ruta de validación autorizada.
az containerapp ingress traffic set --subscription $subscription -g $resourceGroup -n $app --revision-weight "$newRevision=100" "$oldRevision=0" --output none
if ($LASTEXITCODE -ne 0) { throw 'No se confirmó el cambio de tráfico.' }
# Si falla la validación y el esquema sigue siendo compatible:
az containerapp ingress traffic set --subscription $subscription -g $resourceGroup -n $app --revision-weight "$oldRevision=100" "$newRevision=0" --output none
```

La última sentencia es la **alternativa de reversión**, no el siguiente paso de un despliegue correcto.
Comprobar salud y tráfico después de cada cambio. No basta peso cero para detener escritores/background jobs:
desactivar revisiones que deban dejar de escribir solo con autorización y conservando la estable.
No borrar imágenes, revisiones ni datos como parte del rollback. Volver a una imagen no restaura la base;
una recuperación de datos sigue [el procedimiento Aiven](aiven-mysql-preparacion-segura.md).
El cambio de pesos y su suma de 100 se documentan en [traffic splitting](https://learn.microsoft.com/en-us/azure/container-apps/traffic-splitting).

Inicio económico propuesto: min=0, max=1, IA apagada y regla HTTP objetivo 10. El objetivo de escalado no
es un límite duro de solicitudes ni prueba de carga. Cold starts y apagados por inactividad de Aiven pueden
afectar latencia; medir antes de decidir min=1. Cada revisión activa puede añadir su pool de dos conexiones.
Reservar margen de las 76 conexiones para mantenimiento, sistema y solapamiento de revisiones.
Azure Files, logs, transferencia y réplicas pueden facturarse; Consumption no garantiza costo cero.
Definir presupuesto/alertas, retención limitada de logs y supervisión de memoria, latencia, 5xx y disco Aiven;
ver [facturación oficial](https://learn.microsoft.com/en-us/azure/container-apps/billing).

## Continuación anterior del 24/10/2026: r2 histórica

La candidata anterior era **`horus-aca-backend:security-20261023-r2`**, índice OCI
`sha256:0710bf09aefdd00b1b3f0c64d37af43077205fde99e56cf98871e3b84cfd8b1b`.
Resultados e inventario: [entrega de seguridad](seguridad-docker-aiven-20261023.md).
Los [ocho avisos altos de Debian](debian-imagen-backend-20261024.md) siguen en el informe:
**no se declara la imagen libre de vulnerabilidades ni aprobada para exposición pública**.

El resto de esta guía conserva el ensayo histórico de la imagen `3b0e09106d0b`, sus recursos y sus límites.
Su etiqueta y sus comandos de publicación **no corresponden a la candidata corregida**.
La afirmación histórica de que no cambian dependencias o Dockerfile tampoco describe el estado actual.

### Preparación GHCR para la candidata corregida

Solo preparación documental; **no se ejecutaron login, tag remoto, push ni creación/rotación de tokens**.
Nombre previsto: `ghcr.io/castope/horus-group-api`. Etiqueta nueva propuesta:
`20261024-b55091f76ad8-0710bf09aefd`. El fragmento `b55091f76ad8` identifica el HEAD base,
no un commit de estos cambios locales. Se conserva la candidata local y la etiqueta histórica.

1. Resolver o aceptar explícitamente el riesgo residual antes de exposición pública. Comprobar cuenta,
   permisos, paquete y visibilidad efectiva **Private**, y que la etiqueta propuesta esté libre.
   No se consultó el estado remoto ni se garantiza reserva del nombre.
2. Para una futura publicación manual autorizada, usar un PAT classic con `write:packages`, sin
   `delete:packages` ni `repo` innecesarios, separado del lector de Azure. No incorporar tokens al build.
   En un futuro workflow autorizado, GitHub recomienda `GITHUB_TOKEN` con `packages: write` para su propio repositorio;
   no se creó ni modificó ningún workflow.
3. Comparar el índice local exacto y etiquetar la imagen existente, sin reconstruirla. Un build posterior
   con apt puede producir otro resultado aunque conserve el Dockerfile.
4. Publicar solo con autorización posterior; inspeccionar el digest remoto, visibilidad y permisos.
   Fijar en Azure `ghcr.io/castope/horus-group-api@sha256:<DIGEST_REMOTO_VERIFICADO>`.
5. Preparar por separado el lector PAT classic `read:packages` de Azure, con caducidad y acceso mínimo
   de su identidad. Guardarlo como secreto del registro (`passwordSecretRef`); no es variable de la API.
   El scope del PAT no lo restringe por sí solo a un único paquete. Probar pull privado y arranque en Azure
   queda pendiente, igual que los permisos del volumen persistente para UID 1000.

Comandos para una **ventana futura autorizada**; no ejecutar durante esta preparación:

```powershell
$candidate = 'horus-aca-backend:security-20261023-r2'
$expectedDigest = 'sha256:0710bf09aefdd00b1b3f0c64d37af43077205fde99e56cf98871e3b84cfd8b1b'
$descriptorJson = docker image inspect $candidate --format '{{json .Descriptor}}'
if ($LASTEXITCODE -ne 0) { throw 'No se pudo inspeccionar la candidata local.' }
if (($descriptorJson | ConvertFrom-Json).digest -ne $expectedDigest) { throw 'Digest local diferente.' }
$destination = 'ghcr.io/castope/horus-group-api:20261024-b55091f76ad8-0710bf09aefd'
# Antes: verificar que destination no exista y que el paquete sea privado.
docker tag $candidate $destination
if ($LASTEXITCODE -ne 0) { throw 'Falló el etiquetado local.' }
# Autenticar con el publicador autorizado mediante password-stdin y el gestor privado.
# No pegar tokens en argumentos, archivos del proyecto ni historial.
docker push $destination
if ($LASTEXITCODE -ne 0) { throw 'Falló la publicación.' }
docker buildx imagetools inspect $destination
if ($LASTEXITCODE -ne 0) { throw 'No se pudo verificar el digest remoto.' }
# Registrar el digest remoto y verificar Private en Package settings antes del pull Azure.
```

Confirmado documentalmente con [GitHub Container registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
Preparación de identidad, TLS, privilegios y migraciones futuras de la base:
[Aiven MySQL](aiven-mysql-preparacion-segura.md). Nada de este procedimiento activa Aiven ni Azure.

## Resultado del 23/10/2026 (America/Lima)

**Imagen construida y ejecutada localmente. Seguridad pendiente: no aprobada para exposición pública.**
No se publicó en GHCR, no se crearon tokens, no se desplegó en Azure y no se hizo commit ni push.
Rama: `anderson`; base: `b55091f76ad8c817d60d5327dba5430485ee3c0b`.

Los únicos cambios del repositorio son las exclusiones adicionales en `backend/.dockerignore` y esta guía.
El Dockerfile, el código de aplicación, las dependencias, los lockfiles, las migraciones, React y Actions se conservan.

| Comprobación ejecutada | Resultado |
| --- | --- |
| Construcción con `docker build --platform linux/amd64` | Correcta, salida 0. |
| Node en la imagen | 22.23.4; ambas etapas usan `node:22-bookworm-slim`. |
| Prisma | Cliente 6.19.3 generado por postinstall y por build; consulta real `SELECT 1` al iniciar. |
| Arquitectura inspeccionada | `linux/amd64`; Node informa `linux/x64`. |
| Recursos de los dos contenedores de API | Límite real de 1 CPU y 2 GiB mediante cgroups. |
| PID 1, comando predeterminado | `node`, UID/GID 1000, `CapEff=0000000000000000`. |
| Arranque explícito con `--user 1000:1000` | Correcto; UID/GID 1000 y sin capacidades efectivas. |
| Parada de las dos API | Señal de parada atendida, salida 0, sin OOM. |
| Puerto 3000 y `PORT=4080` | Ambos devuelven 200 y `{"ok":true}` en `/api/health`, también entre contenedores. |
| Ruta protegida sin sesión / Swagger en producción | 401 en `/api/admin/me`; 404 en `/api/docs`. |
| Directorio de uploads | Permiso de escritura comprobado con UID 1000 en el directorio de la imagen, sin volumen. |
| Tamaño informado por Docker | 786 680 697 bytes, aproximadamente 787 MB / 750,24 MiB. |
| Archivo local `docker image save` | 174 946 304 bytes; no equivale al tamaño de descarga futuro de GHCR. |
| Memoria observada en reposo | 104,4 MiB y 67,13 MiB; no es prueba de carga ni dimensionamiento definitivo. |
| Base utilizada | MySQL 8.4.11 propio, temporal y vacío; cero tablas de aplicación antes y después. |

La prueba usó una red Docker interna propia, sin puertos publicados y sin conexión a bases reales.
MySQL guardó sus datos en tmpfs. UUID de prueba: `dca22680-cf58-11f1-b2bd-5e5b1cff633e`.
Los tres contenedores propios y su red se retiraron tras comprobar sus identidades; se conserva la imagen local.
No se ejecutaron migraciones ni inicialización del esquema Horus. No se probaron login real, funciones de negocio,
correo, OpenAI, volumen Azure, conexión Aiven ni despliegue en Azure.

Al iniciar Docker Desktop con autorización, su política de reinicio reanudó automáticamente los tres contenedores
preexistentes de `horus-local`. No se ejecutaron operaciones sobre ellos ni sobre sus bases; no se afirma que
sus procesos estuvieran inactivos durante la comprobación.

## Seguridad y límites

Se revisaron 248 archivos candidatos del proyecto y las 12 capas de la imagen final: 21 518 archivos regulares,
540 079 257 bytes, incluidos archivos de dependencias y de la base. La búsqueda de patrones no halló tokens
GitHub/OpenAI/AWS, claves privadas del proyecto, archivos de entorno del proyecto ni variables de imagen
`DB_PASS`, `JWT_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `MAIL_PASS` o `GHCR_TOKEN`.
La URL de generación de Prisma tiene credenciales deliberadamente ficticias; no conecta con MySQL.

El detector bruto produjo dos hallazgos de la base pública, comprobados por SHA-256 contra el mismo digest de Node:

- Cinco bloques con formato de clave privada dentro de `libgnutls.so.30.34.3`. El binario es idéntico al de la base
  pública; no son claves incorporadas desde el proyecto. No sería exacto afirmar que la imagen carece de todo byte
  con formato de clave privada.
- `/usr/local/lib/node_modules/npm/.npmrc` es un archivo vacío, sin autenticación.

La revisión por patrones no certifica ausencia absoluta de secretos arbitrarios. No se leyó ni copió el `backend/.env`
real. El Dockerfile usa copias explícitas y el ignore excluye entorno, respaldos, uploads de datos, claves privadas,
almacenes de claves y directorios de credenciales. Se conserva `src/uploads` como código.

Auditorías ejecutadas sobre la imagen final, sin aplicar correcciones:

| Herramienta | Resultado |
| --- | --- |
| `npm audit --omit=dev --json` | Salida 1: 16 paquetes afectados, 10 altos y 6 moderados, 0 críticos. |
| `docker scout cves --only-severity critical,high` | 39 avisos únicos altos; 40 resultados SARIF por ubicaciones. Indexó 559 paquetes. |

Los contadores de npm y Scout tienen unidades y cobertura distintas; no deben sumarse.
El aviso intermedio de `npm prune` informó 17 paquetes; la consulta final independiente de npm devolvió 16.
Versiones presentes: MariaDB 3.4.5, body-parser 1.20.8, multer 2.0.2 y nodemailer 6.10.1.

Prioridad antes de exponer la API:

- [body-parser, GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828):
  el rango vulnerable incluye 1.20.8; una solicitud comprimida malformada puede provocar caída antes de autenticar.
  La actualización requiere una tarea acotada con regresiones.
- [MariaDB, GHSA-cqhc-2h57-wpxf](https://github.com/advisories/GHSA-cqhc-2h57-wpxf):
  afecta 3.4.5 al usar TLS sin CA explícita. Configurar la CA de Aiven y mantener verificación es indispensable,
  pero no resuelve por sí solo los demás avisos del conector.
- Revisar también multer, nodemailer, dependencias transitivas y paquetes Debian del informe Scout.
  Los hallazgos no demuestran que cada aviso sea explotable por una ruta Horus.

No se cambian dependencias ni se ejecuta `npm audit fix` en esta preparación.
`npm prune --omit=dev` retiró ts-node y Nest CLI, pero Prisma CLI y TypeScript permanecen por el árbol de peers.
No se eliminan módulos manualmente. Prisma emitió una advertencia de autodetección de OpenSSL en el builder:
generó correctamente y el runtime con `engineType="client"` y adaptador MariaDB inició y consultó MySQL.
No se ejecuta Prisma CLI al arrancar la API; no se ha validado su uso para mantenimiento dentro del runtime.

## Identidad de la imagen y construcción

Nombre propuesto: `ghcr.io/castope/horus-group-api`.

Etiqueta de esta versión, que debe reservarse y no sobrescribirse:
`20261023-b55091f76ad8-3b0e09106d0b`.

Digest local OCI (índice, incluye la atestación del build):

```text
sha256:3b0e09106d0bafde7ea6508ebfe5d5484cd37ed2a9ea4ff34a32a7b20f9d5a54
```

La imagen ya tiene esa etiqueta GHCR **solo en el almacén local**. Una etiqueta puede sobrescribirse:
la referencia realmente inmutable es `ghcr.io/castope/horus-group-api@sha256:<digest-confirmado-en-GHCR>`.
Tras una publicación autorizada, comprobar el digest remoto y usarlo en Azure. No se presume que el paquete exista,
que no haya una colisión de nombre o que su visibilidad actual sea privada: no se consultó GHCR.

Construcción ejecutada desde la raíz, sin `--push`:

```powershell
docker build --platform linux/amd64 --progress plain `
  --label org.opencontainers.image.source=https://github.com/Castope/Proyecto-Horus- `
  --label org.opencontainers.image.revision=b55091f76ad8c817d60d5327dba5430485ee3c0b `
  --label org.opencontainers.image.title=horus-group-api `
  --tag horus-aca-backend:verify-b55091f76ad8-20261023 `
  --file backend/Dockerfile backend
```

Base resuelta: `node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d`.
El Dockerfile conserva la etiqueta móvil Node 22. Reconstruir otro día puede producir otro digest;
no reutilizar la etiqueta de esta versión para ese resultado. La revisión OCI etiqueta el HEAD de partida;
el ignore adicional todavía no tiene commit.

## Publicación futura: no ejecutada y exige autorización

Primero revisar los avisos de seguridad y comprobar en GHCR que el paquete es nuevo o privado, que la cuenta
tiene permiso y que la etiqueta no existe. Los paquetes nuevos de GHCR son privados por defecto, pero eso no cambia
la visibilidad de un paquete preexistente.

Crear en ese momento un PAT **classic** de publicación con `write:packages`, separado del token de Azure.
Evitar `repo` y `delete:packages`; GitHub permite preseleccionar el scope mediante
[su formulario](https://github.com/settings/tokens/new?scopes=write:packages).
No crear tokens ni pegar sus valores en este documento.

Comandos de la futura publicación de **la imagen ya verificada**, sin reconstruirla:

```powershell
docker image inspect ghcr.io/castope/horus-group-api:20261023-b55091f76ad8-3b0e09106d0b --format '{{json .Descriptor}}'
# Comparar el digest con el de esta entrega antes de continuar.
$ghcrPublishToken = Read-Host 'PAT classic de publicación' -AsSecureString
[System.Net.NetworkCredential]::new('', $ghcrPublishToken).Password |
  docker login ghcr.io --username Castope --password-stdin
if ($LASTEXITCODE -ne 0) { throw 'Falló la autenticación GHCR.' }

docker push ghcr.io/castope/horus-group-api:20261023-b55091f76ad8-3b0e09106d0b
if ($LASTEXITCODE -ne 0) { throw 'Falló la publicación GHCR.' }

docker buildx imagetools inspect ghcr.io/castope/horus-group-api:20261023-b55091f76ad8-3b0e09106d0b
# Registrar el digest remoto; verificar visibilidad Private en Package settings.
docker logout ghcr.io
Remove-Variable ghcrPublishToken
```

Si publica otra identidad autorizada, cambiar únicamente el usuario de login por su nombre GitHub.
El label OCI enlaza el paquete con `Castope/Proyecto-Horus-`; comprobar sus permisos y visibilidad tras publicarlo.

## Credenciales de lectura para Azure: preparación documental

1. En GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token.
2. Elegir descripción y caducidad; marcar **solo** `read:packages`.
   No marcar `repo`, `write:packages` ni `delete:packages`. Autorizar SSO si corresponde.
3. La identidad debe tener acceso de lectura al paquete privado. Para limitar el alcance a ese paquete, usar una
   identidad técnica con acceso únicamente al paquete necesario, si la política de GitHub lo permite.
   Un PAT classic con `read:packages` **no restringe por sí solo el token a un único paquete**:
   hereda los paquetes legibles por su propietario. GHCR documenta PAT classic para este flujo.
4. En `horus-group-api-dev`, configurar registro privado: servidor `ghcr.io`, usuario de esa identidad y
   contraseña mediante un secreto de Container Apps, por ejemplo `ghcr-read-token`.
   La configuración del registro lo referencia mediante `passwordSecretRef`.
   El token no es una variable de la API ni se incorpora al build.
5. Guardarlo en el gestor autorizado y planificar rotación. Comprobar posteriormente pull privado y arranque de
   una revisión; estas acciones siguen pendientes.

## Configuración requerida de Azure

Aplicación prevista: `horus-group-api-dev`. Recursos: CPU `1.0`, memoria `2Gi`.
Es una combinación admitida por Container Apps. Imagen Linux amd64; ingreso HTTP con target port `3000`
(o el mismo valor que `PORT`). HTTPS externo, sin modificar el comando de arranque. Configurar probes HTTP
de inicio, disponibilidad y vida en `/api/health` con ese puerto; conceder tiempo suficiente para conectar MySQL.
El health no comprueba MySQL en cada solicitud: el `SELECT 1` ocurre al iniciar.

| Variable | Valor o procedencia |
| --- | --- |
| `NODE_ENV` | `production` (ya es el valor de la imagen). |
| `PORT` | `3000`; si cambia, ajustar target port y probes. |
| `DB_HOST` | Host DNS de Aiven, sin protocolo; no localhost. |
| `DB_PORT` | Puerto real de Aiven; no asumir 3306. |
| `DB_NAME` | Base remota prevista para Horus, comprobada antes de operaciones. |
| `DB_USER` | Cuenta de aplicación de privilegios mínimos, distinta de mantenimiento. |
| `DB_PASS` | Referencia a secreto de Azure. |
| `DB_SSL` | `true`; conservar `rejectUnauthorized: true`. |
| `DB_SSL_CA` | **Contenido PEM de la CA del proyecto Aiven**, no ruta. Admite saltos reales o `\n` literales; referencia a secreto/configuración de Azure. |
| `DB_SYNC` | `false`; no programar migraciones en el arranque. |
| `JWT_SECRET` | Referencia a secreto aleatorio propio de al menos 32 caracteres. |
| `CORS_ORIGINS` | Orígenes HTTPS exactos del frontend, separados por comas, sin rutas ni barra final; obligatorio. |
| `SWAGGER_ENABLED` | `false`. |
| `UPLOAD_DIR` | Directorio persistente compartido entre réplicas; ver apartado siguiente. |
| `TRUSTED_PROXY_CIDRS` | IPs/CIDRs reales del proxy comprobados en ese entorno. Sin comodines ni `/0`; no inventar rangos. |
| `CHATBOT_AI_ENABLED` | `false` durante la preparación; habilitar solo con configuración propia autorizada. |

La aplicación usa `DB_*`, no necesita `DATABASE_URL` en ejecución ni una clave privada de Aiven.
`DB_RSA_PUBLIC_KEY` no es necesaria con TLS verificado.
Para correo, configurar `MAIL_PROVIDER=resend|gmail` y variables de [MAIL.md](../../backend/MAIL.md).
Para IA, consultar [CHATBOT.md](../../backend/CHATBOT.md). Correo e IA son opcionales para arrancar;
no se probaron proveedores reales.

### Persistencia y usuario

El comando inicia brevemente como root, corrige el propietario de `UPLOAD_DIR` bajo `/data/` y ejecuta
`node dist/main.js` con UID/GID 1000 mediante setpriv. La imagen no declara `USER node`;
también puede iniciarse como UID 1000 si el almacenamiento ya es escribible, como se comprobó.

El directorio de la imagen **no ofrece persistencia** en Azure. Planificar Azure Files y comprobar una escritura
real tras montarlo. En un montaje SMB, el `chown -R` del comando puede fallar y detener el arranque.
No asumir que las reglas de volúmenes Railway se aplican a Azure Files.

Alternativa de configuración pendiente de probar en Azure: montar el share en `/mnt/horus-uploads`,
usar esa ruta como `UPLOAD_DIR` (fuera de `/data/`, para evitar el chown del comando actual) y establecer
permisos/opciones de montaje compatibles con UID/GID 1000. No cambiar el usuario de la API a root.
La selección concreta de protocolo y opciones depende del entorno; no se creó un share.

## Impedimentos y condiciones pendientes

- Publicación, visibilidad Private y pull de GHCR desde Azure pendientes.
- Recursos, suscripción, región, cuota y red de `horus-group-api-dev` sin comprobar.
- Sin variables de producción válidas, la API termina antes de escuchar.
- Sin DNS, puerto, firewall, CA y credenciales Aiven correctos, falla el `SELECT 1` de arranque.
- Aiven debe tener el esquema Horus compatible. Un health 200 solo acredita arranque y vida, no tablas,
  migraciones ni integridad. Preparar esa base requiere otra operación autorizada.
- Sin almacenamiento persistente o con permisos incompatibles, uploads falla; un fallo del chown bajo `/data/`
  puede impedir el arranque del contenedor.
- Sin proxies confiables, visitantes distintos pueden compartir cuota por la IP del proxy.
- Resolver o evaluar explícitamente los hallazgos altos de npm y Scout antes de exposición pública.
  No se demostró explotación de Horus ni se declara la imagen libre de vulnerabilidades.

## Referencias oficiales y evidencia local

- [Requisitos, recursos y registro privado de Azure](https://learn.microsoft.com/en-us/azure/container-apps/containers).
- [Probes de Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/health-probes).
- [Almacenamiento de Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts).
- [Autenticación, publicación, privacidad y digest de GHCR](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).
- [TLS y CA de Aiven](https://aiven.io/docs/platform/concepts/tls-ssl-certificates).

Informes `npm-audit.json`, `scout.sarif.json`, `layers-security.json` y `layers-security-reviewed.json`, detector y archivo de imagen:
`%TEMP%\horus-aca-20261023-568385538dc6\`, fuera de Git.
El informe bruto de capas conserva los dos hallazgos de base clasificados arriba; su salida 1 exige esa revisión,
no significa que se encontraran credenciales del proyecto.
