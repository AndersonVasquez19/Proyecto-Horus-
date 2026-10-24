# Adjudicación de los ocho avisos altos de Debian

Verificación del **24/10/2026, America/Lima**, sobre la imagen local
`horus-aca-backend:security-20261024-r4-67ad23fa0935`, índice OCI
`sha256:aa5213974af6704ec7addc19f6dfd6b23a7f223c5e1dc0da2eae0f0fb971ff35`.
Se construyó una candidata local con retirada de SUID/SGID; no se publicó. Scout volvió a informar 52 avisos: **8 altos, 6 medios y 38 bajos**,
en 371 paquetes inventariados. No hay supresiones. La salida 0 de Scout acredita que terminó el análisis;
sin `--exit-code`, no significa ausencia de vulnerabilidades.

Las versiones siguientes se comprobaron con `dpkg-query` dentro de ese digest. Scout agrupa por paquete
fuente: `util-linux` incluye `mount`, `libmount1` y `libblkid1`; `perl` corresponde aquí a `perl-base`.
Los ocho avisos conservan `affected_version: >0` y `fixed_version: not fixed` en el SARIF de Debian 12.
La clasificación de exposición combina inspección local y las fuentes primarias enlazadas; no constituye
una reproducción de los ocho exploits ni aceptación de riesgo de producción.

| CVE y fuente primaria | Paquete y versión instalada / rango afectado | Exposición real observada | Mitigación y adjudicación |
| --- | --- | --- | --- |
| [CVE-2026-53613](https://security-tracker.debian.org/tracker/CVE-2026-53613) | `util-linux`, `mount`, `libmount1` **2.38.1-5+deb12u3**. Upstream: 2.17–2.41.6, 2.42–2.42.3; también 2.42.4 en el fallback legacy sin `/proc`. | Paquete afectado presente; r3 retira SUID de mount. Requiere acceso local y autorización `user/users` en fstab con un ancestro escribible. El fstab final solo tiene el comentario de configuración vacía; la API no invoca mount. | **Vulnerabilidad presente, mitigación de privilegios añadida.** Conservar fstab sin montajes delegados, usuario 1000, sin SYS_ADMIN y endurecimiento efectivo del destino. Adoptar un backport/base con corrección que cubra el camino usado; no basta citar cualquier versión 2.42. |
| [CVE-2026-53615](https://security-tracker.debian.org/tracker/CVE-2026-53615) | Fuente `util-linux`; `libblkid1` **2.38.1-5+deb12u3**. Afecta versiones anteriores a 2.41.4. | Biblioteca afectada presente. Necesita que un consumidor sondee una imagen DOS/EBR maliciosa; la corrupción posterior depende del consumidor. No hay procesamiento de particiones ni ejecución de blkid en `backend/src`. | **Afectado, sin camino HTTP identificado.** No delegar dispositivos de bloque ni análisis de discos al contenedor; actualizar con backport o base corregida. La versión upstream de referencia es 2.41.4, no una instrucción para mezclar paquetes de otras distribuciones. |
| [CVE-2026-76642](https://security-tracker.debian.org/tracker/CVE-2026-76642) | `util-linux`/`libmount1` **2.38.1-5+deb12u3**. Upstream describe versiones hasta 2.41.5 y 2.42.2; parche 2.41.6/2.42.3. | Debian lo marca vulnerable. Necesita helper de montaje fallido y hooks privilegiados `X-mount.*`. Fstab vacío y ningún flujo de la API monta discos. No se demostró que el backport de Debian tenga todos los hooks de ramas nuevas. | **Conservar como afectado según Debian; alcance del código antiguo no demostrado.** Sin fstab de usuario, helpers delegados, SYS_ADMIN ni ejecución privilegiada. Revisar backport/base cuando exista; no marcar corregido por usar UID 1000. |
| [CVE-2026-78410](https://security-tracker.debian.org/tracker/CVE-2026-78410) | `util-linux`/`mount`/`libmount1` **2.38.1-5+deb12u3**. Aviso upstream: hasta 2.42.2, parche 2.41.6/2.42.3. | Debian lo marca vulnerable. Requiere bind/rbind autorizado en fstab, origen reemplazable y opciones `X-mount.owner/group/mode` para los cambios privilegiados. Esas entradas no existen en la imagen ensayada. | **Afectado según Debian, precondiciones ausentes en el ensayo.** Evitar bind mounts delegados y cambios de propietario mediante mount; endurecimiento anterior y base/backport corregidos. Los volúmenes los prepara el orquestador. |
| [CVE-2026-78409](https://github.com/util-linux/util-linux/security/advisories/GHSA-8f2p-47x3-43mv) | `util-linux`/`libmount1` **2.38.1-5+deb12u3**. Upstream declara **>=2.42**, parches 2.41.6/2.42.3; Debian marca Bookworm vulnerable. | Discrepancia de rango. El ataque descrito usa el camino detached-tree de `X-mount.subdir` y kernel >=6.15. Fstab vacío y versión instalada anterior al rango declarado. No se auditó el código de todos los backports Debian. | **Probable sobreinclusión por paquete fuente, sin adjudicación definitiva del proveedor.** Mantener el aviso; impedir montajes de usuario/SYS_ADMIN y revalidar el tracker y el código Debian antes de aceptar una excepción. No se usa el kernel de Docker Desktop para inferir el de Azure. |
| [CVE-2026-78408](https://github.com/util-linux/util-linux/security/advisories/GHSA-55fx-f4gg-cfhj) | `util-linux` **2.38.1-5+deb12u3**. Upstream **>=2.40**; Debian lo marca vulnerable. | `nsenter --help` en la imagen no contiene **`--join-cgroup`**, condición central del aviso. Requiere además un operador privilegiado que lo ejecute contra un destino del atacante. La API no usa nsenter. | **Función vulnerable ausente en el binario inspeccionado; discrepancia Debian conservada.** No usar nsenter privilegiado del host sobre destinos no confiables, ni compartir cgroups/namespace del host. Revalidar después de cambiar la base; no suprimir globalmente util-linux. |
| [CVE-2026-82560](https://security-tracker.debian.org/tracker/CVE-2026-82560) | Fuente `perl`; binario instalado **perl-base 5.36.0-7+deb12u4**. Componente afectado: **Pod::Text <6.1.1**. | `perl -MPod::Text -e1` falla por módulo ausente y la búsqueda de `/usr/**/Pod/Text.pm` no devuelve archivos. El backend no ejecuta Perl ni formatea POD. La presencia de perl-base no demuestra presencia de Pod::Text. | **Componente vulnerable ausente en el sistema final inspeccionado; aviso de fuente conservado.** No instalar podlators/Perl completo sin reevaluar. Si se requiere POD, usar paquete con Pod::Text >=6.1.1 y límites de recursos. No es una afirmación sobre todas las capas históricas. |
| [CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091) | `zlib1g` **1:1.2.13.dfsg-1**. Descripción upstream: **1.3.1.2–1.3.2**, camino `gz_vacate`/escrituras gz no bloqueantes. | Debian mantiene vulnerable 1.2.13 pese al rango descrito. Node informa su zlib integrada **1.3.1-e00f703**, y `ldd /usr/local/bin/node` no enlaza libz del sistema. El backend no invoca gzprintf/gzwrite; recibir gzip por HTTP no acredita el camino de escritura gz del CVE. | **Discrepancia de rango y consumidor, sin explotación demostrada.** Conservar el aviso, seguir la [discusión upstream](https://github.com/madler/zlib/issues/1310) y esperar backport/base verificados. No sustituir libz manualmente ni declarar resuelto por la versión de Node. |

La imagen por defecto especifica `USER node`, pero no impone por sí misma `--cap-drop ALL` ni
`no-new-privileges`: ambos se aplicaron en el ensayo local. El esquema público de Container Apps no
expone esos controles como securityContext; comprobar la política efectiva del destino antes de
atribuirlos a Azure. En r2 mount/umount eran SUID. En **r3 se retiraron todos los bits SUID/SGID de los
archivos regulares de /usr/bin y /usr/sbin**, conservado y verificado en la candidata final r4.
La API no usa esa elevación; login, TLS, scripts, uploads del directorio de imagen y exportaciones
continuaron funcionando. No se eliminaron bibliotecas ni se instalaron paquetes de otra distribución.
Esto reduce las vías locales de escalada, sin corregir los paquetes ni demostrar ausencia de otros exploits.

Para cerrar el riesgo de publicación se necesita una base/backport verificable o aceptación explícita
de los riesgos residuales y de sus controles. No se declara la imagen libre de vulnerabilidades ni
aprobada para exposición pública. Quedan además seis medios y 38 bajos; este documento adjudica
individualmente los ocho altos solicitados, no los elimina del escáner.

Evidencia final fuera de Git: `%TEMP%\horus-security-close-67ad23fa0935\final\scout.sarif`.
Las versiones dpkg se repitieron y coinciden con la tabla. Las ocho fuentes primarias se
reconsultaron durante el cierre; permanecen sin parche aplicable confirmado para esta base.
Scout final r4 terminó con salida 0 y escribió el SARIF completo. En r3 había avisado de un archivo temporal
bloqueado al limpiar su caché en Windows; no se borró esa caché ni se ocultó el aviso. La repetición r4
no presenta ese bloqueo y conserva los mismos contadores, sin supresiones.
Ver resultados de regresión e inventario en [la entrega local](seguridad-docker-aiven-20261023.md).
