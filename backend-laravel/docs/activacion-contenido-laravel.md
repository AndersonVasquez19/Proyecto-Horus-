# Activación de Laravel: MySQL propio, traslado y contenido público

Estado: **procedimiento preparado, nada ejecutado**. Cada bloque (A–E) requiere una
autorización expresa y un destino comprobado. Complementa [mysql-traslado.md](mysql-traslado.md)
y [contenido-publico.md](contenido-publico.md); no repite sus detalles.

Reglas comunes a todos los pasos:

- Nunca usar `horus_db` como destino ni modificar sus datos. NestJS sigue en servicio hasta el paso E.
- No mostrar contraseñas ni claves en consola, capturas o informes. Usar `php artisan config:clear`
  tras editar un `.env` y no cachear configuración durante la ventana de cambio.
- Antes de cada paso: respaldo verificado. Después: comprobación y anotación del resultado.
- Si una comprobación falla, detenerse y volver al estado anterior; no corregir datos a mano.

## A. Base MySQL independiente para Laravel

1. **Decidir el servidor** (autorización): local (contenedor `horus-local-mysql-1`, que también
   aloja `horus_db`) o un servicio MySQL 8.4 nuevo en Railway. Recomendado: servicio propio en
   producción; en local, una base separada en el mismo servidor es aceptable.
2. Crear la base y un usuario exclusivo, con permisos **solo** sobre ella:

   ```sql
   CREATE DATABASE horus_laravel CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'horus_laravel_app'@'%' IDENTIFIED BY '<definir en el destino>';
   GRANT ALL PRIVILEGES ON horus_laravel.* TO 'horus_laravel_app'@'%';
   ```

   Restringir el host (`'%'`) a la red privada del servicio en producción.
3. Preparar el `.env` de Laravel según [mysql-traslado.md](mysql-traslado.md) (con `DB_TIMEZONE=+00:00`),
   **sin** activar todavía `HORUS_CONTENIDO_*`.
4. Revisar el SQL sin ejecutarlo: `php artisan migrate --pretend`. Luego, con autorización:
   `php artisan migrate --force` y `php artisan migrate:status` (todas en `Ran`).
5. Comprobar: `php artisan db:show` indica `horus_laravel`, MySQL 8.4 y tablas InnoDB.

Vuelta atrás: restaurar el `.env` anterior (SQLite) y `config:clear`. La base vacía puede
eliminarse solo con autorización.

## B. Respaldo y traslado de los datos académicos desde SQLite

1. Avisar a los usuarios y **detener Laravel** (panel `/gestion` y API) para que no haya escrituras.
2. Respaldo: copiar `database/database.sqlite` y, si existen, `-wal` y `-shm` a una ruta fuera del
   repositorio; anotar el SHA-256 (`Get-FileHash -Algorithm SHA256`). Abrir la copia con
   `sqlite3 copia.sqlite "PRAGMA integrity_check;"` (debe responder `ok`). Cifrar la copia: contiene
   datos personales y hashes.
3. Simulacro sobre la base de A (copia, verifica y revierte):
   `php artisan horus:trasladar-sqlite-mysql --origen=<copia.sqlite>`
4. Aplicación (autorización expresa):
   `php artisan horus:trasladar-sqlite-mysql --origen=<copia.sqlite> --aplicar --informe=<ruta-privada.json>`
5. Comprobación funcional con la cuenta autorizada: inicio de sesión en `/gestion`, escritorio con
   los mismos totales, una ficha de estudiante, una matrícula y su historial.
6. Conservar el SQLite original sin cambios durante el periodo de observación acordado.

Vuelta atrás: `.env` anterior y `config:clear`. Los datos creados en MySQL después del traslado no
existen en SQLite: decidir antes de volver.

## C. Migración del contenido público desde NestJS

No existe todavía un importador: debe diseñarse, probarse con fixtures y autorizarse aparte
(comando propuesto `horus:importar-contenido-nestjs`, con el mismo patrón que el traslado).

1. Respaldo de `horus_db` con el script de solo lectura `npm run db:backup` (en `backend/`).
2. Usuario MySQL de **solo lectura** (`SELECT` únicamente sobre las tablas de contenido de `horus_db`).
3. Congelar la edición de contenido en el panel React durante la ventana.
4. Correspondencia (conservando ids, `slug`, `orden` y fechas para no romper enlaces):

   | NestJS (`horus_db`) | Laravel | Notas |
   | --- | --- | --- |
   | `cursos` | `catalogo_cursos` | mismo `estado`; `curso_id` académico vacío (enlace manual posterior) |
   | `servicios` | `catalogo_servicios` | mismo `estado` |
   | `preguntas_frecuentes` | `preguntas_frecuentes` | mismo `estado` |
   | `galeria_items` | `galeria_items` | conservar `activo` (en Laravel nace oculta) |
   | `convenios`, `convenio_fotos` | `convenios`, `convenio_fotos` | conservar `visible`, fotos y orden |
   | `empresa_settings` | `ajustes_publicos` | solo las 10 claves conocidas; las demás se informan, no se copian |

5. **Imágenes**: conservar las URL tal cual. Las rutas `/api/uploads/<uuid>.<ext>` siguen sirviéndose
   desde `UPLOAD_DIR` de NestJS, así que no se copian archivos. El importador debe validar cada URL
   con `App\Rules\ImagenPublica`, comprobar (solo lectura) que el archivo existe y **detenerse** ante
   cualquier URL rechazada o archivo ausente, sin importar nada.
6. Ejecución en simulacro (escribe, verifica recuentos y firmas por tabla, revierte) y después con
   `--aplicar`, en una sola transacción.
7. Verificación: recuentos por estado iguales en ambas bases y comparación de las respuestas de
   `GET /api/...` (NestJS) y `GET /api/contenido/...` (Laravel) para cada recurso.

Vuelta atrás: las tablas de contenido de Laravel son independientes; vaciarlas (con autorización)
no afecta a `horus_db` ni a los datos académicos.

## D. Fuente del chatbot

Hoy `backend/src/chatbot/chatbot.service.ts` consulta con Prisma `cursos`, `servicios`,
`preguntas_frecuentes`, `convenios` y `empresa_settings` de `horus_db`. El menú guiado de React ya
sigue a `VITE_CONTENT_PROVIDER` (lista y detalle salen del mismo origen), pero las respuestas libres
del asistente no.

Opciones:

1. **Recomendada**: adaptar el chatbot de NestJS para leer el contenido de la API pública de Laravel
   (solo lo publicado, mismas reglas que la web), con tiempo de espera y un mensaje neutro si no
   responde. Sin volver en silencio a `horus_db`: mezclar fuentes produciría respuestas incoherentes.
   Es un cambio en `backend/` que requiere autorización, pruebas con fixtures y `smoke:chatbot`.
2. Transitoria: mantener `horus_db` como única fuente de la web y del chatbot hasta C, y activar
   React con Laravel solo cuando la opción 1 esté lista.

Nunca dejar la web leyendo de Laravel y el chatbot de `horus_db` con ediciones activas en ambos.

## E. Activación gradual

| Paso | Cambio | Comprobación | Vuelta atrás |
| --- | --- | --- | --- |
| 1 | `HORUS_CONTENIDO_PANEL=true` en Laravel (API apagada) | Solo la cuenta `administrador_general` activa ve «Contenido web»; coordinación y secretaría no | `HORUS_CONTENIDO_PANEL=false` |
| 2 | Revisar en el panel el contenido importado en C | Fichas, imágenes, estados y orden | Volver a importar en base vacía |
| 3 | `HORUS_CONTENIDO_API=true` con Laravel en HTTPS | `GET /api/contenido/*` responde; borradores y ocultos dan 404; límite 429 | `HORUS_CONTENIDO_API=false` |
| 4 | Build de vista previa con `VITE_CONTENT_PROVIDER=laravel` y `VITE_CONTENT_API_BASE_URL` | Smokes (`smoke-home`, `smoke-ui`, `smoke-global-content`, `smoke:chatbot`) y revisión manual | Descartar la vista previa |
| 5 | Chatbot alineado (D) | Respuestas basadas en Laravel | Revertir el despliegue del chatbot |
| 6 | Build de producción con Laravel | Seguimiento de errores y tiempos | Build sin `VITE_CONTENT_PROVIDER` (vuelve a NestJS) |
| 7 | Congelar la edición de contenido en el panel React | Una sola fuente editable | Reabrir la edición en NestJS |

## Autorizaciones pendientes

1. Servidor y credenciales de la base `horus_laravel` (A) y su migración.
2. Ventana de parada, respaldo y traslado real desde SQLite (B).
3. Diseño e implementación del importador desde NestJS y su ejecución (C).
4. Cambio del chatbot en `backend/` (D).
5. Cada paso de E, incluida la cuenta concreta con `administrador_general`.
