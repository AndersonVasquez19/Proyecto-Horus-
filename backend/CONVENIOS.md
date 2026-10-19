# Convenios: API, panel y Home

Convenio y ConvenioFoto son independientes de GaleriaItem. Las fotografías usan el mismo almacenamiento de uploads; quitar una foto o un convenio elimina sus registros, nunca archivos físicos.

## Modelos y migración

- Convenio: id, nombre, sigla?, logo_url?, descripcion_corta, descripcion_completa?, informacion_adicional?, orden, visible, origen_local? único, createdAt y updatedAt.
- ConvenioFoto: id, convenio_id, imagen_url, orden, createdAt. FK a Convenio con ON DELETE CASCADE y ON UPDATE CASCADE.
- Índices: convenios_visible_orden_idx, convenios_orden_idx y convenio_fotos_convenio_orden_idx.
- SQL: [20261002-create-convenios.sql](migrations/20261002-create-convenios.sql), registrado en scripts/migrate.cjs.
- Los convenios creados desde API quedan ocultos por defecto. El panel permite publicarlos explícitamente.
- El arranque, las lecturas y el build nunca crean tablas ni importan datos.

## Endpoints

Todas las rutas tienen prefijo /api.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | /convenios | Lista de visibles, paginada |
| GET | /convenios/:id | Detalle visible y fotografías ordenadas |
| GET | /admin/convenios | Lista administrativa, paginada |
| GET | /admin/convenios/:id | Detalle administrativo y fotografías |
| POST | /admin/convenios | Crear |
| PUT | /admin/convenios/:id | Editar, ordenar, publicar u ocultar |
| DELETE | /admin/convenios/:id | Eliminar convenio y registros de fotos |
| POST | /admin/convenios/:id/fotos | Asociar fotografía |
| PUT | /admin/convenios/:id/fotos/:fotoId | Cambiar orden de una fotografía |
| PUT | /admin/convenios/:id/fotos/orden | Reordenar varias, en transacción |
| DELETE | /admin/convenios/:id/fotos/:fotoId | Retirar fotografía |

Listas: { ok, items, pagination: { page, limit, total, pages } }. Detalles: { ok, item }; item.fotos contiene fotos ordenadas por orden e id. Las listas no cargan fotos ni textos completos. origen_local es interno y no se expone en la API.

Query: page=1, limit=20 (máximo 100), search opcional; estado=visible/oculto filtra solo administración. La ruta pública impone visible=true incluso si el cliente pide ocultos. Un detalle oculto responde 404. Administración conserva JwtAuthGuard y validación de cuenta/sesión, sin roles nuevos.

Texto requerido no admite cadenas vacías. Campos opcionales se pueden limpiar con cadena vacía; null se rechaza. Orden es entero entre 0 y 1000000; visible es booleano. Fotos requieren URL HTTP/HTTPS; URLs de localhost se admiten en desarrollo. Los IDs de fotos se verifican dentro de su convenio; una reordenación inválida se revierte íntegramente.

## Panel y Home

Panel: /admin/dashboard?section=convenios. Incluye búsqueda, filtro, paginación, CRUD y confirmación de borrado; formulario con todos los campos, logo mediante ImageUpload y editor independiente de fotografías. La selección múltiple es opcional y cada archivo sigue usando POST /api/admin/uploads (PNG/JPEG/WebP, 5 MB, firma validada). Las fotos ya asociadas se conservan si falla una carga posterior. El diálogo bloquea cierre/guardado mientras hay operaciones en curso.

Home comparte una petición de lista paginada (6 por página) entre la sección y la estadística: esta usa pagination.total, sin cifra fija ni lista estática alternativa. Incluye carga, vacío, error/reintento, logos ausentes o fallidos y texto administrable.

HomeConvenioDialog solicita detalle y fotos en una sola petición. Muestra descripción completa, o corta si falta, y oculta información adicional/fotos vacías. Utiliza dialog nativo, Escape, botón, clic exterior y retorno de foco; entrada de 200 ms y salida de 160 ms, sin animación con movimiento reducido.

HomeConvenioGallery admite 0/1/varias fotos, anterior/siguiente, flechas de teclado y swipe horizontal; contiene imágenes sin deformarlas y carga diferida. No tiene autoplay.

panelRequest notifica el recurso convenios tras escrituras. usePublicResource escucha el evento del mismo documento y el marcador storage de otras pestañas del mismo origen. Actualiza lista, cifra y detalle abierto sin recarga manual, WebSockets ni polling. No transmite cambios a navegadores de otros usuarios.

## Activación manual pendiente

La base principal NO se migró durante esta implementación. Las pruebas utilizan una base horus_prisma_test_<UUID> temporal. Antes de activar el módulo en la base principal, revisar el destino y ejecutar manualmente npm run db:migrate y npm run db:check según el procedimiento del proyecto. Hasta entonces la API puede devolver error por tablas pendientes; Home ofrece reintento.

El importador scripts/import-convenios.cjs está preparado, pero NO se ejecutó, ni siquiera en modo vista previa. La vista previa siguiente se obtiene del inventario src/convenios/initial-content.ts mediante lectura, sin conexión a MySQL.

Tras autorización específica y build de backend:
- Vista previa: node scripts/import-convenios.cjs --preview.
- Importación explícita local: node scripts/import-convenios.cjs --apply --api-base=http://localhost:3000/api.
- Alternativa equivalente: npm run convenios:import -- --preview (o argumentos de aplicación autorizada).

El modo preview no abre MySQL ni escribe. El modo apply exige MySQL local de desarrollo, esquema compatible y URL pública HTTP/HTTPS sin credenciales. Reutiliza UploadsService para los cuatro logos, sirve los archivos por /api/uploads y comparte el logo de Enfermeros. Cada origen_local es único: los registros ya existentes se omiten íntegramente, conservando textos, visibilidad, logo y fotografías editados. GET_LOCK serializa importaciones y la clave única protege de duplicados. Si se interrumpe, una nueva ejecución omite registros ya creados. Los archivos subidos antes de un fallo pueden quedar sin asociación; nunca se borran automáticamente.

## Vista previa exacta de los cinco registros

| Orden | origen_local | Sigla | Nombre | descripcion_corta | Archivo de logo |
| --- | --- | --- | --- | --- | --- |
| 1 | corlad | CORLAD | Colegio de Administradores | Alianza para el desarrollo profesional de administradores con capacitaciones especializadas. | `frontend/src/assets/images/logos/logo-convenio-administracion.jpg` |
| 2 | cec | CEC | Colegio de Economistas | Convenio para la formación continua de economistas con certificaciones en gestión económica. | `frontend/src/assets/images/logos/logo-convenio-economistas.jpg` |
| 3 | cep-cr-xiii | CEP/CR XIII | Colegio de Enfermeros - Cajamarca | Alianza para capacitaciones en salud y gestión hospitalaria para el personal de enfermería. | `frontend/src/assets/images/logos/logo-convenio-enfermeros.png` |
| 4 | cep-cr-ii | CEP/CR II | Colegio de Enfermeros - La Libertad | Alianza para capacitaciones en salud y gestión hospitalaria para el personal de enfermería. | `frontend/src/assets/images/logos/logo-convenio-enfermeros.png` |
| 5 | isam | ISAM | Instituto ISAM | Alianza educativa con el ISAM para programas de formación y certificaciones de alto nivel. | `frontend/src/assets/images/logos/logo-convenio-isam.png` |

En TODOS: visible=true, descripcion_completa="", informacion_adicional="", fotos=[]. Los IDs, timestamps y logo_url se generarán solo al importar. Los dos colegios de Enfermeros usan el mismo archivo actual. No hay sexto convenio ni fotografías antiguas asociadas por suposición.

## Archivos de esta etapa

Creados:
- backend/migrations/20261002-create-convenios.sql
- backend/src/convenios/convenios.module.ts
- backend/src/convenios/convenios.controllers.ts
- backend/src/convenios/convenios.dto.ts
- backend/src/convenios/convenios.service.ts
- backend/src/convenios/convenios.import.ts
- backend/src/convenios/initial-content.ts
- backend/scripts/import-convenios.cjs
- backend/test/convenios.test.ts
- backend/test/convenios-import.test.ts
- backend/CONVENIOS.md
- frontend/src/types/convenios.ts
- frontend/src/components/home/HomeConvenioDialog.tsx
- frontend/src/components/home/HomeConvenioGallery.tsx
- frontend/src/panel/components/PanelConvenios.tsx
- frontend/src/panel/components/ConvenioEditor.tsx
- frontend/src/panel/components/ConvenioPhotosEditor.tsx
- frontend/src/panel/styles/convenios.css

Modificados (incluye archivos existentes en el trabajo previo, todavía sin commit):
- backend/prisma/schema.prisma
- backend/src/app.module.ts
- backend/scripts/migrate.cjs
- backend/scripts/check-database.cjs
- backend/package.json
- backend/test/prisma.integration.cjs
- backend/PRISMA.md
- frontend/src/pages/Home.tsx
- frontend/src/components/home/HomeHero.tsx
- frontend/src/components/home/HomeConvenios.tsx
- frontend/src/components/home/homeContent.ts
- frontend/src/panel/pages/AdminDashboard.tsx
- frontend/src/panel/components/ImageUpload.tsx
- frontend/src/contentUpdates.ts
- frontend/src/styles/home-redesign.css
- frontend/scripts/smoke-home.cjs
- frontend/docs/home-convenios-pendientes.md

Los cambios previos de CatalogoCursos, MainLayout, HomeWelcome, servicios, ubicación y otros componentes de Home se conservaron. No se modificaron otras páginas públicas ni AGENTS.md.

## Verificación

- Backend: tipos, build, pruebas unitarias y validación de DTOs, guards y vista previa; integración MySQL temporal con API real (sin importación inicial).
- Frontend: check, lint y build; Edge con fixtures aislados para CRUD del panel, uploads simples/múltiples, fotos, orden, visibilidad, borrado, errores/vacío, actualización entre pestañas, diálogo/foco/teclado, tamaños 320–1920 px y movimiento reducido.
- git diff --check y revisión de archivos nuevos.

La suite npm test con concurrencia por defecto agotó los 10 segundos de una prueba previa de compilación. Esa prueba pasó aislada; la suite completa pasó con node --test --test-concurrency=1 -r ts-node/register test/*.test.ts, sin cambiar reglas ni expectativas. Las comprobaciones de navegador no validan correo SMTP ni la base principal.
