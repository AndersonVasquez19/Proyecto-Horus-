# HORUS Assistant (v1 resumen y v2 consultas, solo lectura)

Asistente administrativo **interno** del panel de Horus Group SRL. Resume el día de la persona que lo consulta, muestra sus pendientes según su rol y registra de dónde salió cada dato. Código: `backend/src/asistente/`. Pruebas: `backend/test/asistente.test.ts` (v1) y `backend/test/asistente-consulta.test.ts` (v2).

> **v2 (consultas en lenguaje natural):** `POST /api/admin/asistente/consultar`, descrito en la [sección 12](#12-consultas-en-lenguaje-natural-v2), con el contrato para el panel en 12.5 y la defensa ante el jurado en la [sección 15](#15-cómo-defender-la-arquitectura-ante-el-jurado-v2). Todo lo demás de este documento describe el resumen v1, que se conserva sin cambios.

> **No es el chatbot público.** Ver [«Relación con el chatbot público»](#relación-con-el-chatbot-público).

## 1. Objetivo

Que gerencia, coordinación y secretaría abran el panel y sepan **qué atender primero**, con cifras reales del sistema y sin buscar en cada módulo. La versión 1:

- calcula pendientes con **reglas fijas** (no con IA);
- muestra solo las áreas que el rol ya puede leer en el panel;
- opcionalmente pide a la IA que **redacte** el resumen en lenguaje sencillo;
- **no ejecuta ninguna acción** (no valida, no matricula, no emite, no envía correos, no escribe en la base).

## 2. Qué datos existen y cuáles no

Revisión de los módulos (inspección estática del código y del esquema Prisma):

| Dato | ¿Se puede consultar hoy? | Fuente |
| --- | --- | --- |
| Consultas registradas (hoy, pendientes, antiguas) | Sí | `contactos` + `attention_records` (`messageState`, igual que el Resumen) |
| Personas únicas | Sí, **aproximado**: correos distintos | `contactos.email` |
| Mensajes del chatbot (preguntas, resueltas, sin resolver) | Sí | `chatbot_interacciones` (90 días) |
| Preguntas sin respuesta del chatbot | Sí | `chatbot_preguntas_sin_respuesta` (90 días) |
| Personas únicas **del chatbot** | **No**: el chatbot no guarda identidad | — |
| Cotizaciones por estado y vencidas | Sí | `cotizaciones` |
| Preinscripciones por estado, ediciones con mínimo alcanzado | Sí | `preinscripciones`, `convocatorias` |
| Ediciones abiertas / planificadas con inicio vencido | Sí | `convocatorias` |
| Sesiones de hoy y atrasadas sin cerrar | Sí | `sesiones` (hora de pared de Lima) |
| Matrículas por confirmar cumplimiento | Sí | `matriculas` |
| Certificados listos / vigentes / requieren corrección | Sí | `certificados`, `matriculas`, `estudiantes` (reglas compartidas con el Resumen) |
| Tiempo de primera respuesta / de resolución | **No** hay métrica definida | — |
| Asistencia y calificaciones | **No**: módulos inexistentes | — |
| Pagos, ventas | **No** se registran | — |
| Visitas al sitio | **No** hay analítica | — |

No se creó ninguna tabla ni migración. Lo que no se registra se devuelve en `no_registrado`; nunca se estima.

## 3. Arquitectura

```
Panel (React)  ──GET /api/admin/asistente/resumen──►  AsistenteController   (JwtAuthGuard + AccessGuard: sesión válida)
                                                          │
                                                          ▼
                                                    AsistenteService
                                                          │ 1. límite de uso por cuenta (en memoria)
                                                          │ 2. rol VIGENTE leído de la base (AccountAccessService)
                                                          │ 3. secciones = permisos de lectura del rol (policy.ts)
                                                          ▼
                                       ┌──────────────────┴───────────────────┐
                                       ▼                                      ▼
                          PrismaAsistenteData                      asistente.rules.ts
                  (consultas fijas, solo conteos)             (pendientes deterministas, texto básico)
                                                                              │ cifras + títulos fijos
                                                                              ▼
                                                                 AsistenteExplainer  (opcional)
                                                                  └─► OpenAI /v1/responses
                                                                      (sin acceso a Prisma ni MySQL)
```

| Archivo | Responsabilidad |
| --- | --- |
| `asistente.controller.ts` | Un solo `GET admin/asistente/resumen?explicar=true\|false`. |
| `asistente.service.ts` | Orquesta: límite, rol, secciones, pendientes, indicadores, fuentes, explicación. |
| `asistente.data.ts` | **Única** capa que toca la base. Consultas parametrizadas de solo lectura que devuelven números. |
| `asistente.rules.ts` | Reglas puras: qué permiso exige cada sección, qué es un pendiente, validación de la redacción de la IA, limitador. |
| `asistente.time.ts` | Día operativo (zona `America/Lima`, constante ya existente en `sesiones.time.ts`). |
| `asistente.explainer.ts` | Llamada opcional a OpenAI con cifras ya calculadas. |

## 4. Relación con el chatbot público

| | Chatbot público | HORUS Assistant |
| --- | --- | --- |
| Audiencia | Visitantes del sitio | Personal del panel (con sesión y rol) |
| Ruta | `POST /api/chatbot/*` (pública, con cuota por IP) | `GET /api/admin/asistente/resumen` y `POST /api/admin/asistente/consultar` (privadas) |
| Datos | Contenido **publicado** (cursos, servicios, FAQ) | Agregados **internos** (conteos operativos) |
| Módulo | `src/chatbot/` | `src/asistente/` (no lo importa ni lo usa) |
| Qué comparte | Solo la **clave y la API** de OpenAI (`OPENAI_API_KEY`) | ídem |
| Acciones | Puede registrar un contacto/preinscripción **si el visitante lo confirma** | Ninguna |

El asistente **lee** las métricas que el chatbot ya guarda (interacciones y preguntas sin respuesta) pero nunca su texto de visitantes.

## 5. Flujo de una consulta

1. El panel llama `GET /api/admin/asistente/resumen` con su JWT (opcional `?explicar=true`).
2. `PublicRateLimitGuard` y `AccessGuard` validan la sesión (firma, cuenta activa, `session_version`).
3. El servicio aplica el límite por cuenta (30 consultas / 10 min; 6 con IA / 10 min) → `429` si se excede, **antes** de tocar la base.
4. Lee el rol actual de la cuenta desde MySQL. Sin rol → `403`; inactiva → `401`.
5. Calcula la lista de secciones que ese rol puede leer. **Las demás no generan ninguna consulta.**
6. Calcula «hoy» en la zona de operación (Lima) y consulta en paralelo cada sección permitida. Si una falla o su tabla no existe, esa sección queda como `error`/`no_disponible` y el resto sigue.
7. Las reglas convierten los conteos en pendientes ordenados (alta → media → info) y en un texto básico.
8. Si se pidió `explicar` y está activada, se envían a OpenAI **solo** cifras y títulos fijos; la respuesta se valida o se descarta.
9. Se devuelve el resumen con `fuentes` (tablas, ventana y hora de consulta) y `no_registrado`.

### Respuesta (campos principales)

`generado_en`, `zona_horaria`, `fecha_operativa`, `ventana_hoy`, `acceso` (rol y secciones autorizadas), `resumen` (`texto`, `vacio`, `pendientes_total`), `pendientes[]` (`id`, `area`, `severidad`, `titulo`, `cantidad`, `detalle`, `permiso`, `puedeActuar`), `indicadores_atencion`, `secciones` (estado por área), `fuentes[]`, `explicacion`, `no_registrado`, `alcance: "solo_lectura"`.

Estados vacíos y errores: sin pendientes → `resumen.vacio: true` con un mensaje claro; módulo sin migrar → `secciones.<x>.estado: "no_disponible"` (no se inventan ceros); fallo interno → `secciones.<x>.estado: "error"` con mensaje genérico; sin rol → 403; límite → 429 con `reintentar_en_segundos`.

## 6. Indicadores de atención al cliente

Tres conceptos distintos que **no se suman ni se mezclan**:

- **Consultas registradas**: filas de `contactos` (una persona puede dejar varias). Hoy, pendientes (nuevas + en proceso) y las que llevan más de 48 horas sin cerrar.
- **Personas únicas**: correos distintos (sin distinguir mayúsculas) entre esas consultas. Dos correos de la misma persona cuentan dos veces.
- **Mensajes del chatbot**: preguntas hechas al chatbot (resueltas / sin resolver / con IA). No tienen identidad; por eso `personas: null`. Las «consultas con datos» son las que dejaron un formulario y también cuentan como consultas registradas.

## 7. Fechas y zona horaria

La zona de operación es `America/Lima` (UTC-5, sin horario de verano), la misma que usan Sesiones y Reportes. «Hoy» es el día de calendario de Lima en el instante de la consulta: a las 22:30 del 21 en Lima (03:30 UTC del 22) todavía es el 21. Las columnas `DATETIME` en UTC se comparan con la ventana `[00:00 Lima de hoy, 00:00 Lima de mañana)`; las columnas `DATE` (sesiones, validez de cotizaciones, inicio de ediciones) con el día de Lima, sin conversión. No depende de la zona del proceso ni de MySQL. No hay una variable de entorno de zona: cambiarla es cambiar la constante `ZONA_HORARIA`.

## 8. Roles y permisos

La ruta se declara `@AuthenticatedRoute()` (cualquier sesión válida); el **servicio** exige rol y filtra por los permisos de lectura que la matriz (`permissions/policy.ts`) ya concede. No se creó ningún permiso ni se cambió la matriz.

| Sección | Permisos exigidos | Gerente | Coordinación | Secretaría |
| --- | --- | :-: | :-: | :-: |
| Mensajes (atención) | `mensajes:leer` | ✔ | ✔ | ✔ |
| Chatbot | `chatbot_consultas:leer` | ✔ | ✔ | ✔ |
| Cotizaciones | `cotizaciones:leer` | ✔ | ✔ | — |
| Preinscripciones | `preinscripciones:leer` | ✔ | ✔ | ✔ |
| Ediciones listas para abrir | `convocatorias:leer` + `preinscripciones:leer` | ✔ | ✔ | ✔ |
| Ediciones | `convocatorias:leer` | ✔ | ✔ | ✔ |
| Sesiones | `sesiones:leer` | ✔ | ✔ | — |
| Matrículas por confirmar | `matriculas:leer` | ✔ | ✔ | ✔ |
| Certificados | `certificados:leer` | ✔ | ✔ | — |

Cada pendiente indica además el permiso que sirve para **resolverlo** y `puedeActuar`: la secretaria ve «ediciones listas para abrir» como información, pero `puedeActuar: false` (la apertura es de Gerencia y Coordinación). Los cambios de rol surten efecto en la siguiente consulta (el rol se lee de la base, nunca del token).

## 9. Límites de seguridad

- **Solo lectura**: el `GET resumen` y el `POST consultar` (un POST solo porque envía una pregunta); ninguna escritura, ningún envío de correo, ninguna acción administrativa. Una prueba verifica que el controlador expone solo esos dos handlers y que ninguno es PUT, PATCH ni DELETE.
- **La IA no toca la base**: `AsistenteExplainer` solo depende de la configuración. Recibe `id`, título fijo, cantidad y severidad. Nunca nombres, correos, teléfonos, DNI, mensajes, notas ni texto de usuarios.
- **Sin consultas generadas por la IA**: todas las consultas están escritas en `asistente.data.ts`; la IA no decide qué consultar.
- **Contenido de usuarios = dato**: ningún texto escrito por visitantes entra al resumen ni al modelo; además las instrucciones del modelo declaran que las cifras son datos.
- **La IA no puede añadir cantidades**: su texto se descarta si contiene un número que no esté en las cifras entregadas, enlaces, correos, símbolos de marcado o más de 1200 caracteres. Se usa entonces el texto básico.
- **La IA nunca bloquea el resumen**: apagada, sin clave, ocupada (máx. 2 llamadas simultáneas), con tiempo agotado (12 s), con error HTTP o con respuesta inválida → `explicacion.estado` = `no_configurada`/`ocupada`/`no_disponible` y el resumen se entrega igual.
- **Frecuencia** (resumen): 30 consultas / 10 min por cuenta (6 con IA), en memoria por instancia. Los topes de las consultas conversacionales están en la sección 12.6. Con varias instancias el tope efectivo se multiplica por su número (mejora pendiente: tabla compartida como `rate_limit_buckets`).
- **Cantidad de información**: solo conteos; como máximo 20 pendientes; ninguna lista de registros.
- **Registros**: los fallos se registran con el **tipo** de error (p. ej. `invalid_provider_response`, `TimeoutError`), nunca con mensajes de base de datos, cuerpos de petición, claves ni datos. Las respuestas HTTP no incluyen mensajes internos.
- **Aislamiento**: la secretaria no recibe cifras, pendientes, fuentes ni nombres de las áreas que no puede leer (probado).

### Configuración (nombres, sin valores)

| Variable | Efecto |
| --- | --- |
| `ASISTENTE_AI_ENABLED=true` | Activa la explicación con IA (por defecto apagada). |
| `OPENAI_API_KEY` | Misma clave del chatbot. |
| `ASISTENTE_MODEL` | Modelo del asistente; si falta, usa `CHATBOT_MODEL`. |

No se modificó `.env` ni `.env.example`. Sin estas variables, el asistente funciona completo con el texto básico.

## 10. Ejemplos con datos ficticios

**Secretaria, 22-oct-2026, 09:00 en Lima** (`GET /api/admin/asistente/resumen`):

```json
{
  "ok": true,
  "zona_horaria": "America/Lima",
  "fecha_operativa": "2026-10-22",
  "acceso": { "rol": "SECRETARIA", "secciones_autorizadas": ["atencion","chatbot","preinscripciones","aperturas","ediciones","matriculas"] },
  "resumen": { "texto": "Hoy (2026-10-22, hora de Lima) tienes 6 puntos para revisar, 1 de ellos urgente.\n• 1 mensaje sin cerrar desde hace más de 48 horas.\n…", "vacio": false },
  "pendientes": [
    { "id": "mensajes_antiguos", "area": "atencion", "severidad": "alta", "cantidad": 1, "puedeActuar": true },
    { "id": "ediciones_listas_para_abrir", "area": "aperturas", "severidad": "alta", "cantidad": 1, "puedeActuar": false }
  ],
  "indicadores_atencion": {
    "consultas_registradas": { "hoy": 5, "pendientes": 5 },
    "personas_unicas": { "hoy": 4 },
    "chatbot": { "mensajes_hoy": 12, "sin_resolver_hoy": 3, "personas": null }
  },
  "explicacion": { "estado": "no_solicitada" }
}
```

(Las cifras de los ejemplos y de las pruebas son ficticias.)

**Explicación con IA** (`?explicar=true`, activada): «Hoy tienes 3 mensajes nuevos y 1 sin cerrar hace más de dos días. Conviene revisarlos primero.» Si el modelo dijera «250 mensajes», la respuesta se descarta y `explicacion.estado` = `no_disponible`.

## 11. Pruebas

`backend/test/asistente.test.ts` (simuladas: cuentas, base y OpenAI son dobles en memoria; no hay MySQL, red ni correo):

- autorización por rol, 403/401, rol no elevable desde el cliente;
- aislamiento entre roles y entre cuentas;
- conteos y reglas de pendientes, orden, tope, estados vacíos, módulo no disponible / con error;
- fechas: 22:30 Lima, medianoche, fin de año, bisiesto, independencia de `TZ`; parámetros reales de las consultas;
- ausencia de datos sensibles en respuesta, consultas, petición a OpenAI y registros;
- fallos de OpenAI (apagado, sin clave, red, 429/500, JSON ilegible, incompleta, vacía, timeout, números inventados, enlaces, correos, longitud, concurrencia);
- límite de frecuencia; forma del endpoint; validación de `explicar`.

`backend/test/asistente-consulta.test.ts` (v2, también simulada: sin MySQL, OpenAI ni red salvo `127.0.0.1`):

- preguntas permitidas (las siete del enunciado, con el hecho exacto de la fuente), combinación de herramientas, semana de Lima;
- preguntas fuera de alcance (acción, datos personales, no registrado, otro tema) y ambiguas;
- permisos insuficientes, catálogo por rol igual a la matriz real, herramientas prohibidas elegidas por el modelo, petición mixta, intentos de saltar roles, rol leído de la base en cada consulta;
- selecciones inválidas del modelo (JSON roto, ids inventados, parámetros extraños);
- datos sensibles (correos, DNI, teléfonos), contenido de lo enviado a OpenAI y de los registros;
- respuestas con conteos incorrectos, cifras escritas por el usuario, enlaces y correos;
- fallos y tiempos de espera de OpenAI en los dos pasos, IA apagada, llamadas simultáneas;
- topes por cuenta, día y global; contrato HTTP real (200, 400, 401, 403, 429, 503) con las guardas reales; arquitectura (el código de la IA no importa Prisma ni escribe).

`test/permissions.test.ts` se actualizó: el nuevo `GET admin/asistente/resumen` figura en las listas cerradas de rutas «autenticadas». **Pendiente (no ejecutado):** pruebas con MySQL real; las consultas se validaron por sus parámetros y filtros, no contra datos reales.

## 12. Consultas en lenguaje natural (v2)

`POST /api/admin/asistente/consultar` permite preguntar en español sobre las operaciones de Horus Group. **Sigue siendo solo lectura**, responde únicamente con lo que el rol de la cuenta ya puede ver en el panel y usa OpenAI para *interpretar* la pregunta y *redactar* la respuesta, nunca para acceder a la base. Código: `asistente.catalogo.ts` (herramientas), `asistente.consulta.ts` (reglas puras), `asistente.consulta.service.ts` (orquestación). Pruebas: `backend/test/asistente-consulta.test.ts`.

### 12.1 Chatbot público frente a asistente administrativo

| | Chatbot público | HORUS Assistant (resumen y consultas) |
| --- | --- | --- |
| Quién pregunta | Un visitante anónimo | Una persona del personal, con sesión y rol |
| Sobre qué | Contenido **publicado** (cursos, servicios, preguntas frecuentes) | Cifras **internas** de la operación (mensajes, cotizaciones, preinscripciones, sesiones, certificación) |
| Ruta | `POST /api/chatbot/*` (pública, cuota por IP) | `POST /api/admin/asistente/consultar` y `GET /api/admin/asistente/resumen` (JWT + rol) |
| Permisos | No hay: todo es público | El rol vigente decide qué áreas existen para la cuenta |
| Puede escribir | Registrar un contacto o preinscripción si el visitante lo confirma | **Nunca** |
| Datos personales | Los que el visitante entrega voluntariamente | **Ninguno** viaja a OpenAI ni se devuelve |

Comparten solo la **clave y la API** de OpenAI (misma configuración y mismo cliente, `AsistenteExplainer`, que usa el asistente).

### 12.2 Cómo se interpreta una pregunta (cuatro pasos)

```
Pregunta ─► NestJS: sesión, rol VIGENTE desde la base, límites, filtro de datos personales
              │ catálogo de herramientas = solo las del rol
              ▼
        OpenAI (paso 1, «selector»): recibe PREGUNTA + CATALOGO.
              │ Responde un JSON {estado, herramientas:[{id, parametros}]}. No ve ningún dato.
              ▼
        NestJS valida la elección: lo que no esté en el catálogo del rol NO se ejecuta
              │ consultas fijas y de solo lectura (asistente.data.ts) ─► conteos
              ▼
        OpenAI (paso 2, «redactor»): recibe PREGUNTA + cifras ya calculadas. Redacta ≤120 palabras.
              │
        NestJS: descarta el texto si menciona un número que no esté en las cifras (o un enlace/correo)
              ▼
        Respuesta = texto + datos exactos + fuentes + fecha/hora
```

1. **Identificación y permisos (NestJS).** `JwtAuthGuard` y `AccessGuard` validan la sesión. El servicio lee el **rol vigente de MySQL** (nunca del token, de la pregunta ni del cuerpo). Sin rol → 403; inactiva → 401.
2. **Elección de herramientas (OpenAI).** El modelo recibe la pregunta y el **catálogo del rol** (id, descripción y parámetros permitidos). Responde qué herramientas usar, o que la pregunta está *fuera de alcance* o es *ambigua*.
3. **Ejecución (NestJS).** `parsePlan` comprueba que cada id exista **y** esté en el catálogo del rol; los parámetros fuera de la lista se reemplazan por su valor por defecto; un id inventado invalida toda la elección (503). Las herramientas prohibidas jamás se ejecutan, diga lo que diga el modelo o la pregunta.
4. **Redacción (OpenAI) y verificación (NestJS).** El modelo recibe solo cifras y etiquetas fijas. Si su texto contiene un número que no está en esas cifras, un enlace, un correo o supera 1200 caracteres, se descarta (503); nunca se muestra una respuesta de IA no verificada.

### 12.3 Catálogo de herramientas y permisos

Cada herramienta hereda los permisos de lectura de la sección del resumen v1 (`SECTION_PERMISSIONS` en `asistente.rules.ts`); no hay matriz paralela ni permisos nuevos. Una herramienta **existe** para un rol solo si el rol puede leer todas sus secciones.

| Herramienta | Responde, por ejemplo… | Gerente | Coordinación | Secretaría |
| --- | --- | :-: | :-: | :-: |
| `pendientes` | «¿Qué tengo pendiente hoy?», «¿Qué debería priorizar?» | ✔ | ✔ | ✔ (sus áreas) |
| `mensajes` | «¿Cuántas solicitudes de clientes recibimos hoy?» | ✔ | ✔ | ✔ |
| `chatbot` | «¿Cuántas preguntas del chatbot quedaron sin respuesta?» | ✔ | ✔ | ✔ |
| `cotizaciones` | «¿Hay cotizaciones sin atender?» | ✔ | ✔ | — |
| `preinscripciones` | «¿Qué preinscripciones necesitan revisión?» | ✔ | ✔ | ✔ |
| `ediciones` | «¿Cuántas ediciones están abiertas?» | ✔ | ✔ | ✔ |
| `sesiones` (`periodo`: `hoy` o `semana`) | «¿Qué sesiones están programadas esta semana?» | ✔ | ✔ | — |
| `matriculas` | «¿Cuántas matrículas faltan por confirmar?» | ✔ | ✔ | ✔ |
| `certificados` | «¿Cuántos estudiantes están pendientes de certificación?» | ✔ | ✔ | — |

«Esta semana» es la semana de calendario de Lima, de lunes a domingo. Todas las herramientas devuelven **conteos** (la de sesiones añade las programadas por día); ninguna devuelve nombres, correos, teléfonos, DNI, docentes, mensajes ni notas.

### 12.4 Lo que NO responde

- Datos de personas concretas («¿Qué escribió Ana?»): el sistema responde con cifras. Si la pregunta incluye un correo, un teléfono o un número de 7 o más dígitos (DNI, cuentas), se rechaza con 400 **antes** de llamar a OpenAI.
- Acciones (crear, editar, enviar, validar, emitir, anular, borrar): el asistente no escribe. Indica que se haga desde el panel.
- Información de áreas que el rol no ve: respuesta `sin_permiso`, sin cifras ni nombres de esas áreas en lo enviado a OpenAI.
- Datos que el sistema no registra (`no_registrado`): tiempos de respuesta, personas únicas del chatbot, asistencia y calificaciones, pagos y ventas, visitas al sitio. No se estiman.
- Preguntas muy vagas: `aclaracion`, con ejemplos adecuados al rol.
- Series históricas o comparaciones (solo existen cifras de «hoy», «esta semana» o el estado actual).

### 12.5 Contrato para el panel (frontend)

**Endpoint:** `POST /api/admin/asistente/consultar` · **Autenticación:** `Authorization: Bearer <JWT>` (la misma sesión del panel) · **Cuerpo:** `Content-Type: application/json`.

```json
{ "pregunta": "¿Cuántas solicitudes de clientes recibimos hoy?" }
```

| Campo | Regla |
| --- | --- |
| `pregunta` | Texto, obligatorio, se recortan los espacios, de 1 a **300** caracteres. Sin correos ni números de 7 o más dígitos. No se admiten otros campos (`rol`, `herramientas`… → 400). |

Responde **200** (no 201). El campo `estado` indica qué ocurrió:

| `estado` | Significado | `respuesta.origen` | `datos` |
| --- | --- | --- | --- |
| `respondida` | Se consultó y la IA redactó con las cifras | `ia` (con `modelo`) | herramientas con sus hechos |
| `fuera_de_alcance` | Acción, datos personales, dato no registrado u otro tema | `sistema` | `[]` (más `no_registrado[]`) |
| `sin_permiso` | Pidió información de un área que el rol no ve | `sistema` | `[]` |
| `aclaracion` | Pregunta demasiado vaga | `sistema` | `[]` |
| `sin_datos` | Las áreas pedidas no se pudieron consultar | `sistema` | herramientas con `estado: "no_disponible"` |

Ejemplo de **200 / `respondida`** (cifras ficticias):

```json
{
  "ok": true,
  "estado": "respondida",
  "generado_en": "2026-10-22T14:00:00.000Z",
  "zona_horaria": "America/Lima",
  "fecha_operativa": "2026-10-22",
  "acceso": { "rol": "SECRETARIA", "permisos_efectivos": 18, "secciones_autorizadas": ["atencion", "chatbot", "preinscripciones", "aperturas", "ediciones", "matriculas"] },
  "respuesta": { "texto": "Hoy se registraron 5 consultas de clientes, de 4 personas distintas.", "origen": "ia", "modelo": "<modelo configurado>" },
  "datos": [
    {
      "herramienta": "mensajes", "titulo": "Mensajes y solicitudes de clientes", "estado": "ok", "parametros": {},
      "hechos": [
        { "id": "recibidos_hoy", "etiqueta": "Consultas de clientes registradas hoy", "valor": 5 },
        { "id": "personas_hoy", "etiqueta": "Personas distintas (correos) que escribieron hoy", "valor": 4 }
      ]
    }
  ],
  "fuentes": [
    { "seccion": "atencion", "tablas": ["contactos", "attention_records"], "estado": "ok", "consultado_en": "2026-10-22T14:00:00.000Z",
      "ventana": { "tipo": "hoy_y_estado_actual", "fecha": "2026-10-22", "desde_utc": "2026-10-22T05:00:00.000Z", "hasta_utc": "2026-10-23T05:00:00.000Z" } }
  ],
  "avisos": [],
  "sugerencias": [],
  "alcance": "solo_lectura"
}
```

(`permisos_efectivos` es el número de permisos del rol y solo es informativo.)

Notas para la interfaz:

- **Mostrar `respuesta.texto` y, junto a él, `datos[].hechos`**: los hechos son la verdad numérica; el texto es una redacción verificada de esas cifras. Cada hecho puede traer `severidad` (`alta`, `media`, `info`) y `puede_actuar` (herramienta `pendientes`).
- `fuentes[].consultado_en` y `generado_en` (UTC) indican **desde cuándo son los datos**; `fecha_operativa` y `zona_horaria` son el día de Lima. Para «esta semana» la fuente `sesiones_semana` trae `ventana.desde` y `ventana.hasta`.
- `avisos[]` se muestra si existe (parte omitida por permisos, áreas incompletas). `sugerencias[]` trae preguntas de ejemplo del rol cuando no hay respuesta (`fuera_de_alcance`, `sin_permiso`, `aclaracion`).
- Es una **consulta**, no una conversación: no hay historial; cada pregunta es independiente.
- Bloquear el botón mientras se espera y mostrar un estado de carga: una consulta puede tardar varios segundos (hasta dos llamadas a OpenAI, de 10 y 12 s como máximo).

**Errores** (siempre `{ "ok": false, … }`):

| Código | Cuándo | Cuerpo / acción |
| --- | --- | --- |
| **400** | Pregunta vacía, de más de 300 caracteres, no textual, con campos extra, o con datos personales | Validación estándar de NestJS; con datos personales: `{ "codigo": "datos_personales", "mensaje": "…" }`. Pedir que la reformule. |
| **401** | Sin token, token vencido, cuenta inactiva | Cerrar sesión como en el resto del panel. |
| **403** | Cuenta sin rol | `mensaje`: «Esta función requiere permisos adicionales…». |
| **429** | Tope por cuenta (10 consultas cada 10 min; 100 al día), tope global de IA (300 por hora y por instancia) o tope por IP (20 por minuto, 150 por hora) | Por cuenta: `{ "codigo": "limite_de_uso", "reintentar_en_segundos": n }`. Por IP: `mensaje` «Has enviado varias solicitudes…». Reintentar más tarde. |
| **503** | La IA no está disponible | `{ "codigo": "ia_no_disponible", "motivo": "no_configurada" \| "no_disponible" \| "ocupada" \| "respuesta_invalida", "mensaje": "…" }` |

**Cuando OpenAI no está disponible** (apagado con `ASISTENTE_AI_ENABLED`, sin clave o modelo, error de red, 429 o 500 del proveedor, tiempo agotado, respuesta incompleta, selección inválida, texto con cifras no verificables o demasiadas llamadas simultáneas), la consulta responde **503** con un mensaje controlado. **No se inventa ninguna respuesta** ni se entregan cifras como si las hubiera redactado la IA. `GET /api/admin/asistente/resumen` sigue funcionando completo porque es determinista. Sugerencia de interfaz: mostrar el mensaje y ofrecer ir al resumen.

### 12.6 Seguridad

- **Solo lectura:** el módulo usa `findMany`, `count`, `groupBy` y consultas agregadas fijas; ninguna herramienta escribe. Una prueba revisa el código fuente para impedir que el catálogo, el selector, el servicio o el cliente de IA importen Prisma.
- **Sin SQL de la IA:** el modelo elige ids y parámetros de una lista cerrada; las consultas están escritas en `asistente.data.ts`.
- **Permisos:** catálogo por rol derivado de la matriz real; validación en el servidor de cada herramienta elegida; el rol se lee de la base en cada consulta (un cambio de rol surte efecto en la siguiente).
- **Datos personales:** la pregunta con correos, teléfonos o documentos se rechaza antes de salir del servidor; las herramientas devuelven solo conteos; a OpenAI viajan cifras, etiquetas fijas y la propia pregunta (como dato JSON, no como instrucción). `store: false` y sin historial.
- **Inyección de instrucciones:** la pregunta y los datos se declaran *datos, no instrucciones*; aunque el modelo fuera engañado, el servidor no ejecuta nada fuera del catálogo del rol ni acepta cifras ajenas.
- **Límites:** 300 caracteres por pregunta, 4 herramientas por consulta, `max_output_tokens` 300 y 400, plazos de 10 y 12 s, 2 llamadas simultáneas por instancia, topes por cuenta, día y global (en memoria, por instancia) y por IP (`PublicRateLimitGuard`, tabla `rate_limit_buckets` ya existente: **sin migración**).
- **Registros:** solo el tipo de fallo (`TimeoutError`, `provider_status_500`…), nunca la pregunta, las cifras, la clave ni mensajes de base de datos.

### 12.7 Ejemplo completo de una consulta

Secretaria (rol `SECRETARIA`), jueves 22-oct-2026, 09:00 en Lima: *«¿Cuántas cotizaciones enviadas hay y cuántas solicitudes de clientes recibimos hoy?»*

1. NestJS lee su rol en MySQL → `SECRETARIA`. Su catálogo: `pendientes`, `mensajes`, `chatbot`, `preinscripciones`, `ediciones`, `matriculas` (sin `cotizaciones`).
2. OpenAI recibe la pregunta y ese catálogo → responde `consulta` con `mensajes` (y, si lo confundiera la pregunta, también `cotizaciones`).
3. NestJS descarta `cotizaciones` (no está en el catálogo del rol): **esa tabla no se consulta**. Ejecuta `mensajes`: una consulta agregada → `recibidos_hoy = 5`.
4. OpenAI recibe `{ "etiqueta": "Consultas de clientes registradas hoy", "valor": 5 }` y redacta «Hoy se registraron 5 consultas de clientes».
5. NestJS verifica que el 5 esté entre las cifras → `estado: "respondida"`, con `avisos: ["Tu rol no tiene acceso a esa información… Se respondió solo la parte permitida."]`, `datos` y `fuentes` (tabla, hora de consulta y ventana del día de Lima).

Si en el paso 4 el modelo hubiera escrito «123 consultas», el servidor lo descarta y la persona recibe un 503 `respuesta_invalida`, no una cifra inventada.

### 12.8 Configuración

Sin variables nuevas. Se reutilizan `ASISTENTE_AI_ENABLED=true`, `OPENAI_API_KEY` y `ASISTENTE_MODEL` (o `CHATBOT_MODEL`). Con el interruptor apagado el resumen v1 funciona y las consultas responden 503 `no_configurada`. No se modificó `.env` ni `.env.example`, ni se creó ninguna migración.

### 12.9 Limitaciones conocidas

- Los topes por cuenta, día y global están en **memoria por instancia** (con varias instancias se multiplican); el tope por IP sí es compartido (MySQL).
- Cada consulta cuesta hasta **dos** llamadas a OpenAI.
- La verificación comprueba que cada **número** del texto esté entre las cifras entregadas; no puede garantizar que el modelo asocie bien cada cifra con su etiqueta. Por eso la interfaz debe mostrar siempre `datos` junto al texto. Los números escritos con letras («cinco») no se verifican.
- «Hoy» y «esta semana» son los únicos periodos; no hay series históricas.
- Probado con dobles en memoria; **no se ejecutó contra MySQL ni OpenAI reales** (ver §11).

## 13. Pendientes para próximas versiones

- ~~Consultas en lenguaje natural~~ — **hecho en la v2** (sección 12): catálogo cerrado de herramientas, la IA solo elige una herramienta y parámetros validados, y cada una ejecuta una consulta ya escrita y autorizada por permiso. Nunca SQL generado.
- Historial de conversación y preguntas de seguimiento («¿y ayer?»), series históricas.
- Herramientas por curso o por edición, y límite compartido entre instancias para las consultas.
- Pantalla en el panel (el frontend no se modificó).
- Límite compartido entre instancias; caché breve del resumen.
- Plazos de respuesta de atención (requiere definir la métrica).
- Resumen por responsable (hoy el seguimiento guarda `responsable` como texto libre).

## 14. Guion para el jurado del resumen v1 (2 minutos)

1. **Problema.** «El personal entra al panel y tiene que revisar mensajes, cotizaciones, preinscripciones, sesiones y certificados por separado para saber qué hacer.»
2. **Solución.** «HORUS Assistant reúne esos datos reales y dice qué atender primero, según el rol de cada persona.»
3. **Demostración.** La secretaria ve mensajes, preinscripciones y matrículas; la gerente ve además cotizaciones, sesiones y certificados. «La secretaria ni siquiera recibe cifras de lo que no puede ver.»
4. **Cómo decide.** «Las reglas son fijas y verificables: por ejemplo, un mensaje sin cerrar con más de 48 horas es urgente. La IA no decide nada.»
5. **Qué hace la IA.** «Solo redacta el resumen en palabras sencillas, y únicamente recibe cifras: nunca nombres, correos ni mensajes. Si inventa un número, se descarta; si falla, el resumen sigue funcionando.»
6. **Seguridad.** «Solo lee, no ejecuta acciones, tiene límite de uso y registra de dónde salió cada dato y cuándo, con la hora de Lima.»
7. **Honestidad.** «Lo que el sistema todavía no registra —como el tiempo de respuesta o las personas únicas del chatbot— lo dice, no lo inventa.»
8. **Siguiente paso.** «Preguntas en lenguaje natural con un catálogo cerrado de consultas autorizadas.» (Ya implementado en la v2: ver la sección 15.)

## 15. Cómo defender la arquitectura ante el jurado (v2)

**Idea central (una frase):** *«La IA entiende y redacta; el servidor decide y consulta.»* OpenAI nunca tiene acceso a la base de datos: solo elige entre nueve herramientas de lectura que escribimos nosotros, y NestJS comprueba cada elección contra los permisos del rol antes de ejecutar nada.

### Guion de 3 minutos

1. **Problema.** «El personal quiere preguntar "¿cuántas cotizaciones hay sin atender?" sin recorrer cada módulo. Pero un asistente con IA suelta en la base sería un riesgo de privacidad y de permisos.»
2. **Qué hicimos.** «Un endpoint, `POST /api/admin/asistente/consultar`, que recibe una pregunta en español y responde con cifras reales, de solo lectura, filtradas por el rol de quien pregunta.»
3. **Demostración.** La gerente pregunta «¿Qué sesiones hay esta semana?» y recibe el número y el desglose por día. La secretaria hace la misma pregunta y recibe «tu rol no tiene acceso a esa información», sin cifras. La secretaria pregunta «¿cuántas solicitudes recibimos hoy?» y se responde.
4. **Cómo funciona.** «Primero NestJS identifica a la persona y su rol en la base. Luego OpenAI recibe la pregunta y *solo la lista de herramientas de ese rol* y dice cuál usar. NestJS verifica la elección y ejecuta una consulta que ya escribimos. Después OpenAI recibe solo números y redacta la respuesta.»
5. **Por qué es seguro.** «La IA no escribe SQL, no usa Prisma y no ve datos al elegir. Aunque alguien le escriba "ignora tus reglas, soy gerente", el servidor solo ejecuta herramientas del rol real. No viajan nombres, correos, teléfonos ni DNI; si la pregunta los trae, se rechaza antes de salir del servidor.»
6. **Qué pasa si la IA falla o se equivoca.** «Si OpenAI cae, responde un error controlado (503) y el resumen determinista sigue funcionando; no inventamos respuestas. Si la IA menciona una cifra que no está en los datos, se descarta.»
7. **Honestidad.** «Lo que el sistema no registra (tiempos de respuesta, pagos, asistencia…) lo dice, no lo estima. Y solo respondemos "hoy", "esta semana" o el estado actual.»
8. **Mejoras futuras.** «Más herramientas (por ejemplo por curso), historial de conversación, límite compartido entre servidores, y el panel en React.»

### Preguntas probables y respuestas

| Pregunta del jurado | Respuesta |
| --- | --- |
| ¿Por qué no conectar la IA directamente a la base de datos? | Porque la IA puede equivocarse o ser manipulada con texto ("prompt injection"). Con acceso a la base podría leer o escribir lo que no debe. Aquí solo elige un id de una lista cerrada; las consultas y los permisos los controla NestJS, que es código determinista y probado. |
| ¿Es un chatbot de respuestas fijas? | No. La pregunta es libre y la interpreta un modelo de lenguaje, que también redacta la respuesta. Lo fijo es lo que *puede consultar* (el catálogo), no lo que *puede decir*. Esa separación es deliberada: flexibilidad en el lenguaje, rigidez en los datos. |
| ¿Cómo evitan que la secretaria vea información de gerencia? | Tres capas: (1) el catálogo que recibe la IA ya excluye esas herramientas; (2) NestJS rechaza cualquier herramienta fuera del catálogo del rol, aunque la IA la nombre; (3) las consultas solo se ejecutan para secciones autorizadas por la matriz de permisos real. Hay pruebas automáticas de cada capa. |
| ¿Y si el usuario pide "ignora las reglas"? | La pregunta se envía como dato, no como instrucción, y aunque el modelo obedeciera, el servidor no ejecuta nada que el rol no tenga. Probado con intentos de saltar roles. |
| ¿Qué datos salen hacia OpenAI? | La pregunta (sin datos personales: se rechaza si los trae), el catálogo del rol y cifras agregadas con etiquetas fijas. Nunca nombres, correos, teléfonos, DNI, mensajes ni notas. La llamada no guarda historial (`store: false`). |
| ¿Y si la IA da un número equivocado? | Se verifica que cada número del texto exista en los datos entregados; si no, se descarta. Además la interfaz muestra los datos exactos junto al texto, de modo que la persona puede comprobarlo. |
| ¿Qué pasa si OpenAI no está disponible? | Error 503 controlado y mensaje claro; el resumen del día (determinista) sigue funcionando. No se simula una respuesta de IA. |
| ¿Puede modificar datos? | No. No existe ninguna herramienta de escritura, y una prueba verifica que el código del asistente no importa Prisma ni usa operaciones de escritura. |
| ¿Cuánto cuesta y cómo se controla? | Cada consulta usa hasta dos llamadas cortas. Hay tope por cuenta (10 cada 10 minutos y 100 al día), tope global por hora, tope por IP en la base compartida, longitud máxima de la pregunta y de la respuesta, y un plazo por llamada. |
| ¿Por qué dos llamadas a OpenAI? | La primera decide *qué consultar* sin ver datos; la segunda *explica los datos* sin poder consultar nada. Separar los dos papeles reduce lo que cada llamada puede hacer mal. |
| ¿Se probó con la base y OpenAI reales? | Las pruebas automáticas usan dobles en memoria, por seguridad y repetibilidad (no se contacta OpenAI ni MySQL). Antes de una demostración real conviene una prueba manual con `ASISTENTE_AI_ENABLED=true` y cifras conocidas. |
