# IntexuraOS Intex Agent Dockerfile
# Multi-stage build with esbuild bundling.

# Stage 1: Build
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package*.json ./
COPY apps/intex-agent/package*.json ./apps/intex-agent/

COPY packages/ ./packages/
RUN pnpm install --frozen-lockfile

COPY tsconfig*.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY apps/intex-agent/ ./apps/intex-agent/

RUN pnpm run --filter @intexuraos/intex-agent build

# Stage 2: Production
FROM node:22-alpine

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./

COPY --from=builder /app/apps/intex-agent/dist/package.json ./
RUN CI=true pnpm install --prod --no-frozen-lockfile

COPY --from=builder /app/apps/intex-agent/dist/index.js ./dist/
COPY --from=builder /app/apps/intex-agent/dist/index.js.map ./dist/

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
