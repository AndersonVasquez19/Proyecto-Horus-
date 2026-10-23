# Certificados académicos

> **Documento histórico: funcionalidad retirada (simplificación académica, octubre de 2026).** Los certificados se preparan y entregan de forma presencial,
> fuera de la plataforma. Ya no existen la emisión, anulación y sustitución, las rutas `/api/admin/certificados*`, el PDF con QR, el recurso de permisos
> `certificados:*`, los reportes `certificados` y `pendientes-certificacion`, los indicadores del Resumen ni la herramienta de HORUS Assistant. Se conservan
> las tablas, los datos, la migración y el respaldo/restauración, el **bloqueo de matrículas con un certificado vigente** y, de forma provisional,
> `GET /api/certificados/verificar/:codigo` (solo lectura) porque no se pudo comprobar que no existan certificados emitidos con QR en todos los entornos.
> Lo que sigue describe el diseño anterior y no el comportamiento actual.


Documento de referencia y guion de sustentación del módulo. Todas las rutas llevan el prefijo `/api`.
No requiere migración propia: usa las tablas `matriculas`, `certificados` y `academico_historial` de la estructura académica (`20261015-academico-estructura`, `20261016-academico-solo-dni`).

## 1. Objetivo del módulo

Dejar constancia **verificable** de que un estudiante cumplió con un curso o capacitación de Horus Group SRL:

- Un certificado solo existe si alguien autorizado **confirmó el cumplimiento** de la matrícula.
- El certificado se entrega como **PDF A4** con un **código único** y un **QR** que lleva a la verificación pública.
- Cualquier persona con el documento (o su código) puede comprobar si es **vigente o está anulado**, sin ver datos personales sensibles.
- Nada se borra: un certificado se **anula** o se **sustituye** y se conserva su historial.

No hay notas ni asistencia: el sistema no califica, solo registra el cumplimiento que confirma una persona.

## 2. Flujo desde la matrícula hasta el certificado

```text
Estudiante ─► Matrícula (activa) ─► Confirmar cumplimiento ─► Emitir certificado ─► Descargar PDF ─► Verificación pública
                                     (Gerencia/Coordinación)   (Gerencia/Coordinación)  (con permiso de lectura)   (cualquiera, con el código)
```

1. **Estudiante y matrícula.** El estudiante debe tener **DNI peruano completo** (8 dígitos) y la matrícula debe estar **activa**.
2. **Confirmar cumplimiento** — `PUT /admin/matriculas/:id/cumplimiento`, cuerpo `{ revision, cumplimiento: 'cumplido' | 'no_cumplido' | 'pendiente', motivo? }`.
   La `revision` debe ser la vigente (409 si cambió). Corregir una confirmación o volver a `pendiente` exige `motivo`. Con un certificado vigente no se puede cambiar: primero se anula el certificado.
3. **Emitir** — `POST /admin/certificados`, cuerpo `{ matricula_id, matricula_revision }`. Exige cumplimiento `cumplido`, edición no cancelada y ningún certificado vigente en esa matrícula. **Copia** nombre, curso y fechas al emitir: si luego se corrige el estudiante o la edición, el certificado ya emitido no cambia (se sustituye).
4. **Descargar el PDF** — `GET /admin/certificados/:id/pdf`.
5. **Verificar** — `GET /certificados/verificar/:codigo`, sin autenticación.

## 3. Roles y permisos

| Operación | Permiso | Gerencia | Coordinación | Secretaría |
| --- | --- | :-: | :-: | :-: |
| Confirmar cumplimiento | `matriculas:confirmar` | Sí | Sí | No |
| Listar, ver detalle e historial, **descargar PDF** | `certificados:leer` | Sí | Sí | No |
| Emitir | `certificados:emitir` | Sí | Sí | No |
| Anular y sustituir | `certificados:anular` | Sí | **No** | No |
| Verificar por código | pública | — | — | — |

Además de la guard de rutas, el servicio vuelve a comprobar el permiso dentro de la transacción (defensa en profundidad). Sustituir exige poder anular **y** emitir. No se amplió ningún permiso en esta etapa.

## 4. El código y el QR

- **Código de verificación:** 20 caracteres aleatorios (`crypto`) de un alfabeto de 32 símbolos sin los confusos (sin `0/O`, `1/I`) = **100 bits**. Adivinarlo es inviable. MySQL lo exige único y con formato `^[A-Z0-9]{16,32}$`.
- **QR:** codifica la **dirección de verificación + código**, por ejemplo `https://dominio-real.example/verificar/ABCDEFGHJKLMNPQRSTUV`. Se genera con un codificador propio (`certificados.qr.ts`: modo byte, corrección de errores nivel M) y se dibuja en el PDF como rectángulos vectoriales; **no se añadió ninguna dependencia**.
- **Dirección pública de verificación (configuración obligatoria).** La fija quien despliega con la variable `CERTIFICADOS_VERIFICACION_URL` (ver `backend/.env.example`). **No se deduce de la solicitud** (cabeceras `Host`/`Origin` que controla quien llama) ni se inventa un dominio. Se valida y se rechaza cualquier valor que no sea `https`, con dominio público: sin `localhost`, direcciones IP, nombres internos (`.local`, `.internal`…), puertos, usuario/clave, parámetros ni fragmentos. Si falta o es inválida, el PDF responde **503** con un mensaje genérico (sin revelar la configuración): así no se imprime un documento con un enlace que no funcionará.
- **Pendiente de integración:** hoy el frontend no tiene una página de verificación. Hasta que exista, la variable puede apuntar a la API pública (`https://<dominio-de-la-api>/api/certificados/verificar`), que responde JSON. Cuando se cree la página, solo hay que cambiar el valor de la variable. Un PDF ya impreso conserva la dirección con la que se generó.

## 5. Estados y anulación

| Estado | Qué significa | En el PDF | En la verificación pública |
| --- | --- | --- | --- |
| `vigente` | Válido | «Estado al generar este documento: VIGENTE» + fecha de consulta | `valido: true` |
| `anulado` | Dejó de ser válido (con motivo, quién y cuándo, guardados internamente) | Banner rojo «CERTIFICADO ANULADO – SIN VALIDEZ», marca de agua «ANULADO» en diagonal, colores grises | `valido: false`, `estado: 'anulado'` |
| anulado y sustituido | Reemplazado por otro certificado | Igual, y el banner añade «SUSTITUIDO POR OTRO» | `sustituido: true` |

- Un estado desconocido se trata como anulado (el documento **falla cerrado**).
- **Sustituir** (`POST /admin/certificados/:id/sustitucion`, `{ motivo }`) anula el vigente y emite uno nuevo con los datos **actuales**, en una sola transacción: sirve para corregir un nombre o un DNI mal copiado. Si falla la emisión, el anterior sigue vigente.
- El PDF muestra el estado **al momento de generarlo**. Como un papel no se actualiza solo, el documento indica que el estado vigente se confirma únicamente en la dirección de verificación. El QR de un anulado se conserva a propósito: al escanearlo, la verificación dice que no es válido.
- Todo cambio (emisión, anulación, sustitución) escribe su historial (`academico_historial`, solo inserción) en la misma transacción. El historial no guarda nombres ni DNI.

## 6. Medidas de seguridad

- **Sin DNI en el PDF ni en la verificación.** El PDF se arma con una consulta que ni siquiera pide el DNI, el motivo de anulación, quién emitió ni identificadores internos.
- **Sin firmas, sellos, autoridades ni acreditaciones inventadas.** El documento afirma solo lo que el sistema registró y declara que no incluye firmas ni sellos.
- **Verificación pública mínima:** nombre, curso, fechas y estado. Código mal formado y código inexistente devuelven **el mismo 404** con el mismo texto, y los formatos imposibles ni siquiera consultan la base. No se revela el motivo de anulación.
- **Límite de frecuencia** en `GET /certificados/verificar/:codigo`, con el mismo sistema que los formularios públicos (`PublicRateLimitGuard`, contadores en MySQL `rate_limit_buckets`, solo hashes de IP): **30 por minuto por IP, 200 por hora por IP, 90 por minuto por subred (/24 o /64) y 600 por minuto en total**. Todas las consultas (válidas, inexistentes y mal formadas) gastan la misma cuota, así que el límite no revela si un código existe. Una solicitud rechazada no consume cuota ajena. El contrato de respuesta no cambió; solo se añade el 429 estándar (`{ ok: false, mensaje }`).
- **Detrás de un proxy:** la IP sale de `request.ip`, que Express calcula con `TRUSTED_PROXY_CIDRS`. Sin esa variable en un despliegue alojado, todos los visitantes compartirían una sola cuota (el arranque ya avisa). Debe configurarla quien despliega, con los rangos confirmados por su proveedor.
- **Respuestas sin caché:** `Cache-Control: no-store` en la verificación y en la descarga del PDF; el PDF se entrega como adjunto.
- **Entradas validadas:** `id` entero positivo; el código se normaliza (espacios, mayúsculas) y se valida antes de consultar; nombres con caracteres fuera de WinAnsi se sustituyen por `?` y los textos largos se reducen o se cortan para que el documento sea siempre de **una página**.
- **Sin borrado físico:** no existe `DELETE` de certificados.

## 7. Archivos y endpoints

| Archivo | Responsabilidad |
| --- | --- |
| `backend/src/certificados/certificados.controller.ts` | Rutas públicas y administrativas |
| `backend/src/certificados/certificados.service.ts` | Consulta, emisión, anulación, sustitución, verificación y `pdf()` |
| `backend/src/certificados/certificados.rules.ts` | Reglas puras: código, normalización, validación de emisión, vista pública |
| `backend/src/certificados/certificados.pdf.ts` | Diseño del PDF A4 (pdfkit con fuentes estándar) |
| `backend/src/certificados/certificados.qr.ts` | Codificador QR sin dependencias |
| `backend/src/certificados/certificados.config.ts` | Validación de `CERTIFICADOS_VERIFICACION_URL` |
| `backend/src/certificados/certificados.dto.ts` | DTO de entrada |
| `backend/src/reportes/formatos/pdf.ts` | `pdfText()` reutilizado para sanear el texto |
| `backend/src/common/public-rate-limit.guard.ts` | Límite de frecuencia (ahora también para la verificación) |
| `backend/src/permissions/route-inventory.ts` | Inventario de rutas y permisos |
| `backend/test/certificados.test.ts`, `backend/test/certificados-pdf.test.ts` | Pruebas |

| Ruta | Permiso | Notas |
| --- | --- | --- |
| `GET /certificados/verificar/:codigo` | pública | Con límite de frecuencia; `no-store` |
| `GET /admin/certificados` | `certificados:leer` | Filtros `matricula_id`, `convocatoria_id`, `estudiante_id`, `estado`, `search`; paginado |
| `GET /admin/certificados/:id` | `certificados:leer` | Incluye `sustituido_por_id` |
| `GET /admin/certificados/:id/historial` | `certificados:leer` | Historial de solo inserción |
| **`GET /admin/certificados/:id/pdf`** | `certificados:leer` | **Nuevo.** `application/pdf`, adjunto `certificado-<código>.pdf`; 404 si no existe; 503 si la URL de verificación no está configurada |
| `POST /admin/certificados` | `certificados:emitir` | `{ matricula_id, matricula_revision }` |
| `PUT /admin/certificados/:id/anulacion` | `certificados:anular` | `{ motivo }` |
| `POST /admin/certificados/:id/sustitucion` | `certificados:anular` (+ `emitir`) | `{ motivo }` |
| `PUT /admin/matriculas/:id/cumplimiento` | `matriculas:confirmar` | Confirmar cumplimiento |

## 8. Ejemplo explicado con palabras sencillas

> Ana Quispe terminó el curso «Excel Intermedio». La coordinadora revisa que Ana cumplió y, en Matrículas, marca **«cumplido»**. Luego pulsa **emitir**: el sistema comprueba que Ana tenga DNI completo y que no tenga ya otro certificado vigente, **copia** su nombre, el curso y las fechas, y genera un **código al azar** (por ejemplo `K7M2…`). Después se descarga el **PDF**: dice «Horus Group SRL», el nombre de Ana, el curso, las fechas, el código y un **QR**.
>
> Un empleador escanea el QR. Se abre la dirección de verificación con el código y ve «Ana Quispe – Excel Intermedio – vigente». No ve su DNI.
>
> Meses después se descubre que el apellido estaba mal escrito. Solo la **Gerencia** puede **sustituir**: el certificado viejo pasa a **anulado** (queda guardado quién, cuándo y por qué) y se crea uno nuevo con el dato corregido. Si alguien escanea el QR del papel viejo, la verificación dice **«no válido»**, y si se vuelve a descargar su PDF, sale marcado en rojo como **ANULADO**.
>
> Si alguien intenta adivinar códigos, tras 30 consultas en un minuto el sistema le responde «espera un minuto», y esa respuesta es igual exista o no el código.

## 9. Qué está probado y qué requiere validación con MySQL real

**Probado (pruebas automáticas aisladas, sin MySQL, correo ni red externa):**

- Reglas puras: código, normalización, emisión, vista pública (`certificados.test.ts`).
- Emisión, anulación, sustitución y permisos del servicio con una base simulada en memoria, incluidos el orden de bloqueos y el historial.
- **QR:** vector de Reed-Solomon de la norma ISO 18004 (versión 1-M), tablas de bits de formato y de versión, y **decodificación completa** de la matriz con un decodificador independiente (modo, longitud, bytes y corrección de errores de cada bloque) para varias versiones, incluidas la 1 y la 10; rechazo de textos demasiado largos.
- **URL de verificación:** casos aceptados y una lista de rechazos (http, localhost, IP, nombres internos, puertos, credenciales, parámetros…).
- **PDF:** una página A4 horizontal; contiene institución, nombre, curso, fechas, código, URL, estado y la declaración de que no incluye firmas ni sellos; **no** contiene DNI ni motivo; anulado y sustituido se marcan como anulados (y un estado desconocido también); nombres extremos o con emojis no rompen el documento; el QR dibujado corresponde a la URL.
- **Servicio del PDF:** consulta sin DNI ni motivo, 404, 503 por configuración ausente o insegura.
- **Autorización:** permiso exigido por cada ruta y matriz de roles (Gerencia, Coordinación, Secretaría, sin rol).
- **Frecuencia:** 30/min por IP, hora, subred, global, reinicio de ventana, misma cuota para códigos válidos e inexistentes, rutas no afectadas; con HTTP real, mismo 404 exacto para mal formado e inexistente, y cuotas independientes detrás de un proxy simulado con `X-Forwarded-For` falsificada.

**Requiere validación con MySQL real y un entorno desplegado (no se hizo en esta etapa):**

- Las migraciones de Sesiones y Preinscripciones siguen pendientes en la base real; esta etapa **no ejecutó migraciones ni tocó `horus_db` ni `horus_local`**.
- Emisión, anulación y sustitución contra MySQL real (la columna generada y el `UNIQUE` de un solo vigente por matrícula, los bloqueos `FOR UPDATE`, las transacciones concurrentes), y el flujo de punta a punta con datos reales.
- La atomicidad del límite de frecuencia con varios procesos (`rate_limit_buckets`) en la verificación pública; los contadores de las pruebas son en memoria.
- La IP real detrás de Railway/Caddy (`TRUSTED_PROXY_CIDRS` con los rangos del proveedor).
- Que el QR **se escanee** con teléfonos reales y que el PDF se vea bien impreso. **No se hizo ningún escaneo físico.** La maquetación se comprobó midiendo posiciones en el peor caso (nombre y curso de dos líneas), no con una vista previa gráfica: **la revisión ocular de las páginas sigue pendiente** (Edge en modo headless no renderiza el visor de PDF y no hay otro rasterizador instalado).
- Que la marca de agua diagonal «ANULADO» (rojo al 16 % de opacidad) no dificulte el escaneo del QR de un certificado anulado: la lectura independiente descrita abajo ignora la marca de agua, por lo que este caso queda sin comprobar.

**Ajuste de maquetación (certificados anulados y sustituidos):** con nombre y curso de dos líneas, el banner de anulado desplazaba las fechas hasta pisar «Emitido el…» y el estado (solape de unos 21 pt). Ahora la zona inferior (emisión, estado, código y QR) arranca en su posición habitual pero nunca por encima del final de las fechas más 8 pt, el banner de anulado ocupa 30 pt en lugar de 34 y el espacio entre las líneas de edición/duración/fechas baja de 3 a 1 pt. En el peor caso medido las fechas terminan en 428 pt, «Emitido el» empieza en 436 pt y la etiqueta del QR termina en 551 pt (marco interior en 566 pt). Un certificado vigente conserva su posición anterior en la zona inferior. Prueba de regresión: `certificados-pdf.test.ts` («las fechas no pisan la emisión…»), que falla sin el ajuste.

**Lectura independiente del QR (jsQR 1.4.0, instalado solo en una carpeta temporal fuera del repositorio):** se generaron tres PDF ficticios (vigente, anulado y sustituido) con una URL ficticia (`horus.example.pe`, sin solicitudes de red); se tomaron del flujo de contenido de cada PDF los 282 rectángulos negros del QR, se rasterizaron a 6 px/pt con zona de silencio y se decodificaron. Los tres códigos devolvieron **exactamente** la URL codificada. Es una lectura de la geometría dibujada en el PDF, no de una imagen impresa ni fotografiada.
- La página pública de verificación en el frontend y el valor final de `CERTIFICADOS_VERIFICACION_URL` con el dominio real.

## 10. Guion breve para la sustentación

1. **Problema:** un certificado en papel se puede falsificar. Solución: cada certificado lleva un código único y un QR que lo verifica en línea.
2. **Flujo:** matrícula → alguien con autoridad confirma el cumplimiento → se emite → PDF → verificación pública.
3. **Quién puede qué:** Gerencia y Coordinación confirman y emiten; solo Gerencia anula y sustituye; la Secretaría no interviene.
4. **Código y QR:** 100 bits aleatorios (imposible de adivinar); el QR contiene la dirección pública configurada, que se valida para no imprimir `localhost` ni un enlace roto. El QR se genera sin librerías externas y se comprobó leyéndolo de vuelta.
5. **Anulación:** nada se borra; un anulado se imprime como ANULADO y la verificación dice «no válido». Un error se corrige sustituyendo, y queda historial.
6. **Seguridad:** el PDF y la verificación no muestran el DNI; mismo 404 para códigos falsos e inexistentes; límite de consultas por IP, subred y global; permisos comprobados dos veces.
7. **Honestidad sobre el alcance:** probado con pruebas automáticas aisladas; falta validarlo contra MySQL real, con proxy real y con la página de verificación del frontend.
