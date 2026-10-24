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
# Conserva el cliente generado y elimina herramientas de desarrollo.
RUN npm prune --omit=dev --omit=peer --ignore-scripts

FROM node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Aplica correcciones Debian disponibles. El escaneo final sigue siendo obligatorio.
# La API y los scripts usan node; los gestores de paquetes no son necesarios en ejecución.
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg
# La API no necesita ejecutables SUID/SGID. No depender de opciones propias de Docker
# que Container Apps no expone para reducir las vias locales de escalada.
RUN find /usr/bin /usr/sbin -type f \( -perm -4000 -o -perm -2000 \) -exec chmod a-s {} +
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
# Punto de montaje de las imágenes subidas (UPLOAD_DIR=/data/uploads). Un volumen nombrado nuevo de Docker hereda este propietario.
# No contiene archivos: nada se copia a la imagen.
RUN mkdir -p /data/uploads && chown -R node:node /data
EXPOSE 3000
USER node
# Un volumen de Railway se monta como root. Si el contenedor arranca como root, solo se corrige el propietario de UPLOAD_DIR (únicamente
# bajo /data/) y la API se ejecuta como "node" (setpriv: sin root, sin grupos extra). Si ya arranca sin privilegios (p. ej. "user:" en
# Compose), no cambia nada y la API corre con ese usuario.
CMD ["sh", "-c", "if [ \"$(id -u)\" = 0 ]; then d=\"${UPLOAD_DIR:-/data/uploads}\"; case \"$d\" in /data/*) mkdir -p \"$d\" && chown -R node:node \"$d\";; esac; exec setpriv --reuid=node --regid=node --init-groups node dist/main.js; fi; exec node dist/main.js"]
