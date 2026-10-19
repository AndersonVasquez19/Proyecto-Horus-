# Correo electrónico de Horus

El backend envía correo mediante `MailService` con dos proveedores, elegidos de forma **explícita** con `MAIL_PROVIDER`:

| Valor | Cuándo usarlo |
|---|---|
| `resend` | Proveedor principal (API HTTPS de Resend). |
| `gmail` | Alternativa (SMTP con contraseña de aplicación). Es el valor por defecto si `MAIL_PROVIDER` no está definido, para no romper instalaciones existentes. |

Un valor distinto impide el arranque. **No hay fallback automático**: si el proveedor elegido falla, el mensaje no se envía por el otro.

## Variables

| Variable | Proveedor | Descripción |
|---|---|---|
| `MAIL_PROVIDER` | ambos | `resend` o `gmail`. |
| `RESEND_API_KEY` | resend | Clave de la API. Solo en variables de entorno del servidor; nunca en el repositorio ni en el frontend. |
| `RESEND_FROM` | resend | Remitente: `correo@dominio` o `Nombre <correo@dominio>`. Debe pertenecer a un dominio verificado en Resend. |
| `MAIL_USER`, `MAIL_PASS` | gmail | Cuenta y contraseña de aplicación. Con `resend` no se exigen. |
| `MAIL_NOTIFY_TO` | ambos (opcional) | Destinatario interno de los avisos de Contacto y la copia oculta de la constancia del Libro de Reclamaciones. Si no se define, se usa el remitente (como antes). |

`backend/.env` no se versiona; `backend/.env.example` solo contiene valores ilustrativos.

## Configurar Resend

```
MAIL_PROVIDER=resend
RESEND_API_KEY=re_...          # desde el panel de Resend
RESEND_FROM="Horus Group <noreply@su-dominio-verificado>"
MAIL_NOTIFY_TO=equipo@su-dominio  # opcional
```

El remitente real siempre es `RESEND_FROM`; los módulos solo aportan el nombre visible (por ejemplo «Horus Group - Reclamaciones»).

### Limitación actual: sin dominio verificado

Mientras no exista un dominio propio verificado en Resend solo puede usarse el remitente de pruebas de Resend (`onboarding@resend.dev`), y Resend únicamente entrega a la dirección del titular de la cuenta. Por tanto **no pueden activarse envíos generales a destinatarios reales** (suscriptores, reclamantes, contactos). Sirve para desarrollo y pruebas controladas dirigidas al titular. Para producción: verificar el dominio (registros SPF y DKIM) y usar un remitente de ese dominio.

## Configurar Gmail

```
MAIL_PROVIDER=gmail
MAIL_USER=cuenta@gmail.com
MAIL_PASS=contraseña_de_aplicación
```

Requiere verificación en dos pasos y una contraseña de aplicación, y que la red permita SMTP (algunos hostings lo bloquean).

## Qué correos envía Horus

| Origen | Contenido |
|---|---|
| Recuperación de contraseña de administradores | Texto con enlace de un solo uso, vence en 30 minutos. Siempre se responde de forma genérica. |
| Contacto web | Aviso interno + confirmación al remitente (HTML). |
| Libro de Reclamaciones | Constancia HTML al reclamante con copia oculta interna. |
| Panel: reenvío de constancias | Contacto: solo la confirmación al visitante. Reclamaciones: la constancia con su copia interna. |
| Panel: seguimiento de consultas | Respuesta en texto al solicitante. |
| Cotizaciones | Cotización en texto al cliente. |
| Newsletter | Confirmación con enlace de baja. |

## Errores y resultados inciertos

`deliver()` informa `accepted`, `failed` o `uncertain`; `sendMail` es el envoltorio booleano (`true` solo si el proveedor **aceptó** el mensaje). Aceptado no significa entregado: Resend confirma la entrega por webhooks, que no están integrados. Los registros distinguen:

- **No enviado**: configuración incompleta, clave inválida, remitente o dominio no autorizado, límite de envío, datos rechazados.
- **Incierto**: tiempo de espera (10 s), red caída, respuesta ilegible, 408 y cualquier 5xx. No se reintenta automáticamente porque podría duplicar el correo.

Los registros solo contienen categorías propias: nunca la clave, el cuerpo de la respuesta ni direcciones de correo. A los usuarios solo llegan los mensajes genéricos ya existentes.

## Despliegue

Solo se necesitan variables de entorno (Railway, Vercel, VPS o Docker Compose); no hay archivos ni servicios adicionales. Resend usa HTTPS saliente (443), por lo que funciona incluso donde SMTP está bloqueado.

## Envíos manuales: resultado, historial y duplicados (D5)

### Resultado estructurado
`MailService.deliver()` devuelve `accepted | failed | uncertain` (con `providerId` opcional y un motivo solo para registros). `sendMail()` sigue existiendo como envoltorio booleano (`accepted → true`) para los consumidores automáticos (recuperación, contacto, libro, newsletter). Los envíos manuales del panel usan `deliver()` y **conservan el estado hasta el consumidor**.

Clasificación: Resend 5xx y 408 → `uncertain` (el proveedor pudo haber aceptado el mensaje antes de fallar); 4xx de configuración, remitente, límite o validación → `failed`. Gmail: rechazo SMTP explícito, `EAUTH`, `EENVELOPE`, fallos de conexión/DNS/TLS previos al envío → `failed`; cualquier corte durante o después de `DATA` y lo desconocido → `uncertain` (`classifyGmailError`). **Un timeout del cliente (navegador) tampoco significa «no enviado».**

### Registro de intentos (sin tablas ni migraciones)
Cada envío manual deja entradas en el `historial` JSON que ya tienen `AttentionRecord` (respuestas y constancias) y `Cotizacion`:

`{ accion, usuario, fecha, correo: { intento, tipo, estado, huella, proveedor_id? } }`, con `estado` = `iniciado | aceptado | fallido | incierto`. El estado vigente es el de la última entrada de ese `intento`. `intento` es un UUID aleatorio sin significado; `huella` es un hash truncado de recurso + id + destinatario + contenido (sirve para saber si el contenido o el destinatario cambiaron, no permite reconstruirlos). **No se guardan destinatarios, textos, tokens ni claves.**

Flujo: **1) reclamar** (transacción corta, sin red dentro): bajo `revision` (compare-and-swap) y, en consultas, bajo el bloqueo de la fila de origen, se anota `iniciado` y se sube la revisión; **2) enviar** (fuera de la transacción); **3) registrar** el desenlace en otra transacción corta, con hasta 3 intentos de *registro* (nunca de envío). Cada escritura sube `revision`, así que un guardado simultáneo de otra persona no pierde el historial ni se pisa.

### Cómo se bloquean los duplicados
- Dos peticiones simultáneas: solo una consigue el reclamo; la otra recibe 409 sin llegar al proveedor.
- Con un intento previo del mismo contenido y destinatario en estado `iniciado` (sin resultado), `aceptado` o `incierto`, el servidor responde 409 `{ envio: 'bloqueado', motivo, requiere_confirmacion: true }` y **exige `confirmar_reenvio: true`**. Solo un `fallido` confirmado permite reintentar sin confirmar.
- Nunca hay reintentos automáticos ni se desbloquea por el paso del tiempo.
- Un contenido o destinatario nuevo es otro envío lógico y no hereda el bloqueo.
- Aun si el navegador repite solo un POST cuyo socket se cortó, la revisión ya subió y el servidor responde 409 sin enviar de nuevo (verificado en `npm run smoke:mail-attempts`).

### Respuestas HTTP de los endpoints manuales
`POST seguimiento/:recurso/:id/correo`, `POST seguimiento/:recurso/:id/constancia`, `POST cotizaciones/:id/correo`. Cuerpo opcional `confirmar_reenvio`.

| Caso | HTTP | Cuerpo |
|---|---|---|
| Aceptado | 200 | `{ ok: true, envio: 'aceptado', mensaje, intento, registrado, item, revision }` |
| Fallido | 503 | `{ ok: false, envio: 'fallido', mensaje, … }` |
| Incierto | 502 | `{ ok: false, envio: 'incierto', mensaje, … }` |
| Bloqueado | 409 | `{ ok: false, envio: 'bloqueado', motivo: 'en_curso' \| 'ya_aceptado' \| 'incierto', requiere_confirmacion: true, mensaje }` |
| Revisión obsoleta | 409 | mensaje de conflicto (sin `envio`) |

`item` es el registro actualizado (con `envios`: último estado de la respuesta y de la constancia, derivado del historial). Si el resultado no pudo registrarse, `registrado: false` y el intento queda `iniciado`: seguirá exigiendo confirmación. Las cotizaciones **no cambian `estado`** al enviarse (pasar de borrador a enviada sigue siendo una acción aparte) ni sus importes o contenido.

### Reenvío de constancia (decisión «Opción A»)
- **Contacto web:** «Reenviar constancia / notificación» reenvía **solo la confirmación al visitante**; el aviso interno no se repite. El alta original conserva su comportamiento (aviso interno + confirmación).
- **Libro de Reclamaciones:** es un único correo —la constancia al reclamante con copia oculta interna—; no se puede dividir sin cambiar la constancia, así que el reenvío manual incluye esa copia interna. Es una diferencia consciente respecto a contactos.

### Recuperación de contraseña
- Límite por IP del endpoint (existente) **más** límite por cuenta: 3 solicitudes por correo normalizado cada 15 minutos (`RecoveryThrottle`: clave hash SHA-256, mapa acotado a 5000 claves, en memoria de cada instancia). Se cuentan también las solicitudes a cuentas inexistentes; al superarlo solo se **omite el envío** y la respuesta es idéntica.
- Se conserva el tope de 20 envíos simultáneos con aviso genérico en el registro. En `VERCEL=1` el envío se espera antes de responder (no hay ejecución tras responder): la respuesta de una cuenta activa puede tardar más que la de una inexistente. Es una limitación conocida; no se cambia sin una cola externa.
- Solo las solicitudes **permitidas** cuentan para el límite: las bloqueadas no prolongan la ventana, así que repetirlas no mantiene la cuenta bloqueada. Al alcanzar las 5000 claves se descartan primero las ventanas vencidas y después las más antiguas; un atacante con miles de correos distintos podría expulsar el contador de una cuenta (el límite por IP sigue activo). No hay garantías distribuidas: cada instancia lleva su propio contador y se reinicia con el proceso.
- El frontend conserva el token solo en memoria y lo retira de la URL (`replace`) cuando ya no sirve (contraseña actualizada o enlace inválido definitivo). No se guarda en `localStorage`/`sessionStorage`.

### Garantías y límites (importante)
- **Garantiza:** que la concurrencia sobre una misma base de datos no envíe dos veces el mismo contenido, y que un reintento manual sobre un intento ya registrado exija confirmación.
- **No garantiza idempotencia absoluta.** Si el backend cae después de que el proveedor acepta y antes de registrar el resultado, el intento queda `iniciado`: la próxima vez pedirá confirmación, pero el correo ya pudo salir. Si cae *antes* de reclamar, no queda rastro y el envío puede repetirse con seguridad.
- **Reinicio o dos instancias de NestJS:** el reclamo vive en la base de datos, así que protege entre instancias; el límite de recuperación por cuenta y el tope de 20 envíos son **en memoria** y por instancia (con N instancias el límite efectivo es N veces mayor).
- **Sin cola persistente:** un envío en curso no se reanuda tras un reinicio. Los correos automáticos (contacto, libro, recuperación) pueden perderse si el proceso cae justo después de responder.
- **Aceptado ≠ entregado.** Sin webhooks de Resend no se sabe si llegó a la bandeja ni si rebotó.
- **`Idempotency-Key` de Resend: no verificado.** No se usa porque no se confirmó en la documentación oficial vigente su comportamiento (ventana, formato, reintentos); si se confirma, permitiría reintentar un envío incierto sin duplicado dentro de su ventana. Pendiente de revisión manual.
- **Requiere un entorno MySQL aislado (no se hizo):** el bloqueo real `SELECT … FOR UPDATE`, la serialización con transacciones concurrentes reales y el comportamiento de `revision` con el motor real. Las pruebas actuales simulan Prisma en memoria.

## Pruebas y aislamiento de secretos
- `npm test` precarga `test/isolate-env.cjs`. Importar `@prisma/client` carga `backend/.env` en `process.env`; la precarga fuerza esa carga y elimina las variables que aporta, de modo que las pruebas nunca ven credenciales reales.
- Las pruebas de correo usan una configuración ficticia propia (no `ConfigService`, que también lee `process.env`), bloquean `fetch` por defecto y comprueban con mensajes fijos —sin imprimir valores— que el entorno está limpio.
- Para ejecutar un archivo suelto: `node --test -r ./test/isolate-env.cjs -r ts-node/register test/mail-providers.test.ts`.
