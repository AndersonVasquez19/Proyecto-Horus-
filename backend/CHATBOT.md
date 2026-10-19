# Asistente Horus

## Uso

Inicia backend y frontend con sus comandos habituales (`npm run start:dev` y `npm run dev`).
El botón «Pregúntale a Horus» aparece en las páginas públicas, no en administración.
Publica cursos, servicios o preguntas frecuentes desde el panel para alimentar las respuestas.
Sin registros publicados, el asistente informa que no encontró información.

## Cómo busca y responde

Recupera contenido por palabras clave en MySQL y ordena por relevancia en memoria (`chatbot-search.ts`, funciones puras con pruebas). No usa embeddings ni entrenamiento adicional.
Consulta en cada petición, por lo que los cambios publicados y el archivado se reflejan en la siguiente consulta. No utiliza los textos estáticos de las páginas públicas.

- **Fuentes (solo publicadas):** cursos y capacitaciones (`estado=publicado`), servicios (`publicado`), preguntas frecuentes (`publicado`), convenios (`visible`) y las claves
  institucionales públicas de contacto cuando se pide teléfono, correo, dirección u horario. Borradores y archivados nunca se leen. De cada curso se usan los datos que ya publica
  la API pública (descripción, tipo, modalidad, duración, área, certificación, fecha, temario); los campos vacíos se omiten, no se rellenan.
- **Interpretación:** se normalizan tildes y mayúsculas, se reducen plurales («redes» → «red») y se descartan palabras vacías. Las palabras que solo indican la clase de contenido
  («cursos», «servicios», «convenios», «teléfono»…) fijan la intención pero no cuentan como tema. Un conjunto corto de sinónimos del propio negocio (cámaras/videovigilancia/CCTV,
  red/cableado/wifi, soporte/mantenimiento/reparación, asesoría/asesoramiento, certificado/constancia, virtual/online…) amplía la búsqueda. Los términos de hasta 3 letras exigen
  la palabra exacta («red» no coincide con «reducir»).
- **Relevancia:** el título pesa más que el cuerpo; una fuente solo se considera respuesta si cubre todos los temas de la pregunta (o el 60 % si es larga). Si la primera búsqueda
  no alcanza, una segunda pasada compara en memoria el catálogo publicado (hasta 60 filas por tabla) tolerando una errata («capacitasion», «kamaras»).
- **Tipos de respuesta (`kind`):** `respuesta`, `listado` («¿qué cursos tienen?» enumera títulos), `parcial` (solo coincide con parte de lo preguntado: se dice y no se presenta como
  respuesta), `sin_informacion`, `aclaracion` (pregunta sin tema, como «información» o «precio»: se pide concretar y no se consulta la base ni se cuenta como sin respuesta) y
  `saludo` (saludo, agradecimiento y despedida). `suggestions` trae preguntas siguientes que el widget muestra como botones.
- **Enlaces:** cada fuente trae `href`, una ruta propia del sitio (curso, capacitación, servicio, preguntas frecuentes, contacto). El widget solo enlaza rutas que empiezan por «/».
  Al proveedor de IA no se envían rutas.
- **Precios:** el catálogo no tiene campo de precio. Si se pregunta por precios y la información encontrada no menciona uno, la respuesta lo dice y remite a la cotización.
- **Seguimientos:** una pregunta como «¿cuánto dura?» hereda el tema del último mensaje del visitante solo si no nombra un tema propio; una pregunta completa nunca hereda el anterior.

## IA opcional

Por defecto funciona sin proveedor externo y muestra extractos del catálogo.
Para respuestas redactadas por IA, copia las variables de `chatbot.env.example` a `backend/.env`:
configura `OPENAI_API_KEY`, un `CHATBOT_MODEL` compatible con Responses API y
`CHATBOT_AI_ENABLED=true`. Reinicia el backend. No uses variables VITE para secretos.

Integración basada en [OpenAI: generación de texto](https://developers.openai.com/api/docs/guides/text).
La petición usa `store: false`; esto no equivale a una garantía de retención cero del proveedor.
Se envían la pregunta, hasta seis mensajes de contexto y hasta cuatro fuentes públicas.
El formulario de contacto no pasa por el modelo. Si el proveedor falla o no está configurado,
la respuesta vuelve al catálogo. La interfaz distingue ambos modos.

## Contacto y datos

«Solicitar atención» abre un formulario editable. Solo al enviarlo con autorización explícita
se guarda un contacto nuevo con prefijo [Chatbot], visible en Panel → Mensajes.
No confirma reservas ni inscripciones y no envía correos. Guarda la autorización en el texto
de la solicitud; no agrega una tabla de consentimientos ni un historial de conversaciones.
La conversación permanece en memoria del navegador hasta recargar o iniciar una nueva. **Única excepción (métricas):** las preguntas que el asistente no puede
responder se guardan redactadas; ver «Métricas y preguntas sin respuesta» y su decisión pendiente.
No se consulta información de administradores, mensajes ni reclamaciones. Solo se leen las claves institucionales públicas conocidas cuando la pregunta solicita contacto, dirección u horarios. Se ocultan patrones de correos, teléfonos y documentos antes de enviar pregunta/historial al proveedor; esto no garantiza anonimato.

## Métricas y preguntas sin respuesta

Cada respuesta del asistente se cuenta en `chatbot_interacciones` (modo `ia` o `catalogo`, si se resolvió y cuántas fuentes usó) **sin guardar el texto del visitante**.
Cuando no hay información publicada (o solo coincide en parte, tipo `parcial`), la pregunta se guarda en `chatbot_preguntas_sin_respuesta` con correos, teléfonos y números largos (también con puntos o barras), fechas numéricas y enlaces ocultos, en una línea,
acotada a 500 caracteres y deduplicada por huella SHA-256 (`veces` cuenta las repeticiones). El historial de la conversación nunca se guarda. Los saludos, agradecimientos y las preguntas que piden aclaración no se registran.
Registrar no espera ni altera la respuesta: si falla, solo se deja una advertencia sin datos. Puedes revisarlas en Panel → Consultas del chatbot (solo lectura; últimos 30 días).

**Limitación importante:** la redacción automática solo reconoce patrones (correos, números, enlaces). **No puede detectar nombres, direcciones, cargos ni datos escritos de forma
libre u ofuscada** («ana arroba gmail»), así que el texto guardado puede contener datos personales. Además, hoy el consentimiento del sitio y el aviso del widget cubren
solo los formularios; el texto libre del chat no pide un consentimiento específico para guardarse.

**Finalidad y retención (decididas por el responsable):** el registro existe únicamente para mejorar los contenidos publicados y las respuestas del asistente. Se conserva
**90 días** desde la última aparición de la pregunta (`RETENTION_DAYS` en `chatbot-privacy.ts`); las métricas de interacción siguen el mismo plazo. La limpieza elimina lo vencido
(`ChatbotMetricsService.purgeExpiredBatches`) y, mientras no se ejecute, la vista del panel
**no muestra** lo anterior a 90 días. El plazo y la finalidad figuran en la política de privacidad (sección «Asistente virtual: preguntas sin respuesta») y en el aviso del widget.
Solo los administradores autenticados ven estos textos. Trata estas tablas como datos personales: no se exportan ni se envían a terceros. Pendiente: un tope de filas si se detecta abuso (hoy limita el guard: 20 consultas por minuto y por IP).

**Migración requerida:** hay que aplicar `npm run db:migrate` (migración `20261009-chatbot-metrics`) antes de iniciar esta versión; la migración añade `contactos.origen` y las dos tablas.

### Limpieza por retención (90 días)

Hay **dos** mecanismos, ambos con el mismo código (`purgeExpiredBatches`):

| Mecanismo | Cuándo se ejecuta | ¿Es automático? |
| --- | --- | --- |
| Oportunista | Al registrar una interacción, como máximo una vez por hora y por instancia, hasta 4 lotes por tabla | Sí, **pero solo si el asistente recibe consultas**. Sin tráfico no limpia |
| Comando `npm run chatbot:purge` | Cuando alguien (o una tarea programada) lo ejecuta, hasta 200 lotes por tabla | **No lo programa el repositorio**: hay que crear la tarea en el entorno real |

**Hasta que alguien programe el comando en Railway (o en el planificador del servidor), no hay una limpieza garantizada ante la falta de tráfico.** La vista del panel sigue sin mostrar lo vencido, pero las filas permanecen en MySQL.

- **Qué borra:** solo filas de `chatbot_preguntas_sin_respuesta` (con `updatedAt` anterior a 90 días) y de `chatbot_interacciones` (con `createdAt` anterior a 90 días). Comparación estricta: una fila con exactamente 90 días se conserva. Nunca toca `contactos` (ni las cotizaciones o consultas que nacen del chatbot), `cotizaciones`, `reclamaciones` ni `attention_records`.
- **Seguridad:** lotes de 500 filas por id; cada borrado vuelve a comprobar la fecha, así que una pregunta que reapareció entre la lectura y el borrado se conserva. Es idempotente y puede solaparse con otra ejecución.
- **Ejecución** (desde `backend/`, tras `npm run build`; en la imagen de producción ya están `dist/` y `scripts/`): `npm run chatbot:purge -- --dry-run` solo cuenta lo vencido y no borra; `npm run chatbot:purge` borra. Usa las variables `DB_*` del entorno; revisa antes que apuntan a la base deseada.
- **Programarlo (decisión del responsable, no configurado):** una tarea diaria que ejecute `npm run chatbot:purge` en el servicio `backend`, con el planificador que elija el responsable en el entorno donde se aloje la API. **No existe hoy ninguna tarea programada** ni hay evidencia de que se haya creado una; tampoco se comprobó qué planificadores ofrece Railway. No se añadió ningún programador ni dependencia nueva.
- **Supervisión:** el comando imprime cuántas preguntas y métricas eliminó y avisa si el límite por ejecución dejó filas pendientes (la siguiente ejecución continúa). Termina con código 0 si funcionó y 1 si falló; la tarea programada debe alertar ante un código distinto de 0 o ante ausencia de ejecuciones. Conviene ejecutar `--dry-run` de vez en cuando: debe dar 0 vencidas tras una ejecución correcta.
- **Ante un fallo:** el comando solo muestra un mensaje genérico (sin trazas ni datos de conexión) y no deja nada a medias: cada lote es independiente y repetirlo es seguro. La limpieza oportunista nunca afecta a la respuesta al visitante (solo deja una advertencia en el log). No hay nada que revertir.
- Las pruebas (`test/chatbot-retention.test.ts`) usan modelos simulados: acreditan la lógica, **no** la ejecución contra MySQL real.

## Solicitar cotización

El widget ofrece «Solicitar cotización» junto a «Solicitar atención del equipo». Usa el mismo formulario con consentimiento explícito y envía `tipo: "cotizacion"`.
Se registra un `Contacto` con `origen=chatbot` y asunto `[Chatbot] [Cotización] …`; desde la bandeja de Mensajes se puede usar «Preparar cotización».
No crea cotizaciones, reservas ni inscripciones ni envía correos.

## Endpoints

- POST /api/chatbot/message: { message, history?: [{ role: user|assistant, content }] }
- POST /api/chatbot/contact: { nombre, email, telefono, asunto, mensaje, consentimiento: true }
  (opcional `tipo`: `contacto` o `cotizacion`)
- GET /api/admin/chatbot/sin-respuesta (administradores): preguntas sin respuesta y métricas de 30 días, paginado

El historial solo sirve como contexto; no es fuente autorizada. Los datos del catálogo y el historial
se delimitan como datos en la petición. Las fuentes se muestran como texto escapado por React.
No se interpretan HTML o enlaces generados por el modelo.

## Límites y alcance

Pregunta: 1000 caracteres; contexto: seis turnos de hasta 4000 caracteres.
Recuperación: hasta 18 candidatos por tabla (60 en la segunda pasada tolerante a erratas), cuatro fuentes por respuesta (seis en un listado).
La búsqueda por palabras solo conoce los sinónimos listados arriba y no garantiza recuperar todo un catálogo extenso.
El sitio dispone de detalles públicos de cursos y servicios. Las fuentes del chatbot se presentan como texto; el menú vuelve a comprobar cada detalle publicado.

Las cuotas públicas por IP (20 consultas y cinco contactos por minuto) y el límite global de 200 peticiones por minuto se comparten en MySQL. El guard del chatbot conserva además su protección local y un máximo de cuatro llamadas simultáneas al proveedor por instancia.
Detrás de proxies se usa la IP que Express resuelve; no se confía directamente en X-Forwarded-For.
La migración de cuotas debe aplicarse antes del arranque de esta versión. Las réplicas comparten las cuotas mediante MySQL; mantener también un presupuesto del proveedor apropiado.

La IA puede equivocarse. Evalúa preguntas reales y revisa los contenidos publicados antes del lanzamiento.
Una fecha publicada no demuestra que la convocatoria siga abierta. Los mensajes originales del
visitante se conservan en el formulario, sin resúmenes automáticos que puedan cambiar su intención.

## Verificación

`npm test` incluye validación de entradas, relevancia con un catálogo ficticio (`test/chatbot-relevance.test.ts`: consultas con tildes, errores, sinónimos, ambiguas y sin respuesta; borradores y archivados excluidos), filtros públicos, falta de información,
respuesta y fallo del proveedor con fetch simulado, consentimiento, límites y endpoints HTTP.
Las pruebas HTTP usan modelos de base de datos simulados; no acreditan persistencia real en MySQL.

Prueba manual con una base local:
1. Publicar un curso y preguntar por su título; revisar «Información consultada».
2. Archivarlo y repetir la consulta: debe dejar de aparecer.
3. Enviar una solicitud desde el formulario y comprobarla en Panel → Mensajes.
4. Detener el backend: la interfaz debe permitir corregir/reintentar y abrir Contacto.
5. Revisar móvil, navegación con Tab, cierre con Escape y nueva conversación.

## Menú guiado
El widget incluye cursos y capacitaciones, servicios tecnológicos y preguntas frecuentes (listas publicadas) y atajos de pregunta para asesoramiento, convenios y contacto; «Solicitar cotización» y «Solicitar atención del equipo» están siempre visibles. Consulta las listas públicas paginadas y vuelve a comprobar el detalle publicado en cada acción. Los botones muestran datos directamente sin llamar a IA. El campo de texto libre sigue disponible; Volver al menú y Nueva conversación permiten reiniciar la navegación. Las solicitudes desde una selección incluyen su título en el formulario editable.
