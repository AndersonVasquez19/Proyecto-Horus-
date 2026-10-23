# Entrega del backend consolidado

23 de octubre de 2026, America/Lima. Rama `anderson`, base `8869e2c789e9b213d5c08a7e4c49a7c648360dd3`.
La solicitud de esta operación autoriza commits y push normal a `origin/anderson`; mantiene prohibidas la activación
real de MySQL, los cambios de cuentas/privilegios, React, Actions y los despliegues.
Esta autorización sustituye la falta de autorización Git indicada en el [cierre técnico anterior](cierre-backend-20261023.md).

## Resultado y alcance

Código consolidado: simplificación académica, Horarios independientes y correcciones H-01 a H-05 previamente integradas.
Se conservan los datos/modelos históricos de Docentes y Certificados, el bloqueo de matrículas con certificado vigente
y la verificación pública histórica. Sesiones queda retirada, con su SQL histórico conservado. No se reaplica el parche antiguo.

La única corrección nueva de código es del **lector PDF de pruebas**, sin cambios del generador de producción:
una expresión regular retiraba un byte comprimido `0x0d` cuando confundía ese byte con el delimitador LF anterior a
`endstream`. La prueba perdía el texto de una página y denunciaba una cabecera ausente. La primera suite dio
802/803 y la repetición aislada 13/13; el arnés privado reprodujo el defecto con fecha fija, comprobando que reponer
el CR permitía descomprimir el flujo. Una nueva regresión falló antes de corregir el lector; ahora lee la longitud
`/Length` declarada por pdfkit y aprueba con delimitadores LF y CRLF. No se relajan comprobaciones ni timeouts.

Documentación completada: autenticación, DTO, reportes/exportaciones, nombres de descarga, revisión y errores para React;
activación de las dos migraciones y recuperación ante DDL parcial; separación de cuentas, acceso y rotación MySQL.
Se corrigió además una nota histórica de CI que todavía hablaba de Sesiones activa y de Horarios sin ejecutar.
No se modificó `.github/workflows/ci.yml`.

## Validación

Node **22.23.3** ya instalado en caché; se antepuso a PATH solo en los procesos propios. Sin instalaciones ni cambios
de dependencias/lockfiles. Las pruebas mantienen `test/isolate-env.cjs`; `TS_NODE_TRANSPILE_ONLY=true` se usa después
de comprobar los tipos de aplicación y tests por separado.

| Comprobación | Evidencia |
| --- | --- |
| TypeScript, `tsc --noEmit --incremental false` | Ejecutado, salida 0; repetido tras la corrección del test. |
| `npm run build` | Ejecutado, salida 0; Prisma 6.19.3 generado, sin migrar/conectar MySQL. |
| `npm test`, suite final | **804/804**, cero fallos/omisiones/cancelaciones; 158,74 s. |
| Cotizaciones PDF, archivo aislado después de corregir | **14/14**, cero fallos/omisiones/cancelaciones. |
| H-01 a H-05, siete archivos de regresión | Evidencia anterior íntegra **82/82**, también incluidos en la suite final. |
| Horarios, MySQL 8.4 y 8.0.46 | Evidencia anterior íntegra **14/14 en cada versión**. |
| Preinscripciones, MySQL 8.4 y 8.0.46 | Evidencia anterior íntegra **27/27 en cada versión**, incluye H-04 por HTTP real. |
| AccessGuard, MySQL 8.4 | Evidencia anterior íntegra **28/28**. |
| Ciclo E3.6 sin base, dos ejecuciones aisladas | Evidencia anterior íntegra **7/7 en cada ejecución**; no se reproduce el timeout histórico. |
| Restauración/migración en clon 8.0.46 | Evidencia anterior íntegra: 18 migraciones, esquema compatible, datos originales conservados, repetición idempotente y roundtrip de backup. |
| Inventario, secretos, índice y whitespace | Revisión de rutas previstas, comparación SHA-256 y `git diff --check`/`--cached --check` sin errores. |

Se verificaron por SHA-256 los **66 artefactos** del cierre anterior. De las 106 rutas de su instantánea inicial,
solo Preinscripciones integración tenía el cambio H-04 posterior, que está cubierto por aquellos logs finales.
El resto del código de producción coincide; la reparación nueva modifica exclusivamente un test.
Por ello no se repiten integraciones costosas que no recibieron cambios relevantes. No se suman suites solapadas.
H-03 conserva su evidencia anterior 4/4 en MySQL 8.4, descrita en [Validación H-01 a H-05](validacion-final-h01-h05.md).
No se ejecutan nuevas integraciones independientes de Estudiantes, Ediciones, Matrículas o Reportes: se conserva
la evidencia previa y la cobertura de compatibilidad de Preinscripciones. No hay validación nueva de React, navegador,
correo real, OpenAI, proxy ni producción.

E3.6 conserva el límite de 60 s y la implementación. Las repeticiones documentadas explican unos 30 s de espera
del adaptador/pool, pero **no demuestran la causa del exceso histórico de 60 s**. Si reaparece, capturar tiempos
de importación, conexión, SELECT y salida. Swagger mantiene cuota por proceso; conservarlo deshabilitado públicamente.
H-06/H-07 y una herramienta de Horarios para el asistente quedan fuera del alcance.

## Commits y publicación

| Commit | Contenido |
| --- | --- |
| `8e9ed2ecf2e1a5c2511d259296c514605ba3a07c` | Simplificación académica y Horarios con migración, permisos, pruebas y documentación dependientes. |
| `7139e55545723cc5b7abffacdb47ef6d61990afc` | H-01 a H-05, sus regresiones y prueba HTTP real H-04. |
| `a12c298b74d8828877a9a00b6b002ad82f5d11f0` | Reparación del lector PDF de pruebas y regresión CR. |
| Commit que contiene este documento | Contratos, activación, privilegios y entrega final. El hash completo se informa al finalizar la operación. |

Simplificación y Horarios comparten AppModule, modelos, inventario y permisos: se consolidan juntos para conservar
su coherencia. Los archivos mixtos se preparan por versión revisada desde las copias previas; no se modifica el árbol
de trabajo para separarlos. Se revisa cada índice y no se utiliza `git add .`, amend, rebase, force push ni otra rama.

El remoto estaba exactamente en la base al hacer fetch. Publicación autorizada exclusivamente mediante
`git push origin anderson:anderson`, tras comprobar de nuevo que `origin/anderson` sigue siendo antecesor.
La comprobación final compara `git rev-parse HEAD` con `git ls-remote origin refs/heads/anderson` y exige igualdad;
su resultado y el cuarto hash se entregan en el informe de sesión. La CI automática continúa aplazada.

## MySQL y operaciones pendientes

Lectura actual: `horus_db`, MySQL **8.0.46**, UUID `dc5bb32a-a7b2-11f1-913f-14b5cd19372a`,
**27 tablas y 16 migraciones**. No existen todavía las tres tablas nuevas; faltan únicamente
`20261020-preinscripciones` y `20261023-convocatoria-horarios`. No está registrada la migración retirada de Sesiones.
La cuenta configurada mantiene privilegios administrativos globales y `GRANT OPTION`: el endurecimiento **no está aplicado**.
No se muestran cuentas, credenciales ni salida completa de grants.

- [Activación y recuperación](activacion-preinscripciones-horarios.md): comandos exactos, identidad, ventana sin
  escritores, respaldo nuevo privado/verificado y restauración aislada antes de `npm run db:migrate`; después,
  `npm run db:check`, 18 migraciones y comparación de los datos originales. Todo permanece detenido hasta autorización.
- [Privilegios MySQL](privilegios-mysql-propuesta.md): aplicación sin DDL, migrador independiente, respaldo de lectura,
  excepciones de certificados/auditoría, red privada, variables por proceso, cifrado y rotación. Requiere ensayo de
  privilegios efectivos en clon y autorización antes de crear/modificar cuentas reales.
- [Contrato React](contrato-react-backend-consolidado.md): endpoints, permisos, estados, DTO, límites, revisión,
  409/422, CORS/Content-Disposition y rutas retiradas. No incluye implementación React ni despliegue.

El respaldo previo está verificado y conservado; no se toma otro porque no se activa el origen.
La ACL privada no equivale a cifrado ni a una copia externa: la política de almacenamiento y el respaldo fresco
de la futura ventana siguen siendo requisitos operativos. La verificación pública de certificados permanece
hasta comprobar su dependencia en todos los entornos y autorizar su retirada.

## Conservación y límites de la entrega

Antes de preparar commits se copiaron y verificaron los 87 archivos existentes entre 109 rutas pendientes, junto
con índice, parches binarios y estado Git, en
`%USERPROFILE%\.horus-respaldos\publicacion-backend-20261023\`, con ACL del operador/SYSTEM.
También se comprobó el respaldo independiente de Claude: **36 archivos, 2 065 476 bytes**, legibles.
Logs nuevos y reproducción PDF ficticia permanecen privados y fuera del repositorio.

Los dos stashes históricos se conservan sin aplicar ni eliminar:
`2599fb8558830d6d11f49a7ced757d89dd8f9116` y `cc173cc52d26611facaf85c58987142487428470`.
No se modifican los otros worktrees. Se mantiene el inventario de **11 contenedores y 117 volúmenes Docker**;
esta operación no crea ni inicia contenedores.

No se ejecutan migraciones ni escrituras de datos reales, CREATE USER/GRANT/REVOKE/ALTER USER, rotaciones,
despliegues, cambios React, cambios de main, Actions ni activación de CI. No se publican respaldos, logs o secretos.

**Código:** consolidado y validado; publicación sujeta a la comprobación remota final indicada arriba.
**Base local activada:** no, faltan las dos migraciones y el endurecimiento autorizado.
**Producción operativa:** no, integración React y despliegue corresponden al compañero.
