# Análisis individual de dependencias, 23/10/2026

Complementa [el informe de entrega](seguridad-docker-aiven-20261023.md). Inventarios de npm audit guardados durante esta sesión.
La severidad de un paquete padre puede proceder de sus transitivas; no representa otro aviso independiente.
“Producción” indica presencia en el árbol auditado, no explotación demostrada. Node 22 y Prisma 6.19.3 se conservan.

## Paquetes inicialmente señalados

| Paquete | Inicial | Final | Producción | Evaluación / origen |
| --- | --- | --- | --- | --- |
| `@angular-devkit/core` | 17.3.11 | 17.3.11 | No | Sin aviso npm final. Aviso propagado por ajv, picomatch |
| `@angular-devkit/schematics` | 17.3.11 | 17.3.11 | No | Sin aviso npm final. Aviso propagado por @angular-devkit/core |
| `@angular-devkit/schematics-cli` | 17.3.11 | 17.3.11 | No | Sin aviso npm final. Aviso propagado por @angular-devkit/core, @angular-devkit/schematics, inquirer |
| `@nestjs/cli` | 10.4.9 | 10.4.9 | No | Sin aviso npm final. Aviso propagado por @angular-devkit/core, @angular-devkit/schematics, @angular-devkit/schematics-cli, @nestjs/schematics, glob, inquirer, webpack |
| `@nestjs/common` | 10.4.22 | 10.4.22 | Sí | Sin aviso npm final. Aviso propagado por file-type |
| `@nestjs/config` | 3.3.0 | 3.3.0 | Sí | Sin aviso npm final. Aviso propagado por lodash |
| `@nestjs/core` | 10.4.22 | 10.4.22 | Sí | Conservado: aviso SSE residual. SseStream; requiere datos controlables en id/type de SSE. Sin @Sse ni SseStream en src de Horus |
| `@nestjs/platform-express` | 10.4.22 | 10.4.22 | Sí | Conservado: aviso SSE residual. Aviso propagado por @nestjs/core, body-parser, express, multer |
| `@nestjs/schematics` | 10.2.3 | 10.2.3 | No | Sin aviso npm final. Aviso propagado por @angular-devkit/core, @angular-devkit/schematics |
| `@nestjs/swagger` | 7.4.2 | 7.4.2 | Sí | Conservado: aviso SSE residual. Aviso propagado por @nestjs/core, js-yaml, lodash |
| `@prisma/adapter-mariadb` | 6.19.3 | 6.19.3 | Sí | Sin aviso npm final. Aviso propagado por mariadb |
| `@prisma/config` | 6.19.3 | 6.19.3 | Sí | Sin aviso npm final. Aviso propagado por deepmerge-ts |
| `ajv` | 6.15.0, 8.12.0 | 6.15.0, 8.20.0 | No | Sin aviso npm final. Angular devkit y schema-utils de webpack; esquemas de compilación, fuera del runtime |
| `body-parser` | 1.20.8 | 1.20.9 | Sí | Sin aviso npm final. platform-express y Express; parser anterior a autenticación, fallo de proceso reproducido |
| `brace-expansion` | 1.1.18, 2.1.4 | 1.1.21, 2.1.7 | No | Sin aviso npm final. glob/minimatch del CLI y npm global; patrones de herramientas |
| `deepmerge-ts` | 7.1.5 | 8.0.2 | Sí | Sin aviso npm final. Prisma CLI -> @prisma/config; permanece en runtime por peers, no es una ruta HTTP |
| `express` | 4.22.1 | 4.22.1 | Sí | Sin aviso npm final. Aviso propagado por body-parser |
| `external-editor` | 3.1.0 | 3.1.0 | No | Sin aviso npm final. Aviso propagado por tmp |
| `file-type` | 20.4.1 | 21.3.4 | Sí | Sin aviso npm final. common; FileTypeValidator, no usado por el validador propio de imágenes Horus |
| `glob` | 10.4.5 | 10.5.0 | No | Sin aviso npm final. Nest CLI; expansión de patrones/CLI, fuera del runtime |
| `inquirer` | 8.2.6, 9.2.15 | 8.2.6, 9.2.15 | No | Sin aviso npm final. Aviso propagado por external-editor |
| `js-yaml` | 4.1.0 | 4.3.2 | Sí | Sin aviso npm final. swagger y herramientas; serialización/deserialización YAML |
| `lodash` | 4.17.21 | 4.18.1 | Sí | Sin aviso npm final. config, swagger, CLI y schematics; rutas utilitarias, contaminación de prototipos y complejidad |
| `mariadb` | 3.4.5 | 3.5.4 | Sí | Sin aviso npm final. adapter-mariadb 6.19.3 fija 3.4.5; transporte y procesamiento de respuestas de MySQL |
| `multer` | 2.0.2 | 2.5.0 | Sí | Sin aviso npm final. platform-express; multipart de uploads autenticados, agotamiento de recursos |
| `nodemailer` | 6.10.1 | 10.2.1 | Sí | Sin aviso npm final. dependencia directa; composición/SMTP, sin servidores ni correos externos en pruebas |
| `picomatch` | 2.3.2, 4.0.1 | 2.3.2, 4.0.7 | No | Sin aviso npm final. Angular devkit; patrones de herramientas, fuera del runtime tras retirar npm global |
| `prisma` | 6.19.3 | 6.19.3 | Sí | Sin aviso npm final. Aviso propagado por @prisma/config |
| `tmp` | 0.0.33 | 0.2.7 | No | Sin aviso npm final. Nest CLI -> inquirer -> external-editor; ficheros temporales, fuera del runtime |
| `webpack` | 5.97.1 | 5.112.2 | No | Sin aviso npm final. Nest CLI; buildHttp no configurado, fuera del runtime |

## Avisos originales con identificación propia

Cada fila conserva el rango afectado del inventario inicial. El resultado se contrasta con la auditoría final, sin exclusiones ni ignores.
Los avisos de un mismo paquete comparten el camino de dependencia y la evaluación de exposición de la tabla anterior.

| Paquete | Aviso | Severidad | Rango afectado inicial | Resultado |
| --- | --- | --- | --- | --- |
| `@nestjs/core` | [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) | moderate | `<=11.1.17` | Residual SSE; sin parche Nest 10, sin uso encontrado |
| `ajv` | [GHSA-2g4f-4pwh-qvx6](https://github.com/advisories/GHSA-2g4f-4pwh-qvx6) | moderate | `>=7.0.0-alpha.0 <8.18.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `body-parser` | [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | high | `<1.20.9` | Ausente de la auditoría final con las versiones finales de la tabla |
| `brace-expansion` | [GHSA-q2hr-2g5m-vwhr](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr) | moderate | `<1.1.21` | Ausente de la auditoría final con las versiones finales de la tabla |
| `brace-expansion` | [GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7) | high | `<1.1.20` | Ausente de la auditoría final con las versiones finales de la tabla |
| `brace-expansion` | [GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p) | high | `<1.1.19` | Ausente de la auditoría final con las versiones finales de la tabla |
| `deepmerge-ts` | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) | high | `<8.0.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `file-type` | [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473) | moderate | `>=13.0.0 <21.3.1` | Ausente de la auditoría final con las versiones finales de la tabla |
| `file-type` | [GHSA-j47w-4g3g-c36v](https://github.com/advisories/GHSA-j47w-4g3g-c36v) | moderate | `>=20.0.0 <=21.3.1` | Ausente de la auditoría final con las versiones finales de la tabla |
| `glob` | [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) | high | `>=10.2.0 <10.5.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `js-yaml` | [GHSA-mh29-5h37-fv8m](https://github.com/advisories/GHSA-mh29-5h37-fv8m) | moderate | `>=4.0.0 <4.1.1` | Ausente de la auditoría final con las versiones finales de la tabla |
| `js-yaml` | [GHSA-h67p-54hq-rp68](https://github.com/advisories/GHSA-h67p-54hq-rp68) | moderate | `>=4.0.0 <=4.1.1` | Ausente de la auditoría final con las versiones finales de la tabla |
| `js-yaml` | [GHSA-52cp-r559-cp3m](https://github.com/advisories/GHSA-52cp-r559-cp3m) | high | `>=4.0.0 <4.3.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `js-yaml` | [GHSA-5p4m-2wfm-xmqj](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj) | high | `>=4.0.0 <4.3.1` | Ausente de la auditoría final con las versiones finales de la tabla |
| `js-yaml` | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) | high | `>=4.0.0 <4.3.2` | Ausente de la auditoría final con las versiones finales de la tabla |
| `lodash` | [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) | high | `>=4.0.0 <=4.17.23` | Ausente de la auditoría final con las versiones finales de la tabla |
| `lodash` | [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh) | moderate | `<=4.17.23` | Ausente de la auditoría final con las versiones finales de la tabla |
| `lodash` | [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) | moderate | `>=4.0.0 <=4.17.22` | Ausente de la auditoría final con las versiones finales de la tabla |
| `mariadb` | [GHSA-cqhc-2h57-wpxf](https://github.com/advisories/GHSA-cqhc-2h57-wpxf) | high | `>=3.4.0 <3.4.6` | Ausente de la auditoría final con las versiones finales de la tabla |
| `mariadb` | [GHSA-42r5-vhpq-m858](https://github.com/advisories/GHSA-42r5-vhpq-m858) | moderate | `>=3.4.0 <3.4.6` | Ausente de la auditoría final con las versiones finales de la tabla |
| `mariadb` | [GHSA-g5xc-5w98-jfvm](https://github.com/advisories/GHSA-g5xc-5w98-jfvm) | moderate | `>=3.4.0 <3.4.6` | Ausente de la auditoría final con las versiones finales de la tabla |
| `mariadb` | [GHSA-r3rv-jm3r-62q2](https://github.com/advisories/GHSA-r3rv-jm3r-62q2) | high | `>=3.4.0 <3.4.7` | Ausente de la auditoría final con las versiones finales de la tabla |
| `mariadb` | [GHSA-v6pj-gxxw-phfw](https://github.com/advisories/GHSA-v6pj-gxxw-phfw) | high | `>=3.4.0 <3.4.7` | Ausente de la auditoría final con las versiones finales de la tabla |
| `mariadb` | [GHSA-48qf-xh34-q73r](https://github.com/advisories/GHSA-48qf-xh34-q73r) | high | `>=3.4.0 <3.4.7` | Ausente de la auditoría final con las versiones finales de la tabla |
| `mariadb` | [GHSA-cx2f-j9fh-8g68](https://github.com/advisories/GHSA-cx2f-j9fh-8g68) | moderate | `>=3.3.0 <3.5.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-xf7r-hgr6-v32p](https://github.com/advisories/GHSA-xf7r-hgr6-v32p) | high | `<2.1.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-v52c-386h-88mc](https://github.com/advisories/GHSA-v52c-386h-88mc) | high | `<2.1.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-5528-5vmv-3xc2](https://github.com/advisories/GHSA-5528-5vmv-3xc2) | high | `<2.1.1` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j) | high | `>=1.0.0 <2.2.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-3p4h-7m6x-2hcm](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm) | moderate | `>=2.0.0-alpha.1 <2.2.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-wc9g-mqfw-jrwm](https://github.com/advisories/GHSA-wc9g-mqfw-jrwm) | high | `<2.3.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-qvfw-j98x-7q72](https://github.com/advisories/GHSA-qvfw-j98x-7q72) | low | `<2.3.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4) | high | `<2.3.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `multer` | [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) | high | `>=2.0.0 <2.5.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-mm7p-fcc7-pg87](https://github.com/advisories/GHSA-mm7p-fcc7-pg87) | moderate | `<7.0.7` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-c7w3-x93f-qmm8](https://github.com/advisories/GHSA-c7w3-x93f-qmm8) | low | `<8.0.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-vvjj-xcjg-gr5g](https://github.com/advisories/GHSA-vvjj-xcjg-gr5g) | moderate | `<=8.0.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-268h-hp4c-crq3](https://github.com/advisories/GHSA-268h-hp4c-crq3) | moderate | `<=8.0.8` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-wqvq-jvpq-h66f](https://github.com/advisories/GHSA-wqvq-jvpq-h66f) | moderate | `<=8.0.8` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-rcmh-qjqh-p98v](https://github.com/advisories/GHSA-rcmh-qjqh-p98v) | high | `>=3.0.0 <=7.0.10` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-p6gq-j5cr-w38f](https://github.com/advisories/GHSA-p6gq-j5cr-w38f) | high | `<=9.0.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-8m3c-c648-2xjj](https://github.com/advisories/GHSA-8m3c-c648-2xjj) | moderate | `<=9.1.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-wmmp-3585-3rmp](https://github.com/advisories/GHSA-wmmp-3585-3rmp) | moderate | `<9.1.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-2x7j-588g-ccc2](https://github.com/advisories/GHSA-2x7j-588g-ccc2) | high | `<9.1.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-cc9r-2j5m-2m83](https://github.com/advisories/GHSA-cc9r-2j5m-2m83) | moderate | `>=6.9.16 <9.1.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-6vj9-mwq6-2f5v](https://github.com/advisories/GHSA-6vj9-mwq6-2f5v) | moderate | `>=5.0.0 <10.0.2` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-8vvx-rff5-p5rq](https://github.com/advisories/GHSA-8vvx-rff5-p5rq) | moderate | `<10.0.2` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-v53p-9fqp-m79j](https://github.com/advisories/GHSA-v53p-9fqp-m79j) | high | `<=10.0.5` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-r7g4-qg5f-qqm2](https://github.com/advisories/GHSA-r7g4-qg5f-qqm2) | high | `<=8.0.7` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-39m8-27wv-hr27](https://github.com/advisories/GHSA-39m8-27wv-hr27) | moderate | `>=3.0.0 <=10.0.9` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-8c8m-p3m8-cjg8](https://github.com/advisories/GHSA-8c8m-p3m8-cjg8) | moderate | `>=3.0.0 <10.1.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-m943-m63m-w62w](https://github.com/advisories/GHSA-m943-m63m-w62w) | moderate | `>=3.0.0 <10.1.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `nodemailer` | [GHSA-85x2-q946-cp5h](https://github.com/advisories/GHSA-85x2-q946-cp5h) | moderate | `>=3.0.0 <10.1.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `picomatch` | [GHSA-3v7f-55p6-f55p](https://github.com/advisories/GHSA-3v7f-55p6-f55p) | moderate | `>=4.0.0 <4.0.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `picomatch` | [GHSA-c2c7-rcm5-vvqj](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) | high | `>=4.0.0 <4.0.4` | Ausente de la auditoría final con las versiones finales de la tabla |
| `tmp` | [GHSA-52f5-9888-hmc6](https://github.com/advisories/GHSA-52f5-9888-hmc6) | low | `<=0.2.3` | Ausente de la auditoría final con las versiones finales de la tabla |
| `tmp` | [GHSA-ph9p-34f9-6g65](https://github.com/advisories/GHSA-ph9p-34f9-6g65) | high | `<0.2.6` | Ausente de la auditoría final con las versiones finales de la tabla |
| `webpack` | [GHSA-8fgc-7cc6-rx7x](https://github.com/advisories/GHSA-8fgc-7cc6-rx7x) | low | `>=5.49.0 <=5.104.0` | Ausente de la auditoría final con las versiones finales de la tabla |
| `webpack` | [GHSA-38r7-794h-5758](https://github.com/advisories/GHSA-38r7-794h-5758) | low | `>=5.49.0 <5.104.0` | Ausente de la auditoría final con las versiones finales de la tabla |

No se ejecutó cada exploit individualmente. Se reprodujo el fallo de body-parser antes de la corrección y se comprobó su regresión;
el resto combina alcance estático, rangos del aviso, inventario real, auditoría final y regresiones funcionales.
Se mantienen los riesgos residuales y las discrepancias de Scout descritos en el informe principal.
