# syntax=docker/dockerfile:1

FROM oven/bun:1.3.7-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM base AS test
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY test ./test
COPY deploy/ServerIPs.txt /tmp/sph-data/ServerIPs.txt
RUN SPH_SECRET=test-secret-aaaaaaaaaaaaaaaa \
    JWT_SECRET=matrix-plug-e2e-local-hmac-secret-do-not-use-in-prod \
    ALLOW_ALL_IPS=false \
    FOLDER_NAME=matrix \
    DATA_DIR=/tmp/sph-data \
    MATRIX_HOMESERVER=http://127.0.0.1:9 \
    bun test

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    ALLOW_ALL_IPS=false
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY deploy/ServerIPs.txt /app/data/ServerIPs.txt
RUN mkdir -p /app/data && chown -R bun:bun /app
USER bun
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bun", "run", "src/index.ts"]
