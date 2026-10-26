# Gestión de estudiantes — NestJS y React

## Alcance y contrato

Primera entrega académica: registro, lista paginada, búsqueda por nombres/apellidos/DNI, detalle, edición y archivo reversible. Usa `Estudiante` existente sin alterar Prisma ni SQL. No incluye convocatorias, matrículas, importaciones ni certificados.

API privada bajo `/api/admin/estudiantes`: GET lista y GET `/:id` (`estudiantes:leer`), POST (`estudiantes:crear`), PUT `/:id` (`estudiantes:editar`), PUT `/:id/archivo` (`estudiantes:archivar`, para archivar y restaurar). No hay DELETE. Todas las rutas usan JWT y AccessGuard vigente.

Las altas requieren nombres, apellidos y DNI peruano de ocho dígitos ASCII (texto, conserva ceros iniciales). Contacto opcional: correo hasta 254 y teléfono hasta 30 caracteres. Cadena vacía limpia contacto; `null` se rechaza. El DNI fija país PE y tipo DNI en el servidor; no comprueba identidad ante RENIEC. Los contactos compartidos son válidos; el DNI es único también entre archivados. Los registros heredados sin documento se conservan.

Lista: `page` (1 por defecto), `limit` (20, máximo 100), `search` (máximo 100), `estado=activos|archivados|todos` (activos por defecto). Respuesta `{ok,items,pagination:{page,limit,total,pages}}`. Detalle/escrituras: `{ok,item}`. Edición exige `revision`; archivo exige `{revision,archivado:boolean}`. La actualización condicional y el incremento de revisión se ejecutan en transacción: 409 conserva el borrador y exige consultar la versión vigente; 404 para ID inexistente. El esquema incompleto responde 503 sin corregirse automáticamente.

La pantalla `/admin/dashboard?section=estudiantes` usa `panelRequest`, diálogos, notificaciones y protección de cambios pendientes existentes. La navegación y las acciones reutilizan permisos del backend. La secretaria mantiene crear/leer, coordinadora y gerente mantienen los permisos previamente definidos; ninguna cuenta básica obtiene acceso. La nueva apariencia se limita al panel: azul, blanco, gris claro y cian, con Inter/Manrope ya autoalojadas.

## Plan de ejecución

1. Escribir y ejecutar pruebas de contrato HTTP y persistencia en MySQL aislado; comprobar primero el fallo por ausencia de rutas.
2. Implementar DTO, servicio, controlador y módulo; registrar rutas y permisos sin modificar la matriz de roles.
3. Implementar cliente/formulario, pantalla y navegación; comprobar validaciones, permisos, borradores y respuestas fuera de orden.
4. Aplicar la base visual del panel conservando sus componentes y rutas.
5. Ejecutar tipos, suites relevantes, build, navegador y revisión del diff. Registrar evidencia y límites.

## Límites operativos

No modificar Laravel, SQLite, `.env`, bases habituales, Docker ni cuentas reales. No instalar dependencias, hacer commit/push o desplegar. Las pruebas MySQL exigen habilitación y UUID explícitos; crean solo `horus_estudiantes_it_<24 hex>`, copian estructura sin datos desde una plantilla local autorizada y conservan la base de prueba al finalizar (no borran tablas ni bases). Las cuentas y estudiantes de prueba viven únicamente allí.

No se ha cambiado el servicio de Docker: la entrega de código requiere un arranque posterior autorizado para aparecer en esa instalación. La disponibilidad local exige servidor web, API y MySQL. Una prueba con tráfico externo bloqueado no equivale a disponer de una PWA ni a trabajar sin esos servicios.

## Reproducir las pruebas

Sin MySQL: desde `backend/`, `node --test -r ./test/isolate-env.cjs -r ts-node/register test/estudiantes.test.ts test/permissions.test.ts`. Desde `frontend/`, `npm run test:students`, `npm run test:panel-access`, `npm run check`, `npm run lint` y `npm run build`.

Navegador con API simulada: tras compilar frontend y backend, `node scripts/smoke-estudiantes.cjs` desde `frontend/`. Comprueba validación, doble envío, búsqueda, paginación, detalle, edición, archivo/restauración, vacío, carga, error y reintento, borrador ante 409, confirmación de descarte, permisos y viewport de 390 px. Bloquea destinos externos antes de enviarlos; no envía correo.

Integración real: configurar **solo en el proceso de prueba** `DB_HOST` de bucle local, `DB_PORT`, `DB_USER`, `DB_PASS`, `STUDENTS_TEST_DB=true`, `STUDENTS_TEST_TEMPLATE=horus_db` (o `horus_local`) y `STUDENTS_TEST_SERVER_UUID` con el UUID previamente comprobado. No registrar contraseñas en comandos compartidos ni modificar `.env`. Ejecutar desde `backend/`:

```powershell
node --test -r ./test/isolate-env.cjs test/estudiantes.integration.cjs
```

Con `STUDENTS_BROWSER=true`, esa misma integración inicia además Edge con React compilado, una API NestJS hija y la base aislada recién creada. El navegador usa cuentas ficticias de esa base, nunca una sesión real. El destino y la contraseña se reciben exclusivamente por IPC del padre de integración; el smoke rechaza `STUDENTS_API_URL` antes de abrir el navegador o enviar solicitudes. `STUDENTS_SCREENSHOTS_DIR` permite guardar capturas de escritorio y móvil.

El arranque API usa un directorio temporal sin `.env` y el fixture de AccessGuard existente, con sus guards reales. La base se conserva e informa su nombre para revisar evidencia; no existe limpieza automática de tablas. Copiar estructura mediante `CREATE TABLE LIKE` conserva columnas/índices/CHECK, pero no clona claves foráneas: esta prueba verifica estudiantes (sin FK propia), no la integridad de futuras matrículas.

## Evidencia de esta entrega (18 de octubre de 2026)

- Docker confirmado en lectura: `horus_local`, un gerente activo y cero estudiantes. No se probó el login personal del gerente ni se actualizó la imagen en ejecución.
- MySQL de prueba: servidor local MySQL 8.0.46; se crearon bases `horus_estudiantes_it_*` sin migrar la plantilla. No equivale a una integración nueva contra MySQL 8.4 de Docker.
- Integración HTTP y navegador con API/Prisma/MySQL reales: correctos. Alta con DNI, duplicado simultáneo (201/409), edición, archivo/restauración, búsqueda, paginación, 400/401/403/404/409, contenido público y chatbot. Capturas revisadas en escritorio y móvil.
- Las 110 pruebas unitarias del frontend y las cinco pruebas unitarias nuevas del backend pasan. Builds de ambos paquetes y comprobación de tipos correctos. El entorno proporciona Node 24.19.0, aunque los paquetes declaran Node 22.x; no se instaló otra versión.
- La primera suite completa del backend dio 420/422: se incorporó el controlador de estudiantes al inventario manual del test (24/24 al repetir) y `build-output` tuvo un timeout intermitente de 10 s (2/2 al repetir sin la suite pesada en paralelo). No se ampliaron límites ni desactivaron comprobaciones.
- La repetición completa terminó en **422/422** con `node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register/transpile-only test/*.test.ts`; los tipos se comprobaron por separado con `tsc --noEmit --incremental false`. No se cambió el comando del proyecto ni se omitieron pruebas.
- Las solicitudes externas se bloquearon durante ambos smokes de estudiantes y no se solicitaron recursos externos. Esto demuestra este flujo local con servicios disponibles; no se ha probado una desconexión física ni una PWA.
- En varias ejecuciones de navegador las aserciones funcionales pasaron pero la limpieza de Edge falló por `EPERM` o por no poder acreditar un proceso secundario. Se conservaron esos perfiles, sin debilitar la limpieza ni cerrar navegadores ajenos. La integración real final terminó con código 0.
- Los smokes finales con API simulada, integración real por IPC y navegación por permisos terminaron con código 0. El borrador bloqueado se puede enfocar y copiar mediante teclado. La revisión independiente de solo lectura confirmó corregidos los hallazgos de accesibilidad y aislamiento del smoke.
- La comprobación final en lectura encontró cero estudiantes en `horus_db` y diez bases `horus_estudiantes_it_*` conservadas. La base de la integración final fue `horus_estudiantes_it_49fe1a67fbd630544b43c27f`. Ninguna fue eliminada; su limpieza posterior queda fuera de esta entrega.

La siguiente fase es convocatorias vinculadas al curso existente. No se ha implementado ni iniciado en esta entrega.

## Inventario de archivos

Creados:

- `backend/src/estudiantes/estudiantes.dto.ts`, `estudiantes.service.ts`, `estudiantes.controller.ts`, `estudiantes.module.ts`.
- `backend/test/estudiantes.test.ts` y `estudiantes.integration.cjs`.
- `frontend/src/panel/components/PanelStudents.tsx` y `StudentEditor.tsx`.
- `frontend/src/panel/services/students.ts` y `frontend/src/panel/styles/academic-panel.css`.
- `frontend/tests/students.test.mjs` y `frontend/scripts/smoke-estudiantes.cjs`.
- Este procedimiento.

Modificados para integrar y verificar:

- `backend/src/app.module.ts`, `backend/src/permissions/permissions.ts` y `route-inventory.ts`.
- `backend/test/permissions.test.ts` y `backend/test/fixtures/access-guard-app.cjs` (informa también el puerto de la API de prueba).
- `frontend/src/panel/context/panelAccess.ts` y `frontend/src/panel/pages/AdminDashboard.tsx`.
- `frontend/package.json`, `frontend/tests/panel-access.test.mjs`, `frontend/scripts/smoke-panel-access.cjs` y `frontend/scripts/smoke-kit.cjs` (argumentos opcionales del navegador para ejecutar sin extensiones; conserva verificación y limpieza de procesos).

El cambio previo en `.gitignore` se conservó y no forma parte de esta entrega. No se modificó el esquema Prisma ni se añadió SQL o dependencias.
