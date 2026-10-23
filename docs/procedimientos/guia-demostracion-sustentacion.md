# Guía de demostración funcional para la sustentación

> **Actualización (23 de octubre de 2026):** Sesiones se retiró (sin rutas ni permisos `sesiones:*`); en su lugar se demuestran los **horarios recurrentes** de una edición
> (`GET`/`PUT /api/admin/convocatorias/:id/horarios`, ver [Horarios de las ediciones](horarios-ediciones.md)). Los pasos que mencionan sesiones son históricos;
> por ejemplo, la comprobación «`GET /api/admin/sesiones` da 403 a Secretaría» pasa a ser «`PUT …/horarios` da 403 a Secretaría y su `GET` 200».

> **Actualización (simplificación académica, octubre de 2026):** los certificados digitales (emisión, PDF con QR, reportes y administración) y la administración de
> docentes se retiraron del sistema; los certificados se entregan de forma presencial. Los pasos de esta guía que los mencionan describen el diseño anterior y no
> deben demostrarse. Siguen vigentes estudiantes, ediciones, matrículas (con el bloqueo ante un certificado vigente histórico), sesiones, preinscripciones y reportes.

Fecha: 22 de octubre de 2026. Rama `anderson`, HEAD `c0dc9c6`. Alcance: orden de los cuatro procesos, roles, qué mostrar, cómo verificar cada paso y qué hacer si algo externo falla.

**Actualización del 22 de octubre de 2026:** la sección 5 recoge un ensayo ejecutado en clon contra el HEAD `c0dc9c6` (Atención, Cotizaciones, Academia parcial y Assistant sin IA real); prevalece sobre lo que dice este párrafo y sobre la columna «Estado» de la sección 2 donde difieran. Un segundo ensayo del mismo día (sección 5.6) cubrió de punta a punta la certificación (cumplimiento, emisión, PDF con QR, verificación pública, anulación, sustitución, historial, restricciones y concurrencia contra MySQL real del clon).

**Estado honesto de esta guía (redacción original).** Los escenarios de abajo son un **plan**: ninguno se ha ejecutado de punta a punta contra el HEAD actual. Lo único ejecutado es la evidencia del ensayo de migraciones (clon, commit `ea402c4`; ver [activación de Sesiones y Preinscripciones](activacion-sesiones-preinscripciones-ensayo.md)). `horus_db` sigue **sin** las migraciones `20261020-sesiones-academicas` y `20261020-preinscripciones` (16 de 18 registradas), así que **el backend actual no debe arrancarse contra `horus_db`**: la demostración se hace en un clon migrado (sección 1) o, tras una autorización expresa y separada, en `horus_db` ya migrada.

## 0. Leyenda de validación

| Marca | Significado |
| --- | --- |
| **Probado** | Ejecutado con salida archivada (solo el esquema y las 98 pruebas HTTP del ensayo en clon, commit `ea402c4`). |
| **Cubierto por pruebas unitarias** | `npm test` en `backend/` (mocks, sin MySQL). No demuestra el flujo con datos reales. |
| **Por validar** | No ejecutado de punta a punta con el código actual. Es lo que esta guía busca cerrar antes de la sustentación. |

## 1. Entorno de demostración

- **Opción A (recomendada hoy): clon desechable** de MySQL 8.0.46 en `127.0.0.1` con puerto propio, restaurado desde el respaldo y migrado allí (procedimiento 8.8 del documento de activación; scripts en el directorio privado `cierre-evidencias-20261020\scripts`). Backend compilado desde HEAD, apuntando solo al clon. No toca `horus_db`.
- **Opción B (tras autorización P11):** `horus_db` migrada con el procedimiento definitivo (sección 5 de la respuesta de integración y sección 9 del documento de activación).
- Cuentas **ficticias** creadas en el clon: `GERENTE_GENERAL`, `COORDINADORA_INSTITUCIONAL`, `SECRETARIA` y una sin rol. Datos con nombres y DNI inventados; correos `@example.invalid`.
- Correo: `MAIL_PROVIDER` simulado o sin credenciales; nunca destinatarios reales. OpenAI: clave vacía para el modo determinista; clave real solo si se autoriza un único ensayo del Assistant.

## 2. Orden recomendado en la sustentación

1. **Atención** (no depende del esquema académico; es el flujo más sólido).
2. **Cotizaciones**.
3. **Academia** (el más largo; necesita las migraciones).
4. **HORUS Assistant** (cierra con datos ya creados en los pasos anteriores).

### 2.1 Atención: consulta → seguimiento → respuesta → cierre

| | |
| --- | --- |
| Datos | 1 consulta ficticia enviada por el formulario público. |
| Roles | Visitante (público); `SECRETARIA`, `COORDINADORA_INSTITUCIONAL` o `GERENTE_GENERAL` (panel). Una cuenta sin rol recibe 403. |
| Endpoints | `POST /api/contacto` → `GET /api/admin/messages` (solo lista) → `GET /api/admin/seguimiento/messages/:id` → `PUT /api/admin/seguimiento/messages/:id` (estado, responsable, notas, respuesta; con `revision`) → `POST /api/admin/seguimiento/messages/:id/correo` (envío) y `POST …/constancia`. Las reclamaciones usan `/api/admin/seguimiento/reclamaciones/:id`. |
| Mostrar | La consulta llega a la bandeja; se asigna seguimiento; se responde; se cierra; el historial conserva quién y cuándo. |
| Verificar | La bandeja cambia de estado; reintentar con una `revision` vieja devuelve 409 (conflicto visible, sin pisar datos); el historial lista cada cambio. |
| Errores relevantes | 429 en el formulario por límite de frecuencia; 409 por revisión; correo de respuesta con resultado incierto (no se reintenta solo). |
| Estado | **Probado** en clon el 22/10/2026 (26 de 26, sección 5.3), por HTTP y sin interfaz. |

### 2.2 Cotizaciones: solicitud → presupuesto → estados → resultado

| | |
| --- | --- |
| Datos | 1 cotización ficticia con 2 líneas. |
| Roles | `COORDINADORA_INSTITUCIONAL` o `GERENTE_GENERAL` (alta, edición, envío y anulación). El rol `COMERCIAL` **no existe** y `SECRETARIA` **no tiene permisos de cotizaciones** (403). La cotización se da de alta desde el panel (`POST /api/admin/cotizaciones`); la solicitud pública entra por el formulario de contacto (2.1). |
| Endpoints | `POST /api/admin/cotizaciones`, `PUT /api/admin/cotizaciones/:id`, `POST /api/admin/cotizaciones/:id/estado` (`enviada`, `aceptada`/`rechazada`, `anulada`), `POST /api/admin/cotizaciones/:id/correo`, `GET /api/admin/cotizaciones`. |
| Mostrar | Creación, edición, cambio a «enviada», resultado final y bloqueo de estados inválidos. |
| Verificar | El listado refleja el estado; una transición no permitida devuelve error claro; el cambio a `enviada` o `anulada` exige el permiso específico (403 sin él). |
| Errores relevantes | 403 por permiso; 409 por revisión; fallo del proveedor de correo (el estado no debe quedar como «enviada» si el envío falla). |
| Estado | **Probado** en clon el 22/10/2026 (34 de 34, sección 5.3), por HTTP y sin interfaz. |

### 2.3 Academia: preinscripción → matrícula → cumplimiento → certificado

| | |
| --- | --- |
| Datos | 1 edición con `minimo_apertura` (p. ej. 1 para la demo), 1 preinscripción ficticia (DNI inventado de 8 dígitos). |
| Roles | Visitante (preinscripción); `COORDINADORA_INSTITUCIONAL` (habilita recepción y abre); `SECRETARIA` (valida, convierte y puede registrar estudiante y matrícula); **confirmar cumplimiento**: `COORDINADORA_INSTITUCIONAL` o `GERENTE_GENERAL` (Secretaría recibe 403); **emitir certificado**: `COORDINADORA_INSTITUCIONAL` o `GERENTE_GENERAL`; **anular y sustituir**: solo `GERENTE_GENERAL` (la coordinadora recibe 403). Secretaría no tiene ningún permiso de certificados. |
| Endpoints | `PUT /api/admin/convocatorias/:id/preinscripcion` → `GET /api/preinscripciones/convocatorias` → `POST /api/preinscripciones` → `PUT /api/admin/preinscripciones/:id/validacion` → `PUT /api/admin/convocatorias/:id/apertura` → `POST /api/admin/preinscripciones/:id/conversion` → `PUT /api/admin/matriculas/:id/cumplimiento` → `POST /api/admin/certificados` → `GET /api/admin/certificados/:id/pdf` → `GET /api/certificados/verificar/:codigo`. Anulación y sustitución: `PUT /api/admin/certificados/:id/anulacion` y `POST /api/admin/certificados/:id/sustitucion`; historial: `GET /api/admin/certificados/:id/historial`. |
| Mostrar | El visitante se preinscribe; Secretaría valida; Coordinación abre; se convierte en matrícula; Coordinación o Gerencia confirma «cumplido»; se emite el certificado con PDF y QR; la verificación pública muestra solo nombre, curso y fechas; Gerencia anula y sustituye, y la verificación pública refleja la invalidez. |
| Verificar | Cada paso aparece en el historial; la verificación pública devuelve el certificado y **no** el DNI; `GET /api/admin/sesiones` da 403 a Secretaría. |
| Errores relevantes | 429 por cuota de preinscripción y por la verificación pública (30 por minuto por IP); conversión rechazada si la edición no está abierta o el DNI pertenece a otro estudiante; certificado rechazado sin cumplimiento «cumplido» (409), segundo vigente para la misma matrícula (409), emisión con revisión de matrícula vieja (409), anulación por la coordinadora (403). |
| Estado | Preinscripción, conversión, sesiones y permisos: **Probado** en clon (ensayo, `ea402c4`, y 22/10). Cumplimiento, certificado, PDF, QR, verificación pública, anulación, sustitución e historial: **Probado** en clon por HTTP el 22/10/2026 (sección 5.6), con las limitaciones allí indicadas (sin interfaz, sin escaneo físico, sin revisión visual del PDF, y sin encadenar la preinscripción pública con el certificado en un solo recorrido). |

### 2.4 HORUS Assistant: autenticado → consulta autorizada → datos reales → explicación con IA

| | |
| --- | --- |
| Datos | Los creados en 2.1 a 2.3 (el Assistant solo cuenta lo que existe). |
| Roles | Cualquier cuenta con sesión; ve únicamente las áreas que su rol puede leer (`SECRETARIA` no ve sesiones). |
| Endpoints | `GET /api/admin/asistente/resumen?explicar=false\|true`, `POST /api/admin/asistente/consultar`. |
| Mostrar | Primero `explicar=false` (cifras deterministas con su fuente); luego `explicar=true` (la IA redacta, pero las cifras las pone el servidor). Una pregunta fuera del rol devuelve «no autorizado», no datos. |
| Verificar | Las cifras coinciden con las listas del panel; sin sesión da 401; los marcadores de cifras no aparecen en el texto final. |
| Errores relevantes | 429 por tope por cuenta; fallo de OpenAI. |
| Estado | Cubierto por pruebas unitarias (`asistente*.test.ts`). Contra datos reales y con OpenAI real: **por validar**. |

## 3. Si una integración externa falla

| Falla | Qué hacer en vivo |
| --- | --- |
| OpenAI (Assistant o chatbot) | Pasar a `explicar=false`: el resumen determinista no usa IA. Decirlo al jurado: la IA solo redacta, no calcula. |
| Correo (Gmail/Resend) | Mostrar el estado de intento en el historial; no reintentar. «Aceptado por el proveedor» no es «entregado». |
| MySQL | No improvisar sobre `horus_db`. Pasar al clon o a capturas del ensayo archivado. |
| Límite de frecuencia (429) | Esperar el minuto (ventana fija) o cambiar de cuenta/IP de la demo. |
| Frontend no carga | Mostrar el flujo con las rutas de la API ya documentadas y las capturas previas. |

## 4. Lista de comprobación previa al ensayo general

1. RAM libre suficiente para el clon (ver respuesta de integración) y ningún navegador `horus-*` huérfano.
2. Backend compilado desde HEAD con Node 22.x (el `dist` actual es anterior al HEAD y se generó con Node 24).
3. `npm test` y `tsc --noEmit` en `backend/` con la precarga `-r ./test/isolate-env.cjs`.
4. Clon restaurado y migrado, `db:check` en 0, cuentas ficticias creadas.
5. Un ensayo completo de los cuatro procesos, con resultados anotados aquí en la columna «Estado».

## 5. Resultados del ensayo funcional en clon (22 de octubre de 2026)

Ejecutado hoy contra el HEAD `c0dc9c6`, compilado con **Node 22.23.4** (descargado del sitio oficial, SHA-256 verificado, usado solo desde una carpeta temporal; no se instaló en el sistema). Las secciones 0 y 2 conservan el plan original; **esta sección es la evidencia ejecutada y prevalece** donde difieran. Salidas completas archivadas en `%USERPROFILE%\.horus-respaldos\funcional-20261022\salidas\` (01 a 15, con cabecera y SHA-256 por archivo).

### 5.1 Entorno

| Elemento | Resultado |
| --- | --- |
| Servicio real | `MySQL80` en ejecución durante todo el ensayo; UUID con prefijo `dc5bb32a` (coincide con el registrado), puerto 3306, 16 de 18 migraciones, solo `sesiones-academicas` y `preinscripciones` pendientes, `Threads_connected = 1`. `horus_db` **no se tocó**. |
| Clon | MySQL 8.0.46 aislado: `127.0.0.1`, puerto 54304, UUID prefijo `9b051698`, datadir temporal propio (distinto de `C:\ProgramData\MySQL\...`). Guardia de identidad activa en todo script que se conectó. |
| Respaldo usado | `ventana-activacion-20261021` (SHA-256 coincide; `--verify-only` correcto). Restaurado en `horus_restore_func`: 27 tablas, 17 FK sin huérfanos. |
| Memoria libre | 2 764 MB antes del clon; mínimo observado con clon y API en marcha ≈ 2 260 MB (umbral 1 500 MB). |

### 5.2 Migraciones en el clon

| Paso | Resultado |
| --- | --- |
| `db:check` previo | Código 1 con 94 líneas de diferencias (las esperadas de las dos migraciones). |
| `db:migrate` | Código 0, «Migraciones aplicadas», 0,60 s. |
| `db:check` posterior | Código 0, «Esquema compatible». |
| Integridad | 18 migraciones exactamente las de la lista; 3 tablas nuevas InnoDB `utf8mb4_unicode_ci` con 0 filas; 28 columnas FK; 43 CHECK, ninguno sin aplicar; `vigente_email` `STORED GENERATED`; 23 FK revisadas, 0 filas huérfanas; 14 cuentas originales conservadas, 1 `GERENTE_GENERAL` activa. |

### 5.3 Recorridos con datos ficticios (correo e IA deshabilitados explícitamente)

| Recorrido | Resultado | Qué cubrió |
| --- | --- | --- |
| **Atención** | 26 de 26 | Consulta pública (201, sin correo real), validación 400, reclamación pública, permisos por rol, seguimiento con `revision`, **409 ante revisión antigua sin pisar datos**, estado inválido 400, 404, recurso desconocido denegado, «atendido» sin respuesta rechazado en reclamaciones, envío sin proveedor → 503 controlado `envio: fallido` con el texto guardado. |
| **Cotizaciones** | 34 de 34 | Alta vinculada a una consulta, importes calculados en servidor (250,50 + IGV 45,09 = 295,59), idempotencia (misma clave = una fila), 7 validaciones 400, edición con 409 por revisión antigua, flujo borrador→enviada→aceptada, transición inválida rechazada, envío sin proveedor sin dejar la cotización como «enviada», anulación con revisión vigente, filtros por consulta/estado/vencida. |
| **Academia** | 97 de 98 | Batería existente (`func-test.cjs`): permisos de sesiones/preinscripciones, ediciones, preinscripción pública (validaciones, honeypot, duplicados), mínimo de 10 validadas, conversión a matrícula, sesiones (solape, reprogramación, cancelación, ENUM nuevos en historial), cuotas de frecuencia. La única falla fue el chequeo «sin ERROR en el registro», provocado por el aviso esperado de correo no configurado (ver 5.4); no fue un defecto de la API. |
| **HORUS Assistant** | 21 de 21 | Resumen por rol (Gerencia 9 áreas; Secretaría sin sesiones/cotizaciones/certificados; sin rol 403; sin sesión 401), reflejo de pendientes reales, `explicar=true` con IA apagada responde el resumen determinista, parámetro inválido 400, `consultar` sin IA → 503 `ia_no_disponible` neutro, preguntas con correo o DNI rechazadas **antes** de la IA, el resumen no escribe. |
| **Red y registro** | 5 de 5 | La API escuchó solo en `127.0.0.1`; sus conexiones salientes fueron solo hacia el clon; ninguna al puerto 3306; 0 errores de esquema (P2021/P2022) en el registro. Las 8 líneas ERROR del registro son todas «notificación no entregada: faltan MAIL_USER o MAIL_PASS», es decir, el aviso interno de correo falló sin enviar nada. |

Backend con Node 22.23.4: `tsc --noEmit` código 0, `nest build` código 0, `npm test` 750 de 750.

### 5.4 Lo que NO se ejecutó (sigue «por validar»)

- **Academia:** cumplimiento de matrícula, emisión de certificado, PDF/QR y verificación pública de punta a punta. La batería `func-test.cjs` no los cubría; **quedaron cubiertos en el segundo ensayo (sección 5.6)**.
- **HORUS Assistant con OpenAI real:** `explicar=true` con redacción de IA y `consultar` con planificación de herramientas. Solo se probaron las barreras previas y la degradación segura con la IA apagada.
- **Correo real:** nunca se envió ni se intentó contra un proveedor; solo se comprobó el fallo controlado sin credenciales. «Aceptado» vs «entregado» no se pudo mostrar con un proveedor real.
- **Frontend/navegador:** no se probó la interfaz del panel; todo fue por HTTP contra la API.

### 5.5 Correcciones a las secciones 2.x (derivadas de lo observado)

- **2.1 Atención:** el seguimiento no está en `PUT /api/admin/messages/:id`, sino en `GET|PUT /api/admin/seguimiento/messages/:id` (y `/reclamaciones/:id`), con `POST …/correo` y `POST …/constancia` para enviar. `GET /api/admin/messages` solo lista.
- **2.2 Cotizaciones:** no existe el rol `COMERCIAL`. **Secretaría no tiene permisos de cotizaciones** (403, política vigente); operan `COORDINADORA_INSTITUCIONAL` y `GERENTE_GENERAL`. `POST …/estado` responde **201**. Un intento de envío fallido también incrementa la `revision`: tras él hay que recargar antes de anular.
- **Reclamaciones:** Secretaría tampoco las lista (403); sí Coordinación y Gerencia.
- **Cuentas ficticias:** los roles reales son `GERENTE_GENERAL`, `COORDINADORA_INSTITUCIONAL` y `SECRETARIA` (no `COORDINACION`); los correos de prueba usados fueron `@example.invalid`.
- **2.3 Academia (permisos de certificación, comprobados el 22/10):** `matriculas:confirmar` y `certificados:emitir` pertenecen a Gerencia **y Coordinación**; `certificados:anular` (y, por tanto, sustituir) es **solo de Gerencia**. Secretaría recibe 403 al confirmar cumplimiento y en toda ruta de certificados (incluidos PDF e historial), pero sí puede registrar estudiante y matrícula. Se corrigió la columna «Roles» de 2.3, que atribuía la confirmación solo a Gerencia.
- **2.1 y 2.2 (roles):** el seguimiento de Atención lo operan los tres roles del panel; Cotizaciones solo Coordinación y Gerencia. Las referencias a `COMERCIAL` y a `COORDINACION` de la redacción original eran incorrectas y ya se corrigieron en las secciones 1, 2.1, 2.2 y 2.3.

### 5.6 Recorrido de certificación contra MySQL real en un clon nuevo (22 de octubre de 2026, segundo ensayo)

Salidas, scripts y evidencia en `%USERPROFILE%\.horus-respaldos\certificacion-20261022\` (`salidas\01`–`20`, `scripts\`, `evidencia\`). Mismo HEAD `c0dc9c6`, `dist` compilado con Node 22.23.4 en el ensayo anterior, Node 22.23.4 para todos los scripts. Los intentos fallidos por errores de los propios scripts de prueba se conservaron con el sufijo `-FALLIDO-…` o `-intento1-…`; ninguno fue un defecto del sistema.

| Elemento | Resultado |
| --- | --- |
| Servicio real | `MySQL80` Running antes y después, mismos procesos (arrancados el 21/10), UUID prefijo `dc5bb32a`, `horus_db` con 16 de 18 migraciones y 27 tablas antes y después, sin objetos académicos parciales, `Threads_connected = 1`. **No se tocó.** |
| Respaldo | `ventana-activacion-20261021`, SHA-256 `a978a9a1…f822` verificado de nuevo. Restaurado en `horus_restore_cert` (27 tablas, 17 FK sin huérfanos). |
| Clon nuevo | MySQL 8.0.46, `127.0.0.1`, puerto 51554, UUID prefijo `23766faf`, datadir temporal propio. `db:check` previo (16) → `db:migrate` código 0 → `db:check` «Esquema compatible»; 18 de 18 migraciones registradas, 30 tablas. |
| API | NestJS (`dist`) solo en `127.0.0.1:64329`; sus conexiones fueron únicamente hacia el clon (0 hacia destinos no locales, ninguna al 3306); 0 líneas `ERROR` y 0 errores de esquema en el registro; 0 respuestas 5xx. Correo e IA deshabilitados. `CERTIFICADOS_VERIFICACION_URL=https://verificacion.horus-ensayo.example/verificar` (ficticia, válida, solo en el entorno de ese proceso). |
| Memoria libre | 1,72 GB al inicio; 2,2 GB estable antes de crear el clon; mínimo observado con clon y API ≈ 1,6 GB (umbral 1,5 GB); 2,3 GB al final. |

| Recorrido | Resultado | Qué cubrió |
| --- | --- | --- |
| **Certificación por HTTP** | 57 de 57 | Edición abierta, estudiante y matrícula (por Secretaría), **Secretaría 403 al confirmar cumplimiento** (y el cumplimiento no cambia), Coordinación confirma, emisión sin cumplimiento 409, emisión con revisión vieja 409, validaciones 400 (incluido campo extra), **emisión 201 por Coordinación**, **segundo vigente 409**, cambio de cumplimiento con vigente 409, lecturas y 403/401/404, **PDF** administrativo (200, `application/pdf`, `no-store`, sin DNI), **verificación pública** (válido, sin DNI ni datos internos, `no-store`, código en minúsculas normalizado, inexistente = formato inválido = mismo 404), **anulación solo por Gerencia** (Coordinación y Secretaría 403, motivo obligatorio ≤ 300), la verificación pública pasa a `valido=false`, anular dos veces 409, **sustitución** del anulado (201), **solo el nuevo queda vigente**, el antiguo figura como «sustituido», sustituir dos veces 409, **historial**: emisión y anulación del original (Coordinación y Gerencia) y sustitución del nuevo con motivo y actor. |
| **Restricciones en MySQL real** | 19 de 19 | UNIQUE de un solo vigente por matrícula (columna generada) y su liberación al anular; UNIQUE de código; CHECK de formato de código (incluye minúsculas), DNI de 8 dígitos, anulación completa, nombres, fechas; ENUM de documento (solo DNI); FK a matrícula, emisor y `sustituye_a` compuesta; RESTRICT al borrar matrícula o cuenta emisora; un solo sustituto por certificado. |
| **Concurrencia (12 peticiones simultáneas)** | 10 de 10 | 12 emisiones de la misma matrícula: una 201 y 11 409; 12 anulaciones: una 200 y 11 409 (una sola fila de historial); 12 sustituciones: una 201 y 11 409; emisión contra cambio de cumplimiento: invariante «vigente ⇒ cumplido» intacto (en una corrida ganó la emisión, en otra el cambio de cumplimiento); 3 matrículas distintas emiten a la vez: 3 × 201; 14 códigos, 14 distintos; 0 interbloqueos (`lock_deadlocks = 0`), 88 esperas de fila sin fallos. |
| **Atomicidad** | 9 de 9 | Se forzó (por SQL en el clon) un fallo de la emisión dentro de una sustitución: **ROLLBACK real**, el original sigue vigente, sin historial ni certificado nuevo, la verificación pública sigue «válida». Emisión en edición cancelada 409; matrícula anulada 409. |
| **Límite de frecuencia público** | OK | 34 consultas seguidas a `GET /api/certificados/verificar/:codigo`: 30 × 200 y 4 × 429 (`{ ok: false, mensaje }`). |
| **PDF y QR** | OK (con límites) | Texto del PDF extraído: institución, nombre, curso, edición, fechas, estado, código y **la URL completa**; el anulado muestra «CERTIFICADO ANULADO - SIN VALIDEZ», «ANULADO» y estado ANULADO, y no incluye el motivo ni el DNI. Se leyó el **QR vectorial del propio PDF** (versión 5, 37×37 módulos), se rasterizó y se decodificó con `jsQR 1.4.0` (instalado fuera del repositorio): el contenido es **exactamente** `https://verificacion.horus-ensayo.example/verificar/<código>` tanto en el sustituto vigente como en el original anulado. |

Cierre: API detenida, `SHUTDOWN` del clon («Normal shutdown», sin procesos residuales), directorio temporal borrado; ningún proceso `node`, `msedge` ni `mysqld` del ensayo quedó activo.

**Limitaciones de este ensayo (siguen «por validar» o se declaran):**

- **No hubo escaneo físico con teléfono**: el QR se verificó por decodificación del dibujo vectorial del PDF.
- **No hubo revisión visual del PDF renderizado**: Edge headless devolvió una captura en blanco del visor de PDF y no hay otro rasterizador instalado. La maquetación (posición, solapes, legibilidad) sigue sin revisión ocular; solo se comprobó el contenido textual y el QR.
- **El QR apunta a `/verificar/<código>` y el frontend no tiene esa página** (limitación ya documentada en `certificados.md`): hasta que exista, la variable debe apuntar a la API pública (`…/api/certificados/verificar`). La URL del ensayo es ficticia y no resuelve.
- **El recorrido no encadenó la preinscripción pública con el certificado.** La conversión preinscripción → matrícula está probada en el ensayo anterior; aquí el estudiante y la matrícula se crearon por HTTP con Secretaría. La edición se preparó como «heredada» (`minimo_apertura` NULL, por SQL en el clon) porque una edición nueva exige 10 preinscripciones validadas para abrirse; esa regla ya estaba cubierta por la batería de Academia.
- **La API se detuvo por terminación forzada del proceso** (`taskkill /T /F`, solo sobre el PID verificado): en Windows no se logró enviar una señal cooperativa a un proceso sin consola. La API tiene `enableShutdownHooks()`, pero este cierre no lo ejercitó; no quedaron conexiones abiertas en el clon.
- **No se probó** el 503 del PDF con la URL de verificación ausente o inválida (no se reinició la API con otra configuración); está cubierto por pruebas unitarias, no por este ensayo. Tampoco se probó la interfaz del panel, ni correo real, ni proxy real.
- Concurrencia con 12 peticiones HTTP simultáneas en una sola máquina: demuestra que el control de unicidad, bloqueos y transacciones funciona bajo esa carga, no que soporte producción.
