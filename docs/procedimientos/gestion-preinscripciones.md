# Gestión de preinscripciones (backend, sin pantallas)

Estado: **código y migración preparados y probados en un MySQL 8.4 desechable. La migración `20261020-preinscripciones` NO se ha aplicado a `horus_db`, `horus_local` ni a ninguna base habitual** (ver la sección 8, «Activación y migración»). No hay pantallas ni cambios en el frontend, en el diseño del chatbot ni en la web pública.

Una **preinscripción** es una solicitud de interés en una edición (`convocatoria`) hecha por un visitante, desde el formulario web o desde el chatbot. **No es una matrícula**: no ocupa cupo, no pide DNI, pagos ni comprobantes y no crea estudiantes. Un administrador la valida y, más tarde, la convierte en matrícula oficial con las reglas del módulo de Matrículas.

## 1. Arquitectura

```text
Formulario web ──▶ POST /api/preinscripciones ───────┐
                                                      ├─▶ PreinscripcionesPublicService.register(dto, canal)  ──▶ MySQL
Chatbot (widget) ─▶ POST /api/chatbot/preinscripcion ─┘        (el SERVIDOR fija el canal)

Panel (JWT + AccessGuard) ─▶ /api/admin/preinscripciones/*  ─▶ PreinscripcionesService ─▶ MatriculasService / EstudiantesService
Panel                     ─▶ PUT /api/admin/convocatorias/:id/preinscripcion | /apertura ─▶ ConvocatoriasService
```

| Pieza | Archivo | Responsabilidad |
| --- | --- | --- |
| Servicio **público** | `backend/src/preinscripciones/preinscripciones-public.service.ts` | Único camino por el que un visitante crea una preinscripción (formulario y chatbot) y listado público de ediciones que reciben. No lista, no consulta alumnos ni matrículas. |
| Servicio **administrativo** | `preinscripciones.service.ts` | Listado, resumen, detalle, historial, validar, descartar, desistir, corregir y convertir. Solo lo alcanzan controladores con `JwtAuthGuard` + permisos `preinscripciones:*`. |
| Reglas | `preinscripciones.rules.ts` | Mínimo, transiciones, recepción, tope de seguridad (funciones puras). |
| Historial | `preinscripciones.history.ts` | Escritura del historial propio en la misma transacción; rechaza campos y motivos con datos personales. |
| Identidad | `preinscripciones.identity.ts` | Reglas puras de contraste de identidad en la conversión (nombres, contacto, duplicados). Devuelve códigos, nunca valores. |
| Privacidad | `preinscripciones.privacy.ts` | Detección de datos personales en el texto libre y validador `@NoPersonalData()`. |
| Frecuencia | `backend/src/common/public-rate-limit.guard.ts` | Cuotas por IP, hora, subred y globales en MySQL (§6.1). |
| Ediciones | `backend/src/convocatorias/` | Mínimo de apertura, código público, `PUT :id/preinscripcion`. |

Orden de bloqueos (el mismo que Ediciones y Matrículas): **curso → edición → preinscripción** (→ estudiante → matrícula en la conversión). El alta pública solo toma `edición` (nunca espera al curso), de modo que no hay ciclos. Todas las escrituras usan `READ COMMITTED`, `revision` e historial en la misma transacción.

## 2. Modelos (Prisma + SQL `20261020-preinscripciones`)

**`preinscripciones`**: `id`, `convocatoria_id` (FK RESTRICT), `nombres`, `apellidos`, `email` (en minúsculas), `telefono`, `canal` (`formulario`|`chatbot`, fijado por el servidor), `estado`, `vigente_email` (columna generada STORED), `consentimiento_at`, `aviso_version`, `estudiante_id`, `matricula_id`, `convertida_por`, `convertida_at`, `revision`, `createdAt`, `updatedAt`.

- **Estados**: `recibida`, `validada`, `matriculada`, `desistida`, `descartada`. Transiciones: `recibida → validada | descartada | desistida`; `validada → matriculada | descartada | desistida`; los demás son finales (nada se borra ni se reabre; la persona puede volver a preinscribirse).
- **Duplicados**: `UNIQUE (convocatoria_id, vigente_email)`. `vigente_email` es el correo mientras el estado es `recibida`, `validada` o `matriculada` y `NULL` si es `desistida` o `descartada`; así hay **una sola preinscripción vigente por correo y edición** (sin distinguir mayúsculas) y tras desistir o descartar se puede repetir. El detalle administrativo muestra además coincidencias por **teléfono exacto** dentro de la edición (no bloquea: un teléfono puede ser compartido).
- **Conversión coherente**: CHECK `preinscripciones_conversion_chk` (`matriculada` ⇔ `matricula_id`, `estudiante_id`, `convertida_por` y `convertida_at` completos) y clave foránea **compuesta** `(matricula_id, estudiante_id, convocatoria_id) → matriculas(id, estudiante_id, convocatoria_id)`: la matrícula vinculada **es de la misma edición y del mismo estudiante** (la base lo impide aunque se escriba por SQL). `UNIQUE (matricula_id)`: una matrícula pertenece a lo sumo a una preinscripción. Para ello la migración añade `UNIQUE (id, estudiante_id, convocatoria_id)` a `matriculas` (solo un índice; sin cambiar filas ni la semántica de matrículas).
- Datos que **no** se guardan: DNI, pagos, comprobantes. El consentimiento se guarda con su fecha y la versión del aviso aceptado (`preinscripcion-v1`).

**`preinscripciones_historial`**: solo inserción, propio de las preinscripciones (**no toca el ENUM de `academico_historial`**, que pertenece a Docentes y a la migración retirada de Sesiones). Guarda operación (`creacion`, `correccion`, `validacion`, `descarte`, `desistimiento`, `conversion`), canal (solo en la creación), actor y rol (todas menos la creación, que la hace el visitante), estados, **nombres** de los campos modificados (nunca valores), revisión y motivo. CHECK de coherencia actor/canal.

**`convocatorias`** gana tres columnas (las ediciones anteriores no cambian):

| Columna | Significado |
| --- | --- |
| `minimo_apertura INT NULL` | Validadas necesarias para confirmar la apertura. `NULL` = edición anterior, sin requisito. El alta por la API fija **10**; no es un parámetro del cliente. No es la capacidad. |
| `preinscripcion_estado ENUM('abierta','cerrada') DEFAULT 'cerrada'` | ¿Recibe preinscripciones? Lo decide Gerencia o Coordinación; independiente de la apertura académica. |
| `codigo_publico CHAR(32) NULL UNIQUE` | Identificador opaco (128 bits) que usa el público en lugar del id secuencial. Se genera al crear la edición o al habilitar la recepción de una edición anterior. |

## 3. Reglas de negocio

### Mínimo de apertura

- Una edición **nueva** exige **10 preinscripciones validadas** para abrirse. Cuentan **solo** `validada` y `matriculada`; una solicitud `recibida` no cuenta. Sin excepciones: no hay parámetro, permiso, rol ni DTO que permita abrir con menos (el DTO rechaza `minimo_apertura`).
- Al llegar a 10 la edición **no se abre sola**: `PUT /api/admin/convocatorias/:id/apertura` la confirma Gerencia o Coordinación (`convocatorias:editar`). Si faltan, responde 409 con el recuento (`necesita al menos 10 … y tiene N`).
- La comprobación se hace **con el bloqueo de la edición ya tomado**; validar, descartar, desistir y convertir toman el mismo bloqueo antes de cambiar de estado, así que el recuento es firme frente a validaciones simultáneas (probado: descartar frente a abrir nunca abre con 9).
- Las ediciones anteriores a la migración (`minimo_apertura NULL`) se siguen abriendo como antes.
- Validar exige además plazas: `validadas pendientes + matrículas activas < capacidad` (si la edición tiene capacidad). Así no se prometen plazas que no existen y el mínimo no se confunde con la capacidad.

### Recepción de preinscripciones

Distintos conceptos, independientes: **recepción** (`preinscripcion_estado`), **apertura académica confirmada** (`estado = abierta`), **matrículas**, **capacidad máxima** y **cancelación/cierre/archivo**.

- Una edición recibe si: recepción `abierta`, sin archivar, estado `planificada` o `abierta`, curso `publicado` y con código público.
- Una edición **planificada** puede recibir. Una **ya abierta** sigue recibiendo mientras Gerencia/Coordinación mantengan la recepción y queden cupos reales (`matrículas activas < capacidad`).
- **No se cierra sola** al llegar a 10 ni al confirmar la apertura. Cerrar la recepción siempre se permite; habilitarla exige edición planificada o abierta, sin archivar, con capacidad.
- Cancelada, cerrada o archivada no reciben, aunque la recepción siguiera `abierta`.
- Tope de seguridad: **500 preinscripciones vigentes por edición** (`TOPE_VIGENTES_POR_EDICION`). Es un límite técnico contra el relleno masivo, **no una decisión de negocio** (ver pendientes).

### Conversión a matrícula

`POST /api/admin/preinscripciones/:id/conversion` con `{ revision, doc_numero, estudiante_id? }`. **El DNI es siempre obligatorio**: lo teclea quien revisó el documento de la persona (la preinscripción pública no lo recoge) y es el **ancla de identidad**. `estudiante_id` es opcional y solo *confirma* la selección. **Una sola transacción** (curso → edición → preinscripción → estudiante → matrícula):

1. La preinscripción debe estar `validada` y la `revision` coincidir (409 si no).
2. La edición debe estar **académicamente abierta** y sin archivar.
3. **Verificación de identidad** (ver el apartado siguiente). Si hay discrepancia, 409 y **no se escribe nada**.
4. Con estudiante registrado con ese DNI se **vincula**; si no existe, se **crea** con los nombres, correo y teléfono de la preinscripción (`EstudiantesService.createInTransaction`).
5. Se crea la matrícula con `MatriculasService.createInTransaction`: valen **exactamente** las reglas de Matrículas (edición abierta, capacidad y cupos, estudiante no archivado, una matrícula por estudiante y edición). Si ya existe una matrícula —**activa o anulada**— responde 409 y **no crea otra** (una anulada se reactiva desde Matrículas).
6. Se vincula (`matricula_id`, `estudiante_id`), se registra `convertida_por`/`convertida_at` y el historial (`conversion`, con actor, rol y los **controles de identidad aplicados** como códigos). La matrícula queda con su propio historial académico (`creacion`, motivo «Conversión de una preinscripción validada»).
7. Cualquier fallo revierte **todo**, incluido el estudiante recién creado (probado con fallos del historial de la preinscripción y del historial de la matrícula).
8. Dos conversiones simultáneas de la misma preinscripción, del mismo DNI o del último cupo: una gana (201), las demás reciben 409 sin dejar estudiantes ni matrículas sueltos. Repetir una conversión ya hecha (reintento o doble clic) da 409 y no duplica nada.

#### Controles de identidad (`preinscripciones.identity.ts`)

Qué se compara y por qué. Nada se basa **solo** en un correo o un teléfono: son indicios de apoyo, no pruebas.

| Situación | Regla | Resultado |
| --- | --- | --- |
| Se indicó `estudiante_id` | Debe ser el estudiante cuyo DNI se tecleó. Un id sin DNI → 400. | Si no coincide, o el DNI no está registrado: 409 `DNI_NO_COINCIDE`. Un id inexistente: 404. No se puede elegir otro estudiante. |
| Estudiante **registrado** con ese DNI | **Nombres y apellidos** compatibles (sin tildes, mayúsculas, partículas «de/la/del…»; uno contiene al otro: «Rosa» ≈ «Rosa María»; nombres y apellidos invertidos **no** coinciden). Además, si el estudiante tiene correo o teléfono registrado, **al menos uno** debe coincidir (el teléfono se compara por dígitos, ignorando «+51»). Un estudiante sin contacto registrado no aporta ni resta. | Coincide: se vincula y se anotan `control:dni_coincide`, `control:nombres_coinciden`, `control:contacto_email`/`contacto_telefono`/`contacto_sin_referencia`. Si no: 409 `IDENTIDAD_DISCREPANTE` con `discrepancias` = `["nombres"]`, `["contacto"]` o ambas. |
| DNI **no registrado** (estudiante nuevo) | Se busca otro estudiante con el **mismo correo o teléfono**. Si alguno tiene además un **nombre compatible** es un posible duplicado (DNI mal tecleado). | 409 `POSIBLE_DUPLICADO`. Si solo comparte el contacto (familiares), se crea y se anota `control:contacto_compartido`. Sin coincidencias: `control:dni_nuevo` + `control:sin_duplicado_aparente`. |

- Los errores llevan un **código** y los **campos** en discrepancia, nunca sus valores (ni nombres, ni correo, ni teléfono, ni DNI). Los mensajes son estáticos.
- **No existe una excepción por parámetro**: no hay `forzar`, `confirmar_discrepancia` ni motivo que salte el bloqueo (el DTO rechaza cualquier campo ajeno). La **revisión administrativa explícita y documentada** es hoy la corrección por la vía auditada y repetir: (a) *Corregir la preinscripción* (`PATCH`, permiso `editar`; queda `correccion` en el historial con los nombres de los campos) o (b) *corregir el estudiante* en el módulo de Estudiantes (queda en su propio historial). Después se repite la conversión con la nueva `revision`. Es una vía deliberadamente costosa: cada cambio deja huella y quien lo hace queda identificado.
- Cada bloqueo se anota en el registro técnico de la API solo con identificadores internos (id de la preinscripción, id del administrador, código y campos). No se guarda en `preinscripciones_historial` porque la transacción se revierte entera.
- **Decisión definitiva del responsable (2026-10-20): no habrá excepciones.** Ni Gerencia, Coordinación ni Secretaría pueden omitir las comprobaciones de identidad ni ignorar una discrepancia de DNI, nombres o contacto. Si los datos son incompatibles, la conversión se bloquea con un error seguro; el dato se corrige por el procedimiento administrativo auditado (corrección de la preinscripción o del estudiante) y las verificaciones se **exigen de nuevo** en la conversión siguiente. Esto incluye la discrepancia de **contacto** (p. ej. el estudiante cambió de teléfono): se corrige el dato, no se salta el control.

Se desconoce si una matrícula activa preexistente de la misma persona debería enlazarse a la preinscripción en lugar de rechazarse: hoy se rechaza (pendiente de decisión).

## 4. API

Sin `DELETE` en ninguna ruta. Rutas fijas antes de `:id`. Errores sin SQL, Prisma ni datos personales; esquema pendiente → 503 neutro.

### Pública (sin sesión)

| Método y ruta | Cuerpo | Respuesta |
| --- | --- | --- |
| `GET /api/preinscripciones/convocatorias` | — | `{ ok, items: [{ codigo, nombre, apertura_confirmada, fecha_inicio, fecha_fin, curso: { titulo, tipo, modalidad, duracion } }] }`. Solo ediciones que reciben **ahora**. Sin ids, cupos, conteos ni datos personales. Máximo 50. |
| `POST /api/preinscripciones` | `{ convocatoria, nombres, apellidos, email, telefono, consentimiento: true, website? }` | `201 { ok: true, mensaje }` — canal `formulario`. |
| `POST /api/chatbot/preinscripcion` | lo anterior + `confirmacion: true` | `201 { ok: true, mensaje }` — canal `chatbot`. |

- `convocatoria` es el **código opaco** del listado. Cualquier campo ajeno (`canal`, `origen`, `estado`, `convocatoria_id`, `dni`, `pago`…) → **400** (whitelist): el cliente no elige origen.
- `consentimiento` debe ser el booleano `true` (`"true"`, `1` o ausente → 400). El chatbot exige además `confirmacion: true` (el visitante confirmó el resumen).
- Validación según AGENTS.md: obligatorio, longitud máxima del esquema y formato (correo, teléfono); sin longitudes mínimas inventadas. `website` es un campo trampa para robots: con contenido se responde éxito sin guardar.
- **La respuesta es idéntica** (cuerpo byte a byte) cuando se guarda y cuando la persona ya tenía una preinscripción vigente, y es la misma para ambos canales: no se revela si un correo ya estaba inscrito. No devuelve ids ni datos. Una edición inexistente, cerrada, cancelada, archivada, sin recepción o de un curso no publicado devuelve el **mismo 404**. Cupo lleno o tope de seguridad → 409. Las solicitudes simultáneas del mismo correo dejan una sola fila.
- **Frecuencia** (estrategia detallada en §6.1): cuatro topes sobre `rate_limit_buckets` de MySQL, compartidos entre instancias: **5 por minuto por IP**, **30 por hora por IP**, **20 por minuto por subred** (IPv4 /24, IPv6 /64) y **60 por minuto globales**, con una cuota **compartida por formulario y chatbot** y su propio cubo global (no agotan el de los demás formularios). Un rechazo **no gasta cuota ajena**. Se aplica a los POST; el GET del listado no tiene límite propio.
- No se envía correo de confirmación (decisión pendiente; además un envío distinto para duplicados revelaría su existencia).

### Administrativa (JWT + AccessGuard)

| Método y ruta | Permiso | Descripción |
| --- | --- | --- |
| `GET /api/admin/preinscripciones` | `preinscripciones:leer` | Lista paginada (`page`, `limit` ≤ 100). Filtros: `convocatoria_id`, `curso_id`, `estado`, `canal`, `search` (nombres, apellidos, correo, teléfono; todos los términos). |
| `GET /api/admin/preinscripciones/resumen` | `leer` | Por edición: `conteo` por estado, `apertura { minimo, contadas, faltan, cumple_minimo }`, `cupos { capacidad, ocupados, disponibles }`. Sin datos personales. Filtros: `convocatoria_id`, `archivo`, `search`. |
| `GET /api/admin/preinscripciones/:id` | `leer` | Detalle + edición, matrícula y estudiante vinculados + `coincidencias` (correo o teléfono). |
| `GET /api/admin/preinscripciones/:id/historial` | `leer` | Historial paginado. |
| `PATCH /api/admin/preinscripciones/:id` | `preinscripciones:editar` | Corrección de `nombres`, `apellidos`, `email`, `telefono` con `revision` (solo `recibida` o `validada`; 409 si el correo ya está vigente). No cambia estado ni canal. |
| `PUT /api/admin/preinscripciones/:id/validacion` | `editar` | `{ revision }`. `recibida → validada`. |
| `PUT …/:id/descarte` | `editar` | `{ revision, motivo }` (motivo obligatorio, **sin datos personales**: 400 si lleva correo, teléfono, documento o contraseña). |
| `PUT …/:id/desistimiento` | `editar` | `{ revision, motivo? }` (mismas reglas del motivo). |
| `POST …/:id/conversion` | `preinscripciones:convertir` | `{ revision, doc_numero, estudiante_id? }`. Ver §3. `201 { ok, item, matricula, estudiante_creado }`; 409 con `codigo` y `discrepancias` si falla la identidad. |
| `PUT /api/admin/convocatorias/:id/preinscripcion` | `convocatorias:editar` | `{ revision, estado: 'abierta' o 'cerrada' }`: habilita o cierra la recepción. No abre ni cierra la edición. |
| `PUT /api/admin/convocatorias/:id/apertura` | `convocatorias:editar` | Existente; ahora exige el mínimo. |

## 5. Permisos

Nuevo recurso `preinscripciones`: `leer`, `editar`, `convertir`, `exportar` (**reservado**: ninguna ruta lo exige todavía).

| Rol | Permisos |
| --- | --- |
| `GERENTE_GENERAL` | los cuatro |
| `COORDINADORA_INSTITUCIONAL` | `leer`, `editar`, `convertir` |
| `SECRETARIA` | `leer`, `editar`, `convertir` |
| Cuenta sin rol | ninguno (403) |

La **secretaría puede convertir** sin recibir permisos generales nuevos: no confirma la apertura, no habilita la recepción (`convocatorias:editar`), no cierra ni archiva ediciones, no anula matrículas ni edita estudiantes (comprobado con HTTP real). La conversión es una operación controlada: reutiliza los servicios académicos y no consulta `matriculas:*` ni `estudiantes:*`. Las rutas de `route-inventory.ts` y los decoradores coinciden (prueba existente). Ver [Roles administrativos](roles-administrativos.md).

## 6. Privacidad

- Datos personales solo en `preinscripciones`. Las respuestas públicas no los devuelven; los errores y el historial no los repiten; la API no los escribe en sus registros (comprobado en la integración: la salida de las dos instancias de la API no contiene ningún dato de prueba).
- Resumen y listado público sin datos personales. El administrativo sí los muestra, solo con `preinscripciones:leer`.
- **No hay política automática de eliminación o anonimización**: falta definir el plazo legal. Nada se borra todavía (ni siquiera `desistida` o `descartada`); el historial tampoco. Para ejercer un derecho de eliminación se necesita una decisión y un procedimiento propios. Es un riesgo pendiente.
- El aviso que ve el visitante debe nombrar el tratamiento (finalidad, responsable, plazo); su texto es del equipo legal y web y no se redactó aquí. La versión aceptada se guarda en `aviso_version`.

### 6.0 Minimización del historial, de los errores y de los registros

| Dónde | Qué se guarda | Cómo se garantiza |
| --- | --- | --- |
| `preinscripciones_historial.campos` | **Nombres** de campo (`nombres`, `email`…), el tipo de estudiante (`estudiante_nuevo`/`estudiante_existente`) y **códigos de control** (`control:dni_coincide`…). Nunca valores. | `recordHistory` rechaza (y revierte la operación) todo elemento que no cumpla `^[a-z][a-z_]{0,29}(:[a-z_]{1,29})?$`: un correo, un nombre propio o un DNI no pasan ese patrón. |
| `preinscripciones_historial.motivo` | Texto libre **del administrador** (descarte, desistimiento), máx. 300 caracteres. | El DTO rechaza con 400 un motivo que contenga `@`, 7 o más dígitos (aunque vengan separados por espacios, guiones o paréntesis) o una credencial asignada (`contraseña:`, `password=`, `token:`…); `recordHistory` repite la comprobación por si otro llamador omite el DTO. El error **no repite el dato**. Las fechas con barras (`12/10/2026`) se admiten. |
| Errores HTTP | Mensajes estáticos y, en los bloqueos de identidad, un código y nombres de campo. | Prueba: ningún error contiene nombres, correos, teléfonos ni DNI de la prueba. |
| Registro técnico de la API | Solo identificadores internos (id de preinscripción, id del administrador, código de bloqueo y campos). | El único `Logger` nuevo (`Conversión bloqueada por identidad…`) no recibe datos personales. |
| `rate_limit_buckets` | Hashes SHA-256 (IP, subred), nunca la IP en claro, ni correos ni teléfonos (el guard no lee el cuerpo de la solicitud). | Prueba SQL: todos los `id` son hashes de 64 hexadecimales. |
| OpenAI | Nada del formulario de preinscripción. | Ver §7. |

La barrera del motivo es de **minimización**, no una detección completa: un nombre propio no se puede reconocer con fiabilidad. Se pide al administrador describir el motivo sin identificar a nadie («Duplicada», «Desistió por horario») y las pantallas futuras deben decirlo junto al campo. **No se borró ni anonimizó ningún registro existente** y no hay proceso automático: sigue pendiente la política de retención (§11).

### 6.1 Protección frente al abuso (`PublicRateLimitGuard`)

Problema que se corrigió: el contador global se incrementaba también con las solicitudes que la cuota de IP rechazaba, de modo que un solo cliente podía agotar el tope global y dejar sin servicio a los demás durante el minuto.

| Tope (preinscripciones) | Valor | Qué frena |
| --- | --- | --- |
| Por IP y minuto | 5 | ráfagas de un cliente |
| Por IP y hora | 30 | goteo sostenido desde una IP; deja registrarse a un aula que comparte una conexión (una persona cada pocos minutos) |
| Por subred y minuto (IPv4 /24, IPv6 /64) | 20 | quien rota direcciones vecinas para multiplicar su cuota; 4 veces el tope individual, así que varias personas legítimas tras la misma conexión caben |
| Global por minuto (cubo propio) | 60 | protección de último recurso para el conjunto |

- **Solo cuentan las admitidas.** Cada cubo sube con `UPDATE … WHERE count < tope`; si cualquiera rechaza, la transacción se **revierte entera** y la solicitud no gasta ninguna cuota (ni la propia ni la global). Una IP abusiva se queda en su tope individual y **no puede agotar el global**. Probado: 1000 intentos de una IP dejan 5 admitidos y la cuota global intacta, y otra IP legítima sigue registrando.
- **Sin condiciones de carrera**: la comprobación y el incremento son una sola sentencia atómica por cubo; las filas se toman siempre en el mismo orden (individual → hora → subred → global) y con `READ COMMITTED`, sin bloqueos de hueco. Un interbloqueo transitorio se reintenta hasta 3 veces; si persiste responde 503 neutro (nunca se omite el límite). Probado con 40 solicitudes simultáneas repartidas entre dos instancias reales (exactamente 5 admitidas) y 70 redes simultáneas (exactamente 60 admitidas).
- **Cuota compartida entre instancias** (MySQL) y **compartida por formulario y chatbot**; el global de preinscripciones es propio y no toca el del resto de formularios públicos ni el del chat conversacional. Los cubos que caducan se purgan como mucho cada 30 s por proceso (los rechazos ya no disparan un `DELETE` cada uno).
- **La IP la resuelve Express** con `trust proxy` (`TRUSTED_PROXY_CIDRS`); el guard no lee `X-Forwarded-For` ni el cuerpo. Un valor inventado a la izquierda de la cabecera no cambia la IP (probado). Sin proxies configurados todos los visitantes comparten la IP del proxy y, por tanto, el límite (`proxy-trust.test.ts`; `main.ts` lo avisa al arrancar).
- 429 con `{ ok: false, mensaje }`. Los demás formularios conservan sus topes por IP y el global de 200/min, ahora sobre solicitudes admitidas (efecto deseado: ya no es agotable por un solo cliente).
- **Límite honesto**: quien dispone de **muchas redes distintas** (una botnet) puede agotar el global de 60/min y bloquear el formulario durante ese minuto. Sin CAPTCHA, Redis ni un servicio externo no se puede evitar del todo; no se instaló ninguno (necesita autorización). Mitigaciones que ya existen: el tope de 500 vigentes por edición, la unicidad por correo, el campo trampa y la validación manual.

## 7. Aislamiento del chatbot

El chatbot propio de Horus sigue usando la API de OpenAI desde NestJS; no se tocó su servicio, su diseño ni sus credenciales, y no se integró Botpress.

- La preinscripción es una **acción determinista del backend**: el widget llama a `POST /api/chatbot/preinscripcion` solo cuando el visitante completó y confirmó los datos. El modelo no la invoca: la petición a OpenAI no define herramientas (`tools`) y sus instrucciones prohíben afirmar que se registró, inscribió o guardó algo y pedir datos personales.
- **No se envían a OpenAI** los datos recogidos: `PreinscripcionesPublicService` no importa `ChatbotService`, `ConfigService` ni `fetch`; el contexto del modelo (catálogo publicado) no lee `preinscripciones`, matrículas ni estudiantes; los correos y teléfonos escritos en el chat ya se redactaban antes de salir. Esto lo comprueban las pruebas `Aislamiento` (análisis estático de imports + simulación de `fetch`).
- El modelo no puede listar preinscripciones, consultar alumnos o matrículas, llamar a endpoints administrativos, revelar contactos, cambiar estados ni matricular: no tiene ningún camino de código hacia esos servicios.
- **Límite del aislamiento (no es absoluto)**: `PrismaService` es **un único cliente global con una sola credencial MySQL (`DB_USER`)** compartida por los servicios públicos, el chatbot y los administrativos. La separación es **de código** (módulos, servicios y controladores distintos, guards y permisos), no de privilegios en la base: un fallo de ejecución de código en la API tendría el alcance de esa credencial. Para una separación real haría falta, como mejora futura, un usuario MySQL de solo lectura con `SELECT` limitado al catálogo para el chatbot y otro con `INSERT` limitado a `preinscripciones` para el alta pública. No se implementó ni se afirma.

## 8. Activación y migración

`backend/migrations/20261020-preinscripciones.sql` (registrada en `versions` de `scripts/migrate.cjs`, esperada por `db:check` y documentada en [RAILWAY.md](../../RAILWAY.md)). Cuatro sentencias: índice único en `matriculas`, `CREATE TABLE IF NOT EXISTS` de las dos tablas y un `ALTER TABLE` de `convocatorias`. No inserta datos ni modifica filas.

- **Requiere la migración ANTES del código**: el cliente Prisma selecciona las columnas nuevas de `convocatorias`; con el código nuevo sobre una base sin migrar, Ediciones, Matrículas y las demás consultas de ediciones responden 503 (`P2022`). Un backend de desarrollo en marcha que recompile este código contra `horus_db` sin migrar mostrará ese 503 hasta aplicar la migración.
- Los dos `ALTER TABLE` no admiten `IF NOT EXISTS`: `db:migrate` omite, solo en esta migración, «columna duplicada» (1060), «índice duplicado» (1061) y «restricción CHECK duplicada» (3822) para completarse tras una interrupción; `db:check` verifica después columnas, tipos, índices, claves, CHECK y la columna generada reales (una estructura incorrecta no pasa).
- **No se aplicó a ninguna base**. Para activarla en una base real: autorización explícita, respaldo verificado (`npm run db:backup`), ensayo en un clon aislado y `db:check` antes y después, como en [Activación real en horus_db de Docentes](activacion-docentes-mysql-real.md). Las otras migraciones pendientes (Sesiones) son independientes **en su contenido** (esta no usa su ENUM del historial), pero **no se activan por separado**: `db:migrate` aplica en orden todas las pendientes de `versions` y no permite elegir una.
- **Esta fase de estabilización no cambió la migración ni el esquema**: la identidad usa columnas existentes, el historial reutiliza `campos` y `motivo`, y el nuevo limitador usa la tabla `rate_limit_buckets` que ya existe (`20261002-complete-institutional`). Siguen **pendientes y sin aplicar a ninguna base habitual**: `20261020-sesiones-academicas` y `20261020-preinscripciones`.
- **El limitador nuevo no depende de columnas nuevas** (solo de `rate_limit_buckets`), pero se despliega junto con el resto del código de este cambio, que sí exige las migraciones antes (ver arriba): no se activa por separado.
- **Orden de activación previsto** (cuando el responsable lo autorice): (1) respaldo verificado y `db:check` previo; (2) ensayo en un clon aislado; (3) detener el backend de desarrollo que ejecute el código nuevo; (4) `db:migrate`, que aplica `20261020-sesiones-academicas` y después `20261020-preinscripciones`; (5) `db:check` posterior; (6) **antes de exponer los endpoints públicos, verificar `TRUSTED_PROXY_CIDRS`** con el proveedor (Railway/Caddy): debe enumerar exactamente los proxies reales; sin ello todos los visitantes comparten una IP (se bloquean entre sí) o los límites por IP y subred pierden valor (ver §6.1 y §12); (7) arrancar el backend con el código nuevo; (8) solo entonces, el frontend de preinscripciones, cuando exista. Nunca el código antes que las migraciones.

## 9. Pruebas

| Prueba | Comando | Cubre |
| --- | --- | --- |
| Unitarias (sin MySQL) | `npm test` (`test/preinscripciones.test.ts`, `test/preinscripciones-identidad.test.ts`, `proxy-trust`, `auth-hardening`, `public-signup`, más `permissions`, `migrations`, `access-guard`) | DTO (consentimiento, whitelist, canal), reglas, matriz de permisos, servicio público con tx simulada (ambos canales, duplicados, honeypot, 404 uniforme, capacidad, tope, 503), **frecuencia** (IP abusiva sin agotar el global, subred /24 y /64, solicitudes simultáneas, hora, global, interbloqueo → 503, solo hashes), **identidad** (reglas puras; servicio real con cliente simulado: coincidente, discrepante, DNI ajeno, 404, posible duplicado, nuevo, revisión obsoleta, nada escrito al bloquear), **privacidad** (motivo y campos del historial, errores sin datos), mínimo de apertura, aislamiento del chatbot (estático + `fetch` simulado, modelos permitidos, sin credenciales). El almacén de cubos es `test/fixtures/rate-limit-memory.ts` (imita el SQL del guard). |
| Integración MySQL 8.4 desechable | `npm run build` y `node test/run-academic-isolated.cjs preinscripciones` | Migración desde una base con datos y recuperación parcial; restricciones SQL (únicos, CHECK, clave compuesta); HTTP real con AccessGuard y **dos instancias** de la API; permisos por rol; canales; consentimiento; duplicados y carreras; frecuencia (IP abusiva con 40 solicitudes simultáneas entre las dos instancias, 70 redes simultáneas contra el global, `X-Forwarded-For` falsificado, solo hashes en el cubo); recepción; mínimo de 10; apertura confirmada; recepción posterior; capacidad; gestión; conversión (nuevo, existente, anulada, archivado, edición no abierta, concurrencia); **identidad** (nombres o contacto discrepantes, DNI ajeno, posible duplicado, contacto compartido, corrección auditada y reintento, dos administradores a la vez, motivos con datos personales, auditoría global del historial); reversión transaccional con disparadores; compatibilidad con Sesiones, Docentes, Contacto, Chatbot y Cotizaciones; privacidad. Contenedor propio, retirado al terminar; nunca `horus_db` ni `horus_local`; no envía correo. |

Las integraciones de Ediciones, Docentes y Horarios abren ediciones por la API; desde esta migración lo hacen cumpliendo la regla real (10 validadas insertadas por SQL en su base desechable con `test/fixtures/preinscripciones-fixture.cjs`).

## 10. Contratos para React

- Pública: pedir `GET /preinscripciones/convocatorias`, mostrar `curso.titulo`/`nombre`/fechas y enviar el `codigo` elegido. Mostrar siempre `mensaje` tal cual y tratar 201 como «recibido» (no se promete aceptación ni matrícula). 400 → corregir campos (los mensajes no incluyen datos); 404/409 → «esta edición ya no recibe preinscripciones»; 429 → esperar; 503 → reintentar luego. Enviar el campo `website` vacío y oculto. El texto del aviso de privacidad y su enlace deben mostrarse junto a la casilla de consentimiento.
- Chatbot: tras recoger los cuatro datos, mostrar el resumen, pedir confirmación explícita y recién entonces llamar a `POST /chatbot/preinscripcion` con `confirmacion: true` y `consentimiento: true`. No pasar esos datos a `POST /chatbot/message`.
- Panel (futuro): permisos desde `GET /admin/me` (`preinscripciones:*`); `PANEL_SECTIONS` debe declarar la sección con `preinscripciones:leer`. Siempre enviar la `revision` leída y tratar 409 con el flujo de fusión existente (no reescribir en silencio). Bloquear dobles envíos; tras un resultado incierto de una conversión, **consultar el detalle antes de repetir** (la operación es segura frente a repeticiones: no duplica matrícula, pero la respuesta puede perderse). Para convertir, **pedir siempre el DNI** (se compara con el del estudiante) y enviar `estudiante_id` solo como confirmación de la selección; mostrar el 409 de identidad con sus `discrepancias` (`nombres`, `contacto`, `dni`, `posible_duplicado`) y explicar que se corrige la preinscripción o el estudiante y se repite, sin ofrecer «forzar». Advertir junto al campo `motivo` que no debe incluir datos personales. El resumen (`/resumen`) alimenta el avance «N de 10 validadas».

## 11. Decisiones de negocio pendientes (no inventadas)

1. **Plazo legal y política de eliminación/anonimización** de datos de preinscritos (y texto del aviso de privacidad).
2. **Lista de espera y tope por cupo**: hoy, la recepción de una edición abierta se detiene con los cupos ocupados y todas se detienen en 500 vigentes (límite técnico).
3. **Notificaciones**: correo de confirmación al visitante o aviso al equipo (no existen; un envío distinto para duplicados revelaría su existencia).
4. **Matrícula previa del mismo estudiante**: si ya está matriculado (activo) por otra vía, ¿enlazar la preinscripción a esa matrícula en lugar de rechazar? Hoy se rechaza con 409.
5. **Reabrir** una preinscripción descartada o desistida: hoy son finales (la persona puede volver a preinscribirse).
6. **Exportación** (`preinscripciones:exportar`): reservado al gerente; sin ruta ni formato definidos.
7. **Aprobación de la apertura con menos de 10**: expresamente excluida; si cambiara el criterio sería una decisión nueva con su propio permiso y auditoría.
8. Quién ve preinscripciones de ediciones archivadas y retención del historial.
9. ~~Excepción documentada de identidad~~ **Resuelta (2026-10-20): no existe ni existirá.** Una discrepancia de identidad bloquea y se corrige por la vía auditada (§3). Solo una decisión futura y explícita del responsable podría reabrir el asunto.
10. **Medidas anti-abuso adicionales** (CAPTCHA, Redis u otro servicio para resistir a una botnet, §6.1): por decisión del responsable **no se instalan en esta fase**; la protección vigente es la de MySQL (IP, subred, hora, global, transacciones, 429, campo trampa y unicidad). Se reevaluará con el volumen real tras la activación.
11. Valores de los topes de frecuencia (5/min, 30/hora, 20/min por subred, 60/min global) según el volumen real esperado de visitantes.

## 12. Riesgos conocidos aceptados (revisión final del backend)

- **Cuota global agotable por una red distribuida** *(riesgo anterior corregido en lo que concierne a un solo cliente; ver §6.1)*: un cliente aislado ya no puede agotar el global; una botnet con muchas redes distintas sí podría dejar sin servicio el formulario durante un minuto. Sin CAPTCHA ni servicio externo no se evita del todo. Los topes por IP y subred pueden bloquear a varias personas legítimas detrás de una misma conexión si superan 5 por minuto o 20 por subred; el mensaje 429 les pide esperar.
- **Rotación de IP detrás de un proxy mal configurado**: si `TRUSTED_PROXY_CIDRS` no refleja el proxy real, todos los visitantes comparten una IP (se bloquean entre sí) o, peor configurado, se podría confiar en cabeceras del cliente. El guard no lee cabeceras por sí mismo; depende de esa configuración, que debe confirmarse con el proveedor antes de activar.
- **Duplicados por alias**: el único por correo es exacto (minúsculas, sin distinguir mayúsculas por la colación). `persona+1@dominio` o correos distintos de la misma persona cuentan como solicitudes distintas; el control es la validación manual (el detalle muestra coincidencias por teléfono).
- **El canal `chatbot` lo fija la ruta, no una prueba de origen**: cualquier cliente puede llamar a `POST /api/chatbot/preinscripcion`. Se acepta porque la ruta tiene los mismos controles que el formulario; el canal es informativo, no una garantía de autenticidad.
- **Texto libre en el historial**: `motivo` (descarte o desistimiento) ya rechaza correos, números largos y credenciales, pero **no puede detectar un nombre propio** ni datos descritos con palabras; las pantallas futuras deben advertirlo. Los registros anteriores a esta barrera, si existieran, no se tocaron (ninguna base real tiene la migración).
- **Identidad en la conversión**: el contraste es una barrera razonable, no una prueba infalible. El DNI lo teclea el administrador (no hay verificación contra una fuente externa como RENIEC); dos personas homónimas con contactos coincidentes y un DNI tecleado a propósito para vincularlas quedarían unidas, pero cada paso deja actor, rol y controles en el historial. Los **nombres** se aceptan si uno contiene al otro («Ana» ≈ «Ana María»); un administrador puede *corregir la preinscripción* para igualarlos (queda registrado como `correccion`). La detección de duplicados bajo otro DNI solo compara correo o teléfono **exactos** (el teléfono con distinto formato en el estudiante no se detecta en la búsqueda SQL). Un estudiante sin contacto registrado se vincula con DNI + nombres.
- **Recuento y matrículas anuladas**: una preinscripción `matriculada` sigue contando para el mínimo aunque su matrícula se anule después; no afecta a la apertura porque convertir exige la edición ya abierta.
- **Tope de 500 vigentes** (`recibida` + `validada` + `matriculada`): protege la tabla, no equivale a la capacidad (`capacidad` admite valores mayores). Al alcanzarlo el alta pública responde 409 igual que con cupos llenos. Pendiente de la decisión 2.
- **Aislamiento del chatbot solo lógico**: ver §7 (una sola credencial MySQL).
