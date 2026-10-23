# Guía para implementar la página pública de verificación de certificados

> **Documento histórico: funcionalidad retirada (simplificación académica, octubre de 2026).** Los certificados se preparan y entregan de forma presencial,
> fuera de la plataforma. Ya no existen la emisión, anulación y sustitución, las rutas `/api/admin/certificados*`, el PDF con QR, el recurso de permisos
> `certificados:*`, los reportes `certificados` y `pendientes-certificacion`, los indicadores del Resumen ni la herramienta de HORUS Assistant. Se conservan
> las tablas, los datos, la migración y el respaldo/restauración, el **bloqueo de matrículas con un certificado vigente** y, de forma provisional,
> `GET /api/certificados/verificar/:codigo` (solo lectura) porque no se pudo comprobar que no existan certificados emitidos con QR en todos los entornos.
> Lo que sigue describe el diseño anterior y no el comportamiento actual.


Para el responsable del frontend React. Describe el contrato real del endpoint público de verificación y los estados que debe mostrar la página `/verificar/:codigo`, que **todavía no existe**.

Todo lo que sigue está tomado del código del backend (`backend/src/certificados/`, `backend/src/common/public-rate-limit.guard.ts`), no de ejemplos. El detalle del módulo está en `certificados.md`; esto es la parte accionable para React.

**Estado del backend:** implementado. La emisión, la verificación y el QR se comprobaron contra MySQL aislado el 22/10/2026 (ver §10). **Falta configurar `CERTIFICADOS_VERIFICACION_URL`** antes de poder descargar PDF (§9).

## 1. El endpoint

| | |
| --- | --- |
| **Ruta** | `GET /api/certificados/verificar/<CÓDIGO>` |
| **Método** | `GET` — el código va en la ruta, no en el cuerpo ni en la query |
| **Autenticación** | **Ninguna.** Es ruta pública (`@PublicRoute()`): no mandes `Authorization` ni esperes sesión |
| **Éxito** | `200` con `Cache-Control: no-store` |
| **Límite** | 30/min y 200/hora por IP (detalle en §7) |

No uses `panelRequest` ni el cliente del panel: ese adjunta el token y trata el 401 como sesión caducada. Aquí basta un `fetch` directo con `AbortController`.

## 2. El código: formato y normalización

| | |
| --- | --- |
| **Formato aceptado** | `^[A-Z0-9]{16,32}$` **después** de recortar espacios y pasar a mayúsculas |
| **Lo que emite el sistema** | 20 caracteres del alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (100 bits) |
| **Caracteres ausentes a propósito** | `0`, `O`, `1`, `I` — se excluyeron por confundirse al leer o teclear |
| **Entrada de más de 64 caracteres** | Se rechaza sin consultar la base |

El servidor ya normaliza (`trim` + mayúsculas): `abcdefghjklmnpqrstuv` y `ABCDEFGHJKLMNPQRSTUV` dan el mismo resultado. Aun así conviene normalizar también en React, para no gastar cuota en una entrada que el servidor va a rechazar igual.

**Importante:** un código con formato inválido y uno inexistente devuelven **exactamente el mismo 404 con el mismo texto**. Es deliberado: la página no puede distinguirlos ni debe intentarlo.

## 3. Respuesta cuando el certificado está vigente

`200`:

```json
{
  "ok": true,
  "valido": true,
  "estado": "vigente",
  "sustituido": false,
  "estudiante": "Ana Quispe",
  "curso": { "titulo": "Excel Intermedio", "tipo": "curso", "duracion": "20 horas" },
  "convocatoria": { "nombre": "Edición Noviembre 2026", "fecha_inicio": "2026-11-01", "fecha_fin": "2026-11-30" },
  "emitido": "2026-11-30"
}
```

Forma de los campos, tal como los arma `publicView`:

| Campo | Tipo | Notas |
| --- | --- | --- |
| `ok` | `true` | constante en toda respuesta 200 |
| `valido` | `boolean` | **`true` solo si `estado === 'vigente'`** |
| `estado` | `'vigente' \| 'anulado'` | **solo estos dos valores**: es un `ENUM` de MySQL |
| `sustituido` | `boolean` | `true` si otro certificado reemplazó a este |
| `estudiante` | `string` | nombres y apellidos ya unidos en un solo texto |
| `curso.titulo` | `string` | |
| `curso.tipo` | `'curso' \| 'capacitacion'` | |
| `curso.duracion` | `string \| null` | texto libre («20 horas»); **puede ser `null`** |
| `convocatoria.nombre` | `string` | |
| `convocatoria.fecha_inicio` / `fecha_fin` | `string \| null` | `AAAA-MM-DD`; **pueden ser `null`** |
| `emitido` | `string \| null` | `AAAA-MM-DD` |

Los datos son una **copia congelada** al momento de emitir: si el estudiante cambia de nombre después, el certificado sigue mostrando el nombre con el que se emitió.

## 4. Respuesta cuando está anulado o sustituido

Mismo `200` y misma forma. «Sustituido» **no es un estado**: es la combinación de `estado: 'anulado'` con `sustituido: true`.

| Situación | `valido` | `estado` | `sustituido` |
| --- | --- | --- | --- |
| Vigente | `true` | `'vigente'` | `false` |
| Anulado (sin reemplazo) | `false` | `'anulado'` | `false` |
| Anulado **y sustituido** por otro | `false` | `'anulado'` | `true` |

Sustituir siempre anula el certificado anterior dentro de la misma transacción, así que `sustituido: true` llega siempre junto a `estado: 'anulado'`.

**Lo que el contrato NO permite:** el endpoint **no devuelve el código ni ningún identificador del certificado nuevo**. La página puede decir que fue reemplazado, pero **no puede enlazar al sustituto**. Tampoco se devuelve el motivo de la anulación, ni quién la hizo, ni cuándo. No lo inventes ni lo pidas al usuario: si el producto lo necesita, hay que pedirlo como cambio de contrato del backend.

## 5. Código inexistente o con formato incorrecto

`404`, con el formato de error por defecto de NestJS (no hay filtro global de excepciones):

```json
{ "message": "No se encontró un certificado con ese código.", "error": "Not Found", "statusCode": 404 }
```

Idéntico en los dos casos. La página debe mostrar un único mensaje, del tipo «No encontramos un certificado con ese código», sin sugerir si el problema fue el formato: revelar la diferencia ayudaría a quien prueba códigos al azar.

## 6. Errores y estados que React debe manejar

| Código | Cuándo | Qué muestra la página |
| --- | --- | --- |
| **200** `valido: true` | Certificado vigente | Resultado válido (§8) |
| **200** `valido: false` | Anulado, o anulado y sustituido | Resultado **no válido**, con la variante de sustitución |
| **404** | Código inexistente **o** mal formado | «No encontramos un certificado con ese código» |
| **429** | Se superó un límite de frecuencia | Cuerpo `{ ok: false, mensaje }`. Muestra `mensaje` tal cual o uno propio: «Demasiadas consultas; espera un minuto» |
| **503** | El servicio de límites está ocupado (conflicto persistente en la base) | Cuerpo `{ ok: false, mensaje }`. «El servicio está ocupado; inténtalo en unos segundos» |
| **5xx / red / timeout / abort** | | «No pudimos comprobar el certificado. Inténtalo de nuevo» |

**Regla de oro:** un certificado solo se declara válido con un `200` que traiga `valido: true`. **Cualquier otra cosa —incluido un 404— no es «certificado falso», es «no se pudo confirmar».** Un empleador que ve «no válido» por un corte de red puede rechazar a un candidato legítimo: la diferencia entre «no encontrado» y «no se pudo comprobar» importa.

No reintentes automáticamente: cada intento gasta cuota y el usuario puede volver a pulsar. Un reintento en bucle agota las 30 del minuto sin que se entere.

## 7. Límites de frecuencia

Los aplica `PublicRateLimitGuard` sobre `rate_limit_buckets` en MySQL (compartido entre instancias, solo hashes de IP):

| Ámbito | Tope |
| --- | --- |
| Por IP y minuto | **30** |
| Por IP y hora | **200** |
| Por subred (/24 IPv4, /64 IPv6) y minuto | **90** |
| Global de la ruta y minuto | **600** |

Detalles que afectan al diseño de la página:

- Esta ruta tiene **su propio tope global**: no comparte cuota con los formularios públicos ni los agota.
- **Todas** las consultas gastan cuota por igual —válidas, inexistentes y mal formadas—, así que el límite no revela si un código existe.
- Una solicitud rechazada **no** consume cuota ajena.
- Detrás de un proxy, la IP sale de `request.ip` (calculada con `TRUSTED_PROXY_CIDRS`). **Si esa variable no está configurada en el despliegue, todos los visitantes comparten una sola cuota** y la página empezará a dar 429 con muy poco tráfico. Es configuración del despliegue, no del frontend, pero conviene saberlo al diagnosticar.

Por eso: **una consulta por pulsación del usuario**, nunca una por tecla escrita.

## 8. La página `/verificar/:codigo`

### Ruta y acceso

- Ruta pública **`/verificar/:codigo`**, fuera de `AdminRoute` y de cualquier guard de sesión: quien escanea el QR es un empleador, no un usuario del panel.
- Debe funcionar **sin iniciar sesión** y sin que un 401 en otra parte de la aplicación la afecte.
- El código se lee del parámetro de la URL (`useParams`), que es exactamente lo que codifica el QR: `<base configurada>/<CÓDIGO>`.
- Conviene admitir también `/verificar` sin código, con un campo para teclearlo a mano: no todo el mundo puede escanear.

### Estados de la interfaz

1. **Cargando** — indicador visible desde la primera renderización, porque la página se abre directamente desde el QR y no hay nada previo en pantalla. Con `AbortController` y timeout.
2. **Válido** — marca clara de validez, nombre del estudiante, curso (y duración si no es `null`), edición, fechas y fecha de emisión. Omite los campos `null` en lugar de escribir «null» o «—» sin contexto.
3. **Anulado** — aviso inequívoco de que **no es válido**. Sin motivo (el backend no lo entrega).
4. **Sustituido** — igual que anulado, añadiendo que fue reemplazado por otro certificado. **Sin enlace al nuevo**: no se dispone de su código.
5. **No encontrado** — un solo mensaje para código inexistente y mal formado.
6. **Límite alcanzado** (429) — mensaje de esperar, distinto del error genérico.
7. **Error de conexión** (red, timeout, 5xx) — «no se pudo comprobar», **nunca** «no válido», con un botón para reintentar manualmente.

Los estados 3 a 7 son visualmente distintos: 3 y 4 afirman algo sobre el certificado; 5, 6 y 7 afirman algo sobre la consulta.

### Diseño adaptable a celular

El caso de uso principal es alguien de pie, con el teléfono, recién escaneado el QR:

- Diseño pensado primero para móvil, en una sola columna; el resultado debe entenderse **sin desplazar la pantalla**.
- Validez y nombre del estudiante como elementos más prominentes: se comparan con el papel que la persona tiene en la mano.
- Objetivos táctiles amplios para el botón de reintentar.
- No apoyes el significado solo en el color (verde/rojo): acompáñalo de texto y de un icono, para daltonismo y para pantallas al sol.
- Identidad navy/dorado, tipografías del proyecto, textos en español y foco accesible por teclado, como el resto del sitio.

### Protección de datos personales

- La respuesta **no incluye DNI** y nunca debe pedirse en esta página. Tampoco incluye correos, teléfonos ni identificadores internos: muestra solo lo que llega.
- **No guardes el código** en `localStorage`, `sessionStorage` ni cookies: es la credencial que prueba el certificado.
- **No envíes el código a analítica, registro de errores ni a terceros**, ni como parte de la URL enviada a un servicio externo. Una URL de verificación en un panel de analítica es una fuga de certificados verificables.
- Respeta el `Cache-Control: no-store` del backend: no cachees la respuesta en un service worker ni en un almacén del cliente.
- Añade `noindex` a la página: las URL con código no deben acabar indexadas por buscadores.
- Evita capturas automáticas de pantalla o vistas previas de enlace que incluyan el nombre del estudiante.

## 9. La URL del QR: qué la determina y qué falta

Lo que se imprime en el QR es `<CERTIFICADOS_VERIFICACION_URL>/<CÓDIGO>`.

- La fija **quien despliega**, en la variable de entorno `CERTIFICADOS_VERIFICACION_URL` del backend. **No se deduce** de las cabeceras `Host` u `Origin` de la solicitud, precisamente porque las controla quien llama: un documento ya impreso no se puede corregir.
- `resolveVerificationBase` la valida y **rechaza** cualquier valor que no sea `https` con dominio público: sin `localhost`, sin direcciones IP, sin puertos, sin usuario o contraseña, sin parámetros ni fragmentos, sin sufijos internos (`.local`, `.internal`, `.test`, `.lan`…). Longitud máxima de 120 caracteres, para que el código quepa holgado en el QR.
- Si falta o es inválida, `GET /api/admin/certificados/:id/pdf` responde **503** con un mensaje genérico: antes que imprimir un enlace roto, no se emite el PDF.

**Estado comprobado hoy:** la variable **no está definida** en `backend/.env` (solo aparece comentada como ejemplo en `backend/.env.example`). Es decir, **hoy la descarga de PDF responde 503**. No la modifiqué: es una decisión de despliegue.

**Cómo configurarla cuando exista el dominio definitivo**, en este orden:

1. Publicar la página React `/verificar/:codigo` en el dominio público definitivo.
2. Fijar en el backend `CERTIFICADOS_VERIFICACION_URL=https://<dominio-definitivo>/verificar` (sin barra final; el código se añade detrás).
3. Reiniciar el backend y descargar un PDF de prueba para confirmar que ya no responde 503.
4. Escanear ese QR con un teléfono real y comprobar que abre la página.

Mientras la página no exista, la variable **puede** apuntar a la propia API (`https://<dominio-de-la-api>/api/certificados/verificar`), que devuelve JSON legible aunque poco amable. Dos avisos sobre esa opción:

- Un PDF ya emitido **conserva para siempre la dirección con la que se generó**. Todo certificado impreso apuntando a la API seguirá abriendo JSON aunque después exista la página.
- Por eso, si es viable, conviene **no emitir certificados definitivos** hasta que el dominio y la página estén listos.

## 10. Qué se probó y qué sigue pendiente

Del ensayo de certificación del **22/10/2026** (detalle completo en `certificados.md`, §9):

**Comprobado:**

- La emisión y la verificación se probaron **contra un MySQL aislado y desechable**, no contra la base real: `horus_db` y `horus_local` no se tocaron, y no se ejecutaron migraciones sobre ellas.
- El QR se **decodificó de forma independiente** (jsQR 1.4.0, instalado en una carpeta temporal fuera del repositorio): se tomaron del flujo del PDF los rectángulos dibujados, se rasterizaron y se decodificaron. Los tres casos (vigente, anulado y sustituido) devolvieron exactamente la URL codificada. Es una lectura de la **geometría dibujada en el PDF**, no de una imagen impresa ni fotografiada.
- Los límites de frecuencia se verificaron con HTTP real, incluido el mismo 404 exacto para código mal formado e inexistente.

**Pendiente, y que nadie dé por hecho:**

- **No se hizo ningún escaneo físico con un celular.** Que el QR se lea en pantalla o en papel impreso está sin comprobar.
- **No se inspeccionó visualmente el PDF renderizado.** La maquetación se verificó midiendo posiciones en el peor caso, no mirando la página (no hay rasterizador instalado y Edge en modo headless no renderiza el visor de PDF).
- No se comprobó si la marca de agua diagonal «ANULADO» dificulta el escaneo real del QR: la lectura independiente la ignora por construcción.
- **La página pública React no existe todavía**: es justo el trabajo que describe esta guía.

## 11. Lista de comprobación

- [ ] `/verificar/:codigo` es pública y funciona sin sesión ni token.
- [ ] El código se lee de la URL y se normaliza (recorte + mayúsculas) antes de consultar.
- [ ] Una consulta por pulsación; nunca una por tecla.
- [ ] Los siete estados de §8 están implementados y son distinguibles.
- [ ] Solo un `200` con `valido: true` se muestra como certificado válido.
- [ ] 404, 429, 5xx y red se presentan como mensajes distintos, y ninguno como «certificado falso».
- [ ] No se reintenta automáticamente.
- [ ] El código no se guarda ni se envía a analítica ni a registro de errores.
- [ ] La página lleva `noindex` y no cachea la respuesta.
- [ ] Se lee correctamente en un teléfono sin desplazar la pantalla.
- [ ] `CERTIFICADOS_VERIFICACION_URL` apunta al dominio de esta página antes de emitir certificados definitivos.
