# Imagen del backend: reducción de vulnerabilidades Trivy (25/10/2026)

Rama local `security/trivy-hardening` (desde `origin/anderson` = `7f1299a`). Sin push, sin publicación en GHCR, sin
recursos Azure y sin acceso a Aiven. Todas las pruebas con base de datos usaron MySQL 8.4 desechable con datos ficticios.

## 1. Punto de partida

Ejecución de Actions [40162740379](https://github.com/Castope/Proyecto-Horus-/actions/runs/40162740379)
(imagen de `de772155`, base `node:22-bookworm-slim` + `apt-get upgrade`): **1 CRITICAL, 56 HIGH, 88 MEDIUM**
(145 hallazgos, 51 CVE distintas), `policy_ok=false`. Informes `trivy.json`, `findings.json` y `scan-identity.txt`
descargados y analizados (manifiesto escaneado `sha256:c4de8061…`, configuración `sha256:bccc1da2…`, 14 capas).

| Origen | Hallazgos | Observación |
| --- | --- | --- |
| Paquetes Debian 12 de la imagen final | 144 | 0 con versión corregida publicada: `affected` 89, `fix_deferred` 39, `will_not_fix` 16. `apt-get upgrade` no podía mejorar nada más. |
| Dependencias npm de la aplicación | 1 | `@nestjs/core` 10.4.22, CVE-2026-35515 (MEDIUM, corregida solo en 11.1.18). |
| Etapa de construcción | 0 | El escaneo correspondía a la imagen final; las herramientas de construcción no estaban en el informe. |

Los HIGH se concentraban en util-linux: 6 CVE × 8 paquetes binarios del mismo origen (`util-linux`, `util-linux-extra`,
`mount`, `bsdutils`, `libblkid1`, `libmount1`, `libsmartcols1`, `libuuid1`) = 48 de 56 HIGH. Es un mismo defecto
contado una vez por paquete binario, no 48 riesgos distintos. El resto: ncurses (CVE-2025-69720 ×3),
systemd/udev (CVE-2026-16742 ×2), gzip, libacl1 y perl-base.

**CVE crítica — CVE-2023-45853 (zlib1g 1:1.2.13.dfsg-1).** El defecto está en MiniZip (`zipOpenNewFileInZip4_64`),
código `contrib/` que el propio aviso declara «no soportado» por zlib. El
[Debian Security Tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853) anota para bookworm
«contrib/minizip not built and src:zlib not producing binary packages»: el binario `zlib1g` no incluye MiniZip.
No es explotable en esta imagen (la API tampoco crea ZIP con zlib del sistema: Node lleva su propia zlib), pero no se
trató como resuelta por mitigación: **se eliminó** al cambiar de base (Debian 13 la marca como corregida y la imagen
nueva no la reporta).

**util-linux — CVE-2026-53613 y relacionadas.** [Debian](https://security-tracker.debian.org/tracker/CVE-2026-53613):
condición de carrera en `mount` restringido por entradas `user`/`users` de fstab, escalada local. Bookworm vulnerable sin
versión corregida; trixie corregido en 2.41.5-0+deb13u1. La API nunca invoca `mount` (y la imagen anterior ya retiraba los
SUID), pero la corrección real es no tener util-linux en la imagen.

**@nestjs/core — CVE-2026-35515** ([GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75)):
inyección en `SseStream._transform()`; requiere que la aplicación use Server-Sent Events y vuelque datos influidos por
el usuario en los campos `type` o `id`. Horus no usa SSE (`@Sse`, `MessageEvent` y `text/event-stream` no aparecen en
`backend/src`). La única corrección es NestJS 11 (versión mayor); 10.4.22 es la última 10.x. **No se actualizó** (fuera
del alcance autorizado sin estudio de regresiones). Riesgo residual documentado, no aceptado en nombre del responsable.

## 2. Problemas encontrados en la imagen anterior

1. **Base con paquetes innecesarios** para una API Node: util-linux, perl, ncurses, PAM, systemd, tar, gzip, gpgv…
   origen de 144/145 hallazgos.
2. **`npm prune --omit=dev` no eliminaba las herramientas de desarrollo.** `prisma`, `typescript`, `@prisma/engines`
   (con el motor nativo `libquery_engine-debian-openssl-1.1.x.so.node`), `@prisma/config`, `effect`, `fast-check` y otros
   29 paquetes figuran como `devOptional` en el lockfile: dependencias de desarrollo **y** `peerDependencies` opcionales
   de `@prisma/client`. npm conserva los `devOptional` salvo que también se omita `optional`. Unos 190 MB sobraban en
   `node_modules` (349 MB). El esquema usa `engineType = "client"`: el motor nativo no se usa en ejecución.
3. `corepack` seguía en la imagen (se retiraban npm y yarn, no corepack).

## 3. Cambios aplicados

| Archivo | Cambio |
| --- | --- |
| `backend/Dockerfile` | Runtime `gcr.io/distroless/nodejs22-debian13` fijado por digest (`sha256:10747a13…`, variante `nonroot`). Construcción en `node:22-bookworm-slim` fijado (sin cambios: el workflow exige esa línea). Etapa `prod-deps` con `npm ci --omit=dev --omit=optional --omit=peer --ignore-scripts` y comprobaciones que hacen fallar la construcción si reaparece una herramienta de desarrollo o un binario `.node`. Usuario `node` 1000:1000 añadido a `passwd`/`group` (mismo UID que antes: los volúmenes existentes conservan propietario). `HEALTHCHECK` para Docker/Compose (ACA usa sus probes). |
| `backend/scripts/container-start.cjs` | Sustituye al `sh -c … setpriv` (no hay shell). Sin root: no hace nada. Como root: normaliza `UPLOAD_DIR` (solo bajo `/data/`; `/data/../etc` se rechaza, el `case` de shell anterior lo habría aceptado), cambia propietario con `lchown` sin seguir enlaces simbólicos y abandona root de forma irreversible (grupos → GID → UID, verificado); si no puede, termina con error. |
| `backend/test/container-start.test.ts` | 7 pruebas: rutas admitidas, `lchown` sin descender en enlaces, orden de retirada de privilegios, fallo seguro, y estructura del Dockerfile (bases con digest, sin `sh -c`/`setpriv`, `USER 1000:1000`). |
| `backend/test/access-guard-http.integration.cjs`, `backend/test/fixtures/access-guard-app.cjs` | Desajuste **preexistente** desde `de77215`: `main.ts` pasa `TRUSTED_PROXY_HOPS` a `trustedProxies()` y la prueba de integración y su ensamblado seguían con la firma anterior (la suite `access` fallaba con el código de `anderson`). |
| Documentación | `docker-local.md` (los comandos usaban `npm run` dentro del contenedor, pero `npm` ya no estaba en la imagen anterior; ahora `node scripts/…`), `RAILWAY.md`, `imagen-backend-azure-ghcr.md`, `azure-container-apps-e1.md` y esta guía. |

Se conservan: Node 22.23.4, Prisma 6.19.3 con adaptador MariaDB, TLS verificado, certificados CA de Debian
(`SSL_CERT_FILE`), usuario no root, sin SUID/SGID, `.dockerignore`, puertos y variables.

## 4. Antes y después

Mismos parámetros que el workflow (`--scanners vuln --severity CRITICAL,HIGH,MEDIUM`, Trivy 0.69.3 local).

| Severidad | Antes (run 40162740379) | Después |
| --- | ---: | ---: |
| CRITICAL | 1 | **0** |
| HIGH | 56 | **0** |
| MEDIUM | 88 | **24** |
| Total | 145 | 24 |

| Paquete / grupo | Antes | Después | Motivo |
| --- | ---: | ---: | --- |
| util-linux (8 binarios) | 72 (48 HIGH) | 0 | No está en distroless |
| libc6 / libc-bin | 30 | 13 (solo libc6) | glibc 2.41 de Debian 13; libc-bin no está |
| zlib1g | 3 (1 CRITICAL) | 2 MEDIUM | 1.3.1, sin corrección en trixie; CVE-2026-27171 marcada `no-dsa` (problema menor, bucle de CPU en `crc32_combine64`; corregida en forky/sid). CVE-2026-85091 no consultada en el tracker |
| gcc-base, libgcc-s1, libstdc++6, libgomp1 | 6 | 8 MEDIUM | GCC 14 de Debian 13, sin corrección publicada; necesarios para Node |
| ncurses, perl, PAM, systemd/udev, tar, gzip, gpgv, acl/attr, bz2, p11-kit | 33 | 0 | No están en distroless |
| @nestjs/core | 1 MEDIUM | 1 MEDIUM | Solo en NestJS 11; no explotable sin SSE |

Candidatas evaluadas (base sola): `node:22-bookworm-slim` 165 · `node:22-trixie-slim` 122 · distroless Debian 12
42 (incluye `libssl3` 3.0.18 desactualizado con una CRITICAL corregible) · `node:22-alpine` 0 de sistema (21 del npm
incluido) · **distroless Debian 13: 23 MEDIUM, 0 HIGH/CRITICAL**. Alpine se descartó: cambia glibc por musl y el
workflow exige `OS.Family == "debian"`.

| Tamaño | Antes | Después |
| --- | ---: | ---: |
| Imagen descomprimida (`docker image inspect`) | 800 MB | 457 MB |
| `docker save` / capas comprimidas (aprox. descarga) | 177 MB | 102 MB |
| `node_modules` | 349 MB | 157 MB |

## 5. Pruebas ejecutadas

| Prueba | Resultado |
| --- | --- |
| `tsc --noEmit` y `npm run build` en `node:22-bookworm-slim` (Node 22.23.4) | Correctos |
| `npm test` en Node 22.23.4 (contenedor, sin `.env`) | 820/821; el fallo era del entorno de la prueba (no se montó `RAILWAY.md` de la raíz). Repetida con el repositorio completo: `migrations.test.ts` + `container-start.test.ts` 22/22 |
| Integración aislada (`run-academic-isolated.cjs`, MySQL 8.4 desechable) | `access` 28/28 (tras corregir el desajuste preexistente; antes 26/28), `reportes` 10/10, `preparacion` 9/9. Ejecutadas con el Node del anfitrión (24.19.0), no con Node 22 |
| Humo E2E de la imagen (MySQL 8.4 desechable, `require_secure_transport=ON`, CA propia y SAN) | 34/34: `db:init`, `db:migrate`, `db:check`, `admin:create` (bcrypt) y `admin:assign-role` ejecutados **dentro** de la imagen; 30 tablas; rechazo de otra CA y de conexión sin TLS; health 200; públicas 200; Swagger 404; 401 sin token, con contraseña errónea y con JWT manipulado; consultas Prisma; exportaciones CSV/XLSX/PDF con tipo y firma correctos; chatbot sin IA 200; escritura en `UPLOAD_DIR` con raíz de solo lectura; 40 peticiones concurrentes sin fallos; SIGTERM → salida 0 en ~1 s; PID 1 UID/GID 1000, grupos 1000, `CapEff=0`; sin shell; Node v22.23.4 |
| Arranque forzado como root con volumen de root y enlace trampa a `/etc/passwd` | API con UID 1000 y `CapEff=0`; volumen y archivos pasan a 1000:1000; `/etc/passwd` sigue 0:0 |
| Recursos 0,5 vCPU / 1 GiB | Health 200 a los ~8,0 s desde `docker start`; 113 MiB tras arrancar, 129 MiB tras la carga; primer login ~1,6 s (bcrypt coste 12 con media CPU) |
| Secretos e integridad | Recorrido completo del sistema de archivos: 0 SUID/SGID, 0 archivos sensibles (`.env`, claves, `.pem`, `.npmrc`…), sin `sh`, `apt`, `npm`, `corepack`, Prisma CLI, TypeScript ni motores nativos |
| `npm audit --omit=dev` | 3 moderadas, todas CVE-2026-35515 (`@nestjs/core` y dependientes); corrección solo en versión mayor |
| Reproducción del job del workflow (buildx OCI, SBOM, procedencia `mode=min`, Trivy sobre directorio OCI) | Identidad verificada (ImageID = configuración amd64), atestaciones SPDX y SLSA v1, `OS.Family=debian`, mismos 24 MEDIUM |

Limitaciones: el arranque en frío medido es local (Docker Desktop, WSL2), no Azure; no incluye la descarga de la
imagen ni la latencia hacia Aiven. No se probaron proveedores reales de correo ni IA. No se probó Railway.

## 6. Riesgos residuales (no aceptados; decide el responsable)

1. **24 MEDIUM sin corrección publicada** (glibc 13, GCC 14 runtime 8, zlib 2) y `@nestjs/core` (versión mayor). Con
   la política actual (`APPROVED_PRIVATE_TEST_CVES` vacío) `policy_ok` seguirá en `false`: publicar exige que el
   responsable evalúe y apruebe CVE concretas en un cambio revisado en `main`, o esperar a que Debian publique correcciones.
2. **Actualización de la base distroless.** Google reconstruye las etiquetas; el digest fijado envejece. La etiqueta
   Debian 12 actual ya traía `libssl3` desactualizado. Revisar el digest y reescanear en cada publicación.
3. **Sin shell**: `docker exec … sh` y terminales que dependan de shell (posiblemente la de Railway, `az containerapp exec`
   por defecto) no funcionan; ejecutar `node scripts/<script>.cjs` como comando directo o desde un contenedor temporal con
   la misma imagen. Comprobar en Azure antes de depender de ello.
4. **Railway**: el arranque como root se probó en Docker local, no en Railway.
5. **Arranque en frío** con `minReplicas=0`: ~8 s locales sin red; el chatbot del frontend tiene un límite de 22 s.

## 7. Ruta hacia GHCR y Azure (cada paso exige autorización)

1. **Publicar la rama**: fast-forward de `origin/anderson` con los commits de `security/trivy-hardening` (sin reescribir
   historia). El workflow solo admite un `AUTHORIZED_SHA` antecesor de `origin/anderson`.
2. **Workflow**: PR desde la rama local `ci/ghcr-distroless-authorize` (basada en `main`), que fija
   `AUTHORIZED_SHA=3e319be7…` y exige bases por digest y runtime distroless con `USER 1000:1000`. El contenido del backend de
   `3e319be7` es el probado; commits posteriores solo de documentación no cambian la imagen.
3. **Ejecución sin publicar** (`publish=false`): comprobar en el informe `OS.Family=debian`, 0 CRITICAL/HIGH, SBOM y
   procedencia, y comparar los CVE con este documento. `policy_ok` será `false` mientras haya hallazgos sin aprobar.
4. **Decisión del responsable** sobre los MEDIUM residuales (aprobación explícita y revisada en `main`, o esperar
   correcciones). Sin ella no se publica.
5. **Publicación privada** solo con las cinco condiciones del workflow (`publish=true`, frase, `policy_ok`,
   `GHCR_PUBLISH_ENABLED`, aprobación del entorno `ghcr-publish`) y uso del **digest** remoto, nunca de la etiqueta.
6. **Azure**: seguir [azure-container-apps-e1.md](azure-container-apps-e1.md) §6–§7 (cuota, costes, presupuesto con
   alertas, logs, reversión). Diferencias con la imagen nueva: probes HTTP de ACA (no lee `HEALTHCHECK`); sin shell
   para `az containerapp exec` (usar `--command "node scripts/check-database.cjs"` o similar, por comprobar); no forzar
   root; Azure Files con opciones `uid=1000,gid=1000`; arranque en frío local ~8 s con 0,5 vCPU.

## 8. Cómo repetir

```powershell
docker build --platform linux/amd64 -t horus-aca-backend:hardening-local backend
docker run --rm -v //var/run/docker.sock:/var/run/docker.sock -v horus-trivy-cache:/root/.cache aquasec/trivy:0.69.3 `
  image --scanners vuln --severity CRITICAL,HIGH,MEDIUM horus-aca-backend:hardening-local
```

Los scripts del humo E2E y de reproducción del workflow se ejecutaron desde un directorio temporal de la sesión y no se
versionaron: crean redes, volúmenes y contenedores `horus-hard-*` y los eliminan al terminar.
