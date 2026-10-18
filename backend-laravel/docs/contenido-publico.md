# Contenido público de la web en Laravel

Estado: **implementado y probado, no activado**. NestJS sigue siendo el proveedor del sitio,
del panel React heredado y del chatbot. Las tablas nuevas no se han migrado en ninguna base
habitual y no se ha importado ni inventado contenido.

## Arquitectura

```text
Filament /gestion ─▶ Modelos Eloquent (validan) ─▶ tablas de contenido ─▶ GET /api/contenido/* ─▶ React (opcional)
                                                   └─ catalogo_cursos.curso_id ─▶ cursos (académico, opcional)
```

El contenido institucional está separado del académico: `catalogo_cursos` es la **ficha pública**
de un curso o capacitación y solo enlaza (opcionalmente, una ficha por curso) el curso académico,
sin copiar ediciones, cupos ni matrículas. Si el curso académico se elimina, la ficha queda sin enlace.

| Tabla (migración `2026_10_18_100000_create_contenido_publico_tables`) | Estado público | Se elimina |
| --- | --- | --- |
| `catalogo_cursos` (curso / capacitación; un curso exige modalidad y duración, también por `CHECK`) | `estado = publicado` | No: se archiva (como NestJS) |
| `catalogo_servicios` (cableado, cámaras, soporte, asesoramiento) | `estado = publicado` | Sí, con confirmación (decisión vigente del proyecto) |
| `preguntas_frecuentes` | `estado = publicado` | No: se archiva |
| `galeria_items` | `activo = true` (nace oculta) | Sí; el archivo de imagen no se borra |
| `convenios` y `convenio_fotos` (CASCADE) | `visible = true` (nace oculto) | Sí; borra los registros de fotos, no los archivos |
| `ajustes_publicos` (10 claves conocidas: empresa, contacto y redes) | Siempre, vacías si no hay valor | — |

Campos, listas cerradas (colores, iconos, presentaciones, categorías) y longitudes son los de
NestJS (`App\Support\Contenido\OpcionesContenido`). Las imágenes se guardan como URL `http(s)`
o ruta del sitio (`/api/uploads/…`, `/site-original/…`); se rechazan `javascript:`, `data:`, `//`,
`..`, `%`, espacios y credenciales (`App\Rules\ImagenPublica`). **No hay subida de archivos en
Laravel**: las imágenes se siguen subiendo desde el panel anterior.

La validación vive en el modelo (`ValidaContenidoPublico`): la aplican Filament y cualquier otro
escritor; un valor fuera de lista produce un error de validación, nunca un 500.

## Panel `/gestion` — grupo «Contenido web»

Recursos: Catálogo de Educación, Servicios, Preguntas frecuentes, Galería, Convenios (con gestor
de fotos) y la página Datos institucionales. Listado con búsqueda y filtros, alta, edición,
publicar / pasar a borrador / archivar, mostrar u ocultar, y eliminación solo donde se admite.
Cada acción vuelve a autorizar en el servidor y guarda a través del modelo, que impide publicar
contenido incompleto. Usa los componentes y clases del tema Horus Academic; no hay CSS nuevo.

**Acceso (mínimo privilegio, aprobado el 17/10/2026):** `HORUS_CONTENIDO_PANEL=false` por
defecto, y entonces nadie ve el grupo ni sus rutas (403). Activado, solo las cuentas
`administrador_general` **activas** crean, editan, publican, despublican y archivan
(`RolUsuario::gestionaContenidoPublico()`). Coordinación, secretaría, las cuentas sin rol y las
inactivas quedan fuera; los permisos académicos no cambian. Sin modo heredado: siempre se lee el
rol persistido, y una revocación surte efecto en la siguiente petición HTTP o acción Livewire.
Ampliar los roles es una decisión de permisos que requiere autorización expresa y pruebas nuevas.

## API pública `/api/contenido/*` (solo lectura)

`HORUS_CONTENIDO_API=false` por defecto: responde 404 como una ruta inexistente. Grupo `api` sin
sesión ni cookies, CORS `*` (contenido público) y límite de 120 peticiones/minuto por IP (429).

| Ruta | Parámetros (los mismos que NestJS) | Respuesta |
| --- | --- | --- |
| `GET cursos`, `cursos/{id}` | `page`, `limit` (≤100), `search`, `tipo`, `modalidad`, `periodo` (`upcoming`/`past`/`unscheduled`, fecha de Lima); `categoria` y `estado` se aceptan e ignoran | `{ ok, items, pagination: { page, limit, total, pages } }` / `{ ok, item }` |
| `GET servicios`, `servicios/{id}` | `categoria` (una o varias separadas por comas, validadas), `search`, `page`, `limit` | ídem |
| `GET preguntas-frecuentes`, `…/{id}` | `categoria`, `search` (en la pregunta), `page`, `limit` | ídem |
| `GET galeria`, `galeria/{id}` | `categoria`, `page`, `limit` (24 por defecto) | además `total` y `categorias` |
| `GET convenios`, `convenios/{id}` | `page`, `limit`, `search` (nombre o sigla), `estado` (se ignora) | lista resumida; el detalle incluye `fotos` en una sola petición |
| `GET settings` | — | `{ ok, settings: { clave: valor } }` |

Solo se publica lo publicado, activo o visible: ningún parámetro habilita borradores. No salen
`estado`, `curso_id` ni marcas internas. Inexistente u oculto → 404 `{ ok: false, mensaje }`;
parámetro desconocido o inválido → 400 `{ ok: false, mensaje: [...] }`; tablas sin migrar →
503 neutro. La búsqueda es literal (`%`, `_` y `!` no actúan como comodines). Las fechas usan el
formato de Prisma (`2026-11-02T00:00:00.000Z`). Ninguna otra ruta `/api` cambia.

## React (preparado, no conectado)

`frontend/src/contentSource.ts` decide el origen de cada lectura pública. Sin variables, todo va a
NestJS como antes; con `VITE_CONTENT_PROVIDER=laravel` y `VITE_CONTENT_API_BASE_URL` (URL
absoluta terminada en `/api/contenido`, HTTPS en Vercel), **solo los GET** de los seis recursos van
a Laravel. Formularios, sesión, chatbot, panel e imágenes (`/api/uploads`, servidas por NestJS)
no cambian. Una configuración incompleta detiene el build. No hay cambios visuales.

Verificación local realizada: Laravel servido con una SQLite temporal y contenido ficticio, React
compilado con `laravel` y Edge sin interfaz: Educación (cursos y capacitaciones), Preguntas
frecuentes, Home (convenios) y los datos institucionales salieron de Laravel y los borradores
no aparecieron.

## Activación futura (cada paso requiere autorización)

1. Roles: aprobado (solo `administrador_general` activo). Confirmar qué cuenta concreta lo tendrá.
2. Migrar la base de Laravel destino (preferiblemente ya en MySQL: [mysql-traslado.md](mysql-traslado.md)).
3. Con autorización, cargar contenido real desde `/gestion` o mediante el
   [importador offline](importacion-contenido.md), probado con fixtures. La extracción desde
   NestJS y la aplicación real siguen pendientes; no activar `HORUS_CONTENIDO_PANEL` todavía.
4. Exponer Laravel en HTTPS y activar `HORUS_CONTENIDO_API=true`.
5. Compilar React con `VITE_CONTENT_PROVIDER=laravel` y la URL pública, y revisar el sitio.

**Riesgo a resolver antes del paso 5:** el chatbot de NestJS responde con el contenido de
`horus_db`. Si la web pasa a leer de Laravel, ambas fuentes deben coincidir o el chatbot debe
consultar la nueva fuente.

**Vuelta atrás:** compilar React sin `VITE_CONTENT_PROVIDER` (vuelve a NestJS) y/o
`HORUS_CONTENIDO_API=false`. Las tablas de contenido son nuevas e independientes: revertir su
migración solo afecta al contenido cargado en Laravel.
