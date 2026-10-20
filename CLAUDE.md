# CLAUDE.md — Cómo trabaja Claude Code en Proyecto Horus

Responde siempre en español, incluidas las explicaciones, los resúmenes y los mensajes de commit propuestos, salvo que el usuario pida expresamente otro idioma.

`AGENTS.md` describe la arquitectura, las tecnologías, los comandos y las convenciones técnicas del repositorio: léelo antes de trabajar y no lo dupliques aquí. Este archivo fija **cómo trabajar**: método, seguridad operativa, pruebas, procesos, Git e informes. Si ambos se contradicen, aplica la regla más restrictiva en seguridad y avisa de la contradicción. Las instrucciones explícitas del usuario tienen prioridad sobre los dos.

Estas reglas generales abarcan todo el proyecto. En `backend-laravel/`, sus `AGENTS.md` y `CLAUDE.md` las complementan: Eloquent es el ORM principal de Laravel; las instrucciones de Prisma/NestJS y React/npm se limitan a sus paquetes. No instales Laravel Boost ni herramientas automáticamente ni modifiques proyectos vecinos fuera del alcance autorizado. Tampoco ejecutes migraciones o cambios de datos sin autorización explícita y destino comprobado; los commits y pushes siguen requiriendo autorización explícita.

## 1. Comunicación

- Sé claro, concreto y profesional; explica las decisiones que importan y evita mensajes de progreso repetitivos.
- Distingue siempre entre **ejecutado**, **simulado** (fixtures/mocks) e **inspección estática**. No afirmes que algo funciona si no lo probaste, ni que un smoke cubre lo que no ejecutó.
- Si una limitación te impide terminar, dilo. Comunica los riesgos importantes **antes** de ampliar el alcance.
- Informa de contradicciones entre instrucciones antes de resolverlas por tu cuenta si afectan al resultado.

## 2. Flujo de trabajo

1. Entiende la solicitud y lee las instrucciones aplicables (`AGENTS.md`, este archivo, la documentación del módulo).
2. Revisa `git status --short` y la rama; conserva los cambios ajenos.
3. Localiza archivos, contratos y consumidores afectados (backend ↔ frontend, tests, scripts).
4. Planifica en proporción al riesgo e implementa el cambio mínimo que resuelva el problema por completo.
5. Prueba (sección 8), revisa el diff y entrega el informe (sección 12).

Para una tarea pequeña basta un flujo corto: no exijas un plan largo para cambiar una línea. No hagas refactorizaciones, formateos masivos ni rediseños fuera del alcance; no añadas dependencias sin justificarlo; no toques archivos de otras personas salvo que la tarea lo requiera.

## 3. Seguridad y secretos

- Nunca imprimas ni expongas API Keys, contraseñas, JWT ni tokens de recuperación; tampoco en código, pruebas, registros, capturas o informes. No vuelques configuraciones completas ni respuestas HTTP con cabeceras sensibles.
- No abras `.env` sin necesidad. Si una tarea requiere configuración, comprueba **presencia y validez sin mostrar valores** (por ejemplo, un booleano o el dominio enmascarado). No modifiques `.env` salvo petición expresa.
- Las pruebas usan variables y datos ficticios.
- **Incidente real:** importar `@prisma/client` carga `backend/.env` en `process.env`, y una prueba imprimió la API Key de Resend. Por eso las pruebas del backend se ejecutan **siempre** con `-r ./test/isolate-env.cjs` (lo hace `npm test`), con configuración propia en lugar de `ConfigService`, y las aserciones no deben imprimir objetos de configuración. Un archivo de prueba suelto, sin esa precarga, solo se ejecuta con un entorno explícitamente ficticio. El comando serial de `AGENTS.md` omite la precarga: añádela (`node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/*.test.ts`).
- Si un secreto se expone por accidente: detén la acción, avisa en el momento y recomienda rotarlo.
- Conserva JWT, guards, CORS, CSP y límites de frecuencia. No reabras el registro público de administradores sin autorización explícita. No guardes datos personales de más.

## 4. Backend, datos y correo

- Antes de tocar el backend revisa contratos y consumidores; mantén los endpoints, la validación y el manejo seguro de errores (sin detalles internos al usuario) y las reglas de autenticación.
- **Datos:** no ejecutes migraciones, `db:init`, `db:migrate`, `admin:create`, `content:restore`, `convenios:import --apply`, `chatbot:purge` (sin `--dry-run`), `uploads:restore --yes` ni `test:integration` sin autorización expresa y sin comprobar el destino. No borres, reinicialices ni sobrescribas bases de datos; no uses MySQL real en pruebas automatizadas; no alteres relaciones ni elimines historiales por comodidad.
- **Correo:** no envíes correo real en pruebas ni uses destinatarios reales; simula Gmail y Resend. Un envío de resultado incierto (timeout, red, respuesta ilegible) **no se reintenta automáticamente**. «Aceptado por el proveedor» no es «entregado». Respeta el proveedor elegido con `MAIL_PROVIDER` sin fallback silencioso (ver `backend/MAIL.md`). Un envío real de prueba exige autorización explícita, un único destinatario autorizado y un solo intento.

## 5. Frontend, UX y accesibilidad

Mantén la identidad navy/dorado, las tipografías y los componentes del panel, el diseño responsive, la navegación por teclado, el foco accesible, los estados de carga/error y los mensajes claros en español.

- No muestres mensajes técnicos crudos del backend. No declares éxito hasta confirmar la operación.
- Evita dobles envíos (bloqueo síncrono), maneja timeouts y cancelaciones, y evita que una respuesta antigua pise datos recientes.
- No guardes contraseñas, tokens ni borradores sensibles en `localStorage`/`sessionStorage`.
- No introduzcas notificaciones duplicadas ni rediseñes secciones ajenas a la solicitud.
- Conserva la protección de cambios sin guardar del panel (`frontend/src/panel/unsaved/`) y no desmontes editores con borradores sin motivo de seguridad o confirmación.

## 6. Concurrencia y consistencia (Centro de Atención y similares)

Aplica estas reglas donde corresponda, no a todos los módulos:

- Usa las `revision` y el HTTP 409 existentes. No adoptes una revisión nueva sin comparar base, borrador local y versión remota (`frontend/src/panel/services/attentionMerge.ts`).
- No fusiones en silencio dos cambios distintos sobre el mismo campo: muestra el conflicto y deja elegir. No escribas automáticamente para «resolver» conflictos sin autorización del usuario.
- Conserva los borradores ante errores, recargas, filtros y paginación; un listado que carga, falla o cambia no debe desmontar un editor con datos pendientes.
- Controla las respuestas GET/PUT fuera de orden y distingue un conflicto real de un cambio no relacionado.

## 7. Dependencias y despliegue

- No añadas bibliotecas sin justificar su necesidad ni actualices versiones en bloque. Respeta Node 22.x en `backend/` y `frontend/`, y los requisitos y lockfiles propios de cada paquete; Laravel usa Composer.
- No modifiques Docker, Railway, Caddy ni variables de producción fuera del alcance, y no ejecutes despliegues reales sin autorización. Una prueba local no equivale a validar un despliegue.
- Documenta las variables de entorno necesarias sin incluir secretos.

## 8. Pruebas: estrategia proporcional

No ejecutes toda la suite tras cada cambio pequeño, pero tampoco omitas pruebas críticas para ahorrar tiempo.

| Nivel | Cuándo | Qué ejecutar |
| --- | --- | --- |
| 1 | Cambio pequeño | Comprobación estática, prueba unitaria específica y `git diff --check` |
| 2 | Cambio de un módulo | Lo anterior, más `check`, `lint` y `build` del paquete y los smokes relacionados |
| 3 | Transversal o de seguridad | Suite relevante completa, regresiones de autenticación/navegación/datos y pruebas de navegador |
| Docs | Solo documentación | Revisar coherencia y `git diff --check`; sin builds ni suites |

Scripts de `frontend/package.json` (comprueba que existan antes de citarlos): `check`, `lint`, `build`, `test:deploy`, `test:errors`, `test:content-source`, `test:return-path`, `test:list-records`, `test:attention-merge`, `test:mail-outcome`, `test:message-export`, `test:notify`, `test:session-access`, `test:panel-access`, `smoke:auth`, `smoke:session-access`, `smoke:panel-access`, `smoke:panel-actions`, `smoke:unsaved`, `smoke:messages-table`, `smoke:message-detail`, `smoke:message-center`, `smoke:attention-save`, `smoke:attention-conflicts`, `smoke:mail-attempts`, `smoke:message-responsive`, `smoke:quote-origin`, `smoke:panel-sections`, `smoke:panel-toasts`, `smoke:chatbot`, `test:signup-form`, `smoke:signup`, `test:account-roles`, `smoke:roles`; además `node scripts/smoke-ui.cjs`, `smoke-home.cjs` y `smoke-global-content.cjs`. Orientación según el área:

- Sesión, login, recuperación, `AdminRoute`/contexto de autenticación: `test:return-path`, `test:session-access`, `smoke:auth`, `smoke:session-access`, `smoke:unsaved`. Registro público (`/admin/register`, `POST /api/admin/signup`): `test:signup-form`, `smoke:signup` y, en el backend, `npm test` (`test/public-signup.test.ts`). «Roles y usuarios» (`PanelAccounts`, `PUT /api/admin/users/:id/rol`): `test:account-roles`, `test:panel-access`, `smoke:roles`, `smoke:panel-access` y, en el backend, `npm test` (`test/account-roles.test.ts`).
- Menú del panel, secciones visibles por permisos y enlaces directos (`panelAccess.ts`, `AdminDashboard`): `test:panel-access`, `smoke:panel-access`, `smoke:session-access`, `smoke:panel-sections`.
- Botones, formularios y operaciones por permisos (`RESOURCE_WRITE`, `PANEL_ACTIONS`, `usePanelAccess`): `test:panel-access`, `smoke:panel-actions`, y los smokes de la sección tocada (p. ej. `smoke:message-center`, `smoke:quote-origin`, `smoke:unsaved`).
- Bandeja de Mensajes, seguimiento, tabla de registros: `test:list-records`, `test:attention-merge`, `smoke:messages-table`, `smoke:message-detail`, `smoke:attention-conflicts`, `smoke:unsaved`.
- Centro de Atención (responsive, accesibilidad): `smoke:message-responsive`; relación Mensaje ↔ Cotización: `smoke:quote-origin`; secciones del panel, resumen y canales públicos conservados: `smoke:panel-sections`; notificaciones (Sonner): `test:notify` y `smoke:panel-toasts`. Chatbot y consultas sin respuesta: `smoke:chatbot` (y, en el backend, `npm test`).
- Router, páginas públicas, Home: `smoke-home`, `smoke-ui`, `smoke-global-content`, `test:deploy`.
- Errores públicos y formularios públicos: `test:errors`, `smoke-ui`.
- Backend (autenticación, correo, límites de frecuencia): `npm test` y `tsc --noEmit` en `backend/` (comando de `AGENTS.md`); `build` si cambia código compilado.
- Reportes académicos (`backend/src/reportes/`): `npm test` (`test/reportes.test.ts`) y, con Docker y la imagen local `mysql:8.4`, `npm run build` seguido de `node test/run-academic-isolated.cjs reportes` (contenedor propio y desechable).

Los smokes sirven `frontend/dist`: compila antes (`npm run build`) si cambió el código; los más recientes lo exigen y fallan si `dist` está desactualizado. Los scripts `smoke:*` con prefijo `npm run build &&` ya lo hacen.

Si una prueba falla: determina si fue el código, el entorno o un timeout; repítela **sola** antes de repetir la suite entera; no cambies expectativas ni aumentes timeouts para ocultar el fallo. Hay pruebas sensibles al tiempo y a la carga (la compilación del test de `build-output` del backend en paralelo, la bienvenida de `smoke-home`, alguna espera de `smoke-ui`): si fallan una vez y pasan al repetirlas, díselo al usuario como intermitencia, no como éxito oculto.

## 9. Aislamiento de las pruebas

- Prefiere mocks y datos ficticios; usa los mecanismos existentes (`test/isolate-env.cjs`, fixtures HTTP locales).
- En los smokes con API simulada **bloquea antes de enviar** cualquier destino que no sea el servidor local (interceptación de DevTools, p. ej. `scripts/smoke-unsaved.cjs`); no te limites a registrar peticiones después. Solo se toleran recursos estáticos públicos de la propia página (fuentes, iconos) y siempre en una lista cerrada y justificada.
- Evita cargar secretos por imports indirectos y no accedas a MySQL, Resend ni SMTP en pruebas simuladas.
- Una prueba que necesite servicios reales se documenta y se ejecuta solo con autorización expresa. No añadas dependencias de prueba sin justificarlas.

## 10. Procesos y rendimiento (Windows y Linux)

Un incidente dejó cientos de procesos de Edge huérfanos que agotaron la memoria y hicieron fallar compilaciones.

- Ejecuta las pruebas de navegador **en serie**; no lances varias suites pesadas a la vez.
- Cada prueba usa un perfil temporal propio (`horus-*`) y cierra **todo el árbol** de procesos que creó (en Windows `child.kill()` solo cierra el proceso raíz: usa `taskkill /PID <pid> /T /F`, como `killBrowser` en `scripts/smoke-auth.cjs`; en Linux `kill` del grupo), dentro de un cierre garantizado (`finally`/manejador de salida) y con timeouts razonables para servidores y procesos hijos.
- Tras una ejecución puedes comprobar sobrantes de **tus** pruebas por el perfil, por ejemplo: `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -match 'user-data-dir=[^ ]*horus-' }`. Cierra solo esos; nunca los navegadores ni aplicaciones del usuario. Borra únicamente los temporales que creaste.
- La corrección de la limpieza de Edge de los smokes (`scripts/smoke-cleanup.cjs` y `smoke-stop-browser.ps1`) está integrada en `anderson` y publicada en `origin/anderson` (commits `a716336` y `7b6cc2c`), todavía no en `main`. Aun así, en Windows el borrado del perfil puede fallar con `EPERM` unos segundos después de cerrar Edge: el smoke termina con código 1 y deja su perfil `horus-*`. No modifiques las ramas ni los worktrees de esa corrección, ni uses scripts de limpieza amplia; comprueba y borra solo lo que creó tu ejecución.
- No crees vigilantes ni monitores indefinidos o repetitivos. Si una validación se alarga, diagnostica primero qué proceso sigue activo y comunícalo en lugar de seguir esperando.

## 11. Git y colaboración

- No hagas commit ni push sin autorización explícita. Nunca `git reset --hard`, `git clean -fd` ni `git push --force`; no apliques ni elimines stashes ajenos; no descartes modificaciones existentes ni sobrescribas el trabajo de otras personas.
- Comprueba rama y estado antes de editar; no trabajes directamente en `main` si la tarea no lo requiere.
- Antes de entregar: `git diff --check`, revisión del diff y de los archivos nuevos, y `git status --short` (distingue tus cambios de los previos).
- Esas restricciones solo se levantan con una petición explícita y consciente del usuario.

## 12. Informes finales

Proporcionales a la tarea: una tarea simple lleva un resumen breve; no repitas informes automáticos sin información nueva. Para cambios importantes incluye: resumen; problemas encontrados; cambios aplicados; archivos modificados; **pruebas realmente ejecutadas** y sus resultados o fallos; limitaciones de la validación; riesgos pendientes; trabajo fuera de alcance; estado de Git; y si recomiendas hacer commit.

## 13. Notas del entorno de trabajo

- El repositorio vive en Windows con CRLF en varios archivos: no hagas reemplazos multilínea con `\n` desde scripts; usa la herramienta de edición.
- En Bash, las barras invertidas, comillas inversas y `$` se pierden dentro de heredocs y comillas: escribe archivos con las herramientas de escritura/edición, no con `cat <<EOF`.
- Las rutas `/tmp` de Git Bash no existen para Node en Windows: usa rutas relativas o el directorio temporal designado.
- Ten cuidado al encadenar con `&&` comandos que devuelven código 1 sin ser un error (por ejemplo `grep -c` sin coincidencias).
- Mantén `AGENTS.md` y este archivo coherentes con `package.json` cuando cambien los comandos; comprueba los scripts reales antes de citarlos.
