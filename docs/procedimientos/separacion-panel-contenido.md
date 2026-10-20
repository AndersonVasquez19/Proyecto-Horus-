# Separación del panel operativo y la web institucional

Entrega local sobre `anderson`, base `6994691011d7e27fc11c0934d05094ab580f0b46` (19 de octubre de 2026). Sin commit, push, merge ni despliegue.

## Alcance implementado

El panel se centra en gestión académica y atención al usuario. Se retiraron los gestores editoriales de la navegación y del montaje de componentes, conservando sus archivos, endpoints y datos para compatibilidad. La web existente **todavía usa sus lecturas públicas NestJS**: se preparó un adaptador estático separado para que Carlos lo incorpore en su rama sin sobrescribir sus componentes. Esta entrega no es un corte definitivo del proveedor de contenido público.

No se consultó ni modificó `horus_db`, `horus_local`, Laravel ni la cuenta ID 14. Tampoco `.env`, Docker Compose, ramas de compañeros, `docs/diagramas`, uploads ni recursos institucionales previos. La existencia/aplicación de migraciones y el rol de la cuenta habitual son contexto aportado por el responsable, no una comprobación de esta entrega.

## Inventario de dependencias

| Superficie | Implementación y consumidores | Decisión |
| --- | --- | --- |
| Inicio `/` | `Home`, `HomeHero`, `HomeConvenios`, `HomeLocation`; GET convenios y settings | Componentes de Carlos intactos; adaptador preparado |
| Quiénes somos | `pages/QuienesSomos.tsx`; textos y fotos importadas desde código, redes desde settings | Intacto; conservar el contenido y recursos actuales |
| Asesoramiento | `pages/educacion/Asesoramiento.tsx`, componentes edu; GET servicios por categoría/presentación | Intacto; fuente estática compatible |
| Capacitaciones y cursos públicos | `CourseCatalog`, `CursoDetail`; GET cursos, `tipo`, página y detalle | Intactos; no usar IDs editoriales para operaciones académicas |
| Servicios tecnológicos | Páginas tecnologías, `ServiceList`, `CatalogoDetail`; GET servicios | Intactos; se conservan filtros y detalles |
| Galería | `Galeria`, `GalleryBand`, GET galeria y categorías | 61 fotos originales ya versionadas; sin copiar uploads |
| Convenios | Lista en Inicio, detalle integrado/diálogo, fotos | GET convenios y convenios/:id conservados |
| FAQ | Página con búsqueda, filtros y paginación; GET preguntas-frecuentes | No hay FAQ versionadas en la semilla: lista vacía, sin inventar |
| Contacto y redes | `CompanySettingsProvider`, Footer, Home, Contactos, `useSocialLinks` | Datos públicos estáticos preparados; formularios siguen en NestJS |
| Biblioteca | `admin_items`, ResourceManager; sin consumidor público institucional identificado | Gestor retirado, API protegida conservada |
| Chatbot | `ChatbotService`, `GuidedMenu`, `chatApi` | Se conserva el catálogo NestJS y sus IDs; no se cambia a la semilla |
| Estudiantes | `/api/admin/estudiantes`, detalle e historial | Conservados |
| Ediciones | `/api/admin/convocatorias`, selector `/convocatorias/cursos` | Conservados; el selector sigue leyendo cursos MySQL |
| Matrículas | `/api/admin/matriculas`, selector de ediciones, historial, anulación/reactivación | Conservados; sin cambios de cumplimiento ni cupos |
| Importación académica | `/api/admin/importaciones`, CSV con inspección, vista previa y confirmación | Conservada; etiqueta explícita CSV, URL heredada `section=importacion-excel` |
| Atención | Mensajes, `seguimiento/messages/:id`, historial, respuestas y cotizaciones | Conservados en su flujo actual; seguimiento dentro de Mensajes |
| Cuentas | Login, signup, JWT, `/admin/me`, contraseña y Roles y usuarios | Contratos y permisos intactos |

Las tablas editoriales son `cursos`, `servicios`, `preguntas_frecuentes`, `galeria_items`, `convenios`, `convenio_fotos`, `empresa_settings` y el andamiaje `admin_items`. No se ejecuta ninguna migración ni operación de eliminación sobre ellas.

La relación académica sigue siendo `cursos → convocatorias → matriculas → certificados`, junto a `estudiantes`, `academico_historial` e `importaciones_academicas`. Las claves foráneas restrictivas y los bloqueos de escritura de los módulos existentes no cambian. Retirar Cursos del menú editorial no elimina cursos ni modifica relaciones. Para crear ediciones se selecciona un curso existente; un futuro mantenimiento de nuevos cursos académicos requiere una pantalla operativa específica, no reintroducir el CMS público.

El historial académico permanece en los detalles de los módulos existentes. No se inventa una pantalla general de certificados, asistencia, calificaciones o historial sin una implementación real.

## Menú, rutas y permisos

| Grupo | Opciones |
| --- | --- |
| Principal | Resumen, sujeto a `estadisticas:leer`; cuenta básica: Mi espacio |
| Gestión académica | Estudiantes, Ediciones, Matrículas, Importación académica CSV |
| Atención al usuario | Mensajes (incluye seguimiento), Cotizaciones, Consultas del chatbot |
| Administración | Roles y usuarios, Mi cuenta |

Cotizaciones se conserva porque forma parte del flujo consulta → seguimiento → propuesta. Mi cuenta usa el autoservicio existente, sin permisos administrativos adicionales.

Se retiraron Educación/Asesoramiento/Capacitaciones/Cursos, Servicios tecnológicos, Galería de proyectos, FAQ editorial, Biblioteca, Convenios e Información de empresa/herramientas de publicación. `PANEL_SECTIONS.available=false` los excluye en ambos modos de sesión, incluso con todos sus permisos antiguos. Sus URL (`educacion`, `cursos`, `servicios`, `galeria`, `faq`, `contenido`, `convenios`, `ajustes`) conservan la dirección y muestran un aviso explicativo y un enlace al inicio. No se monta ningún gestor ni se consultan sus endpoints. Las rutas de Suscripciones/Reclamaciones continúan con su comportamiento previo de inicio por cuenta.

La matriz de roles, JWT, orden de guards globales, auditoría y decoradores de acceso no cambian. Secretaría sigue iniciando en Mensajes, sin consultar estadísticas ni importar CSV. Coordinación puede previsualizar importaciones; confirmar conserva su permiso propio. La cuenta básica solo tiene Mi espacio y Mi cuenta. Los enlaces y altas del resumen se filtran por los permisos recibidos, sin duplicar la matriz en React.

## Resumen operativo

Se reutiliza `GET /api/admin/stats?vista=operativa`, protegido por el mismo `estadisticas:leer`. Sin `vista`, el contrato anterior sigue disponible para otros consumidores. Una vista desconocida responde 400. No se añade un endpoint ni una migración.

La vista operativa hace cinco lecturas: COUNT de estudiantes, COUNT de ediciones abiertas sin archivar, agrupación de matrículas por estado, totales efectivos de atención y las cinco consultas recientes. No carga el catálogo, borradores, biblioteca, reclamaciones ni cuentas.

| Indicador | Definición |
| --- | --- |
| Total de estudiantes | Todas las fichas, incluidos archivados |
| Ediciones activas | `estado=abierta` y `archivado_at IS NULL` |
| Matrículas registradas | Activas + anuladas |
| Matrículas vigentes | `estado=activa`; no redefine cumplimiento |
| Consultas pendientes | Estado efectivo nuevo + en proceso, usando el seguimiento existente |

Los accesos son Registrar estudiante, Crear edición, Registrar matrícula, Importar CSV y Atender consultas. «Consultas por atender» enlaza las consultas nuevas, en seguimiento y archivadas (`/admin/messages?estado=archivado`, para consultar el historial o reabrir una atención, como exige D4). Se mantiene la actividad real de mensajes y cotizaciones por estado mediante `/admin/stats/actividad`. La actividad y los datos de atención solo se muestran si la cuenta puede abrir Mensajes. Carga: `…`; error o respuesta incompatible: `—`, aviso y reintento. Un backend antiguo que no entienda la nueva vista muestra ese aviso; no se inventan ceros.

Estilo limitado al panel con navy `#102D4F`, azul `#2554EB`, cian `#18BBD1`, dorado `#E8C477`, fondo `#F5F8FC` y tarjetas blancas. Montserrat local para títulos/menú/botones, Inter para texto. No se modifica el diseño de autenticación ni el sitio público. Fuente original y licencia: [Google Fonts / Montserrat](https://github.com/google/fonts/tree/main/ofl/montserrat), [OFL distribuida](../../frontend/public/licenses/Montserrat-OFL.txt). No se instaló ningún paquete.

## Integración de Carlos

> **Estado actual (integrada).** Los 11 consumidores públicos ya importan `useInstitutionalResource`. `catalog.ts` se regeneró como instantánea del contenido **publicado** de la base real (4 capacitaciones, 19 servicios, 4 convenios con foto, 61 fotos de galería, ajustes de empresa; FAQ vacía porque la base no tiene ninguna). Se excluyó el curso de prueba `test`. Los IDs coinciden con MySQL, de modo que los enlaces del chatbot apuntan al mismo elemento. Las 25 imágenes subidas desde el panel se copiaron a `frontend/public/contenido` (hash en [inventario-contenido-publicado.csv](inventario-contenido-publicado.csv)). Lo descrito a continuación sobre la semilla original es histórico.

`frontend/src/institutional/` contiene:

- `types.ts`: contratos basados en los tipos públicos existentes, sin Prisma.
- `catalog.ts`: contenido editorial tipado, mantenido desde código. Semilla de fuentes versionadas en el HEAD base, no exportación de MySQL: 19 servicios, 4 capacitaciones, 61 fotos, 5 convenios. Cursos específicos y FAQ quedan vacíos porque no hay una fuente versionada comprobada para copiarlos.
- `source.ts`: resuelve los cuatro logos originales mediante imports Vite (hash de build), sin duplicar archivos ni usar rutas de Windows.
- `read.ts`: lectura local con filtros, búsqueda sin tildes, orden, paginación, categorías de galería y detalle por ID o slug. Copias de respuesta independientes; 404/400 controlados. Sin fetch, storage, sesión ni entorno.
- `useInstitutionalResource.ts`: forma compatible con `usePublicResource` para adaptar consumidores públicos sin red.

Los datos públicos de empresa proceden de los valores ya escritos en Footer: no son una lectura de la configuración actual de MySQL. Horarios y redes no confirmados permanecen vacíos y conservan los estados alternativos actuales. Los textos de Inicio, Quiénes somos y los encabezados institucionales ya están en código; no se duplican sus componentes ni se copian retratos/documentos privados.

Integración concreta: en los consumidores editoriales, sustituir únicamente el import por `import { useInstitutionalResource as usePublicResource } from '<ruta>/institutional/useInstitutionalResource'`. Incluye Home, detalles de convenios, CompanySettingsProvider, páginas de catálogo/detalle, CourseCatalog, componentes de asesoramiento/cableado/lista de servicios, Galeria/GalleryBand y FAQ. El smoke estático genera la lista exacta en `.artifacts/institutional-static/adapted-consumers.json` y demuestra esta adaptación en una compilación aparte, sin editar esos componentes. Repetir la comprobación sobre su rama y revisar su diseño antes de integrar.

**No sustituir globalmente `publicRequest`, `usePublicResource`, `API_BASE` ni la configuración NestJS/Laravel.** El cliente público también sirve formularios y GuidedMenu del chatbot, que deben conservar sus endpoints reales. No cambiar los IDs académicos con los editoriales de esta semilla.

Antes del corte público, Carlos debe revisar las diferencias con el contenido editorial que exista en la base real mediante un inventario explícitamente autorizado. Esta semilla conserva el contenido original versionado; no garantiza incorporar ediciones posteriores guardadas en MySQL. También debe resolver los enlaces del chatbot antes de cambiar los detalles públicos: hoy sus fuentes usan IDs de MySQL que pueden coincidir con otro elemento de la semilla.

## Imágenes y conservación

Las 61 rutas `/galeria/...` ya existen en `frontend/public/galeria` y coinciden con el inventario original. Los cuatro recursos `/site-original/categoria*` también están versionados. Los logos se importan desde `frontend/src/assets/images/logos`. El [inventario de 69 recursos con SHA-256](inventario-imagenes-institucionales.csv) comprueba que todos están versionados. No se elimina ni copia ningún upload.

Los uploads adicionales o imágenes editoriales posteriores requieren otro inventario: identificar solo referencias públicas aprobadas, verificar archivo/tipo/licencia, copiar a un destino versionado nuevo, registrar hash/origen y revisar enlaces. No copiar carpetas enteras de MySQL, backups, documentos o directorios personales. `/api/uploads` sigue operativo para los consumidores heredados, pero no forma parte de la semilla estática. No se cambian rutas de imágenes en MySQL.

## Chatbot y autenticación

El chatbot conserva búsquedas publicadas sobre cursos, servicios y FAQ, convenios visibles y claves públicas de contacto. Se mantienen ranking, redacción de datos, métricas, retención, consentimiento y registro de consultas. No se introduce IA externa. Su menú guiado continúa consultando NestJS y usando sus IDs reales.

La fuente institucional única para web y recuperación del chatbot es una fase posterior: acordar un documento público versionado y un identificador editorial estable (preferiblemente slug), un adaptador NestJS de solo lectura y correspondencias de enlaces públicos, sin usar esos identificadores como claves académicas. Retirar el catálogo del chatbot ahora mezclaría datos/IDs y ampliaría la arquitectura; por eso no se hace en esta entrega. Hasta ese corte no deben editarse por separado el contenido estático y el catálogo de respuestas sin revisar su coherencia.

Cristopher no tiene cambios que incorporar en Login/Register: no se editaron sus páginas, layout ni estilos. Se conservan el retorno tras login, el contrato completo de sesión y `/admin/me`, el registro sin rol y la diferencia 401/403. Su rama solo debe validar que los accesos que incorpore apunten a secciones operativas o Mi cuenta, sin recuperar enlaces editoriales. No se realizó ningún merge.

## Verificación y entrega

Capturas y logs locales en `frontend/.artifacts/`, ignorados por Git y con datos ficticios. Las capturas no son evidencia de cuentas o datos habituales.

Verificación final (20 de octubre de 2026, Node 24.19 local; los paquetes declaran 22.x), ejecutada en serie y sin `horus_db`, `horus_local` ni `.env`:

- Backend: `tsc --noEmit`, `npm test` (438/438) y `npm run build`.
- Integraciones con MySQL 8.4 desechable (un contenedor propio por suite, retirado al terminar), incluido el recorrido React ↔ NestJS ↔ MySQL en escritorio y móvil: Estudiantes (8/8), Ediciones (11/11), Matrículas con el resumen operativo (17/17), AccessGuard HTTP (28/28) e Importaciones (16/16).
- Frontend: `check`, `lint`, `build`, las 17 pruebas `test:*` y las pruebas puras nuevas.
- Navegador: 25 smokes con API simulada. Pasan todos. `smoke-panel-sections` y `smoke-ui` aprobaron sus comprobaciones funcionales pero terminaron una vez con código 1 por EPERM en la limpieza del perfil de Edge; al repetirlos solos terminaron con código 0.

Correcciones sobre la entrega inicial: se recuperó el enlace a consultas archivadas del Resumen (D4) y la cobertura de atención/cotizaciones de `smoke-panel-actions`; ocho smokes que dependían de gestores retirados se adaptaron a secciones vigentes sin reducir lo que comprueban; ESLint ignora `.artifacts/` (allí compila `smoke-institutional-static`); «Ajustes» pasó a llamarse «Mi cuenta» en todo el panel.

EPERM al borrar perfiles de Edge: es intermitente y solo de limpieza. `smoke-stop-browser.ps1` confirma el cierre de todo el árbol de procesos del perfil antes de borrarlo, y `removeProfile` reintenta al menos 15 s; aun así, Windows mantuvo a veces el directorio bloqueado más tiempo y el reintento de salida lo eliminó después. No quedan perfiles ni procesos de Edge de las pruebas. Desde esta entrega, si el borrado vuelve a fallar, `smoke-cleanup.cjs` añade al error el resultado de `smoke-profile-locks.ps1` (Restart Manager de Windows, solo lectura) con los procesos que mantengan archivos del perfil abiertos; el smoke sigue fallando. No se amplió el plazo de reintento.

### Archivos de esta entrega

| Zona | Modificados | Nuevos |
| --- | --- | --- |
| Backend | `src/admin/stats/stats.controller.ts`, `src/admin/stats/stats.service.ts`, `test/matriculas.integration.cjs` | `src/admin/stats/dashboard-query.dto.ts`, `test/stats-operational.test.ts` |
| Panel React | `src/panel/pages/AdminDashboard.tsx`, `src/panel/components/PanelOverview.tsx`, `PanelImportations.tsx`, `src/panel/context/panelAccess.ts` | `src/panel/services/operationalStats.ts`, `src/panel/styles/operational-panel.css`, `src/panel/assets/fonts/Montserrat-Variable.ttf` |
| Fuente institucional | Ningún componente de Carlos | Los cinco módulos de `src/institutional/` descritos arriba |
| Pruebas frontend | `tests/panel-access.test.mjs`; scripts `smoke-panel-access`, `smoke-panel-actions`, `smoke-panel-sections`, `smoke-signup`, `smoke-home`, `smoke-ui`, `smoke-global-content` | `tests/institutional-content.test.mjs`, `tests/operational-stats.test.mjs`, `scripts/smoke-institutional-static.cjs` |
| Verificación/documentación | `.github/workflows/ci.yml`: añade las dos nuevas pruebas puras al job frontend | Esta guía, `inventario-imagenes-institucionales.csv`, `frontend/public/licenses/Montserrat-OFL.txt` |

Cierre de la entrega (además de lo anterior): `frontend/src/panel/components/PanelOverview.tsx` (consultas archivadas), `PanelPreferences.tsx`, `PanelBasicHome.tsx` y `PanelAccessNotice.tsx` («Mi cuenta»), un comentario de `workspace/MessageInbox.tsx`, `frontend/eslint.config.js`, `frontend/scripts/smoke-cleanup.cjs` y el nuevo `smoke-profile-locks.ps1` (diagnóstico del EPERM), los smokes `smoke-panel-actions`, `smoke-session-access`, `smoke-unsaved`, `smoke-messages-table`, `smoke-message-center`, `smoke-attention-conflicts`, `smoke-panel-toasts`, `smoke-home` y `smoke-ui`, y la documentación `AGENTS.md`, `README.md` y `frontend/README.md`.

Los scripts y logs auxiliares creados en `frontend/.artifacts/` son locales e ignorados. El documento previo sin seguimiento `docs/procedimientos/activacion-academica-mysql-ensayo.md` pertenece al trabajo anterior y se conserva sin incorporarlo a esta entrega.
