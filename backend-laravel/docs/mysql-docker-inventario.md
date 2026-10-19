# Inventario previo MySQL Laravel — 18/10/2026

Instantánea de solo lectura; no constituye evidencia de activación. Rama inicial
`anderson`, HEAD `063df9a`, Git limpio. Docker cliente/Engine 29.8.0, Compose 5.5.1,
contexto `desktop-linux`, 12 CPU y 3.688 GiB de memoria asignada al motor.

## Contenedores y montajes

| Contenedor | Estado observado | Imagen / función |
| --- | --- | --- |
| `horus-local-frontend-1` | healthy | `horus-local-frontend`, Caddy, `127.0.0.1:8081` → 8080 |
| `horus-local-backend-1` | healthy | `horus-local-backend`, NestJS, 3000 interno |
| `horus-local-mysql-1` | healthy | `mysql:8.4`, 3306/33060 internos, sin publicación |
| `horus-codex-e42-r2-20261016` | detenido (0) | `mysql:8.4`, ensayo anterior |
| `horus-backend-test` | detenido (255) | `horus-backend`, prueba Railway |
| `horus-frontend-test` | detenido (255) | `horus-frontend`, publicación previa 127.0.0.1:8080 |
| `horus-frontend-before-security` | detenido (255) | imagen anterior |
| `horus-frontend-before-catalogo` | detenido (0) | imagen anterior |
| `horus-backend-before-security` | detenido (255) | imagen anterior |
| `horus-mysql-test` | detenido (255) | `mysql:8.4`, prueba Railway |

Las etiquetas confirman que los tres saludables pertenecen al proyecto `horus-local`
y a `docker-compose.local.yml` de la raíz. El backend monta
`horus-local_uploads_data` en `/data`; MySQL monta `horus-local_mysql_data` en
`/var/lib/mysql`; frontend no tiene montajes. Los tres pertenecen únicamente a
`horus-local_default`, bridge no interna, subred observada `172.20.0.0/16`.

También existen las redes `bridge`, `host`, `none`, `horus-railway-test` y
`horus-railway-web-test`: seis redes en total. Quince volúmenes: diez anónimos y cinco
con nombre: `horus-local_mysql_data`, `horus-local_uploads_data`,
`horus-railway-test-data`, `horus-verify-final_mysql_data`,
`horus-verify-final_uploads_data`. El MySQL de prueba Railway monta su propio volumen;
el ensayo E4.2 detenido conserva un volumen anónimo. No se eliminó ni reutilizó ninguno.

No existen contenedores del proyecto Laravel, sus redes ni sus volúmenes propuestos.
El puerto 8082 está libre. En el anfitrión, 3306 escucha en `::` con proceso `mysqld`
PID 5576; no se consultó ese servidor ni se atribuyó a una base concreta.
El nuevo MySQL no publicará puertos, por lo que no competirá por ese listener.

## Recursos observados

Muestra puntual `docker stats --no-stream`; los valores fluctúan:

| Contenedor | RAM | CPU | Procesos |
| --- | --- | --- | --- |
| frontend NestJS | 13.45 MiB | 0.00 % | 12 |
| backend NestJS | 120.5 MiB | 0.05 % | 11 |
| MySQL NestJS | 456.8 MiB | 1.11 % | 39 |

Total aproximado 590.75 MiB. `/proc/meminfo` del kernel de la VM muestra
2,534,136 KiB disponibles (2.42 GiB), swap 1 GiB sin uso en esa muestra.
Esto no mide el consumo ni el arranque del futuro Laravel.

`docker system df`: imágenes 5.509 GB (9), contenedores 4.338 MB (10), volúmenes
2.885 GB (15), caché de build 11.26 GB (221 entradas). No se ejecutó limpieza.
El sistema de archivos virtual reporta 938 GiB disponibles, pero es almacenamiento
virtual ampliable: **no equivale a espacio físico reservado**. La unidad C del anfitrión
reportó 227,828,875,264 bytes libres (212.18 GiB). Se localizó el disco Docker en
`%LOCALAPPDATA%/Docker/wsl/disk/docker_data.vhdx`, sobre C, con longitud aproximada
18.35 GiB. Revalidar espacio físico y virtual antes de construir, activar o respaldar.

## Validaciones de la preparación

- `docker compose config --quiet`: Compose base y combinación aprobados, con archivos
  temporales ficticios externos eliminados después. No se leyeron entornos privados.
- Quince comprobaciones sobre el JSON efectivo aprobadas: servicios, redes y miembros,
  puertos, volumen exclusivo, destino fijo, UTC/utf8mb4, secreto root, límites,
  dependencias y conservación de las funciones públicas apagadas y del Compose base.
- Se comprobó el rechazo si falta la ruta obligatoria del secreto root.
- Sintaxis de todos los bloques PowerShell de la guía y `php -l` de su verificador:
  correctas. No se ejecutó el verificador contra una base.
- Revisión del diff completo, `git diff --check` y whitespace de archivos nuevos:
  correctos. Revisión manual y patrones sensibles sin secretos añadidos; los archivos
  de entorno versionados son plantillas. No equivale a una auditoría histórica de secretos.
- Al cierre seguían los mismos diez contenedores y los mismos IDs saludables de NestJS,
  sin reinicios (contador 0), seis redes y quince volúmenes. Ningún recurso Laravel creado.

## Riesgos y límites

- No se observaron conflictos de nombres o puertos con los recursos Laravel propuestos.
- Los límites nuevos suman 1600 MiB; el margen observado permite preparar la propuesta,
  pero no demuestra capacidad bajo carga o durante builds. No arrancar automáticamente.
- El acceso de aplicaciones a MySQL queda aislado por red; el administrador Docker
  conserva control total. Las credenciales PHP siguen el archivo privado externo del
  Compose base; root usa secreto de archivo exclusivo.
- Falta probar arranque, permisos de montajes, SQL de creación, UUID, migraciones,
  copia real, Filament, Livewire y respaldo/restauración. Todo ello requiere autorización.
- Ningún inventario antiguo sustituye una nueva comprobación al activar.

Configuración y pasos futuros: [mysql-docker.md](mysql-docker.md).
