# Copia cifrada local → Aiven: implementación y ensayo

24/10/2026. Preparación local, sin acceso a las bases reales. Complementa
[la preparación anterior](migracion-local-aiven-preparacion.md); ese archivo era trabajo
previo sin seguimiento y se conserva intacto. **La conclusión de imágenes de su apartado D
no corresponde al frontend actual**: se corrige a continuación. No autoriza migración,
cuentas, cambios de privilegios reales, GHCR ni Azure.

## Auditoría estática de contenido y uploads

| Hallazgo y evidencia | Clasificación | Efecto |
| --- | --- | --- |
| Home, servicios, cursos, detalles, galería, FAQ y ajustes importan `useInstitutionalResource`, a menudo con el alias `usePublicResource`. `institutional/source.ts` lee `catalog.ts` con `createInstitutionalReader`; no hace fetch | Funcionalidad vigente | El contenido visual procede del código y de `frontend/public`, no de esas filas de MySQL |
| `institutional/catalog.ts`: 40 campos `imagen_url`/`logo_url`, cero uploads, cero localhost; los 40 archivos referenciados existen bajo `frontend/public` | Funcionalidad vigente | No se trasladan ni modifican estos recursos; el build debe seguir incluyéndolos |
| `layouts/MainLayout.tsx` monta `Chatbot`; `chatApi.ts` llama `/chatbot/message`. `ChatbotService.candidates` consulta cursos, servicios, FAQ, convenios y settings por Prisma y selecciona textos, sin imágenes | Funcionalidad vigente | MySQL sigue siendo necesario para respuestas textuales; conservar registros. Puede haber diferencias de contenido/IDs entre catálogo versionado y respuestas del chatbot |
| `GuidedMenu.tsx` contiene consultas de catálogo pero no tiene importadores en `frontend/src` | Código heredado sin consumidores identificados | Su código no prueba una petición actual del navegador |
| `AdminDashboard.tsx` muestra «Esta gestión se retiró del panel» para secciones editoriales retiradas y no monta `ResourceManager` ni `PanelConvenios` | Funcionalidad vigente | La retirada es efectiva en la navegación y el render del panel |
| `ResourceManager`, `PanelConvenios`, `ConvenioEditor`, `ConvenioPhotosEditor`, `ImageUpload` y tipos/editoriales permanecen en el árbol; los dos componentes raíz no tienen importadores actuales | Código heredado sin consumidores identificados | La eliminación de código no fue completa; no se elimina en esta tarea |
| `app.module.ts` importa `UploadsModule`; GET `/api/uploads/:filename` público y POST `/api/admin/uploads` con JWT y `archivos:crear` siguen activos | Funcionalidad vigente en la API; dependencia externa pendiente de confirmar | Un cliente autorizado puede seguir subiendo por API; archivos antiguos ausentes devuelven error de lectura. Retirar la UI no retira las rutas |
| APIs de catálogo/convenios y el normalizador `contentImages.ts` se conservan | Dependencia pendiente de confirmar para clientes externos o builds antiguos | Pueden devolver las referencias antiguas; el normalizador cambia localhost a la API configurada, pero no recupera archivos |

**Las 27 referencias** (16 servicios, 5 cursos, 4 logos y 2 fotos de convenios), incluidas
las seis localhost, son el inventario histórico aportado y documentado, **no una lectura
de MySQL realizada en esta sesión**. No hay consumidor visual montado identificado que las
use en este checkout. Las seis URL no afectan el Home actual, que usa el catálogo versionado.
No se puede asegurar lo mismo sobre aplicaciones externas o una versión ya desplegada.

**Puede prepararse el despliegue de este frontend sin trasladar `backend/uploads`**: no se
espera pérdida visual en las páginas institucionales actuales por omitirlo. Las peticiones
directas a imágenes antiguas y clientes que aún consuman sus URL sí fallarán. Esto es evidencia
estática, no un ensayo del sitio desplegado. Se conservan las filas, URL, archivos originales
y recursos estáticos; no hace falta limpiar las 27 celdas para copiar la base.

## Herramientas y formato

- `backend/scripts/aiven-copy-lib.cjs`: captura consistente de todas las tablas InnoDB,
  DDL `SHOW CREATE TABLE`, PK, columnas y valores ordenados por PK; cifrado, validación,
  importación y comparación. Incluye columnas generadas en la comparación pero no en INSERT.
- `backend/scripts/aiven-copy.cjs`: CLI JSON por stdin, salida agregada y errores sanitizados.
  No importa `database.cjs`, dotenv ni Prisma y no usa `DB_*` como configuración.
- `backend/scripts/aiven-copy.ps1`: lanzador PowerShell 5.1 con prompts protegidos,
  DPAPI solo para el perfil Aiven, ACL para carpetas nuevas y segunda copia cifrada.
- `backend/test/aiven-copy.test.cjs` y `aiven-copy.integration.cjs`: pruebas puras y ensayo
  Docker exclusivamente ficticio. El ensayo provisiona sus propias cuentas, no cuentas reales.
- `backend/test/aiven-copy-powershell.test.ps1`: sintaxis, ACL y transporte de datos ficticios.
- `check-database.cjs` carga su conexión solo al ejecutarse como CLI; el importador reutiliza
  `check(db)` con su conexión verificada sin activar dotenv/Prisma. `apply` y `compare`
  exigen también que este comprobador no encuentre problemas. `AGENTS.md` enlaza esta guía.

Se revisaron `backup.cjs`, `restore.cjs` y `backup-lib.cjs`. Sus contratos se mantienen.
El respaldo existente es gzip sin cifrado, omite filas de cuotas salvo `--include-rate-limits`
y restaura exclusivamente en `horus_restore_*`. **No se relaja esa protección**.
El flujo nuevo usa un paquete `.horus` independiente: JSON completo comprimido y cifrado con
AES-256-GCM, clave aleatoria de 256 bits, IV aleatorio de 96 bits, etiqueta de 128 bits y cabecera
autenticada. SHA-256 del paquete se custodia por separado. No acepta antiguos `.sql.gz` ni 7z.
No escribe SQL, filas, manifiestos ni claves sin cifrar en disco; no requiere 7-Zip.

El paquete contiene todas las tablas, `horus_migrations`, **todos los registros de
`rate_limit_buckets`** y las tablas históricas. Se exige `-IncludeRateLimits` como reconocimiento
explícito en backup, equivalente funcional a `--include-rate-limits` del script anterior.
Nunca contiene uploads, usuarios MySQL, grants ni secretos de conexión. Los administradores
de la aplicación sí se copian con sus hashes originales.

Límite deliberado de este formato pequeño: 64 MiB de JSON descomprimido, con límite previo
de 32 MiB de valores capturados. Superarlo detiene la operación; no omite registros. Se requieren
PK en todas las tablas. Vistas, triggers, rutinas y eventos visibles hacen fallar el preflight.
El operador debe acreditar también que no hay objetos ocultos por permisos: los ocho privilegios
no permiten demostrar por sí solos la ausencia de rutinas/eventos de otros propietarios.

## Identidad, seguridad y aceptación

El perfil Aiven fija host, servicio, puerto 28816, `horus_db`, `horus_migrator` y versión 8.4.11.
Cada conexión exige CA, verificación de hostname y TLS 1.2/1.3; rechaza
`NODE_TLS_REJECT_UNAUTHORIZED=0`. UUID provisto por vía independiente, versión, base, cuenta,
ausencia de roles y exactamente los ocho privilegios se cotejan antes de operar.
El perfil de origen real solo acepta 127.0.0.1:3306/horus_db, MySQL 8.0.46.
El perfil de fixture solo acepta loopback, puerto distinto de 3306 y tres nombres exclusivos.

El preflight exige base existente vacía, colación predeterminada idéntica y ausencia de objetos
adicionales visibles. `apply` repite vacío en su propia conexión bajo un bloqueo de operador.
No hay CREATE DATABASE, DROP, TRUNCATE, REPLACE, INSERT IGNORE ni actualización de filas.
DDL validado y un INSERT parametrizado por fila; `multipleStatements=false`, LOCAL INFILE
desactivado. Se conservan UNIQUE y CHECK activos. FK solo se desactiva en esa sesión y se
restablece en `finally`; se comprueban huérfanos explícitamente al final.
MySQL [no revisa filas anteriores al reactivar FK](https://dev.mysql.com/doc/refman/8.4/en/create-table-foreign-keys.html).

Todo warning de INSERT detiene la copia. En DDL solo se admite el aviso 1681 con el texto exacto
de deprecación del ancho de presentación de enteros, generado por `tinyint(1)` en SHOW CREATE;
los demás avisos se rechazan. No hay reintentos. Un error puede dejar tablas o filas parciales:
DDL hace commits implícitos y **no existe rollback global**.

La comparación no consulta un origen que puede haber cambiado: compara con la instantánea
cifrada aprobada, incluyendo valores de columnas generadas, bcrypt, fechas, roles, estados,
IDs e historial. DDL compara PK/FK, índices, CHECK/ENFORCED, colaciones, defaults,
AUTO_INCREMENT y expresiones generadas. Solo normaliza el `CHARACTER SET` redundante que
MySQL vuelve explícito delante de la misma `COLLATE` al recrear una columna; no toca literales.
Además coteja charset/collation, tipos completos, defaults, nulabilidad y generación por columna.
Cualquier otra diferencia de representación entre 8.0 y 8.4 falla cerrada. La consola no imprime valores ni hashes
por fila. Se exige además `db:check` y lectura con Prisma antes de activar aplicaciones.

[Aiven Free publica 1 GB de disco](https://aiven.io/docs/products/mysql/concepts/mysql-free-tier).
El operador debe obtener el uso real reciente del panel. El script exige cuota <= 1.000.000.000
bytes y `uso + max(10 × JSON, 100 MiB) <= 80% de cuota`. Es margen preventivo, no medición del
disco ni garantía frente a binlogs/otros servicios. No se consulta Aiven para obtenerlo en esta tarea.

## Preparación del operador, antes de autorizar datos reales

1. Node 22.x aprobado; no instalar automáticamente. Sesión privada sin transcripción ni depuración.
2. Elegir dos dispositivos independientes con NTFS y control de acceso. Las carpetas de ejecución
   deben ser nuevas; el lanzador crea ACL para el usuario actual y SYSTEM, sin herencia.
   Una letra diferente **no acredita** un disco físico independiente: comprobarlo manualmente.
3. Generar en un gestor aprobado una clave aleatoria de 32 bytes representada por 64 caracteres
   hexadecimales. Registrar dos responsables y recuperación en otro equipo. No reutilizar MySQL.
   No guardar la clave junto a los paquetes ni confiar en DPAPI como recuperación portátil.
4. Proteger sistema, paginación e hibernación mediante el cifrado del equipo. El proceso contiene
   datos y claves en memoria; no se promete borrado de memoria de JavaScript ni protección ante
   un administrador del equipo. El lanzador no produce archivos temporales planos.
5. Confirmar UUID, ausencia de objetos no soportados, ventana sin escritores/DDL y origen exacto.
   `-NoWriters` registra una afirmación del operador; no mata conexiones ni bloquea aplicaciones.
6. Autorizar por separado backup local, uso de copia real en ensayo, preflight remoto e importación.
   No habilitar Azure ni otros escritores hasta aceptar todas las comprobaciones.

## Comandos para operaciones posteriores, NO ejecutados sobre bases reales

Desde la raíz del repositorio, preparar fuera de Git dos perfiles públicos (sin contraseña ni clave).
Ejemplo `C:\Horus-Secure\Aiven\local-copy-profile.json`:

```json
{
  "profile": "local-source", "host": "127.0.0.1", "port": 3306,
  "database": "horus_db", "user": "horus_migrator", "version": "8.0.46",
  "uuid": "UUID_LOCAL_VERIFICADO", "caFile": "RUTA_CA_LOCAL_VERIFICADA"
}
```

La CA local y su hostname deben verificarse: este flujo no degrada a RSA o TLS sin identidad.
Si el certificado local no permite verificar 127.0.0.1, detenerse; adecuar su configuración
requiere un trabajo/autorización independiente. No se leyó la configuración privada para deducirlo.

Ejemplo `C:\Horus-Secure\Aiven\remote-copy-profile.json`:

```json
{
  "profile": "aiven", "service": "mysql-1b22a7e2",
  "host": "mysql-1b22a7e2-horus-group-dev.d.aivencloud.com", "port": 28816,
  "database": "horus_db", "user": "horus_migrator", "version": "8.4.11",
  "uuid": "UUID_REMOTO_VERIFICADO_INDEPENDIENTEMENTE",
  "caFile": "C:\\Horus-Secure\\Aiven\\ca.pem",
  "quotaBytes": 1000000000, "usedBytes": "SUSTITUIR_POR_NUMERO_ACTUAL"
}
```

Los marcadores son deliberadamente inválidos. Completar UUID, CA y uso real tras la autorización.
No crear un token de aprobación ni descifrar DPAPI durante la preparación.

```powershell
# Solo tras autorizar respaldo real y ambas ubicaciones. E: es un dispositivo externo comprobado.
$run = Get-Date -Format 'yyyyMMdd-HHmmss'
$file = "C:\Horus-Secure\Aiven\Migration\$run\horus-db.horus"
$second = "E:\Horus-Backups\$run\horus-db.horus"
& .\backend\scripts\aiven-copy.ps1 -Action backup `
  -Profile 'C:\Horus-Secure\Aiven\local-copy-profile.json' `
  -File $file -SecondFile $second -NoWriters -IncludeRateLimits
# Custodiar SHA-256 devuelto en registro independiente. No contiene hashes de filas.
$sha = Read-Host 'SHA-256 aprobado del paquete'
& .\backend\scripts\aiven-copy.ps1 -Action verify `
  -Profile 'C:\Horus-Secure\Aiven\local-copy-profile.json' -File $file -Sha256 $sha
# Repetir verify sobre la segunda copia, en OTRO equipo autorizado con la clave del gestor.

# Autorización independiente de conexión Aiven: solo lectura.
& .\backend\scripts\aiven-copy.ps1 -Action preflight `
  -Profile 'C:\Horus-Secure\Aiven\remote-copy-profile.json' -File $file -Sha256 $sha -NoWriters
# Solo tras aprobar el ensayo con copia real, preflight y ventana final:
& .\backend\scripts\aiven-copy.ps1 -Action apply `
  -Profile 'C:\Horus-Secure\Aiven\remote-copy-profile.json' -File $file -Sha256 $sha -NoWriters -ApproveImport
& .\backend\scripts\aiven-copy.ps1 -Action compare `
  -Profile 'C:\Horus-Secure\Aiven\remote-copy-profile.json' -File $file -Sha256 $sha -NoWriters
```

No ejecutar `db:init` ni `db:migrate` sobre el destino: el paquete ya contiene el esquema
y todo el historial. El `verify` es offline; no lee CA ni DPAPI y no abre conexión.
Un perfil malformado, error o diferencia produce salida no cero sin contenido privado.

## Recuperación ante fallos

- Antes de escribir: corregir paquete/identidad/espacio y repetir únicamente con autorización vigente.
- Después de CREATE/INSERT: mantener destino parcial sin escritores; conservar evidencia agregada.
  No repetir sobre él ni ejecutar limpieza. Un destino vacío nuevo o borrar/recrear uno existente
  requiere autorización independiente. No conceder DROP al migrador para superar este bloqueo.
- Si falla comparación o `db:check`: conservar el origen intacto; no cambiar la conexión de Azure.
- Si ya hubo escrituras remotas: reconciliarlas antes de cualquier retorno; el respaldo local no
  las contiene. RPO/RTO y transición se acuerdan antes de habilitar el backend compartido.
- Clave perdida: usar recuperación del gestor ensayada. Si ninguna copia es recuperable, no importar.
  Retención y retirada de archivos reales quedan pendientes de aprobación.

## Verificación y límites

Resultados ejecutados:

| Comprobación | Resultado |
| --- | --- |
| Pruebas unitarias del paquete y aislamiento de configuración | 7/7 en Node 24 de Windows y 7/7 en Node 22 de Docker |
| Integración MySQL 8.4.11, digest `0744ee5ef89ce6ccfa13de3e579fe6b9e27f93dd70da9c06d2c908b1b193fb8d` | 30 tablas y 18 migraciones; cifrado y segunda copia, recuperación, importación vacía, comparación, bcrypt y registros históricos, `db:check`, lecturas Prisma correctos |
| Rechazos reales en fixture | UUID y CA incorrectos, destino ocupado, falta de DROP, cambios de valores con igual recuento, FK huérfana; comprobación de hostname contra certificado real |
| Fallo inyectado antes del primer INSERT | Un solo intento, 30 tablas parciales conservadas, FK rehabilitadas; nuevo intento rechazado por destino ocupado |
| Regresión de respaldo existente | 16/16 sin MySQL real |
| Frontend institucional y selección de proveedor | 6/6; sin editar React ni recursos |
| PowerShell 5.1 | Parser, ACL de carpeta ficticia nueva, SecureString y stdin UTF-8 correctos |

El host usa Node 24.19.0: la integración completa y Prisma se probaron con ese runtime.
Las pruebas puras del nuevo formato también se ejecutaron con Node 22 en Docker sin red.
El lanzador completo bajo Node 22 en Windows y la transferencia 8.0.46 → 8.4.11 se ensayaron
después: ver [Validación final](#validación-final-previa-al-respaldo-real). Los primeros ensayos
detectaron errores en los fixtures (fechas obligatorias y longitud del código de certificado),
el aviso de ancho de enteros y la representación redundante de charset; se corrigieron antes
de la pasada correcta, sin relajar comparaciones de datos o colaciones.

No se probó un servicio gestionado Aiven, la ruta TLS del MySQL local real, cuentas reales,
recuperación en un segundo equipo físico, ni el sitio ya desplegado. El contenido de datos reales
y sus cifras (150 filas, 14 cuentas, 22 FK, 37 CHECK) no se recontó.
La integración automatizada usa 8.4.11 en ambos extremos; la transferencia 8.0.46 → 8.4.11 se
ensayó aparte con datos ficticios y no sustituye la aceptación posterior de una copia real.

```powershell
Set-Location backend
node --test -r ./test/isolate-env.cjs test/aiven-copy.test.cjs
node --test -r ./test/isolate-env.cjs test/aiven-copy.integration.cjs
node --test -r ./test/isolate-env.cjs -r ts-node/register test/backup-lib.test.ts
& .\test\aiven-copy-powershell.test.ps1
```

La integración usa imagen MySQL 8.4.11 por digest, tmpfs y puerto aleatorio ligado a loopback;
comprueba UUID y TLS antes de la copia, y elimina solo su contenedor y carpeta ficticia al terminar.
No se montan datos del usuario ni se reutilizan contenedores existentes. Los ficheros `.horus`
de ensayo se eliminan con su carpeta propia; no se tocan respaldos reales.

## Validación final previa al respaldo real

24/10/2026. Solo datos ficticios, contenedores propios (`mysql:8.0.46` y `mysql:8.4.11` locales,
tmpfs, loopback, puerto aleatorio) y carpetas temporales. Sin Aiven, sin MySQL local (3306), sin
respaldos reales, sin React ni imágenes. Lanzador real sin modificar, en Windows PowerShell
5.1.26100 con Node 22.23.4 portable (zip oficial, SHA-256 verificado, sin instalar); solo se
sustituyó `Read-Host` por un arnés que entrega la clave y la contraseña ficticias.

### Defectos encontrados y corregidos

| Defecto | Efecto en una ejecución real | Corrección |
| --- | --- | --- |
| `Get-Content -Raw` añade propiedades ETS (`PSPath`, `PSProvider`…) a la CA y `ConvertTo-Json` la serializaba como objeto | **Todo** `backup`/`preflight`/`apply`/`compare` fallaba con `CONFIG_SIZE` (la CLI lo ocultaba tras el mensaje genérico) | CA leída con `[IO.File]::ReadAllText` |
| Con varios `node.exe` en `PATH`, `Get-Command ... .Source` devolvía un arreglo | El lanzador no arrancaba | `Select-Object -First 1` (el primero del `PATH`, como la consola) |
| `.ps1` sin BOM: PowerShell 5.1 los leía como ANSI | Mensajes y prompts con caracteres corruptos | `aiven-copy.ps1` y su prueba guardados en UTF-8 con BOM |
| Prueba PS: .NET Framework antepone BOM a stdin si la consola está en la página 65001 | Falso negativo de la prueba (la CLI ya lo eliminaba) | La prueba elimina el BOM como la CLI. Se añaden regresiones de CA y `node.exe` |
| El perfil `fixture` solo aceptaba 8.4.11 | Impedía ensayar el origen 8.0.46 | Acepta `8.0.46` u `8.4.11`; los perfiles `local-source` y `aiven` no cambian |

### Ensayo integral (37/37, dos ejecuciones completas)

| Requisito | Resultado |
| --- | --- |
| Rutas con espacios y especiales | Lanzador, perfiles, CA y paquetes en rutas con `Ñ ú & ( ) [ ] # ' $ % ; , @ ^ !` y 漢字; segunda copia en otra raíz (`subst Q:`) |
| Rechazos previos | Node 24 rechazado; segunda copia en la misma raíz rechazada sin crear carpetas; backup sin `-IncludeRateLimits` sin paquete |
| Backup 8.0.46 | 30 tablas, 31 filas; SHA-256 idéntico en ambas copias; sin texto plano reconocible en el paquete; ACL protegida con 2 reglas; ningún archivo además del `.horus` |
| Verify | Correcto en ambas copias; clave errónea, SHA erróneo y paquete alterado (con SHA antiguo o recalculado, falla GCM) rechazados |
| 8.0.46 → 8.4.11 | Con el origen ya destruido: preflight, rechazo sin `-ApproveImport` (sin escrituras), apply, compare completo y `db:check` correctos; bcrypt idéntico; segundo apply rechazado |
| Segundo entorno aislado | Servidor 8.4.11 nuevo, solo con la segunda copia, la clave y el SHA: preflight, apply y compare correctos. No es un segundo equipo físico |
| Restauración parcial | Corte inducido por `max_allowed_packet` del fixture: se detiene con mensaje sanitizado (30 tablas y 5 filas conservadas); reintento, preflight y compare rechazados; recuentos y `CHECKSUM TABLE` idénticos antes y después |
| Uploads antiguos | `dist` compilado con Node 22, sin `UPLOAD_DIR` ni carpeta `uploads`, sobre la copia restaurada con URL `localhost`, `/uploads/` y `/api/uploads/`: arranca; `/api/health` 200; imagen ausente 404; `/api/servicios` 200 conserva las URL; `/api/cursos` 200; sigue sano |
| Registros | 24 ejecuciones (incluidos errores y el log del backend) sin clave, contraseña, bcrypt, correo, nombres, DNI ni código de certificado; sin archivos planos en las carpetas de ejecución |

En la primera ejecución completa tras las correcciones, el arranque del backend no se detectó y
no dejó salida. Las dos ejecuciones siguientes pasaron sin cambios funcionales: se trata como
**intermitencia no explicada** del ensayo, no como éxito oculto.

Otras pruebas: `aiven-copy.test.cjs` y `migration-images.test.cjs` 12/12 con Node 22 y con Node 24;
`backup-lib`, `uploads-backup` y `managed-images` 27/27; `aiven-copy.integration.cjs` 1/1
(8.4.11); `aiven-copy-powershell.test.ps1` correcto con Node 22 y Node 24 y en las páginas de códigos 65001 y 437.

Pendiente de la aceptación con datos reales: la ruta TLS del MySQL local 8.0.46 real (CA y
hostname 127.0.0.1), los recuentos reales, un segundo equipo físico, un disco externo real y Aiven.
El arnés y el ensayo son temporales y no se versionan.

### Requisitos para el respaldo real autorizado

- `node.exe` de la versión 22.x debe ser el **primero** del `PATH` de esa sesión. Por ejemplo:
  `$env:PATH = 'C:\Program Files\nodejs22;' + $env:PATH`; comprobar con `node --version`.
- Si la directiva de ejecución lo impide, ejecutar con
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\backend\scripts\aiven-copy.ps1 ...`.
- Los comandos de [Comandos para operaciones posteriores](#comandos-para-operaciones-posteriores-no-ejecutados-sobre-bases-reales)
  siguen siendo válidos sin cambios. El primero autorizado es solo `backup` y después `verify`.
