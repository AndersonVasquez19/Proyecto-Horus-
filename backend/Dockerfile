FROM node:22-bookworm-slim AS build
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
RUN npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node migrations ./migrations
# Punto de montaje de las imágenes subidas (UPLOAD_DIR=/data/uploads). Un volumen nombrado nuevo de Docker hereda este propietario.
# No contiene archivos: nada se copia a la imagen.
RUN mkdir -p /data/uploads && chown -R node:node /data
EXPOSE 3000
# Un volumen de Railway se monta como root. Si el contenedor arranca como root, solo se corrige el propietario de UPLOAD_DIR (únicamente
# bajo /data/) y la API se ejecuta como "node" (setpriv: sin root, sin grupos extra). Si ya arranca sin privilegios (p. ej. "user:" en
# Compose), no cambia nada y la API corre con ese usuario.
CMD ["sh", "-c", "if [ \"$(id -u)\" = 0 ]; then d=\"${UPLOAD_DIR:-/data/uploads}\"; case \"$d\" in /data/*) mkdir -p \"$d\" && chown -R node:node \"$d\";; esac; exec setpriv --reuid=node --regid=node --init-groups node dist/main.js; fi; exec node dist/main.js"]
