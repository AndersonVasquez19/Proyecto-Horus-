# Proyecto Horus

Sitio institucional y panel de Horus Group SRL. Frontend React/TypeScript/Vite; API NestJS con Prisma y MySQL. Hay dos paquetes npm independientes y sus lockfiles. Usa Node.js 22.x y npm.

## Funciones

- Cursos y capacitaciones separados, búsqueda, modalidad, paginación y detalle con temario.
- Servicios publicados por categoría, detalle y consultas con el asunto seleccionado.
- Galería activa y preguntas frecuentes publicadas en MySQL (sin gestión desde el panel desde la separación del contenido institucional).
- Panel centrado en gestión académica (estudiantes, ediciones, matrículas e importación CSV), atención al usuario y cuentas. El contenido institucional lo mantiene el equipo web desde el código; ver [docs/procedimientos/separacion-panel-contenido.md](docs/procedimientos/separacion-panel-contenido.md).
- Ajustes públicos de contacto y pie de página. Los valores vacíos conservan el contenido institucional existente, pendiente de confirmación de la empresa.
- Consultas y reclamaciones con responsable, notas, respuesta, historial y revisión para evitar sobrescrituras.
- Cotizaciones con importes calculados en el backend, borradores, seguimiento de estados, correo e impresión para guardar PDF.
- Newsletter con consentimiento y enlace firmado de baja.
- Carga administrativa de imágenes PNG/JPEG/WebP, hasta 5 MB.
- Login, recuperación/cambio de contraseña, desactivación de cuentas y revocación de sesiones. Registro público en `/admin/register` (`POST /api/admin/signup`): la cuenta nace sin rol, puede iniciar sesión de inmediato y entra en «Mi espacio» (sus datos y su contraseña), sin permisos administrativos. El gerente asigna, cambia o retira roles desde «Roles y usuarios» (o con `npm run admin:assign-role`); el backend sigue autorizando con JWT, AccessGuard y RBAC. El alta hecha por un administrador exige sesión y `cuentas:crear`; el primero se crea con `npm run admin:create`.
- Chatbot basado en contenido publicado y ajustes públicos conocidos, con IA opcional y cuotas compartidas en MySQL.

Las secciones de cableado, cámaras, soporte, asesoramiento y capacitaciones conservan sus diseños originales con los datos publicados en MySQL; el panel ya no los edita. La galería utiliza fotos activas en sus franjas animadas y filtros. Guardar contenido actualiza una web abierta en otra pestaña del mismo navegador; otros visitantes ven los cambios en su siguiente consulta.

Market no forma parte de este proyecto: la ruta antigua /market redirige al inicio y no hay compras, pagos ni inscripciones automáticas. La biblioteca de contenido es interna al panel.

## Preparación

En `backend/`, ejecutar `npm ci` y configurar `.env` desde `.env.example`. Las variables de conexión son `DB_*`; el cliente Prisma se genera sin conectarse a MySQL.

Para una base existente, respaldar y revisar `npm run db:check`, aplicar las migraciones pendientes mediante `npm run db:migrate` y repetir la comprobación. Para una base completamente vacía, ejecutar antes `npm run db:init`. Estos pasos son explícitos y no forman parte del arranque ni del build.

La migración `20261002-complete-institutional` añade acceso de cuentas, consentimiento de suscripciones, seguimiento, cuotas y una referencia protegida entre cotizaciones y contactos. Los enlaces antiguos a contactos inexistentes se convierten en `null`; las cotizaciones se conservan. Revisar el destino antes de ejecutarla.

La migración `20261002-original-design` añade los campos de presentación de servicios y programas, y un identificador estable para recuperar contenido sin sobrescribir ediciones. Los programas de capacitación pueden dejar modalidad y duración pendientes; los cursos siguen exigiendo ambas.

El panel ya no ofrece **Recuperar contenido original** (se retiraron sus secciones editoriales); el endpoint autenticado se conserva. La recuperación solo importa contenido que existía en la revisión `fb2880b`; conserva registros existentes, ediciones y estados, incluidos archivados. No modifica los ajustes institucionales. En MySQL local de desarrollo, `npm run content:restore` es la alternativa explícita, después del build y las migraciones. No se ejecuta al arrancar ni al consultar la web.

Configurar el correo con `MAIL_PROVIDER` (`resend` o `gmail`) según `backend/MAIL.md`. En producción, montar un volumen persistente y configurar `UPLOAD_DIR`. Sin almacenamiento persistente configurado, la carga de imágenes en producción responde con un error explícito.

## Desarrollo

Desde `backend/`: `npm run start:dev`. API en `http://localhost:3000/api`; Swagger en `/api/docs` solo en desarrollo (en producción está apagado salvo `SWAGGER_ENABLED=true`, con HTTPS y cuenta de administrador). El healthcheck es `/api/health`.

Desde `frontend/`: `npm ci` y `npm run dev`. Vite redirige `/api` al backend. `VITE_API_BASE_URL` permite utilizar otra URL de API.

El panel está en `/admin/dashboard`. El acceso es por `/admin/login`; `/admin/register` es el registro público: la cuenta creada inicia sesión y usa «Mi espacio», pero no obtiene funciones administrativas sin un rol asignado. Cada cuenta con rol ve las secciones y operaciones de su rol.

## Verificación

Backend: revisión de tipos con `node node_modules/typescript/bin/tsc --noEmit --incremental false`, `npm test`, `npm run build` y `npm run test:integration`. La integración utiliza una base temporal local y la elimina; no migra la base original. Para un destino remoto de pruebas autorizado, establecer `ALLOW_INTEGRATION_DB=true`.

Si el entorno no soporta varias compilaciones simultáneas, ejecutar `node --test --test-concurrency=1 -r ts-node/register test/*.test.ts`.

Frontend: `npm run check`, `npm run lint`, `npm run build`, `npm run test:deploy` y `node scripts/smoke-ui.cjs` después de compilar ambos paquetes. La revisión de UI usa Edge/Chromium y respuestas HTTP de prueba aisladas; puede configurarse su ejecutable con `SMOKE_BROWSER`.

## Despliegue y documentación

[Railway](RAILWAY.md) documenta frontend con Caddy, API privada y MySQL. [Prisma](backend/PRISMA.md), [backend](backend/README.md), [frontend](frontend/README.md) y [panel/chatbot](frontend/PANEL-Y-CHATBOT.md) describen contratos y preparación. Los planes anteriores son documentación histórica.

Antes de presentar: confirmar los datos institucionales con la empresa, revisar/publicar contenido real, aplicar la migración revisada al destino elegido, configurar correo y almacenamiento persistente y probar la entrega SMTP en ese entorno.

## Equipo

Proyecto académico de Ingeniería de Software: Anderson Vásquez, Cristopher Pulache y Carlos Castope.

### Contenido compartido entre administradores y visitantes

Todos los administradores consultan el mismo backend y las mismas tablas MySQL. Crear una cuenta no crea un catálogo ni una base independientes. Para compartir contenido entre equipos, accede a la URL pública del mismo frontend; todas las instancias del backend deben usar el mismo destino `DB_*`. El proxy `/api` y la alternativa `VITE_API_BASE_URL` se describen en [Railway](RAILWAY.md).

Guarda el contenido y marca cursos, servicios y preguntas como **publicado**, galerías como **activo** y convenios como **visible**. Los borradores son compartidos entre administradores, pero no se muestran a visitantes. Consultas, reclamaciones, suscripciones y cotizaciones permanecen protegidas.

`localStorage` conserva únicamente el token de sesión y un marcador de cambios para refrescar otras pestañas. No almacena el contenido del panel. Cada carga consulta la API; los cambios desde otro equipo se ven al entrar o actualizar la sección. Si el navegador bloquea el almacenamiento, la página pública funciona y la sesión iniciada se mantiene solo durante la navegación actual.

Los uploads del proxy se guardan como `/api/uploads/<archivo>`, evitando enlaces dependientes de `localhost`. Las respuestas de contenido resuelven las rutas de uploads contra la API configurada y los antiguos enlaces de uploads de loopback, sin modificar MySQL ni los enlaces externos. El backend necesita un `UPLOAD_DIR` persistente, compartido si tiene varias instancias.

Verificación adicional: desde `frontend/`, después de compilar, ejecuta `node scripts/smoke-global-content.cjs`. Revisa dos sesiones de navegador aisladas y un visitante con storage bloqueado mediante fixtures HTTP. La prueba de persistencia real entre administradores y tras reiniciar la API forma parte de `backend/test/prisma.integration.cjs` y utiliza una base temporal local.
