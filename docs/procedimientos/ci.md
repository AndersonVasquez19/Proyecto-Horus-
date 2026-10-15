# Integración continua (GitHub Actions)

Archivo: [.github/workflows/ci.yml](../../.github/workflows/ci.yml). Se ejecuta en `push` a `main` y `anderson`, en cada `pull_request` y a demanda (`workflow_dispatch`).
**Solo comprueba**: no despliega, no usa secretos de producción, no se conecta a Railway ni a la base real y no envía correo ni llama a IA (las pruebas usan dobles).

> **Estado de la validación remota**
>
> - **Ejecución anterior (commit `7bcb8f7`, rama `anderson`):** `Backend`, `Frontend` e `Integración (MySQL efímero)` terminaron en `success` y `Smokes` quedó omitido (es manual). Fue con la configuración **antigua**, que todavía tenía `continue-on-error: true` en `integration`; los pasos de ese trabajo también figuran como correctos, pero esa configuración ya no existe.
> - **Configuración actual:** `integration` ya **no** tiene `continue-on-error`, por lo que su fallo se propaga al resultado general. Esta configuración **aún no se ha ejecutado en GitHub**: hasta que una ejecución posterior termine correctamente, la CI actual **no está validada** de forma remota.
>
> Lo comprobado en local (no equivale a una ejecución remota):
>
> - El YAML se analizó con `js-yaml` 4.1 (solo sintaxis y estructura: **no** valida el esquema de GitHub Actions ni expresiones como `if:`; no había `actionlint` disponible).
> - Cada `npm run` del workflow existe en el `package.json` del paquete correspondiente (comprobación automática) y los `needs` apuntan a trabajos existentes.
> - Los comandos de `backend` y `frontend` se ejecutaron en local con **Node 24.19**; la CI usa 22.x. Bajo **Node 22.23** (imagen Docker del backend, repositorio montado de solo lectura) se comprobó: las 8 suites unitarias del frontend (46 pruebas), `tsc --noEmit` del backend y 32 pruebas del backend (las cinco suites añadidas en esta tarea: uploads, migraciones, idempotencia, retención y reclamaciones). **No** se ejecutó la suite completa del backend bajo Node 22 (inviable por la lentitud del montaje desde Windows) ni `build`.
> - `test:integration` pasó 17/17 contra un MySQL 8.4.11 desechable arrancado con los mismos argumentos que el trabajo `integration` (`--mysql-native-password=ON --authentication-policy=mysql_native_password`) y usuario root; el contenedor, la espera, el puerto 3306 y el entorno de Linux del runner **no** se reprodujeron.
> - Sin ejecutar: el YAML en un runner, la caché de `setup-node`, `docker run` en el runner, los smokes en Linux y la compilación bajo la carga de un runner (`build-output` tiene un límite de 10 s y ya falló una vez por carga local).

| Trabajo | Qué ejecuta (scripts reales de cada `package.json`) | Notas |
| --- | --- | --- |
| `backend` | `npm ci` · `tsc --noEmit` · pruebas en serie con la precarga `test/isolate-env.cjs` · `npm run build` | En serie para evitar la intermitencia por compilaciones simultáneas de `build-output`. Incluye `test/migrations.test.ts` (orden y seguridad de las migraciones SQL) |
| `frontend` | `npm ci` · `check` · `lint` · `test:deploy`, `test:errors`, `test:return-path`, `test:list-records`, `test:attention-merge`, `test:mail-outcome`, `test:message-export`, `test:notify`, `test:session-access`, `test:panel-access` · `build` | Node 22.x, como declaran los `engines` |
| `integration` | MySQL 8.4 efímero en el runner (`docker run`, solo `127.0.0.1`, contraseña de un solo uso que no es un secreto), `npm run test:integration` y, en un paso aparte, `node --test test/backup-collation.integration.cjs` con `BACKUP_COLLATION_TEST_DB=true` (colación en `db:backup`/`db:restore`; solo crea y elimina `horus_collation_src_*` y `horus_restore_col_*` en ese MySQL; **aún sin ejecutarse en GitHub**) | Crea y elimina solo `horus_prisma_test_<UUID>`; aplica `db:init` + `db:migrate` (dos veces) + `db:check`, lo que valida el orden real de las migraciones en una base vacía. **Es obligatorio:** un fallo de migraciones, de `db:check`, de la idempotencia, del arranque de MySQL o de las pruebas de módulos pone rojo el trabajo y, con él, la ejecución completa (commit y PR). Necesita `JWT_SECRET` ficticio de pruebas (≥ 32 caracteres), definido en el propio trabajo |
| `smokes` | Solo con `workflow_dispatch` y la casilla `smokes`: `smoke:auth`, `smoke:unsaved`, `smoke:panel-sections`, `smoke:panel-toasts`, `smoke:quote-origin`, `smoke:chatbot`, `smoke-home`, `smoke-global-content`, `smoke-ui` | Necesitan Chrome/Chromium y no se han probado en un runner Linux (`smoke-kit.cjs` no pasa `--no-sandbox`). Por eso no corren en cada push. **Que aparezca «omitido» (skipped) en una ejecución automática es lo esperado y no es un fallo** |

## Cómo comprobar el resultado de cada trabajo

En GitHub, pestaña **Actions** → ejecución de «CI» → resumen: cada trabajo muestra su propio estado.

| Trabajo | Resultado esperado en `push` / `pull_request` |
| --- | --- |
| `Backend (tipos, pruebas, build)` | `success` |
| `Frontend (tipos, lint, pruebas, build)` | `success` |
| `Integración (MySQL efímero)` | `success`; ya no se tolera un fallo. Si falla, abrir el trabajo y revisar el paso «Integración con MySQL» (y «Iniciar MySQL efímero» si no arrancó la base). Si `Backend` falla, `integration` no se ejecuta (`needs: [backend]`) |
| `Smokes con navegador (manual)` | `skipped` salvo ejecución manual con la casilla `smokes`; no cuenta como fallo |

Un resultado general verde exige que los tres primeros terminen en `success`. Cada trabajo debe leerse por separado, no solo el icono global.

## Qué no cubre

- Los demás `smoke:*` (mensajes, adjuntos de correo, responsive, etc.): se ejecutan en local según la tabla de `AGENTS.md`.
- La base real: `db:check` y `db:migrate` contra Railway los ejecuta el responsable (`RAILWAY.md`). Una CI verde no demuestra que el despliegue esté listo.
- Correo, IA y APIs públicas reales.

## Equivalente en local

```
cd backend  && npm ci && node node_modules/typescript/bin/tsc --noEmit --incremental false && node --test --test-concurrency=1 -r ./test/isolate-env.cjs -r ts-node/register test/*.test.ts && npm run build
cd frontend && npm ci && npm run check && npm run lint && npm run build
```
