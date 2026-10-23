# Guía para conectar la comprobación de duplicados en React

Para el compañero de frontend. Sustituye la detección local de duplicados (`findPossibleDuplicates`) por el endpoint del servidor. El detalle completo está en `contrato-etapa-4a2-mensajes.md`, sección 1 bis; esto es la parte accionable.

**Estado del backend:** implementado y comprobado contra **MySQL 8.0.46 real** (clon aislado) el 22/10/2026, commit `f43541f`. Pendiente de desplegar. **No cambies React hasta que el endpoint esté desplegado**, o el diálogo se quedará sin comprobación.

## 1. El endpoint

| | |
| --- | --- |
| **Ruta** | `POST /api/admin/messages/duplicados` |
| **Método** | `POST` (es una **lectura**: el correo y el texto van en el cuerpo, no en la URL) |
| **Autenticación** | `Authorization: Bearer <token>` — el mismo token del panel |
| **Permiso** | `mensajes:crear` (Gerencia, Coordinación y Secretaría: los tres roles que pueden registrar una consulta) |
| **Éxito** | `200` (no 201), `Cache-Control: no-store` |
| **Cuota** | **30 comprobaciones por cuenta cada 15 minutos** |

## 2. Campos requeridos

Exactamente estos tres, obligatorios. **Cualquier otro campo da 400** (el servidor usa whitelist estricta), así que filtra el borrador antes de enviarlo: nada de `nombre`, `telefono`, `page`, `limit` ni `vista`.

| Campo | Regla |
| --- | --- |
| `email` | correo válido |
| `asunto` | 1–150 caracteres |
| `mensaje` | 1–5 000 caracteres |

## 3. Ejemplo

**Solicitud**

```ts
const resultado = await panelRequest<{ hayCoincidencias: boolean; cantidad: number }>(
  'messages/duplicados',
  token,
  'POST',
  { email: email.trim(), asunto: asunto.trim(), mensaje: mensaje.trim() },
  signal,
);
```

Equivalente en crudo:

```http
POST /api/admin/messages/duplicados
Authorization: Bearer <token>
Content-Type: application/json

{ "email": "ana@example.test", "asunto": "Matrícula 2026", "mensaje": "Quiero información sobre la matrícula." }
```

**Respuesta 200**

```json
{ "hayCoincidencias": true, "cantidad": 1 }
```

`cantidad` va de 0 a 5 y **5 significa «5 o más»**. No hay campo `ok` en el éxito. No se devuelven identificadores, nombres, correos, teléfonos ni textos: solo el recuento.

## 4. Cuándo comprobar desde React

Mantén el disparador actual: **solo cuando el usuario pulsa «Comprobar»**, después de un registro cuyo resultado quedó incierto (timeout o error de red al guardar). No lo conviertas en automático.

Reglas que no deben perderse:

1. El `POST` de registro **nunca** se repite solo.
2. «Registrar de todos modos» sigue exigiendo confirmación explícita.
3. Conserva el `AbortController` y el `CHECK_TIMEOUT_MS` que ya tiene `checkInbox`.
4. Bloqueo síncrono del botón para evitar dobles envíos.

## 5. Cómo evitar comprobaciones excesivas mientras el usuario escribe

**La respuesta corta: no compruebes mientras escribe.** Con 30 comprobaciones cada 15 minutos, un *debounce* de 500 ms sobre el campo de mensaje agota la cuota en menos de un minuto de redacción normal y deja al usuario con 429 justo cuando de verdad necesita comprobar. La cuota está pensada para pulsaciones deliberadas, no para teclas.

Si aun así el producto pide algo automático, estas tres guardas son obligatorias y van juntas:

1. **Nunca en `onChange`.** Como mucho, una vez al salir del último campo (`onBlur`), y solo si los tres campos están completos y son válidos.
2. **Memoriza lo ya comprobado.** Guarda en memoria los tres valores recortados de la última llamada; si no han cambiado, no vuelvas a llamar y reutiliza el resultado anterior.
3. **Intervalo mínimo** de unos segundos entre llamadas, más el bloqueo síncrono mientras una está en vuelo (cancela la anterior con `AbortController`).

Y nunca guardes el correo ni el teléfono en `localStorage`/`sessionStorage` para estas comparaciones.

## 6. Cómo manejar cada error

**Regla de oro:** solo un `200` con `hayCoincidencias: false` significa «no hay duplicados». **Cualquier otra cosa significa «no pudimos comprobar»**, nunca «no encontramos nada». Si el usuario cree que comprobaste y no lo hiciste, registrará la consulta por duplicado.

| Código | Cuándo | Qué hace React |
| --- | --- | --- |
| **400** | Falta un campo, correo inválido, longitud excedida o se coló un campo extra | Error de programación del cliente. Mensaje genérico. Revisa que envías solo los tres campos. **No gasta cuota.** |
| **401** | Sin sesión, token vencido o inválido | `reportExpiredSession`. **No reintentar.** No gasta cuota. |
| **403** | Sesión sin `mensajes:crear` | `reportAccessDenied`. No gasta cuota. |
| **429** | Más de 30 comprobaciones en 15 min | Cuerpo: `{ ok: false, codigo: 'limite_de_uso', mensaje, reintentar_en_segundos }`. Muestra «Has comprobado demasiadas veces; espera unos minutos» y usa `reintentar_en_segundos` para la cuenta atrás. Estado `error`, **no** «sin duplicados». |
| **503** | Falla **específica** del control de uso compartido (falla cerrada: el servidor no llegó a leer nada) | Cuerpo: `{ ok: false, codigo: 'limite_no_disponible', mensaje }`. Mensaje genérico de reintento. Estado `error`. |
| **500** | Fallo de base de datos **anterior** al limitador — con MySQL completamente caído, el guard de permisos falla antes y sale 500, no 503 | Igual que el 503: mensaje genérico, estado `error`. |
| **5xx / red / timeout / abort** | | Igual que 503: estado `error` («No pudimos comprobar si ya existe esta consulta. Inténtalo de nuevo.»). Nunca declarar ausencia de duplicados. |

**No asumas que todo fallo de base de datos llega como 503.** Solo los del limitador lo hacen; una caída completa de MySQL aparece como 500. Por eso la regla es por exclusión: trata como «sin duplicados» **únicamente** el `200` con `hayCoincidencias: false`, y todo lo demás —incluido cualquier 5xx inesperado— como «no se pudo comprobar».

Ante un fallo de red, **no reintentes automáticamente**: deja que el usuario vuelva a pulsar «Comprobar». Cada intento consume cuota, y un reintento automático en bucle la agotaría sin que él lo sepa.

## 7. Cómo reemplazar la detección local sin perder funcionalidad

En `MessageCreateDialog.checkInbox`:

1. **Quita** la petición `messages?page=1&limit=20&search=<correo>` y la llamada a `findPossibleDuplicates`.
2. **Llama** al endpoint con los tres campos recortados (sección 3).
3. **Retira** `findPossibleDuplicates` y su prueba en `tests/message-export.test.mjs`.
4. **Ajusta el texto** del resultado (ver abajo).
5. En los smokes (`smoke:message-center`, casos 25 y 28) el mock debe atender `POST /admin/messages/duplicados`, y los destinos no locales deben seguir bloqueados **antes** de enviarse.

**Qué se gana:** se comprueban *todas* las consultas de los últimos 7 días, no solo las 20 filas más recientes que contenían el correo — desaparecen los falsos negativos de ese límite. Y deja de viajar el correo en la URL.

**Qué se pierde:** el endpoint no devuelve identificadores, así que **ya no puedes mostrar `#id · asunto · fecha`**. El texto pasa a ser del tipo:

> «Encontramos 1 consulta de los últimos 7 días con el mismo correo, asunto y mensaje.»
> «Encontramos 5 o más consultas…» (cuando `cantidad` es 5)

Si el producto necesita enlazar la consulta encontrada, **pídelo como cambio de contrato del backend** (devolver `id` y `createdAt`) antes de implementarlo: hoy no se puede, y exponerlos requiere revisar privacidad.

## 8. Comportamiento real comprobado en MySQL 8.0.46

Esto es lo que de verdad hace el servidor (verificado contra MySQL real, no contra dobles). Úsalo para decidir los textos de la interfaz.

| Caso | Resultado |
| --- | --- |
| Mismo correo, asunto y mensaje | **Coincide** |
| Todo en MAYÚSCULAS | **Coincide** (no distingue mayúsculas) |
| Espacios al inicio/final, enviados o ya guardados | **Coincide** (se recortan en los dos lados) |
| «Matrícula» contra «Matricula» | **Coincide — MySQL ignora los acentos** |
| «Diseño gráfico» contra «Diseno grafico» | **Coincide** (también la `ñ`) |
| Guardado con **tabulador** o **salto de línea** en los extremos | **No coincide** (el `TRIM` de MySQL solo quita espacios) |
| Hace 6 días | Coincide (dentro de la ventana) |
| Hace 8 días | **No coincide** (ventana de 7 días) |
| 7 filas idénticas | `cantidad: 5` (tope) |
| `%` o `_` en el texto | Caracteres **literales**, no comodines (no se usa `LIKE`) |

**Diferencia importante respecto al algoritmo anterior de React:** React distinguía los acentos y MySQL no. En la práctica es más tolerante, no menos: detecta el duplicado aunque alguien haya reescrito el texto sin tildes. Para el caso de uso real —«¿se llegó a guardar esta consulta?», con el mismo borrador— no cambia nada. Un falso positivo exigiría dos consultas distintas que difieran **solo** en tildes, con correo, asunto y mensaje idénticos en todo lo demás.

## 9. Lista de comprobación

- [ ] El endpoint está **desplegado** antes de tocar React.
- [ ] Se envían **solo** `email`, `asunto` y `mensaje`, recortados.
- [ ] La comprobación se dispara solo al pulsar «Comprobar».
- [ ] 400, 401, 403, 429, 500, 503, red y timeout → estado `error`, nunca «sin duplicados».
- [ ] El 429 muestra `reintentar_en_segundos` y no reintenta solo.
- [ ] Se conservan `AbortController`, timeout y bloqueo síncrono.
- [ ] El texto ya no promete `#id · asunto · fecha`.
- [ ] Los smokes atienden la ruta nueva y bloquean destinos no locales.
