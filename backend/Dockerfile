# Etapa 1: compila TypeScript y genera el cliente Prisma (engineType "client": sin motor nativo en ejecución).
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS build
WORKDIR /app

# postinstall genera Prisma; necesita el esquema y el script antes de npm ci.
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY scripts/prisma-generate.cjs ./scripts/prisma-generate.cjs
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# Etapa 2: solo dependencias de producción, instaladas desde el lockfile y sin scripts de instalación.
# "npm prune --omit=dev" conservaba los paquetes devOptional (prisma CLI, typescript, @prisma/engines con un motor
# nativo, effect, fast-check...), que son a la vez dependencias de desarrollo y "peer" opcionales de @prisma/client.
# Omitir también optional y peer los excluye; el lockfile no tiene dependencias opcionales propias de producción.
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --omit=peer --ignore-scripts --no-audit --no-fund
# Cliente generado en la etapa de construcción (no figura en el lockfile).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# Falla la construcción si vuelve a colarse una herramienta de desarrollo o un motor nativo de Prisma.
RUN set -eu; \
    for p in prisma typescript @prisma/engines @prisma/config effect ts-node @nestjs/cli; do \
      if [ -e "node_modules/$p" ]; then echo "Paquete de desarrollo en producción: $p" >&2; exit 1; fi; \
    done; \
    if find node_modules -name '*.node' -print -quit | grep -q .; then echo "Binario nativo inesperado" >&2; exit 1; fi; \
    test -f node_modules/.prisma/client/default.js; \
    mkdir -p /out/data/uploads

# Etapa 3: usuarios del runtime. Parte de passwd/group de la propia base distroless y añade "node" (1000:1000), el
# mismo UID/GID de la imagen anterior, para que los volúmenes existentes conserven su propietario.
FROM gcr.io/distroless/nodejs22-debian13@sha256:10747a1323be68f206aed893599d43e6697ad67257e7c42703553f99fbce3d33 AS distroless-base
FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS users
COPY --from=distroless-base /etc/passwd /etc/group /base/
RUN set -eu; mkdir -p /out/etc; \
    { cat /base/passwd; printf 'node:x:1000:1000:node:/home/node:/sbin/nologin\n'; } > /out/etc/passwd; \
    { cat /base/group; printf 'node:x:1000:\n'; } > /out/etc/group

# Etapa final: distroless Debian 13 (Node 22, glibc, certificados CA, tzdata). Sin shell, sin gestor de paquetes,
# sin npm/corepack/yarn y sin utilidades del sistema (util-linux, perl, ncurses, PAM, systemd, tar, gzip...).
FROM distroless-base AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    PATH=/nodejs/bin:/usr/local/bin:/usr/bin:/bin \
    HOME=/home/node
COPY --from=users /out/etc/passwd /out/etc/group /etc/
COPY --from=prod-deps --chown=1000:1000 /app/node_modules ./node_modules
COPY --from=build --chown=1000:1000 /app/dist ./dist
COPY --from=build --chown=1000:1000 /app/package.json /app/package-lock.json ./
COPY --chown=1000:1000 scripts ./scripts
COPY --chown=1000:1000 migrations ./migrations
# Punto de montaje de las imágenes subidas (UPLOAD_DIR=/data/uploads). Un volumen nombrado nuevo de Docker hereda
# este propietario. No contiene archivos.
COPY --from=prod-deps --chown=1000:1000 /out/data /data
EXPOSE 3000
USER 1000:1000
# Docker local/Compose. Azure Container Apps usa sus propias probes HTTP (no lee HEALTHCHECK).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Sin shell: scripts/container-start.cjs sustituye al antiguo "sh -c ... setpriv". Si el contenedor arranca como root
# (volumen de Railway), corrige solo el propietario de UPLOAD_DIR bajo /data/ y abandona root antes de cargar la API.
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["scripts/container-start.cjs"]
