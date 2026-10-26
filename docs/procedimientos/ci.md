# Integración continua (GitHub Actions)

> **Nota (retirada de Sesiones, 23 de octubre de 2026):** `ci.yml` **no se modificó** (no estaba autorizado). Su paso «Integración de Horarios y sesiones…»
> sigue invocando `node test/run-academic-isolated.cjs sesiones`; ese destino es ahora un **alias** de la suite `horarios` (`test/horarios.integration.cjs`), que prueba
> la tabla `convocatoria_horarios`, sus rutas y la retirada de la migración de sesiones. El nombre del paso es histórico: renombrarlo a `horarios` requiere
> autorización para tocar la CI. `test/sesiones.test.ts` y `test/sesiones.integration.cjs` se eliminaron; los añadidos son `test/horarios.test.ts`,
> `test/lima-time.test.ts` y `test/horarios.integration.cjs`.
>
> **Nota (simplificación académica, octubre de 2026):** `ci.yml` no se modificó. El paso «Integración de Docentes y ponentes…» sigue invocando
> `node test/run-academic-isolated.cjs docentes`, pero esa suite ahora verifica la migración y la conservación de las tablas de docentes, que sus rutas ya no existen y
> que las rutas retiradas no existen; el nombre del paso es histórico. Las suites `sesiones` (ahora alias de `horarios`) y `reportes` se adaptaron al nuevo alcance.
> Horarios ya tiene evidencia local 14/14 en MySQL 8.4 y 8.0.46; no confundirla con CI remota. Véase el [cierre técnico](cierre-backend-20261023.md).
> La integración específica de Reportes no se repitió en esa ejecución. Se retiraron `test/docentes.test.ts` y
> `test/certificados-pdf.test.ts` (la parte de verificación y límites de frecuencia pasó a `test/certificados-verificacion.test.ts`).

Archivo: [.github/workflows/ci.yml](../../.github/workflows/ci.yml). Se ejecuta en `push` a `main`, en cada `pull_request` cuya rama base no sea `anderson` y a demanda (`workflow_dispatch`).

> **CI automática suspendida en `anderson` (temporal).** Mientras se desarrolla Horus Group, la rama `anderson` no dispara la CI por `push` ni por `pull_request` con base `anderson`. Los trabajos, scripts y pruebas siguen intactos y la CI sigue disponible a demanda: pestaña *Actions* → *CI* → *Run workflow* (rama `anderson`; casilla `smokes` opcional). Un PR de `anderson` hacia `main` sí ejecuta la CI (la base es `main`).
>
> **Cómo reactivarla al terminar el proyecto**, en el bloque `on:` de `.github/workflows/ci.yml`:
> 1. `push.branches`: cambiar `[main]` por `[main, anderson]`.
> 2. `pull_request`: eliminar la línea `branches-ignore: [anderson]` (y su comentario de cabecera).
> 3. Verificar el YAML, hacer commit y push, y comprobar en *Actions* que la ejecución se dispara.
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
| `integration` | MySQL 8.4 efímero en el runner (`docker run`, solo `127.0.0.1`, contraseña de un solo uso que no es un secreto), `npm run test:integration` y, en un paso aparte, `node --test test/backup-collation.integration.cjs` con `BACKUP_COLLATION_TEST_DB=true` (colación en `db:backup`/`db:restore`; solo crea y elimina `horus_collation_src_*` y `horus_restore_col_*` en ese MySQL; **aún sin ejecutarse en GitHub**) | Crea y elimina solo `horus_prisma_test_<UUID>`; aplica `db:init` + `db:migrate` (dos veces) + `db:check`, lo que valida el orden real de las migraciones en una base vacía. **Es obligatorio:** un fallo de migraciones, de `db:check`, de la idempotencia, del arranque de MySQL o de las pruebas de módulos pone rojo el trabajo y, con él, la ejecución completa (commit y PR). Necesita `JWT_SECRET` ficticio de pruebas (≥ 32 caracteres), definido en el propio trabajo. El paso «Integración de la estructura académica (E4.2)» ejecuta `test/academico-schema.integration.cjs` con las mismas barreras que E3.5 y E3.6 (server_uuid leído con `docker exec`, servidor recién creado y sin tablas ajenas) y solo crea y elimina `horus_e42_<hex>` y `horus_restore_e42_<hex>` |
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
