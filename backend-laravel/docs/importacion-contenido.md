# Importador de contenido: preparación offline

Implementado sin conexión a NestJS ni acceso a sus credenciales. Solo probado con datos
ficticios, SQLite en memoria y MySQL 8.4 desechable. No exporta ni importa datos reales.

## Intercambio versión 1

Archivo JSON privado (máximo 32 MiB), con exactamente `version: 1` y `tablas`.
`tablas` incluye siete listas, aunque estén vacías:
`cursos`, `servicios`, `preguntas_frecuentes`, `galeria_items`, `convenios`,
`convenio_fotos`, `empresa_settings`.

Las filas usan nombres y valores de las tablas SQL de NestJS, no las listas públicas
(estas omiten borradores, detalles, fotos y marcas internas). Cada fila debe incluir
todos los campos públicos del modelo Laravel correspondiente, más `id`, `createdAt`
y `updatedAt` en formato SQL `AAAA-MM-DD HH:MM:SS` UTC. `convenio_fotos` solo tiene
`createdAt` en NestJS: `updated_at` se inicializa con esa fecha, sin inventar otra hora.
`empresa_settings` admite `id`, `clave`, `valor`, `descripcion`, `grupo` y ambas fechas;
solo copia las diez claves conocidas, conserva sus IDs y fechas e informa el número
de filas omitidas. No imprime sus valores ni los nombres de claves desconocidas.

| Origen | Destino | Tratamiento |
| --- | --- | --- |
| cursos | catalogo_cursos | Conserva campos; `curso_id` académico siempre null |
| servicios | catalogo_servicios | Conserva categoría, presentación y estado |
| preguntas_frecuentes | preguntas_frecuentes | Conserva estado, categoría y orden |
| galeria_items | galeria_items | Exige `activo` y `orden` válidos; no transforma null en valores inventados |
| convenios | convenios | Conserva visibilidad, textos y orden |
| convenio_fotos | convenio_fotos | Conserva ID y relación con convenio; comprueba FK |
| empresa_settings | ajustes_publicos | Solo claves conocidas; descarta descripción y grupo internos |

`origen_original` (cursos, servicios, galería) y `origen_local` (convenios) se admiten
como metadatos internos pero no se copian: Laravel no tiene esas columnas.
Todo otro campo o tabla se rechaza. No se importan cuentas, formularios, atención,
cotizaciones, chatbot, sesiones ni tablas académicas. `fecha_inicio` admite fecha sola
o con `00:00:00`; otra hora aborta para evitar truncarla. IDs, slug, estados, orden,
acentos y URL se conservan; no se normalizan textos silenciosamente.

## Comprobaciones y ejecución futura

El comando exige MySQL, `--base-esperada` y `--servidor-uuid` coincidentes. El destino
definitivo admitido por comando y servicio es `horus_group`, independiente de `horus_db`
y `horus_local`. `horus_laravel` ya no es un destino válido.
Se conserva `horus_laravel_it_<16 hex>` para bases desechables;
SQLite solo se admite en memoria bajo testing. Todas las tablas de contenido deben existir con InnoDB.
El inventario compartido `DestinoMysqlLaravel` rechaza cualquier tabla ajena a las
migraciones Laravel, incluso vacía, antes de escribir contenido. Ni un nombre permitido
ni confirmar el UUID autorizan una base mixta.
Exige zona de sesión explícita `+00:00` o `UTC` (no acepta `SYSTEM`): configurar
`DB_TIMEZONE=+00:00` para preservar las horas de las columnas TIMESTAMP.

Opciones: `--archivo`, `--uploads` (copia/directorio autorizado de uploads), `--publicos`
(raíz pública que contiene recursos como `site-original` y `galeria`), `--base-esperada`,
`--servidor-uuid`. Por defecto ejecuta una copia y comparación completa y revierte las
filas. `--aplicar` pide confirmación interactiva; no se proporciona un comando completo
de aplicación listo para ejecutar. Requiere autorización de datos reales y ventana
sin editores Filament ni otros escritores de contenido; el bloqueo asesor solo
serializa otras instancias del importador. Los contadores InnoDB pueden avanzar
incluso en simulacro; no afecta a registros, y no se prometen metadatos físicos idénticos.

Antes de confirmar compara todas las filas, recuentos y firmas, comprueba reglas de los
modelos y relaciones. Un error revierte todas las tablas importadas. El destino debe
estar vacío o ser exactamente idéntico: la repetición idéntica se informa como
`reutilizado`; cualquier diferencia detiene la operación y conserva las ediciones.
No hay modo de sobreescritura ni sincronización incremental. Las escrituras del panel
después de importar requieren otra decisión para futuras sincronizaciones.

Las imágenes conservan su URL y deben existir bajo las raíces autorizadas. Las rutas
`/api/uploads/` se resuelven en `--uploads`; otras rutas absolutas del sitio, en
`--publicos`. Se comprueba `realpath` y confinamiento (también enlaces simbólicos).
No se copian ni borran archivos, ni se comprueba su disponibilidad HTTP. URL http(s)
remotas se rechazan hasta implementar una verificación autorizada con política de
destinos; no se descargan desde este comando.

## Extracción pendiente, sin ejecutar

1. Confirmar servidor y base efectiva de NestJS: el contenedor local observado usa
   `horus_local`, mientras `backend/.env` declara `horus_db`; no son intercambiables.
2. Autorizar respaldo y extracción con usuario SELECT únicamente sobre esas siete
   tablas. No dar acceso al importador Laravel al servidor de NestJS.
3. Exportar en una instantánea consistente `REPEATABLE READ`, incluyendo ocultos y
   archivados, todas las columnas del contrato y fechas SQL sin conversiones horarias.
4. Guardar JSON y manifiesto SHA-256 fuera del repositorio con permisos restringidos;
   inventariar las imágenes sin publicar los datos. La versión actual no implementa
   este exportador ni conexión en vivo: debe revisarse y autorizarse antes de usar datos reales.
5. Ensayar primero con copia autorizada en un destino desechable; comparar las once
   respuestas públicas con ambos proveedores y comprobar archivos desde el navegador.

React conserva NestJS por defecto. El chatbot guiado respeta el proveedor de lecturas,
pero las respuestas libres siguen consultando Prisma/NestJS. No activar la web con
Laravel hasta aprobar y verificar cómo mantener una única fuente para el chatbot.
